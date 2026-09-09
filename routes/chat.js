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
backend/routes/shipping.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

// Get shipping rates for seller
router.get('/', authenticate, requireRole('publisher', 'bookstore', 'commission_store'), async (req, res) => {
    try {
        const rates = await db.execute({
            sql: 'SELECT * FROM shipping_rates WHERE seller_id = ? ORDER BY state, city, township',
            args: [req.user.seller_id]
        });
        res.json(rates.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update/Create shipping rate
router.post('/', authenticate, requireRole('publisher', 'bookstore', 'commission_store'), async (req, res) => {
    try {
        const { state, city, township, is_no_shipping, is_cod_allowed, is_prepay_allowed, prepay_shipping_fee } = req.body;
        
        const existing = await db.execute({
            sql: 'SELECT rate_id FROM shipping_rates WHERE seller_id = ? AND state = ? AND city = ? AND township = ?',
            args: [req.user.seller_id, state, city, township]
        });

        if (existing.rows.length > 0) {
            await db.execute({
                sql: `UPDATE shipping_rates 
                      SET is_no_shipping = ?, is_cod_allowed = ?, is_prepay_allowed = ?, prepay_shipping_fee = ? 
                      WHERE rate_id = ?`,
                args: [is_no_shipping, is_cod_allowed, is_prepay_allowed, prepay_shipping_fee || 5000, existing.rows[0].rate_id]
            });
        } else {
            await db.execute({
                sql: `INSERT INTO shipping_rates (seller_id, state, city, township, is_no_shipping, is_cod_allowed, is_prepay_allowed, prepay_shipping_fee) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [req.user.seller_id, state, city, township, is_no_shipping, is_cod_allowed, is_prepay_allowed, prepay_shipping_fee || 5000]
            });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Bulk update
router.post('/bulk', authenticate, requireRole('publisher', 'bookstore', 'commission_store'), async (req, res) => {
    try {
        const { townships, updates } = req.body; // townships = [{state, city, township}]
        
        for (const t of townships) {
            const existing = await db.execute({
                sql: 'SELECT rate_id FROM shipping_rates WHERE seller_id = ? AND state = ? AND city = ? AND township = ?',
                args: [req.user.seller_id, t.state, t.city, t.township]
            });
            
            if (existing.rows.length > 0) {
                await db.execute({
                    sql: `UPDATE shipping_rates 
                          SET is_no_shipping = ?, is_cod_allowed = ?, is_prepay_allowed = ?, prepay_shipping_fee = ? 
                          WHERE rate_id = ?`,
                    args: [updates.is_no_shipping, updates.is_cod_allowed, updates.is_prepay_allowed, updates.prepay_shipping_fee, existing.rows[0].rate_id]
                });
            } else {
                await db.execute({
                    sql: `INSERT INTO shipping_rates (seller_id, state, city, township, is_no_shipping, is_cod_allowed, is_prepay_allowed, prepay_shipping_fee) 
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    args: [req.user.seller_id, t.state, t.city, t.township, updates.is_no_shipping, updates.is_cod_allowed, updates.is_prepay_allowed, updates.prepay_shipping_fee]
                });
            }
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
backend/routes/voting.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');

// Get active festivals
router.get('/festivals', async (req, res) => {
    try {
        const festivals = await db.execute({
            sql: `SELECT f.*, 
                  (SELECT COUNT(*) FROM votes WHERE festival_id = f.festival_id) as total_votes 
                  FROM voting_festivals f 
                  WHERE f.is_active = 1 AND datetime('now') BETWEEN f.start_date AND f.end_date`
        });
        res.json(festivals.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get books in festival
router.get('/festival/:id/books', async (req, res) => {
    try {
        const books = await db.execute({
            sql: `SELECT p.*, COUNT(v.vote_id) as vote_count 
                  FROM products p 
                  LEFT JOIN votes v ON p.book_id = v.book_id AND v.festival_id = ? 
                  WHERE p.product_type = 'store_book' AND p.is_active = 1 
                  GROUP BY p.book_id ORDER BY vote_count DESC`,
            args: [req.params.id]
        });
        res.json(books.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Cast vote
router.post('/vote', authenticate, async (req, res) => {
    try {
        const { festival_id, book_id } = req.body;
        const userId = req.user.user_id || req.user.id;

        // Check festival is active
        const festival = await db.execute({
            sql: 'SELECT * FROM voting_festivals WHERE festival_id = ? AND is_active = 1 AND datetime("now") BETWEEN start_date AND end_date',
            args: [festival_id]
        });
        if (festival.rows.length === 0) return res.status(400).json({ error: 'Festival is not active' });

        // Check if already voted
        const existing = await db.execute({
            sql: 'SELECT vote_id FROM votes WHERE festival_id = ? AND user_id = ?',
            args: [festival_id, userId]
        });
        if (existing.rows.length > 0) return res.status(400).json({ error: 'You have already voted in this festival' });

        await db.execute({
            sql: 'INSERT INTO votes (festival_id, book_id, user_id) VALUES (?, ?, ?)',
            args: [festival_id, book_id, userId]
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

