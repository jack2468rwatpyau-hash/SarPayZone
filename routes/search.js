const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/entities', async (req, res) => {
    try {
        const type = String(req.query.type || 'seller');
        const query = String(req.query.q || '').trim();
        if (!['user', 'seller', 'author', 'resell'].includes(type)) return res.status(400).json({ error: 'Invalid search type' });
        if (query.length < 1) return res.json([]);
        const prefix = `${query}%`;
        let result;
        if (type === 'seller') {
            result = await db.execute({
                sql: `SELECT seller_id AS id, public_id, store_name AS name, logo, banner
                      FROM sellers WHERE is_visible = 1 AND (store_name LIKE ? OR public_id LIKE ? OR CAST(seller_id AS TEXT) LIKE ?)
                      ORDER BY store_name LIMIT 20`, args: [prefix, prefix, prefix]
            });
        } else if (type === 'author') {
            result = await db.execute({
                sql: `SELECT MIN(book_id) AS id, author_name AS name, COUNT(*) AS book_count
                      FROM products WHERE is_active = 1 AND author_name IS NOT NULL AND TRIM(author_name) <> '' AND author_name LIKE ?
                      GROUP BY author_name ORDER BY author_name LIMIT 20`, args: [prefix]
            });
        } else if (type === 'resell') {
            result = await db.execute({
                sql: `SELECT r.listing_id AS id, r.public_id, r.title AS name, r.author_name,
                             r.final_price, r.asking_price, r.stock_quantity, r.condition_images,
                             u.name AS seller_name, u.public_id AS seller_public_id
                      FROM resell_listings r JOIN users u ON u.user_id = r.seller_id
                      WHERE r.status = 'approved' AND r.stock_quantity > 0
                        AND (r.title LIKE ? OR COALESCE(r.author_name, '') LIKE ? OR r.public_id LIKE ?
                             OR u.name LIKE ? OR u.public_id LIKE ?)
                      ORDER BY r.created_at DESC LIMIT 20`, args: [prefix, prefix, prefix, prefix, prefix]
            });
        } else {
            result = await db.execute({
                sql: `SELECT user_id AS id, public_id, name, profile_image_id, city
                      FROM users WHERE account_status = 'active' AND (name LIKE ? OR public_id LIKE ? OR CAST(user_id AS TEXT) LIKE ?)
                      ORDER BY name LIMIT 20`, args: [prefix, prefix, prefix]
            });
        }
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
