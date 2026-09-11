const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const upload = require('../middleware/upload');
const { uploadToCloudinary } = require('../utils/cloudinary');

// Get products with filters
router.get('/', async (req, res) => {
    try {
        const { category, search, sort = 'newest', page = 1, limit = 20, type, seller_id } = req.query;
        let sql = `SELECT p.*, s.store_name, s.public_id as seller_public_id, s.is_open as store_is_open,
                          s.accepting_orders as store_accepting_orders, s.reply_time_minutes, s.reply_time_text,
                          s.closed_message, s.auto_reply_message, c.name as category_name
                   FROM products p 
                   LEFT JOIN sellers s ON p.seller_id = s.seller_id 
                   LEFT JOIN categories c ON p.category_id = c.category_id 
                   WHERE p.is_active = 1 AND p.approved = 1`;
        const args = [];

        if (category) {
            sql += ' AND c.slug = ?';
            args.push(category);
        }
        if (type) {
            sql += ' AND p.product_type = ?';
            args.push(type);
        }
        if (seller_id) {
            sql += ' AND p.seller_id = ?';
            args.push(seller_id);
        }
        if (search) {
            sql += ' AND (p.title LIKE ? OR p.author_name LIKE ?)';
            args.push(`%${search}%`, `%${search}%`);
        }

        if (sort === 'price_low') sql += ' ORDER BY p.discounted_price ASC';
        else if (sort === 'price_high') sql += ' ORDER BY p.discounted_price DESC';
        else if (sort === 'popular') sql += ' ORDER BY p.view_count DESC';
        else sql += ' ORDER BY p.created_at DESC';

        sql += ' LIMIT ? OFFSET ?';
        args.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

        const products = await db.execute({ sql, args });
        res.json(products.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get active home banners
router.get('/banners', async (req, res) => {
    try {
        const banners = await db.execute({
            sql: `SELECT banner_id, title, subtitle, image_url, target_link
                  FROM banners WHERE is_active = 1 ORDER BY sort_order, created_at DESC`
        });
        res.json(banners.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get categories
router.get('/categories/all', async (req, res) => {
    try {
        const cats = await db.execute({ sql: 'SELECT * FROM categories ORDER BY sort_order' });
        res.json(cats.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Seller catalog, including pending products (seller dashboard only)
router.get('/mine', authenticate, requireRole('publisher', 'bookstore', 'commission_store'), async (req, res) => {
    try {
        const products = await db.execute({
            sql: `SELECT p.*, s.store_name, c.name as category_name
                  FROM products p
                  LEFT JOIN sellers s ON p.seller_id = s.seller_id
                  LEFT JOIN categories c ON p.category_id = c.category_id
                  WHERE p.seller_id = ? ORDER BY p.created_at DESC`,
            args: [req.user.seller_id]
        });
        res.json(products.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single product
router.get('/:id', async (req, res) => {
    try {
        const product = await db.execute({
            sql: `SELECT p.*, s.store_name, s.logo, s.is_open as store_is_open,
                          s.accepting_orders as store_accepting_orders, s.reply_time_minutes, s.reply_time_text,
                          s.closed_message, s.auto_reply_message, c.name as category_name
                  FROM products p 
                  LEFT JOIN sellers s ON p.seller_id = s.seller_id 
                  LEFT JOIN categories c ON p.category_id = c.category_id
                  WHERE p.book_id = ? AND p.is_active = 1 AND p.approved = 1`,
            args: [req.params.id]
        });

        if (product.rows.length === 0) return res.status(404).json({ error: 'Product not found' });

        // Record view
        await db.execute({
            sql: 'INSERT INTO product_views (book_id, user_id) VALUES (?, ?)',
            args: [req.params.id, req.headers['x-user-id'] || null]
        });
        await db.execute({
            sql: 'UPDATE products SET view_count = view_count + 1 WHERE book_id = ?',
            args: [req.params.id]
        });

        // Variations
        const variations = await db.execute({
            sql: 'SELECT * FROM product_variations WHERE product_id = ?',
            args: [req.params.id]
        });

        // Reviews
        const reviews = await db.execute({
            sql: `SELECT r.*, u.name as user_name, u.public_id as user_public_id 
                  FROM reviews r 
                  JOIN users u ON r.user_id = u.user_id 
                  WHERE r.book_id = ? ORDER BY r.created_at DESC`,
            args: [req.params.id]
        });

        res.json({ ...product.rows[0], variations: variations.rows, reviews: reviews.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create product (Seller only)
router.post('/', authenticate, requireRole('publisher', 'bookstore', 'commission_store'), upload.fields([
    { name: 'images', maxCount: 5 },
    { name: 'variation_images', maxCount: 25 }
]), async (req, res) => {
    try {
        const { title, author_name, category_id, original_price, discounted_price, description, stock_quantity, variations } = req.body;
        const numericOriginal = Number(original_price);
        const numericDiscounted = discounted_price === undefined || discounted_price === '' ? numericOriginal : Number(discounted_price);
        const numericStock = stock_quantity === undefined || stock_quantity === '' ? 0 : Number(stock_quantity);
        if (!String(title || '').trim() || !Number.isFinite(numericOriginal) || numericOriginal < 0 || !Number.isFinite(numericDiscounted) || numericDiscounted < 0 || !Number.isInteger(numericStock) || numericStock < 0) return res.status(400).json({ error: 'Title, price, discount price, and whole-number stock are required.' });
        
        const count = await db.execute({ sql: 'SELECT COUNT(*) as c FROM products' });
        const publicId = `SPFbk#${String(count.rows[0].c + 1).padStart(4, '0')}`;

        // Upload images
        const imageUrls = [];
        for (const file of req.files?.images || []) {
            const url = await uploadToCloudinary(file.buffer, `products/${publicId}`, 'product');
            imageUrls.push(url);
        }

        const result = await db.execute({
            sql: `INSERT INTO products (public_id, seller_id, product_type, title, author_name, category_id,
                  original_price, discounted_price, description, stock_quantity, images)
                  VALUES (?, ?, 'store_book', ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [publicId, req.user.seller_id, title.trim(), author_name || null, category_id || null, numericOriginal, numericDiscounted, description || null, numericStock, JSON.stringify(imageUrls)]
        });

        const bookId = result.lastInsertRowid;

        // Insert variations
        if (variations) {
            const vars = JSON.parse(variations);
            const imageMap = req.body.variation_image_map ? JSON.parse(req.body.variation_image_map) : [];
            const variationFiles = req.files?.variation_images || [];
            let imageOffset = 0;
            for (let index = 0; index < vars.length; index += 1) {
                const v = vars[index];
                const variationImageUrls = [];
                const imageCount = Number(imageMap[index] || 0);
                for (const file of variationFiles.slice(imageOffset, imageOffset + imageCount)) {
                    variationImageUrls.push(await uploadToCloudinary(file.buffer, `products/${publicId}/variation-${index + 1}`, 'product'));
                }
                imageOffset += imageCount;
                await db.execute({
                    sql: `INSERT INTO product_variations (product_id, variation_name, price, stock_quantity, images) 
                          VALUES (?, ?, ?, ?, ?)`,
                    args: [bookId, v.name, v.price, v.stock, JSON.stringify(variationImageUrls)]
                });
            }
        }

        res.json({ success: true, book_id: bookId, public_id: publicId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
