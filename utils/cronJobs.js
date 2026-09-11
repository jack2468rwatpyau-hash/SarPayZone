const cron = require('node-cron');
const db = require('../db');
const { sendDailySummary } = require('./telegram');
const { sendPushNotification } = require('./webpush');
const { ensureStorePasswordCode } = require('../middleware/auth');

const initCronJobs = () => {
    // Rotate every expired seller store access code; each code remains valid for 15 days.
    cron.schedule('15 0 * * *', async () => {
        const sellers = await db.execute({ sql: "SELECT seller_id FROM sellers WHERE role != 'admin' AND is_visible = 1" });
        for (const seller of sellers.rows) await ensureStorePasswordCode(seller.seller_id);
    });
    // Daily summary at 11:59 PM
    cron.schedule('59 23 * * *', async () => {
        console.log('Running daily summary cron...');
        const today = new Date().toISOString().split('T')[0];
        
        const sellers = await db.execute({
            sql: 'SELECT seller_id, telegram_user_id FROM sellers WHERE telegram_user_id IS NOT NULL'
        });

        for (const seller of sellers.rows) {
            const orders = await db.execute({
                sql: `SELECT COUNT(*) as count, SUM(total_amount) as revenue 
                      FROM orders 
                      WHERE seller_id = ? AND date(created_at) = ?`,
                args: [seller.seller_id, today]
            });
            
            const pending = await db.execute({
                sql: `SELECT COUNT(*) as count FROM orders 
                      WHERE seller_id = ? AND order_status = 'new' AND date(created_at) = ?`,
                args: [seller.seller_id, today]
            });

            await sendDailySummary(seller.telegram_user_id, {
                date: today,
                total_orders: orders.rows[0].count || 0,
                total_revenue: orders.rows[0].revenue || 0,
                pending_count: pending.rows[0].count || 0,
                delivered_count: (orders.rows[0].count || 0) - (pending.rows[0].count || 0)
            });
        }
    });

    // Cleanup soft-deleted users older than 30 days
    cron.schedule('0 3 * * *', async () => {
        await db.execute({
            sql: `DELETE FROM users WHERE account_status = 'soft_deleted' 
                  AND datetime(created_at) < datetime('now', '-30 days')`
        });
    });

    // Remind buyers every morning about shipped orders awaiting delivery confirmation.
    cron.schedule('0 9 * * *', async () => {
        const orders = await db.execute({
            sql: `SELECT order_id, buyer_id, order_number, title FROM (
                    SELECT o.order_id, o.buyer_id, o.order_number, COALESCE(p.title, r.title) AS title
                    FROM orders o LEFT JOIN products p ON o.product_id = p.book_id
                    LEFT JOIN resell_listings r ON o.resell_listing_id = r.listing_id
                    WHERE o.order_status = 'shipping' AND o.buyer_delivery_confirmed_at IS NULL
                  )`
        });
        for (const order of orders.rows) {
            await sendPushNotification(order.buyer_id, 'buyer', {
                title: 'Delivery confirmation reminder', body: `${order.title || 'Your order'} has arrived or is ready to confirm.`, tag: `delivery-${order.order_id}`, url: '/index.html#orders'
            });
        }
    });
};

module.exports = { initCronJobs };
