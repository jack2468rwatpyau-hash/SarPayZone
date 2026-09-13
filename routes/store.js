const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const upload = require('../middleware/upload');
const { uploadToCloudinary } = require('../utils/cloudinary');

const sellerRoles = requireRole('publisher', 'bookstore', 'commission_store');
const profileFields = 'seller_id, name, email, phone, store_name, logo, banner';
const settingsFields = `seller_id, store_name, is_open, accepting_orders, reply_time_minutes,
                        reply_time_text, closed_message, auto_reply_message`;

// Public buyer-facing shop page data. Only visible sellers and active products
// are exposed; seller credentials and private contact fields are excluded.
router.get('/public/:sellerId', async (req, res) => {
    try {
        const seller = await db.execute({
            sql: `SELECT seller_id, public_id, store_name, logo, banner, role, is_open,
                         accepting_orders, reply_time_text, closed_message, auto_reply_message
                  FROM sellers WHERE (seller_id = ? OR public_id = ?) AND is_visible = 1`,
            args: [req.params.sellerId, req.params.sellerId]
        });
        if (!seller.rows.length) return res.status(404).json({ error: 'Shop not found' });

        const shop = seller.rows[0];
        const products = await db.execute({
            sql: `SELECT p.book_id, p.public_id, p.title, p.author_name, p.original_price,
                         p.discounted_price, p.stock_quantity, p.images, p.view_count,
                         p.product_type, c.name AS category_name
                  FROM products p LEFT JOIN categories c ON p.category_id = c.category_id
                  WHERE p.seller_id = ? AND p.is_active = 1 AND (p.approved = 1 OR p.product_type = 'store_book')
                  ORDER BY p.created_at DESC`,
            args: [shop.seller_id]
        });
        res.json({ shop, products: products.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/profile', authenticate, sellerRoles, async (req, res) => {
    try {
        const result = await db.execute({ sql: `SELECT ${profileFields} FROM sellers WHERE seller_id = ?`, args: [req.user.seller_id] });
        if (!result.rows.length) return res.status(404).json({ error: 'Store not found' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/profile', authenticate, sellerRoles, upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'banner', maxCount: 1 }]), async (req, res) => {
    try {
        const { name, email, store_name } = req.body;
        const current = await db.execute({ sql: `SELECT logo, banner FROM sellers WHERE seller_id = ?`, args: [req.user.seller_id] });
        if (!current.rows.length) return res.status(404).json({ error: 'Store not found' });
        if (!String(name || '').trim() || !String(store_name || '').trim()) return res.status(400).json({ error: 'Owner name and store name are required' });
        if (String(name).length > 120 || String(store_name).length > 160 || String(email || '').length > 160) return res.status(400).json({ error: 'Profile text is too long' });
        const logoFile = req.files?.logo?.[0];
        const bannerFile = req.files?.banner?.[0];
        const logo = logoFile ? await uploadToCloudinary(logoFile.buffer, `stores/${req.user.seller_id}`, 'product') : (current.rows[0].logo || null);
        const banner = bannerFile ? await uploadToCloudinary(bannerFile.buffer, `stores/${req.user.seller_id}`, 'product') : (current.rows[0].banner || null);
        await db.execute({ sql: `UPDATE sellers SET name = ?, email = ?, store_name = ?, logo = ?, banner = ?, updated_at = datetime('now') WHERE seller_id = ?`, args: [name.trim(), String(email || '').trim() || null, store_name.trim(), logo, banner, req.user.seller_id] });
        res.json({ success: true, logo, banner });
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
