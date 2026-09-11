const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const { authenticate, requirePasswordCode, ensureStorePasswordCode } = require('../middleware/auth');

const normalizePhone = (value) => String(value || '').replace(/[\s-]/g, '');
const sellerRoles = new Set(['publisher', 'bookstore', 'commission_store', 'agent', 'admin']);

// Buyer: Check Password Code
router.post('/buyer/check-code', requirePasswordCode, (req, res) => {
    res.json({ valid: true, store_id: req.store_id || null });
});

// Seller store access code: six digits, regenerated automatically every 15 days.
router.get('/seller/store-code', authenticate, async (req, res) => {
    try {
        if (req.user.userType !== 'seller' || req.user.role === 'admin') return res.status(403).json({ error: 'Seller store only' });
        const code = await ensureStorePasswordCode(req.user.seller_id);
        res.json({ code: code.code, changed_at: code.changed_at, next_rotation_at: new Date(new Date(`${code.changed_at}Z`).getTime() + 15 * 24 * 60 * 60 * 1000).toISOString() });
    } catch (err) { res.status(500).json({ error: 'Unable to load store code' }); }
});

// Buyer Register
router.post('/buyer/register', async (req, res) => {
    try {
        const { name, password, city } = req.body;
        const phone = normalizePhone(req.body.phone);
        if (!String(name || '').trim() || !/^09\d{7,13}$/.test(phone) || !password || password.length < 8 || password.length > 128) {
            return res.status(400).json({ error: 'Invalid input. Password min 8 chars.' });
        }

        const existing = await db.execute({
            sql: 'SELECT user_id FROM users WHERE phone = ?',
            args: [phone]
        });
        if (existing.rows.length > 0) return res.status(400).json({ error: 'Phone already registered' });

        const hash = await bcrypt.hash(password, 12);
        const count = await db.execute({ sql: 'SELECT COUNT(*) as c FROM users' });
        const publicId = `CU#${String(count.rows[0].c + 1).padStart(4, '0')}`;

        await db.execute({
            sql: `INSERT INTO users (public_id, name, phone, password_hash, city) 
                  VALUES (?, ?, ?, ?, ?)`,
            args: [publicId, name, phone, hash, city || null]
        });

        res.json({ success: true, message: 'Registration successful' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Buyer Login
router.post('/buyer/login', async (req, res) => {
    try {
        const phone = normalizePhone(req.body.phone);
        const { password } = req.body;
        if (!/^09\d{7,13}$/.test(phone) || !password || password.length > 128) return res.status(400).json({ error: 'Invalid credentials' });
        const user = await db.execute({
            sql: 'SELECT * FROM users WHERE phone = ? AND account_status = "active"',
            args: [phone]
        });
        if (user.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

        const valid = await bcrypt.compare(password, user.rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign(
            { id: user.rows[0].user_id, role: 'buyer', public_id: user.rows[0].public_id },
            config.JWT_SECRET,
            { expiresIn: config.JWT_EXPIRES_IN }
        );

        res.json({ token, user: { ...user.rows[0], password_hash: undefined } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Seller/Agent Login (Dedicated URLs use same endpoint with role check)
router.post('/seller/login', async (req, res) => {
    try {
        const phone = normalizePhone(req.body.phone);
        const { password, role } = req.body;
        if (!sellerRoles.has(role) || !/^09\d{7,13}$/.test(phone) || !password || password.length > 128) return res.status(400).json({ error: 'Invalid credentials' });
        const seller = await db.execute({
            sql: 'SELECT * FROM sellers WHERE phone = ? AND role = ?',
            args: [phone, role]
        });
        if (seller.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

        const valid = await bcrypt.compare(password, seller.rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign(
            { id: seller.rows[0].seller_id, role: seller.rows[0].role, public_id: seller.rows[0].public_id },
            config.JWT_SECRET,
            { expiresIn: config.JWT_EXPIRES_IN }
        );

        res.json({ token, user: { ...seller.rows[0], password_hash: undefined } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get current user
router.get('/me', authenticate, async (req, res) => {
    res.json({ user: req.user });
});

module.exports = router;
