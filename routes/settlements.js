const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

const sellerRoles = requireRole('publisher', 'bookstore', 'commission_store');
const adminOnly = requireRole('admin');
const money = (value) => Math.round(Number(value || 0) * 100) / 100;

// The first month is due on the first day of the following month. Late fees are progressive by ten-day bands.
function lateFeeForDays(daysLate) {
    const days = Math.max(0, Math.floor(Number(daysLate || 0)));
    if (!days) return 0;
    let total = 0;
    let remaining = days;
    let daily = 500;
    while (remaining > 0) {
        const bandDays = Math.min(10, remaining);
        total += bandDays * daily;
        remaining -= bandDays;
        daily *= 2;
    }
    return money(total);
}

const monthlySql = `SELECT m.monthly_id, m.seller_id, m.period_start, m.period_end, m.commission_amount,
    m.due_date, m.status, m.payment_method, m.payment_submission_id, m.paid_at,
    s.store_name, s.name AS seller_name, s.public_id AS seller_public_id, s.logo AS seller_logo,
    CAST(MAX(0, julianday('now') - julianday(m.due_date)) AS INTEGER) AS days_late
    FROM monthly_cod_commissions m JOIN sellers s ON s.seller_id = m.seller_id`;

function decorate(row) {
    const daysLate = Number(row.days_late || 0);
    const lateFee = lateFeeForDays(daysLate);
    return { ...row, days_late: daysLate, late_fee: lateFee, total_due: money(Number(row.commission_amount || 0) + lateFee) };
}

