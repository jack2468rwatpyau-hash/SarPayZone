const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const crypto = require('crypto');

const createStoreCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

async function ensureStorePasswordCode(sellerId) {
    const row = await db.execute({ sql: 'SELECT seller_id, store_password_code, store_password_code_changed_at FROM sellers WHERE seller_id = ?', args: [sellerId] });
    if (!row.rows.length) return null;
    const seller = row.rows[0];
    const expired = !seller.store_password_code_changed_at || Date.now() - new Date(`${seller.store_password_code_changed_at}Z`).getTime() >= 15 * 24 * 60 * 60 * 1000;
    if (!seller.store_password_code || expired) {
        const code = createStoreCode();
        await db.execute({ sql: 'UPDATE sellers SET store_password_code = ?, store_password_code_changed_at = CURRENT_TIMESTAMP WHERE seller_id = ?', args: [code, sellerId] });
        return { seller_id: sellerId, code, changed_at: new Date().toISOString() };
    }
    return { seller_id: sellerId, code: seller.store_password_code, changed_at: seller.store_password_code_changed_at };
}

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
        const stores = await db.execute({ sql: `SELECT seller_id, store_password_code, store_password_code_changed_at FROM sellers WHERE role != 'admin' AND is_visible = 1` });
        let matchedStoreId = null;
        for (const store of stores.rows) {
            const record = await ensureStorePasswordCode(store.seller_id);
            if (record && record.code === String(password_code || '')) { matchedStoreId = store.seller_id; break; }
        }
        if (!/^\d{6}$/.test(String(password_code || '')) || !matchedStoreId) {
            return res.status(403).json({ error: 'ဆိုင် Password Code မမှန်ပါ။ ဆိုင်မှ ပြသထားသော ၆ လုံးကုဒ်ကို ထည့်ပါ' });
        }
        req.store_id = matchedStoreId;
        next();
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = { authenticate, requirePasswordCode, ensureStorePasswordCode };
