const { createClient } = require('@libsql/client');
const config = require('./config');

const client = createClient({
    url: config.TURSO_URL,
    authToken: config.TURSO_AUTH_TOKEN
});

// @libsql/client requires an explicit args array for object-form queries.
// The route code intentionally omits args for static SQL, so normalize here
// instead of changing every query site and making future routes error-prone.
const execute = (statement) => {
    if (typeof statement === 'string') return client.execute(statement);
    return client.execute({ ...statement, args: statement.args || [] });
};

module.exports = { execute };
