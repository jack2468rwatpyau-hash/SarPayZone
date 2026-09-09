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

