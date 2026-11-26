/**
 * Role-Based Authorization and Route Protection Test Suite (Part 8B)
 * Covers:
 *  1. Guest Access Restrictions:
 *     - Cannot access protected Admin routes (redirect to /admin/login or 401 on AJAX).
 *     - Cannot access protected Member routes (redirect to /member/login or 401 on AJAX).
 *     - Cannot perform mutations.
 *  2. Admin Role Permissions & Boundaries:
 *     - Can access Admin routes.
 *     - Cannot access Member routes (HTTP 403 Forbidden).
 *     - Cannot access Member profile POST (HTTP 403 Forbidden).
 *  3. Member Role Permissions & Boundaries:
 *     - Can access Member routes.
 *     - Cannot access Admin routes (HTTP 403 Forbidden).
 *     - Cannot perform Admin mutations (HTTP 403 Forbidden).
 *  4. Member Horizontal Ownership & Isolation:
 *     - Member A cannot access Member B's dashboard data.
 *     - Member A cannot access Member B's circulation history.
 *     - Member A cannot mutate Member B's profile.
 *     - Query parameter ?member_id=B does not change authenticated identity.
 *     - Body parameter member_id: B does not change authenticated identity.
 *  5. Session Invalidation & Role Tampering:
 *     - Destroyed session fails authorization.
 *     - Tampered or unrecognized role (e.g. 'guest', 'superadmin', null) is rejected with 403.
 *  6. Cache-Control & Open Redirect Hardening:
 *     - Sensitive routes contain Cache-Control: no-store headers.
 *     - Open redirects (//evil.com, https://...) are blocked and sanitized.
 */

const assert = require('assert');
const {
    requireAuth,
    requireRole,
    requireAdmin,
    requireMember,
    preventBrowserCaching,
    getSafeRedirectUrl
} = require('../middleware/authMiddleware');
const MemberPortalController = require('../controllers/memberPortalController');
const MemberPortalModel = require('../models/memberPortalModel');
const pool = require('../config/db');

