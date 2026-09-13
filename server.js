const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const config = require('./config');
const db = require('./db');
const errorHandler = require('./middleware/errorHandler');
const { authenticate } = require('./middleware/auth');
const { initCronJobs } = require('./utils/cronJobs');
const { moderateMessage } = require('./utils/gemini');
const { sendPushNotification } = require('./utils/webpush');

// Routes
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const walletRoutes = require('./routes/wallet');
const chatRoutes = require('./routes/chat');
const shippingRoutes = require('./routes/shipping');
const votingRoutes = require('./routes/voting');
const resellRoutes = require('./routes/resell');
const adminRoutes = require('./routes/admin');
const buyerRoutes = require('./routes/buyer');
const storeRoutes = require('./routes/store');
const settlementRoutes = require('./routes/settlements');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.get('/health', (req, res) => {
    res.json({ ok: true, service: 'sar-pay-zone-api' });
});

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests, please try again later.'
});
app.use('/api/', limiter);
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many authentication attempts. Try again later.' } });
app.use('/api/auth/', authLimiter);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/shipping', shippingRoutes);
app.use('/api/voting', votingRoutes);
app.use('/api/resell', resellRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/buyer', buyerRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/settlements', settlementRoutes);

// Web Push subscription
app.post('/api/push/subscribe', authenticate, async (req, res) => {
    try {
        const { endpoint, keys } = req.body;
        const isBuyer = req.user.role === 'buyer';
        await db.execute({
            sql: `INSERT INTO push_subscriptions (user_id, seller_id, endpoint, keys_p256dh, keys_auth)
                  VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, seller_id = excluded.seller_id,
                    keys_p256dh = excluded.keys_p256dh, keys_auth = excluded.keys_auth`,
            args: [
                isBuyer ? req.user.user_id || req.user.id : null,
                !isBuyer ? req.user.seller_id : null,
                endpoint,
                keys.p256dh,
                keys.auth
            ]
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Socket.io authentication and realtime chat authorization.
const getSocketIdentity = (user) => {
    const id = user.user_id || user.seller_id || user.id;
    return { id, identifier: `${user.role === 'buyer' ? 'U' : 'S'}${id}`, type: user.role === 'buyer' ? 'user' : (user.role === 'admin' ? 'admin' : 'seller') };
};

io.use(async (socket, next) => {
    try {
        const raw = socket.handshake.auth?.token || socket.handshake.headers.authorization?.split(' ')[1];
        if (!raw) return next(new Error('Authentication required'));
        const decoded = jwt.verify(raw, config.JWT_SECRET);
        if (decoded.role === 'buyer') {
            const result = await db.execute({ sql: "SELECT * FROM users WHERE user_id = ? AND account_status = 'active'", args: [decoded.id] });
            if (!result.rows.length) return next(new Error('User not found'));
            socket.user = { ...decoded, ...result.rows[0] };
        } else {
            const result = await db.execute({ sql: `SELECT * FROM sellers WHERE seller_id = ? AND is_visible = 1`, args: [decoded.id] });
            if (!result.rows.length) return next(new Error('Seller not found'));
            socket.user = { ...decoded, ...result.rows[0] };
        }
        next();
    } catch (error) {
        next(new Error('Invalid authentication token'));
    }
});

io.on('connection', (socket) => {
    const identity = getSocketIdentity(socket.user);
    console.log('Authenticated chat connection:', socket.id, identity.identifier);

    socket.on('join_conversation', async (conversationId, acknowledge) => {
        try {
            const conversation = await db.execute({
                sql: `SELECT conversation_id FROM conversations WHERE conversation_id = ? AND participants LIKE ?`,
                args: [conversationId, `%"${identity.identifier}"%`]
            });
            if (!conversation.rows.length) return typeof acknowledge === 'function' && acknowledge({ ok: false, error: 'Not a conversation participant' });
            socket.join(`conv_${conversationId}`);
            if (typeof acknowledge === 'function') acknowledge({ ok: true });
        } catch (error) {
            if (typeof acknowledge === 'function') acknowledge({ ok: false, error: 'Unable to join conversation' });
        }
    });

    socket.on('send_message', async (data, acknowledge) => {
        try {
            const conversationId = Number(data?.conversation_id);
            const content = String(data?.content || '').trim();
            if (!conversationId || !content || content.length > 5000) throw new Error('Invalid message');
            const conversation = await db.execute({
                sql: `SELECT conversation_id FROM conversations WHERE conversation_id = ? AND participants LIKE ?`,
                args: [conversationId, `%"${identity.identifier}"%`]
            });
            if (!conversation.rows.length) throw new Error('Not a conversation participant');
            if (await moderateMessage(content)) throw new Error('Message flagged by AI moderation');
            const inserted = await db.execute({
                sql: `INSERT INTO messages (conversation_id, sender_id, sender_type, content) VALUES (?, ?, ?, ?)`,
                args: [conversationId, identity.identifier, identity.type, content]
            });
            await db.execute({ sql: `UPDATE conversations SET last_message_at = datetime("now") WHERE conversation_id = ?`, args: [conversationId] });
            const message = { message_id: inserted.lastInsertRowid, conversation_id: conversationId, content, sender_id: identity.identifier, sender_type: identity.type, created_at: new Date().toISOString() };
            io.to(`conv_${conversationId}`).emit('new_message', message);
            const participants = await db.execute({ sql: `SELECT participants FROM conversations WHERE conversation_id = ?`, args: [conversationId] });
            for (const participant of JSON.parse(participants.rows[0]?.participants || '[]')) {
                if (participant === identity.identifier) continue;
                if (participant.startsWith('U')) await sendPushNotification(Number(participant.slice(1)), 'buyer', { title: 'New chat message', body: content.slice(0, 120), tag: `chat-${conversationId}`, url: `/index.html#chat?conversation=${conversationId}` });
                if (participant.startsWith('S')) await sendPushNotification(Number(participant.slice(1)), 'seller', { title: 'New chat message', body: content.slice(0, 120), tag: `chat-${conversationId}`, url: `/store-dashboard.html#chat?conversation=${conversationId}` });
            }
            if (typeof acknowledge === 'function') acknowledge({ ok: true, message });
        } catch (error) {
            if (typeof acknowledge === 'function') acknowledge({ ok: false, error: error.message });
        }
    });

    socket.on('disconnect', () => console.log('Chat connection closed:', socket.id));
});

// Error handler
app.use(errorHandler);

// Start server
const PORT = config.PORT;
server.listen(PORT, () => {
    console.log(`Sar Pay Zone server running on port ${PORT}`);
    initCronJobs();
});
