/**
 * End-to-End HTTP Role-Based Authorization & Session Isolation Test Suite
 * Part 8B.1 Verification:
 *  - Real HTTP server via ephemeral port
 *  - Native HTTP client with independent cookie jars for 4 distinct actors:
 *    1. Guest (Unauthenticated)
 *    2. Admin (id: 1, role: 'admin')
 *    3. Member A (id: 10, role: 'member', Alice Smith)
 *    4. Member B (id: 20, role: 'member', Bob Jones)
 *  - Verification of:
 *    - Unauthorized access redirection and 401 API responses
 *    - Cross-role restriction (HTTP 403 Forbidden)
 *    - Cross-member horizontal isolation (ignoring query & body member_id overrides)
 *    - Cache-Control: no-store headers on sensitive authenticated responses
 *    - Session destruction on logout with invalidation of old cookies
 */

const assert = require('assert');
const http = require('http');
const app = require('../app');
const pool = require('../config/db');
const AuthService = require('../services/authService');
const MemberPortalModel = require('../models/memberPortalModel');
const IssueModel = require('../models/issueModel');

async function runHttpAuthorizationTests(harness) {
    let runTest = harness?.runTest;
    let runAsyncTest = harness?.runAsyncTest;

    let standaloneHarness = false;
    let failedCount = 0;
    if (!runTest) {
        standaloneHarness = true;
        let total = 0, passed = 0;
        runTest = (name, fn) => {
            total++;
            try {
                fn();
                passed++;
                console.log(`  ✓ PASS: ${name}`);
            } catch (err) {
                failedCount++;
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
                failedCount++;
                console.error(`  ✗ FAIL: ${name}\n    ${err.message}`);
            }
        };
    }

    console.log('\n====================================================');
    console.log('13. HTTP INTEGRATION TESTS: MULTI-SESSION ISOLATION');
    console.log('====================================================');

    // 1. Session store in-memory map for connect-pg-simple simulation
    const sessionStoreMap = new Map();
    const originalPoolQuery = pool.query;
    const originalGetUserByIdAndRole = AuthService.getUserByIdAndRole;
    const originalGetMemberById = MemberPortalModel.getMemberById;
    const originalUpdateProfile = MemberPortalModel.updateProfile;
    const originalGetDashboardData = MemberPortalModel.getDashboardData;
    const originalSyncOverdueStatuses = IssueModel.syncOverdueStatuses;

    pool.query = async (text, params) => {
        const sql = text.trim();
        if (sql.startsWith('INSERT INTO "session"') || sql.includes('INSERT INTO "session"')) {
            const sess = params[0];
            const sid = params[2];
            sessionStoreMap.set(sid, sess);
            return { rows: [{ sid }] };
        }
        if (sql.startsWith('SELECT sess FROM "session"')) {
            const sid = params[0];
            const sess = sessionStoreMap.get(sid);
            if (!sess) return { rows: [] };
            return { rows: [{ sess }] };
        }
        if (sql.startsWith('DELETE FROM "session"')) {
            const sid = params[0];
            sessionStoreMap.delete(sid);
            return { rows: [] };
        }
        // Generic fallback for any other database touch
        return { rows: [] };
    };

    IssueModel.syncOverdueStatuses = async () => {};

    // Mock accounts
    const mockAccounts = {
        admin1: { id: 1, username: 'admin1', role: 'admin' },
        memberA: { id: 10, username: 'alice', name: 'Alice Smith', email: 'alice@example.com', phone: '9876543210', address: '123 Pine St', role: 'member' },
        memberB: { id: 20, username: 'bob', name: 'Bob Jones', email: 'bob@example.com', phone: '5551234567', address: '456 Oak Ave', role: 'member' }
    };

    AuthService.getUserByIdAndRole = async (id, role) => {
        const numId = parseInt(id, 10);
        if (role === 'admin' && numId === 1) return { ...mockAccounts.admin1 };
        if (role === 'member' && numId === 10) return { ...mockAccounts.memberA };
        if (role === 'member' && numId === 20) return { ...mockAccounts.memberB };
        return null;
    };

    MemberPortalModel.getMemberById = async (id) => {
        const numId = parseInt(id, 10);
        if (numId === 10) return { ...mockAccounts.memberA, member_id: 10 };
        if (numId === 20) return { ...mockAccounts.memberB, member_id: 20 };
        return null;
    };

    let lastProfileUpdatedId = null;
    let lastProfileUpdatedData = null;
    MemberPortalModel.updateProfile = async (id, data) => {
        lastProfileUpdatedId = id;
        lastProfileUpdatedData = data;
        return { member_id: id, ...data };
    };

    MemberPortalModel.getDashboardData = async (id) => ({
        metrics: { activeLoans: 1, overdueLoans: 0, returnedBooks: 2, totalBorrowed: 3, totalOverdueFine: 0 },
        recentActivity: []
    });

    // Start ephemeral HTTP server
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    // Helper HTTP client
    function makeRequest(path, options = {}) {
        return new Promise((resolve, reject) => {
            const req = http.request({
                host: '127.0.0.1',
                port,
                path,
                method: options.method || 'GET',
                headers: options.headers || {}
            }, (res) => {
                let body = '';
                res.on('data', chunk => { body += chunk; });
                res.on('end', () => {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body
                    });
                });
            });
            req.on('error', reject);
            if (options.body) {
                req.write(options.body);
            }
            req.end();
        });
    }

    // Helper to extract session cookie from Set-Cookie header
    function extractCookie(resHeaders) {
        const setCookie = resHeaders['set-cookie'];
        if (!setCookie) return null;
        const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
        return cookieStr.split(';')[0];
    }

    // Helper to generate authenticated session directly in the mock session store
    function seedSession(user) {
        const sid = 'sess_' + user.role + '_' + user.id + '_' + Math.random().toString(36).slice(2);
        const sessionData = {
            cookie: {
                originalMaxAge: 86400000,
                expires: new Date(Date.now() + 86400000).toISOString(),
                secure: false,
                httpOnly: true,
                path: '/',
                sameSite: 'lax'
            },
            passport: {
                user: { id: user.id, role: user.role }
            }
        };
        sessionStoreMap.set(sid, sessionData);
        return `lms.sid=s%3A${sid}.${'dummySignature'}`.replace(/\..*$/, ''); // connect-pg-simple takes unsigned sid when mocked
    }

    // We can directly seed the sessions for our 3 authenticated actors
    // Connect-pg-simple uses cookieParser / express-session signed sid format: s:<sid>.<signature>
    // However, when express-session reads cookie, it unsigns it.
    // To generate valid signed cookies compatible with express-session, we can use cookie-signature:
    const cookieSignature = require('cookie-signature');
    const sessionSecret = process.env.SESSION_SECRET || 'lms_secure_fallback_session_secret_key_84920482918';

    function createSignedSessionCookie(user) {
        const rawSid = 'sid_' + user.role + '_' + user.id + '_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        const signedValue = 's:' + cookieSignature.sign(rawSid, sessionSecret);
        const csrfToken = 'csrf_' + user.role + '_' + user.id + '_test_token_1234567890abcdef1234567890abcdef';
        const sessionPayload = {
            cookie: {
                originalMaxAge: 86400000,
                expires: new Date(Date.now() + 86400000).toISOString(),
                httpOnly: true,
                path: '/'
            },
            passport: {
                user: { id: user.id, role: user.role }
            },
            csrfToken
        };
        sessionStoreMap.set(rawSid, sessionPayload);
        return {
            cookie: `lms.sid=${encodeURIComponent(signedValue)}`,
            csrfToken,
            rawSid
        };
    }

    const adminSession = createSignedSessionCookie(mockAccounts.admin1);
    const memberASession = createSignedSessionCookie(mockAccounts.memberA);
    const memberBSession = createSignedSessionCookie(mockAccounts.memberB);

    const adminCookie = adminSession.cookie;
    const memberACookie = memberASession.cookie;
    const memberBCookie = memberBSession.cookie;

    try {
        // --- 1. GUEST TESTS ---
        await runAsyncTest('HTTP Guest: accessing /admin redirects (302) to /admin/login', async () => {
            const res = await makeRequest('/admin');
            assert.strictEqual(res.status, 302);
            assert.strictEqual(res.headers.location, '/admin/login');
        });

        await runAsyncTest('HTTP Guest: accessing /member redirects (302) to /member/login', async () => {
            const res = await makeRequest('/member');
            assert.strictEqual(res.status, 302);
            assert.strictEqual(res.headers.location, '/member/login');
        });

        await runAsyncTest('HTTP Guest: AJAX to protected endpoint returns HTTP 401 JSON', async () => {
            const res = await makeRequest('/admin/books', {
                headers: { 'Accept': 'application/json' }
            });
            assert.strictEqual(res.status, 401);
            const json = JSON.parse(res.body);
            assert.ok(json.error.includes('Authentication required'));
        });

        // --- 2. ADMIN TESTS ---
        await runAsyncTest('HTTP Admin: authenticated admin gets 200 on /admin with no-store headers', async () => {
            const res = await makeRequest('/admin', {
                headers: { 'Cookie': adminCookie }
            });
            assert.strictEqual(res.status, 200);
            assert.ok(res.headers['cache-control'].includes('no-store'), 'Must include no-store header');
        });

        await runAsyncTest('HTTP Admin Cross-Role: admin accessing /member receives HTTP 403 Forbidden', async () => {
            const res = await makeRequest('/member', {
                headers: { 'Cookie': adminCookie }
            });
            assert.strictEqual(res.status, 403);
            assert.ok(res.body.includes('403 Forbidden') || res.body.includes('Access denied'));
        });

        await runAsyncTest('HTTP Admin Cross-Role: admin submitting POST /member/profile receives HTTP 403', async () => {
            const res = await makeRequest('/member/profile', {
                method: 'POST',
                headers: {
                    'Cookie': adminCookie,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: `_csrf=${adminSession.csrfToken}&name=AdminTamper&phone=1234567890`
            });
            assert.strictEqual(res.status, 403);
        });

        // --- 3. MEMBER A TESTS ---
        await runAsyncTest('HTTP Member A: authenticated member gets 200 on /member with no-store headers', async () => {
            const res = await makeRequest('/member', {
                headers: { 'Cookie': memberACookie }
            });
            assert.strictEqual(res.status, 200);
            assert.ok(res.headers['cache-control'].includes('no-store'));
        });

        await runAsyncTest('HTTP Member A Cross-Role: member accessing /admin receives HTTP 403 Forbidden', async () => {
            const res = await makeRequest('/admin', {
                headers: { 'Cookie': memberACookie }
            });
            assert.strictEqual(res.status, 403);
        });

        await runAsyncTest('HTTP Member A Cross-Role: member submitting AJAX mutation to admin receives HTTP 403 JSON', async () => {
            const res = await makeRequest('/admin/books', {
                method: 'POST',
                headers: {
                    'Cookie': memberACookie,
                    'X-CSRF-Token': memberASession.csrfToken,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ title: 'Hacked Book' })
            });
            assert.strictEqual(res.status, 403);
            const json = JSON.parse(res.body);
            assert.ok(json.error.includes('Insufficient privileges'));
        });

        await runAsyncTest('HTTP Horizontal Isolation: Member A querying ?member_id=20 renders Member A profile (Alice)', async () => {
            const res = await makeRequest('/member/profile?member_id=20', {
                headers: { 'Cookie': memberACookie }
            });
            assert.strictEqual(res.status, 200);
            assert.ok(res.body.includes('Alice Smith'), 'Must display Member A name');
            assert.ok(!res.body.includes('Bob Jones'), 'Must not display Member B name');
            assert.ok(res.body.includes('alice@example.com'), 'Must display Member A email');
        });

        await runAsyncTest('HTTP Horizontal Isolation: Member A POST /member/profile with member_id=20 updates Member A only', async () => {
            lastProfileUpdatedId = null;
            const res = await makeRequest('/member/profile', {
                method: 'POST',
                headers: {
                    'Cookie': memberACookie,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: `_csrf=${memberASession.csrfToken}&member_id=20&name=Alice+Updated&phone=9876543210`
            });
            assert.strictEqual(res.status, 302, 'Successful profile update redirects');
            assert.strictEqual(lastProfileUpdatedId, 10, 'Database update must be called with authenticated ID (10), never 20');
        });

        // --- 4. MEMBER B TESTS ---
        await runAsyncTest('HTTP Member B: authenticated member gets Member B profile (Bob)', async () => {
            const res = await makeRequest('/member/profile', {
                headers: { 'Cookie': memberBCookie }
            });
            assert.strictEqual(res.status, 200);
            assert.ok(res.body.includes('Bob Jones'), 'Must display Member B name');
            assert.ok(!res.body.includes('Alice Smith'), 'Must not display Member A name');
            assert.ok(res.body.includes('bob@example.com'), 'Must display Member B email');
        });

        // --- 5. CSRF REJECTION ON STATE-CHANGING ENDPOINTS ---
        await runAsyncTest('HTTP CSRF: POST /admin/books without CSRF token returns HTTP 403 Forbidden', async () => {
            const res = await makeRequest('/admin/books', {
                method: 'POST',
                headers: {
                    'Cookie': adminCookie,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: 'title=BookWithoutCsrf&author=Author'
            });
            assert.strictEqual(res.status, 403);
        });

        await runAsyncTest('HTTP CSRF: POST /member/profile without CSRF token returns HTTP 403 Forbidden', async () => {
            const res = await makeRequest('/member/profile', {
                method: 'POST',
                headers: {
                    'Cookie': memberACookie,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: 'name=NoCsrf'
            });
            assert.strictEqual(res.status, 403);
        });

        await runAsyncTest('HTTP CSRF: POST /admin/login without CSRF token returns HTTP 403 Forbidden', async () => {
            const res = await makeRequest('/admin/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: 'username=admin&password=Password123!'
            });
            assert.strictEqual(res.status, 403);
        });

        await runAsyncTest('HTTP CSRF: POST /member/login without CSRF token returns HTTP 403 Forbidden', async () => {
            const res = await makeRequest('/member/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: 'username=member1&password=Password123!'
            });
            assert.strictEqual(res.status, 403);
        });

        await runAsyncTest('HTTP CSRF: POST /logout without CSRF token returns HTTP 403 Forbidden', async () => {
            const res = await makeRequest('/logout', {
                method: 'POST',
                headers: {
                    'Cookie': memberACookie
                }
            });
            assert.strictEqual(res.status, 403);
        });

        // --- 6. LOGOUT & SESSION INVALIDATION ---
        await runAsyncTest('HTTP Logout: GET /logout returns HTTP 405 Method Not Allowed and preserves active session', async () => {
            const memberSession = createSignedSessionCookie(mockAccounts.memberA);

            // Attempting GET /logout must be rejected with 405 Method Not Allowed
            const getLogoutRes = await makeRequest('/logout', {
                method: 'GET',
                headers: { 'Cookie': memberSession.cookie }
            });
            assert.strictEqual(getLogoutRes.status, 405, 'GET /logout must return HTTP 405');
            assert.strictEqual(getLogoutRes.headers.allow, 'POST', 'Must include Allow: POST header');

            // Verify that the session was NOT destroyed by GET /logout
            const verifySessionRes = await makeRequest('/member/profile', {
                headers: { 'Cookie': memberSession.cookie }
            });
            assert.strictEqual(verifySessionRes.status, 200, 'Session must remain valid and authenticated after GET /logout attempt');
            assert.ok(verifySessionRes.body.includes('Alice Smith'));
        });

        await runAsyncTest('HTTP Logout: POST /logout with valid CSRF invalidates session and subsequent access redirects to login', async () => {
            const disposableSession = createSignedSessionCookie(mockAccounts.memberA);
            
            // 1. Verify session is active
            const preRes = await makeRequest('/member/profile', {
                headers: { 'Cookie': disposableSession.cookie }
            });
            assert.strictEqual(preRes.status, 200);

            // 2. Perform logout via POST with valid CSRF token in header
            const logoutRes = await makeRequest('/logout', {
                method: 'POST',
                headers: {
                    'Cookie': disposableSession.cookie,
                    'X-CSRF-Token': disposableSession.csrfToken
                }
            });
            assert.strictEqual(logoutRes.status, 302);
            assert.ok(logoutRes.headers.location.startsWith('/?success=') || logoutRes.headers.location === '/', 'Must redirect to home with sign-out notice');

            // 3. Attempt accessing protected route with same cookie
            const postRes = await makeRequest('/member/profile', {
                headers: { 'Cookie': disposableSession.cookie }
            });
            assert.strictEqual(postRes.status, 302, 'Old cookie must no longer have access');
            assert.strictEqual(postRes.headers.location, '/member/login');
        });

        // --- 7. HTTP LOGIN RATE LIMITING ---
        await runAsyncTest('HTTP RateLimit: 5 consecutive failed logins trigger HTTP 429 with Retry-After header', async () => {
            const testSession = createSignedSessionCookie({ id: 999, role: 'guest' });
            const { resetRateLimits } = require('../middleware/rateLimitMiddleware');
            resetRateLimits();

            // Simulate 5 failed login attempts with valid CSRF token from 127.0.0.1
            let lastStatus = null;
            let lastHeaders = null;
            let lastBody = null;

            for (let i = 0; i < 5; i++) {
                const res = await makeRequest('/member/login', {
                    method: 'POST',
                    headers: {
                        'Cookie': testSession.cookie,
                        'X-CSRF-Token': testSession.csrfToken,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: 'username=flood_user&password=WrongPassword123!'
                });
                lastStatus = res.status;
                lastHeaders = res.headers;
                lastBody = res.body;
            }

            // 6th attempt must be rejected with 429 Too Many Requests
            const resBlocked = await makeRequest('/member/login', {
                method: 'POST',
                headers: {
                    'Cookie': testSession.cookie,
                    'X-CSRF-Token': testSession.csrfToken,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: 'username=flood_user&password=WrongPassword123!'
            });

            assert.strictEqual(resBlocked.status, 429, 'Must return HTTP 429 when rate-limited');
            assert.ok(resBlocked.headers['retry-after'], 'Must include Retry-After header');
            assert.ok(resBlocked.body.includes('Too many failed login attempts'), 'Must render generic rate-limit message');
        });

    } finally {
        await new Promise((resolve) => server.close(resolve));
        pool.query = originalPoolQuery;
        AuthService.getUserByIdAndRole = originalGetUserByIdAndRole;
        MemberPortalModel.getMemberById = originalGetMemberById;
        MemberPortalModel.updateProfile = originalUpdateProfile;
        MemberPortalModel.getDashboardData = originalGetDashboardData;
        IssueModel.syncOverdueStatuses = originalSyncOverdueStatuses;
    }

    if (standaloneHarness && failedCount > 0) {
        throw new Error(`${failedCount} HTTP authorization test(s) failed.`);
    }
}

if (require.main === module) {
    (async () => {
        try {
            await runHttpAuthorizationTests();
            console.log('\n✅ All HTTP Authorization integration tests passed successfully.');
        } catch (err) {
            console.error('\n❌ HTTP Authorization test failure:', err);
            process.exit(1);
        }
    })();
}

module.exports = { runHttpAuthorizationTests };
