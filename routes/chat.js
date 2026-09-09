const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { moderateMessage } = require('../utils/gemini');
const upload = require('../middleware/upload');
const { uploadToCloudinary } = require('../utils/cloudinary');

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
        const senderId = req.user.user_id || req.user.id;
        const senderPrefix = req.user.role === 'buyer' ? 'U' : 'S';
        const senderIdentifier = `${senderPrefix}${senderId}`;

        // AI Moderation
        const isFlagged = await moderateMessage(content);
        if (isFlagged) {
            return res.status(400).json({ error: 'Message flagged by AI moderation. Please rephrase.' });
        }

        // Create conversation if new
        let convId = conversation_id;
        if (!convId) {
            const participantsJson = JSON.stringify(participants || [senderIdentifier]);
            const conv = await db.execute({
                sql: `INSERT INTO conversations (conversation_type, participants, related_order_id) 
                      VALUES (?, ?, ?)`,
                args: [conversation_type || 'buyer_shop', participantsJson, related_order_id || null]
            });
            convId = conv.lastInsertRowid;
        }

        await db.execute({
            sql: `INSERT INTO messages (conversation_id, sender_id, sender_type, content) 
                  VALUES (?, ?, ?, ?)`,
            args: [convId, senderIdentifier, req.user.role === 'buyer' ? 'user' : 'seller', content]
        });

        await db.execute({
            sql: 'UPDATE conversations SET last_message_at = datetime("now") WHERE conversation_id = ?',
            args: [convId]
        });

        res.json({ success: true, conversation_id: convId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Send image
router.post('/image', authenticate, upload.single('image'), async (req, res) => {
    try {
        const { conversation_id } = req.body;
        const url = await uploadToCloudinary(req.file.buffer, `chat/${conversation_id}`, 'chat');
        
        const senderId = req.user.user_id || req.user.id;
        const senderPrefix = req.user.role === 'buyer' ? 'U' : 'S';
        
        await db.execute({
            sql: `INSERT INTO messages (conversation_id, sender_id, sender_type, message_type, content) 
                  VALUES (?, ?, ?, 'image', ?)`,
            args: [conversation_id, `${senderPrefix}${senderId}`, req.user.role === 'buyer' ? 'user' : 'seller', url]
        });

        res.json({ success: true, url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
