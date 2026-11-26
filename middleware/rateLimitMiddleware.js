/**
 * Login Rate Limiting Middleware
 * Library Management System - Part 8C
 *
 * Implements a production-appropriate two-tier rate limiting strategy:
 *  - Tier 1: Per-IP Rate Limiting (max 10 failed login attempts per 15 minutes).
 *            Protects against brute force credential stuffing from a single host across multiple usernames.
 *  - Tier 2: Compound Key (IP + Username) Rate Limiting (max 5 failed attempts per 15 minutes).
 *            Protects against targeted dictionary attacks against a specific username from a single host,
 *            WITHOUT allowing an external attacker to cause a Denial of Service (lockout) for legitimate
 *            users logging in from different IP addresses.
 *
 * On Rate Limit Violation:
 *  - Returns HTTP 429 Too Many Requests.
 *  - Sets Retry-After header (in seconds).
 *  - Renders login view with generic rate-limit alert (never discloses whether the account exists).
 *  - Returns JSON for AJAX/API requests.
 *
 * Reset Behavior:
 *  - Window: 15 minutes (sliding/bucketed TTL).
 *  - Upon successful authentication, failed attempt counters for the IP and compound key are cleared.
 *  - Automatic in-memory cleanup periodically unrefs and purges expired records.
 */

const { isApiOrAjaxRequest } = require('./authMiddleware');

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS_PER_IP = 10;
const MAX_ATTEMPTS_PER_COMPOUND = 5;
const MAX_REGISTRATIONS_PER_IP = 5;

// In-memory buckets: key -> { count: number, resetAt: number }
// Note: Single-process in-memory store, consistent with login rate limiting.
const ipBuckets = new Map();
const compoundBuckets = new Map();
const regIpBuckets = new Map();

/**
 * Periodically purge expired bucket entries to prevent memory accumulation.
 */
const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of ipBuckets.entries()) {
        if (record.resetAt <= now) {
            ipBuckets.delete(key);
        }
    }
    for (const [key, record] of compoundBuckets.entries()) {
        if (record.resetAt <= now) {
            compoundBuckets.delete(key);
        }
    }
    for (const [key, record] of regIpBuckets.entries()) {
        if (record.resetAt <= now) {
            regIpBuckets.delete(key);
        }
    }
}, 5 * 60 * 1000);

// Ensure cleanup interval does not keep the Node event loop alive in test environments
if (cleanupInterval.unref) {
    cleanupInterval.unref();
}

/**
 * Helper to normalize incoming IP addresses.
 * @param {import('express').Request} req 
 * @returns {string}
 */
