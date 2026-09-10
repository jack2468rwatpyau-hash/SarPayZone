require('dotenv').config();

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be configured in production');
}

module.exports = {
    PORT: process.env.PORT || 3000,
    JWT_SECRET: process.env.JWT_SECRET || 'local-development-only-secret',
    JWT_EXPIRES_IN: '7d',
    
    TURSO_URL: process.env.TURSO_URL,
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    
    // Cloudinary - 3 Accounts
    CLOUDINARY_PRODUCT: {
        cloud_name: process.env.CLOUDINARY_PRODUCT_NAME,
        api_key: process.env.CLOUDINARY_PRODUCT_KEY,
        api_secret: process.env.CLOUDINARY_PRODUCT_SECRET
    },
    CLOUDINARY_CHAT: {
        cloud_name: process.env.CLOUDINARY_CHAT_NAME,
        api_key: process.env.CLOUDINARY_CHAT_KEY,
        api_secret: process.env.CLOUDINARY_CHAT_SECRET
    },
    CLOUDINARY_RESELL: {
        cloud_name: process.env.CLOUDINARY_RESELL_NAME,
        api_key: process.env.CLOUDINARY_RESELL_KEY,
        api_secret: process.env.CLOUDINARY_RESELL_SECRET
    },
    
    // Telegram - 2 Bots
    TELEGRAM_BOT1_TOKEN: process.env.TELEGRAM_BOT1_TOKEN,
    TELEGRAM_BOT2_TOKEN: process.env.TELEGRAM_BOT2_TOKEN,
    
    // Gemini
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    
    // Web Push
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT || 'mailto:admin@sarpayzone.site'
};

;
