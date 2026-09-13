const cloudinary = require('cloudinary').v2;
const config = require('../config');

const accounts = {
    product: config.CLOUDINARY_PRODUCT,
    chat: config.CLOUDINARY_CHAT,
    resell: config.CLOUDINARY_RESELL
};

const uploadToCloudinary = async (buffer, folder, type = 'product') => {
    if (!buffer || !Buffer.isBuffer(buffer)) throw new Error('Upload file data is missing');
    const account = accounts[type] || accounts.product;
    if (!account?.cloud_name || !account?.api_key || !account?.api_secret) {
        throw new Error(`Cloudinary ${type} account is not configured`);
    }

    // cloudinary.config() mutates the client singleton; configure it immediately
    // before each sequential upload, then call the real client uploader.
    cloudinary.config({
        cloud_name: account.cloud_name,
        api_key: account.api_key,
        api_secret: account.api_secret,
        secure: true
    });

    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder, resource_type: 'auto' },
            (error, result) => {
                if (error) return reject(error);
                if (!result?.secure_url) return reject(new Error('Cloudinary returned no secure URL'));
                resolve(result.secure_url);
            }
        );
        stream.on('error', reject);
        stream.end(buffer);
    });
};

module.exports = { uploadToCloudinary };
