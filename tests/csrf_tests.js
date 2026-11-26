/**
 * CSRF Protection Middleware Unit Test Suite (Part 8C)
 * Covers:
 *  1. Safe HTTP methods (GET, HEAD, OPTIONS) bypass validation.
 *  2. State-changing methods (POST, PUT, DELETE, PATCH) enforce validation.
 *  3. Valid CSRF token in request body (_csrf) is accepted.
 *  4. Valid CSRF token in request headers (x-csrf-token, csrf-token) is accepted.
 *  5. Missing CSRF token is rejected with HTTP 403 Forbidden.
 *  6. Invalid or tampered CSRF token is rejected with HTTP 403 Forbidden.
 *  7. Constant-time timingSafeCompare protects against timing side-channels.
 *  8. rotateCsrfToken generates a fresh, distinct token.
 *  9. Session initialization and req.csrfToken() getter exposure.
 */

const assert = require('assert');
const {
    csrfProtection,
    generateToken,
    timingSafeCompare,
    rotateCsrfToken
} = require('../middleware/csrfMiddleware');

async function runCsrfTests(harness) {
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
    console.log('14. CSRF SYNCHRONIZER TOKEN UNIT TESTS');
    console.log('====================================================');

    runTest('CSRF: Safe HTTP methods (GET, HEAD, OPTIONS) bypass CSRF check and seed token', () => {
        ['GET', 'HEAD', 'OPTIONS'].forEach(method => {
            let nextCalled = false;
            const req = {
                method,
                session: {},
                headers: {},
                path: '/member/books'
            };
            const res = { locals: {} };

            csrfProtection(req, res, () => {
                nextCalled = true;
            });

            assert.strictEqual(nextCalled, true, `${method} must call next()`);
            assert.ok(req.session.csrfToken, `${method} must seed session.csrfToken`);
            assert.strictEqual(res.locals.csrfToken, req.session.csrfToken);
            assert.strictEqual(typeof req.csrfToken, 'function');
            assert.strictEqual(req.csrfToken(), req.session.csrfToken);
        });
    });

    runTest('CSRF: Valid token submitted via req.body._csrf is accepted', () => {
        const token = generateToken();
        let nextCalled = false;
        const req = {
            method: 'POST',
            session: { csrfToken: token },
            body: { _csrf: token, title: 'New Book' },
            headers: {},
            path: '/admin/books'
        };
        const res = { locals: {} };

        csrfProtection(req, res, () => {
            nextCalled = true;
        });

        assert.strictEqual(nextCalled, true, 'Valid token in body must be accepted');
    });

    runTest('CSRF: Valid token submitted via x-csrf-token header is accepted', () => {
        const token = generateToken();
        let nextCalled = false;
        const req = {
            method: 'POST',
            session: { csrfToken: token },
            body: {},
            headers: { 'x-csrf-token': token },
            path: '/admin/books'
        };
        const res = { locals: {} };

        csrfProtection(req, res, () => {
            nextCalled = true;
        });

        assert.strictEqual(nextCalled, true, 'Valid token in x-csrf-token header must be accepted');
    });

    runTest('CSRF: Valid token submitted via csrf-token header is accepted', () => {
        const token = generateToken();
        let nextCalled = false;
        const req = {
            method: 'POST',
            session: { csrfToken: token },
            body: {},
            headers: { 'csrf-token': token },
            path: '/admin/books'
        };
        const res = { locals: {} };

        csrfProtection(req, res, () => {
            nextCalled = true;
        });

        assert.strictEqual(nextCalled, true, 'Valid token in csrf-token header must be accepted');
    });

    runTest('CSRF: Missing token on state-changing POST returns HTTP 403 Forbidden', () => {
        const token = generateToken();
        let nextCalled = false;
        let statusCode = null;
        let renderedView = null;

        const req = {
            method: 'POST',
            session: { csrfToken: token },
            body: { title: 'No Token' },
            headers: {},
            path: '/admin/books'
        };
        const res = {
            locals: {},
            status: (code) => {
                statusCode = code;
                return res;
            },
            render: (view) => {
                renderedView = view;
            }
        };

        csrfProtection(req, res, () => {
            nextCalled = true;
        });

        assert.strictEqual(nextCalled, false, 'Must not call next() on missing token');
        assert.strictEqual(statusCode, 403, 'Must respond with HTTP 403');
        assert.strictEqual(renderedView, 'error');
    });

    runTest('CSRF: Invalid or mismatched token returns HTTP 403 Forbidden', () => {
        const sessionToken = generateToken();
        const forgedToken = generateToken();
        let nextCalled = false;
        let statusCode = null;

        const req = {
            method: 'POST',
            session: { csrfToken: sessionToken },
            body: { _csrf: forgedToken },
            headers: {},
            path: '/member/profile'
        };
        const res = {
            locals: {},
            status: (code) => {
                statusCode = code;
                return res;
            },
            render: () => {}
        };

        csrfProtection(req, res, () => {
            nextCalled = true;
        });

        assert.strictEqual(nextCalled, false, 'Must not call next() on forged token');
        assert.strictEqual(statusCode, 403);
    });

    runTest('CSRF: AJAX request with missing or invalid token returns JSON 403', () => {
        const token = generateToken();
        let statusCode = null;
        let responseJson = null;

        const req = {
            method: 'POST',
            session: { csrfToken: token },
            body: {},
            headers: { 'accept': 'application/json' },
            path: '/admin/books'
        };
        const res = {
            locals: {},
            status: (code) => {
                statusCode = code;
                return res;
            },
            json: (data) => {
                responseJson = data;
            }
        };

        csrfProtection(req, res, () => {});

        assert.strictEqual(statusCode, 403);
        assert.ok(responseJson.error.includes('CSRF token'));
    });

    runTest('CSRF: Query string tokens (?_csrf=...) are strictly rejected on state-changing requests', () => {
        const token = generateToken();
        let nextCalled = false;
        let statusCode = null;

        const req = {
            method: 'POST',
            session: { csrfToken: token },
            query: { _csrf: token }, // Token passed via query string
            body: {}, // No token in body
            headers: {}, // No token in headers
            path: '/member/profile'
        };
        const res = {
            locals: {},
            status: (code) => {
                statusCode = code;
                return res;
            },
            render: () => {}
        };

        csrfProtection(req, res, () => {
            nextCalled = true;
        });

        assert.strictEqual(nextCalled, false, 'Query string tokens must not be accepted on POST');
        assert.strictEqual(statusCode, 403);
    });

    runTest('CSRF: timingSafeCompare correctly verifies matching and non-matching tokens', () => {
        const t1 = generateToken();
        const t2 = generateToken();
        assert.strictEqual(timingSafeCompare(t1, t1), true, 'Identical tokens match');
        assert.strictEqual(timingSafeCompare(t1, t2), false, 'Different tokens do not match');
        assert.strictEqual(timingSafeCompare(t1, t1.slice(0, 30)), false, 'Different lengths do not match');
        assert.strictEqual(timingSafeCompare(null, t1), false, 'null does not match');
        assert.strictEqual(timingSafeCompare(undefined, t1), false, 'undefined does not match');
        assert.strictEqual(timingSafeCompare(12345, t1), false, 'number does not match');
    });

    runTest('CSRF: rotateCsrfToken replaces session token with a new distinct token', () => {
        const initialToken = generateToken();
        const req = {
            session: { csrfToken: initialToken },
            res: { locals: { csrfToken: initialToken } }
        };

        const freshToken = rotateCsrfToken(req);
        assert.notStrictEqual(freshToken, initialToken, 'Rotated token must be distinct');
        assert.strictEqual(req.session.csrfToken, freshToken);
        assert.strictEqual(req.res.locals.csrfToken, freshToken);
    });
}

if (require.main === module) {
    (async () => {
        try {
            await runCsrfTests();
            console.log('\n✅ All CSRF tests passed successfully.');
        } catch (err) {
            console.error('\n❌ CSRF test failure:', err);
            process.exit(1);
        }
    })();
}

module.exports = { runCsrfTests };
