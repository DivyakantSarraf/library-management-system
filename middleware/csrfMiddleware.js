/**
 * Synchronizer Token CSRF Protection Middleware
 * Library Management System - Part 8C
 *
 * Implements the standard Synchronizer Token Pattern:
 * 1. Generates cryptographically strong 32-byte session-bound CSRF tokens.
 * 2. Exposes token to templates via res.locals.csrfToken and req.csrfToken().
 * 3. Enforces constant-time token validation on state-changing requests (POST, PUT, DELETE, PATCH).
 * 4. Accepts tokens via hidden form fields (_csrf), request body (_csrf), or headers (x-csrf-token, csrf-token).
 * 5. Returns generic HTTP 403 response on missing or invalid tokens.
 */

const crypto = require('crypto');
const { isApiOrAjaxRequest } = require('./authMiddleware');

/**
 * Generates a cryptographically secure 32-byte hex token.
 * @returns {string}
 */
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Validates two token strings using timing-safe comparison to prevent timing side-channel attacks.
 * @param {string} tokenA 
 * @param {string} tokenB 
 * @returns {boolean}
 */
function timingSafeCompare(tokenA, tokenB) {
    if (typeof tokenA !== 'string' || typeof tokenB !== 'string') {
        return false;
    }
    const bufA = Buffer.from(tokenA);
    const bufB = Buffer.from(tokenB);
    if (bufA.length !== bufB.length) {
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * CSRF Protection Middleware.
 * Mount after express.urlencoded(), express.json(), and createSessionMiddleware().
 */
function csrfProtection(req, res, next) {
    if (!req.session) {
        return next(new Error('CSRF protection requires active session middleware'));
    }

    // Ensure session contains a valid CSRF token
    if (!req.session.csrfToken || typeof req.session.csrfToken !== 'string') {
        req.session.csrfToken = generateToken();
    }

    // Expose token getter on req and locals for EJS templates
    req.csrfToken = () => req.session.csrfToken;
    res.locals.csrfToken = req.session.csrfToken;

    // Safe HTTP methods do not mutate state
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method.toUpperCase())) {
        return next();
    }

    // Extract submitted token exclusively from request body or secure request headers
    // Query string token acceptance is explicitly disallowed to prevent token leakage in URL/logs
    const submittedToken = (
        (req.body && typeof req.body._csrf === 'string' && req.body._csrf) ||
        (req.headers && typeof req.headers['x-csrf-token'] === 'string' && req.headers['x-csrf-token']) ||
        (req.headers && typeof req.headers['csrf-token'] === 'string' && req.headers['csrf-token']) ||
        (req.headers && typeof req.headers['x-xsrf-token'] === 'string' && req.headers['x-xsrf-token']) ||
        ''
    );

    const isValid = timingSafeCompare(submittedToken, req.session.csrfToken);

    if (!isValid) {
        if (isApiOrAjaxRequest(req)) {
            return res.status(403).json({
                error: 'Invalid or missing CSRF token'
            });
        }

        return res.status(403).render('error', {
            status: 403,
            title: '403 Forbidden - Security Validation Failed',
            message: 'Invalid or missing CSRF token. Please return to the previous page, refresh, and submit again.',
            currentPath: req.path,
            user: req.user || null
        });
    }

    return next();
}

/**
 * Refreshes the CSRF token stored in the session (e.g. after login session regeneration).
 * @param {import('express').Request} req 
 * @returns {string} The freshly generated CSRF token
 */
function rotateCsrfToken(req) {
    if (req && req.session) {
        const freshToken = generateToken();
        req.session.csrfToken = freshToken;
        if (req.res && req.res.locals) {
            req.res.locals.csrfToken = freshToken;
        }
        return freshToken;
    }
    return null;
}

module.exports = {
    csrfProtection,
    generateToken,
    timingSafeCompare,
    rotateCsrfToken
};
