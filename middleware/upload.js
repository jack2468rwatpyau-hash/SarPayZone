const multer = require('multer');
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 5, fields: 40 },
    fileFilter: (_req, file, callback) => {
        if (!allowedTypes.has(file.mimetype)) return callback(new Error('Only JPG, PNG, WEBP, and GIF images are allowed'));
        callback(null, true);
    }
});
module.exports = upload;
