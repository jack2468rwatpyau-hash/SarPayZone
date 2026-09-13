const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

// Get shipping rates for seller
router.get('/', authenticate, requireRole('publisher', 'bookstore', 'commission_store'), async (req, res) => {
    try {
        const rates = await db.execute({
            sql: `SELECT * FROM shipping_rates WHERE seller_id = ? ORDER BY state, city, township`,
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
        const { state, city, township, is_no_shipping, is_cod_allowed, is_prepay_allowed } = req.body;
        const fee = Number(req.body.prepay_shipping_fee);
        if (!String(state || '').trim() || !String(city || '').trim() || !String(township || '').trim()) return res.status(400).json({ error: 'ပြည်နယ်၊ ခရိုင်နှင့် မြို့နယ်ကို ရွေးချယ်ပါ' });
        if (!Number.isFinite(fee) || fee < 0 || fee > 1000000) return res.status(400).json({ error: 'ပို့ခကို မှန်ကန်စွာ ထည့်ပါ' });
        const noShipping = Number(is_no_shipping) === 1 ? 1 : 0;
        const codAllowed = Number(is_cod_allowed) === 1 ? 1 : 0;
        const prepayAllowed = Number(is_prepay_allowed) === 1 ? 1 : 0;
        
        const existing = await db.execute({
            sql: `SELECT rate_id FROM shipping_rates WHERE seller_id = ? AND state = ? AND city = ? AND township = ?`,
            args: [req.user.seller_id, state, city, township]
        });

        if (existing.rows.length > 0) {
            await db.execute({
                sql: `UPDATE shipping_rates 
                      SET is_no_shipping = ?, is_cod_allowed = ?, is_prepay_allowed = ?, prepay_shipping_fee = ? 
                      WHERE rate_id = ?`,
                args: [noShipping, codAllowed, prepayAllowed, fee, existing.rows[0].rate_id]
            });
        } else {
            await db.execute({
                sql: `INSERT INTO shipping_rates (seller_id, state, city, township, is_no_shipping, is_cod_allowed, is_prepay_allowed, prepay_shipping_fee) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [req.user.seller_id, state.trim(), city.trim(), township.trim(), noShipping, codAllowed, prepayAllowed, fee]
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
                sql: `SELECT rate_id FROM shipping_rates WHERE seller_id = ? AND state = ? AND city = ? AND township = ?`,
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
