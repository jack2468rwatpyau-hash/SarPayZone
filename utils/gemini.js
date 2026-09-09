const config = require('../config');

const moderateMessage = async (text) => {
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${config.GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: `Analyze this message for inappropriate content (hate speech, harassment, explicit content, scams). Reply ONLY with "SAFE" or "FLAGGED". Message: "${text}"`
                        }]
                    }]
                })
            }
        );
        const data = await response.json();
        const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'SAFE';
        return result === 'FLAGGED';
    } catch (err) {
        console.error('Gemini moderation error:', err);
        return false; // Fail open
    }
};

module.exports = { moderateMessage };

