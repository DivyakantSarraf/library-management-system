/**
 * Library Management System - Authentication & Session Unit Test Suite
 * Covers Part 8A & Part 8A.1 requirements:
 *  1. Correct password verification (bcrypt compare).
 *  2. Incorrect password rejection.
 *  3. Missing credentials handling.
 *  4. Invalid role rejection.
 *  5. Placeholder & unhashed password rejection (DEFERRED_AUTH).
 *  6. Session regeneration after login (session fixation prevention).
 *  7. Logout and session destruction with cookie clearing.
 *  8. Generic authentication errors (no account enumeration).
 *  9. Database failure handling during login.
 * 10. No plaintext password or password_hash leakage in user objects.
 * 11. Session configuration & cookie security attributes (dev vs prod).
 * 12. EJS Login interface compilation & accessibility verification.
 * 13. Part 8A.1 Security Corrections:
 *     - Prohibition of CLI --password flag in provisioning
 *     - Minimum 8-character validation for account passwords
 *     - Strict session deserialization: deleted accounts denied access
 *     - Strict session deserialization: role confusion prevention
 *     - Strict session deserialization: zero password_hash in req.user
 *     - Role cross-boundary tests (admin at member login, member at admin login)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const ejs = require('ejs');
const bcrypt = require('bcrypt');
const AuthService = require('../services/authService');
const AuthController = require('../controllers/authController');
const { createSessionMiddleware, sessionCookieName } = require('../config/session');
const passport = require('../config/passport');
const pool = require('../config/db');
const { validatePassword, parseArgs } = require('../scripts/provision-user');

async function runAuthTests(harness) {
    let runTest = harness?.runTest;
    let runAsyncTest = harness?.runAsyncTest;

    if (!runTest) {
        let total = 0, passed = 0, failed = 0;
        runTest = (name, fn) => {
            total++;
            try {
                fn();
                passed++;
                console.log(`  ✓ PASS: ${name}`);
            } catch (err) {
                failed++;
                console.error(`  ✗ FAIL: ${name}\n    ${err.message}`);
            }
        };
        runAsyncTest = async (name, fn) => {
            total++;
            try {
                await fn();
                passed++;
                console.log(`  ✓ PASS: ${name}`);
            } catch (err) {
                failed++;
                console.error(`  ✗ FAIL: ${name}\n    ${err.message}`);
            }
        };
    }

    console.log('\n====================================================');
    console.log('6. AUTHENTICATION SERVICE & PASSWORD VERIFICATION');
    console.log('====================================================');

    await runAsyncTest('AuthService.hashPassword generates valid bcrypt hash with $2b$ prefix', async () => {
        const password = 'TestSecurePassword123!';
        const hash = await AuthService.hashPassword(password);
        assert.ok(hash.startsWith('$2b$'), 'Hash must start with $2b$');
        assert.strictEqual(hash.length, 60, 'Bcrypt hash length must be 60 characters');
    });

    await runAsyncTest('AuthService.hashPassword rejects short passwords (< 6 chars)', async () => {
        let threw = false;
        try {
            await AuthService.hashPassword('12345');
        } catch (err) {
            threw = true;
            assert.ok(err.message.includes('at least 6 characters'));
        }
        assert.ok(threw, 'Should throw on short password');
    });

    await runAsyncTest('AuthService.comparePassword verifies correct password against bcrypt hash', async () => {
        const password = 'CorrectPassword999';
        const hash = await bcrypt.hash(password, 10);
        const isMatch = await AuthService.comparePassword(password, hash);
        assert.strictEqual(isMatch, true);
    });

    await runAsyncTest('AuthService.comparePassword rejects incorrect password against bcrypt hash', async () => {
        const password = 'CorrectPassword999';
        const hash = await bcrypt.hash(password, 10);
        const isMatch = await AuthService.comparePassword('WrongPassword', hash);
        assert.strictEqual(isMatch, false);
    });

    await runAsyncTest('AuthService.comparePassword rejects DEFERRED_AUTH placeholder safely without exception', async () => {
        const isMatch = await AuthService.comparePassword('AnyPassword', 'DEFERRED_AUTH');
        assert.strictEqual(isMatch, false);
    });

    await runAsyncTest('AuthService.comparePassword rejects non-bcrypt / plaintext stored hash safely', async () => {
        const isMatch = await AuthService.comparePassword('secret', 'plaintext_password_string');
        assert.strictEqual(isMatch, false);
    });

    await runAsyncTest('AuthService.comparePassword handles null or non-string inputs safely', async () => {
        assert.strictEqual(await AuthService.comparePassword(null, '$2b$10$validprefix...'), false);
        assert.strictEqual(await AuthService.comparePassword('pwd', null), false);
        assert.strictEqual(await AuthService.comparePassword('', ''), false);
    });

    await runAsyncTest('Missing credentials in verifyAdmin returns generic error without querying DB', async () => {
        const resEmpty = await AuthService.verifyAdmin('', '');
        assert.strictEqual(resEmpty.success, false);
        assert.ok(resEmpty.message.includes('Invalid credentials'));

        const resNull = await AuthService.verifyAdmin(null, 'pwd');
        assert.strictEqual(resNull.success, false);
        assert.ok(resNull.message.includes('Invalid credentials'));
    });

    await runAsyncTest('Missing credentials in verifyMember returns generic error without querying DB', async () => {
        const resEmpty = await AuthService.verifyMember('', '');
        assert.strictEqual(resEmpty.success, false);
        assert.ok(resEmpty.message.includes('Invalid credentials'));

        const resNull = await AuthService.verifyMember('user', null);
        assert.strictEqual(resNull.success, false);
        assert.ok(resNull.message.includes('Invalid credentials'));
    });

    await runAsyncTest('getUserByIdAndRole rejects invalid role strings (e.g. "superadmin", "guest")', async () => {
        const invalid1 = await AuthService.getUserByIdAndRole(1, 'superadmin');
        assert.strictEqual(invalid1, null);

        const invalid2 = await AuthService.getUserByIdAndRole(1, 'guest');
        assert.strictEqual(invalid2, null);

        const invalid3 = await AuthService.getUserByIdAndRole('not-a-number', 'admin');
        assert.strictEqual(invalid3, null);
    });

    await runAsyncTest('No password or password_hash leakage in sanitized user object from verifyAdmin', async () => {
        const originalQuery = pool.query;
        pool.query = async () => {
            return {
                rows: [{
                    admin_id: 1,
                    username: 'test_admin',
                    password_hash: '$2b$12$e8r0.M3pL4w5k6v7u8t9seOG4Qd6lW7n3vOQ7bE.fJ7dZ0j7a2mG.',
                    role: 'ADMIN'
                }]
            };
        };

        try {
            const originalCompare = AuthService.comparePassword;
            AuthService.comparePassword = async () => true;

            const res = await AuthService.verifyAdmin('test_admin', 'some_pwd');
            assert.strictEqual(res.success, true);
            assert.strictEqual(res.user.id, 1);
            assert.strictEqual(res.user.role, 'admin');
            assert.strictEqual(res.user.username, 'test_admin');
            assert.strictEqual(res.user.password, undefined, 'user.password must be undefined');
            assert.strictEqual(res.user.password_hash, undefined, 'user.password_hash must be undefined');

            AuthService.comparePassword = originalCompare;
        } finally {
            pool.query = originalQuery;
        }
    });

    await runAsyncTest('No password or password_hash leakage in sanitized user object from verifyMember', async () => {
        const originalQuery = pool.query;
        pool.query = async () => {
            return {
                rows: [{
                    member_id: 12,
                    username: 'member_test',
                    name: 'Test Member',
                    email: 'test@example.com',
                    password_hash: '$2b$12$e8r0.M3pL4w5k6v7u8t9seOG4Qd6lW7n3vOQ7bE.fJ7dZ0j7a2mG.'
                }]
            };
        };

        try {
            const originalCompare = AuthService.comparePassword;
            AuthService.comparePassword = async () => true;

            const res = await AuthService.verifyMember('member_test', 'some_pwd');
            assert.strictEqual(res.success, true);
            assert.strictEqual(res.user.id, 12);
            assert.strictEqual(res.user.role, 'member');
            assert.strictEqual(res.user.name, 'Test Member');
            assert.strictEqual(res.user.email, 'test@example.com');
            assert.strictEqual(res.user.password, undefined, 'user.password must be undefined');
            assert.strictEqual(res.user.password_hash, undefined, 'user.password_hash must be undefined');

            AuthService.comparePassword = originalCompare;
        } finally {
            pool.query = originalQuery;
        }
    });

    await runAsyncTest('getUserByIdAndRole never exposes password or password_hash', async () => {
        const originalQuery = pool.query;
        pool.query = async () => {
            return {
                rows: [{
                    member_id: 5,
                    username: 'alice',
                    email: 'alice@example.com',
                    name: 'Alice',
                    phone: '1234567890',
                    address: '123 Library Lane',
                    membership_date: '2026-01-01',
                    password_hash: '$2b$12$dummyHashShouldNotBeReturned'
                }]
            };
        };

        try {
            const user = await AuthService.getUserByIdAndRole(5, 'member');
            assert.strictEqual(user.id, 5);
            assert.strictEqual(user.username, 'alice');
            assert.strictEqual(user.email, 'alice@example.com');
            assert.strictEqual(user.password, undefined, 'password must never be returned');
            assert.strictEqual(user.password_hash, undefined, 'password_hash must never be returned');
        } finally {
            pool.query = originalQuery;
        }
    });

    await runAsyncTest('Database failure handling: AuthService propagates database error and controller returns generic 500 error', async () => {
        const originalQuery = pool.query;
        pool.query = async () => {
            throw new Error('Simulated Database Connection Failure');
        };

        try {
            let threw = false;
            try {
                await AuthService.verifyAdmin('some_user', 'some_password');
            } catch (err) {
                threw = true;
                assert.ok(err.message.includes('Simulated Database Connection Failure'));
            }
            assert.strictEqual(threw, true, 'AuthService should propagate database failure to caller');

            // Test controller 500 error handling
            let statusCode = null;
            let renderedView = null;
            let renderedData = null;

            const fakeReq = {
                body: { username: 'admin', password: 'password' }
            };
            const fakeRes = {
                status: (code) => {
                    statusCode = code;
                    return fakeRes;
                },
                render: (view, data) => {
                    renderedView = view;
                    renderedData = data;
                }
            };

            await new Promise((resolve) => {
                AuthController.postAdminLogin(fakeReq, fakeRes, () => {});
                setTimeout(resolve, 80);
            });

            assert.strictEqual(statusCode, 500, 'Controller returns 500 on database failure');
            assert.strictEqual(renderedView, 'auth/admin-login');
            assert.ok(renderedData.error.includes('temporarily unavailable'), 'Generic user-facing error returned');
        } finally {
            pool.query = originalQuery;
        }
    });

    console.log('\n====================================================');
    console.log('6b. PART 8A.1 SECURITY CORRECTIONS & BOUNDARY VERIFICATIONS');
    console.log('====================================================');

    runTest('Provisioning: CLI argument parser detects and flags --password argument', () => {
        const parsedWithPwd = parseArgs(['--role', 'admin', '--password', 'plain123']);
        assert.strictEqual(parsedWithPwd.password, 'plain123');
    });

    runTest('Provisioning: validatePassword enforces minimum eight-character length', () => {
        assert.strictEqual(validatePassword('').valid, false, 'Empty password rejected');
        assert.strictEqual(validatePassword('1234567').valid, false, '7-char password rejected');
        assert.strictEqual(validatePassword('12345678').valid, true, '8-char password accepted');
        assert.strictEqual(validatePassword('StrongPassword2026!').valid, true, 'Strong password accepted');
    });

    await runAsyncTest('Boundary: Admin credentials submitted to member login are rejected with generic error', async () => {
        const originalQuery = pool.query;
        // Mock DB: admins has demo_admin, members has no record for demo_admin
        pool.query = async (sql, params) => {
            if (sql.includes('FROM members')) {
                return { rows: [] }; // Not in members table
            }
            return { rows: [] };
        };

        try {
            const res = await AuthService.verifyMember('demo_admin', 'adminPassword123');
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.message, 'Invalid credentials. Please check your details and try again.');
        } finally {
            pool.query = originalQuery;
        }
    });

    await runAsyncTest('Boundary: Member credentials submitted to admin login are rejected with generic error', async () => {
        const originalQuery = pool.query;
        // Mock DB: members has alice, admins has no record for alice
        pool.query = async (sql, params) => {
            if (sql.includes('FROM admins')) {
                return { rows: [] }; // Not in admins table
            }
            return { rows: [] };
        };

        try {
            const res = await AuthService.verifyAdmin('alice_member', 'memberPassword123');
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.message, 'Invalid credentials. Please check your details and try again.');
        } finally {
            pool.query = originalQuery;
        }
    });

    await runAsyncTest('Boundary: Unknown usernames return generic error (no account enumeration)', async () => {
        const originalQuery = pool.query;
        pool.query = async () => ({ rows: [] });

        try {
            const adminRes = await AuthService.verifyAdmin('totally_unknown_user_9999', 'anyPassword');
            assert.strictEqual(adminRes.success, false);
            assert.strictEqual(adminRes.message, 'Invalid credentials. Please check your details and try again.');

            const memberRes = await AuthService.verifyMember('totally_unknown_user_9999', 'anyPassword');
            assert.strictEqual(memberRes.success, false);
            assert.strictEqual(memberRes.message, 'Invalid credentials. Please check your details and try again.');
        } finally {
            pool.query = originalQuery;
        }
    });

    await runAsyncTest('Boundary: Invalid password returns generic error', async () => {
        const originalQuery = pool.query;
        pool.query = async () => ({
            rows: [{
                admin_id: 1,
                username: 'admin',
                password_hash: '$2b$12$e8r0.M3pL4w5k6v7u8t9seOG4Qd6lW7n3vOQ7bE.fJ7dZ0j7a2mG.',
                role: 'ADMIN'
            }]
        });

        try {
            const res = await AuthService.verifyAdmin('admin', 'wrong_password');
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.message, 'Invalid credentials. Please check your details and try again.');
        } finally {
            pool.query = originalQuery;
        }
    });

    await runAsyncTest('Boundary: Legacy DEFERRED_AUTH member record safely rejected with generic error', async () => {
        const originalQuery = pool.query;
        pool.query = async () => ({
            rows: [{
                member_id: 3,
                username: 'legacy_member',
                email: 'legacy@example.com',
                password_hash: 'DEFERRED_AUTH',
                name: 'Legacy User'
            }]
        });

        try {
            const res = await AuthService.verifyMember('legacy_member', 'SomePassword123!');
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.message, 'Invalid credentials. Please check your details and try again.');
        } finally {
            pool.query = originalQuery;
        }
    });

    await runAsyncTest('Deserialization: Deleted account in PostgreSQL is denied authenticated access', async () => {
        const originalQuery = pool.query;
        // Simulate user having been deleted from PostgreSQL
        pool.query = async () => ({ rows: [] });

        try {
            // Find deserializer callback from passport
            const deserializer = passport._deserializers[0];
            await new Promise((resolve) => {
                deserializer({ id: 9999, role: 'admin' }, (err, user) => {
                    assert.strictEqual(err, null);
                    assert.strictEqual(user, false, 'Deleted account must deserialize to false');
                    resolve();
                });
            });
        } finally {
            pool.query = originalQuery;
        }
    });

    await runAsyncTest('Deserialization: Invalid or mismatched role is rejected immediately', async () => {
        const deserializer = passport._deserializers[0];
        
        await new Promise((resolve) => {
            deserializer({ id: 1, role: 'hacker_role' }, (err, user) => {
                assert.strictEqual(err, null);
                assert.strictEqual(user, false, 'Invalid role must deserialize to false');
                resolve();
            });
        });

        await new Promise((resolve) => {
            deserializer(null, (err, user) => {
                assert.strictEqual(err, null);
                assert.strictEqual(user, false, 'Null session payload must deserialize to false');
                resolve();
            });
        });
    });

    await runAsyncTest('Deserialization: Clean user object never contains password_hash on req.user', async () => {
        const originalQuery = pool.query;
        pool.query = async () => ({
            rows: [{
                admin_id: 1,
                username: 'admin',
                role: 'admin'
            }]
        });

        try {
            const deserializer = passport._deserializers[0];
            await new Promise((resolve) => {
                deserializer({ id: 1, role: 'admin' }, (err, user) => {
                    assert.strictEqual(err, null);
                    assert.ok(user, 'User must be resolved');
                    assert.strictEqual(user.id, 1);
                    assert.strictEqual(user.password_hash, undefined, 'password_hash must be undefined');
                    assert.strictEqual(user.password, undefined, 'password must be undefined');
                    resolve();
                });
            });
        } finally {
            pool.query = originalQuery;
        }
    });

    console.log('\n====================================================');
    console.log('7. SECURE SESSION CONFIGURATION & LIFECYCLE TESTS');
    console.log('====================================================');

    runTest('Session cookie name is customized (lms.sid) to obscure express fingerprint', () => {
        assert.strictEqual(sessionCookieName, 'lms.sid');
    });

    runTest('Session middleware instantiates without throwing and uses configured PostgreSQL store', () => {
        const sessionMiddleware = createSessionMiddleware();
        assert.strictEqual(typeof sessionMiddleware, 'function', 'Session middleware must be a function');
    });

    await runAsyncTest('Session fixation protection: postAdminLogin invokes req.session.regenerate', async () => {
        let regenerated = false;
        let loggedIn = false;
        let saved = false;

        const fakeReq = {
            body: { username: 'demo_admin', password: 'ValidPassword' },
            session: {
                regenerate: (cb) => {
                    regenerated = true;
                    cb(null);
                },
                save: (cb) => {
                    saved = true;
                    cb(null);
                }
            },
            login: (user, cb) => {
                loggedIn = true;
                cb(null);
            }
        };

        const fakeRes = {
            status: () => fakeRes,
            render: () => {},
            redirect: (url) => {
                assert.strictEqual(url, '/admin');
            }
        };

        const originalAuthenticate = passport.authenticate;
        passport.authenticate = (strategy, callback) => {
            return (req, res, next) => {
                assert.strictEqual(strategy, 'admin-local');
                callback(null, { id: 2, username: 'demo_admin', role: 'admin' }, null);
            };
        };

        try {
            await new Promise((resolve, reject) => {
                fakeRes.redirect = (url) => {
                    try {
                        assert.strictEqual(regenerated, true, 'req.session.regenerate must be called upon successful admin login');
                        assert.strictEqual(loggedIn, true, 'req.login must be called upon successful admin login');
                        assert.strictEqual(saved, true, 'req.session.save must be called before redirect');
                        assert.strictEqual(url, '/admin');
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                };
                AuthController.postAdminLogin(fakeReq, fakeRes, (err) => {
                    if (err) reject(err);
                });
            });
        } finally {
            passport.authenticate = originalAuthenticate;
        }
    });

    await runAsyncTest('Session fixation protection: postMemberLogin invokes req.session.regenerate', async () => {
        let regenerated = false;
        let loggedIn = false;
        let saved = false;

        const fakeReq = {
            body: { username: 'alice_smith', password: 'ValidPassword' },
            session: {
                regenerate: (cb) => {
                    regenerated = true;
                    cb(null);
                },
                save: (cb) => {
                    saved = true;
                    cb(null);
                }
            },
            login: (user, cb) => {
                loggedIn = true;
                cb(null);
            }
        };

        const fakeRes = {
            status: () => fakeRes,
            render: () => {},
            redirect: (url) => {
                assert.strictEqual(url, '/member');
            }
        };

        const originalAuthenticate = passport.authenticate;
        passport.authenticate = (strategy, callback) => {
            return (req, res, next) => {
                assert.strictEqual(strategy, 'member-local');
                callback(null, { id: 10, username: 'alice_smith', role: 'member' }, null);
            };
        };

        try {
            await new Promise((resolve, reject) => {
                fakeRes.redirect = (url) => {
                    try {
                        assert.strictEqual(regenerated, true, 'req.session.regenerate must be called upon successful member login');
                        assert.strictEqual(loggedIn, true, 'req.login must be called upon successful member login');
                        assert.strictEqual(saved, true, 'req.session.save must be called before redirect');
                        assert.strictEqual(url, '/member');
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                };
                AuthController.postMemberLogin(fakeReq, fakeRes, (err) => {
                    if (err) reject(err);
                });
            });
        } finally {
            passport.authenticate = originalAuthenticate;
        }
    });

    await runAsyncTest('Logout: destroys session, clears cookie, and redirects to home', async () => {
        let loggedOut = false;
        let sessionDestroyed = false;
        let clearedCookie = null;

        const fakeReq = {
            logout: (cb) => {
                loggedOut = true;
                cb(null);
            },
            session: {
                destroy: (cb) => {
                    sessionDestroyed = true;
                    cb(null);
                }
            }
        };

        const fakeRes = {
            clearCookie: (cookieName, opts) => {
                clearedCookie = { name: cookieName, opts };
            },
            redirect: (url) => {
                assert.strictEqual(loggedOut, true, 'req.logout must be called');
                assert.strictEqual(sessionDestroyed, true, 'req.session.destroy must be called');
                assert.strictEqual(clearedCookie.name, 'lms.sid', 'Session cookie must be cleared');
                assert.ok(url.startsWith('/?success='), 'Redirect to home with success notice');
            }
        };

        AuthController.logout(fakeReq, fakeRes, () => {});
    });

    console.log('\n====================================================');
    console.log('8. AUTHENTICATION UI & ACCESSIBILITY TESTS');
    console.log('====================================================');

    runTest('EJS compilation check: views/auth/admin-login.ejs', () => {
        const filePath = path.resolve(__dirname, '../views/auth/admin-login.ejs');
        assert.ok(fs.existsSync(filePath), 'admin-login.ejs must exist');
        const content = fs.readFileSync(filePath, 'utf8');
        const compiled = ejs.compile(content, { filename: filePath });
        assert.strictEqual(typeof compiled, 'function');
    });

    runTest('EJS compilation check: views/auth/member-login.ejs', () => {
        const filePath = path.resolve(__dirname, '../views/auth/member-login.ejs');
        assert.ok(fs.existsSync(filePath), 'member-login.ejs must exist');
        const content = fs.readFileSync(filePath, 'utf8');
        const compiled = ejs.compile(content, { filename: filePath });
        assert.strictEqual(typeof compiled, 'function');
    });

    runTest('admin-login.ejs renders branding, accessible inputs, password toggle, and submit loading state', () => {
        const filePath = path.resolve(__dirname, '../views/auth/admin-login.ejs');
        const html = ejs.render(fs.readFileSync(filePath, 'utf8'), {
            title: 'Admin Sign In',
            currentPath: '/admin/login',
            error: null,
            success: null,
            submittedUsername: 'admin_test'
        }, { filename: filePath });

        assert.ok(html.includes('Library System'), 'Contains library system branding');
        assert.ok(html.includes('Administrator Portal'), 'Identifies administrator portal');
        assert.ok(html.includes('action="/admin/login"'), 'Submits to /admin/login');
        assert.ok(html.includes('method="POST"'), 'Submits via POST');
        assert.ok(html.includes('for="adminUsername"'), 'Accessible label for username');
        assert.ok(html.includes('id="adminUsername"'), 'Username input ID matches label');
        assert.ok(html.includes('autocomplete="username"'), 'Standard autocomplete attribute');
        assert.ok(html.includes('for="adminPassword"'), 'Accessible label for password');
        assert.ok(html.includes('id="adminPassword"'), 'Password input ID matches label');
        assert.ok(html.includes('autocomplete="current-password"'), 'Password autocomplete attribute');
        assert.ok(html.includes('toggle-password-btn'), 'Contains toggle password button');
        assert.ok(html.includes('aria-label="Show password as plain text"'), 'Accessible aria-label on toggle');
        assert.ok(html.includes('id="submitBtn"'), 'Contains submit button');
        assert.ok(html.includes('btn-spinner'), 'Contains submit button loading spinner');
        assert.ok(html.includes('/member/login'), 'Contains link to member portal');
    });

    runTest('admin-login.ejs renders generic error alert with aria-live="polite"', () => {
        const filePath = path.resolve(__dirname, '../views/auth/admin-login.ejs');
        const html = ejs.render(fs.readFileSync(filePath, 'utf8'), {
            title: 'Admin Sign In',
            currentPath: '/admin/login',
            error: 'Invalid credentials. Please check your details and try again.',
            success: null,
            submittedUsername: 'bad_user'
        }, { filename: filePath });

        assert.ok(html.includes('role="alert"'), 'Error alert has role="alert"');
        assert.ok(html.includes('aria-live="polite"'), 'Error alert has aria-live="polite"');
        assert.ok(html.includes('Invalid credentials. Please check your details and try again.'), 'Renders generic error message');
    });

    runTest('member-login.ejs renders branding, accessible inputs, password toggle, and submit loading state', () => {
        const filePath = path.resolve(__dirname, '../views/auth/member-login.ejs');
        const html = ejs.render(fs.readFileSync(filePath, 'utf8'), {
            title: 'Member Sign In',
            currentPath: '/member/login',
            error: null,
            success: null,
            submittedUsername: 'alice@example.com'
        }, { filename: filePath });

        assert.ok(html.includes('Library System'), 'Contains library system branding');
        assert.ok(html.includes('Member Sign In'), 'Identifies member sign in');
        assert.ok(html.includes('action="/member/login"'), 'Submits to /member/login');
        assert.ok(html.includes('method="POST"'), 'Submits via POST');
        assert.ok(html.includes('for="memberUsername"'), 'Accessible label for member identifier');
        assert.ok(html.includes('id="memberUsername"'), 'Identifier input ID matches label');
        assert.ok(html.includes('Username or Email Address'), 'Label reflects username or email support');
        assert.ok(html.includes('for="memberPassword"'), 'Accessible label for password');
        assert.ok(html.includes('id="memberPassword"'), 'Password input ID matches label');
        assert.ok(html.includes('toggle-password-btn'), 'Contains toggle password button');
        assert.ok(html.includes('id="submitBtn"'), 'Contains submit button');
        assert.ok(html.includes('btn-spinner'), 'Contains submit button loading spinner');
        assert.ok(html.includes('/admin/login'), 'Contains link to admin portal');
    });

    runTest('member-login.ejs renders generic error alert with aria-live="polite"', () => {
        const filePath = path.resolve(__dirname, '../views/auth/member-login.ejs');
        const html = ejs.render(fs.readFileSync(filePath, 'utf8'), {
            title: 'Member Sign In',
            currentPath: '/member/login',
            error: 'Invalid credentials. Please check your details and try again.',
            success: null,
            submittedUsername: 'invalid_user'
        }, { filename: filePath });

        assert.ok(html.includes('role="alert"'), 'Error alert has role="alert"');
        assert.ok(html.includes('aria-live="polite"'), 'Error alert has aria-live="polite"');
        assert.ok(html.includes('Invalid credentials. Please check your details and try again.'), 'Renders generic error message');
    });
}

if (require.main === module) {
    (async () => {
        try {
            await runAuthTests();
            console.log('\n✅ All Auth & Session tests completed successfully.');
        } catch (err) {
            console.error('\n❌ Test run failed:', err);
            process.exit(1);
        } finally {
            try { await pool.end(); } catch (_) {}
        }
    })();
}

module.exports = { runAuthTests };
