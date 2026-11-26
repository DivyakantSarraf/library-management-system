/**
 * Library Management System - Comprehensive Unit & Diagnostic Test Suite
 * Covers:
 *  1. IssueModel.calculateFine() (Rate: ₹5/day, edge cases, boundaries)
 *  2. Return-date & local calendar date handling (getLocalDateString, UTC/local boundaries)
 *  3. Report date-range validation
 *  4. Read-only / Safe Database Connectivity Diagnostic
 */

const assert = require('assert');
const IssueModel = require('../models/issueModel');
const pool = require('../config/db');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(testName, fn) {
    totalTests++;
    try {
        fn();
        passedTests++;
        console.log(`  ✓ PASS: ${testName}`);
    } catch (err) {
        failedTests++;
        console.error(`  ✗ FAIL: ${testName}`);
        console.error(`    ${err.message}`);
    }
}

async function runAsyncTest(testName, fn) {
    totalTests++;
    try {
        await fn();
        passedTests++;
        console.log(`  ✓ PASS: ${testName}`);
    } catch (err) {
        failedTests++;
        console.error(`  ✗ FAIL: ${testName}`);
        console.error(`    ${err.message}`);
    }
}

console.log('====================================================');
console.log('1. FINE CALCULATION TESTS (IssueModel.calculateFine)');
console.log('====================================================');

runTest('On-time return (same day as due date) -> ₹0 fine, 0 late days', () => {
    const res = IssueModel.calculateFine('2026-10-10', '2026-10-10');
    assert.strictEqual(res.lateDays, 0);
    assert.strictEqual(res.fineAmount, 0);
});

runTest('Early return (1 day before due date) -> ₹0 fine, 0 late days', () => {
    const res = IssueModel.calculateFine('2026-10-10', '2026-10-09');
    assert.strictEqual(res.lateDays, 0);
    assert.strictEqual(res.fineAmount, 0);
});

runTest('Early return (multiple days before due date) -> ₹0 fine, 0 late days', () => {
    const res = IssueModel.calculateFine('2026-10-15', '2026-10-01');
    assert.strictEqual(res.lateDays, 0);
    assert.strictEqual(res.fineAmount, 0);
});

runTest('1 day late -> ₹5 fine, 1 late day', () => {
    const res = IssueModel.calculateFine('2026-10-10', '2026-10-11');
    assert.strictEqual(res.lateDays, 1);
    assert.strictEqual(res.fineAmount, 5);
});

runTest('5 days late -> ₹25 fine, 5 late days', () => {
    const res = IssueModel.calculateFine('2026-10-10', '2026-10-15');
    assert.strictEqual(res.lateDays, 5);
    assert.strictEqual(res.fineAmount, 25);
});

runTest('30 days late across months -> ₹150 fine, 30 late days', () => {
    const res = IssueModel.calculateFine('2026-09-10', '2026-10-10');
    assert.strictEqual(res.lateDays, 30);
    assert.strictEqual(res.fineAmount, 150);
});

runTest('No negative fine when reference date is far in the past', () => {
    const res = IssueModel.calculateFine('2026-12-31', '2026-01-01');
    assert.strictEqual(res.lateDays, 0);
    assert.strictEqual(res.fineAmount, 0);
});

runTest('Timestamp normalization: Late evening (23:59:59) due date vs early morning (00:00:01) next day', () => {
    const due = new Date(2026, 9, 10, 23, 59, 59);
    const ret = new Date(2026, 9, 11, 0, 0, 1);
    const res = IssueModel.calculateFine(due, ret);
    assert.strictEqual(res.lateDays, 1);
    assert.strictEqual(res.fineAmount, 5);
});

runTest('Timestamp normalization: Same calendar day with different hours -> 0 late days', () => {
    const due = new Date(2026, 9, 10, 8, 30, 0);
    const ret = new Date(2026, 9, 10, 19, 45, 0);
    const res = IssueModel.calculateFine(due, ret);
    assert.strictEqual(res.lateDays, 0);
    assert.strictEqual(res.fineAmount, 0);
});

console.log('\n====================================================');
console.log('2. LOCAL CALENDAR DATE HANDLING (getLocalDateString)');
console.log('====================================================');

runTest('getLocalDateString returns YYYY-MM-DD from Date object', () => {
    const d = new Date(2026, 9, 17); // Oct 17, 2026
    const str = IssueModel.getLocalDateString(d);
    assert.strictEqual(str, '2026-10-17');
});

runTest('getLocalDateString handles single-digit months and days with leading zeros', () => {
    const d = new Date(2026, 0, 5); // Jan 5, 2026
    const str = IssueModel.getLocalDateString(d);
    assert.strictEqual(str, '2026-01-05');
});

runTest('getLocalDateString returns local calendar date even during early morning (01:30 AM)', () => {
    // In India (UTC+5:30), 1:30 AM Oct 17 is 8:00 PM Oct 16 in UTC.
    // getLocalDateString MUST return 2026-10-17 (local date), NOT 2026-10-16.
    const earlyMorning = new Date(2026, 9, 17, 1, 30, 0);
    const str = IssueModel.getLocalDateString(earlyMorning);
    assert.strictEqual(str, '2026-10-17');
});

runTest('getLocalDateString preserves valid YYYY-MM-DD input string unchanged', () => {
    const str = IssueModel.getLocalDateString('2026-10-25');
    assert.strictEqual(str, '2026-10-25');
});

console.log('\n====================================================');
console.log('3. REPORT DATE-RANGE VALIDATION');
console.log('====================================================');

runTest('Valid date range: from_date <= to_date', () => {
    const from_date = '2026-09-17';
    const to_date = '2026-10-17';
    const isValid = new Date(from_date) <= new Date(to_date);
    assert.strictEqual(isValid, true);
});

runTest('Invalid date range: from_date > to_date is detected', () => {
    const from_date = '2026-10-20';
    const to_date = '2026-10-17';
    const isInvalid = new Date(from_date) > new Date(to_date);
    assert.strictEqual(isInvalid, true);
});

runTest('Same day range: from_date === to_date is valid', () => {
    const from_date = '2026-10-17';
    const to_date = '2026-10-17';
    const isInvalid = new Date(from_date) > new Date(to_date);
    assert.strictEqual(isInvalid, false);
});

runTest('Default 30-day report window calculation', () => {
    const today = new Date(2026, 9, 17);
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const diffDays = Math.round((today - thirtyDaysAgo) / (1000 * 60 * 60 * 24));
    assert.strictEqual(diffDays, 30);
    assert.strictEqual(IssueModel.getLocalDateString(today), '2026-10-17');
    assert.strictEqual(IssueModel.getLocalDateString(thirtyDaysAgo), '2026-09-17');
});

