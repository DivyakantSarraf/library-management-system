const IssueModel = require('../models/issueModel');

exports.getIssues = async (req, res) => {
    try {
        const search = req.query.q || '';
        const status = req.query.status || '';
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        
        const { issues, totalRows, totalPages } = await IssueModel.getIssues({
            search,
            status,
            page,
            limit
        });

        const availableBooks = await IssueModel.getAvailableBooks();
        const members = await IssueModel.getMembersForIssue();

        res.render('admin/issues', {
            issues,
            availableBooks,
            members,
            search,
            status,
            page,
            totalPages,
            totalRows,
            error: null,
            success: null
        });
    } catch (err) {
        console.error('Error fetching issues:', err);
        res.render('admin/issues', {
            issues: [],
            availableBooks: [],
            members: [],
            search: '',
            status: '',
            page: 1,
            totalPages: 0,
            totalRows: 0,
            error: 'Failed to load circulation records. Please try again.',
            success: null
        });
    }
};

exports.issueBook = async (req, res) => {
    try {
        const { book_id, member_id, issue_date, due_date } = req.body;
        
        if (!book_id || !member_id || !issue_date || !due_date) {
            throw new Error('INVALID_INPUT');
        }

        if (new Date(due_date) < new Date(issue_date)) {
            throw new Error('INVALID_DATE_RANGE');
        }

        await IssueModel.createIssue({
            book_id: parseInt(book_id, 10),
            member_id: parseInt(member_id, 10),
            issue_date,
            due_date
        });

        res.redirect('/admin/issues?success=Book+issued+successfully');
    } catch (err) {
        console.error('Issue Book Error:', err);
        let errorMsg = 'Unable to complete the circulation operation. Please try again.';
        
        switch (err.message) {
            case 'ADMIN_REQUIRED':
                errorMsg = 'An Admin context is required, but no admins exist in the database.';
                break;
            case 'MEMBER_NOT_FOUND':
                errorMsg = 'The selected member could not be found.';
                break;
            case 'BOOK_NOT_FOUND':
                errorMsg = 'The selected book could not be found.';
                break;
            case 'BOOK_UNAVAILABLE':
                errorMsg = 'This book is currently unavailable.';
                break;
            case 'INVALID_INPUT':
                errorMsg = 'Please provide valid input for all required fields.';
                break;
            case 'INVALID_DATE_RANGE':
                errorMsg = 'Due date cannot be earlier than issue date.';
                break;
        }
        
        // Handle postgres check constraints safely
        if (err.constraint === 'issues_check') {
             errorMsg = 'Invalid date range provided.';
        }

        res.redirect('/admin/issues?error=' + encodeURIComponent(errorMsg));
    }
};

exports.returnBook = async (req, res) => {
    try {
        const issue_id = req.params.id;
        
        if (!issue_id) {
            throw new Error('INVALID_INPUT');
        }

        await IssueModel.returnIssue(parseInt(issue_id, 10));

        res.redirect('/admin/issues?success=Book+returned+successfully');
    } catch (err) {
        console.error('Return Book Error:', err);
        let errorMsg = 'Unable to complete the return operation. Please try again.';
        
        switch (err.message) {
            case 'ISSUE_NOT_FOUND':
                errorMsg = 'The selected circulation record could not be found.';
                break;
            case 'ALREADY_RETURNED':
                errorMsg = 'This book has already been returned.';
                break;
            case 'INVALID_INPUT':
                errorMsg = 'Invalid issue ID provided.';
                break;
        }

        res.redirect('/admin/issues?error=' + encodeURIComponent(errorMsg));
    }
};
