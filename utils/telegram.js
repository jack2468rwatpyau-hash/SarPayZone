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
