const webpush = require('web-push');
const config = require('../config');
const db = require('../db');

const pushConfigured = Boolean(config.VAPID_SUBJECT && config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY);
if (pushConfigured) {
    webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);
} else {
    console.warn('Browser notifications disabled: VAPID environment variables are incomplete.');
}

const sendPushNotification = async (targetId, targetType, payload) => {
    try {
        if (!pushConfigured) return;
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
                if ([404, 410].includes(err.statusCode)) {
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
