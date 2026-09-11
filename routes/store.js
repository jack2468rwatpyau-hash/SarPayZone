const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

const sellerRoles = requireRole('publisher', 'bookstore', 'commission_store');
const profileFields = 'seller_id, name, email, phone, store_name, logo, banner';
const settingsFields = `seller_id, store_name, is_open, accepting_orders, reply_time_minutes,
                        reply_time_text, closed_message, auto_reply_message`;

router.get('/profile', authenticate, sellerRoles, async (req, res) => {
    try {
        const result = await db.execute({ sql: `SELECT ${profileFields} FROM sellers WHERE seller_id = ?`, args: [req.user.seller_id] });
        if (!result.rows.length) return res.status(404).json({ error: 'Store not found' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/profile', authenticate, sellerRoles, async (req, res) => {
    try {
        const { name, email, store_name, logo, banner } = req.body;
        if (!String(name || '').trim() || !String(store_name || '').trim()) return res.status(400).json({ error: 'Owner name and store name are required' });
        if (String(name).length > 120 || String(store_name).length > 160 || String(email || '').length > 160) return res.status(400).json({ error: 'Profile text is too long' });
        for (const value of [logo, banner]) if (value && !/^https?:\/\//i.test(String(value))) return res.status(400).json({ error: 'Logo and banner must be valid image URLs' });
        await db.execute({ sql: `UPDATE sellers SET name = ?, email = ?, store_name = ?, logo = ?, banner = ?, updated_at = datetime('now') WHERE seller_id = ?`, args: [name.trim(), String(email || '').trim() || null, store_name.trim(), String(logo || '').trim() || null, String(banner || '').trim() || null, req.user.seller_id] });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/settings', authenticate, sellerRoles, async (req, res) => {
    try {
        const result = await db.execute({
            sql: `SELECT ${settingsFields} FROM sellers WHERE seller_id = ?`,
            args: [req.user.seller_id]
        });
        if (!result.rows.length) return res.status(404).json({ error: 'Store not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.patch('/settings', authenticate, sellerRoles, async (req, res) => {
    try {
        const {
            is_open,
            accepting_orders,
            reply_time_minutes,
            reply_time_text,
            closed_message,
            auto_reply_message
        } = req.body;
        const minutes = Number(reply_time_minutes);
        if (![0, 1].includes(Number(is_open)) || ![0, 1].includes(Number(accepting_orders))) {
            return res.status(400).json({ error: 'Store and order settings must be enabled or disabled' });
        }
        if (!Number.isInteger(minutes) || minutes < 0 || minutes > 10080) {
            return res.status(400).json({ error: 'Reply time must be between 0 and 10080 minutes' });
        }
        if (!String(reply_time_text || '').trim() || String(reply_time_text).length > 100) {
            return res.status(400).json({ error: 'Reply time text is required and must be under 100 characters' });
        }
        if (String(closed_message || '').length > 300 || String(auto_reply_message || '').length > 300) {
            return res.status(400).json({ error: 'Store messages must be under 300 characters' });
        }

        const result = await db.execute({
            sql: `UPDATE sellers SET is_open = ?, accepting_orders = ?, reply_time_minutes = ?,
                  reply_time_text = ?, closed_message = ?, auto_reply_message = ?, updated_at = datetime('now')
                  WHERE seller_id = ?`,
            args: [Number(is_open), Number(accepting_orders), minutes, String(reply_time_text).trim(),
                String(closed_message || '').trim() || null, String(auto_reply_message || '').trim() || null,
                req.user.seller_id]
        });
        if (!result.rowsAffected) return res.status(404).json({ error: 'Store not found' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
