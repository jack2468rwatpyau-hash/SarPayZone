const { createClient } = require('@libsql/client');
const config = require('./config');

const client = createClient({
    url: config.TURSO_URL,
    authToken: config.TURSO_AUTH_TOKEN
});

module.exports = client;

