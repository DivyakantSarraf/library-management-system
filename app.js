const express = require('express');
const path = require('path');
require('dotenv').config();

const { createSessionMiddleware } = require('./config/session');
const passport = require('./config/passport');
const authController = require('./controllers/authController');
const { requireAdmin, requireMember, preventBrowserCaching, isApiOrAjaxRequest } = require('./middleware/authMiddleware');
const { csrfProtection } = require('./middleware/csrfMiddleware');
const { createLoginRateLimiter } = require('./middleware/rateLimitMiddleware');

const adminLoginLimiter = createLoginRateLimiter('admin');
const memberLoginLimiter = createLoginRateLimiter('member');

const app = express();
const PORT = process.env.PORT || 3000;

// EJS setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Core Body Parsers & Static Files
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session & Passport Authentication Middleware
app.use(createSessionMiddleware());
app.use(passport.initialize());
app.use(passport.session());

// Synchronizer Token CSRF Protection Middleware
app.use(csrfProtection);

// Global template context middleware
app.use((req, res, next) => {
    res.locals.currentPath = req.path;
    res.locals.currentUser = req.user || null;
    res.locals.isAuthenticated = Boolean(req.isAuthenticated && req.isAuthenticated());
    res.locals.csrfToken = req.csrfToken ? req.csrfToken() : (req.session && req.session.csrfToken) || null;
    res.locals.success = req.query.success || null;
    res.locals.error = req.query.error || null;
    next();
});

const adminController = require('./controllers/adminController');
const bookController = require('./controllers/bookController');
const memberController = require('./controllers/memberController');

// Home route (public)
app.get('/', (req, res) => {
    res.render('home');
});

// Authentication routes (public)
app.get('/login', authController.getLogin);
app.get('/admin/login', authController.getAdminLogin);
app.post('/admin/login', adminLoginLimiter, authController.postAdminLogin);
app.get('/member/login', authController.getMemberLogin);
app.post('/member/login', memberLoginLimiter, authController.postMemberLogin);

// Logout handling: State-changing logout is EXCLUSIVELY permitted via POST with a valid CSRF token.
// GET requests to /logout MUST NOT destroy or modify an authenticated session.
app.get('/logout', (req, res) => {
    res.setHeader('Allow', 'POST');
    if (isApiOrAjaxRequest(req)) {
        return res.status(405).json({
            error: 'Method Not Allowed: Logout must be submitted via POST with a valid CSRF token.'
        });
    }
    return res.status(405).render('error', {
        status: 405,
        title: '405 Method Not Allowed - Use POST for Sign Out',
        message: 'Sign out must be submitted via POST with a valid CSRF token. Direct GET requests do not terminate sessions.',
        currentPath: req.path,
        user: req.user || null
    });
});
app.post('/logout', authController.logout);

// Protected Admin Routes (require role === 'admin')
app.get('/admin', preventBrowserCaching, requireAdmin, adminController.getDashboard);

app.get('/admin/books', preventBrowserCaching, requireAdmin, bookController.getBooks);
app.post('/admin/books', requireAdmin, bookController.addBook);
app.post('/admin/books/:id/update', requireAdmin, bookController.updateBook);
app.post('/admin/books/:id/delete', requireAdmin, bookController.deleteBook);

app.get('/admin/members', preventBrowserCaching, requireAdmin, memberController.getMembers);
app.post('/admin/members', requireAdmin, memberController.addMember);
app.post('/admin/members/:id/update', requireAdmin, memberController.updateMember);
app.post('/admin/members/:id/delete', requireAdmin, memberController.deleteMember);

const issueController = require('./controllers/issueController');

app.get('/admin/issues', preventBrowserCaching, requireAdmin, issueController.getIssues);
app.post('/admin/issues', requireAdmin, issueController.issueBook);
app.post('/admin/issues/:id/return', requireAdmin, issueController.returnBook);

const reportController = require('./controllers/reportController');
app.get('/admin/reports', preventBrowserCaching, requireAdmin, reportController.getReports);

const memberPortalController = require('./controllers/memberPortalController');

// Protected Member Routes (require role === 'member')
app.get('/member', preventBrowserCaching, requireMember, memberPortalController.getDashboard);
app.get('/member/books', preventBrowserCaching, requireMember, memberPortalController.getBrowseBooks);
app.get('/member/issues', preventBrowserCaching, requireMember, memberPortalController.getMyBooks);
app.get('/member/profile', preventBrowserCaching, requireMember, memberPortalController.getProfile);
app.post('/member/profile', preventBrowserCaching, requireMember, memberPortalController.updateProfile);

// Export app for test suites
module.exports = app;

// Start server if run directly
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 Library Management System running at http://localhost:${PORT}`);
    });
}
