const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

// Get shipping rates for seller
router.get('/', authenticate, requireRole('publisher', 'bookstore', 'commission_store'), async (req, res) => {
    try {
        const rates = await db.execute({
            sql: 'SELECT * FROM shipping_rates WHERE seller_id = ? ORDER BY state, city, township',
            args: [req.user.seller_id]
        });
        res.json(rates.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update/Create shipping rate
router.post('/', authenticate, requireRole('publisher', 'bookstore', 'commission_store'), async (req, res) => {
    try {
        const { state, city, township, is_no_shipping, is_cod_allowed, is_prepay_allowed, prepay_shipping_fee } = req.body;
        
        const existing = await db.execute({
            sql: 'SELECT rate_id FROM shipping_rates WHERE seller_id = ? AND state = ? AND city = ? AND township = ?',
            args: [req.user.seller_id, state, city, township]
        });

        if (existing.rows.length > 0) {
            await db.execute({
                sql: `UPDATE shipping_rates 
                      SET is_no_shipping = ?, is_cod_allowed = ?, is_prepay_allowed = ?, prepay_shipping_fee = ? 
                      WHERE rate_id = ?`,
                args: [is_no_shipping, is_cod_allowed, is_prepay_allowed, prepay_shipping_fee || 5000, existing.rows[0].rate_id]
            });
        } else {
            await db.execute({
                sql: `INSERT INTO shipping_rates (seller_id, state, city, township, is_no_shipping, is_cod_allowed, is_prepay_allowed, prepay_shipping_fee) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [req.user.seller_id, state, city, township, is_no_shipping, is_cod_allowed, is_prepay_allowed, prepay_shipping_fee || 5000]
            });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Bulk update
router.post('/bulk', authenticate, requireRole('publisher', 'bookstore', 'commission_store'), async (req, res) => {
    try {
        const { townships, updates } = req.body; // townships = [{state, city, township}]
        
        for (const t of townships) {
            const existing = await db.execute({
                sql: 'SELECT rate_id FROM shipping_rates WHERE seller_id = ? AND state = ? AND city = ? AND township = ?',
                args: [req.user.seller_id, t.state, t.city, t.township]
            });
            
            if (existing.rows.length > 0) {
                await db.execute({
                    sql: `UPDATE shipping_rates 
                          SET is_no_shipping = ?, is_cod_allowed = ?, is_prepay_allowed = ?, prepay_shipping_fee = ? 
                          WHERE rate_id = ?`,
                    args: [updates.is_no_shipping, updates.is_cod_allowed, updates.is_prepay_allowed, updates.prepay_shipping_fee, existing.rows[0].rate_id]
                });
            } else {
                await db.execute({
                    sql: `INSERT INTO shipping_rates (seller_id, state, city, township, is_no_shipping, is_cod_allowed, is_prepay_allowed, prepay_shipping_fee) 
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    args: [req.user.seller_id, t.state, t.city, t.township, updates.is_no_shipping, updates.is_cod_allowed, updates.is_prepay_allowed, updates.prepay_shipping_fee]
                });
            }
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

