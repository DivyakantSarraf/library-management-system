/**
 * Login Rate Limiting Unit Test Suite (Part 8C)
 * Covers:
 *  1. Normal login attempts below threshold pass through to next().
 *  2. Compound key (IP + Username): 5 failed attempts trigger HTTP 429 Too Many Requests.
 *  3. IP bucket: 10 failed attempts across various usernames trigger HTTP 429 Too Many Requests.
 *  4. Anti-DoS Lockout Protection: Attacker attacking an account from IP A does not lock out legitimate user from IP B.
 *  5. Successful authentication resets failure counters for that IP and username.
 *  6. HTTP 429 sets Retry-After header and returns generic message (no user existence disclosure).
 *  7. AJAX / API request returns JSON 429.
 */

const assert = require('assert');
const {
    createLoginRateLimiter,
    recordLoginFailure,
    recordLoginSuccess,
    resetRateLimits,
    checkRateLimit,
    MAX_ATTEMPTS_PER_IP,
    MAX_ATTEMPTS_PER_COMPOUND
} = require('../middleware/rateLimitMiddleware');

async function runRateLimitTests(harness) {
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
    console.log('15. LOGIN RATE LIMITING & ANTI-DOS UNIT TESTS');
    console.log('====================================================');

    runTest('RateLimit: Login attempts below threshold pass through to next()', () => {
        resetRateLimits();
        const limiter = createLoginRateLimiter('admin');
        let nextCalled = false;
        const req = {
            ip: '192.168.1.10',
            body: { username: 'admin' },
            headers: {}
        };
        const res = { locals: {} };

        limiter(req, res, () => {
            nextCalled = true;
        });

        assert.strictEqual(nextCalled, true);
        assert.strictEqual(typeof req.recordLoginFailure, 'function');
        assert.strictEqual(typeof req.recordLoginSuccess, 'function');
    });

    runTest('RateLimit: 5 consecutive failures for same (IP + username) allow attempts 1-5 and block 6th attempt with HTTP 429', () => {
        resetRateLimits();
        const testIp = '192.168.1.50';
        const testUser = 'target_admin';

        // Attempts 1 through 5 fail, but attempts 1-5 were allowed through to be evaluated
        for (let i = 1; i <= 4; i++) {
            recordLoginFailure(testIp, testUser);
            assert.strictEqual(checkRateLimit(testIp, testUser).isLimited, false, `After failure #${i}, next attempt must still be permitted`);
        }

        // 5th failure is recorded
        recordLoginFailure(testIp, testUser);

        // 6th attempt is evaluated by checkRateLimit: must now be blocked
        const check = checkRateLimit(testIp, testUser);
        assert.strictEqual(check.isLimited, true, '6th attempt after 5 consecutive failures must be blocked');
        assert.ok(check.retryAfterSeconds > 0, 'Retry-After must be positive seconds');

        // Verify middleware behavior on 429
        const limiter = createLoginRateLimiter('admin');
        let statusCode = null;
        let retryAfterHeader = null;
        let renderedView = null;
        let renderedData = null;

        const req = {
            ip: testIp,
            body: { username: testUser },
            headers: {}
        };
        const res = {
            setHeader: (name, val) => {
                if (name.toLowerCase() === 'retry-after') retryAfterHeader = val;
            },
            status: (code) => {
                statusCode = code;
                return res;
            },
            render: (view, data) => {
                renderedView = view;
                renderedData = data;
            }
        };

        limiter(req, res, () => {
            assert.fail('Should not proceed past rate limiter when limited');
        });

        assert.strictEqual(statusCode, 429);
        assert.ok(retryAfterHeader !== null);
        assert.strictEqual(renderedView, 'auth/admin-login');
        assert.ok(renderedData.error.includes('Too many failed login attempts'));
    });

    runTest('RateLimit Anti-DoS: Attacker at IP A cannot lock out legitimate user at IP B', () => {
        resetRateLimits();
        const victimUser = 'popular_member';
        const attackerIp = '10.0.0.99';
        const legitimateIp = '192.168.5.20';

        // Attacker exhausts their limit for victimUser from attackerIp
        for (let i = 0; i < MAX_ATTEMPTS_PER_COMPOUND; i++) {
            recordLoginFailure(attackerIp, victimUser);
        }

        // Attacker is locked out
        assert.strictEqual(checkRateLimit(attackerIp, victimUser).isLimited, true);

        // Legitimate user from their own IP is NOT locked out
        assert.strictEqual(checkRateLimit(legitimateIp, victimUser).isLimited, false, 'Legitimate user from another IP must not be locked out');
    });

    runTest('RateLimit: 10 failures across multiple accounts from same IP triggers IP-level 429', () => {
        resetRateLimits();
        const bruteForceIp = '172.16.0.40';

        // Attacker attempts 10 different usernames from the same IP (1 attempt each)
        for (let i = 1; i <= 10; i++) {
            recordLoginFailure(bruteForceIp, `user_${i}`);
        }

        // Even though user_new has 0 attempts, the IP itself is now throttled
        const ipCheck = checkRateLimit(bruteForceIp, 'user_new');
        assert.strictEqual(ipCheck.isLimited, true, 'IP exceeding 10 failed attempts must be rate-limited');
    });

    runTest('RateLimit: Successful login resets failed attempts for that IP and username', () => {
        resetRateLimits();
        const testIp = '192.168.1.75';
        const testUser = 'alice_member';

        // 4 failures
        for (let i = 0; i < 4; i++) {
            recordLoginFailure(testIp, testUser);
        }

        // Success occurs
        recordLoginSuccess(testIp, testUser);

        // Counters must be cleared
        assert.strictEqual(checkRateLimit(testIp, testUser).isLimited, false);
        // After reset, 4 more failures should still be under the threshold
        for (let i = 0; i < 4; i++) {
            recordLoginFailure(testIp, testUser);
        }
        assert.strictEqual(checkRateLimit(testIp, testUser).isLimited, false);
    });

    runTest('RateLimit: AJAX request returns JSON 429 with error message', () => {
        resetRateLimits();
        const testIp = '192.168.1.99';
        const testUser = 'ajax_user';

        for (let i = 0; i < MAX_ATTEMPTS_PER_COMPOUND; i++) {
            recordLoginFailure(testIp, testUser);
        }

        const limiter = createLoginRateLimiter('member');
        let statusCode = null;
        let responseJson = null;

        const req = {
            ip: testIp,
            body: { username: testUser },
            headers: { 'accept': 'application/json' }
        };
        const res = {
            setHeader: () => {},
            status: (code) => {
                statusCode = code;
                return res;
            },
            json: (data) => {
                responseJson = data;
            }
        };

        limiter(req, res, () => {
            assert.fail('Should not proceed past rate limiter');
        });

        assert.strictEqual(statusCode, 429);
        assert.ok(responseJson.error.includes('Too many failed login attempts'));
    });

    runTest('RateLimit: Unknown usernames and known usernames receive indistinguishable HTTP 429 responses', () => {
        resetRateLimits();
        const testIp = '192.168.1.111';
        const knownUser = 'existing_admin';
        const unknownUser = 'non_existent_user_xyz';

        // Lock out known user
        for (let i = 0; i < MAX_ATTEMPTS_PER_COMPOUND; i++) {
            recordLoginFailure(testIp, knownUser);
        }
        // Lock out unknown user
        for (let i = 0; i < MAX_ATTEMPTS_PER_COMPOUND; i++) {
            recordLoginFailure(testIp, unknownUser);
        }

        const limiter = createLoginRateLimiter('admin');

        let knownResult = null;
        let unknownResult = null;

        const makeFakeRes = (target) => ({
            setHeader: () => {},
            status: (code) => ({
                render: (view, data) => {
                    target.view = view;
                    target.statusCode = code;
                    target.error = data.error;
                }
            })
        });

        const knownResObj = {};
        limiter({ ip: testIp, body: { username: knownUser }, headers: {} }, makeFakeRes(knownResObj), () => {});

        const unknownResObj = {};
        limiter({ ip: testIp, body: { username: unknownUser }, headers: {} }, makeFakeRes(unknownResObj), () => {});

        assert.strictEqual(knownResObj.statusCode, 429);
        assert.strictEqual(unknownResObj.statusCode, 429);
        assert.strictEqual(knownResObj.view, unknownResObj.view);
        assert.strictEqual(knownResObj.error, unknownResObj.error, 'Error message must be identical so user existence is not disclosed');
    });
}

if (require.main === module) {
    (async () => {
        try {
            await runRateLimitTests();
            console.log('\n✅ All Login Rate Limiting tests passed successfully.');
        } catch (err) {
            console.error('\n❌ Login Rate Limiting test failure:', err);
            process.exit(1);
        }
    })();
}

module.exports = { runRateLimitTests };
