const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { moderateMessage } = require('../utils/gemini');
const upload = require('../middleware/upload');
const { uploadToCloudinary } = require('../utils/cloudinary');
const { sendPushNotification } = require('../utils/webpush');

const getIdentity = (user) => {
    const id = user.user_id || user.seller_id || user.id;
    const prefix = user.role === 'buyer' ? 'U' : 'S';
    return { id, identifier: `${prefix}${id}`, type: user.role === 'buyer' ? 'user' : (user.role === 'admin' ? 'admin' : 'seller') };
};

const getConversationForUser = async (conversationId, user) => {
    const identity = getIdentity(user);
    const result = await db.execute({
        sql: 'SELECT * FROM conversations WHERE conversation_id = ? AND participants LIKE ?',
        args: [conversationId, `%"${identity.identifier}"%`]
    });
    return result.rows[0];
};

// Get conversations
router.get('/conversations', authenticate, async (req, res) => {
    try {
        const userId = req.user.user_id || req.user.id;
        const userPrefix = req.user.role === 'buyer' ? 'U' : 'S';
        const userIdentifier = `${userPrefix}${userId}`;

        const convs = await db.execute({
            sql: `SELECT c.*, 
                  (SELECT content FROM messages WHERE conversation_id = c.conversation_id ORDER BY created_at DESC LIMIT 1) as last_message,
                  (SELECT created_at FROM messages WHERE conversation_id = c.conversation_id ORDER BY created_at DESC LIMIT 1) as last_message_time
                  FROM conversations c 
                  WHERE JSON_EXTRACT(c.participants, '$') LIKE ? 
                  ORDER BY last_message_at DESC`,
            args: [`%${userIdentifier}%`]
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
                  END as sender_name
                  FROM messages m 
                  WHERE m.conversation_id = ? ORDER BY m.created_at ASC`,
            args: [req.params.conversationId]
        });
        res.json(messages.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Send message
router.post('/', authenticate, async (req, res) => {
    try {
        const { conversation_id, content, conversation_type, participants, related_order_id } = req.body;
        const identity = getIdentity(req.user);
        const senderIdentifier = identity.identifier;

        // AI Moderation
        const isFlagged = await moderateMessage(content);
        if (isFlagged) {
            return res.status(400).json({ error: 'Message flagged by AI moderation. Please rephrase.' });
        }

        // Create conversation if new
        let convId = conversation_id;
        let storeReply = null;
        if (!convId) {
            const participantList = Array.from(new Set([senderIdentifier, ...(Array.isArray(participants) ? participants : [])]));
            const participantsJson = JSON.stringify(participantList);
            const conv = await db.execute({
                sql: `INSERT INTO conversations (conversation_type, participants, related_order_id) 
                      VALUES (?, ?, ?)`,
                args: [conversation_type || 'buyer_shop', participantsJson, related_order_id || null]
            });
            convId = conv.lastInsertRowid;
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
            args: [convId, senderIdentifier, identity.type, content]
        });

        await db.execute({
            sql: 'UPDATE conversations SET last_message_at = datetime("now") WHERE conversation_id = ?',
            args: [convId]
        });

        const conversation = await db.execute({ sql: 'SELECT participants FROM conversations WHERE conversation_id = ?', args: [convId] });
        for (const participant of JSON.parse(conversation.rows[0]?.participants || '[]')) {
            if (participant === senderIdentifier) continue;
            if (participant.startsWith('U')) await sendPushNotification(Number(participant.slice(1)), 'buyer', { title: 'New chat message', body: String(content).slice(0, 120), tag: `chat-${convId}`, url: `/index.html#chat?conversation=${convId}` });
            if (participant.startsWith('S')) await sendPushNotification(Number(participant.slice(1)), 'seller', { title: 'New chat message', body: String(content).slice(0, 120), tag: `chat-${convId}`, url: `/store-dashboard.html#chat?conversation=${convId}` });
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

        const conversation = await db.execute({ sql: 'SELECT participants FROM conversations WHERE conversation_id = ?', args: [conversation_id] });
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