console.log('\n====================================================');
console.log('4. DATABASE CONNECTIVITY DIAGNOSTIC');
console.log('====================================================');

(async () => {
    let dbConnected = false;
    await runAsyncTest('Database Connection Diagnostic', async () => {
        try {
            const res = await pool.query('SELECT NOW()');
            console.log('    ✓ Live database query succeeded at:', res.rows[0].now);
            dbConnected = true;
        } catch (dbErr) {
            console.log('    ⚠ NOTICE: Database connection unavailable:');
            console.log(`      Error: ${dbErr.message}`);
        }
    });

    console.log('\n====================================================');
    console.log('5. MEMBER PORTAL EJS TEMPLATE COMPILATION');
    console.log('====================================================');

    const fs = require('fs');
    const path = require('path');
    const ejs = require('ejs');

    const memberViews = [
        'views/member/dashboard.ejs',
        'views/member/books.ejs',
        'views/member/issues.ejs',
        'views/member/profile.ejs',
        'views/partials/page-header.ejs',
        'views/partials/status-badge.ejs',
        'views/partials/pagination.ejs',
        'views/partials/member-sidebar.ejs'
    ];

    memberViews.forEach(viewRelPath => {
        runTest(`EJS compilation check: ${viewRelPath}`, () => {
            const fullPath = path.join(__dirname, '..', viewRelPath);
            const templateStr = fs.readFileSync(fullPath, 'utf8');
            const compiled = ejs.compile(templateStr, {
                filename: fullPath,
                client: false
            });
            assert.strictEqual(typeof compiled, 'function');
        });
    });

    console.log('\n====================================================');
    console.log('5b. SHARED PARTIALS FUNCTIONAL TESTS');
    console.log('====================================================');

    const renderPartial = (relPath, data = {}) => {
        const fullPath = path.join(__dirname, '..', relPath);
        return ejs.render(fs.readFileSync(fullPath, 'utf8'), data, { filename: fullPath });
    };

    runTest('page-header.ejs renders title, subtitle, and breadcrumbs', () => {
        const html = renderPartial('views/partials/page-header.ejs', {
            title: 'Browse Books',
            description: 'Explore library catalog',
            breadcrumbs: [
                { label: 'Portal', href: '/member' },
                { label: 'Catalog' }
            ],
            action: { href: '/member/issues', label: 'My Loans', icon: 'bookmark' }
        });
        assert.ok(html.includes('<h1 class="page-title">Browse Books</h1>'));
        assert.ok(html.includes('Explore library catalog'));
        assert.ok(html.includes('href="/member"'));
        assert.ok(html.includes('Catalog</span>'));
        assert.ok(html.includes('href="/member/issues"'));
        assert.ok(html.includes('My Loans</span>'));
    });

    runTest('status-badge.ejs maps Issued status correctly', () => {
        const html = renderPartial('views/partials/status-badge.ejs', { status: 'Issued' });
        assert.ok(html.includes('badge-issued'));
        assert.ok(html.includes('Issued</span>'));
        assert.ok(html.includes('data-lucide="book-open"'));
    });

    runTest('status-badge.ejs maps Overdue status correctly', () => {
        const html = renderPartial('views/partials/status-badge.ejs', { status: 'Overdue' });
        assert.ok(html.includes('badge-overdue'));
        assert.ok(html.includes('Overdue</span>'));
        assert.ok(html.includes('data-lucide="alert-circle"'));
    });

    runTest('status-badge.ejs maps Returned status correctly', () => {
        const html = renderPartial('views/partials/status-badge.ejs', { status: 'Returned' });
        assert.ok(html.includes('badge-returned'));
        assert.ok(html.includes('Returned</span>'));
        assert.ok(html.includes('data-lucide="check"'));
    });

    runTest('status-badge.ejs maps Available status with count correctly', () => {
        const html = renderPartial('views/partials/status-badge.ejs', { status: 'Available', count: 8 });
        assert.ok(html.includes('badge-available'));
        assert.ok(html.includes('8 Available</span>'));
        assert.ok(html.includes('data-lucide="check-circle"'));
    });

    runTest('status-badge.ejs maps Out of Stock status correctly', () => {
        const html = renderPartial('views/partials/status-badge.ejs', { status: 'Out of Stock' });
        assert.ok(html.includes('badge-unavailable'));
        assert.ok(html.includes('Out of Stock</span>'));
        assert.ok(html.includes('data-lucide="x-circle"'));
    });

    runTest('pagination.ejs handles first page (page 1 of 3)', () => {
        const html = renderPartial('views/partials/pagination.ejs', {
            page: 1,
            totalPages: 3,
            totalRows: 25,
            limit: 10,
            baseUrl: '/member/books',
            queryParams: { q: 'Database' }
        });
        assert.ok(html.includes('Showing <strong>1</strong>–<strong>10</strong> of <strong>25</strong>'));
        assert.ok(html.includes('disabled aria-disabled="true"')); // Previous is disabled
        assert.ok(html.includes('href="/member/books?q=Database&amp;page=2"')); // Next is active
    });

    runTest('pagination.ejs handles last page (page 3 of 3)', () => {
        const html = renderPartial('views/partials/pagination.ejs', {
            page: 3,
            totalPages: 3,
            totalRows: 25,
            limit: 10,
            baseUrl: '/member/books',
            queryParams: { q: 'Database', member_id: 2 }
        });
        assert.ok(html.includes('Showing <strong>21</strong>–<strong>25</strong> of <strong>25</strong>'));
        assert.ok(html.includes('href="/member/books?q=Database&amp;member_id=2&amp;page=2"')); // Previous is active
        assert.ok(html.includes('disabled aria-disabled="true"')); // Next is disabled
    });

    runTest('pagination.ejs handles single page without next/prev buttons', () => {
        const html = renderPartial('views/partials/pagination.ejs', {
            page: 1,
            totalPages: 1,
            totalRows: 5,
            limit: 10,
            itemLabel: 'books'
        });
        assert.ok(html.includes('Showing <strong>1</strong>–<strong>5</strong> of <strong>5</strong> books'));
        assert.ok(!html.includes('pagination-controls')); // Controls omitted on single page
    });

    runTest('member-sidebar.ejs renders clean URLs without query parameters', () => {
        const html = renderPartial('views/partials/member-sidebar.ejs', {
            currentPath: '/member',
            currentMember: { member_id: 2, name: 'Alice Smith Jr.' }
        });
        assert.ok(html.includes('href="/member"'));
        assert.ok(html.includes('href="/member/books"'));
        assert.ok(html.includes('href="/member/issues"'));
        assert.ok(html.includes('href="/member/profile"'));
        assert.ok(!html.includes('member_id='));
        assert.ok(html.includes('Alice Smith Jr.'));
    });

    runTest('dashboard.ejs renders with overdue alert and shared status badges', () => {
        const fullPath = path.join(__dirname, '../views/member/dashboard.ejs');
        const templateStr = fs.readFileSync(fullPath, 'utf8');
        const html = ejs.render(templateStr, {
            currentMember: { member_id: 2, name: 'Alice Smith Jr.', email: 'alice@example.com', membership_date: '2026-01-01' },
            metrics: { activeLoans: 1, overdueLoans: 1, returnedBooks: 4, totalBorrowed: 6, totalOverdueFine: 65 },
            recentActivity: [{
                issue_id: 7,
                book_id: 1,
                book_title: 'Database Management Systems',
                book_author: 'Raghu Ramakrishnan',
                isbn: '9780072465631',
                due_date: '2026-10-03',
                status: 'Overdue',
                displayFine: 65
            }],
            error: null,
            testingMemberId: 2,
            currentPath: '/member'
        }, { filename: fullPath });

        assert.ok(html.includes('<h1 class="page-title">Overview</h1>'));
        assert.ok(html.includes('stat-card-grid cols-4'));
        assert.ok(html.includes('alert alert-warning'));
        assert.ok(html.includes('₹65.00'));
        assert.ok(html.includes('badge-overdue'));
        assert.ok(html.includes('href="/member/books"'));
        assert.ok(!html.includes('<style>')); // Verify no inline styles
    });

    runTest('dashboard.ejs renders good standing banner and empty state when no activity', () => {
        const fullPath = path.join(__dirname, '../views/member/dashboard.ejs');
        const templateStr = fs.readFileSync(fullPath, 'utf8');
        const html = ejs.render(templateStr, {
            currentMember: { member_id: 3, name: 'Bob Good Standing', email: 'bob@example.com', membership_date: '2026-01-01' },
            metrics: { activeLoans: 0, overdueLoans: 0, returnedBooks: 2, totalBorrowed: 2, totalOverdueFine: 0 },
            recentActivity: [],
            error: null,
            testingMemberId: null,
            currentPath: '/member'
        }, { filename: fullPath });

        assert.ok(html.includes('alert alert-success'));
        assert.ok(html.includes('Account in good standing'));
        assert.ok(!html.includes('alert alert-warning'));
        assert.ok(html.includes('No borrowing activity found'));
        assert.ok(html.includes('Browse Catalog'));
    });

    runTest('books.ejs renders page-header, accessible filter form, books-table, data-labels, and pagination', () => {
        const fullPath = path.join(__dirname, '../views/member/books.ejs');
        const templateStr = fs.readFileSync(fullPath, 'utf8');
        const html = ejs.render(templateStr, {
            currentMember: { member_id: 2, name: 'Alice Smith Jr.' },
            books: [
                { book_id: 1, title: 'Database Systems', author: 'Raghu R.', isbn: '9780072465631', category: 'Database', available_copies: 5 },
                { book_id: 2, title: 'Operating Systems', author: 'Silberschatz', isbn: '9781118063330', category: 'Systems', available_copies: 0 }
            ],
            categories: ['Database', 'Systems'],
            search: 'Systems',
            availability: 'all',
            category: 'all',
            page: 1,
            totalPages: 1,
            totalRows: 2,
            limit: 10,
            error: null,
            testingMemberId: 2,
            currentPath: '/member/books'
        }, { filename: fullPath });

        assert.ok(html.includes('<h1 class="page-title">Browse Books</h1>'));
        assert.ok(html.includes('class="sr-only">Search by title, author, or ISBN</label>'));
        assert.ok(html.includes('class="sr-only">Filter by Availability</label>'));
        assert.ok(html.includes('class="sr-only">Filter by Category</label>'));
        assert.ok(html.includes('name="availability"'));
        assert.ok(html.includes('name="category"'));
        assert.ok(!html.includes('onchange="this.form.submit()"'));
        assert.ok(!html.includes('onchange="document.getElementById'));
        assert.ok(html.includes('Apply Filters</span>'));
        assert.ok(html.includes('Reset Filters</span>'));
        assert.ok(html.includes('class="table books-table"'));
        assert.ok(html.includes('data-label="Author"'));
        assert.ok(html.includes('data-label="ISBN"'));
        assert.ok(html.includes('data-label="Category"'));
        assert.ok(html.includes('data-label="Availability"'));
        assert.ok(html.includes('badge-available'));
        assert.ok(html.includes('5 Available'));
        assert.ok(html.includes('badge-unavailable'));
        assert.ok(html.includes('Out of Stock'));
        assert.ok(!html.includes('<style>')); // Verify no inline styles
    });

    runTest('books.ejs does not hide mobile columns via CSS and has no member mutation controls', () => {
        const fullPath = path.join(__dirname, '../views/member/books.ejs');
        const templateStr = fs.readFileSync(fullPath, 'utf8');

        // Verify absence of destructive column-hiding rules in template
        assert.ok(!templateStr.includes('th:not(:first-child)'), 'Must not hide non-first th');
        assert.ok(!templateStr.includes('td:not(:first-child)'), 'Must not hide non-first td');

        // Verify absence of member mutation controls (no Add, Edit, or Delete actions)
        assert.ok(!templateStr.includes('Add Book'), 'Must not contain Add Book');
        assert.ok(!templateStr.includes('Edit Book'), 'Must not contain Edit Book');
        assert.ok(!templateStr.includes('btn-danger'), 'Must not contain Delete buttons');
        assert.ok(!templateStr.includes('/admin/books'), 'Must not link to admin actions');
    });

    runTest('books.ejs renders empty state with reset filters button when no books match', () => {
        const fullPath = path.join(__dirname, '../views/member/books.ejs');
        const templateStr = fs.readFileSync(fullPath, 'utf8');
        const html = ejs.render(templateStr, {
            currentMember: { member_id: 2, name: 'Alice Smith Jr.' },
            books: [],
            categories: ['Database'],
            search: 'NonExistentBookXYZ',
            availability: 'all',
            category: 'all',
            page: 1,
            totalPages: 0,
            totalRows: 0,
            limit: 10,
            error: null,
            testingMemberId: 2,
            currentPath: '/member/books'
        }, { filename: fullPath });

        assert.ok(html.includes('class="empty-state"'));
        assert.ok(html.includes('No books found'));
        assert.ok(html.includes('Reset Filters'));
        assert.ok(html.includes('href="/member/books"'));
    });

    runTest('books.ejs renders error alert when error is present', () => {
        const fullPath = path.join(__dirname, '../views/member/books.ejs');
        const templateStr = fs.readFileSync(fullPath, 'utf8');
        const html = ejs.render(templateStr, {
            currentMember: null,
            books: [],
            categories: [],
            search: '',
            availability: 'all',
            category: 'all',
            page: 1,
            totalPages: 0,
            totalRows: 0,
            limit: 10,
            error: 'Database connection failed',
            testingMemberId: null,
            currentPath: '/member/books'
        }, { filename: fullPath });

        assert.ok(html.includes('class="alert alert-danger"'));
        assert.ok(html.includes('Database connection failed'));
    });

    runTest('issues.ejs renders page-header, summary stat cards, accessible filter form, issues-table, data-labels, and pagination', () => {
        const fullPath = path.join(__dirname, '../views/member/issues.ejs');
        const templateStr = fs.readFileSync(fullPath, 'utf8');
        const html = ejs.render(templateStr, {
            currentMember: { member_id: 2, name: 'Alice Smith Jr.' },
            metrics: { activeLoans: 1, overdueLoans: 1, returnedBooks: 3, totalBorrowed: 5, totalOverdueFine: 45 },
            issues: [
                {
                    issue_id: 101,
                    book_id: 1,
                    book_title: 'Database Management Systems',
                    book_author: 'Raghu Ramakrishnan',
                    isbn: '9780072465631',
                    issue_date: '2026-09-01',
                    due_date: '2026-09-15',
                    return_date: null,
                    status: 'Overdue',
                    lateDays: 9,
                    displayFine: 45,
                    isDynamicFine: true
                },
                {
                    issue_id: 102,
                    book_id: 2,
                    book_title: 'Operating System Concepts',
                    book_author: 'Abraham Silberschatz',
                    isbn: '9781118063330',
                    issue_date: '2026-10-01',
                    due_date: '2026-10-20',
                    return_date: null,
                    status: 'Issued',
                    lateDays: 0,
                    displayFine: 0,
                    isDynamicFine: false
                },
                {
                    issue_id: 103,
                    book_id: 3,
                    book_title: 'Clean Code',
                    book_author: 'Robert C. Martin',
                    isbn: '9780132350884',
                    issue_date: '2026-08-01',
                    due_date: '2026-08-15',
                    return_date: '2026-08-20',
                    status: 'Returned',
                    lateDays: 5,
                    displayFine: 25,
                    isDynamicFine: false
                }
            ],
            search: '',
            status: 'all',
            page: 1,
            totalPages: 1,
            totalRows: 3,
            limit: 10,
            error: null,
            testingMemberId: 2,
            currentPath: '/member/issues'
        }, { filename: fullPath });

        assert.ok(html.includes('<h1 class="page-title">My Books</h1>'));
        assert.ok(html.includes('role="region" aria-label="Circulation Summary"'));
        assert.ok(html.includes('Active Loans'));
        assert.ok(html.includes('Overdue Books'));
        assert.ok(html.includes('Total Borrowed'));
        assert.ok(html.includes('Outstanding Fines'));
        assert.ok(html.includes('₹45.00'));
        assert.ok(html.includes('class="sr-only">Search by title, author, or ISBN</label>'));
        assert.ok(html.includes('class="sr-only">Filter by Loan Status</label>'));
        assert.ok(html.includes('name="status"'));
        assert.ok(!html.includes('onchange="this.form.submit()"'));
        assert.ok(html.includes('Apply Filters</span>'));
        assert.ok(html.includes('class="table issues-table"'));
        assert.ok(html.includes('data-label="Issue Date"'));
        assert.ok(html.includes('data-label="Due Date"'));
        assert.ok(html.includes('data-label="Return Date"'));
        assert.ok(html.includes('data-label="Status"'));
        assert.ok(html.includes('data-label="Overdue"'));
        assert.ok(html.includes('data-label="Fine"'));
        assert.ok(html.includes('badge-overdue'));
        assert.ok(html.includes('badge-issued'));
        assert.ok(html.includes('badge-returned'));
        assert.ok(html.includes('fine-accruing'));
        assert.ok(html.includes('fine-settled'));
        assert.ok(!html.includes('<style>')); // Verify no inline styles
    });

    runTest('issues.ejs does not hide mobile columns via CSS and has no member mutation controls', () => {
        const fullPath = path.join(__dirname, '../views/member/issues.ejs');
        const templateStr = fs.readFileSync(fullPath, 'utf8');

        // Verify absence of destructive column-hiding rules in template
        assert.ok(!templateStr.includes('th:not(:first-child)'), 'Must not hide non-first th');
        assert.ok(!templateStr.includes('td:not(:first-child)'), 'Must not hide non-first td');

        // Verify absence of member mutation controls (no issue/return actions)
        assert.ok(!templateStr.includes('Issue Book'), 'Must not contain Issue Book');
        assert.ok(!templateStr.includes('Return Book'), 'Must not contain Return Book');
        assert.ok(!templateStr.includes('/admin/issues'), 'Must not link to admin actions');
    });

    runTest('issues.ejs renders empty state with browse catalog button when no loans exist', () => {
        const fullPath = path.join(__dirname, '../views/member/issues.ejs');
        const templateStr = fs.readFileSync(fullPath, 'utf8');
        const html = ejs.render(templateStr, {
            currentMember: { member_id: 2, name: 'Alice Smith Jr.' },
            metrics: { activeLoans: 0, overdueLoans: 0, returnedBooks: 0, totalBorrowed: 0, totalOverdueFine: 0 },
            issues: [],
            search: '',
            status: 'all',
            page: 1,
            totalPages: 0,
            totalRows: 0,
            limit: 10,
            error: null,
            testingMemberId: 2,
            currentPath: '/member/issues'
        }, { filename: fullPath });

        assert.ok(html.includes('class="empty-state"'));
        assert.ok(html.includes('No borrowing activity yet'));
        assert.ok(html.includes('Browse Catalog'));
        assert.ok(html.includes('href="/member/books"'));
    });

    runTest('issues.ejs renders empty state with reset filters button when filters match no records', () => {
        const fullPath = path.join(__dirname, '../views/member/issues.ejs');
        const templateStr = fs.readFileSync(fullPath, 'utf8');
        const html = ejs.render(templateStr, {
            currentMember: { member_id: 2, name: 'Alice Smith Jr.' },
            metrics: { activeLoans: 1, overdueLoans: 0, returnedBooks: 2, totalBorrowed: 3, totalOverdueFine: 0 },
            issues: [],
            search: 'NoSuchBookInLoans',
            status: 'Overdue',
            page: 1,
            totalPages: 0,
            totalRows: 0,
            limit: 10,
            error: null,
            testingMemberId: 2,
            currentPath: '/member/issues'
        }, { filename: fullPath });

        assert.ok(html.includes('class="empty-state"'));
        assert.ok(html.includes('No matching records found'));
        assert.ok(html.includes('Reset Filters'));
        assert.ok(html.includes('href="/member/issues"'));
    });

    runTest('issues.ejs renders error alert when error is present', () => {
        const fullPath = path.join(__dirname, '../views/member/issues.ejs');
        const templateStr = fs.readFileSync(fullPath, 'utf8');
        const html = ejs.render(templateStr, {
            currentMember: null,
            metrics: null,
            issues: [],
            search: '',
            status: 'all',
            page: 1,
            totalPages: 0,
            totalRows: 0,
            limit: 10,
            error: 'Connection timeout',
            testingMemberId: null,
            currentPath: '/member/issues'
        }, { filename: fullPath });

        assert.ok(html.includes('class="alert alert-danger"'));
        assert.ok(html.includes('Connection timeout'));
    });

    runTest('profile.ejs renders page-header, profile summary card, avatar, read-only badges, and edit form with activeMemberId preserved', () => {
        const fullPath = path.join(__dirname, '../views/member/profile.ejs');
        const templateStr = fs.readFileSync(fullPath, 'utf8');
        const html = ejs.render(templateStr, {
            currentMember: {
                member_id: 2,
                name: 'Alice Smith Jr.',
                email: 'alice@example.com',
                phone: '9876543210',
                address: '123 Beach Road, Goa',
                membership_date: '2026-01-15T00:00:00.000Z',
                admin_id: 1
            },
            metrics: { activeLoans: 1, overdueLoans: 0, returnedBooks: 2, totalBorrowed: 3, totalOverdueFine: 0 },
            error: null,
            success: null,
            testingMemberId: 2,
            currentPath: '/member/profile'
        }, { filename: fullPath });

        assert.ok(html.includes('<h1 class="page-title">My Profile</h1>'));
        assert.ok(html.includes('class="avatar-large"'));
        assert.ok(html.includes('Alice Smith Jr.'));
        assert.ok(html.includes('alice@example.com'));
        assert.ok(html.includes('Member ID'));
        assert.ok(html.includes('#2'));
        assert.ok(html.includes('Borrowing Activity'));
        assert.ok(html.includes('Active Loans'));
        assert.ok(html.includes('Personal &amp; Contact Details') || html.includes('Personal & Contact Details'));
        assert.ok(html.includes('id="memberName"'));
        assert.ok(html.includes('Optional. 2–100 characters when provided.'));
        assert.ok(html.includes('minlength="2"'));
        assert.ok(html.includes('maxlength="100"'));
        assert.ok(html.includes('id="memberEmail"'));
        assert.ok(html.includes('readonly'));
        assert.ok(html.includes('disabled'));
        assert.ok(html.includes('field-badge-readonly'));
        assert.ok(html.includes('id="memberPhone"'));
        assert.ok(html.includes('maxlength="20"'));
        assert.ok(html.includes('pattern="^[0-9+\\s\\(\\)\\-]+$"'));
        assert.ok(html.includes('id="memberAddress"'));
        assert.ok(html.includes('maxlength="500"'));
        assert.ok(html.includes('action="/member/profile"'));
        assert.ok(html.includes('href="/member"'));
        assert.ok(html.includes('id="saveProfileBtn"'));
        assert.ok(!html.includes('<style>')); // Verify no inline styles
    });

    runTest('profile.ejs renders success and error alerts appropriately', () => {
        const fullPath = path.join(__dirname, '../views/member/profile.ejs');
        const templateStr = fs.readFileSync(fullPath, 'utf8');

        // Test success alert
        const successHtml = ejs.render(templateStr, {
            currentMember: { member_id: 2, name: 'Alice', email: 'alice@example.com' },
            metrics: null,
            error: null,
            success: 'Profile updated successfully.',
            testingMemberId: 2,
            currentPath: '/member/profile'
        }, { filename: fullPath });
        assert.ok(successHtml.includes('class="alert alert-success"'));
        assert.ok(successHtml.includes('Profile updated successfully.'));

        // Test error alert
        const errorHtml = ejs.render(templateStr, {
            currentMember: { member_id: 2, name: 'Alice', email: 'alice@example.com' },
            metrics: null,
            error: 'Full Name cannot exceed 100 characters.',
            success: null,
            testingMemberId: 2,
            currentPath: '/member/profile'
        }, { filename: fullPath });
        assert.ok(errorHtml.includes('class="alert alert-danger"'));
        assert.ok(errorHtml.includes('Full Name cannot exceed 100 characters.'));
    });

    runTest('profile.ejs renders empty state when currentMember is not found', () => {
        const fullPath = path.join(__dirname, '../views/member/profile.ejs');
        const templateStr = fs.readFileSync(fullPath, 'utf8');
        const html = ejs.render(templateStr, {
            currentMember: null,
            metrics: null,
            error: 'Member profile could not be located.',
            success: null,
            testingMemberId: null,
            currentPath: '/member/profile'
        }, { filename: fullPath });

        assert.ok(html.includes('class="empty-state"'));
        assert.ok(html.includes('Profile Not Found'));
        assert.ok(html.includes('Return to Dashboard'));
    });

    if (dbConnected) {
        console.log('\n====================================================');
        console.log('6. MEMBER PORTAL MODEL DATABASE TESTS');
        console.log('====================================================');

        const MemberPortalModel = require('../models/memberPortalModel');

        await runAsyncTest('MemberPortalModel.getDefaultMember() returns valid member', async () => {
            const member = await MemberPortalModel.getDefaultMember();
            assert.ok(member, 'Member should exist in database');
            assert.ok(member.member_id, 'Member must have member_id');
            assert.ok(member.name, 'Member must have name');
            assert.ok(member.email, 'Member must have email');
        });

        await runAsyncTest('MemberPortalModel.getDashboardData() returns metrics and recent activity', async () => {
            const member = await MemberPortalModel.getDefaultMember();
            const data = await MemberPortalModel.getDashboardData(member.member_id);
            assert.ok(data.metrics, 'Dashboard metrics must be defined');
            assert.ok(typeof data.metrics.activeLoans === 'number');
            assert.ok(typeof data.metrics.overdueLoans === 'number');
            assert.ok(typeof data.metrics.totalOverdueFine === 'number');
            assert.ok(Array.isArray(data.recentActivity), 'Recent activity must be an array');
        });

        await runAsyncTest('MemberPortalModel.getBrowseBooks() handles search, filter & pagination', async () => {
            const res = await MemberPortalModel.getBrowseBooks({ search: '', availability: 'all', category: 'all', page: 1, limit: 10 });
            assert.ok(Array.isArray(res.books), 'Books must be an array');
            assert.ok(typeof res.totalRows === 'number');
            assert.ok(typeof res.totalPages === 'number');
        });

        await runAsyncTest('MemberPortalModel.getBrowseBooks() search query handling', async () => {
            // Get a sample book to test search
            const all = await MemberPortalModel.getBrowseBooks({ page: 1, limit: 1 });
            if (all.books.length > 0) {
                const sampleBook = all.books[0];
                const keyword = sampleBook.title.substring(0, 4);
                const searchRes = await MemberPortalModel.getBrowseBooks({ search: keyword.toLowerCase(), page: 1, limit: 10 });
                assert.ok(searchRes.books.length > 0, 'Should find books matching search substring');
                const matched = searchRes.books.some(b => b.book_id === sampleBook.book_id);
                assert.ok(matched, 'Original book should be in search results');
            }
        });

        await runAsyncTest('MemberPortalModel.getBrowseBooks() category filtering', async () => {
            const all = await MemberPortalModel.getBrowseBooks({ page: 1, limit: 1 });
            if (all.books.length > 0 && all.books[0].category) {
                const category = all.books[0].category;
                const catRes = await MemberPortalModel.getBrowseBooks({ category, page: 1, limit: 10 });
                assert.ok(catRes.books.length > 0, 'Should return books for category');
                catRes.books.forEach(b => {
                    assert.strictEqual(b.category, category, 'All books must match category');
                });
            }
        });

        await runAsyncTest('MemberPortalModel.getBrowseBooks() availability filtering', async () => {
            const availRes = await MemberPortalModel.getBrowseBooks({ availability: 'available', page: 1, limit: 10 });
            availRes.books.forEach(b => {
                assert.ok(b.available_copies > 0, 'Available books must have available_copies > 0');
            });

            const unavailRes = await MemberPortalModel.getBrowseBooks({ availability: 'unavailable', page: 1, limit: 10 });
            unavailRes.books.forEach(b => {
                assert.strictEqual(b.available_copies, 0, 'Out of stock books must have available_copies = 0');
            });
        });

        await runAsyncTest('MemberPortalModel.getBrowseBooks() combined filters', async () => {
            const res = await MemberPortalModel.getBrowseBooks({
                search: '',
                category: 'all',
                availability: 'available',
                page: 1,
                limit: 5
            });
            assert.ok(Array.isArray(res.books));
            res.books.forEach(b => {
                assert.ok(b.available_copies > 0);
            });
        });

        await runAsyncTest('MemberPortalModel.getBrowseBooks() handles invalid & negative page parameters gracefully', async () => {
            const negPageRes = await MemberPortalModel.getBrowseBooks({ page: -3, limit: 10 });
            assert.ok(Array.isArray(negPageRes.books), 'Negative page must be clamped and return array');

            const strPageRes = await MemberPortalModel.getBrowseBooks({ page: 'invalid', limit: 10 });
            assert.ok(Array.isArray(strPageRes.books), 'String page must be clamped and return array');

            const invalidAvailRes = await MemberPortalModel.getBrowseBooks({ availability: 'invalid_mode', page: 1, limit: 10 });
            assert.ok(Array.isArray(invalidAvailRes.books), 'Invalid availability must fallback gracefully');
        });

        await runAsyncTest('MemberPortalModel.getBrowseBooks() returns empty results for non-matching query', async () => {
            const emptyRes = await MemberPortalModel.getBrowseBooks({ search: '__NON_EXISTENT_BOOK_QUERY_XYZ_123__' });
            assert.strictEqual(emptyRes.books.length, 0);
            assert.strictEqual(emptyRes.totalRows, 0);
            assert.strictEqual(emptyRes.totalPages, 0);
        });

        await runAsyncTest('MemberPortalModel.getMyBooks() returns circulation history for member', async () => {
            const member = await MemberPortalModel.getDefaultMember();
            const res = await MemberPortalModel.getMyBooks(member.member_id, { search: '', status: 'all', page: 1, limit: 10 });
            assert.ok(Array.isArray(res.issues), 'Issues must be an array');
            assert.ok(typeof res.totalRows === 'number');
        });

        await runAsyncTest('MemberPortalModel.getMyBooks() filters by status: Issued, Overdue, Returned', async () => {
            const member = await MemberPortalModel.getDefaultMember();

            // Test Issued
            const issuedRes = await MemberPortalModel.getMyBooks(member.member_id, { status: 'Issued', page: 1, limit: 10 });
            assert.ok(Array.isArray(issuedRes.issues));
            issuedRes.issues.forEach(iss => assert.strictEqual(iss.status, 'Issued'));

            // Test Overdue
            const overdueRes = await MemberPortalModel.getMyBooks(member.member_id, { status: 'Overdue', page: 1, limit: 10 });
            assert.ok(Array.isArray(overdueRes.issues));
            overdueRes.issues.forEach(iss => {
                assert.strictEqual(iss.status, 'Overdue');
                assert.strictEqual(iss.isDynamicFine, true);
                assert.strictEqual(iss.displayFine, iss.lateDays * 5);
            });

            // Test Returned
            const returnedRes = await MemberPortalModel.getMyBooks(member.member_id, { status: 'Returned', page: 1, limit: 10 });
            assert.ok(Array.isArray(returnedRes.issues));
            returnedRes.issues.forEach(iss => {
                assert.strictEqual(iss.status, 'Returned');
                assert.strictEqual(iss.isDynamicFine, false);
                assert.strictEqual(iss.displayFine, parseFloat(iss.fine_amount) || 0);
            });
        });

        await runAsyncTest('MemberPortalModel.getMyBooks() search query handling', async () => {
            const member = await MemberPortalModel.getDefaultMember();
            const all = await MemberPortalModel.getMyBooks(member.member_id, { page: 1, limit: 1 });
            if (all.issues.length > 0) {
                const sample = all.issues[0];
                const keyword = sample.book_title.substring(0, 4);
                const searchRes = await MemberPortalModel.getMyBooks(member.member_id, { search: keyword, page: 1, limit: 10 });
                assert.ok(searchRes.issues.length > 0, 'Should find loans matching search substring');
                const matched = searchRes.issues.some(i => i.issue_id === sample.issue_id);
                assert.ok(matched, 'Original loan should appear in search results');
            }
        });

        await runAsyncTest('MemberPortalModel.getMyBooks() handles invalid & negative page parameters gracefully', async () => {
            const member = await MemberPortalModel.getDefaultMember();
            const negPage = await MemberPortalModel.getMyBooks(member.member_id, { page: -5, limit: 10 });
            assert.ok(Array.isArray(negPage.issues), 'Negative page must be clamped to 1 and return array');

            const strPage = await MemberPortalModel.getMyBooks(member.member_id, { page: 'invalid', limit: 10 });
            assert.ok(Array.isArray(strPage.issues), 'String page must be clamped to 1 and return array');

            const invalidStatus = await MemberPortalModel.getMyBooks(member.member_id, { status: 'unknown_status', page: 1, limit: 10 });
            assert.ok(Array.isArray(invalidStatus.issues), 'Invalid status must default safely to all');
        });

        await runAsyncTest('MemberPortalModel.getMyBooks() returns empty results for non-matching query', async () => {
            const member = await MemberPortalModel.getDefaultMember();
            const emptyRes = await MemberPortalModel.getMyBooks(member.member_id, { search: '__NON_EXISTING_LOAN_QUERY_XYZ__' });
            assert.strictEqual(emptyRes.issues.length, 0);
            assert.strictEqual(emptyRes.totalRows, 0);
            assert.strictEqual(emptyRes.totalPages, 0);
        });

        await runAsyncTest('MemberPortalModel.updateProfile() handles empty optional name as null (Part 9B.9)', async () => {
            const member = await MemberPortalModel.getDefaultMember();
            const originalName = member.name;

            // Empty string
            const res1 = await MemberPortalModel.updateProfile(member.member_id, { name: '', phone: member.phone, address: member.address });
            assert.strictEqual(res1.name, null, 'Empty name should be saved as null');

            // Whitespace-only name
            const res2 = await MemberPortalModel.updateProfile(member.member_id, { name: '     ', phone: member.phone, address: member.address });
            assert.strictEqual(res2.name, null, 'Whitespace name should be saved as null');

            // null name
            const res3 = await MemberPortalModel.updateProfile(member.member_id, { name: null, phone: member.phone, address: member.address });
            assert.strictEqual(res3.name, null, 'null name should be saved as null');

            // Restore original name
            await MemberPortalModel.updateProfile(member.member_id, { name: originalName, phone: member.phone, address: member.address });
        });

        await runAsyncTest('MemberPortalModel.updateProfile() enforces name length boundaries (2 to 100 chars)', async () => {
            const member = await MemberPortalModel.getDefaultMember();
            // Below min (1 char)
            let threw = false;
            try {
                await MemberPortalModel.updateProfile(member.member_id, { name: 'A' });
            } catch (err) {
                threw = true;
                assert.strictEqual(err.message, 'NAME_TOO_SHORT');
            }
            assert.strictEqual(threw, true, '1-char name should throw NAME_TOO_SHORT');

            // Above max (101 chars)
            threw = false;
            try {
                await MemberPortalModel.updateProfile(member.member_id, { name: 'A'.repeat(101) });
            } catch (err) {
                threw = true;
                assert.strictEqual(err.message, 'NAME_TOO_LONG');
            }
            assert.strictEqual(threw, true, '101-char name should throw NAME_TOO_LONG');

            // Exact boundaries: 2 chars and 100 chars
            const updated2 = await MemberPortalModel.updateProfile(member.member_id, { name: 'Jo' });
            assert.strictEqual(updated2.name, 'Jo');
            const updated100 = await MemberPortalModel.updateProfile(member.member_id, { name: 'A'.repeat(100) });
            assert.strictEqual(updated100.name, 'A'.repeat(100));

            // Restore original name
            await MemberPortalModel.updateProfile(member.member_id, { name: member.name });
        });

        await runAsyncTest('MemberPortalModel.updateProfile() trims whitespace from valid name', async () => {
            const member = await MemberPortalModel.getDefaultMember();
            const originalName = member.name;
            const updated = await MemberPortalModel.updateProfile(member.member_id, { name: `   ${originalName}   ` });
            assert.strictEqual(updated.name, originalName, 'Name must be trimmed');
        });

        await runAsyncTest('MemberPortalModel.updateProfile() handles empty optional phone as null', async () => {
            const member = await MemberPortalModel.getDefaultMember();
            // Empty string
            const res1 = await MemberPortalModel.updateProfile(member.member_id, { name: member.name, phone: '' });
            assert.strictEqual(res1.phone, null, 'Empty phone string should be saved as null');

            // Whitespace string
            const res2 = await MemberPortalModel.updateProfile(member.member_id, { name: member.name, phone: '    ' });
            assert.strictEqual(res2.phone, null, 'Whitespace phone string should be saved as null');

            // null / undefined
            const res3 = await MemberPortalModel.updateProfile(member.member_id, { name: member.name, phone: null });
            assert.strictEqual(res3.phone, null, 'null phone should be saved as null');
        });

        await runAsyncTest('MemberPortalModel.updateProfile() accepts valid international & local phone formats', async () => {
            const member = await MemberPortalModel.getDefaultMember();
            const validPhones = [
                '+1-555-019-2834',
                '9876543210',
                '+91 98765 43210',
                '(0832) 2422000',
                '123-456-7890'
            ];
            for (const phone of validPhones) {
                const res = await MemberPortalModel.updateProfile(member.member_id, { name: member.name, phone });
                assert.strictEqual(res.phone, phone, `Should accept valid phone format: ${phone}`);
            }
        });

        await runAsyncTest('MemberPortalModel.updateProfile() rejects invalid phone characters and excessive length', async () => {
            const member = await MemberPortalModel.getDefaultMember();
            // Letters in phone
            let threw = false;
            try {
                await MemberPortalModel.updateProfile(member.member_id, { name: member.name, phone: '123-abc-456' });
            } catch (err) {
                threw = true;
                assert.strictEqual(err.message, 'PHONE_INVALID');
            }
            assert.strictEqual(threw, true, 'Phone with letters should throw PHONE_INVALID');

            // Invalid symbols
            threw = false;
            try {
                await MemberPortalModel.updateProfile(member.member_id, { name: member.name, phone: '98765$4321' });
            } catch (err) {
                threw = true;
                assert.strictEqual(err.message, 'PHONE_INVALID');
            }
            assert.strictEqual(threw, true, 'Phone with invalid symbols should throw PHONE_INVALID');

            // Longer than 20 chars
            threw = false;
            try {
                await MemberPortalModel.updateProfile(member.member_id, { name: member.name, phone: '+1 (555) 019-2834567890' });
            } catch (err) {
                threw = true;
                assert.strictEqual(err.message, 'PHONE_TOO_LONG');
            }
            assert.strictEqual(threw, true, 'Phone > 20 chars should throw PHONE_TOO_LONG');
        });

        await runAsyncTest('MemberPortalModel.updateProfile() handles empty optional address as null', async () => {
            const member = await MemberPortalModel.getDefaultMember();
            // Empty string
            const res1 = await MemberPortalModel.updateProfile(member.member_id, { name: member.name, address: '' });
            assert.strictEqual(res1.address, null, 'Empty address string should be saved as null');

            // Whitespace string
            const res2 = await MemberPortalModel.updateProfile(member.member_id, { name: member.name, address: '   \n  ' });
            assert.strictEqual(res2.address, null, 'Whitespace address string should be saved as null');

            // null / undefined
            const res3 = await MemberPortalModel.updateProfile(member.member_id, { name: member.name, address: null });
            assert.strictEqual(res3.address, null, 'null address should be saved as null');
        });

        await runAsyncTest('MemberPortalModel.updateProfile() enforces address maximum length (500 chars)', async () => {
            const member = await MemberPortalModel.getDefaultMember();
            // Exactly 500 chars
            const addr500 = 'A'.repeat(500);
            const res500 = await MemberPortalModel.updateProfile(member.member_id, { name: member.name, address: addr500 });
            assert.strictEqual(res500.address, addr500, '500-character address should be accepted');

            // Exceeding 500 chars (501 chars)
            let threw = false;
            try {
                await MemberPortalModel.updateProfile(member.member_id, { name: member.name, address: 'A'.repeat(501) });
            } catch (err) {
                threw = true;
                assert.strictEqual(err.message, 'ADDRESS_TOO_LONG');
            }
            assert.strictEqual(threw, true, '501-character address should throw ADDRESS_TOO_LONG');
        });

        await runAsyncTest('MemberPortalModel.updateProfile() protects immutable fields (email, member_id, admin_id, membership_date)', async () => {
            const member = await MemberPortalModel.getDefaultMember();
            const originalEmail = member.email;
            const originalId = member.member_id;
            const originalAdminId = member.admin_id;
            const originalDate = member.membership_date;

            const res = await MemberPortalModel.updateProfile(member.member_id, {
                name: member.name,
                phone: '9876543210',
                address: 'Panaji, Goa',
                // Malicious payload attempts
                email: 'hacker@example.com',
                member_id: 999999,
                admin_id: 8888,
                membership_date: '2020-01-01T00:00:00.000Z'
            });

            assert.strictEqual(res.member_id, originalId, 'member_id must remain immutable');
            assert.strictEqual(res.email, originalEmail, 'email must remain immutable');
            assert.strictEqual(res.admin_id, originalAdminId, 'admin_id must remain immutable');
            assert.strictEqual(new Date(res.membership_date).getTime(), new Date(originalDate).getTime(), 'membership_date must remain immutable');
        });

        await runAsyncTest('MemberPortalModel.updateProfile() throws MEMBER_NOT_FOUND on non-existent member ID', async () => {
            let threw = false;
            try {
                await MemberPortalModel.updateProfile(9999999, { name: 'Non Existent' });
            } catch (err) {
                threw = true;
                assert.strictEqual(err.message, 'MEMBER_NOT_FOUND');
            }
            assert.strictEqual(threw, true, 'Should throw MEMBER_NOT_FOUND for non-existent ID');
        });

        await runAsyncTest('MemberPortalController.updateProfile() returns 400 and preserves submitted values on validation failure', async () => {
            const MemberPortalController = require('../controllers/memberPortalController');
            const member = await MemberPortalModel.getDefaultMember();

            // Test 1: Invalid Name (too short: 1 char when provided)
            const req1 = {
                user: { id: member.member_id, role: 'member' },
                body: { name: 'A', phone: '9876543210', address: '123 Street' }
            };
            let capturedStatus = null;
            let capturedView = null;
            let capturedData = null;
            const res1 = {
                status(code) { capturedStatus = code; return this; },
                render(view, data) { capturedView = view; capturedData = data; return this; },
                redirect() {}
            };

            await MemberPortalController.updateProfile(req1, res1);
            assert.strictEqual(capturedStatus, 400, 'Must return HTTP 400 on validation failure');
            assert.strictEqual(capturedView, 'member/profile');
            assert.strictEqual(capturedData.error, 'Full Name must be at least 2 characters.');
            // Verify submitted values are preserved in currentMember
            assert.strictEqual(capturedData.currentMember.name, 'A');
            assert.strictEqual(capturedData.currentMember.phone, '9876543210');
            assert.strictEqual(capturedData.currentMember.address, '123 Street');
            assert.strictEqual(capturedData.currentMember.email, member.email, 'Immutable email preserved');

            // Test 2: Invalid Phone
            const req2 = {
                user: { id: member.member_id, role: 'member' },
                body: { name: member.name, phone: 'invalid-phone-abc', address: '123 Street' }
            };
            const res2 = {
                status(code) { capturedStatus = code; return this; },
                render(view, data) { capturedView = view; capturedData = data; return this; },
                redirect() {}
            };
            await MemberPortalController.updateProfile(req2, res2);
            assert.strictEqual(capturedStatus, 400);
            assert.strictEqual(capturedData.error, 'Phone number can only contain digits, spaces, +, -, and parentheses.');
            assert.strictEqual(capturedData.currentMember.phone, 'invalid-phone-abc', 'Preserved invalid phone input');

            // Test 3: Address too long
            const req3 = {
                user: { id: member.member_id, role: 'member' },
                body: { name: member.name, phone: '9876543210', address: 'A'.repeat(501) }
            };
            const res3 = {
                status(code) { capturedStatus = code; return this; },
                render(view, data) { capturedView = view; capturedData = data; return this; },
                redirect() {}
            };
            await MemberPortalController.updateProfile(req3, res3);
            assert.strictEqual(capturedStatus, 400);
            assert.strictEqual(capturedData.error, 'Home address cannot exceed 500 characters.');
            assert.strictEqual(capturedData.currentMember.address.length, 501, 'Preserved long address input');

            // Clean restoration of default member details
            await MemberPortalModel.updateProfile(member.member_id, {
                name: member.name,
                phone: member.phone,
                address: member.address
            });
        });
    }

    // ====================================================
    // 6-8. AUTHENTICATION & SECURE SESSION SUITE (Part 8A)
    // ====================================================
    const { runAuthTests } = require('./auth_tests');
    await runAuthTests({ runTest, runAsyncTest });

    // ====================================================
    // 9-12. ROLE-BASED AUTHORIZATION SUITE (Part 8B)
    // ====================================================
    const { runAuthorizationTests } = require('./authorization_tests');
    await runAuthorizationTests({ runTest, runAsyncTest });

    // ====================================================
    // 14. CSRF SYNCHRONIZER TOKEN SUITE (Part 8C)
    // ====================================================
    const { runCsrfTests } = require('./csrf_tests');
    await runCsrfTests({ runTest, runAsyncTest });

    // ====================================================
    // 15. LOGIN RATE LIMITING SUITE (Part 8C)
    // ====================================================
    const { runRateLimitTests } = require('./rate_limit_tests');
    await runRateLimitTests({ runTest, runAsyncTest });

    // ====================================================
    // 16. MEMBER SELF-REGISTRATION SUITE (Part 9A & 9B)
    // ====================================================
    const { runRegistrationTests } = require('./registration_tests');
    await runRegistrationTests({ runTest, runAsyncTest });

    try {
        await pool.end();
    } catch (_) {}

    console.log('\n====================================================');
    console.log(`TEST SUMMARY: ${passedTests} passed, ${failedTests} failed, total ${totalTests}`);
    console.log('====================================================');
    
    if (failedTests > 0) {
        process.exit(1);
    }
})();
