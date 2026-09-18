const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const { calculateCommission } = require('../utils/commission');
const { sendInstantOrder } = require('../utils/telegram');
const { sendPushNotification } = require('../utils/webpush');
const upload = require('../middleware/upload');
const { uploadToCloudinary } = require('../utils/cloudinary');

// Create order
router.post('/', authenticate, async (req, res) => {
    try {
        const { product_id, variation_id, resell_listing_id, quantity, shipping_address, shipping_state, shipping_district, shipping_township, payment_method, p2p_friend_id } = req.body;
        const parsedQuantity = Math.max(1, parseInt(quantity, 10) || 1);
        if (!['wallet', 'cod'].includes(payment_method)) return res.status(400).json({ error: 'Payment must use wallet or COD. Agents add funds to the buyer wallet.' });
        if (resell_listing_id && payment_method !== 'wallet') {
            return res.status(400).json({ error: 'C2C listings require wallet payment' });
        }

        const product = resell_listing_id
            ? await db.execute({
                sql: `SELECT r.listing_id, r.seller_id AS resell_seller_id, r.final_price, r.asking_price, r.stock_quantity,
                             r.title, r.author_name, r.condition_images AS images, NULL AS book_id,
                             'resell' AS role, NULL AS telegram_user_id, NULL AS store_seller_id,
                             NULL AS seller_id, 1 AS store_is_open, 1 AS store_accepting_orders
                      FROM resell_listings r WHERE r.listing_id = ? AND r.status = 'approved'`,
                args: [resell_listing_id]
            })
            : await db.execute({
                sql: `SELECT p.*, s.role, s.telegram_user_id, s.seller_id AS store_seller_id,
                             s.is_open AS store_is_open, s.accepting_orders AS store_accepting_orders
                      FROM products p JOIN sellers s ON p.seller_id = s.seller_id WHERE p.book_id = ?`,
                args: [product_id]
            });
        if (product.rows.length === 0) return res.status(404).json({ error: 'Product not found' });

        const prod = product.rows[0];
        if (!Number(prod.store_is_open) || !Number(prod.store_accepting_orders)) {
            return res.status(409).json({ error: 'This store is currently closed or not accepting orders' });
        }
        const resolvedProductId = prod.book_id;
        const unitPrice = resell_listing_id ? Number(prod.final_price || prod.asking_price) : Number(prod.discounted_price || prod.original_price);
        const saleType = resell_listing_id ? 'prepaid' : (prod.sale_type || 'prepaid');
        if (!resell_listing_id && saleType === 'preorder' && prod.preorder_start_at && new Date(prod.preorder_start_at) > new Date()) return res.status(400).json({ error: 'This preorder has not started yet' });
        if (!resell_listing_id && saleType === 'preorder' && prod.preorder_end_at && new Date(prod.preorder_end_at) <= new Date()) return res.status(400).json({ error: 'This preorder period has ended' });
        if (!resell_listing_id && saleType === 'prepaid' && payment_method !== 'wallet') return res.status(400).json({ error: 'Prepaid products require Wallet payment' });
        if (!resell_listing_id && saleType === 'preorder' && payment_method !== 'wallet') return res.status(400).json({ error: 'Preorder products require Wallet payment for the deposit' });
        if (!resell_listing_id && saleType === 'cod' && payment_method !== 'cod') return res.status(400).json({ error: 'This product is available by COD only' });
        if (resell_listing_id && Number(prod.stock_quantity || 0) < parsedQuantity) return res.status(400).json({ error: 'This resell listing does not have enough stock' });
        if (!resell_listing_id && Number(prod.stock_quantity || 0) < parsedQuantity) return res.status(400).json({ error: 'Insufficient stock' });
        const total = unitPrice * parsedQuantity;

        const shippingEstimate = resell_listing_id ? 0 : (Number(prod.free_shipping) ? 0 : Number(prod.estimated_shipping_fee || 0));
        const shippingFee = 0;

        const commissionRate = resell_listing_id ? 0.08 : calculateCommission(prod.role, total);
        const commission = total * commissionRate;
        const amountDueNow = resell_listing_id ? total : saleType === 'preorder' ? Number(prod.preorder_deposit_amount || 0) : saleType === 'cod' ? Number(prod.cod_deposit_amount || 0) : total;
        if ((saleType === 'preorder' || saleType === 'cod') && amountDueNow > total) return res.status(400).json({ error: 'The required advance payment cannot exceed the book price' });
        const finalTotal = amountDueNow;

        // Check wallet balance for prepaid orders and optional COD deposits.
        if (finalTotal > 0 && (payment_method === 'wallet' || (saleType === 'cod' && amountDueNow > 0))) {
            const buyer = await db.execute({
                sql: `SELECT wallet_balance FROM users WHERE user_id = ?`,
                args: [req.user.user_id || req.user.id]
            });
            if (buyer.rows[0].wallet_balance < finalTotal) {
                return res.status(400).json({ error: 'Insufficient wallet balance' });
            }
        }

        const orderCount = await db.execute({ sql: `SELECT COUNT(*) as c FROM orders` });
        const orderNumber = `SPZ-${Date.now()}-${String(orderCount.rows[0].c + 1).padStart(4, '0')}`;

        const result = await db.execute({
            sql: `INSERT INTO orders (order_number, buyer_id, seller_id, product_id, variation_id, resell_listing_id, resell_seller_id, quantity,
                  total_amount, shipping_fee, shipping_estimate, amount_paid, commission_amount, markup_amount, payment_method, payment_status, shipping_address,
                  shipping_state, shipping_district, shipping_township, p2p_friend_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [orderNumber, req.user.user_id || req.user.id, prod.store_seller_id || null, resolvedProductId, variation_id,
                   resell_listing_id || null, resell_listing_id ? prod.resell_seller_id : null, parsedQuantity,
                   total, shippingFee, shippingEstimate, amountDueNow, commission,
                   resell_listing_id ? (unitPrice - Number(prod.asking_price || 0)) * parsedQuantity : 0,
                   payment_method, payment_method === 'wallet' ? 'paid' : 'pending', shipping_address || 'လိပ်စာ မသတ်မှတ်ရသေးပါ',
                   shipping_state || null, shipping_district || null, shipping_township || null, p2p_friend_id || null]
        });

        const orderId = Number(result.lastInsertRowid);
        if (!Number.isSafeInteger(orderId)) throw new Error('Order ID could not be generated safely');

        if (!resell_listing_id) {
            await db.execute({
                sql: `UPDATE products SET stock_quantity = stock_quantity - ? WHERE book_id = ? AND stock_quantity >= ?`,
                args: [parsedQuantity, resolvedProductId, parsedQuantity]
            });
        } else {
            const stockUpdate = await db.execute({
                sql: `UPDATE resell_listings SET stock_quantity = stock_quantity - ?, status = CASE WHEN stock_quantity - ? <= 0 THEN 'sold' ELSE 'approved' END, updated_at = datetime('now') WHERE listing_id = ? AND status = 'approved' AND stock_quantity >= ?`,
                args: [parsedQuantity, parsedQuantity, resell_listing_id, parsedQuantity]
            });
            if (!stockUpdate.rowsAffected) {
                await db.execute({ sql: `DELETE FROM orders WHERE order_id = ?`, args: [orderId] });
                return res.status(409).json({ error: 'Resell stock changed. Please try again.' });
            }
        }

        // Deduct the amount paid now; shipping and any COD balance are collected on delivery.
        if (finalTotal > 0 && (payment_method === 'wallet' || (saleType === 'cod' && amountDueNow > 0))) {
            await db.execute({
                sql: `UPDATE users SET wallet_balance = wallet_balance - ? WHERE user_id = ?`,
                args: [finalTotal, req.user.user_id || req.user.id]
            });
            await db.execute({
                sql: `INSERT INTO transactions (wallet_owner_type, wallet_owner_id, type, amount, fee, balance_after, reference_id)
                      VALUES ('user', ?, 'purchase', ?, 0, (SELECT wallet_balance FROM users WHERE user_id = ?), ?)`,
                args: [req.user.user_id || req.user.id, -finalTotal, req.user.user_id || req.user.id, orderNumber]
            });
        }

        await sendPushNotification(req.user.user_id || req.user.id, 'buyer', {
            title: 'Order placed successfully', body: `Your order ${orderNumber} has been placed.`, tag: `order-${orderId}`, url: '/index.html#orders'
        });

        // Send Telegram notification
        if (prod.telegram_user_id) await sendInstantOrder(prod.telegram_user_id, {
            order_number: orderNumber,
            product_name: prod.title,
            total_amount: finalTotal,
            quantity: parsedQuantity,
            buyer_name: req.user.name,
            shipping_address
        });

        // Push notification
        if (prod.seller_id) await sendPushNotification(prod.seller_id, 'seller', {
            title: 'New Order Received',
            body: `Order ${orderNumber} - ${prod.title}`,
            data: { order_id: orderId }
        });

        res.json({ success: true, order_id: orderId, order_number: orderNumber });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create a cart checkout with one shipping charge per shop
router.post('/bulk', authenticate, async (req, res) => {
    try {
        const { items, shipping_address, shipping_state, shipping_district, shipping_township, payment_method = 'wallet', p2p_friend_id } = req.body;
        const buyerId = req.user.user_id || req.user.id;
        if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Cart is empty' });
        if (!['wallet', 'cod'].includes(payment_method)) return res.status(400).json({ error: 'Payment must use wallet or COD. Agents add funds to the buyer wallet.' });
        if (!shipping_address || String(shipping_address).trim().length < 8) return res.status(400).json({ error: 'လက်ခံမည့်အသေးစိတ်လိပ်စာနှင့် ဆက်သွယ်ရန်ဖုန်းနံပါတ်ကို ထည့်ပါ' });

        const prepared = [];
        const shippingBySeller = new Map();
        let merchandiseTotal = 0;
        let amountDueNowTotal = 0;
        let estimatedShippingTotal = 0;
        let cartSaleType = null;

        for (const item of items) {
            const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
            const product = await db.execute({
                sql: `SELECT p.*, s.role, s.store_name, s.telegram_user_id, s.seller_id,
                             s.is_open AS store_is_open, s.accepting_orders AS store_accepting_orders
                      FROM products p JOIN sellers s ON p.seller_id = s.seller_id
                      WHERE p.book_id = ? AND p.is_active = 1 AND p.approved = 1`,
                args: [item.product_id]
            });
            if (product.rows.length === 0) return res.status(404).json({ error: `Product ${item.product_id} not found` });
            const prod = product.rows[0];
            const saleType = prod.sale_type || 'prepaid';
            if (saleType === 'preorder' && prod.preorder_start_at && new Date(prod.preorder_start_at) > new Date()) return res.status(400).json({ error: `${prod.title} preorder has not started yet` });
            if (saleType === 'preorder' && prod.preorder_end_at && new Date(prod.preorder_end_at) <= new Date()) return res.status(400).json({ error: `${prod.title} preorder period has ended` });
            if (cartSaleType && cartSaleType !== saleType) return res.status(400).json({ error: 'Cart checkout must contain products with the same sale type' });
            cartSaleType = saleType;
            if (!Number(prod.store_is_open) || !Number(prod.store_accepting_orders)) {
                return res.status(409).json({ error: `${prod.store_name || 'This store'} is currently closed or not accepting orders` });
            }
            if (Number(prod.stock_quantity || 0) < quantity) return res.status(400).json({ error: `${prod.title} has insufficient stock` });
            const unitPrice = Number(prod.discounted_price || prod.original_price);
            if (!Number.isFinite(unitPrice) || unitPrice < 0) return res.status(400).json({ error: `${prod.title} has an invalid price` });
            const subtotal = unitPrice * quantity;
            if (saleType === 'prepaid' && payment_method !== 'wallet') return res.status(400).json({ error: 'Prepaid products require Wallet payment' });
            if (saleType === 'preorder' && payment_method !== 'wallet') return res.status(400).json({ error: 'Preorder products require Wallet payment' });
            if (saleType === 'cod' && payment_method !== 'cod') return res.status(400).json({ error: 'COD products require Cash on delivery' });
            const sellerShipping = Number(prod.free_shipping) ? 0 : Number(prod.estimated_shipping_fee || 0);
            if (!Number.isFinite(sellerShipping) || sellerShipping < 0) return res.status(400).json({ error: `${prod.title} has an invalid shipping fee` });
            const amountDueNow = saleType === 'preorder' ? Number(prod.preorder_deposit_amount || 0) : saleType === 'cod' ? Number(prod.cod_deposit_amount || 0) : subtotal;
            if (amountDueNow > subtotal) return res.status(400).json({ error: `${prod.title} advance payment cannot exceed the book price` });
            if (!shippingBySeller.has(prod.seller_id)) shippingBySeller.set(prod.seller_id, sellerShipping);
            merchandiseTotal += subtotal;
            amountDueNowTotal += amountDueNow * quantity;
            estimatedShippingTotal += sellerShipping;
            prepared.push({ item, prod, quantity, subtotal, amountDueNow: amountDueNow * quantity, commission: subtotal * calculateCommission(prod.role, subtotal) });
        }

        const shippingTotal = 0;
        const finalTotal = amountDueNowTotal;
        if (finalTotal > 0 && (payment_method === 'wallet' || cartSaleType === 'cod')) {
            const buyer = await db.execute({ sql: `SELECT wallet_balance FROM users WHERE user_id = ?`, args: [buyerId] });
            if (Number(buyer.rows[0]?.wallet_balance || 0) < finalTotal) return res.status(400).json({ error: 'Insufficient wallet balance' });
        }

        const orderIds = [];
        const chargedSellers = new Set();
        for (const entry of prepared) {
            const { item, prod, quantity, subtotal, amountDueNow, commission } = entry;
            const shippingFee = chargedSellers.has(prod.seller_id) ? 0 : shippingBySeller.get(prod.seller_id);
            chargedSellers.add(prod.seller_id);
            const orderCount = await db.execute({ sql: `SELECT COUNT(*) as c FROM orders` });
            const orderNumber = `SPZ-${Date.now()}-${String(Number(orderCount.rows[0].c) + orderIds.length + 1).padStart(4, '0')}`;
            const result = await db.execute({
                sql: `INSERT INTO orders (order_number, buyer_id, seller_id, product_id, variation_id, quantity,
                      total_amount, shipping_fee, shipping_estimate, amount_paid, commission_amount, payment_method, payment_status, shipping_address,
                      shipping_state, shipping_district, shipping_township, p2p_friend_id)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
                args: [orderNumber, buyerId, prod.seller_id, item.product_id, item.variation_id || null, quantity,
                    subtotal, 0, Number(prod.free_shipping) ? 0 : Number(prod.estimated_shipping_fee || 0), amountDueNow, commission, payment_method, payment_method === 'wallet' ? 'paid' : 'pending', shipping_address,
                    shipping_state, shipping_district, shipping_township, p2p_friend_id || null]
            });
            const orderId = Number(result.lastInsertRowid);
            if (!Number.isSafeInteger(orderId)) throw new Error('Order ID could not be generated safely');
            orderIds.push(orderId);
            await db.execute({
                sql: `UPDATE products SET stock_quantity = stock_quantity - ? WHERE book_id = ? AND stock_quantity >= ?`,
                args: [quantity, item.product_id, quantity]
            });
            if (prod.telegram_user_id) await sendInstantOrder(prod.telegram_user_id, {
                order_number: orderNumber, product_name: prod.title,
                total_amount: subtotal + shippingFee, quantity,
                buyer_name: req.user.name, shipping_address
            });
            await sendPushNotification(prod.seller_id, 'seller', {
                title: 'New order received', body: `${prod.title} · ${orderNumber}`, tag: `order-${orderId}`, url: '/store-dashboard.html#orders'
            });
        }

        if (finalTotal > 0 && (payment_method === 'wallet' || cartSaleType === 'cod')) {
            await db.execute({ sql: `UPDATE users SET wallet_balance = wallet_balance - ? WHERE user_id = ?`, args: [finalTotal, buyerId] });
            await db.execute({
                sql: `INSERT INTO transactions (wallet_owner_type, wallet_owner_id, type, amount, fee, balance_after, reference_id)
                      VALUES ('user', ?, 'purchase', ?, 0, (SELECT wallet_balance FROM users WHERE user_id = ?), ?)`,
                args: [buyerId, -finalTotal, buyerId, orderIds.join(',')]
            });
        }

        await sendPushNotification(buyerId, 'buyer', {
            title: 'Orders placed successfully', body: `${orderIds.length} order(s) have been placed.`, tag: `orders-${orderIds.join('-')}`, url: '/index.html#orders'
        });
        res.json({ success: true, order_ids: orderIds, merchandise_total: merchandiseTotal, shipping_total: shippingTotal, shipping_estimate_total: estimatedShippingTotal, total: finalTotal });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get orders (Buyer)
router.get('/buyer', authenticate, async (req, res) => {
    try {
        const orders = await db.execute({
            sql: `SELECT o.*, COALESCE(p.title, r.title) AS title, COALESCE(p.images, r.condition_images) AS images, s.store_name
                  FROM orders o
                  LEFT JOIN products p ON o.product_id = p.book_id
                  LEFT JOIN resell_listings r ON o.resell_listing_id = r.listing_id
                  LEFT JOIN sellers s ON o.seller_id = s.seller_id
                  WHERE o.buyer_id = ? ORDER BY o.created_at DESC LIMIT 100`,
            args: [req.user.user_id || req.user.id]
        });
        res.json(orders.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Check whether the signed-in buyer can review a delivered purchase of a product.
router.get('/buyer/review-eligibility/:bookId', authenticate, async (req, res) => {
    try {
        const buyerId = req.user.user_id || req.user.id;
        const result = await db.execute({
            sql: `SELECT o.order_id
                  FROM orders o
                  LEFT JOIN reviews r ON r.order_id = o.order_id
                  WHERE o.buyer_id = ? AND o.product_id = ? AND o.order_status = 'delivered' AND r.review_id IS NULL
                  ORDER BY o.created_at DESC LIMIT 1`,
            args: [buyerId, req.params.bookId]
        });
        res.json({ can_review: result.rows.length > 0, order_id: result.rows[0]?.order_id || null });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Return signed receipt data for a buyer's own order. The signature makes
// edited receipt images detectable by comparing the printed receipt payload.
router.get('/buyer/:id/receipt', authenticate, async (req, res) => {
    try {
        const buyerId = req.user.user_id || req.user.id;
        const result = await db.execute({
            sql: `SELECT o.order_id, o.order_number, o.created_at, o.quantity, o.total_amount,
                         o.shipping_fee, o.payment_method, o.payment_status, o.order_status,
                         COALESCE(p.title, r.title) AS title,
                         COALESCE(p.author_name, r.author_name) AS author_name,
                         COALESCE(p.images, r.condition_images) AS images,
                         COALESCE(s.store_name, 'Sar Pay Zone Resell') AS store_name,
                         s.logo
                  FROM orders o
                  LEFT JOIN products p ON o.product_id = p.book_id
                  LEFT JOIN resell_listings r ON o.resell_listing_id = r.listing_id
                  LEFT JOIN sellers s ON o.seller_id = s.seller_id
                  WHERE o.order_id = ? AND o.buyer_id = ? LIMIT 1`,
            args: [req.params.id, buyerId]
        });
        if (!result.rows.length) return res.status(404).json({ error: 'Order not found' });
        const order = result.rows[0];
        if (!['approved', 'shipping', 'delivered'].includes(order.order_status)) {
            return res.status(409).json({ error: 'Receipt is available after the seller approves the order' });
        }
        const canonical = [order.order_id, order.order_number, order.created_at, order.quantity, order.total_amount, order.shipping_fee || 0, order.payment_method, order.order_status, order.store_name, order.title, order.author_name || '', order.images || ''].join('|');
        const signature = crypto.createHmac('sha256', config.JWT_SECRET).update(canonical).digest('hex');
        res.json({ receipt: order, signature, verification_code: `SPZ-${signature.slice(0, 16).toUpperCase()}` });
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

// Seller dashboard analytics. Only paid/delivered sales are included.
router.get('/seller/analytics', authenticate, requireRole('publisher', 'bookstore', 'commission_store'), async (req, res) => {
    try {
        const sellerId = req.user.seller_id;
        const periodSql = {
            today: { order: `date(o.created_at) = date('now')`, view: `date(v.viewed_at) = date('now')` },
            week: { order: `date(o.created_at) >= date('now', '-6 days')`, view: `date(v.viewed_at) >= date('now', '-6 days')` },
            month: { order: `strftime('%Y-%m', o.created_at) = strftime('%Y-%m', 'now')`, view: `strftime('%Y-%m', v.viewed_at) = strftime('%Y-%m', 'now')` }
        };
        const kpiQueries = Object.entries(periodSql).map(([period, conditions]) => db.execute({
            sql: `SELECT COALESCE(SUM(o.total_amount), 0) AS revenue, COUNT(*) AS orders, COUNT(DISTINCT o.buyer_id) AS buyers,
                         (SELECT COUNT(*) FROM product_views v JOIN products vp ON vp.book_id = v.book_id
                          WHERE vp.seller_id = ? AND ${conditions.view}) AS visitors
                  FROM orders o WHERE o.seller_id = ? AND o.payment_status = 'paid' AND o.order_status <> 'cancelled' AND ${conditions.order}`,
            args: [sellerId, sellerId]
        }).then(result => [period, result.rows[0] || {}]));
        const [daily, monthly, weekly, yearly, topProducts, inventory, ...kpiRows] = await Promise.all([
            db.execute({ sql: `SELECT date(created_at) AS label, COALESCE(SUM(total_amount), 0) AS sales, COALESCE(SUM(quantity), 0) AS quantity
                FROM orders WHERE seller_id = ? AND payment_status = 'paid' AND order_status <> 'cancelled' AND date(created_at) >= date('now', '-6 days')
                GROUP BY date(created_at) ORDER BY label`, args: [sellerId] }),
            db.execute({ sql: `SELECT strftime('%Y-%m', created_at) AS label, COALESCE(SUM(total_amount), 0) AS sales, COALESCE(SUM(quantity), 0) AS quantity
                FROM orders WHERE seller_id = ? AND payment_status = 'paid' AND order_status <> 'cancelled' AND date(created_at) >= date('now', '-11 months')
                GROUP BY strftime('%Y-%m', created_at) ORDER BY label`, args: [sellerId] }),
            db.execute({ sql: `SELECT strftime('%Y-W%W', created_at) AS label, COALESCE(SUM(total_amount), 0) AS sales, COALESCE(SUM(quantity), 0) AS quantity
                FROM orders WHERE seller_id = ? AND payment_status = 'paid' AND order_status <> 'cancelled' AND date(created_at) >= date('now', '-11 weeks')
                GROUP BY strftime('%Y-W%W', created_at) ORDER BY label`, args: [sellerId] }),
            db.execute({ sql: `SELECT strftime('%Y', created_at) AS label, COALESCE(SUM(total_amount), 0) AS sales, COALESCE(SUM(quantity), 0) AS quantity
                FROM orders WHERE seller_id = ? AND payment_status = 'paid' AND order_status <> 'cancelled' AND date(created_at) >= date('now', '-4 years')
                GROUP BY strftime('%Y', created_at) ORDER BY label`, args: [sellerId] }),
            db.execute({ sql: `SELECT p.title, COALESCE(SUM(o.quantity), 0) AS quantity, COALESCE(SUM(o.total_amount), 0) AS sales
                FROM orders o LEFT JOIN products p ON p.book_id = o.product_id
                WHERE o.seller_id = ? AND o.payment_status = 'paid' AND o.order_status <> 'cancelled'
                GROUP BY o.product_id ORDER BY quantity DESC, sales DESC LIMIT 5`, args: [sellerId] })
            ,db.execute({ sql: `SELECT book_id, title, stock_quantity FROM products WHERE seller_id = ? AND is_active = 1 AND approved = 1 AND stock_quantity <= 5 ORDER BY stock_quantity ASC, updated_at DESC LIMIT 10`, args: [sellerId] })
            ,...kpiQueries
        ]);
        const kpis = Object.fromEntries(kpiRows);
        for (const key of Object.keys(kpis)) {
            const row = kpis[key];
            row.revenue = Number(row.revenue || 0);
            row.orders = Number(row.orders || 0);
            row.buyers = Number(row.buyers || 0);
            row.visitors = Number(row.visitors || 0);
            row.aov = row.orders ? row.revenue / row.orders : 0;
            row.conversion_rate = row.visitors ? (row.buyers / row.visitors) * 100 : 0;
        }
        res.json({ daily: daily.rows, weekly: weekly.rows, monthly: monthly.rows, yearly: yearly.rows, top_products: topProducts.rows,
            inventory: { low_stock: inventory.rows.filter(row => Number(row.stock_quantity) > 0), out_of_stock: inventory.rows.filter(row => Number(row.stock_quantity) === 0), out_of_stock_count: inventory.rows.filter(row => Number(row.stock_quantity) === 0).length }, kpis });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Date-filtered sales report used by the seller dashboard charts and printable A4 view.
router.get('/seller/sales-report', authenticate, requireRole('publisher', 'bookstore', 'commission_store'), async (req, res) => {
    try {
        const sellerId = req.user.seller_id;
        const today = new Date().toISOString().slice(0, 10);
        const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date_from || '') ? req.query.date_from : today;
        const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date_to || '') ? req.query.date_to : today;
        const result = await db.execute({
            sql: `SELECT o.order_number, date(o.created_at) AS sale_date, p.title, COALESCE(p.author_name, '') AS author_name,
                         o.quantity, o.total_amount, o.payment_method, o.order_status, u.name AS buyer_name
                  FROM orders o JOIN products p ON p.book_id = o.product_id
                  LEFT JOIN users u ON u.user_id = o.buyer_id
                  WHERE o.seller_id = ? AND date(o.created_at) BETWEEN ? AND ?
                    AND o.payment_status = 'paid' AND o.order_status <> 'cancelled'
                  ORDER BY o.created_at ASC`,
            args: [sellerId, dateFrom, dateTo]
        });
        res.json({ date_from: dateFrom, date_to: dateTo, rows: result.rows, total: result.rows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0), quantity: result.rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Buyer confirms COD delivery and optionally uploads a delivery photo.
router.post('/:id/cod/buyer-confirm', authenticate, upload.single('proof'), async (req, res) => {
    try {
        const order = await db.execute({ sql: `SELECT * FROM orders WHERE order_id = ?`, args: [req.params.id] });
        if (!order.rows.length) return res.status(404).json({ error: 'Order not found' });
        const ord = order.rows[0];
        if (req.user.role !== 'buyer' || Number(ord.buyer_id) !== Number(req.user.user_id || req.user.id)) return res.status(403).json({ error: 'Only the buyer can confirm this order' });
        if (ord.payment_method !== 'cod') return res.status(400).json({ error: 'This is not a COD order' });
        if (['cancelled', 'delivered'].includes(ord.order_status)) return res.status(400).json({ error: 'This order is no longer awaiting delivery confirmation' });
        if (!req.file && !req.body.proof_url) return res.status(400).json({ error: 'A delivery photo is required' });
        const proofUrl = req.file ? await uploadToCloudinary(req.file.buffer, `orders/${ord.order_id}`, 'cod-proof') : req.body.proof_url;
        await db.execute({
            sql: `UPDATE orders SET buyer_delivery_confirmed_at = datetime('now'), buyer_delivery_proof = ?, updated_at = datetime('now') WHERE order_id = ?`,
            args: [proofUrl, ord.order_id]
        });
        res.json({ success: true, buyer_confirmed: true, proof_url: proofUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Seller confirms COD delivery after buyer proof is submitted. Cash was collected directly by the seller;
// the platform records the sale in the current calendar month's commission ledger,
// payable on the first day of the following month.
router.post('/:id/cod/seller-confirm', authenticate, requireRole('publisher', 'bookstore', 'commission_store'), async (req, res) => {
    try {
        const order = await db.execute({ sql: `SELECT * FROM orders WHERE order_id = ?`, args: [req.params.id] });
        if (!order.rows.length) return res.status(404).json({ error: 'Order not found' });
        const ord = order.rows[0];
        if (Number(ord.seller_id) !== Number(req.user.seller_id) || ord.payment_method !== 'cod') return res.status(403).json({ error: 'Invalid COD order' });
        if (!ord.buyer_delivery_confirmed_at) return res.status(409).json({ error: 'Buyer delivery confirmation and photo are required first' });
        if (ord.order_status === 'cancelled') return res.status(400).json({ error: 'Cancelled orders cannot be confirmed' });
        if (ord.order_status === 'delivered' || ord.seller_delivery_confirmed_at) return res.status(409).json({ error: 'This COD order has already been confirmed' });
        if (ord.order_status !== 'shipping') return res.status(409).json({ error: 'COD order must be in shipping status before confirmation' });
        await db.execute({
            sql: `UPDATE orders SET seller_delivery_confirmed_at = datetime('now'), order_status = 'delivered',
                  payment_status = 'paid', updated_at = datetime('now') WHERE order_id = ?`,
            args: [ord.order_id]
        });
        await db.execute({
            sql: `INSERT INTO monthly_cod_commissions
                    (seller_id, period_start, period_end, commission_amount, due_date)
                  VALUES (?, date('now', 'start of month'), date('now', 'start of month', '+1 month', '-1 day'), ?, date('now', 'start of month', '+1 month'))
                  ON CONFLICT(seller_id, period_start) DO UPDATE SET
                    commission_amount = monthly_cod_commissions.commission_amount + excluded.commission_amount,
                    updated_at = datetime('now')`,
            args: [ord.seller_id, Number(ord.commission_amount || 0)]
        });
        const dueDate = new Date();
        dueDate.setUTCDate(1);
        dueDate.setUTCMonth(dueDate.getUTCMonth() + 1);
        res.json({ success: true, order_status: 'delivered', commission_due: Number(ord.commission_amount || 0), due_date: dueDate.toISOString().slice(0, 10) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update order status
router.patch('/:id/status', authenticate, async (req, res) => {
    try {
        const { status } = req.body;
        if (!['approved', 'shipping', 'delivered', 'cancelled', 'disputed'].includes(status)) {
            return res.status(400).json({ error: 'Invalid order status' });
        }
        const order = await db.execute({
            sql: `SELECT * FROM orders WHERE order_id = ?`,
            args: [req.params.id]
        });
        if (order.rows.length === 0) return res.status(404).json({ error: 'Order not found' });

        const ord = order.rows[0];
        if (status === 'delivered' && ord.payment_method === 'cod') {
            return res.status(400).json({ error: 'COD delivery requires buyer proof and seller confirmation' });
        }

        // Seller can update to approved/shipping/delivered
        const isStoreSeller = req.user.role !== 'buyer' && Number(ord.seller_id) === Number(req.user.seller_id);
        const isResellAdmin = req.user.role === 'admin' && ord.resell_listing_id;
        if (isStoreSeller || isResellAdmin) {
            await db.execute({
                sql: `UPDATE orders SET order_status = ?, updated_at = datetime('now') WHERE order_id = ?`,
                args: [status, req.params.id]
            });
            if (['approved', 'shipping', 'delivered'].includes(status)) {
                await sendPushNotification(ord.buyer_id, 'buyer', {
                    title: `Order ${status}`, body: `${ord.order_number} is now ${status}.`, tag: `order-status-${ord.order_id}-${status}`, url: '/index.html#orders'
                });
            }

            // On delivery, transfer merchandise revenue plus seller-defined shipping, minus commission.
            if (status === 'delivered' && ord.payment_status === 'paid' && ord.order_status !== 'delivered' && ord.payment_method !== 'cod') {
                const sellerAmount = Math.max(0, Number(ord.total_amount) + Number(ord.shipping_fee || 0) - Number(ord.commission_amount || 0));
                if (ord.resell_listing_id && ord.resell_seller_id) {
                    await db.execute({
                        sql: `UPDATE users SET resell_balance = resell_balance + ? WHERE user_id = ?`,
                        args: [sellerAmount, ord.resell_seller_id]
                    });
                    await db.execute({
                        sql: `INSERT INTO transactions (wallet_owner_type, wallet_owner_id, type, amount, fee, balance_after, reference_id)
                              VALUES ('user', ?, 'resell_payout', ?, ?, (SELECT resell_balance FROM users WHERE user_id = ?), ?)`,
                        args: [ord.resell_seller_id, sellerAmount, ord.commission_amount, ord.resell_seller_id, ord.order_number]
                    });
                    await db.execute({
                        sql: `UPDATE resell_listings SET status = 'sold', updated_at = datetime('now') WHERE listing_id = ?`,
                        args: [ord.resell_listing_id]
                    });
                    return res.json({ success: true, escrow_settled: true });
                }
                await db.execute({
                    sql: `UPDATE sellers SET wallet_balance = wallet_balance + ? WHERE seller_id = ?`,
                    args: [sellerAmount, ord.seller_id]
                });
                await db.execute({
                    sql: `UPDATE sellers SET monthly_commission_due = monthly_commission_due + ? WHERE seller_id = ?`,
                    args: [Number(ord.commission_amount || 0), ord.seller_id]
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
            if (['cancelled', 'delivered'].includes(ord.order_status)) return res.status(400).json({ error: 'This order cannot be cancelled' });
            const created = new Date(ord.created_at);
            const now = new Date();
            const diffMins = (now - created) / 60000;

            if (diffMins > 30) return res.status(400).json({ error: 'Cancellation window expired (30 mins)' });

            const refundFee = ord.payment_method === 'wallet' ? Number(ord.total_amount) * 0.02 : 0;
            const refundAmount = ord.payment_method === 'cod' ? Number(ord.amount_paid || 0) : Number(ord.total_amount) + Number(ord.shipping_fee || 0) - refundFee;
            const nextPaymentStatus = ord.payment_status === 'paid' ? 'refunded' : 'failed';

            await db.execute({
                sql: `UPDATE orders SET order_status = 'cancelled', payment_status = ? WHERE order_id = ? AND order_status NOT IN ('cancelled', 'delivered')`,
                args: [nextPaymentStatus, req.params.id]
            });

            if (ord.resell_listing_id) {
                await db.execute({
                    sql: `UPDATE resell_listings SET stock_quantity = stock_quantity + ?, status = 'approved', updated_at = datetime('now') WHERE listing_id = ? AND status = 'sold'`,
                    args: [ord.quantity, ord.resell_listing_id]
                });
            } else {
                await db.execute({
                    sql: `UPDATE products SET stock_quantity = stock_quantity + ? WHERE book_id = ?`,
                    args: [ord.quantity, ord.product_id]
                });
            }

            if (ord.payment_method === 'wallet') {
                await db.execute({
                    sql: `UPDATE users SET wallet_balance = wallet_balance + ? WHERE user_id = ?`,
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
        const rating = Number(req.body.rating);
        const comment = String(req.body.comment || '').trim();
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be a whole number from 1 to 5' });
        if (comment.length > 2000) return res.status(400).json({ error: 'Review comment is too long' });
        const order = await db.execute({
            sql: `SELECT * FROM orders WHERE order_id = ? AND buyer_id = ? AND order_status = 'delivered'`,
            args: [req.params.id, req.user.user_id || req.user.id]
        });
        if (order.rows.length === 0) return res.status(400).json({ error: 'Can only review delivered orders' });

        const existing = await db.execute({ sql: `SELECT review_id FROM reviews WHERE order_id = ?`, args: [req.params.id] });
        if (existing.rows.length) return res.status(409).json({ error: 'This order has already been reviewed' });
        if (!order.rows[0].product_id) return res.status(400).json({ error: 'This resell order cannot be reviewed from the standard product page yet' });

        await db.execute({
            sql: `INSERT INTO reviews (book_id, user_id, order_id, rating, comment) VALUES (?, ?, ?, ?, ?)`,
            args: [order.rows[0].product_id, req.user.user_id || req.user.id, req.params.id, rating, comment]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
