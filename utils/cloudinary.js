const cloudinary = require('cloudinary').v2;
const config = require('../config');

// Product Images Account
const productCloud = cloudinary.config({
    cloud_name: config.CLOUDINARY_PRODUCT.cloud_name,
    api_key: config.CLOUDINARY_PRODUCT.api_key,
    api_secret: config.CLOUDINARY_PRODUCT.api_secret
});

// Chat Images Account
const chatCloud = cloudinary.config({
    cloud_name: config.CLOUDINARY_CHAT.cloud_name,
    api_key: config.CLOUDINARY_CHAT.api_key,
    api_secret: config.CLOUDINARY_CHAT.api_secret
});

// Resell/Backup Account
const resellCloud = cloudinary.config({
    cloud_name: config.CLOUDINARY_RESELL.cloud_name,
    api_key: config.CLOUDINARY_RESELL.api_key,
    api_secret: config.CLOUDINARY_RESELL.api_secret
});

const uploadToCloudinary = async (buffer, folder, type = 'product') => {
    const cloud = type === 'chat' ? chatCloud : type === 'resell' ? resellCloud : productCloud;
    
    return new Promise((resolve, reject) => {
        cloud.uploader.upload_stream(
            { folder, resource_type: 'auto' },
            (error, result) => {
                if (error) reject(error);
                else resolve(result.secure_url);
            }
        ).end(buffer);
    });
};

module.exports = { uploadToCloudinary };
