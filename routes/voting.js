const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');

router.get('/festivals', async (req, res) => {
    try {
        const festivals = await db.execute({ sql: `SELECT f.*,
            (SELECT COUNT(*) FROM votes WHERE festival_id = f.festival_id) +
            (SELECT COUNT(*) FROM voting_external_votes WHERE festival_id = f.festival_id) AS total_votes
            FROM voting_festivals f WHERE f.is_active = 1 AND datetime('now') BETWEEN f.start_date AND f.end_date` });
        res.json(festivals.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/festival/:id/books', async (req, res) => {
    try {
        const platform = await db.execute({ sql: `SELECT p.book_id, NULL AS external_book_id, p.title, p.author_name, p.images AS image_url,
            COUNT(v.vote_id) AS vote_count, 'platform' AS book_source
            FROM festival_books fb JOIN products p ON p.book_id = fb.book_id
            LEFT JOIN votes v ON v.book_id = p.book_id AND v.festival_id = fb.festival_id
            WHERE fb.festival_id = ? AND p.is_active = 1 GROUP BY p.book_id`, args: [req.params.id] });
        const external = await db.execute({ sql: `SELECT NULL AS book_id, b.external_book_id, b.book_title AS title, b.author_name, b.image_url,
            COUNT(v.vote_id) AS vote_count, 'external' AS book_source, b.book_link
            FROM voting_external_books b LEFT JOIN voting_external_votes v ON v.external_book_id = b.external_book_id AND v.festival_id = b.festival_id
            WHERE b.festival_id = ? GROUP BY b.external_book_id`, args: [req.params.id] });
        res.json([...platform.rows, ...external.rows].sort((a, b) => Number(b.vote_count) - Number(a.vote_count)));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/vote', authenticate, async (req, res) => {
    try {
        const { festival_id, book_id, external_book_id } = req.body;
        const userId = req.user.user_id || req.user.id;
        const festival = await db.execute({ sql: `SELECT festival_id FROM voting_festivals WHERE festival_id = ? AND is_active = 1 AND datetime('now') BETWEEN start_date AND end_date`, args: [festival_id] });
        if (!festival.rows.length) return res.status(400).json({ error: 'Festival is not active' });
        const existing = await db.execute({ sql: `SELECT vote_id FROM votes WHERE festival_id = ? AND user_id = ? UNION ALL SELECT vote_id FROM voting_external_votes WHERE festival_id = ? AND user_id = ?`, args: [festival_id, userId, festival_id, userId] });
        if (existing.rows.length) return res.status(400).json({ error: 'You have already voted in this festival' });
        if (external_book_id) {
            const eligible = await db.execute({ sql: `SELECT external_book_id FROM voting_external_books WHERE festival_id = ? AND external_book_id = ?`, args: [festival_id, external_book_id] });
            if (!eligible.rows.length) return res.status(400).json({ error: 'This book is not part of the festival' });
            await db.execute({ sql: `INSERT INTO voting_external_votes (festival_id, external_book_id, user_id) VALUES (?, ?, ?)`, args: [festival_id, external_book_id, userId] });
        } else {
            const eligible = await db.execute({ sql: `SELECT festival_book_id FROM festival_books WHERE festival_id = ? AND book_id = ?`, args: [festival_id, book_id] });
            if (!eligible.rows.length) return res.status(400).json({ error: 'This book is not part of the festival' });
            await db.execute({ sql: `INSERT INTO votes (festival_id, book_id, user_id) VALUES (?, ?, ?)`, args: [festival_id, book_id, userId] });
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
