module.exports = (err, req, res, next) => {
    console.error(err.stack);
    const isClientError = err.name === 'MulterError' || err.message?.startsWith('Only JPG') || err.message?.startsWith('Invalid');
    res.status(err.status || 500).json({
        error: isClientError ? err.message : (process.env.NODE_ENV === 'development' ? (err.message || 'Internal Server Error') : 'Internal server error'),
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};