router.get('/seller/cod', authenticate, sellerRoles, async (req, res) => {
    try {
        const rows = await db.execute({ sql: `${monthlySql} WHERE m.seller_id = ? AND m.status IN ('unpaid', 'rejected', 'submitted') ORDER BY m.due_date`, args: [req.user.seller_id] });
        const items = rows.rows.map(decorate);
        const submissions = await db.execute({ sql: `SELECT * FROM monthly_cod_payment_submissions WHERE seller_id = ? ORDER BY submitted_at DESC LIMIT 20`, args: [req.user.seller_id] });
        const dueItems = items.filter(item => item.status !== 'submitted');
        res.json({ due: money(dueItems.reduce((sum, row) => sum + row.total_due, 0)), late_fee: money(dueItems.reduce((sum, row) => sum + row.late_fee, 0)), items, submissions: submissions.rows, payment_model: 'monthly' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/seller/payment-accounts', authenticate, sellerRoles, async (_req, res) => {
    try {
        const result = await db.execute({ sql: `SELECT config_value FROM system_config WHERE config_key = 'cod_payment_accounts'` });
        res.json(JSON.parse(result.rows[0]?.config_value || '{}'));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Seller may pay the full monthly balance through an Admin-configured external wallet or the platform wallet.
router.post('/seller/cod/submit', authenticate, sellerRoles, async (req, res) => {
    try {
        const { amount, payment_method, wallet_provider, reference, proof_url, note } = req.body;
        const sellerId = req.user.seller_id;
        const rows = await db.execute({ sql: `${monthlySql} WHERE m.seller_id = ? AND m.status IN ('unpaid', 'rejected')`, args: [sellerId] });
        const items = rows.rows.map(decorate);
        const totalDue = money(items.reduce((sum, row) => sum + row.total_due, 0));
        if (totalDue <= 0) return res.status(400).json({ error: 'No Monthly COD Commission is due' });
        if (Math.abs(Number(amount) - totalDue) > 0.01) return res.status(400).json({ error: `Payment amount must be exactly ${totalDue} Ks` });
        if (!['external_wallet', 'platform_wallet'].includes(payment_method)) return res.status(400).json({ error: 'Choose External Wallet or Platform Wallet' });

        if (payment_method === 'platform_wallet') {
            if (Number((await db.execute({ sql: `SELECT wallet_balance FROM sellers WHERE seller_id = ?`, args: [sellerId] })).rows[0]?.wallet_balance || 0) < totalDue) return res.status(400).json({ error: 'Insufficient Platform Wallet balance' });
            await db.execute({ sql: `UPDATE sellers SET wallet_balance = wallet_balance - ? WHERE seller_id = ? AND wallet_balance >= ?`, args: [totalDue, sellerId, totalDue] });
            await db.execute({ sql: `UPDATE monthly_cod_commissions SET status = 'paid', payment_method = 'platform_wallet', paid_at = datetime('now'), updated_at = datetime('now') WHERE seller_id = ? AND status IN ('unpaid', 'rejected')`, args: [sellerId] });
            await db.execute({ sql: `INSERT INTO transactions (wallet_owner_type, wallet_owner_id, type, amount, fee, balance_after, reference_id) VALUES ('seller', ?, 'commission_paid', ?, 0, (SELECT wallet_balance FROM sellers WHERE seller_id = ?), ?)`, args: [sellerId, -totalDue, sellerId, `Monthly COD Commission ${new Date().toISOString()}`] });
            return res.json({ success: true, amount: totalDue, payment_method });
        }

        if (!['kpay', 'wavepay', 'ayapay'].includes(wallet_provider) || !String(reference || '').trim()) return res.status(400).json({ error: 'External wallet provider and transfer reference are required' });
        const first = items[0];
        const submission = await db.execute({ sql: `INSERT INTO monthly_cod_payment_submissions (seller_id, monthly_id, amount, payment_method, wallet_provider, reference, proof_url, note) VALUES (?, ?, ?, 'external_wallet', ?, ?, ?, ?)`, args: [sellerId, first.monthly_id, totalDue, wallet_provider, String(reference).trim(), proof_url || null, note || null] });
        await db.execute({ sql: `UPDATE monthly_cod_commissions SET status = 'submitted', payment_method = 'external_wallet', payment_submission_id = ?, updated_at = datetime('now') WHERE seller_id = ? AND status IN ('unpaid', 'rejected')`, args: [submission.lastInsertRowid, sellerId] });
        res.json({ success: true, submission_id: submission.lastInsertRowid, amount: totalDue, payment_method });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/cod', authenticate, adminOnly, async (_req, res) => {
    try {
        const submissions = await db.execute({ sql: `SELECT p.*, s.store_name, s.public_id AS seller_public_id FROM monthly_cod_payment_submissions p JOIN sellers s ON s.seller_id = p.seller_id ORDER BY CASE WHEN p.status = 'pending' THEN 0 ELSE 1 END, p.submitted_at DESC` });
        const due = await db.execute({ sql: `${monthlySql} WHERE m.status IN ('unpaid', 'rejected') ORDER BY m.due_date` });
        res.json({ submissions: submissions.rows, due: due.rows.map(decorate), payment_model: 'monthly' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/admin/cod/:submissionId', authenticate, adminOnly, async (req, res) => {
    try {
        const { status, admin_note } = req.body;
        if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Status must be approved or rejected' });
        const submission = await db.execute({ sql: `SELECT * FROM monthly_cod_payment_submissions WHERE submission_id = ?`, args: [req.params.submissionId] });
        if (!submission.rows.length) return res.status(404).json({ error: 'Monthly COD payment submission not found' });
        const row = submission.rows[0];
        if (row.status !== 'pending') return res.status(409).json({ error: 'This submission has already been reviewed' });
        await db.execute({ sql: `UPDATE monthly_cod_payment_submissions SET status = ?, admin_note = ?, verified_at = datetime('now') WHERE submission_id = ?`, args: [status, admin_note || null, req.params.submissionId] });
        await db.execute({ sql: `UPDATE monthly_cod_commissions SET status = ?, paid_at = CASE WHEN ? = 'approved' THEN datetime('now') ELSE NULL END, updated_at = datetime('now') WHERE payment_submission_id = ?`, args: [status === 'approved' ? 'paid' : 'rejected', status, req.params.submissionId] });
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
