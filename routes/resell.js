const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const upload = require('../middleware/upload');
const { uploadToCloudinary } = require('../utils/cloudinary');

// Create resell listing
router.post('/list', authenticate, requireRole('buyer'), upload.array('condition_images', 5), async (req, res) => {
    try {
        const { product_id, asking_price, condition_note } = req.body;
        const userId = req.user.user_id || req.user.id;

        // Upload condition images to resell cloudinary
        const imageUrls = [];
        for (const file of req.files || []) {
            const url = await uploadToCloudinary(file.buffer, `resell/${userId}`, 'resell');
            imageUrls.push(url);
        }

        const count = await db.execute({ sql: 'SELECT COUNT(*) as c FROM resell_listings' });
        const publicId = `REbk#${String(count.rows[0].c + 1).padStart(4, '0')}`;

        await db.execute({
            sql: `INSERT INTO resell_listings (public_id, seller_id, product_id, condition_images, asking_price, status) 
                  VALUES (?, ?, ?, ?, ?, 'pending')`,
            args: [publicId, userId, product_id, JSON.stringify(imageUrls), asking_price]
        });

        res.json({ success: true, public_id: publicId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get pending resell listings (Admin)
router.get('/pending', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const listings = await db.execute({
            sql: `SELECT r.*, p.title, p.author_name, u.name as seller_name, u.public_id as seller_public_id 
                  FROM resell_listings r 
                  JOIN products p ON r.product_id = p.book_id 
                  JOIN users u ON r.seller_id = u.user_id 
                  WHERE r.status = 'pending'`
        });
        res.json(listings.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Approve/Decline resell
router.patch('/:id/approve', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { status, markup_percentage } = req.body; // status: approved/rejected
        const adminId = req.user.seller_id || req.user.id;

        const listing = await db.execute({
            sql: 'SELECT asking_price FROM resell_listings WHERE listing_id = ?',
            args: [req.params.id]
        });
        if (listing.rows.length === 0) return res.status(404).json({ error: 'Resell listing not found' });
        const configured = await db.execute({
            sql: 'SELECT config_value FROM system_config WHERE config_key = "markup_percentage"'
        });
        const markup = Number(markup_percentage ?? configured.rows[0]?.config_value ?? 10);
        const finalPrice = Number(listing.rows[0].asking_price) * (1 + markup / 100);

        await db.execute({
            sql: 'UPDATE resell_listings SET status = ?, approved_by = ?, markup_percentage = ?, final_price = ? WHERE listing_id = ?',
            args: [status, adminId, status === 'approved' ? markup : 0, status === 'approved' ? finalPrice : null, req.params.id]
        });

        if (status === 'approved' && markup_percentage !== undefined) {
            await db.execute({
                sql: 'UPDATE system_config SET config_value = ? WHERE config_key = "markup_percentage"',
                args: [markup_percentage]
            });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get approved resell listings
router.get('/listings', async (req, res) => {
    try {
        const listings = await db.execute({
            sql: `SELECT r.*, p.title, p.author_name, p.images, u.name as seller_name, u.public_id as seller_public_id, u.city 
                  FROM resell_listings r 
                  JOIN products p ON r.product_id = p.book_id 
                  JOIN users u ON r.seller_id = u.user_id 
                  WHERE r.status = 'approved'`
        });
        res.json(listings.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