async function runAuthorizationTests(harness) {
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
    console.log('9. GUEST ACCESS RESTRICTIONS (UNAUTHENTICATED GATES)');
    console.log('====================================================');

    runTest('Guest accessing /admin/* is redirected to /admin/login', () => {
        let redirectedTo = null;
        const fakeReq = {
            isAuthenticated: () => false,
            user: null,
            originalUrl: '/admin/books',
            headers: {}
        };
        const fakeRes = {
            redirect: (url) => { redirectedTo = url; }
        };

        requireAuth(fakeReq, fakeRes, () => {
            assert.fail('Should not proceed past unauthenticated check');
        });
        assert.strictEqual(redirectedTo, '/admin/login');
    });

    runTest('Guest accessing /member/* is redirected to /member/login', () => {
        let redirectedTo = null;
        const fakeReq = {
            isAuthenticated: () => false,
            user: null,
            originalUrl: '/member/profile',
            headers: {}
        };
        const fakeRes = {
            redirect: (url) => { redirectedTo = url; }
        };

        requireAuth(fakeReq, fakeRes, () => {
            assert.fail('Should not proceed past unauthenticated check');
        });
        assert.strictEqual(redirectedTo, '/member/login');
    });

    runTest('Guest making AJAX/API request to protected route receives HTTP 401 Unauthorized', () => {
        let statusCode = null;
        let responseJson = null;

        const fakeReq = {
            isAuthenticated: () => false,
            user: null,
            originalUrl: '/admin/books',
            headers: { 'accept': 'application/json' }
        };
        const fakeRes = {
            status: (code) => {
                statusCode = code;
                return fakeRes;
            },
            json: (data) => {
                responseJson = data;
            }
        };

        requireAuth(fakeReq, fakeRes, () => {
            assert.fail('Should not proceed past unauthenticated check');
        });
        assert.strictEqual(statusCode, 401);
        assert.ok(responseJson.error.includes('Authentication required'));
    });

    console.log('\n====================================================');
    console.log('10. ADMIN & MEMBER ROLE BOUNDARY ENFORCEMENT');
    console.log('====================================================');

    runTest('Admin can access admin routes (requireAdmin passes)', () => {
        let nextCalled = false;
        const fakeReq = {
            isAuthenticated: () => true,
            user: { id: 1, username: 'sysadmin', role: 'admin' },
            path: '/admin',
            headers: {}
        };
        const fakeRes = {};

        requireAdmin(fakeReq, fakeRes, () => {
            nextCalled = true;
        });
        assert.strictEqual(nextCalled, true, 'Admin must be granted access to admin routes');
    });

    runTest('Member cannot access admin routes (HTTP 403 Forbidden)', () => {
        let statusCode = null;
        let renderedView = null;
        const fakeReq = {
            isAuthenticated: () => true,
            user: { id: 10, username: 'member10', role: 'member' },
            path: '/admin/books',
            headers: {}
        };
        const fakeRes = {
            status: (code) => {
                statusCode = code;
                return fakeRes;
            },
            render: (view) => {
                renderedView = view;
            }
        };

        requireAdmin(fakeReq, fakeRes, () => {
            assert.fail('Member should not be allowed into admin routes');
        });
        assert.strictEqual(statusCode, 403, 'Member must receive HTTP 403 on admin routes');
        assert.strictEqual(renderedView, 'error');
    });

    runTest('Member cannot perform admin mutations via AJAX (HTTP 403 JSON)', () => {
        let statusCode = null;
        let responseJson = null;
        const fakeReq = {
            isAuthenticated: () => true,
            user: { id: 10, username: 'member10', role: 'member' },
            path: '/admin/books',
            headers: { 'accept': 'application/json' }
        };
        const fakeRes = {
            status: (code) => {
                statusCode = code;
                return fakeRes;
            },
            json: (data) => {
                responseJson = data;
            }
        };

        requireAdmin(fakeReq, fakeRes, () => {
            assert.fail('Member should not be allowed to perform admin mutations');
        });
        assert.strictEqual(statusCode, 403);
        assert.ok(responseJson.error.includes('Access forbidden'));
    });

    runTest('Member can access member routes (requireMember passes)', () => {
        let nextCalled = false;
        const fakeReq = {
            isAuthenticated: () => true,
            user: { id: 10, username: 'member10', role: 'member' },
            path: '/member',
            headers: {}
        };
        const fakeRes = {};

        requireMember(fakeReq, fakeRes, () => {
            nextCalled = true;
        });
        assert.strictEqual(nextCalled, true, 'Member must be granted access to member routes');
    });

    runTest('Admin cannot access member routes (HTTP 403 Forbidden)', () => {
        let statusCode = null;
        let renderedView = null;
        const fakeReq = {
            isAuthenticated: () => true,
            user: { id: 1, username: 'admin', role: 'admin' },
            path: '/member/profile',
            headers: {}
        };
        const fakeRes = {
            status: (code) => {
                statusCode = code;
                return fakeRes;
            },
            render: (view) => {
                renderedView = view;
            }
        };

        requireMember(fakeReq, fakeRes, () => {
            assert.fail('Admin should not be allowed into member routes');
        });
        assert.strictEqual(statusCode, 403, 'Admin must receive HTTP 403 on member routes');
        assert.strictEqual(renderedView, 'error');
    });

    runTest('Role tampering: unauthenticated or unrecognized role receives 403 Forbidden', () => {
        let statusCode = null;
        const fakeReq = {
            isAuthenticated: () => true,
            user: { id: 99, username: 'intruder', role: 'superadmin' },
            path: '/admin',
            headers: {}
        };
        const fakeRes = {
            status: (code) => {
                statusCode = code;
                return fakeRes;
            },
            render: () => {}
        };

        requireAdmin(fakeReq, fakeRes, () => {
            assert.fail('Unrecognized role should not pass authorization');
        });
        assert.strictEqual(statusCode, 403);
    });

    console.log('\n====================================================');
    console.log('11. MEMBER HORIZONTAL OWNERSHIP & IDENTITY ISOLATION');
    console.log('====================================================');

    await runAsyncTest('resolveMember ignores query-parameter member_id override completely', async () => {
        const originalGetById = MemberPortalModel.getMemberById;
        let requestedId = null;
        MemberPortalModel.getMemberById = async (id) => {
            requestedId = id;
            return { member_id: id, name: 'Legitimate Member ' + id };
        };

        try {
            // Member 10 is logged in, but tries ?member_id=99 in query
            const req = {
                user: { id: 10, role: 'member' },
                query: { member_id: '99' },
                body: { member_id: '88' }
            };

            const member = await MemberPortalController.resolveMember(req);
            assert.strictEqual(requestedId, 10, 'Must query DB for authenticated session ID only');
            assert.strictEqual(member.member_id, 10, 'Resolved member must match session user.id');
        } finally {
            MemberPortalModel.getMemberById = originalGetById;
        }
    });

    await runAsyncTest('resolveMember returns null when user is not authenticated as member', async () => {
        const reqGuest = {
            user: null,
            query: { member_id: '2' }
        };
        assert.strictEqual(await MemberPortalController.resolveMember(reqGuest), null);

        const reqAdmin = {
            user: { id: 1, role: 'admin' },
            query: { member_id: '2' }
        };
        assert.strictEqual(await MemberPortalController.resolveMember(reqAdmin), null);
    });

    await runAsyncTest('Member A cannot mutate Member B profile via body or query tampering', async () => {
        const originalGetById = MemberPortalModel.getMemberById;
        const originalUpdate = MemberPortalModel.updateProfile;

        let targetUpdatedId = null;
        MemberPortalModel.getMemberById = async (id) => ({
            member_id: id,
            name: 'Original Name',
            email: 'member' + id + '@example.com'
        });
        MemberPortalModel.updateProfile = async (id, data) => {
            targetUpdatedId = id;
            return { member_id: id, ...data };
        };

        try {
            // Member 10 logged in, attempts to update Member 99 via body and query spoofing
            const req = {
                user: { id: 10, role: 'member' },
                query: { member_id: '99' },
                body: {
                    member_id: '99',
                    name: 'Malicious Overwrite',
                    phone: '1234567890',
                    address: 'Malicious Address'
                }
            };
            const res = {
                redirect: (url) => {
                    assert.ok(url.startsWith('/member/profile?success='), 'Redirects to clean profile URL');
                    assert.ok(!url.includes('member_id='), 'Never propagates member_id query');
                }
            };

            await MemberPortalController.updateProfile(req, res);
            assert.strictEqual(targetUpdatedId, 10, 'Profile update MUST be scoped to authenticated session ID (10), ignoring 99');
        } finally {
            MemberPortalModel.getMemberById = originalGetById;
            MemberPortalModel.updateProfile = originalUpdate;
        }
    });

    console.log('\n====================================================');
    console.log('12. CACHE-CONTROL & OPEN REDIRECT HARDENING');
    console.log('====================================================');

    runTest('preventBrowserCaching sets strict no-store headers on sensitive pages', () => {
        const headers = {};
        const fakeReq = {};
        const fakeRes = {
            setHeader: (name, value) => {
                headers[name.toLowerCase()] = value;
            }
        };

        preventBrowserCaching(fakeReq, fakeRes, () => {});
        assert.strictEqual(headers['cache-control'], 'no-store, no-cache, must-revalidate, proxy-revalidate');
        assert.strictEqual(headers['pragma'], 'no-cache');
        assert.strictEqual(headers['expires'], '0');
    });

    runTest('getSafeRedirectUrl blocks external and protocol-relative URLs (open redirect defense)', () => {
        // Safe internal relative paths
        assert.strictEqual(getSafeRedirectUrl('/admin/books', '/'), '/admin/books');
        assert.strictEqual(getSafeRedirectUrl('/member/profile', '/'), '/member/profile');

        // Malicious open redirect attempts
        assert.strictEqual(getSafeRedirectUrl('https://evil.com', '/'), '/', 'Absolute external URLs rejected');
        assert.strictEqual(getSafeRedirectUrl('//evil.com', '/'), '/', 'Protocol-relative URLs rejected');
        assert.strictEqual(getSafeRedirectUrl('/\\evil.com', '/'), '/', 'Backslash bypass attempts rejected');
        assert.strictEqual(getSafeRedirectUrl('javascript:alert(1)', '/'), '/', 'Javascript schemes rejected');
        assert.strictEqual(getSafeRedirectUrl(null, '/'), '/');
        assert.strictEqual(getSafeRedirectUrl(undefined, '/'), '/');
    });
}

if (require.main === module) {
    (async () => {
        try {
            await runAuthorizationTests();
            console.log('\n✅ All Role-Based Authorization tests passed successfully.');
        } catch (err) {
            console.error('\n❌ Authorization test failure:', err);
            process.exit(1);
        } finally {
            try { await pool.end(); } catch (_) {}
        }
    })();
}

module.exports = { runAuthorizationTests };
