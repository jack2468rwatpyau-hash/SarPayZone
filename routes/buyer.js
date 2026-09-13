const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');

// Public profile data for viewing another buyer from chat. Private account
// fields are intentionally excluded; purchase count is aggregate only.
router.get('/public/:publicId', async (req, res) => {
    try {
        const user = await db.execute({
            sql: `SELECT user_id, public_id, name, city, profile_image_id, created_at
                  FROM users WHERE public_id = ? AND account_status = 'active'`,
            args: [String(req.params.publicId)]
        });
        if (!user.rows.length) return res.status(404).json({ error: 'User not found' });

        const profile = user.rows[0];
        const count = await db.execute({
            sql: `SELECT COALESCE(SUM(quantity), 0) AS purchased_book_count,
                         COUNT(DISTINCT product_id) AS purchased_title_count
                  FROM orders WHERE buyer_id = ? AND order_status <> 'cancelled'`,
            args: [profile.user_id]
        });
        res.json({
            user: profile,
            purchased_book_count: Number(count.rows[0]?.purchased_book_count || 0),
            purchased_title_count: Number(count.rows[0]?.purchased_title_count || 0)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Wishlist
router.get('/wishlist', authenticate, async (req, res) => {
    try {
        const wishlist = await db.execute({
            sql: `SELECT w.*, p.title, p.discounted_price, p.images, s.store_name 
                  FROM wishlist w 
                  JOIN products p ON w.book_id = p.book_id 
                  JOIN sellers s ON p.seller_id = s.seller_id 
                  WHERE w.user_id = ?`,
            args: [req.user.user_id || req.user.id]
        });
        res.json(wishlist.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/wishlist', authenticate, async (req, res) => {
    try {
        const { book_id } = req.body;
        await db.execute({
            sql: `INSERT OR IGNORE INTO wishlist (user_id, book_id) VALUES (?, ?)`,
            args: [req.user.user_id || req.user.id, book_id]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/wishlist/:book_id', authenticate, async (req, res) => {
    try {
        await db.execute({
            sql: `DELETE FROM wishlist WHERE user_id = ? AND book_id = ?`,
            args: [req.user.user_id || req.user.id, req.params.book_id]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update profile
router.patch('/profile', authenticate, async (req, res) => {
    try {
        const { name, city, profile_image_id } = req.body;
        await db.execute({
            sql: `UPDATE users SET name = ?, city = ?, profile_image_id = ? WHERE user_id = ?`,
            args: [name, city, profile_image_id, req.user.user_id || req.user.id]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
