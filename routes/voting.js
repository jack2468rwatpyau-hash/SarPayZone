const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');

// Get active festivals
router.get('/festivals', async (req, res) => {
    try {
        const festivals = await db.execute({
            sql: `SELECT f.*, 
                  (SELECT COUNT(*) FROM votes WHERE festival_id = f.festival_id) as total_votes 
                  FROM voting_festivals f 
                  WHERE f.is_active = 1 AND datetime('now') BETWEEN f.start_date AND f.end_date`
        });
        res.json(festivals.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get books in festival (only books the admin has curated for this festival)
router.get('/festival/:id/books', async (req, res) => {
    try {
        const books = await db.execute({
            sql: `SELECT p.*, COUNT(v.vote_id) as vote_count 
                  FROM festival_books fb
                  JOIN products p ON p.book_id = fb.book_id
                  LEFT JOIN votes v ON v.book_id = p.book_id AND v.festival_id = fb.festival_id
                  WHERE fb.festival_id = ? AND p.is_active = 1
                  GROUP BY p.book_id ORDER BY vote_count DESC`,
            args: [req.params.id]
        });
        res.json(books.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Cast vote
router.post('/vote', authenticate, async (req, res) => {
    try {
        const { festival_id, book_id } = req.body;
        const userId = req.user.user_id || req.user.id;

        // Check festival is active
        const festival = await db.execute({
            sql: 'SELECT * FROM voting_festivals WHERE festival_id = ? AND is_active = 1 AND datetime("now") BETWEEN start_date AND end_date',
            args: [festival_id]
        });
        if (festival.rows.length === 0) return res.status(400).json({ error: 'Festival is not active' });

        // Check the book is actually curated into this festival
        const eligible = await db.execute({
            sql: 'SELECT id FROM festival_books WHERE festival_id = ? AND book_id = ?',
            args: [festival_id, book_id]
        });
        if (eligible.rows.length === 0) return res.status(400).json({ error: 'This book is not part of the festival' });

        // Check if already voted
        const existing = await db.execute({
            sql: 'SELECT vote_id FROM votes WHERE festival_id = ? AND user_id = ?',
            args: [festival_id, userId]
        });
        if (existing.rows.length > 0) return res.status(400).json({ error: 'You have already voted in this festival' });

        await db.execute({
            sql: 'INSERT INTO votes (festival_id, book_id, user_id) VALUES (?, ?, ?)',
            args: [festival_id, book_id, userId]
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

