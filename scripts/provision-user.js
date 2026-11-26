#!/usr/bin/env node
/**
 * Safe Account Provisioning Script
 * Library Management System - Authentication Security Corrections (Part 8A.1)
 * 
 * Usage:
 *   node scripts/provision-user.js --role admin --username sysadmin
 *   node scripts/provision-user.js --role member --username alice_1 --email alice@example.com --name "Alice Doe"
 *   node scripts/provision-user.js --update-password --role admin --username demo_admin
 *   node scripts/provision-user.js --update-password --role member --username alice.smith.demo_1791163895268
 * 
 * Security Guardrails:
 * - Prohibits plaintext passwords via CLI arguments to prevent shell history / process exposure.
 * - Hidden interactive password entry (input is not echoed).
 * - Hidden password confirmation.
 * - Minimum 8-character password enforcement.
 * - Explicit confirmation required before updating existing account credentials.
 * - Bcrypt hashing with standard 12 salt rounds.
 * - Zero terminal logging of plaintext passwords or password hashes.
 */

const readline = require('readline');
const path = require('path');
const bcrypt = require('bcrypt');
const pool = require(path.resolve(__dirname, '../config/db'));

const BCRYPT_ROUNDS = 12;

function parseArgs(args = process.argv.slice(2)) {
    const options = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const key = arg.replace(/^--/, '');
            if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
                options[key] = args[i + 1];
                i++;
            } else {
                options[key] = true;
            }
        }
    }
    return options;
}

function promptQuestion(rl, query) {
    return new Promise((resolve) => rl.question(query, resolve));
}

/**
 * Reads hidden interactive input from terminal without echoing characters to screen.
 * Handles TTY and non-TTY (piped) streams gracefully.
 * @param {string} promptText 
 * @returns {Promise<string>}
 */
function readHiddenInput(promptText) {
    return new Promise((resolve) => {
        process.stdout.write(promptText);
        const stdin = process.stdin;

        if (!stdin.isTTY) {
            let data = '';
            const onDataNonTTY = function(chunk) {
                data += chunk.toString();
                if (data.includes('\n')) {
                    stdin.removeListener('data', onDataNonTTY);
                    const lines = data.split(/\r?\n/);
                    return resolve(lines[0]);
                }
            };
            stdin.on('data', onDataNonTTY);
            return;
        }

        const wasRaw = stdin.isRaw;
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');

        let input = '';
        const onData = function(chunk) {
            for (let i = 0; i < chunk.length; i++) {
                const char = chunk[i];
                if (char === '\n' || char === '\r' || char === '\u0004') {
                    stdin.setRawMode(wasRaw || false);
                    stdin.pause();
                    stdin.removeListener('data', onData);
                    process.stdout.write('\n');
                    return resolve(input);
                } else if (char === '\u0003') { // Ctrl+C
                    stdin.setRawMode(wasRaw || false);
                    process.stdout.write('\n');
                    process.exit(1);
                } else if (char === '\u0008' || char === '\x7f') { // Backspace
                    if (input.length > 0) {
                        input = input.slice(0, -1);
                    }
                } else {
                    input += char;
                }
            }
        };
        stdin.on('data', onData);
    });
}

/**
 * Validates password strength according to security standards.
 * @param {string} password 
 * @returns {{valid: boolean, reason?: string}}
 */
function validatePassword(password) {
    if (!password || typeof password !== 'string') {
        return { valid: false, reason: 'Password cannot be empty.' };
    }
    if (password.length < 8) {
        return { valid: false, reason: 'Password must be at least 8 characters long.' };
    }
    return { valid: true };
}

