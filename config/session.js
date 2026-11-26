const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const pool = require('./db');

function createSessionMiddleware() {
    const sessionStore = new PgSession({
        pool: pool,
        tableName: 'session',
        createTableIfMissing: false
    });

    // Handle background store connection errors safely
    sessionStore.on('error', (err) => {
        console.error('PostgreSQL Session Store Error:', err.message);
    });

    const isProduction = process.env.NODE_ENV === 'production';

    return session({
        store: sessionStore,
        name: 'lms.sid',
        secret: process.env.SESSION_SECRET || 'lms_secure_fallback_session_secret_key_84920482918',
        resave: false,
        saveUninitialized: false,
        rolling: true, // Refreshes session expiration on activity
        cookie: {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        }
    });
}

module.exports = {
    createSessionMiddleware,
    sessionCookieName: 'lms.sid'
};
