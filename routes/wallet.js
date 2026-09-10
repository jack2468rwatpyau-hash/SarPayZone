const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

// Get wallet info
router.get('/', authenticate, async (req, res) => {
    try {
        const isBuyer = req.user.role === 'buyer';
        const table = isBuyer ? 'users' : 'sellers';
        const idField = isBuyer ? 'user_id' : 'seller_id';
        const id = req.user[idField];

        const user = await db.execute({
            sql: `SELECT wallet_balance${isBuyer ? ', resell_balance' : ''} FROM ${table} WHERE ${idField} = ?`,
            args: [id]
        });

        const transactions = await db.execute({
            sql: `SELECT * FROM transactions 
                  WHERE wallet_owner_id = ? AND wallet_owner_type = ? 
                  ORDER BY created_at DESC LIMIT 20`,
            args: [id, isBuyer ? 'user' : 'seller']
        });

        res.json({
            balance: user.rows[0].wallet_balance,
            resell_balance: isBuyer ? user.rows[0].resell_balance : undefined,
            transactions: transactions.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// P2P Transfer
router.post('/p2p', authenticate, async (req, res) => {
    try {
        const { recipient_public_id, amount, note } = req.body;
        const senderId = req.user.user_id || req.user.id;
        const senderType = req.user.role === 'buyer' ? 'user' : 'seller';

        if (amount > 150000) return res.status(400).json({ error: 'Daily P2P limit is 150,000 MMK' });

        const fee = amount * 0.03;
        const totalDeduction = amount + fee;

        // Check sender balance
        const senderTable = senderType === 'user' ? 'users' : 'sellers';
        const sender = await db.execute({
            sql: `SELECT wallet_balance FROM ${senderTable} WHERE ${senderType === 'user' ? 'user_id' : 'seller_id'} = ?`,
            args: [senderId]
        });
        if (sender.rows[0].wallet_balance < totalDeduction) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }

        // Find recipient
        const recipient = await db.execute({
            sql: 'SELECT user_id, wallet_balance FROM users WHERE public_id = ?',
            args: [recipient_public_id]
        });
        if (recipient.rows.length === 0) return res.status(404).json({ error: 'Recipient not found' });

        // Deduct sender
        await db.execute({
            sql: `UPDATE ${senderTable} SET wallet_balance = wallet_balance - ? WHERE ${senderType === 'user' ? 'user_id' : 'seller_id'} = ?`,
            args: [totalDeduction, senderId]
        });

        // Add to recipient
        await db.execute({
            sql: 'UPDATE users SET wallet_balance = wallet_balance + ? WHERE user_id = ?',
            args: [amount, recipient.rows[0].user_id]
        });

        // Record transactions
        await db.execute({
            sql: `INSERT INTO transactions (wallet_owner_type, wallet_owner_id, type, amount, fee, balance_after, reference_id) 
                  VALUES (?, ?, 'p2p', ?, ?, (SELECT wallet_balance FROM ${senderTable} WHERE ${senderType === 'user' ? 'user_id' : 'seller_id'} = ?), ?)`,
            args: [senderType, senderId, -amount, fee, senderId, note || 'P2P Transfer']
        });

        await db.execute({
            sql: `INSERT INTO transactions (wallet_owner_type, wallet_owner_id, type, amount, fee, balance_after, reference_id) 
                  VALUES ('user', ?, 'p2p', ?, 0, (SELECT wallet_balance FROM users WHERE user_id = ?), ?)`,
            args: [recipient.rows[0].user_id, amount, recipient.rows[0].user_id, note || 'P2P Receive']
        });

        res.json({ success: true, fee, total_deducted: totalDeduction });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Withdrawal (Buyers)
router.post('/withdraw', authenticate, requireRole('buyer'), async (req, res) => {
    try {
        const { amount, account_name, wallet_phone, type = 'general' } = req.body;
        const userId = req.user.user_id || req.user.id;
        
        const fee = type === 'resell' ? 0 : amount * 0.03;
        const netAmount = amount - fee;
        const balanceField = type === 'resell' ? 'resell_balance' : 'wallet_balance';

        const user = await db.execute({
            sql: `SELECT ${balanceField} FROM users WHERE user_id = ?`,
            args: [userId]
        });
        if (user.rows[0][balanceField] < amount) return res.status(400).json({ error: 'Insufficient balance' });

        await db.execute({
            sql: `UPDATE users SET ${balanceField} = ${balanceField} - ? WHERE user_id = ?`,
            args: [amount, userId]
        });

        await db.execute({
            sql: `INSERT INTO transactions (wallet_owner_type, wallet_owner_id, type, amount, fee, balance_after, reference_id) 
                  VALUES ('user', ?, 'withdrawal', ?, ?, (SELECT ${balanceField} FROM users WHERE user_id = ?), ?)`,
            args: [userId, netAmount, fee, userId, `Withdraw to ${wallet_phone}`]
        });

        res.json({ success: true, net_amount: netAmount, fee });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Search a buyer before an agent cash-in. Never reveal wallet balances here.
router.get('/agent/buyer/:public_id', authenticate, requireRole('agent'), async (req, res) => {
    try {
        const buyer = await db.execute({
            sql: 'SELECT user_id, public_id, name, phone, city, account_status FROM users WHERE public_id = ?',
            args: [req.params.public_id]
        });
        if (buyer.rows.length === 0 || buyer.rows[0].account_status !== 'active') return res.status(404).json({ error: 'Active buyer not found' });
        res.json({ buyer: buyer.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/agent/summary', authenticate, requireRole('agent'), async (req, res) => {
    try {
        const summary = await db.execute({
            sql: `SELECT COUNT(*) AS deposit_count, COALESCE(SUM(amount), 0) AS total_amount,
                         COUNT(DISTINCT buyer_id) AS unique_buyers
                  FROM agent_deposit_requests
                  WHERE agent_id = ? AND status = 'verified' AND date(created_at) = date('now')`,
            args: [req.user.seller_id]
        });
        res.json(summary.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/agent/deposits', authenticate, requireRole('agent'), async (req, res) => {
    try {
        const deposits = await db.execute({
            sql: `SELECT d.*, u.public_id AS buyer_public_id, u.name AS buyer_name
                  FROM agent_deposit_requests d JOIN users u ON d.buyer_id = u.user_id
                  WHERE d.agent_id = ? ORDER BY d.created_at DESC LIMIT 20`,
            args: [req.user.seller_id]
        });
        res.json(deposits.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Verified cash-in via Agent
router.post('/cashin', authenticate, requireRole('agent'), async (req, res) => {
    try {
        const { buyer_public_id, amount, verification_code, note } = req.body;
        const numericAmount = Number(amount);
        if (!buyer_public_id || !Number.isFinite(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({ error: 'Buyer and a positive amount are required' });
        }
        if (!verification_code || String(verification_code).trim().length < 4) {
            return res.status(400).json({ error: 'Verification code is required' });
        }
        const verificationCode = String(verification_code).trim();
        const duplicate = await db.execute({
            sql: 'SELECT deposit_id FROM agent_deposit_requests WHERE verification_code = ? LIMIT 1',
            args: [verificationCode]
        });
        if (duplicate.rows.length) return res.status(409).json({ error: 'This verification reference has already been used' });
        
        const buyer = await db.execute({
            sql: 'SELECT user_id, account_status FROM users WHERE public_id = ?',
            args: [buyer_public_id]
        });
        if (buyer.rows.length === 0 || buyer.rows[0].account_status !== 'active') return res.status(404).json({ error: 'Active buyer not found' });

        const limitConfig = await db.execute({ sql: 'SELECT config_value FROM system_config WHERE config_key = "agent_cash_in_limit"' });
        const dailyLimit = Number(limitConfig.rows[0]?.config_value || 500000);
        const daily = await db.execute({
            sql: `SELECT COALESCE(SUM(amount), 0) AS total FROM agent_deposit_requests
                  WHERE agent_id = ? AND status = 'verified' AND date(created_at) = date('now')`,
            args: [req.user.seller_id]
        });
        if (Number(daily.rows[0].total) + numericAmount > dailyLimit) {
            return res.status(400).json({ error: `Daily cash-in limit is ${dailyLimit} MMK` });
        }

        const count = await db.execute({ sql: 'SELECT COUNT(*) AS c FROM agent_deposit_requests' });
        const depositPublicId = `AGD#${String(Number(count.rows[0].c) + 1).padStart(6, '0')}`;

        await db.execute({
            sql: 'UPDATE users SET wallet_balance = wallet_balance + ? WHERE user_id = ?',
            args: [numericAmount, buyer.rows[0].user_id]
        });

        await db.execute({
            sql: `INSERT INTO agent_deposit_requests
                  (public_id, agent_id, buyer_id, amount, verification_code, status, verified_at, note)
                  VALUES (?, ?, ?, ?, ?, 'verified', datetime('now'), ?)`,
            args: [depositPublicId, req.user.seller_id, buyer.rows[0].user_id, numericAmount, verificationCode, note || null]
        });

        await db.execute({
            sql: `INSERT INTO transactions (wallet_owner_type, wallet_owner_id, type, amount, fee, balance_after, reference_id) 
                  VALUES ('user', ?, 'cash_in', ?, 0, (SELECT wallet_balance FROM users WHERE user_id = ?), ?)`,
            args: [buyer.rows[0].user_id, numericAmount, buyer.rows[0].user_id, depositPublicId]
        });

        res.json({ success: true, deposit_id: depositPublicId, buyer_public_id, amount: numericAmount, status: 'verified' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Seller Withdrawal Request
router.post('/seller/withdraw', authenticate, requireRole('publisher', 'bookstore', 'commission_store'), async (req, res) => {
    try {
        const { amount, account_name, account_number, bank_name } = req.body;
        const sellerId = req.user.seller_id;

        const seller = await db.execute({
            sql: 'SELECT wallet_balance FROM sellers WHERE seller_id = ?',
            args: [sellerId]
        });
        if (seller.rows[0].wallet_balance < amount) return res.status(400).json({ error: 'Insufficient balance' });

        await db.execute({
            sql: 'UPDATE sellers SET wallet_balance = wallet_balance - ? WHERE seller_id = ?',
            args: [amount, sellerId]
        });

        await db.execute({
            sql: `INSERT INTO transactions (wallet_owner_type, wallet_owner_id, type, amount, fee, balance_after, reference_id) 
                  VALUES ('seller', ?, 'withdrawal', ?, 0, (SELECT wallet_balance FROM sellers WHERE seller_id = ?), ?)`,
            args: [sellerId, amount, sellerId, `Bank: ${bank_name} - ${account_number}`]
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Pay outstanding monthly commission (Seller)
router.post('/seller/pay-commission', authenticate, requireRole('publisher', 'bookstore', 'commission_store'), async (req, res) => {
    try {
        const sellerId = req.user.seller_id;
        const seller = await db.execute({
            sql: 'SELECT wallet_balance, monthly_commission_due FROM sellers WHERE seller_id = ?',
            args: [sellerId]
        });
        if (seller.rows.length === 0) return res.status(404).json({ error: 'Seller not found' });

        const due = Number(seller.rows[0].monthly_commission_due || 0);
        if (due <= 0) return res.json({ success: true, paid: 0 });
        if (Number(seller.rows[0].wallet_balance || 0) < due) {
            return res.status(400).json({ error: 'Insufficient wallet balance' });
        }

        await db.execute({
            sql: 'UPDATE sellers SET wallet_balance = wallet_balance - ?, monthly_commission_due = 0 WHERE seller_id = ?',
            args: [due, sellerId]
        });
        await db.execute({
            sql: `INSERT INTO transactions (wallet_owner_type, wallet_owner_id, type, amount, fee, balance_after, reference_id)
                  VALUES ('seller', ?, 'commission_paid', ?, 0,
                          (SELECT wallet_balance FROM sellers WHERE seller_id = ?), ?)`,
            args: [sellerId, -due, sellerId, `Commission payment ${new Date().toISOString()}`]
        });

        res.json({ success: true, paid: due });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