async function run() {
    const rawArgs = process.argv.slice(2);
    const options = parseArgs(rawArgs);

    // Hard Gate: Prohibit plaintext passwords on the CLI
    if (rawArgs.some(a => a.startsWith('--password')) || options.password) {
        console.error('❌ Security Violation: Passing passwords via CLI arguments is prohibited to prevent exposure in process listings and shell history.');
        console.error('Please run the script without --password and enter the password interactively when prompted.');
        process.exit(1);
    }

    let rl = null;

    try {
        let role = options.role;
        let username = options.username;
        let email = options.email;
        let name = options.name;
        let isUpdate = Boolean(options['update-password']);

        rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        // Interactive role selection
        if (!role) {
            const answer = await promptQuestion(rl, 'Select Account Role (admin / member): ');
            role = answer.trim().toLowerCase();
        }

        role = String(role).trim().toLowerCase();
        if (!['admin', 'member'].includes(role)) {
            console.error('❌ Error: Role must be either "admin" or "member".');
            process.exit(1);
        }

        // Interactive username
        if (!username) {
            const answer = await promptQuestion(rl, `Enter ${role} username: `);
            username = answer.trim();
        }

        username = String(username).trim();
        if (!username || username.length < 3) {
            console.error('❌ Error: Username must be at least 3 characters.');
            process.exit(1);
        }

        // Additional member details if creating new member
        if (role === 'member') {
            if (!email) {
                const answer = await promptQuestion(rl, 'Enter member email: ');
                email = answer.trim();
            }
            if (!name && !isUpdate) {
                const answer = await promptQuestion(rl, 'Enter member full name: ');
                name = answer.trim();
            }
        }

        // Close readline before raw mode password entry to prevent stream conflicts
        rl.close();
        rl = null;

        // Secure hidden password entry
        const password = await readHiddenInput('Enter password (min 8 characters): ');
        const validation = validatePassword(password);
        if (!validation.valid) {
            console.error(`❌ Validation Error: ${validation.reason}`);
            process.exit(1);
        }

        // Hidden password confirmation
        const confirmPassword = await readHiddenInput('Confirm password: ');
        if (password !== confirmPassword) {
            console.error('❌ Error: Passwords do not match.');
            process.exit(1);
        }

        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

        if (role === 'admin') {
            const existingRes = await pool.query('SELECT admin_id, username FROM admins WHERE username = $1', [username]);

            if (existingRes.rows.length > 0) {
                // Re-open readline for confirmation prompt
                rl = readline.createInterface({ input: process.stdin, output: process.stdout });
                const confirmUpdate = await promptQuestion(rl, `⚠️ Admin "${username}" already exists. Confirm updating credentials? (yes/no): `);
                rl.close();
                rl = null;

                if (confirmUpdate.trim().toLowerCase() !== 'yes' && confirmUpdate.trim().toLowerCase() !== 'y') {
                    console.log('Update cancelled by operator.');
                    process.exit(0);
                }

                await pool.query(
                    'UPDATE admins SET password_hash = $1 WHERE admin_id = $2',
                    [passwordHash, existingRes.rows[0].admin_id]
                );

                console.log(`✅ Success: Password for admin "${username}" updated securely.`);
            } else {
                await pool.query(
                    'INSERT INTO admins (username, password_hash, role) VALUES ($1, $2, $3)',
                    [username, passwordHash, 'ADMIN']
                );

                console.log(`✅ Success: New admin account "${username}" provisioned successfully.`);
            }
        } else if (role === 'member') {
            const existingRes = await pool.query(
                'SELECT member_id, username, email FROM members WHERE username = $1 OR email = $2',
                [username, email || '']
            );

            if (existingRes.rows.length > 0) {
                rl = readline.createInterface({ input: process.stdin, output: process.stdout });
                const confirmUpdate = await promptQuestion(rl, `⚠️ Member "${username}" already exists. Confirm updating credentials? (yes/no): `);
                rl.close();
                rl = null;

                if (confirmUpdate.trim().toLowerCase() !== 'yes' && confirmUpdate.trim().toLowerCase() !== 'y') {
                    console.log('Update cancelled by operator.');
                    process.exit(0);
                }

                await pool.query(
                    'UPDATE members SET password_hash = $1 WHERE member_id = $2',
                    [passwordHash, existingRes.rows[0].member_id]
                );

                console.log(`✅ Success: Password for member "${username}" updated securely.`);
            } else {
                if (!email) {
                    console.error('❌ Error: Email is required when provisioning a new member.');
                    process.exit(1);
                }
                if (!name) {
                    console.error('❌ Error: Full name is required when provisioning a new member.');
                    process.exit(1);
                }

                const adminRes = await pool.query('SELECT admin_id FROM admins LIMIT 1');
                if (adminRes.rows.length === 0) {
                    console.error('❌ Error: At least one admin must exist before provisioning members.');
                    process.exit(1);
                }
                const adminId = adminRes.rows[0].admin_id;

                await pool.query(
                    `INSERT INTO members (name, email, username, password_hash, membership_date, admin_id)
                     VALUES ($1, $2, $3, $4, CURRENT_DATE, $5)`,
                    [name, email, username, passwordHash, adminId]
                );

                console.log(`✅ Success: New member account "${username}" provisioned successfully.`);
            }
        }
    } catch (err) {
        console.error('❌ Provisioning failed:', err.message);
        process.exit(1);
    } finally {
        if (rl) rl.close();
        await pool.end();
    }
}

if (require.main === module) {
    run();
}

module.exports = {
    parseArgs,
    validatePassword,
    readHiddenInput,
    run
};
