const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

// Dashboard metrics
router.get('/dashboard', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const totalUsers = await db.execute({ sql: 'SELECT COUNT(*) as c FROM users WHERE account_status = "active"' });
        const totalSellers = await db.execute({ sql: 'SELECT COUNT(*) as c FROM sellers' });
        const totalOrders = await db.execute({ sql: 'SELECT COUNT(*) as c FROM orders' });
        const totalRevenue = await db.execute({ sql: 'SELECT SUM(total_amount) as sum FROM orders WHERE payment_status = "paid"' });
        
        const monthlySales = await db.execute({
            sql: `SELECT strftime('%Y-%m', created_at) as month, SUM(total_amount) as revenue, COUNT(*) as count 
                  FROM orders WHERE payment_status = "paid" GROUP BY month ORDER BY month DESC LIMIT 12`
        });

        res.json({
            total_users: totalUsers.rows[0].c,
            total_sellers: totalSellers.rows[0].c,
            total_orders: totalOrders.rows[0].c,
            total_revenue: totalRevenue.rows[0].sum || 0,
            monthly_sales: monthlySales.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Manage users
router.get('/users', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const users = await db.execute({
            sql: 'SELECT user_id, public_id, name, phone, wallet_balance, account_status, created_at FROM users ORDER BY created_at DESC'
        });
        res.json(users.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.patch('/users/:id/status', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { status } = req.body;
        await db.execute({
            sql: 'UPDATE users SET account_status = ? WHERE user_id = ?',
            args: [status, req.params.id]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create seller/agent
router.post('/sellers', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { name, phone, password, role, store_name } = req.body;
        const hash = await bcrypt.hash(password, 10);
        
        const count = await db.execute({ sql: 'SELECT COUNT(*) as c FROM sellers WHERE role = ?', args: [role] });
        const prefix = role === 'publisher' ? 'PU' : role === 'bookstore' ? 'SP' : role === 'agent' ? 'AG' : 'CS';
        const publicId = `${prefix}#${String(count.rows[0].c + 1).padStart(4, '0')}`;

        await db.execute({
            sql: `INSERT INTO sellers (public_id, role, name, phone, password_hash, store_name) 
                  VALUES (?, ?, ?, ?, ?, ?)`,
            args: [publicId, role, name, phone, hash, store_name || name]
        });

        res.json({ success: true, public_id: publicId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List sellers/agents (optionally filter by role)
router.get('/sellers', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { role } = req.query;
        let sql = `SELECT seller_id, public_id, role, name, phone, store_name, wallet_balance, 
                    monthly_commission_due, is_visible, created_at FROM sellers`;
        const args = [];
        if (role) {
            sql += ' WHERE role = ?';
            args.push(role);
        }
        sql += ' ORDER BY created_at DESC';
        const sellers = await db.execute({ sql, args });
        res.json(sellers.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Show/hide a seller's storefront
router.patch('/sellers/:id/visibility', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { is_visible } = req.body;
        await db.execute({
            sql: 'UPDATE sellers SET is_visible = ? WHERE seller_id = ?',
            args: [is_visible ? 1 : 0, req.params.id]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Manage products
router.get('/products/pending', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const products = await db.execute({
            sql: `SELECT p.*, s.store_name FROM products p 
                  JOIN sellers s ON p.seller_id = s.seller_id 
                  WHERE p.approved = 0 ORDER BY p.created_at DESC`
        });
        res.json(products.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.patch('/products/:id/approve', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { approved } = req.body;
        await db.execute({
            sql: 'UPDATE products SET approved = ? WHERE book_id = ?',
            args: [approved, req.params.id]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List all orders (platform-wide)
router.get('/orders', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { status, date_from, date_to } = req.query;
        let sql = `SELECT o.*, p.title as product_title, u.name as buyer_name, u.phone as buyer_phone,
                    s.store_name, s.public_id as seller_public_id
                   FROM orders o
                   LEFT JOIN products p ON o.product_id = p.book_id
                   LEFT JOIN users u ON o.buyer_id = u.user_id
                   LEFT JOIN sellers s ON o.seller_id = s.seller_id
                   WHERE 1=1`;
        const args = [];

        if (status) {
            sql += ' AND o.order_status = ?';
            args.push(status);
        }
        if (date_from && date_to) {
            sql += ' AND date(o.created_at) BETWEEN ? AND ?';
            args.push(date_from, date_to);
        }

        sql += ' ORDER BY o.created_at DESC LIMIT 200';
        const orders = await db.execute({ sql, args });
        res.json(orders.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Read-only view of key system settings (for the Security screen)
router.get('/config', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const rows = await db.execute({
            sql: `SELECT config_key, config_value FROM system_config
                  WHERE config_key IN ('current_password_code', 'markup_percentage', 'agent_cash_in_limit')`
        });
        const config = {};
        rows.rows.forEach(r => { config[r.config_key] = r.config_value; });
        res.json({
            current_password_code: config.current_password_code || '',
            markup_percentage: config.markup_percentage || '10',
            agent_cash_in_limit: config.agent_cash_in_limit || '500000'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Commission settings
router.post('/commission', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { publisher_tiers, bookstore_rate, commission_rate, resell_rate } = req.body;
        // Store in system_config as JSON
        await db.execute({
            sql: 'UPDATE system_config SET config_value = ? WHERE config_key = "commission_settings"',
            args: [JSON.stringify({ publisher_tiers, bookstore_rate, commission_rate, resell_rate })]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Change password code
router.post('/password-code', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { new_code } = req.body;
        await db.execute({
            sql: 'UPDATE system_config SET config_value = ? WHERE config_key = "current_password_code"',
            args: [new_code]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// AI Flagged messages
router.get('/flagged-messages', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const messages = await db.execute({
            sql: `SELECT m.*, c.conversation_type 
                  FROM messages m 
                  JOIN conversations c ON m.conversation_id = c.conversation_id 
                  WHERE m.is_flagged = 1 ORDER BY m.created_at DESC`
        });
        res.json(messages.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/messages/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
        await db.execute({
            sql: 'DELETE FROM messages WHERE message_id = ?',
            args: [req.params.id]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Voting festivals
// List ALL festivals (active, upcoming, ended) - the public /voting/festivals endpoint only shows active ones
router.get('/festivals', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const festivals = await db.execute({
            sql: `SELECT f.*,
                  (SELECT COUNT(*) FROM votes WHERE festival_id = f.festival_id) as total_votes,
                  (SELECT COUNT(*) FROM festival_books WHERE festival_id = f.festival_id) as book_count
                  FROM voting_festivals f ORDER BY f.created_at DESC`
        });
        res.json(festivals.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List store books with a flag showing whether they're already curated into this festival
router.get('/festivals/:id/books', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const books = await db.execute({
            sql: `SELECT p.book_id, p.title, p.author_name, s.store_name,
                  CASE WHEN fb.id IS NULL THEN 0 ELSE 1 END as is_added
                  FROM products p
                  JOIN sellers s ON p.seller_id = s.seller_id
                  LEFT JOIN festival_books fb ON fb.book_id = p.book_id AND fb.festival_id = ?
                  WHERE p.product_type = 'store_book' AND p.is_active = 1 AND p.approved = 1
                  ORDER BY is_added DESC, p.title ASC`,
            args: [req.params.id]
        });
        res.json(books.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add a book to a festival's voting list
router.post('/festivals/:id/books', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { book_id } = req.body;
        await db.execute({
            sql: 'INSERT OR IGNORE INTO festival_books (festival_id, book_id) VALUES (?, ?)',
            args: [req.params.id, book_id]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Remove a book from a festival's voting list
router.delete('/festivals/:id/books/:bookId', authenticate, requireRole('admin'), async (req, res) => {
    try {
        await db.execute({
            sql: 'DELETE FROM festival_books WHERE festival_id = ? AND book_id = ?',
            args: [req.params.id, req.params.bookId]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/festivals', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { festival_name, start_date, end_date } = req.body;
        await db.execute({
            sql: 'INSERT INTO voting_festivals (festival_name, start_date, end_date) VALUES (?, ?, ?)',
            args: [festival_name, start_date, end_date]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.patch('/festivals/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { is_active } = req.body;
        await db.execute({
            sql: 'UPDATE voting_festivals SET is_active = ? WHERE festival_id = ?',
            args: [is_active, req.params.id]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
