const passport = require('../config/passport');
const { sessionCookieName } = require('../config/session');
const { rotateCsrfToken } = require('../middleware/csrfMiddleware');

const GENERIC_ERROR_MSG = 'Invalid credentials. Please check your details and try again.';

class AuthController {
    /**
     * GET /admin/login - Render Admin Login View
     */
    static getAdminLogin(req, res) {
        if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.role === 'admin') {
            return res.redirect('/admin');
        }

        res.render('auth/admin-login', {
            title: 'Admin Sign In - Library Management System',
            currentPath: '/admin/login',
            error: req.query.error || null,
            success: req.query.success || null,
            submittedUsername: ''
        });
    }

    /**
     * POST /admin/login - Process Admin Authentication
     */
    static postAdminLogin(req, res, next) {
        const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
        const password = typeof req.body.password === 'string' ? req.body.password : '';

        if (!username || !password) {
            return res.status(400).render('auth/admin-login', {
                title: 'Admin Sign In - Library Management System',
                currentPath: '/admin/login',
                error: 'Please enter both username and password.',
                success: null,
                submittedUsername: username
            });
        }

        passport.authenticate('admin-local', (err, user, info) => {
            if (err) {
                console.error('Admin authentication system error:', err);
                return res.status(500).render('auth/admin-login', {
                    title: 'Admin Sign In - Library Management System',
                    currentPath: '/admin/login',
                    error: 'Authentication service is temporarily unavailable. Please try again.',
                    success: null,
                    submittedUsername: username
                });
            }

            if (!user) {
                if (typeof req.recordLoginFailure === 'function') {
                    req.recordLoginFailure();
                }
                return res.status(401).render('auth/admin-login', {
                    title: 'Admin Sign In - Library Management System',
                    currentPath: '/admin/login',
                    error: (info && info.message) || GENERIC_ERROR_MSG,
                    success: null,
                    submittedUsername: username
                });
            }

            // Session fixation protection: regenerate session ID upon successful authentication
            req.session.regenerate((regenErr) => {
                if (regenErr) {
                    console.error('Session regeneration error:', regenErr);
                    return next(regenErr);
                }

                // Rotate CSRF token and clear failed login attempt records on success
                rotateCsrfToken(req);
                if (typeof req.recordLoginSuccess === 'function') {
                    req.recordLoginSuccess();
                }

                req.login(user, (loginErr) => {
                    if (loginErr) {
                        console.error('Session login error:', loginErr);
                        return next(loginErr);
                    }

                    // Save session explicitly before redirecting
                    req.session.save((saveErr) => {
                        if (saveErr) {
                            console.error('Session save error:', saveErr);
                            return next(saveErr);
                        }
                        res.redirect('/admin');
                    });
                });
            });
        })(req, res, next);
    }

    /**
     * GET /member/login - Render Member Login View
     */
    static getMemberLogin(req, res) {
        if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.role === 'member') {
            return res.redirect('/member');
        }

        res.render('auth/member-login', {
            title: 'Member Sign In - Library Management System',
            currentPath: '/member/login',
            error: req.query.error || null,
            success: req.query.success || null,
            submittedUsername: ''
        });
    }

    /**
     * POST /member/login - Process Member Authentication
     */
    static postMemberLogin(req, res, next) {
        const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
        const password = typeof req.body.password === 'string' ? req.body.password : '';

        if (!username || !password) {
            return res.status(400).render('auth/member-login', {
                title: 'Member Sign In - Library Management System',
                currentPath: '/member/login',
                error: 'Please enter both username/email and password.',
                success: null,
                submittedUsername: username
            });
        }

        passport.authenticate('member-local', (err, user, info) => {
            if (err) {
                console.error('Member authentication system error:', err);
                return res.status(500).render('auth/member-login', {
                    title: 'Member Sign In - Library Management System',
                    currentPath: '/member/login',
                    error: 'Authentication service is temporarily unavailable. Please try again.',
                    success: null,
                    submittedUsername: username
                });
            }

            if (!user) {
                if (typeof req.recordLoginFailure === 'function') {
                    req.recordLoginFailure();
                }
                return res.status(401).render('auth/member-login', {
                    title: 'Member Sign In - Library Management System',
                    currentPath: '/member/login',
                    error: (info && info.message) || GENERIC_ERROR_MSG,
                    success: null,
                    submittedUsername: username
                });
            }

            // Session fixation protection: regenerate session ID upon successful authentication
            req.session.regenerate((regenErr) => {
                if (regenErr) {
                    console.error('Session regeneration error:', regenErr);
                    return next(regenErr);
                }

                // Rotate CSRF token and clear failed login attempt records on success
                rotateCsrfToken(req);
                if (typeof req.recordLoginSuccess === 'function') {
                    req.recordLoginSuccess();
                }

                req.login(user, (loginErr) => {
                    if (loginErr) {
                        console.error('Session login error:', loginErr);
                        return next(loginErr);
                    }

                    // Save session explicitly before redirecting
                    req.session.save((saveErr) => {
                        if (saveErr) {
                            console.error('Session save error:', saveErr);
                            return next(saveErr);
                        }
                        res.redirect('/member');
                    });
                });
            });
        })(req, res, next);
    }

    /**
     * GET /login - Common entry point
     */
    static getLogin(req, res) {
        if (req.isAuthenticated && req.isAuthenticated() && req.user) {
            return req.user.role === 'admin' ? res.redirect('/admin') : res.redirect('/member');
        }
        res.redirect('/member/login');
    }

    /**
     * GET or POST /logout - Secure logout and complete session destruction
     */
    static logout(req, res, next) {
        req.logout((err) => {
            if (err) {
                console.error('Error during req.logout:', err);
            }

            if (req.session) {
                req.session.destroy((destroyErr) => {
                    if (destroyErr) {
                        console.error('Error destroying session:', destroyErr);
                    }
                    res.clearCookie(sessionCookieName || 'lms.sid', { path: '/' });
                    return res.redirect('/?success=' + encodeURIComponent('You have been signed out successfully.'));
                });
            } else {
                res.clearCookie(sessionCookieName || 'lms.sid', { path: '/' });
                return res.redirect('/');
            }
        });
    }
}

module.exports = AuthController;
