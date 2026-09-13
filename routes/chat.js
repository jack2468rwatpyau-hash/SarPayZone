const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { moderateMessage } = require('../utils/gemini');
const upload = require('../middleware/upload');
const { uploadToCloudinary } = require('../utils/cloudinary');
const { sendPushNotification } = require('../utils/webpush');

let visibilityTableReady;
function ensureVisibilityTable() {
    visibilityTableReady ||= db.execute({ sql: `CREATE TABLE IF NOT EXISTS conversation_hidden (
        conversation_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        hidden_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (conversation_id, user_id),
        FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )` });
    return visibilityTableReady;
}

const getIdentity = (user) => {
    const id = user.user_id || user.seller_id || user.id;
    const prefix = user.role === 'buyer' ? 'U' : 'S';
    return { id, identifier: `${prefix}${id}`, type: user.role === 'buyer' ? 'user' : (user.role === 'admin' ? 'admin' : 'seller') };
};

const getConversationForUser = async (conversationId, user) => {
    const identity = getIdentity(user);
    const result = await db.execute({
        sql: `SELECT * FROM conversations WHERE conversation_id = ? AND participants LIKE ?`,
        args: [conversationId, `%"${identity.identifier}"%`]
    });
    return result.rows[0];
};

// Get conversations
router.get('/conversations', authenticate, async (req, res) => {
    try {
        await ensureVisibilityTable();
        const userId = req.user.user_id || req.user.id;
        const userPrefix = req.user.role === 'buyer' ? 'U' : 'S';
        const userIdentifier = `${userPrefix}${userId}`;

        const convs = await db.execute({
            sql: `SELECT c.*, 
                  (SELECT content FROM messages WHERE conversation_id = c.conversation_id ORDER BY created_at DESC LIMIT 1) as last_message,
                  (SELECT created_at FROM messages WHERE conversation_id = c.conversation_id ORDER BY created_at DESC LIMIT 1) as last_message_time
                  FROM conversations c 
                  WHERE JSON_EXTRACT(c.participants, '$') LIKE ?
                    AND NOT EXISTS (SELECT 1 FROM conversation_hidden h WHERE h.conversation_id = c.conversation_id AND h.user_id = ?)
                  ORDER BY last_message_at DESC`,
            args: [`%${userIdentifier}%`, userId]
        });
        res.json(convs.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get messages
router.get('/:conversationId', authenticate, async (req, res) => {
    try {
        if (!await getConversationForUser(req.params.conversationId, req.user)) return res.status(403).json({ error: 'Not a conversation participant' });
        const messages = await db.execute({
            sql: `SELECT m.*, 
                  CASE 
                    WHEN m.sender_type = 'user' THEN (SELECT name FROM users WHERE user_id = CAST(SUBSTR(m.sender_id, 2) AS INTEGER))
                    WHEN m.sender_type = 'seller' THEN (SELECT store_name FROM sellers WHERE seller_id = CAST(SUBSTR(m.sender_id, 2) AS INTEGER))
                    ELSE 'Admin'
                  END as sender_name,
                  CASE
                    WHEN m.sender_type = 'user' THEN (SELECT public_id FROM users WHERE user_id = CAST(SUBSTR(m.sender_id, 2) AS INTEGER))
                    ELSE NULL
                  END as sender_public_id
                  FROM messages m 
                  WHERE m.conversation_id = ? ORDER BY m.created_at ASC`,
            args: [req.params.conversationId]
        });
        res.json(messages.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Hide a conversation from the buyer's own chat list. The seller's copy and
// the underlying messages remain intact for order/support history.
router.delete('/conversations/:conversationId', authenticate, async (req, res) => {
    try {
        await ensureVisibilityTable();
        const userId = req.user.user_id || req.user.id;
        if (req.user.role !== 'buyer' || !await getConversationForUser(req.params.conversationId, req.user)) {
            return res.status(403).json({ error: 'Only a participating buyer can delete this chat' });
        }
        await db.execute({
            sql: `INSERT OR IGNORE INTO conversation_hidden (conversation_id, user_id) VALUES (?, ?)`,
            args: [Number(req.params.conversationId), userId]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Send message
router.post('/', authenticate, async (req, res) => {
    try {
        const { conversation_id, content, conversation_type, participants, related_order_id } = req.body;
        const normalizedContent = String(content || '').trim();
        const normalizedConversationId = conversation_id === undefined || conversation_id === null || conversation_id === '' ? null : Number(conversation_id);
        if ((normalizedConversationId !== null && !normalizedContent) || normalizedContent.length > 2000) return res.status(400).json({ error: 'Message must be between 1 and 2000 characters' });
        if (normalizedConversationId !== null && !Number.isSafeInteger(normalizedConversationId)) return res.status(400).json({ error: 'Invalid conversation' });
        const normalizedParticipants = Array.isArray(participants) ? participants.map(value => String(value)).filter(Boolean) : [];
        const identity = getIdentity(req.user);
        const senderIdentifier = identity.identifier;

        // AI Moderation
        const isFlagged = normalizedContent ? await moderateMessage(normalizedContent) : false;
        if (isFlagged) {
            return res.status(400).json({ error: 'Message flagged by AI moderation. Please rephrase.' });
        }

        // Create conversation if new
        let convId = normalizedConversationId;
        let storeReply = null;
        if (!convId) {
            const participantList = Array.from(new Set([senderIdentifier, ...normalizedParticipants]));
            const participantsJson = JSON.stringify(participantList);
            const conv = await db.execute({
                sql: `INSERT INTO conversations (conversation_type, participants, related_order_id) 
                      VALUES (?, ?, ?)`,
                args: [conversation_type || 'buyer_shop', participantsJson, related_order_id || null]
            });
            convId = Number(conv.lastInsertRowid);
            const sellerIdentifier = participantList.find((participant) => participant.startsWith('S'));
            if (sellerIdentifier) {
                const seller = await db.execute({
                    sql: `SELECT store_name, reply_time_text, auto_reply_message, is_open
                          FROM sellers WHERE seller_id = ?`,
                    args: [Number(sellerIdentifier.slice(1))]
                });
                if (seller.rows.length) storeReply = seller.rows[0];
            }
        } else if (!await getConversationForUser(convId, req.user)) {
            return res.status(403).json({ error: 'Not a conversation participant' });
        }

        await db.execute({
            sql: `INSERT INTO messages (conversation_id, sender_id, sender_type, content) 
                  VALUES (?, ?, ?, ?)`,
            args: [convId, senderIdentifier, identity.type, normalizedContent]
        });

        await db.execute({
            sql: `UPDATE conversations SET last_message_at = datetime('now') WHERE conversation_id = ?`,
            args: [convId]
        });

        const conversation = await db.execute({ sql: `SELECT participants FROM conversations WHERE conversation_id = ?`, args: [convId] });
        for (const participant of JSON.parse(conversation.rows[0]?.participants || '[]')) {
            if (participant === senderIdentifier) continue;
            if (participant.startsWith('U')) await sendPushNotification(Number(participant.slice(1)), 'buyer', { title: 'New chat message', body: normalizedContent.slice(0, 120), tag: `chat-${convId}`, url: `/index.html#chat?conversation=${convId}` });
            if (participant.startsWith('S')) await sendPushNotification(Number(participant.slice(1)), 'seller', { title: 'New chat message', body: normalizedContent.slice(0, 120), tag: `chat-${convId}`, url: `/store-dashboard.html#chat?conversation=${convId}` });
        }

        res.json({ success: true, conversation_id: convId, store_reply: storeReply });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Send image
router.post('/image', authenticate, upload.single('image'), async (req, res) => {
    try {
        const { conversation_id } = req.body;
        if (!req.file) return res.status(400).json({ error: 'Image file is required' });
        if (!await getConversationForUser(conversation_id, req.user)) return res.status(403).json({ error: 'Not a conversation participant' });
        const url = await uploadToCloudinary(req.file.buffer, `chat/${conversation_id}`, 'chat');
        
        const identity = getIdentity(req.user);
        
        await db.execute({
            sql: `INSERT INTO messages (conversation_id, sender_id, sender_type, message_type, content) 
                  VALUES (?, ?, ?, 'image', ?)`,
            args: [conversation_id, identity.identifier, identity.type, url]
        });

        const conversation = await db.execute({ sql: `SELECT participants FROM conversations WHERE conversation_id = ?`, args: [conversation_id] });
        for (const participant of JSON.parse(conversation.rows[0]?.participants || '[]')) {
            if (participant === identity.identifier) continue;
            if (participant.startsWith('U')) await sendPushNotification(Number(participant.slice(1)), 'buyer', { title: 'New chat image', body: 'A new image was sent in chat.', tag: `chat-${conversation_id}`, url: `/index.html#chat?conversation=${conversation_id}` });
            if (participant.startsWith('S')) await sendPushNotification(Number(participant.slice(1)), 'seller', { title: 'New chat image', body: 'A new image was sent in chat.', tag: `chat-${conversation_id}`, url: `/store-dashboard.html#chat?conversation=${conversation_id}` });
        }

        res.json({ success: true, url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
