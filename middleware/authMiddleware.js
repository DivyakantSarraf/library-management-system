/**
 * Role-Based Authorization and Route Protection Middleware
 * Library Management System - Part 8B
 */

/**
 * Validates whether a redirect path is a safe internal relative path.
 * Prevents Open Redirect vulnerabilities by rejecting external schemes, protocol-relative URLs (//), and backslashes.
 * @param {string} targetUrl 
 * @param {string} defaultUrl 
 * @returns {string}
 */
function getSafeRedirectUrl(targetUrl, defaultUrl = '/') {
    const safeDefault = (typeof defaultUrl === 'string' && defaultUrl.startsWith('/') && !defaultUrl.startsWith('//') && !defaultUrl.includes('\\'))
        ? defaultUrl
        : '/';

    if (
        typeof targetUrl === 'string' &&
        targetUrl.startsWith('/') &&
        !targetUrl.startsWith('//') &&
        !targetUrl.startsWith('/\\') &&
        !targetUrl.includes('\\') &&
        !targetUrl.includes('\r') &&
        !targetUrl.includes('\n') &&
        !targetUrl.includes('\t') &&
        !targetUrl.includes('\0')
    ) {
        return targetUrl;
    }
    return safeDefault;
}

/**
 * Enforces Cache-Control headers on sensitive authenticated routes.
 * Ensures browsers do not retain cached copies of protected pages in history,
 * mitigating backward navigation exposure after session termination/logout.
 */
function preventBrowserCaching(req, res, next) {
    if (res && typeof res.setHeader === 'function') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    if (typeof next === 'function') next();
}

/**
 * Checks whether the incoming request is expecting a JSON or AJAX response.
 * @param {import('express').Request} req 
 * @returns {boolean}
 */
function isApiOrAjaxRequest(req) {
    if (!req) return false;
    const accept = req.headers && req.headers['accept'] ? String(req.headers['accept']) : '';
    const contentType = req.headers && req.headers['content-type'] ? String(req.headers['content-type']) : '';
    const isXhr = req.xhr || (req.headers && req.headers['x-requested-with'] === 'XMLHttpRequest');
    const isJsonAccept = accept.includes('application/json');
    const isJsonContent = contentType.includes('application/json');
    const isApiPath = req.path && req.path.startsWith('/api');
    return Boolean(isXhr || isJsonAccept || isJsonContent || isApiPath);
}

/**
 * Authentication Gate Middleware.
 * Rejects unauthenticated requests and redirects browser clients to the corresponding login entry point.
 */
function requireAuth(req, res, next) {
    const isAuthenticated = Boolean(req && req.isAuthenticated && req.isAuthenticated() && req.user);

    if (isAuthenticated) {
        return next();
    }

    if (isApiOrAjaxRequest(req)) {
        return res.status(401).json({ error: 'Authentication required. Please sign in.' });
    }

    // Direct browser user to the role-specific login portal (strict boundary check)
    const targetUrl = req.originalUrl || req.url || '';
    const isAdminPath = targetUrl === '/admin' || targetUrl.startsWith('/admin/') || targetUrl.startsWith('/admin?');
    const isMemberPath = targetUrl === '/member' || targetUrl.startsWith('/member/') || targetUrl.startsWith('/member?');

    if (isAdminPath) {
        return res.redirect('/admin/login');
    }
    if (isMemberPath) {
        return res.redirect('/member/login');
    }

    return res.redirect('/login');
}

/**
 * Role-Based Authorization Middleware Factory.
 * Enforces that the authenticated user possesses the specific required role ('admin' or 'member').
 * Rejects invalid, missing, or mismatched roles with HTTP 403 Forbidden.
 * @param {'admin'|'member'} requiredRole 
 */
function requireRole(requiredRole) {
    return (req, res, next) => {
        // Enforce cache prevention headers across all protected endpoints automatically
        preventBrowserCaching(req, res, () => {});

        // 1. Must be authenticated first
        const isAuthenticated = Boolean(req && req.isAuthenticated && req.isAuthenticated() && req.user);
        if (!isAuthenticated) {
            return requireAuth(req, res, next);
        }

        // 2. Validate role matches required authorization
        const userRole = req.user.role;
        if (!userRole || userRole !== requiredRole) {
            if (isApiOrAjaxRequest(req)) {
                return res.status(403).json({
                    error: 'Access forbidden: Insufficient privileges for this resource.'
                });
            }

            return res.status(403).render('error', {
                status: 403,
                title: '403 Forbidden - Access Denied',
                message: `Access denied. This section requires ${requiredRole} privileges.`,
                currentPath: req.path,
                user: req.user
            });
        }

        return next();
    };
}

const requireAdmin = requireRole('admin');
const requireMember = requireRole('member');

module.exports = {
    requireAuth,
    requireRole,
    requireAdmin,
    requireMember,
    preventBrowserCaching,
    getSafeRedirectUrl,
    isApiOrAjaxRequest
};
