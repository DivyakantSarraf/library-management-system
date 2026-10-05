const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// EJS setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Path middleware for active navigation state
app.use((req, res, next) => {
    res.locals.currentPath = req.path;
    next();
});

const adminController = require('./controllers/adminController');
const bookController = require('./controllers/bookController');
const memberController = require('./controllers/memberController');

// Home route
app.get('/', (req, res) => {
    res.render('home');
});

// Admin routes
app.get('/admin', adminController.getDashboard);

app.get('/admin/books', bookController.getBooks);
app.post('/admin/books', bookController.addBook);
app.post('/admin/books/:id/update', bookController.updateBook);
app.post('/admin/books/:id/delete', bookController.deleteBook);

app.get('/admin/members', memberController.getMembers);
app.post('/admin/members', memberController.addMember);
app.post('/admin/members/:id/update', memberController.updateMember);
app.post('/admin/members/:id/delete', memberController.deleteMember);

const issueController = require('./controllers/issueController');

app.get('/admin/issues', issueController.getIssues);
app.post('/admin/issues', issueController.issueBook);
app.post('/admin/issues/:id/return', issueController.returnBook);

const reportController = require('./controllers/reportController');
app.get('/admin/reports', reportController.getReports);

// Member routes
app.get('/member', (req, res) => {
    res.render('member/dashboard');
});

app.get('/member/books', (req, res) => {
    res.render('member/books');
});

app.get('/member/issues', (req, res) => {
    res.render('member/issues');
});

app.get('/member/profile', (req, res) => {
    res.render('member/profile');
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Library Management System running at http://localhost:${PORT}`);
});