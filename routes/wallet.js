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

// Cash-in via Agent
router.post('/cashin', authenticate, requireRole('agent'), async (req, res) => {
    try {
        const { buyer_public_id, amount } = req.body;
        
        const buyer = await db.execute({
            sql: 'SELECT user_id FROM users WHERE public_id = ?',
            args: [buyer_public_id]
        });
        if (buyer.rows.length === 0) return res.status(404).json({ error: 'Buyer not found' });

        await db.execute({
            sql: 'UPDATE users SET wallet_balance = wallet_balance + ? WHERE user_id = ?',
            args: [amount, buyer.rows[0].user_id]
        });

        await db.execute({
            sql: `INSERT INTO transactions (wallet_owner_type, wallet_owner_id, type, amount, fee, balance_after, reference_id) 
                  VALUES ('user', ?, 'cash_in', ?, 0, (SELECT wallet_balance FROM users WHERE user_id = ?), ?)`,
            args: [buyer.rows[0].user_id, amount, buyer.rows[0].user_id, `Agent: ${req.user.public_id}`]
        });

        res.json({ success: true });
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

module.exports = router;

