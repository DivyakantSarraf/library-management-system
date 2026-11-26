/**
 * End-to-End HTTP Member Self-Registration & Profile Completion Integration Test Suite (Part 9B)
 *
 * Uses a real Express HTTP server on an ephemeral loopback port with cookie jars
 * and an in-memory PostgreSQL simulation enforcing case-insensitive uniqueness,
 * DEFERRED_AUTH preservation, and full session/CSRF/rate-limit lifecycle.
 */

const assert = require('assert');
const http = require('http');
const bcrypt = require('bcrypt');
const app = require('../app');
const pool = require('../config/db');
const IssueModel = require('../models/issueModel');
const { resetRateLimits, resetRegistrationRateLimits } = require('../middleware/rateLimitMiddleware');

async function runHttpRegistrationTests() {
    console.log('\n====================================================');
    console.log('17. HTTP INTEGRATION TESTS: MEMBER SELF-REGISTRATION');
    console.log('====================================================');

    let passed = 0;
    let failed = 0;

    async function runAsyncTest(name, fn) {
        try {
            await fn();
            passed++;
            console.log(`  ✓ PASS: ${name}`);
        } catch (err) {
            failed++;
            console.error(`  ✗ FAIL: ${name}\n    ${err.message}`);
        }
    }

    const sessionStoreMap = new Map();
    const adminsTable = [
        { admin_id: 1, username: 'admin1', password_hash: await bcrypt.hash('AdminPass123!', 10), role: 'ADMIN' }
    ];
    const membersTable = [
        {
            member_id: 1,
            username: 'legacy_deferred_1',
            password_hash: 'DEFERRED_AUTH',
            name: 'Legacy Patron',
            email: 'legacy.patron@example.com',
            phone: null,
            address: null,
            membership_date: '2026-01-10',
            admin_id: 1
        }
    ];
    let nextMemberId = 2;

    const originalPoolQuery = pool.query;
    const originalSyncOverdue = IssueModel.syncOverdueStatuses;

    IssueModel.syncOverdueStatuses = async () => {};

    pool.query = async (text, params = []) => {
        const sql = text.replace(/\s+/g, ' ').trim();

        // Session table
        if (sql.includes('INSERT INTO "session"')) {
            const sess = params[0];
            const sid = params[2];
            sessionStoreMap.set(sid, sess);
            return { rows: [{ sid }] };
        }
        if (sql.startsWith('SELECT sess FROM "session"')) {
            const sess = sessionStoreMap.get(params[0]);
            return sess ? { rows: [{ sess }] } : { rows: [] };
        }
        if (sql.startsWith('DELETE FROM "session"')) {
            sessionStoreMap.delete(params[0]);
            return { rows: [] };
        }

        // Admins lookup (verifyAdmin & getUserByIdAndRole)
        if (sql.includes('FROM admins WHERE username = $1')) {
            const found = adminsTable.find(a => a.username === params[0]);
            return { rows: found ? [{ ...found }] : [] };
        }
        if (sql.includes('FROM admins WHERE admin_id = $1')) {
            const found = adminsTable.find(a => a.admin_id === params[0]);
            return { rows: found ? [{ ...found }] : [] };
        }
        if (sql.includes('SELECT admin_id FROM admins LIMIT 1')) {
            return { rows: adminsTable.length ? [{ admin_id: adminsTable[0].admin_id }] : [] };
        }

        // Members INSERT (registration)
        if (sql.startsWith('INSERT INTO members')) {
            const [username, email, passwordHash] = params;
            const lowerUser = String(username).toLowerCase();
            const lowerEmail = String(email).toLowerCase();

            // Simulate async tick to expose concurrent race conditions if unhandled
            await new Promise(r => setTimeout(r, 15));

            if (membersTable.some(m => m.username.toLowerCase() === lowerUser)) {
                const err = new Error('duplicate key value violates unique constraint');
                err.code = '23505';
                err.constraint = 'idx_members_username_lower';
                throw err;
            }
            if (membersTable.some(m => m.email.toLowerCase() === lowerEmail)) {
                const err = new Error('duplicate key value violates unique constraint');
                err.code = '23505';
                err.constraint = 'idx_members_email_lower';
                throw err;
            }

            const newRow = {
                member_id: nextMemberId++,
                username,
                email,
                password_hash: passwordHash,
                name: null,
                phone: null,
                address: null,
                membership_date: '2026-11-26',
                admin_id: null
            };
            membersTable.push(newRow);
            return { rows: [{ ...newRow }] };
        }

        // Members lookup by LOWER(username) or LOWER(email) (verifyMember)
        if (sql.includes('FROM members WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)')) {
            const idLower = String(params[0]).toLowerCase();
            const found = membersTable.find(m => m.username.toLowerCase() === idLower || m.email.toLowerCase() === idLower);
            return { rows: found ? [{ ...found }] : [] };
        }

        // Members lookup by member_id (getUserByIdAndRole & getMemberById)
        if (sql.includes('FROM members WHERE member_id = $1')) {
            const idNum = parseInt(params[0], 10);
            const found = membersTable.find(m => m.member_id === idNum);
            return { rows: found ? [{ ...found }] : [] };
        }
        if (sql.includes('AS filtered_members')) {
            return { rows: [{ count: String(membersTable.length) }] };
        }
        if (sql.includes('FROM members WHERE 1=1')) {
            return { rows: membersTable.map(m => ({ ...m })) };
        }

        // Members profile UPDATE (handles both full and atomic partial CASE WHEN updates)
        if (sql.includes('UPDATE members') && sql.includes('WHERE member_id = $')) {
            if (sql.includes('CASE WHEN $1::boolean')) {
                const [hasName, nameVal, hasPhone, phoneVal, hasAddress, addressVal, memberId] = params;
                const found = membersTable.find(m => m.member_id === parseInt(memberId, 10));
                if (!found) return { rows: [] };
                if (hasName) found.name = nameVal;
                if (hasPhone) found.phone = phoneVal;
                if (hasAddress) found.address = addressVal;
                return { rows: [{ ...found }] };
            }
            if (sql.includes('membership_date = $5')) {
                const [name, email, phone, address, membership_date, memberId] = params;
                const found = membersTable.find(m => m.member_id === parseInt(memberId, 10));
                if (!found) return { rows: [] };
                if (membersTable.some(m => m.member_id !== found.member_id && m.email.toLowerCase() === String(email).toLowerCase())) {
                    const err = new Error('duplicate key value violates unique constraint');
                    err.code = '23505';
                    err.constraint = 'idx_members_email_lower';
                    throw err;
                }
                found.name = name;
                found.email = email;
                found.phone = phone;
                found.address = address;
                found.membership_date = membership_date;
                return { rows: [{ ...found }] };
            }
        }

        // Dashboard metrics & recent activity
        if (sql.includes('AS active_loans')) {
            return { rows: [{ active_loans: '0', overdue_loans: '0', returned_books: '0', total_borrowed: '0' }] };
        }
        if (sql.includes('FROM issues') && sql.includes('WHERE member_id = $1')) {
            return { rows: [] };
        }
        if (sql.includes('FROM issues i JOIN books b')) {
            return { rows: [] };
        }

        return { rows: [] };
    };

    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    function createClient(ipOverride = null) {
        const cookies = new Map();
        return {
            getCookieHeader() {
                return Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
            },
            getSid() {
                return cookies.get('lms.sid') || null;
            },
            async request(pathUrl, options = {}) {
                const headers = { ...(options.headers || {}) };
                const cookieHeader = this.getCookieHeader();
                if (cookieHeader) headers['Cookie'] = cookieHeader;
                if (ipOverride) headers['X-Forwarded-For'] = ipOverride;

                return new Promise((resolve, reject) => {
                    const req = http.request(`${baseUrl}${pathUrl}`, {
                        method: options.method || 'GET',
                        headers
                    }, (res) => {
                        const setCookies = res.headers['set-cookie'];
                        if (Array.isArray(setCookies)) {
                            setCookies.forEach(c => {
                                const pair = c.split(';')[0];
                                const eqIdx = pair.indexOf('=');
                                if (eqIdx > 0) {
                                    const k = pair.slice(0, eqIdx).trim();
                                    const v = pair.slice(eqIdx + 1).trim();
                                    if (!v) cookies.delete(k);
                                    else cookies.set(k, v);
                                }
                            });
                        }

                        let body = '';
                        res.on('data', chunk => { body += chunk; });
                        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
                    });
                    req.on('error', reject);
                    if (options.body) req.write(options.body);
                    req.end();
                });
            }
        };
    }

    function extractCsrf(html) {
        const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
        return match ? match[1] : null;
    }

    try {
        resetRateLimits();
        resetRegistrationRateLimits();

        const guest1 = createClient();
        let preRegCsrf = null;
        let preRegSid = null;
        let postRegCsrf = null;
        let postRegSid = null;

        // 1 & 2. Guest loads registration page + includes CSRF token
        await runAsyncTest('HTTP 1-2: Guest loads GET /member/register (200) and receives CSRF token', async () => {
            const res = await guest1.request('/member/register');
            assert.strictEqual(res.status, 200);
            preRegCsrf = extractCsrf(res.body);
            preRegSid = guest1.getSid();
            assert.ok(preRegCsrf && preRegCsrf.length >= 32, 'Must include CSRF token in registration form');
            assert.ok(preRegSid, 'Must establish session cookie for CSRF');
        });

        // 3, 4, 5. Successful registration + session regeneration + redirect to profile completion
        await runAsyncTest('HTTP 3-5: Successful POST /member/register regenerates session, redirects to /member/complete-profile, and loads step 2', async () => {
            const form = new URLSearchParams({
                _csrf: preRegCsrf,
                username: 'Alice.Reader',
                email: 'Alice.Reader@Example.com',
                password: 'SecurePass99',
                confirmPassword: 'SecurePass99'
            }).toString();

            const regRes = await guest1.request('/member/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: form
            });

            assert.strictEqual(regRes.status, 302);
            assert.strictEqual(regRes.headers.location, '/member/complete-profile');
            postRegSid = guest1.getSid();
            assert.ok(postRegSid && postRegSid !== preRegSid, 'Session ID cookie must regenerate upon registration');

            const step2Res = await guest1.request('/member/complete-profile');
            assert.strictEqual(step2Res.status, 200);
            assert.ok(step2Res.headers['cache-control']?.includes('no-store'));
            assert.ok(step2Res.body.includes('alice.reader'), 'Normalized username must appear');
            postRegCsrf = extractCsrf(step2Res.body);
            assert.ok(postRegCsrf && postRegCsrf !== preRegCsrf, 'CSRF token must rotate after registration');
        });

        // 15. Stale pre-registration CSRF token fails after registration
        await runAsyncTest('HTTP 15: Stale pre-registration CSRF token is rejected with 403 on POST /member/complete-profile', async () => {
            const res = await guest1.request('/member/complete-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ _csrf: preRegCsrf, action: 'skip' }).toString()
            });
            assert.strictEqual(res.status, 403);
        });

        // 6 & 7. Skip profile -> redirects to /member & leaves fields NULL
        await runAsyncTest('HTTP 6-7: Skip for Now keeps optional fields NULL and redirects to Member Dashboard', async () => {
            const skipRes = await guest1.request('/member/complete-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ _csrf: postRegCsrf, action: 'skip' }).toString()
            });
            assert.strictEqual(skipRes.status, 302);
            assert.strictEqual(skipRes.headers.location, '/member');

            const saved = membersTable.find(m => m.username === 'alice.reader');
            assert.strictEqual(saved.name, null);
            assert.strictEqual(saved.phone, null);
            assert.strictEqual(saved.address, null);
            assert.strictEqual(saved.admin_id, null);

            const dashRes = await guest1.request('/member');
            assert.strictEqual(dashRes.status, 200);
            assert.ok(dashRes.body.includes('Welcome back, alice.reader'));
            assert.ok(!dashRes.body.includes('Welcome back, null'));
        });

        // 9. Save phone/address without full name on /member/profile
        await runAsyncTest('HTTP 9: Member who skipped name can save phone and address without full name on /member/profile', async () => {
            const profPage = await guest1.request('/member/profile');
            assert.strictEqual(profPage.status, 200);
            assert.ok(profPage.body.includes('Self-Registered'));
            const profCsrf = extractCsrf(profPage.body);

            const updateRes = await guest1.request('/member/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    _csrf: profCsrf,
                    name: '',
                    phone: '+91 98765 43210',
                    address: '10 Library Lane'
                }).toString()
            });
            assert.strictEqual(updateRes.status, 302);
            assert.ok(updateRes.headers.location.startsWith('/member/profile?success='));

            const saved = membersTable.find(m => m.username === 'alice.reader');
            assert.strictEqual(saved.name, null);
            assert.strictEqual(saved.phone, '+91 98765 43210');
            assert.strictEqual(saved.address, '10 Library Lane');
        });

        // 23. Member cannot update another member via tampered member_id
        await runAsyncTest('HTTP 23: Tampered member_id in /member/complete-profile or /member/profile cannot modify another member', async () => {
            const profPage = await guest1.request('/member/profile');
            const profCsrf = extractCsrf(profPage.body);

            await guest1.request('/member/complete-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    _csrf: profCsrf,
                    action: 'complete',
                    member_id: '1',
                    name: 'Alice Updated',
                    phone: '9876500000',
                    address: 'Updated St'
                }).toString()
            });

            const legacy = membersTable.find(m => m.member_id === 1);
            assert.strictEqual(legacy.name, 'Legacy Patron', 'Legacy member #1 must not be overwritten');
            const alice = membersTable.find(m => m.username === 'alice.reader');
            assert.strictEqual(alice.name, 'Alice Updated');
        });

        // 21 & 25. Authenticated Member cannot access /member/register or /admin pages
        await runAsyncTest('HTTP 21 & 25: Authenticated Member is blocked from registration and forbidden (403) on Admin routes', async () => {
            const regGet = await guest1.request('/member/register');
            assert.strictEqual(regGet.status, 302);
            assert.strictEqual(regGet.headers.location, '/member');

            const profPage = await guest1.request('/member/profile');
            const csrf = extractCsrf(profPage.body);

            const regPost = await guest1.request('/member/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    _csrf: csrf,
                    username: 'second_acc',
                    email: 'second@example.com',
                    password: 'Password123',
                    confirmPassword: 'Password123'
                }).toString()
            });
            assert.strictEqual(regPost.status, 403);

            const adminGet = await guest1.request('/admin');
            assert.strictEqual(adminGet.status, 403);
        });

        // 8. Complete optional profile flow for a second user
        await runAsyncTest('HTTP 8: Complete Profile step saves optional fields and redirects to /member', async () => {
            resetRegistrationRateLimits();
            const guest2 = createClient();
            const g2Page = await guest2.request('/member/register');
            const g2Csrf = extractCsrf(g2Page.body);

            const reg2 = await guest2.request('/member/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    _csrf: g2Csrf,
                    username: 'bob.builder',
                    email: 'bob@example.com',
                    password: 'BuilderPass99',
                    confirmPassword: 'BuilderPass99',
                    role: 'admin'
                }).toString()
            });
            assert.strictEqual(reg2.status, 302);
            assert.strictEqual(reg2.headers.location, '/member/complete-profile');

            const step2 = await guest2.request('/member/complete-profile');
            const step2Csrf = extractCsrf(step2.body);
            const compRes = await guest2.request('/member/complete-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    _csrf: step2Csrf,
                    action: 'complete',
                    name: 'Bob Builder',
                    phone: '5551234567',
                    address: '789 Oak Road'
                }).toString()
            });
            assert.strictEqual(compRes.status, 302);
            assert.ok(compRes.headers.location.startsWith('/member?success='));

            const bob = membersTable.find(m => m.username === 'bob.builder');
            assert.strictEqual(bob.name, 'Bob Builder');
            assert.strictEqual(bob.phone, '5551234567');
            assert.strictEqual(bob.address, '789 Oak Road');
            assert.strictEqual(bob.admin_id, null);

            // 20b: Role injection via body ignored — Bob cannot access /admin
            const adminCheck = await guest2.request('/admin');
            assert.strictEqual(adminCheck.status, 403);
        });

        // 17, 18, 19. Post-registration login via username, email, and case-insensitive variants
        await runAsyncTest('HTTP 17-19: Newly registered member can sign in using username, email, and mixed-case variants', async () => {
            const loginClient = createClient();
            const loginPage = await loginClient.request('/member/login');
            const loginCsrf = extractCsrf(loginPage.body);

            // Login with uppercase username
            const resUser = await loginClient.request('/member/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    _csrf: loginCsrf,
                    username: 'ALICE.READER',
                    password: 'SecurePass99'
                }).toString()
            });
            assert.strictEqual(resUser.status, 302);
            assert.strictEqual(resUser.headers.location, '/member');

            // Logout
            const dash = await loginClient.request('/member');
            const logoutCsrf = extractCsrf(dash.body);
            await loginClient.request('/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ _csrf: logoutCsrf }).toString()
            });

            // Login with mixed-case email
            const loginPage2 = await loginClient.request('/member/login');
            const loginCsrf2 = extractCsrf(loginPage2.body);
            const resEmail = await loginClient.request('/member/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    _csrf: loginCsrf2,
                    username: 'Alice.Reader@EXAMPLE.COM',
                    password: 'SecurePass99'
                }).toString()
            });
            assert.strictEqual(resEmail.status, 302);
            assert.strictEqual(resEmail.headers.location, '/member');
        });

        // 10 & 11 & 24. Duplicate, case-variant duplicate, and DEFERRED_AUTH preservation
        await runAsyncTest('HTTP 10, 11, 24: Duplicate, case-variant duplicate, and legacy DEFERRED_AUTH email return identical 409 without mutating legacy record', async () => {
            resetRegistrationRateLimits();
            const dupClient = createClient();
            const page = await dupClient.request('/member/register');
            const csrf = extractCsrf(page.body);

            const resDupUser = await dupClient.request('/member/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    _csrf: csrf,
                    username: 'BOB.BUILDER',
                    email: 'unused@example.com',
                    password: 'Password123',
                    confirmPassword: 'Password123'
                }).toString()
            });
            assert.strictEqual(resDupUser.status, 409);

            const resDupDeferred = await dupClient.request('/member/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    _csrf: csrf,
                    username: 'fresh_username_xyz',
                    email: 'LEGACY.PATRON@EXAMPLE.COM',
                    password: 'Password123',
                    confirmPassword: 'Password123'
                }).toString()
            });
            assert.strictEqual(resDupDeferred.status, 409);

            const legacy = membersTable.find(m => m.member_id === 1);
            assert.strictEqual(legacy.password_hash, 'DEFERRED_AUTH', 'Legacy DEFERRED_AUTH hash must remain untouched');
        });

        // 12. Concurrent duplicate registration race condition
        await runAsyncTest('HTTP 12: Concurrent duplicate POST /member/register requests allow only 1 creation and return 409 for the other', async () => {
            resetRegistrationRateLimits();
            const cA = createClient();
            const cB = createClient();
            const [pA, pB] = await Promise.all([cA.request('/member/register'), cB.request('/member/register')]);
            const csrfA = extractCsrf(pA.body);
            const csrfB = extractCsrf(pB.body);

            const [rA, rB] = await Promise.all([
                cA.request('/member/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        _csrf: csrfA,
                        username: 'race_user',
                        email: 'race@example.com',
                        password: 'RacePassword123',
                        confirmPassword: 'RacePassword123'
                    }).toString()
                }),
                cB.request('/member/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        _csrf: csrfB,
                        username: 'RACE_USER',
                        email: 'RACE@example.com',
                        password: 'RacePassword123',
                        confirmPassword: 'RacePassword123'
                    }).toString()
                })
            ]);

            const statuses = [rA.status, rB.status].sort();
            assert.deepStrictEqual(statuses, [302, 409], 'One concurrent request must succeed (302) and the other reject cleanly (409)');
            assert.strictEqual(membersTable.filter(m => m.username === 'race_user').length, 1);
        });

        // 13 & 14. Missing / Invalid CSRF token on registration & profile completion
        await runAsyncTest('HTTP 13-14: Missing or invalid CSRF token on POST /member/register returns HTTP 403', async () => {
            const c = createClient();
            const p = await c.request('/member/register');
            assert.strictEqual(p.status, 200);

            const missingRes = await c.request('/member/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'username=nocsrf&email=nocsrf@example.com&password=Password123&confirmPassword=Password123'
            });
            assert.strictEqual(missingRes.status, 403);

            const invalidRes = await c.request('/member/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: '_csrf=forged_token_value&username=badcsrf&email=badcsrf@example.com&password=Password123&confirmPassword=Password123'
            });
            assert.strictEqual(invalidRes.status, 403);
        });

        // 16. Registration rate limiting (5 allowed, 6th returns 429 with Retry-After, ignores X-Forwarded-For)
        await runAsyncTest('HTTP 16: Registration rate limiting returns 429 with Retry-After on 6th POST attempt (ignoring spoofed X-Forwarded-For)', async () => {
            resetRegistrationRateLimits();
            const rlClient = createClient();
            const page = await rlClient.request('/member/register');
            const csrf = extractCsrf(page.body);

            for (let i = 1; i <= 5; i++) {
                const res = await rlClient.request('/member/register', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'X-Forwarded-For': `198.51.100.${i}`
                    },
                    body: new URLSearchParams({
                        _csrf: csrf,
                        username: 'bad', // short username -> 400 validation error, still counts as registration POST attempt
                        email: 'bad',
                        password: 'short',
                        confirmPassword: 'short'
                    }).toString()
                });
                assert.strictEqual(res.status, 400, `Attempt #${i} should reach controller`);
            }

            const blocked = await rlClient.request('/member/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Forwarded-For': '198.51.100.250'
                },
                body: new URLSearchParams({
                    _csrf: csrf,
                    username: 'validuser_6',
                    email: 'valid6@example.com',
                    password: 'Password123',
                    confirmPassword: 'Password123'
                }).toString()
            });
            assert.strictEqual(blocked.status, 429);
            assert.ok(blocked.headers['retry-after'], 'Must include Retry-After header');
        });

        // 20 & 22. Admin registration prevention & authenticated admin blocked from public member registration
        await runAsyncTest('HTTP 20 & 22: Admin registration routes do not exist (404) and authenticated Admin cannot use /member/register', async () => {
            const adminClient = createClient();
            const adminLoginPage = await adminClient.request('/admin/login');
            assert.ok(!adminLoginPage.body.includes('/admin/register'), 'Admin login must never link to registration');
            assert.ok(!adminLoginPage.body.includes('/member/register'), 'Admin login must stay separate from member signup');
            const adminCsrf = extractCsrf(adminLoginPage.body);

            const adminRegGet = await adminClient.request('/admin/register');
            assert.strictEqual(adminRegGet.status, 404);

            const loginRes = await adminClient.request('/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    _csrf: adminCsrf,
                    username: 'admin1',
                    password: 'AdminPass123!'
                }).toString()
            });
            assert.strictEqual(loginRes.status, 302);
            assert.strictEqual(loginRes.headers.location, '/admin');

            const memberRegAsAdmin = await adminClient.request('/member/register');
            assert.strictEqual(memberRegAsAdmin.status, 302);
            assert.strictEqual(memberRegAsAdmin.headers.location, '/admin');

            const adminHome = await adminClient.request('/admin');
            const newCsrf = extractCsrf(adminHome.body) || adminCsrf;
            const postMemberRegAsAdmin = await adminClient.request('/member/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    _csrf: newCsrf,
                    username: 'admin_spoof',
                    email: 'adminspoof@example.com',
                    password: 'Password123',
                    confirmPassword: 'Password123'
                }).toString()
            });
            assert.strictEqual(postMemberRegAsAdmin.status, 403);
        });

        // F.1: Missing CSRF token on POST /member/complete-profile -> 403
        await runAsyncTest('HTTP F1: Missing CSRF token on POST /member/complete-profile returns HTTP 403', async () => {
            const res = await guest1.request('/member/complete-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'action=skip'
            });
            assert.strictEqual(res.status, 403);
        });

        // F.2: Invalid registration input returns HTTP 400 and renders validation feedback
        await runAsyncTest('HTTP F2: Invalid registration input returns HTTP 400 with field validation feedback', async () => {
            resetRegistrationRateLimits();
            const badClient = createClient();
            const page = await badClient.request('/member/register');
            const csrf = extractCsrf(page.body);

            const badRes = await badClient.request('/member/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    _csrf: csrf,
                    username: 'a@b',
                    email: 'not-an-email',
                    password: 'short',
                    confirmPassword: 'different'
                }).toString()
            });
            assert.strictEqual(badRes.status, 400);
            assert.ok(badRes.body.includes('Username cannot contain the @ character.'));
            assert.ok(badRes.body.includes('Please enter a valid email address.'));
            assert.ok(badRes.body.includes('Password must be at least 8 characters long.'));
            assert.ok(badRes.body.includes('Passwords do not match.'));
        });

        // F.3, F.4, F.5: Array, object, and unknown string actions on POST /member/complete-profile return HTTP 400
        await runAsyncTest('HTTP F3-F5: Malformed action (array, object, unknown string) on POST /member/complete-profile returns HTTP 400', async () => {
            const profPage = await guest1.request('/member/profile');
            const csrf = extractCsrf(profPage.body);

            // Array action (repeated field in urlencoded body)
            const arrRes = await guest1.request('/member/complete-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `_csrf=${encodeURIComponent(csrf)}&action=skip&action=complete&name=Polluted`
            });
            assert.strictEqual(arrRes.status, 400);

            // Object action (bracket notation parsed by extended: true)
            const objRes = await guest1.request('/member/complete-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `_csrf=${encodeURIComponent(csrf)}&action%5Bvalue%5D=skip&name=PollutedObj`
            });
            assert.strictEqual(objRes.status, 400);

            // Unknown string action
            const unkRes = await guest1.request('/member/complete-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ _csrf: csrf, action: 'invalid_action', name: 'UnknownAct' }).toString()
            });
            assert.strictEqual(unkRes.status, 400);
        });

        // F.6: Partial profile update preserves omitted fields
        await runAsyncTest('HTTP F6: Partial POST /member/profile omitting name/address preserves existing values', async () => {
            const aliceBefore = membersTable.find(m => m.username === 'alice.reader');
            const expectedName = aliceBefore.name;
            const expectedAddress = aliceBefore.address;

            const profPage = await guest1.request('/member/profile');
            const csrf = extractCsrf(profPage.body);

            const partialRes = await guest1.request('/member/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    _csrf: csrf,
                    phone: '+91 90000 11111'
                }).toString()
            });
            assert.strictEqual(partialRes.status, 302);
            assert.ok(partialRes.headers.location.startsWith('/member/profile?success='));

            const aliceAfter = membersTable.find(m => m.username === 'alice.reader');
            assert.strictEqual(aliceAfter.phone, '+91 90000 11111');
            assert.strictEqual(aliceAfter.name, expectedName, 'Omitted name must be preserved');
            assert.strictEqual(aliceAfter.address, expectedAddress, 'Omitted address must be preserved');
        });

        // F.7: Admin update of a NULL-name self-registered member succeeds
        await runAsyncTest('HTTP F7: Admin can update a NULL-name self-registered member without inventing a name', async () => {
            // Create a NULL-name self-registered member via race_user (who was created in HTTP 12 without completing profile)
            const nullNameMember = membersTable.find(m => m.username === 'race_user');
            assert.strictEqual(nullNameMember.name, null);

            const adminClient = createClient();
            const adminLoginPage = await adminClient.request('/admin/login');
            const adminLoginCsrf = extractCsrf(adminLoginPage.body);
            await adminClient.request('/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ _csrf: adminLoginCsrf, username: 'admin1', password: 'AdminPass123!' }).toString()
            });

            const adminMembersPage = await adminClient.request('/admin/members');
            assert.strictEqual(adminMembersPage.status, 200);
            const adminCsrf = extractCsrf(adminMembersPage.body);

            const updateRes = await adminClient.request(`/admin/members/${nullNameMember.member_id}/update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    _csrf: adminCsrf,
                    name: '',
                    email: 'race.updated@example.com',
                    phone: '9876543211',
                    address: 'Updated by Admin',
                    membership_date: '2026-11-26'
                }).toString()
            });
            assert.strictEqual(updateRes.status, 302);
            assert.ok(updateRes.headers.location.includes('success=Member+updated+successfully'));

            assert.strictEqual(nullNameMember.name, null);
            assert.strictEqual(nullNameMember.email, 'race.updated@example.com');
            assert.strictEqual(nullNameMember.phone, '9876543211');
            assert.strictEqual(nullNameMember.address, 'Updated by Admin');
        });

    } finally {
        await new Promise((resolve) => server.close(resolve));
        pool.query = originalPoolQuery;
        IssueModel.syncOverdueStatuses = originalSyncOverdue;
        resetRateLimits();
        resetRegistrationRateLimits();
    }

    console.log(`\nHTTP REGISTRATION SUMMARY: ${passed} passed, ${failed} failed, total ${passed + failed}`);
    if (failed > 0) {
        throw new Error(`${failed} HTTP registration test(s) failed.`);
    }
}

if (require.main === module) {
    (async () => {
        try {
            await runHttpRegistrationTests();
            console.log('\n✅ All HTTP Member Self-Registration integration tests passed successfully.');
        } catch (err) {
            console.error('\n❌ HTTP Registration test failure:', err);
            process.exit(1);
        } finally {
            try { await pool.end(); } catch (_) {}
        }
    })();
}

module.exports = { runHttpRegistrationTests };
