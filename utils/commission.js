const calculateCommission = (role, price) => {
    switch(role) {
        case 'publisher':
            if (price <= 10000) return 0.06;
            if (price <= 20000) return 0.05;
            if (price <= 50000) return 0.04;
            return 0.03;
        case 'bookstore':
            return 0.02;
        case 'commission_store':
            return 0;
        case 'resell':
            return 0.08; // Can be overridden to 0.05 after admin approval
        default:
            return 0;
    }
};

module.exports = { calculateCommission };
backend/utils/cronJobs.js
const cron = require('node-cron');
const db = require('../db');
const { sendDailySummary } = require('./telegram');

const initCronJobs = () => {
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
};

module.exports = { initCronJobs };

