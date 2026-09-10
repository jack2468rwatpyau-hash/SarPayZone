const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

const authenticate = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'Access denied. No token.' });

        const decoded = jwt.verify(token, config.JWT_SECRET);
        
        if (decoded.role === 'buyer') {
            const user = await db.execute({
                sql: 'SELECT * FROM users WHERE user_id = ? AND account_status = "active"',
                args: [decoded.id]
            });
            if (user.rows.length === 0) return res.status(401).json({ error: 'User not found or banned' });
            req.user = { ...decoded, ...user.rows[0], userType: 'buyer' };
        } else if (['publisher', 'bookstore', 'commission_store', 'agent', 'admin'].includes(decoded.role)) {
            const seller = await db.execute({
                sql: 'SELECT * FROM sellers WHERE seller_id = ? AND role = ? AND is_visible = 1',
                args: [decoded.id, decoded.role]
            });
            if (seller.rows.length === 0) return res.status(401).json({ error: 'Seller not found' });
            req.user = { ...decoded, ...seller.rows[0], userType: 'seller' };
        } else {
            return res.status(401).json({ error: 'Invalid token role' });
        }

        return next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

const requirePasswordCode = async (req, res, next) => {
    try {
        const { password_code } = req.body;
        const result = await db.execute({
            sql: 'SELECT config_value FROM system_config WHERE config_key = "current_password_code"'
        });
        if (!password_code || !result.rows[0] || result.rows[0].config_value !== password_code) {
            return res.status(403).json({ error: 'Invalid password code' });
        }
        next();
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = { authenticate, requirePasswordCode };
