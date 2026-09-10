const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const upload = require('../middleware/upload');
const { uploadToCloudinary } = require('../utils/cloudinary');

const conditionStatuses = ['new', 'like_new', 'good', 'fair', 'poor'];

// Create an independent C2C book listing. No platform Product ID is required.
router.post('/list', authenticate, requireRole('buyer'), upload.array('condition_images', 5), async (req, res) => {
    try {
        const { title, author_name, isbn, publisher, condition_status = 'good', condition_note, asking_price } = req.body;
        const userId = req.user.user_id || req.user.id;
        const price = Number(asking_price);
        if (!String(title || '').trim()) return res.status(400).json({ error: 'Book title is required' });
        if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'A valid asking price is required' });
        if (!conditionStatuses.includes(condition_status)) return res.status(400).json({ error: 'Invalid book condition' });
        if (!condition_note || String(condition_note).trim().length < 5) return res.status(400).json({ error: 'Please describe the book condition' });
        if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'At least one condition photo is required' });

        const imageUrls = [];
        for (const file of req.files) imageUrls.push(await uploadToCloudinary(file.buffer, `resell/${userId}`, 'resell'));
        const count = await db.execute({ sql: 'SELECT COUNT(*) AS c FROM resell_listings' });
        const publicId = `REbk#${String(Number(count.rows[0].c) + 1).padStart(4, '0')}`;
        const result = await db.execute({
            sql: `INSERT INTO resell_listings (public_id, seller_id, product_id, title, author_name, isbn, publisher, condition_status, condition_images, condition_note, asking_price, status)
                  VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            args: [publicId, userId, String(title).trim(), author_name?.trim() || null, isbn?.trim() || null, publisher?.trim() || null, condition_status, JSON.stringify(imageUrls), String(condition_note).trim(), price]
        });
        res.json({ success: true, listing_id: result.lastInsertRowid, public_id: publicId, status: 'pending' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/pending', authenticate, requireRole('admin'), async (_req, res) => {
    try {
        const listings = await db.execute({
            sql: `SELECT r.*, u.name AS seller_name, u.public_id AS seller_public_id, u.city
                  FROM resell_listings r JOIN users u ON r.seller_id = u.user_id WHERE r.status = 'pending' ORDER BY r.created_at DESC`
        });
        res.json(listings.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id/approve', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { status, markup_percentage } = req.body;
        if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Status must be approved or rejected' });
        const listing = await db.execute({ sql: 'SELECT asking_price FROM resell_listings WHERE listing_id = ?', args: [req.params.id] });
        if (!listing.rows.length) return res.status(404).json({ error: 'Resell listing not found' });
        const configured = await db.execute({ sql: 'SELECT config_value FROM system_config WHERE config_key = "markup_percentage"' });
        const markup = Math.max(0, Number(markup_percentage ?? configured.rows[0]?.config_value ?? 10));
        const finalPrice = Number(listing.rows[0].asking_price) * (1 + markup / 100);
        await db.execute({ sql: `UPDATE resell_listings SET status = ?, approved_by = ?, markup_percentage = ?, final_price = ?, updated_at = datetime('now') WHERE listing_id = ?`, args: [status, req.user.seller_id || req.user.id, status === 'approved' ? markup : 0, status === 'approved' ? finalPrice : null, req.params.id] });
        res.json({ success: true, final_price: status === 'approved' ? finalPrice : null });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/listings', async (_req, res) => {
    try {
        const listings = await db.execute({
            sql: `SELECT r.*, u.name AS seller_name, u.public_id AS seller_public_id, u.city
                  FROM resell_listings r JOIN users u ON r.seller_id = u.user_id WHERE r.status = 'approved' ORDER BY r.created_at DESC`
        });
        res.json(listings.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
