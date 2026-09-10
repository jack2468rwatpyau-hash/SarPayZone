const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const config = require('./config');
const db = require('./db');
const errorHandler = require('./middleware/errorHandler');
const { authenticate } = require('./middleware/auth');
const { initCronJobs } = require('./utils/cronJobs');

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

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.get('/health', (req, res) => {
    res.json({ ok: true, service: 'sar-pay-zone-api' });
});

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests, please try again later.'
});
app.use('/api/', limiter);

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

// Web Push subscription
app.post('/api/push/subscribe', authenticate, async (req, res) => {
    try {
        const { endpoint, keys } = req.body;
        const isBuyer = req.user.role === 'buyer';
        await db.execute({
            sql: `INSERT INTO push_subscriptions (user_id, seller_id, endpoint, keys_p256dh, keys_auth) 
                  VALUES (?, ?, ?, ?, ?)`,
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

// Socket.io for real-time chat
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    socket.on('join_conversation', (conversationId) => {
        socket.join(`conv_${conversationId}`);
    });

    socket.on('send_message', async (data) => {
        const { conversation_id, content, sender_id, sender_type } = data;
        io.to(`conv_${conversation_id}`).emit('new_message', {
            conversation_id,
            content,
            sender_id,
            sender_type,
            created_at: new Date().toISOString()
        });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// Error handler
app.use(errorHandler);

// Start server
const PORT = config.PORT;
server.listen(PORT, () => {
    console.log(`Sar Pay Zone server running on port ${PORT}`);
    initCronJobs();
});
