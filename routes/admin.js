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

// Server URL config
router.post('/server-url', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { server_url } = req.body;
        await db.execute({
            sql: 'UPDATE system_config SET config_value = ? WHERE config_key = "server_url"',
            args: [server_url]
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
