const passport = require('../config/passport');
const { sessionCookieName } = require('../config/session');
const { rotateCsrfToken } = require('../middleware/csrfMiddleware');
const AuthService = require('../services/authService');
const MemberPortalModel = require('../models/memberPortalModel');

const GENERIC_ERROR_MSG = 'Invalid credentials. Please check your details and try again.';

class AuthController {
    /**
     * Regenerates the session ID, rotates the CSRF token, establishes Passport login,
     * saves the PostgreSQL session explicitly, and redirects.
     */
    static establishAuthenticatedSession(req, res, next, user, redirectPath, onReady) {
        req.session.regenerate((regenErr) => {
            if (regenErr) {
                console.error('Session regeneration error:', regenErr);
                return next(regenErr);
            }

            rotateCsrfToken(req);
            if (typeof onReady === 'function') {
                onReady();
            }

            req.login(user, (loginErr) => {
                if (loginErr) {
                    console.error('Session login error:', loginErr);
                    return next(loginErr);
                }

                req.session.save((saveErr) => {
                    if (saveErr) {
                        console.error('Session save error:', saveErr);
                        return next(saveErr);
                    }
                    res.redirect(redirectPath);
                });
            });
        });
    }
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
            AuthController.establishAuthenticatedSession(req, res, next, user, '/admin', () => {
                if (typeof req.recordLoginSuccess === 'function') {
                    req.recordLoginSuccess();
                }
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
            AuthController.establishAuthenticatedSession(req, res, next, user, '/member', () => {
                if (typeof req.recordLoginSuccess === 'function') {
                    req.recordLoginSuccess();
                }
            });
        })(req, res, next);
    }

    /**
     * GET /member/register - Render Member Self-Registration View
     */
    static getMemberRegister(req, res) {
        res.render('auth/member-register', {
            title: 'Create Member Account - Library Management System',
            currentPath: '/member/register',
            error: null,
            fieldErrors: {},
            submittedUsername: '',
            submittedEmail: ''
        });
    }

    /**
     * POST /member/register - Validate, register member, establish session, and redirect to optional profile completion
     */
    static async postMemberRegister(req, res, next) {
        const rawUsername = req.body && typeof req.body.username === 'string' ? req.body.username.trim() : '';
        const rawEmail = req.body && typeof req.body.email === 'string' ? req.body.email.trim() : '';

        try {
            const result = await AuthService.registerMember(req.body || {});

            if (!result.success) {
                return res.status(result.status || 400).render('auth/member-register', {
                    title: 'Create Member Account - Library Management System',
                    currentPath: '/member/register',
                    error: result.message,
                    fieldErrors: result.fieldErrors || {},
                    submittedUsername: rawUsername,
                    submittedEmail: rawEmail
                });
            }

            return AuthController.establishAuthenticatedSession(req, res, next, result.user, '/member/complete-profile');
        } catch (err) {
            console.error('Member registration system error:', err);
            return res.status(500).render('auth/member-register', {
                title: 'Create Member Account - Library Management System',
                currentPath: '/member/register',
                error: 'Registration service is temporarily unavailable. Please try again.',
                fieldErrors: {},
                submittedUsername: rawUsername,
                submittedEmail: rawEmail
            });
        }
    }

    /**
     * GET /member/complete-profile - Render Optional Profile Completion Screen
     */
    static getCompleteProfile(req, res) {
        const member = req.user || {};
        res.render('auth/member-complete-profile', {
            title: 'Complete Your Profile - Library Management System',
            currentPath: '/member/complete-profile',
            currentMember: member,
            error: null,
            fieldErrors: {},
            formValues: {
                name: member.name || '',
                phone: member.phone || '',
                address: member.address || ''
            }
        });
    }

    /**
     * POST /member/complete-profile - Save optional profile fields or skip cleanly to /member
     */
    static async postCompleteProfile(req, res) {
        const member = req.user;
        if (!member || member.role !== 'member' || !member.id) {
            return res.redirect('/member/login');
        }

        const body = req.body || {};
        const rawAction = body.action;
        const rawName = body.name;
        const rawPhone = body.phone;
        const rawAddress = body.address;

        const renderFormError = (statusCode, errorMsg, fieldErrors = {}) => {
            return res.status(statusCode).render('auth/member-complete-profile', {
                title: 'Complete Your Profile - Library Management System',
                currentPath: '/member/complete-profile',
                currentMember: member,
                error: errorMsg,
                fieldErrors,
                formValues: {
                    name: typeof rawName === 'string' ? rawName : (member.name || ''),
                    phone: typeof rawPhone === 'string' ? rawPhone : (member.phone || ''),
                    address: typeof rawAddress === 'string' ? rawAddress : (member.address || '')
                }
            });
        };

        if (rawAction !== undefined && typeof rawAction !== 'string') {
            return renderFormError(400, 'Invalid action submitted. Please choose Complete Profile or Skip for Now.');
        }

        const action = typeof rawAction === 'string' ? rawAction.trim().toLowerCase() : 'complete';

        if (action === 'skip') {
            return res.redirect('/member');
        }

        if (action !== 'complete') {
            return renderFormError(400, 'Invalid action submitted. Please choose Complete Profile or Skip for Now.');
        }

        try {
            const updatePayload = {};
            if (Object.prototype.hasOwnProperty.call(body, 'name') && rawName !== undefined) {
                updatePayload.name = rawName;
            }
            if (Object.prototype.hasOwnProperty.call(body, 'phone') && rawPhone !== undefined) {
                updatePayload.phone = rawPhone;
            }
            if (Object.prototype.hasOwnProperty.call(body, 'address') && rawAddress !== undefined) {
                updatePayload.address = rawAddress;
            }

            await MemberPortalModel.updateProfile(member.id, updatePayload);

            return res.redirect(`/member?success=${encodeURIComponent('Welcome! Your member profile has been saved.')}`);
        } catch (err) {
            const errorMap = {
                NAME_INVALID: { field: 'name', message: 'Full Name must be valid text.' },
                NAME_TOO_SHORT: { field: 'name', message: 'Full Name must be at least 2 characters.' },
                NAME_TOO_LONG: { field: 'name', message: 'Full Name cannot exceed 100 characters.' },
                PHONE_INVALID: { field: 'phone', message: 'Phone number can only contain digits, spaces, +, -, and parentheses.' },
                PHONE_TOO_LONG: { field: 'phone', message: 'Phone number cannot exceed 20 characters.' },
                ADDRESS_INVALID: { field: 'address', message: 'Home address must be valid text.' },
                ADDRESS_TOO_LONG: { field: 'address', message: 'Home address cannot exceed 500 characters.' }
            };
            const mapped = errorMap[err.message];
            if (mapped) {
                return renderFormError(400, mapped.message, { [mapped.field]: mapped.message });
            }
            console.error('Error completing member profile:', err);
            return renderFormError(500, 'Unable to save profile details right now. Please try again or skip for now.');
        }
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
