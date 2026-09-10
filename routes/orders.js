const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const { calculateCommission } = require('../utils/commission');
const { sendInstantOrder } = require('../utils/telegram');
const { sendPushNotification } = require('../utils/webpush');

// Create order
router.post('/', authenticate, async (req, res) => {
    try {
        const { product_id, variation_id, quantity, shipping_address, payment_method, p2p_friend_id } = req.body;
        
        const product = await db.execute({
            sql: 'SELECT p.*, s.role, s.telegram_user_id, s.seller_id FROM products p JOIN sellers s ON p.seller_id = s.seller_id WHERE p.book_id = ?',
            args: [product_id]
        });
        if (product.rows.length === 0) return res.status(404).json({ error: 'Product not found' });

        const prod = product.rows[0];
        const unitPrice = prod.discounted_price || prod.original_price;
        const total = unitPrice * quantity;

        // Get shipping fee
        let shippingFee = 5000;
        const shippingRate = await db.execute({
            sql: `SELECT prepay_shipping_fee FROM shipping_rates 
                  WHERE seller_id = ? AND is_no_shipping = 0 LIMIT 1`,
            args: [prod.seller_id]
        });
        if (shippingRate.rows.length > 0) shippingFee = shippingRate.rows[0].prepay_shipping_fee;

        const commissionRate = calculateCommission(prod.role, total);
        const commission = total * commissionRate;
        const finalTotal = total + shippingFee;

        // Check wallet balance
        if (payment_method === 'wallet') {
            const buyer = await db.execute({
                sql: 'SELECT wallet_balance FROM users WHERE user_id = ?',
                args: [req.user.user_id || req.user.id]
            });
            if (buyer.rows[0].wallet_balance < finalTotal) {
                return res.status(400).json({ error: 'Insufficient wallet balance' });
            }
        }

        const orderCount = await db.execute({ sql: 'SELECT COUNT(*) as c FROM orders' });
        const orderNumber = `SPZ-${Date.now()}-${String(orderCount.rows[0].c + 1).padStart(4, '0')}`;

        const result = await db.execute({
            sql: `INSERT INTO orders (order_number, buyer_id, seller_id, product_id, variation_id, quantity, 
                  total_amount, shipping_fee, commission_amount, payment_method, payment_status, shipping_address, p2p_friend_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [orderNumber, req.user.user_id || req.user.id, prod.seller_id, product_id, variation_id, quantity, 
                   total, shippingFee, commission, payment_method, payment_method === 'wallet' ? 'paid' : 'pending', shipping_address, p2p_friend_id || null]
        });

        // Deduct wallet if wallet payment
        if (payment_method === 'wallet') {
            await db.execute({
                sql: 'UPDATE users SET wallet_balance = wallet_balance - ? WHERE user_id = ?',
                args: [finalTotal, req.user.user_id || req.user.id]
            });
            await db.execute({
                sql: `INSERT INTO transactions (wallet_owner_type, wallet_owner_id, type, amount, fee, balance_after, reference_id) 
                      VALUES ('user', ?, 'purchase', ?, 0, (SELECT wallet_balance FROM users WHERE user_id = ?), ?)`,
                args: [req.user.user_id || req.user.id, finalTotal, req.user.user_id || req.user.id, orderNumber]
            });
        }

        // Send Telegram notification
        await sendInstantOrder(prod.telegram_user_id, {
            order_number: orderNumber,
            product_name: prod.title,
            total_amount: finalTotal,
            quantity,
            buyer_name: req.user.name,
            shipping_address
        });

        // Push notification
        await sendPushNotification(prod.seller_id, 'seller', {
            title: 'New Order Received',
            body: `Order ${orderNumber} - ${prod.title}`,
            data: { order_id: result.lastInsertRowid }
        });

        res.json({ success: true, order_id: result.lastInsertRowid, order_number: orderNumber });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create a cart checkout with one shipping charge per shop
router.post('/bulk', authenticate, async (req, res) => {
    try {
        const { items, shipping_address, payment_method = 'wallet', p2p_friend_id } = req.body;
        const buyerId = req.user.user_id || req.user.id;
        if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Cart is empty' });
        if (!['wallet', 'cod', 'agent'].includes(payment_method)) return res.status(400).json({ error: 'Invalid payment method' });
        if (!shipping_address) return res.status(400).json({ error: 'Shipping address is required' });

        const prepared = [];
        const shippingBySeller = new Map();
        let merchandiseTotal = 0;

        for (const item of items) {
            const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
            const product = await db.execute({
                sql: `SELECT p.*, s.role, s.telegram_user_id, s.seller_id
                      FROM products p JOIN sellers s ON p.seller_id = s.seller_id
                      WHERE p.book_id = ? AND p.is_active = 1 AND p.approved = 1`,
                args: [item.product_id]
            });
            if (product.rows.length === 0) return res.status(404).json({ error: `Product ${item.product_id} not found` });
            const prod = product.rows[0];
            const unitPrice = Number(prod.discounted_price || prod.original_price);
            const subtotal = unitPrice * quantity;
            const rate = await db.execute({
                sql: `SELECT is_no_shipping, prepay_shipping_fee FROM shipping_rates
                      WHERE seller_id = ? LIMIT 1`,
                args: [prod.seller_id]
            });
            const sellerShipping = rate.rows[0]?.is_no_shipping ? 0 : Number(rate.rows[0]?.prepay_shipping_fee || 5000);
            if (!shippingBySeller.has(prod.seller_id)) shippingBySeller.set(prod.seller_id, sellerShipping);
            merchandiseTotal += subtotal;
            prepared.push({ item, prod, quantity, subtotal, commission: subtotal * calculateCommission(prod.role, subtotal) });
        }

        const shippingTotal = [...shippingBySeller.values()].reduce((sum, fee) => sum + fee, 0);
        const finalTotal = merchandiseTotal + shippingTotal;
        if (payment_method === 'wallet') {
            const buyer = await db.execute({ sql: 'SELECT wallet_balance FROM users WHERE user_id = ?', args: [buyerId] });
            if (Number(buyer.rows[0]?.wallet_balance || 0) < finalTotal) return res.status(400).json({ error: 'Insufficient wallet balance' });
        }

        const orderIds = [];
        const chargedSellers = new Set();
        for (const entry of prepared) {
            const { item, prod, quantity, subtotal, commission } = entry;
            const shippingFee = chargedSellers.has(prod.seller_id) ? 0 : shippingBySeller.get(prod.seller_id);
            chargedSellers.add(prod.seller_id);
            const orderCount = await db.execute({ sql: 'SELECT COUNT(*) as c FROM orders' });
            const orderNumber = `SPZ-${Date.now()}-${String(Number(orderCount.rows[0].c) + orderIds.length + 1).padStart(4, '0')}`;
            const result = await db.execute({
                sql: `INSERT INTO orders (order_number, buyer_id, seller_id, product_id, variation_id, quantity,
                      total_amount, shipping_fee, commission_amount, payment_method, payment_status, shipping_address, p2p_friend_id)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [orderNumber, buyerId, prod.seller_id, item.product_id, item.variation_id || null, quantity,
                    subtotal, shippingFee, commission, payment_method, payment_method === 'wallet' ? 'paid' : 'pending', shipping_address, p2p_friend_id || null]
            });
            orderIds.push(result.lastInsertRowid);
            await sendInstantOrder(prod.telegram_user_id, {
                order_number: orderNumber, product_name: prod.title,
                total_amount: subtotal + shippingFee, quantity,
                buyer_name: req.user.name, shipping_address
            });
        }

        if (payment_method === 'wallet') {
            await db.execute({ sql: 'UPDATE users SET wallet_balance = wallet_balance - ? WHERE user_id = ?', args: [finalTotal, buyerId] });
            await db.execute({
                sql: `INSERT INTO transactions (wallet_owner_type, wallet_owner_id, type, amount, fee, balance_after, reference_id)
                      VALUES ('user', ?, 'purchase', ?, 0, (SELECT wallet_balance FROM users WHERE user_id = ?), ?)`,
                args: [buyerId, -finalTotal, buyerId, orderIds.join(',')]
            });
        }

        res.json({ success: true, order_ids: orderIds, merchandise_total: merchandiseTotal, shipping_total: shippingTotal, total: finalTotal });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get orders (Buyer)
router.get('/buyer', authenticate, async (req, res) => {
    try {
        const orders = await db.execute({
            sql: `SELECT o.*, p.title, p.images, s.store_name 
                  FROM orders o 
                  JOIN products p ON o.product_id = p.book_id 
                  JOIN sellers s ON o.seller_id = s.seller_id 
                  WHERE o.buyer_id = ? ORDER BY o.created_at DESC LIMIT 100`,
            args: [req.user.user_id || req.user.id]
        });
        res.json(orders.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get orders (Seller)
router.get('/seller', authenticate, requireRole('publisher', 'bookstore', 'commission_store'), async (req, res) => {
    try {
        const { status, date_from, date_to } = req.query;
        let sql = `SELECT o.*, p.title, u.name as buyer_name, u.phone as buyer_phone 
                   FROM orders o 
                   JOIN products p ON o.product_id = p.book_id 
                   JOIN users u ON o.buyer_id = u.user_id 
                   WHERE o.seller_id = ?`;
        const args = [req.user.seller_id];

        if (status) {
            sql += ' AND o.order_status = ?';
            args.push(status);
        }
        if (date_from && date_to) {
            sql += ' AND date(o.created_at) BETWEEN ? AND ?';
            args.push(date_from, date_to);
        }

        sql += ' ORDER BY o.created_at DESC LIMIT 100';
        const orders = await db.execute({ sql, args });
        res.json(orders.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update order status
router.patch('/:id/status', authenticate, async (req, res) => {
    try {
        const { status } = req.body;
        const order = await db.execute({
            sql: 'SELECT * FROM orders WHERE order_id = ?',
            args: [req.params.id]
        });
        if (order.rows.length === 0) return res.status(404).json({ error: 'Order not found' });

        const ord = order.rows[0];

        // Seller can update to approved/shipping/delivered
        if (req.user.role !== 'buyer' && ord.seller_id === req.user.seller_id) {
            await db.execute({
                sql: 'UPDATE orders SET order_status = ?, updated_at = datetime("now") WHERE order_id = ?',
                args: [status, req.params.id]
            });

            // On delivery, transfer to seller wallet minus commission
            if (status === 'delivered' && ord.payment_status === 'paid') {
                const sellerAmount = ord.total_amount - ord.commission_amount;
                await db.execute({
                    sql: 'UPDATE sellers SET wallet_balance = wallet_balance + ? WHERE seller_id = ?',
                    args: [sellerAmount, ord.seller_id]
                });
                await db.execute({
                    sql: `INSERT INTO transactions (wallet_owner_type, wallet_owner_id, type, amount, fee, balance_after, reference_id) 
                          VALUES ('seller', ?, 'purchase', ?, ?, (SELECT wallet_balance FROM sellers WHERE seller_id = ?), ?)`,
                    args: [ord.seller_id, sellerAmount, ord.commission_amount, ord.seller_id, ord.order_number]
                });
            }
        }

        // Buyer can cancel within 30 minutes
        if (status === 'cancelled' && req.user.role === 'buyer' && ord.buyer_id === req.user.user_id) {
            const created = new Date(ord.created_at);
            const now = new Date();
            const diffMins = (now - created) / 60000;

            if (diffMins > 30) return res.status(400).json({ error: 'Cancellation window expired (30 mins)' });

            const refundFee = ord.total_amount * 0.02;
            const refundAmount = ord.total_amount - refundFee;

            await db.execute({
                sql: 'UPDATE orders SET order_status = "cancelled", payment_status = "refunded" WHERE order_id = ?',
                args: [req.params.id]
            });

            if (ord.payment_method === 'wallet') {
                await db.execute({
                    sql: 'UPDATE users SET wallet_balance = wallet_balance + ? WHERE user_id = ?',
                    args: [refundAmount, ord.buyer_id]
                });
                await db.execute({
                    sql: `INSERT INTO transactions (wallet_owner_type, wallet_owner_id, type, amount, fee, balance_after, reference_id) 
                          VALUES ('user', ?, 'refund', ?, ?, (SELECT wallet_balance FROM users WHERE user_id = ?), ?)`,
                    args: [ord.buyer_id, refundAmount, refundFee, ord.buyer_id, ord.order_number]
                });
            }
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create review (only after delivered)
router.post('/:id/review', authenticate, async (req, res) => {
    try {
        const { rating, comment } = req.body;
        const order = await db.execute({
            sql: 'SELECT * FROM orders WHERE order_id = ? AND buyer_id = ? AND order_status = "delivered"',
            args: [req.params.id, req.user.user_id || req.user.id]
        });
        if (order.rows.length === 0) return res.status(400).json({ error: 'Can only review delivered orders' });

        await db.execute({
            sql: 'INSERT INTO reviews (book_id, user_id, order_id, rating, comment) VALUES (?, ?, ?, ?, ?)',
            args: [order.rows[0].product_id, req.user.user_id || req.user.id, req.params.id, rating, comment]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