function getClientIp(req) {
    if (!req) return '127.0.0.1';
    const forwarded = req.headers && req.headers['x-forwarded-for'];
    if (forwarded && typeof forwarded === 'string') {
        return forwarded.split(',')[0].trim();
    }
    return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Checks whether an incoming login attempt is currently rate-limited.
 * @param {string} ip 
 * @param {string} username 
 * @returns {{ isLimited: boolean, retryAfterSeconds: number }}
 */
function checkRateLimit(ip, username) {
    const now = Date.now();
    const cleanUsername = typeof username === 'string' ? username.trim().toLowerCase() : '';

    // 1. Check IP bucket
    const ipRecord = ipBuckets.get(ip);
    if (ipRecord && ipRecord.resetAt > now) {
        if (ipRecord.count >= MAX_ATTEMPTS_PER_IP) {
            return {
                isLimited: true,
                retryAfterSeconds: Math.max(1, Math.ceil((ipRecord.resetAt - now) / 1000))
            };
        }
    } else if (ipRecord && ipRecord.resetAt <= now) {
        ipBuckets.delete(ip);
    }

    // 2. Check Compound (IP + Username) bucket
    if (cleanUsername) {
        const compoundKey = `${ip}::${cleanUsername}`;
        const compoundRecord = compoundBuckets.get(compoundKey);
        if (compoundRecord && compoundRecord.resetAt > now) {
            if (compoundRecord.count >= MAX_ATTEMPTS_PER_COMPOUND) {
                return {
                    isLimited: true,
                    retryAfterSeconds: Math.max(1, Math.ceil((compoundRecord.resetAt - now) / 1000))
                };
            }
        } else if (compoundRecord && compoundRecord.resetAt <= now) {
            compoundBuckets.delete(compoundKey);
        }
    }

    return { isLimited: false, retryAfterSeconds: 0 };
}

/**
 * Records a failed login attempt for the given IP and username.
 * @param {string} ip 
 * @param {string} username 
 */
function recordLoginFailure(ip, username) {
    const now = Date.now();
    const cleanUsername = typeof username === 'string' ? username.trim().toLowerCase() : '';

    // Update IP bucket
    const ipRecord = ipBuckets.get(ip);
    if (ipRecord && ipRecord.resetAt > now) {
        ipRecord.count++;
    } else {
        ipBuckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    }

    // Update Compound bucket
    if (cleanUsername) {
        const compoundKey = `${ip}::${cleanUsername}`;
        const compoundRecord = compoundBuckets.get(compoundKey);
        if (compoundRecord && compoundRecord.resetAt > now) {
            compoundRecord.count++;
        } else {
            compoundBuckets.set(compoundKey, { count: 1, resetAt: now + WINDOW_MS });
        }
    }
}

/**
 * Clears failed login attempts upon successful authentication.
 * @param {string} ip 
 * @param {string} username 
 */
function recordLoginSuccess(ip, username) {
    const cleanUsername = typeof username === 'string' ? username.trim().toLowerCase() : '';
    ipBuckets.delete(ip);
    if (cleanUsername) {
        compoundBuckets.delete(`${ip}::${cleanUsername}`);
    }
}

/**
 * Clears all rate limiting records (useful for test isolation).
 */
function resetRateLimits() {
    ipBuckets.clear();
    compoundBuckets.clear();
    regIpBuckets.clear();
}

/**
 * Resolves client IP for registration rate limiting without trusting arbitrary forwarded headers.
 * @param {import('express').Request} req
 * @returns {string}
 */
function getRegistrationClientIp(req) {
    if (!req) return '127.0.0.1';
    return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Checks and records a registration POST attempt for the given IP.
 * Allows up to MAX_REGISTRATIONS_PER_IP (5) attempts per 15-minute window.
 * @param {string} ip
 * @returns {{ isLimited: boolean, retryAfterSeconds: number }}
 */
function checkAndRecordRegistrationAttempt(ip) {
    const now = Date.now();
    const record = regIpBuckets.get(ip);

    if (record && record.resetAt > now) {
        if (record.count >= MAX_REGISTRATIONS_PER_IP) {
            return {
                isLimited: true,
                retryAfterSeconds: Math.max(1, Math.ceil((record.resetAt - now) / 1000))
            };
        }
        record.count++;
        return { isLimited: false, retryAfterSeconds: 0 };
    }

    regIpBuckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { isLimited: false, retryAfterSeconds: 0 };
}

/**
 * Clears only registration rate limit counters (for isolated registration tests).
 */
function resetRegistrationRateLimits() {
    regIpBuckets.clear();
}

/**
 * Factory for creating registration POST rate limiting middleware.
 * Note: In-memory, single-process limiter isolated from login rate limiter buckets.
 */
function createRegistrationRateLimiter() {
    return (req, res, next) => {
        const ip = getRegistrationClientIp(req);
        const { isLimited, retryAfterSeconds } = checkAndRecordRegistrationAttempt(ip);

        if (isLimited) {
            res.setHeader('Retry-After', String(retryAfterSeconds));

            if (isApiOrAjaxRequest(req)) {
                return res.status(429).json({
                    error: `Too many registration attempts. Please try again after ${Math.ceil(retryAfterSeconds / 60)} minute(s).`
                });
            }

            const submittedUsername = req.body && typeof req.body.username === 'string' ? req.body.username.trim() : '';
            const submittedEmail = req.body && typeof req.body.email === 'string' ? req.body.email.trim() : '';

            return res.status(429).render('auth/member-register', {
                title: 'Create Member Account - Library Management System',
                currentPath: '/member/register',
                error: `Too many registration attempts. Please try again after ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
                fieldErrors: {},
                submittedUsername,
                submittedEmail
            });
        }

        next();
    };
}

/**
 * Factory for creating login rate limiting middleware.
 * @param {'admin'|'member'} role 
 */
function createLoginRateLimiter(role) {
    return (req, res, next) => {
        const ip = getClientIp(req);
        const username = req.body && req.body.username;

        const { isLimited, retryAfterSeconds } = checkRateLimit(ip, username);

        if (isLimited) {
            res.setHeader('Retry-After', String(retryAfterSeconds));

            if (isApiOrAjaxRequest(req)) {
                return res.status(429).json({
                    error: `Too many failed login attempts. Please try again after ${Math.ceil(retryAfterSeconds / 60)} minute(s).`
                });
            }

            const loginView = role === 'admin' ? 'auth/admin-login' : 'auth/member-login';
            return res.status(429).render(loginView, {
                title: role === 'admin' ? 'Admin Sign In' : 'Member Sign In',
                error: `Too many failed login attempts. Please try again after ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
                success: null,
                submittedUsername: username || ''
            });
        }

        // Expose recording helpers on req for controllers
        req.recordLoginFailure = () => recordLoginFailure(ip, username);
        req.recordLoginSuccess = () => recordLoginSuccess(ip, username);

        next();
    };
}

module.exports = {
    createLoginRateLimiter,
    createRegistrationRateLimiter,
    checkRateLimit,
    checkAndRecordRegistrationAttempt,
    recordLoginFailure,
    recordLoginSuccess,
    resetRateLimits,
    resetRegistrationRateLimits,
    getClientIp,
    getRegistrationClientIp,
    WINDOW_MS,
    MAX_ATTEMPTS_PER_IP,
    MAX_ATTEMPTS_PER_COMPOUND,
    MAX_REGISTRATIONS_PER_IP
};
