const cloudinary = require('cloudinary').v2;
const config = require('../config');

// Product Images Account
const productCloud = cloudinary.config({
    cloud_name: config.CLOUDINARY_PRODUCT.cloud_name,
    api_key: config.CLOUDINARY_PRODUCT.api_key,
    api_secret: config.CLOUDINARY_PRODUCT.api_secret
});

// Chat Images Account
const chatCloud = cloudinary.config({
    cloud_name: config.CLOUDINARY_CHAT.cloud_name,
    api_key: config.CLOUDINARY_CHAT.api_key,
    api_secret: config.CLOUDINARY_CHAT.api_secret
});

// Resell/Backup Account
const resellCloud = cloudinary.config({
    cloud_name: config.CLOUDINARY_RESELL.cloud_name,
    api_key: config.CLOUDINARY_RESELL.api_key,
    api_secret: config.CLOUDINARY_RESELL.api_secret
});

const uploadToCloudinary = async (buffer, folder, type = 'product') => {
    const cloud = type === 'chat' ? chatCloud : type === 'resell' ? resellCloud : productCloud;
    
    return new Promise((resolve, reject) => {
        cloud.uploader.upload_stream(
            { folder, resource_type: 'auto' },
            (error, result) => {
                if (error) reject(error);
                else resolve(result.secure_url);
            }
        ).end(buffer);
    });
};

module.exports = { uploadToCloudinary };
backend/utils/telegram.js
const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');

// Bot 1 - Instant Order Notifications
const bot1 = new TelegramBot(config.TELEGRAM_BOT1_TOKEN, { polling: false });

// Bot 2 - Daily Summary
const bot2 = new TelegramBot(config.TELEGRAM_BOT2_TOKEN, { polling: false });

const sendInstantOrder = async (telegramUserId, orderDetails) => {
    if (!telegramUserId) return;
    const message = `
<b>NEW ORDER RECEIVED</b>

Order: ${orderDetails.order_number}
Product: ${orderDetails.product_name}
Amount: ${orderDetails.total_amount} MMK
Quantity: ${orderDetails.quantity}
Buyer: ${orderDetails.buyer_name}
Address: ${orderDetails.shipping_address}

Please check your dashboard.
`;
    try {
        await bot1.sendMessage(telegramUserId, message, { parse_mode: 'HTML' });
    } catch (err) {
        console.error('Telegram Bot1 Error:', err.message);
    }
};

const sendDailySummary = async (telegramUserId, summary) => {
    if (!telegramUserId) return;
    const message = `
<b>DAILY ORDER SUMMARY</b>

Date: ${summary.date}
Total Orders: ${summary.total_orders}
Total Revenue: ${summary.total_revenue} MMK
Pending: ${summary.pending_count}
Delivered: ${summary.delivered_count}

Have a great day!
`;
    try {
        await bot2.sendMessage(telegramUserId, message, { parse_mode: 'HTML' });
    } catch (err) {
        console.error('Telegram Bot2 Error:', err.message);
    }
};

module.exports = { sendInstantOrder, sendDailySummary, bot1, bot2 };
backend/utils/gemini.js
const config = require('../config');

const moderateMessage = async (text) => {
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${config.GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: `Analyze this message for inappropriate content (hate speech, harassment, explicit content, scams). Reply ONLY with "SAFE" or "FLAGGED". Message: "${text}"`
                        }]
                    }]
                })
            }
        );
        const data = await response.json();
        const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'SAFE';
        return result === 'FLAGGED';
    } catch (err) {
        console.error('Gemini moderation error:', err);
        return false; // Fail open
    }
};

module.exports = { moderateMessage };
backend/utils/webpush.js
const webpush = require('web-push');
const config = require('../config');
const db = require('../db');

webpush.setVapidDetails(
    config.VAPID_SUBJECT,
    config.VAPID_PUBLIC_KEY,
    config.VAPID_PRIVATE_KEY
);

const sendPushNotification = async (targetId, targetType, payload) => {
    try {
        const field = targetType === 'buyer' ? 'user_id' : 'seller_id';
        const subs = await db.execute({
            sql: `SELECT * FROM push_subscriptions WHERE ${field} = ?`,
            args: [targetId]
        });

        for (const sub of subs.rows) {
            const pushSub = {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth }
            };
            try {
                await webpush.sendNotification(pushSub, JSON.stringify(payload));
            } catch (err) {
                if (err.statusCode === 410) {
                    await db.execute({
                        sql: 'DELETE FROM push_subscriptions WHERE subscription_id = ?',
                        args: [sub.subscription_id]
                    });
                }
            }
        }
    } catch (err) {
        console.error('Push notification error:', err);
    }
};

module.exports = { sendPushNotification, webpush };
backend/utils/commission.js
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

