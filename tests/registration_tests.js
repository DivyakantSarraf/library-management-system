/**
 * Member Self-Registration & Profile Completion Unit Test Suite (Part 9A & 9B)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const ejs = require('ejs');
const bcrypt = require('bcrypt');
const pool = require('../config/db');
const AuthService = require('../services/authService');
const AuthController = require('../controllers/authController');
const MemberModel = require('../models/memberModel');
const MemberController = require('../controllers/memberController');
const MemberPortalModel = require('../models/memberPortalModel');
const MemberPortalController = require('../controllers/memberPortalController');
const { requireGuest } = require('../middleware/authMiddleware');
const {
    createRegistrationRateLimiter,
    resetRegistrationRateLimits,
    resetRateLimits,
    checkRateLimit,
    MAX_REGISTRATIONS_PER_IP
} = require('../middleware/rateLimitMiddleware');

async function runRegistrationTests(harness) {
    let runTest = harness?.runTest;
    let runAsyncTest = harness?.runAsyncTest;
    let standalone = false;
    let failedCount = 0;

    if (!runTest) {
        standalone = true;
        runTest = (name, fn) => {
            try {
                fn();
                console.log(`  ✓ PASS: ${name}`);
            } catch (err) {
                failedCount++;
                console.error(`  ✗ FAIL: ${name}\n    ${err.message}`);
            }
        };
        runAsyncTest = async (name, fn) => {
            try {
                await fn();
                console.log(`  ✓ PASS: ${name}`);
            } catch (err) {
                failedCount++;
                console.error(`  ✗ FAIL: ${name}\n    ${err.message}`);
            }
        };
    }

    console.log('\n====================================================');
    console.log('16. MEMBER SELF-REGISTRATION & PROFILE SUITE (PART 9)');
    console.log('====================================================');

    // 1. Username normalization
    runTest('Registration: Username is trimmed and normalized to lowercase', () => {
        const res = AuthService.validateRegistrationInput({
            username: '  AlEx.Reader_01  ',
            email: 'alex@example.com',
            password: 'ValidPassword123',
            confirmPassword: 'ValidPassword123'
        });
        assert.strictEqual(res.valid, true);
        assert.strictEqual(res.normalized.username, 'alex.reader_01');
    });

    // 2. Email normalization
    runTest('Registration: Email is trimmed and normalized to lowercase', () => {
        const res = AuthService.validateRegistrationInput({
            username: 'alex_reader',
            email: '  Alex.Reader@Example.COM  ',
            password: 'ValidPassword123',
            confirmPassword: 'ValidPassword123'
        });
        assert.strictEqual(res.valid, true);
        assert.strictEqual(res.normalized.email, 'alex.reader@example.com');
    });

    // 3. Username format validation
    runTest('Registration: Username validation enforces length (3-50), no @, and allowed chars', () => {
        const tooShort = AuthService.validateRegistrationInput({
            username: 'ab', email: 'a@b.co', password: 'Password123', confirmPassword: 'Password123'
        });
        assert.strictEqual(tooShort.valid, false);
        assert.ok(tooShort.fieldErrors.username);

        const tooLong = AuthService.validateRegistrationInput({
            username: 'a'.repeat(51), email: 'a@b.co', password: 'Password123', confirmPassword: 'Password123'
        });
        assert.strictEqual(tooLong.valid, false);

        const withAt = AuthService.validateRegistrationInput({
            username: 'user@domain', email: 'a@b.co', password: 'Password123', confirmPassword: 'Password123'
        });
        assert.strictEqual(withAt.valid, false);
        assert.ok(withAt.fieldErrors.username.includes('@'));

        const badChars = AuthService.validateRegistrationInput({
            username: 'bad user!', email: 'a@b.co', password: 'Password123', confirmPassword: 'Password123'
        });
        assert.strictEqual(badChars.valid, false);
    });

    // 4. Email validation
    runTest('Registration: Email validation rejects invalid formats and >150 chars', () => {
        const bad1 = AuthService.validateRegistrationInput({
            username: 'validuser', email: 'not-an-email', password: 'Password123', confirmPassword: 'Password123'
        });
        assert.strictEqual(bad1.valid, false);
        assert.ok(bad1.fieldErrors.email);

        const bad2 = AuthService.validateRegistrationInput({
            username: 'validuser', email: `${'a'.repeat(145)}@b.com`, password: 'Password123', confirmPassword: 'Password123'
        });
        assert.strictEqual(bad2.valid, false);
    });

    // 5. Password minimum length
    runTest('Registration: Password validation enforces minimum 8 characters', () => {
        const shortPwd = AuthService.validateRegistrationInput({
            username: 'validuser', email: 'valid@example.com', password: '1234567', confirmPassword: '1234567'
        });
        assert.strictEqual(shortPwd.valid, false);
        assert.ok(shortPwd.fieldErrors.password.includes('8 characters'));

        const exact8 = AuthService.validateRegistrationInput({
            username: 'validuser', email: 'valid@example.com', password: '12345678', confirmPassword: '12345678'
        });
        assert.strictEqual(exact8.valid, true);
    });

    // 6. Password maximum UTF-8 byte length (no silent truncation)
    runTest('Registration: Password enforces maximum 72 UTF-8 bytes without silent truncation', () => {
        const ascii72 = 'a'.repeat(72);
        const ok72 = AuthService.validateRegistrationInput({
            username: 'validuser', email: 'valid@example.com', password: ascii72, confirmPassword: ascii72
        });
        assert.strictEqual(ok72.valid, true);

        const ascii73 = 'a'.repeat(73);
        const over73 = AuthService.validateRegistrationInput({
            username: 'validuser', email: 'valid@example.com', password: ascii73, confirmPassword: ascii73
        });
        assert.strictEqual(over73.valid, false);
        assert.ok(over73.fieldErrors.password.includes('72 UTF-8 bytes'));

        // Multi-byte UTF-8 characters: 20 emojis * 4 bytes = 80 bytes (< 72 chars, > 72 bytes)
        const emoji80Bytes = '😀'.repeat(20);
        assert.strictEqual(emoji80Bytes.length, 40); // UTF-16 code units < 72
        assert.strictEqual(Buffer.byteLength(emoji80Bytes, 'utf8'), 80);
        const overUtf8 = AuthService.validateRegistrationInput({
            username: 'validuser', email: 'valid@example.com', password: emoji80Bytes, confirmPassword: emoji80Bytes
        });
        assert.strictEqual(overUtf8.valid, false);
        assert.ok(overUtf8.fieldErrors.password.includes('72 UTF-8 bytes'));
    });

    // 7. Password mismatch
    runTest('Registration: Rejects mismatched confirmPassword', () => {
        const mismatch = AuthService.validateRegistrationInput({
            username: 'validuser', email: 'valid@example.com', password: 'Password123', confirmPassword: 'Password456'
        });
        assert.strictEqual(mismatch.valid, false);
        assert.ok(mismatch.fieldErrors.confirmPassword.includes('do not match'));
    });

    // 8. Non-string and malformed inputs
    runTest('Registration: Rejects arrays, objects, and non-string inputs safely', () => {
        const malformed = AuthService.validateRegistrationInput({
            username: ['user1'],
            email: { $ne: '' },
            password: ['Password123'],
            confirmPassword: { a: 1 }
        });
        assert.strictEqual(malformed.valid, false);
        assert.ok(malformed.fieldErrors.username);
        assert.ok(malformed.fieldErrors.email);
        assert.ok(malformed.fieldErrors.password);
        assert.ok(malformed.fieldErrors.confirmPassword);
    });

    // 9 & 10 & 11 & 12. Hashing (12 rounds), no plaintext persistence, strict member role, role injection prevention
    await runAsyncTest('Registration: Hashes password with 12 rounds, persists NULL optional fields, enforces role=member & ignores injected role/admin_id', async () => {
        const originalQuery = pool.query;
        let capturedSql = null;
        let capturedParams = null;

        pool.query = async (sql, params) => {
            capturedSql = sql;
            capturedParams = params;
            return {
                rows: [{
                    member_id: 101,
                    username: params[0],
                    email: params[1],
                    name: null,
                    phone: null,
                    address: null,
                    membership_date: '2026-11-26'
                }]
            };
        };

        try {
            const res = await AuthService.registerMember({
                username: 'NewMember_99',
                email: 'NewMember@Example.com',
                password: 'StrongPassword99!',
                confirmPassword: 'StrongPassword99!',
                role: 'admin',
                admin_id: 1
            });

            assert.strictEqual(res.success, true);
            assert.strictEqual(res.user.role, 'member');
            assert.strictEqual(res.user.username, 'newmember_99');
            assert.strictEqual(res.user.email, 'newmember@example.com');
            assert.strictEqual(res.user.name, null);
            assert.strictEqual(res.user.password, undefined);
            assert.strictEqual(res.user.password_hash, undefined);

            assert.ok(capturedSql.includes('INSERT INTO members'), 'Must insert into members table');
            assert.ok(capturedSql.includes('NULL, NULL, NULL, CURRENT_DATE, NULL'), 'Must set name, phone, address, admin_id to NULL');
            assert.strictEqual(capturedParams[0], 'newmember_99');
            assert.strictEqual(capturedParams[1], 'newmember@example.com');
            assert.notStrictEqual(capturedParams[2], 'StrongPassword99!', 'Plaintext password must never be sent to DB');
            assert.ok(capturedParams[2].startsWith('$2b$12$'), 'Must use bcrypt with 12 salt rounds');
            assert.strictEqual(bcrypt.getRounds(capturedParams[2]), 12);
            assert.strictEqual(await bcrypt.compare('StrongPassword99!', capturedParams[2]), true);
        } finally {
            pool.query = originalQuery;
        }
    });

    // 13, 14, 15, 16. Duplicate username/email/case-variant & PostgreSQL 23505 handling
    await runAsyncTest('Registration: PostgreSQL 23505 collisions (username, email, case-variant) return identical generic 409 error', async () => {
        const originalQuery = pool.query;
        const constraints = [
            'members_username_key',
            'members_email_key',
            'idx_members_username_lower',
            'idx_members_email_lower',
            undefined
        ];
        const messages = new Set();

        try {
            for (const constraint of constraints) {
                pool.query = async () => {
                    const err = new Error('duplicate key value violates unique constraint');
                    err.code = '23505';
                    if (constraint) err.constraint = constraint;
                    throw err;
                };

                const res = await AuthService.registerMember({
                    username: 'DuplicateUser',
                    email: 'Duplicate@Example.com',
                    password: 'ValidPassword123',
                    confirmPassword: 'ValidPassword123'
                });

                assert.strictEqual(res.success, false);
                assert.strictEqual(res.status, 409);
                assert.strictEqual(res.code, 'DUPLICATE_ACCOUNT');
                assert.ok(!res.message.toLowerCase().includes('username already'));
                assert.ok(!res.message.toLowerCase().includes('email already'));
                messages.add(res.message);
            }
            assert.strictEqual(messages.size, 1, 'All duplicate constraints must yield one identical generic message');
        } finally {
            pool.query = originalQuery;
        }
    });

    // 17. Legacy DEFERRED_AUTH protection & case-insensitive verifyMember
    await runAsyncTest('Registration & Auth: Legacy DEFERRED_AUTH accounts remain untouched and verifyMember uses case-insensitive lookup', async () => {
        const originalQuery = pool.query;
        let capturedQuery = '';
        let capturedParams = null;

        pool.query = async (sql, params) => {
            capturedQuery = sql;
            capturedParams = params;
            return {
                rows: [{
                    member_id: 2,
                    username: 'legacy_user_123',
                    password_hash: 'DEFERRED_AUTH',
                    name: 'Legacy Member',
                    email: 'legacy@example.com'
                }]
            };
        };

        try {
            const verifyRes = await AuthService.verifyMember('LEGACY@EXAMPLE.COM', 'AnyPassword123');
            assert.strictEqual(verifyRes.success, false);
            assert.ok(capturedQuery.includes('LOWER(username) = LOWER($1)'), 'Must match username case-insensitively');
            assert.ok(capturedQuery.includes('LOWER(email) = LOWER($1)'), 'Must match email case-insensitively');
            assert.strictEqual(capturedParams[0], 'LEGACY@EXAMPLE.COM');
        } finally {
            pool.query = originalQuery;
        }
    });

    // 18 & 19 & 20. Optional profile completion, Skip action, and Profile editing with no name
    await runAsyncTest('Profile Completion: Skip action leaves DB untouched and redirects to /member', async () => {
        const originalUpdate = MemberPortalModel.updateProfile;
        let updateCalled = false;
        MemberPortalModel.updateProfile = async () => {
            updateCalled = true;
            return {};
        };

        try {
            let redirectedTo = null;
            const req = {
                user: { id: 55, role: 'member', username: 'new_member', name: null },
                body: { action: 'skip', name: '', phone: '', address: '' }
            };
            const res = {
                redirect: (url) => { redirectedTo = url; },
                status: () => res,
                render: () => {}
            };

            await AuthController.postCompleteProfile(req, res);
            assert.strictEqual(updateCalled, false, 'Skip must not write fabricated values to DB');
            assert.strictEqual(redirectedTo, '/member');
        } finally {
            MemberPortalModel.updateProfile = originalUpdate;
        }
    });

    await runAsyncTest('Profile Completion & Editing: Complete saves optional fields, and saving phone/address without name succeeds with name=null', async () => {
        const originalQuery = pool.query;
        const dbRow = {
            member_id: 77,
            username: 'skipper',
            name: null,
            email: 'skipper@example.com',
            phone: null,
            address: null,
            membership_date: '2026-11-26',
            admin_id: null
        };

        pool.query = async (sql, params) => {
            if (sql.includes('CASE WHEN $1::boolean')) {
                const [hasName, nameVal, hasPhone, phoneVal, hasAddress, addressVal] = params;
                if (hasName) dbRow.name = nameVal;
                if (hasPhone) dbRow.phone = phoneVal;
                if (hasAddress) dbRow.address = addressVal;
                return { rows: [{ ...dbRow }] };
            }
            return { rows: [] };
        };

        try {
            const updated = await MemberPortalModel.updateProfile(77, {
                name: '',
                phone: '+91 98765 43210',
                address: '42 Book Street'
            });
            assert.strictEqual(updated.name, null, 'Empty name must persist as NULL');
            assert.strictEqual(updated.phone, '+91 98765 43210');
            assert.strictEqual(updated.address, '42 Book Street');

            // Controller /member/complete-profile with action=complete
            let redirectedTo = null;
            const req = {
                user: { id: 77, role: 'member', username: 'skipper' },
                body: { action: 'complete', name: 'Alex Reader', phone: '9876543210', address: 'Panaji' }
            };
            const res = {
                redirect: (url) => { redirectedTo = url; },
                status: () => res,
                render: () => {}
            };
            await AuthController.postCompleteProfile(req, res);
            assert.ok(redirectedTo.startsWith('/member?success='));
            assert.strictEqual(dbRow.name, 'Alex Reader');
        } finally {
            pool.query = originalQuery;
        }
    });

    // 21 & 22. Session regeneration & CSRF token rotation on registration
    await runAsyncTest('Registration Controller: Regenerates session, rotates CSRF token, logs in user, saves session, and redirects to /member/complete-profile', async () => {
        const originalRegister = AuthService.registerMember;
        AuthService.registerMember = async () => ({
            success: true,
            status: 201,
            user: { id: 88, username: 'freshuser', email: 'fresh@example.com', name: null, role: 'member' }
        });

        try {
            const sequence = [];
            const initialToken = 'old_pre_reg_csrf_token';
            let redirectedTo = null;
            let loggedInUser = null;

            const req = {
                body: { username: 'freshuser', email: 'fresh@example.com', password: 'Password123', confirmPassword: 'Password123' },
                session: {
                    csrfToken: initialToken,
                    regenerate: (cb) => {
                        sequence.push('regenerate');
                        req.session.id = 'new_session_id';
                        cb(null);
                    },
                    save: (cb) => {
                        sequence.push('save');
                        cb(null);
                    }
                },
                res: { locals: { csrfToken: initialToken } },
                login: (user, cb) => {
                    sequence.push('login');
                    loggedInUser = user;
                    cb(null);
                }
            };
            const res = {
                locals: req.res.locals,
                redirect: (url) => {
                    sequence.push('redirect');
                    redirectedTo = url;
                },
                status: () => res,
                render: () => {}
            };

            await AuthController.postMemberRegister(req, res, (err) => { if (err) throw err; });

            assert.deepStrictEqual(sequence, ['regenerate', 'login', 'save', 'redirect']);
            assert.strictEqual(redirectedTo, '/member/complete-profile');
            assert.strictEqual(loggedInUser.role, 'member');
            assert.notStrictEqual(req.session.csrfToken, initialToken, 'CSRF token must rotate on registration');
            assert.strictEqual(res.locals.csrfToken, req.session.csrfToken);
        } finally {
            AuthService.registerMember = originalRegister;
        }
    });

    // 23. Registration rate limiter threshold & isolation from login limiter & ignoring X-Forwarded-For
    runTest('Registration RateLimit: Allows 5 POSTs per IP, blocks 6th with HTTP 429 & Retry-After, ignores spoofed X-Forwarded-For, isolated from login limiter', () => {
        resetRateLimits();
        resetRegistrationRateLimits();
        const limiter = createRegistrationRateLimiter();
        const clientIp = '203.0.113.50';

        for (let i = 1; i <= MAX_REGISTRATIONS_PER_IP; i++) {
            let passed = false;
            limiter(
                { ip: clientIp, headers: { 'x-forwarded-for': `198.51.100.${i}` }, body: {} },
                { setHeader: () => {}, status: () => ({ render: () => {}, json: () => {} }) },
                () => { passed = true; }
            );
            assert.strictEqual(passed, true, `Attempt #${i} should be allowed`);
        }

        // 6th attempt from same socket IP (even with different X-Forwarded-For) must be 429
        let statusCode = null;
        let retryAfter = null;
        let renderedView = null;
        limiter(
            { ip: clientIp, headers: { 'x-forwarded-for': '198.51.100.99' }, body: { username: 'u6', email: 'u6@example.com' } },
            {
                setHeader: (k, v) => { if (k.toLowerCase() === 'retry-after') retryAfter = v; },
                status: (code) => {
                    statusCode = code;
                    return {
                        render: (view) => { renderedView = view; },
                        json: () => {}
                    };
                }
            },
            () => assert.fail('6th registration attempt must be blocked')
        );

        assert.strictEqual(statusCode, 429);
        assert.ok(parseInt(retryAfter, 10) > 0, 'Retry-After header must be positive');
        assert.strictEqual(renderedView, 'auth/member-register');

        // Login rate limiter for same IP must remain unaffected
        assert.strictEqual(checkRateLimit(clientIp, 'someuser').isLimited, false);
        resetRegistrationRateLimits();
    });

    // 24. Guest-only registration middleware
    runTest('requireGuest: Allows guests, redirects authenticated member/admin on GET, returns 403 on POST', () => {
        let nextCalled = false;
        requireGuest({ isAuthenticated: () => false, user: null, method: 'GET', headers: {} }, {}, () => { nextCalled = true; });
        assert.strictEqual(nextCalled, true);

        let memberRedirect = null;
        requireGuest(
            { isAuthenticated: () => true, user: { id: 1, role: 'member' }, method: 'GET', headers: {} },
            { redirect: (u) => { memberRedirect = u; } },
            () => assert.fail('Authenticated member must not pass requireGuest')
        );
        assert.strictEqual(memberRedirect, '/member');

        let adminRedirect = null;
        requireGuest(
            { isAuthenticated: () => true, user: { id: 1, role: 'admin' }, method: 'GET', headers: {} },
            { redirect: (u) => { adminRedirect = u; } },
            () => assert.fail('Authenticated admin must not pass requireGuest')
        );
        assert.strictEqual(adminRedirect, '/admin');

        let postStatus = null;
        requireGuest(
            { isAuthenticated: () => true, user: { id: 1, role: 'member' }, method: 'POST', path: '/member/register', headers: {} },
            { status: (c) => { postStatus = c; return { render: () => {}, json: () => {} }; } },
            () => assert.fail('Authenticated member POST must be blocked')
        );
        assert.strictEqual(postStatus, 403);
    });

    // 25. EJS Template compilation & NULL-name / NULL-admin_id safety
    await runAsyncTest('Templates: Registration & portal EJS views compile and render safely when name and admin_id are NULL', async () => {
        const regHtml = await ejs.renderFile(path.join(__dirname, '../views/auth/member-register.ejs'), {
            csrfToken: 'test-csrf',
            error: null,
            fieldErrors: {},
            submittedUsername: '',
            submittedEmail: ''
        });
        assert.ok(regHtml.includes('name="_csrf"'));
        assert.ok(regHtml.includes('action="/member/register"'));

        const completeHtml = await ejs.renderFile(path.join(__dirname, '../views/auth/member-complete-profile.ejs'), {
            csrfToken: 'test-csrf',
            currentMember: { username: 'null_name_user', name: null },
            error: null,
            fieldErrors: {},
            formValues: {}
        });
        assert.ok(completeHtml.includes('value="complete"'));
        assert.ok(completeHtml.includes('value="skip"'));
        assert.ok(completeHtml.includes('null_name_user'));

        const dashHtml = await ejs.renderFile(path.join(__dirname, '../views/member/dashboard.ejs'), {
            csrfToken: 'test-csrf',
            currentPath: '/member',
            currentMember: { member_id: 10, username: 'skipper', name: null, email: 'skipper@example.com', membership_date: '2026-11-26', admin_id: null },
            metrics: { activeLoans: 0, overdueLoans: 0, returnedBooks: 0, totalBorrowed: 0, totalOverdueFine: 0 },
            recentActivity: [],
            error: null
        });
        assert.ok(dashHtml.includes('Welcome back, skipper'));
        assert.ok(!dashHtml.includes('Welcome back, null'));

        const profileHtml = await ejs.renderFile(path.join(__dirname, '../views/member/profile.ejs'), {
            csrfToken: 'test-csrf',
            currentPath: '/member/profile',
            currentMember: { member_id: 10, username: 'skipper', name: null, email: 'skipper@example.com', phone: null, address: null, membership_date: '2026-11-26', admin_id: null },
            metrics: { activeLoans: 0, overdueLoans: 0, returnedBooks: 0, totalBorrowed: 0, totalOverdueFine: 0 },
            error: null,
            success: null
        });
        assert.ok(profileHtml.includes('Self-Registered'));
        assert.ok(profileHtml.includes('skipper'));
        assert.ok(!profileHtml.includes('required \n'));

        const adminMembersHtml = await ejs.renderFile(path.join(__dirname, '../views/admin/members.ejs'), {
            csrfToken: 'test-csrf',
            currentPath: '/admin/members',
            currentUser: { username: 'admin1', role: 'admin' },
            members: [{ member_id: 10, username: 'skipper', name: null, email: 'skipper@example.com', phone: null, address: null, membership_date: '2026-11-26', admin_id: null }],
            search: '',
            page: 1,
            totalPages: 1,
            totalRows: 1,
            error: null,
            success: null
        });
        assert.ok(adminMembersHtml.includes('skipper'));
        assert.ok(adminMembersHtml.includes('Self-Registered'));
        assert.ok(!adminMembersHtml.includes('<input type="text" id="name" name="name" class="form-control" required'));
    });

    // 26. Correction A: Admin editing NULL-name members & optional name on admin create/update
    await runAsyncTest('Correction A: Admin can create/update member with NULL/empty name, update email/phone/address without name, edit named member, and invalid email/date rejected', async () => {
        const originalQuery = pool.query;
        const memberStore = {
            10: {
                member_id: 10,
                username: 'self_reg_user',
                name: null,
                email: 'self@example.com',
                phone: null,
                address: null,
                membership_date: '2026-11-26',
                admin_id: null
            }
        };

        pool.query = async (sql, params = []) => {
            const trimmedSql = sql.trim();
            if (trimmedSql.includes('SELECT admin_id FROM admins')) {
                return { rows: [{ admin_id: 1 }] };
            }
            if (trimmedSql.startsWith('INSERT INTO members')) {
                const [name, email, phone, address, membership_date, username] = params;
                const row = { member_id: 11, username, name, email, phone, address, membership_date, admin_id: 1 };
                memberStore[11] = row;
                return { rows: [row] };
            }
            if (trimmedSql.startsWith('UPDATE members')) {
                const [name, email, phone, address, membership_date, id] = params;
                const row = memberStore[parseInt(id, 10)];
                if (!row) return { rows: [] };
                row.name = name;
                row.email = email;
                row.phone = phone;
                row.address = address;
                row.membership_date = membership_date;
                return { rows: [{ ...row }] };
            }
            return { rows: [] };
        };

        try {
            let redirectUrl = null;
            const makeRes = () => ({ redirect: (u) => { redirectUrl = u; } });

            // 1. Update NULL-name self-registered member email without providing name
            await MemberController.updateMember({
                params: { id: '10' },
                body: { name: '', email: 'UpdatedSelf@Example.com', phone: '', address: '', membership_date: '2026-11-26' }
            }, makeRes());
            assert.ok(redirectUrl.includes('success=Member+updated+successfully'), `Expected success redirect, got ${redirectUrl}`);
            assert.strictEqual(memberStore[10].name, null);
            assert.strictEqual(memberStore[10].email, 'updatedself@example.com');

            // 2. Update phone/address without providing a name
            await MemberController.updateMember({
                params: { id: '10' },
                body: { email: 'updatedself@example.com', phone: '+91 98765 00001', address: '12 Main St', membership_date: '2026-11-26' }
            }, makeRes());
            assert.ok(redirectUrl.includes('success=Member+updated+successfully'));
            assert.strictEqual(memberStore[10].name, null);
            assert.strictEqual(memberStore[10].phone, '+91 98765 00001');
            assert.strictEqual(memberStore[10].address, '12 Main St');

            // 3. Edit named member
            await MemberController.updateMember({
                params: { id: '10' },
                body: { name: 'Named Member', email: 'updatedself@example.com', phone: '9876543210', address: 'Goa', membership_date: '2026-11-26' }
            }, makeRes());
            assert.ok(redirectUrl.includes('success=Member+updated+successfully'));
            assert.strictEqual(memberStore[10].name, 'Named Member');

            // 4. Create member without name
            await MemberController.addMember({
                body: { name: '', email: 'NoName@Example.com', phone: '', address: '', membership_date: '2026-11-26' }
            }, makeRes());
            assert.ok(redirectUrl.includes('success=Member+added+successfully'));
            assert.strictEqual(memberStore[11].name, null);
            assert.strictEqual(memberStore[11].email, 'noname@example.com');

            // 5. Reject invalid email and invalid membership_date
            await MemberController.updateMember({
                params: { id: '10' },
                body: { name: 'Valid Name', email: 'not-an-email', membership_date: '2026-11-26' }
            }, makeRes());
            assert.ok(redirectUrl.includes('error='));

            await MemberController.updateMember({
                params: { id: '10' },
                body: { name: 'Valid Name', email: 'valid@example.com', membership_date: 'not-a-date' }
            }, makeRes());
            assert.ok(redirectUrl.includes('error='));
        } finally {
            pool.query = originalQuery;
        }
    });

    // 27. Correction B: MemberModel 23505 handling for email, username, case-variants, missing constraint, and non-unique DB errors
    await runAsyncTest('Correction B: MemberModel handles 23505 across email/username/case-variant/no-constraint and propagates non-unique errors', async () => {
        const originalQuery = pool.query;

        try {
            const cases = [
                { constraint: 'members_email_key', expected: 'DUPLICATE_EMAIL' },
                { constraint: 'idx_members_email_lower', expected: 'DUPLICATE_EMAIL' },
                { constraint: 'members_username_key', expected: 'DUPLICATE_USERNAME' },
                { constraint: 'idx_members_username_lower', expected: 'DUPLICATE_USERNAME' },
                { constraint: undefined, expected: 'DUPLICATE_MEMBER' }
            ];

            for (const c of cases) {
                pool.query = async (sql) => {
                    if (sql.includes('SELECT admin_id FROM admins')) return { rows: [{ admin_id: 1 }] };
                    const err = new Error('duplicate key');
                    err.code = '23505';
                    if (c.constraint) err.constraint = c.constraint;
                    throw err;
                };

                await assert.rejects(
                    () => MemberModel.addMember({ name: 'Test', email: 'test@example.com', phone: null, address: null, membership_date: '2026-11-26' }),
                    (err) => err.message === c.expected
                );
                await assert.rejects(
                    () => MemberModel.updateMember(1, { name: 'Test', email: 'test@example.com', phone: null, address: null, membership_date: '2026-11-26' }),
                    (err) => err.message === c.expected
                );
            }

            // Non-unique DB error must continue through existing error path
            pool.query = async (sql) => {
                if (sql.includes('SELECT admin_id FROM admins')) return { rows: [{ admin_id: 1 }] };
                const err = new Error('connection terminated unexpectedly');
                err.code = '57P01';
                throw err;
            };
            await assert.rejects(
                () => MemberModel.addMember({ name: 'Test', email: 'test@example.com', phone: null, address: null, membership_date: '2026-11-26' }),
                (err) => err.code === '57P01'
            );
        } finally {
            pool.query = originalQuery;
        }
    });

    // 28. Correction C: Partial profile updates preserve omitted fields and clear explicit empty/null fields
    await runAsyncTest('Correction C: Partial profile updates preserve omitted fields, clear explicit empty/null fields, support full form, and isolate members', async () => {
        const originalQuery = pool.query;
        const rowsById = {
            10: { member_id: 10, username: 'alice', name: 'Alice Smith', email: 'alice@example.com', phone: '1112223333', address: 'Old Address', membership_date: '2026-01-01', admin_id: null },
            20: { member_id: 20, username: 'bob', name: 'Bob Jones', email: 'bob@example.com', phone: '9998887777', address: 'Bob Address', membership_date: '2026-01-01', admin_id: 1 }
        };

        pool.query = async (sql, params) => {
            if (sql.includes('CASE WHEN $1::boolean')) {
                const [hasName, nameVal, hasPhone, phoneVal, hasAddress, addressVal, memberId] = params;
                const row = rowsById[parseInt(memberId, 10)];
                if (!row) return { rows: [] };
                if (hasName) row.name = nameVal;
                if (hasPhone) row.phone = phoneVal;
                if (hasAddress) row.address = addressVal;
                return { rows: [{ ...row }] };
            }
            if (sql.includes('FROM members') && sql.includes('WHERE member_id = $1')) {
                const row = rowsById[parseInt(params[0], 10)];
                return { rows: row ? [{ ...row }] : [] };
            }
            return { rows: [] };
        };

        try {
            // 1. Phone-only partial update preserves name & address
            const rPhone = await MemberPortalModel.updateProfile(10, { phone: '5550001111' });
            assert.strictEqual(rPhone.name, 'Alice Smith');
            assert.strictEqual(rPhone.phone, '5550001111');
            assert.strictEqual(rPhone.address, 'Old Address');

            // 2. Address-only partial update preserves name & phone
            const rAddr = await MemberPortalModel.updateProfile(10, { address: 'New Address' });
            assert.strictEqual(rAddr.name, 'Alice Smith');
            assert.strictEqual(rAddr.phone, '5550001111');
            assert.strictEqual(rAddr.address, 'New Address');

            // 3. Name-only partial update preserves phone & address
            const rName = await MemberPortalModel.updateProfile(10, { name: 'Alice Updated' });
            assert.strictEqual(rName.name, 'Alice Updated');
            assert.strictEqual(rName.phone, '5550001111');
            assert.strictEqual(rName.address, 'New Address');

            // 4. Explicitly clearing name preserves phone & address
            const cName = await MemberPortalModel.updateProfile(10, { name: '' });
            assert.strictEqual(cName.name, null);
            assert.strictEqual(cName.phone, '5550001111');
            assert.strictEqual(cName.address, 'New Address');

            // 5. Explicitly clearing phone preserves name & address
            await MemberPortalModel.updateProfile(10, { name: 'Alice Restored' });
            const cPhone = await MemberPortalModel.updateProfile(10, { phone: null });
            assert.strictEqual(cPhone.name, 'Alice Restored');
            assert.strictEqual(cPhone.phone, null);
            assert.strictEqual(cPhone.address, 'New Address');

            // 6. Explicitly clearing address preserves name & phone
            await MemberPortalModel.updateProfile(10, { phone: '7778889999' });
            const cAddr = await MemberPortalModel.updateProfile(10, { address: '   ' });
            assert.strictEqual(cAddr.name, 'Alice Restored');
            assert.strictEqual(cAddr.phone, '7778889999');
            assert.strictEqual(cAddr.address, null);

            // 7 & 8. Controller full HTML submission + partial controller submission scoped strictly to req.user.id
            let redirectTarget = null;
            await MemberPortalController.updateProfile({
                user: { id: 10, role: 'member' },
                body: { member_id: '20', phone: '4445556666' }
            }, { redirect: (u) => { redirectTarget = u; } });
            assert.ok(redirectTarget.includes('/member/profile?success='));
            assert.strictEqual(rowsById[10].name, 'Alice Restored');
            assert.strictEqual(rowsById[10].phone, '4445556666');
            assert.strictEqual(rowsById[20].phone, '9998887777', 'Other member must remain untouched');
        } finally {
            pool.query = originalQuery;
        }
    });

    // 29. Correction D: Malformed/non-string/unknown action rejected with HTTP 400
    await runAsyncTest('Correction D: postCompleteProfile rejects array, object, and unknown string actions with HTTP 400', async () => {
        const originalUpdate = MemberPortalModel.updateProfile;
        let updateCalled = false;
        MemberPortalModel.updateProfile = async () => { updateCalled = true; return {}; };

        try {
            const invalidActions = [
                ['skip', 'complete'],
                { value: 'skip' },
                'unknown_action',
                ''
            ];

            for (const badAction of invalidActions) {
                let statusCode = null;
                let renderedView = null;
                await AuthController.postCompleteProfile({
                    user: { id: 55, role: 'member', username: 'new_member' },
                    body: { action: badAction, name: 'Test User' }
                }, {
                    status: (code) => { statusCode = code; return { render: (v) => { renderedView = v; } }; },
                    redirect: () => assert.fail('Invalid action must not redirect')
                });
                assert.strictEqual(statusCode, 400, `Action ${JSON.stringify(badAction)} must return 400`);
                assert.strictEqual(renderedView, 'auth/member-complete-profile');
                assert.strictEqual(updateCalled, false, 'Invalid action must not update DB');
            }
        } finally {
            MemberPortalModel.updateProfile = originalUpdate;
        }
    });

    // 30. Part 9D.1: Unicode-safe HTML pattern attributes & Self-Registered badge CSS
    await runAsyncTest('Part 9D.1: HTML pattern attributes compile under ES2024 v flag and match server rules, and Self-Registered badge prevents wrapping', async () => {
        const regHtml = await ejs.renderFile(path.join(__dirname, '../views/auth/member-register.ejs'), {
            csrfToken: 'test-csrf',
            error: null,
            fieldErrors: {},
            submittedUsername: '',
            submittedEmail: ''
        });
        const completeHtml = await ejs.renderFile(path.join(__dirname, '../views/auth/member-complete-profile.ejs'), {
            csrfToken: 'test-csrf',
            currentMember: { username: 'pattern_tester', name: null },
            error: null,
            fieldErrors: {},
            formValues: {}
        });
        const profileHtml = await ejs.renderFile(path.join(__dirname, '../views/member/profile.ejs'), {
            csrfToken: 'test-csrf',
            currentPath: '/member/profile',
            currentMember: { member_id: 10, username: 'pattern_tester', name: null, email: 'pattern@example.com', phone: null, address: null, membership_date: '2026-11-26', admin_id: null },
            metrics: { activeLoans: 0, overdueLoans: 0, returnedBooks: 0, totalBorrowed: 0, totalOverdueFine: 0 },
            error: null,
            success: null
        });
        const adminMembersHtml = await ejs.renderFile(path.join(__dirname, '../views/admin/members.ejs'), {
            csrfToken: 'test-csrf',
            currentPath: '/admin/members',
            currentUser: { username: 'admin1', role: 'admin' },
            members: [{ member_id: 10, username: 'skipper', name: null, email: 'skipper@example.com', phone: null, address: null, membership_date: '2026-11-26', admin_id: null }],
            search: '',
            page: 1,
            totalPages: 1,
            totalRows: 1,
            error: null,
            success: null
        });

        const extractPattern = (html, fieldId) => {
            const inputMatch = html.match(new RegExp(`id="${fieldId}"[^>]*pattern="([^"]+)"|pattern="([^"]+)"[^>]*id="${fieldId}"`));
            assert.ok(inputMatch, `Expected pattern attribute on #${fieldId}`);
            return inputMatch[1] || inputMatch[2];
        };

        const usernamePattern = extractPattern(regHtml, 'regUsername');
        const completePhonePattern = extractPattern(completeHtml, 'profilePhone');
        const profilePhonePattern = extractPattern(profileHtml, 'memberPhone');

        assert.strictEqual(usernamePattern, '^[a-zA-Z0-9._\\-]+$');
        assert.strictEqual(completePhonePattern, '^[0-9+\\s\\(\\)\\-]+$');
        assert.strictEqual(profilePhonePattern, '^[0-9+\\s\\(\\)\\-]+$');

        // Chrome compiles <input pattern="..."> with the Unicode-aware /v (unicodeSets) flag
        const usernameVRegex = new RegExp(`^(?:${usernamePattern})$`, 'v');
        const completePhoneVRegex = new RegExp(`^(?:${completePhonePattern})$`, 'v');
        const profilePhoneVRegex = new RegExp(`^(?:${profilePhonePattern})$`, 'v');

        for (const validUsername of ['student01', 'student.name', 'student_name', 'student-name']) {
            assert.strictEqual(usernameVRegex.test(validUsername), true, `HTML pattern must allow valid username: ${validUsername}`);
            const serverCheck = AuthService.validateRegistrationInput({
                username: validUsername,
                email: 'valid@example.com',
                password: 'ValidPassword123',
                confirmPassword: 'ValidPassword123'
            });
            assert.strictEqual(serverCheck.valid, true, `Server validation must allow valid username: ${validUsername}`);
        }

        for (const invalidUsername of ['student@name', 'student name']) {
            assert.strictEqual(usernameVRegex.test(invalidUsername), false, `HTML pattern must reject invalid username: ${invalidUsername}`);
            const serverCheck = AuthService.validateRegistrationInput({
                username: invalidUsername,
                email: 'valid@example.com',
                password: 'ValidPassword123',
                confirmPassword: 'ValidPassword123'
            });
            assert.strictEqual(serverCheck.valid, false, `Server validation must reject invalid username: ${invalidUsername}`);
        }

        for (const validPhone of ['9876543210', '+91 9876543210', '98765-43210', '(987) 654-3210']) {
            assert.strictEqual(completePhoneVRegex.test(validPhone), true, `complete-profile pattern must allow valid phone: ${validPhone}`);
            assert.strictEqual(profilePhoneVRegex.test(validPhone), true, `member profile pattern must allow valid phone: ${validPhone}`);
            const normalized = MemberPortalModel.validateProfileInput({ phone: validPhone });
            assert.strictEqual(normalized.phone, validPhone, `Server validation must allow valid phone: ${validPhone}`);
        }

        assert.strictEqual(completePhoneVRegex.test('98765abc'), false, 'complete-profile pattern must reject invalid phone: 98765abc');
        assert.strictEqual(profilePhoneVRegex.test('98765abc'), false, 'member profile pattern must reject invalid phone: 98765abc');
        assert.throws(() => MemberPortalModel.validateProfileInput({ phone: '98765abc' }), /PHONE_INVALID/);

        // Targeted Self-Registered badge CSS rules
        assert.ok(adminMembersHtml.includes('class="member-self-registered-badge">Self-Registered</span>'));
        assert.ok(adminMembersHtml.includes('.member-self-registered-badge'));
        assert.ok(adminMembersHtml.includes('white-space: nowrap;'));
        assert.ok(adminMembersHtml.includes('flex-wrap: wrap;'));
    });

    if (standalone && failedCount > 0) {
        throw new Error(`${failedCount} registration test(s) failed.`);
    }
}

if (require.main === module) {
    (async () => {
        try {
            await runRegistrationTests();
            console.log('\n✅ All Member Self-Registration unit tests passed successfully.');
        } catch (err) {
            console.error('\n❌ Registration unit test failure:', err);
            process.exit(1);
        } finally {
            try { await pool.end(); } catch (_) {}
        }
    })();
}

module.exports = { runRegistrationTests };
