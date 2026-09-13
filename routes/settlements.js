const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

const sellerRoles = requireRole('publisher', 'bookstore', 'commission_store');
const adminOnly = requireRole('admin');
const money = (value) => Math.round(Number(value || 0) * 100) / 100;

const payableSql = `SELECT p.payable_id, p.order_id, p.commission_amount, p.due_date, p.status,
    o.order_number, o.total_amount, o.shipping_fee,
    CASE WHEN datetime('now') > p.due_date
         THEN CAST((julianday('now') - julianday(p.due_date)) AS INTEGER) * 500 ELSE 0 END AS late_fee
    FROM cod_payables p JOIN orders o ON o.order_id = p.order_id`;

router.get('/seller/cod', authenticate, sellerRoles, async (req, res) => {
    try {
        const rows = await db.execute({ sql: `${payableSql} WHERE p.seller_id = ? AND p.status IN ('unpaid', 'rejected') ORDER BY p.due_date`, args: [req.user.seller_id] });
        const pending = rows.rows.map((row) => ({ ...row, total_due: money(Number(row.commission_amount) + Number(row.late_fee)) }));
        const submissions = await db.execute({ sql: `SELECT * FROM cod_payment_submissions WHERE seller_id = ? ORDER BY submitted_at DESC LIMIT 20`, args: [req.user.seller_id] });
        const due = money(pending.reduce((sum, row) => sum + row.total_due, 0));
        res.json({ due, late_fee: money(pending.reduce((sum, row) => sum + Number(row.late_fee || 0), 0)), items: pending, submissions: submissions.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/seller/payment-accounts', authenticate, sellerRoles, async (_req, res) => {
    try {
        const result = await db.execute({ sql: `SELECT config_value FROM system_config WHERE config_key = 'cod_payment_accounts'` });
        res.json(JSON.parse(result.rows[0]?.config_value || '{}'));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/seller/cod/submit', authenticate, sellerRoles, async (req, res) => {
    try {
        const { amount, payment_method, reference, proof_url, note } = req.body;
        if (!['kpay', 'wavepay', 'ayapay'].includes(payment_method) || !reference) return res.status(400).json({ error: 'Payment method and reference are required' });
        const rows = await db.execute({ sql: `${payableSql} WHERE p.seller_id = ? AND p.status IN ('unpaid', 'rejected')`, args: [req.user.seller_id] });
        const totalDue = money(rows.rows.reduce((sum, row) => sum + Number(row.commission_amount) + Number(row.late_fee || 0), 0));
        if (totalDue <= 0) return res.status(400).json({ error: 'No COD commission is due' });
        if (Math.abs(Number(amount) - totalDue) > 0.01) return res.status(400).json({ error: `Payment amount must be exactly ${totalDue} Ks` });
        const submission = await db.execute({ sql: `INSERT INTO cod_payment_submissions (seller_id, amount, payment_method, reference, proof_url, note) VALUES (?, ?, ?, ?, ?, ?)`, args: [req.user.seller_id, totalDue, payment_method, String(reference).trim(), proof_url || null, note || null] });
        await db.execute({ sql: `UPDATE cod_payables SET status = 'submitted', payment_submission_id = ? WHERE seller_id = ? AND status IN ('unpaid', 'rejected')`, args: [submission.lastInsertRowid, req.user.seller_id] });
        res.json({ success: true, submission_id: submission.lastInsertRowid, amount: totalDue });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/cod', authenticate, adminOnly, async (req, res) => {
    try {
        const submissions = await db.execute({ sql: `SELECT s.*, x.store_name, x.public_id AS seller_public_id FROM cod_payment_submissions s JOIN sellers x ON x.seller_id = s.seller_id ORDER BY CASE WHEN s.status = 'pending' THEN 0 ELSE 1 END, s.submitted_at DESC` });
        const due = await db.execute({ sql: `${payableSql} WHERE p.status IN ('unpaid', 'rejected') ORDER BY p.due_date` });
        res.json({ submissions: submissions.rows, due: due.rows.map((row) => ({ ...row, total_due: money(Number(row.commission_amount) + Number(row.late_fee || 0)) })) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/admin/cod/:submissionId', authenticate, adminOnly, async (req, res) => {
    try {
        const { status, admin_note } = req.body;
        if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Status must be approved or rejected' });
        const submission = await db.execute({ sql: `SELECT * FROM cod_payment_submissions WHERE submission_id = ?`, args: [req.params.submissionId] });
        if (!submission.rows.length) return res.status(404).json({ error: 'Submission not found' });
        const row = submission.rows[0];
        if (row.status !== 'pending') return res.status(409).json({ error: 'This submission has already been reviewed' });
        await db.execute({ sql: `UPDATE cod_payment_submissions SET status = ?, admin_note = ?, verified_at = datetime('now') WHERE submission_id = ?`, args: [status, admin_note || null, req.params.submissionId] });
        await db.execute({ sql: `UPDATE cod_payables SET status = ?, paid_at = CASE WHEN ? = 'approved' THEN datetime('now') ELSE NULL END WHERE payment_submission_id = ?`, args: [status === 'approved' ? 'paid' : 'rejected', status, req.params.submissionId] });
        res.json({ success: true, status });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/payment-accounts', authenticate, adminOnly, async (_req, res) => {
    try {
        const result = await db.execute({ sql: `SELECT config_value FROM system_config WHERE config_key = 'cod_payment_accounts'` });
        res.json(JSON.parse(result.rows[0]?.config_value || '{}'));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/admin/payment-accounts', authenticate, adminOnly, async (req, res) => {
    try {
        const accounts = {};
        for (const key of ['kpay', 'wavepay', 'ayapay']) accounts[key] = { name: String(req.body[key]?.name || '').trim(), phone: String(req.body[key]?.phone || '').trim() };
        await db.execute({ sql: `INSERT INTO system_config (config_key, config_value) VALUES ('cod_payment_accounts', ?) ON CONFLICT(config_key) DO UPDATE SET config_value = excluded.config_value, updated_at = datetime('now')`, args: [JSON.stringify(accounts)] });
        res.json({ success: true, accounts });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
