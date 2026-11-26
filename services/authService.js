const bcrypt = require('bcrypt');
const pool = require('../config/db');

const BCRYPT_SALT_ROUNDS = 12;
const GENERIC_AUTH_ERROR = 'Invalid credentials. Please check your details and try again.';
const GENERIC_REGISTRATION_DUPLICATE_ERROR = 'Unable to create an account with the provided details. Please verify your information or sign in if you already have an account.';
const USERNAME_PATTERN = /^[a-z0-9._-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_REGISTRATION_PASSWORD_LENGTH = 8;
const MAX_BCRYPT_PASSWORD_BYTES = 72;

class AuthService {
    /**
     * Hashes a plaintext password using bcrypt with standard salt rounds.
     * @param {string} plaintextPassword 
     * @returns {Promise<string>}
     */
    static async hashPassword(plaintextPassword) {
        if (!plaintextPassword || typeof plaintextPassword !== 'string' || plaintextPassword.length < 6) {
            throw new Error('Password must be at least 6 characters long.');
        }
        return await bcrypt.hash(plaintextPassword, BCRYPT_SALT_ROUNDS);
    }

    /**
     * Safely compares a candidate password with a stored hash.
     * Rejects placeholder or malformed hashes immediately.
     * @param {string} candidatePassword 
     * @param {string} storedHash 
     * @returns {Promise<boolean>}
     */
    static async comparePassword(candidatePassword, storedHash) {
        if (!candidatePassword || !storedHash || typeof candidatePassword !== 'string' || typeof storedHash !== 'string') {
            return false;
        }

        // Check if stored hash is a deferred placeholder or not a bcrypt hash
        if (storedHash === 'DEFERRED_AUTH' || !storedHash.startsWith('$2')) {
            return false;
        }

        try {
            return await bcrypt.compare(candidatePassword, storedHash);
        } catch (err) {
            console.error('Bcrypt comparison error:', err.message);
            return false;
        }
    }

    /**
     * Verifies Admin credentials against the admins table.
     * Schema: admin_id, username, password_hash, role
     * @param {string} username 
     * @param {string} password 
     * @returns {Promise<{success: boolean, user?: object, message?: string}>}
     */
    static async verifyAdmin(username, password) {
        const cleanUsername = typeof username === 'string' ? username.trim() : '';
        const cleanPassword = typeof password === 'string' ? password : '';

        if (!cleanUsername || !cleanPassword) {
            return {
                success: false,
                message: GENERIC_AUTH_ERROR
            };
        }

        try {
            const query = `
                SELECT admin_id, username, password_hash, role
                FROM admins
                WHERE username = $1
                LIMIT 1
            `;
            const result = await pool.query(query, [cleanUsername]);

            if (result.rows.length === 0) {
                // Perform a dummy hash compare to mitigate timing-based account enumeration attacks
                await bcrypt.compare(cleanPassword, '$2b$12$e8r0.M3pL4w5k6v7u8t9seOG4Qd6lW7n3vOQ7bE.fJ7dZ0j7a2mG.');
                return {
                    success: false,
                    message: GENERIC_AUTH_ERROR
                };
            }

            const admin = result.rows[0];
            const isValid = await this.comparePassword(cleanPassword, admin.password_hash);

            if (!isValid) {
                return {
                    success: false,
                    message: GENERIC_AUTH_ERROR
                };
            }

            // Return minimal sanitized identity object (NEVER return password_hash)
            return {
                success: true,
                user: {
                    id: admin.admin_id,
                    username: admin.username,
                    role: 'admin'
                }
            };
        } catch (err) {
            console.error('Error during admin verification:', err.message);
            throw err;
        }
    }

    /**
     * Verifies Member credentials against the members table.
     * Supports login via username OR email address.
     * Schema: member_id, username, password_hash, name, email
     * @param {string} identifier (username or email)
     * @param {string} password 
     * @returns {Promise<{success: boolean, user?: object, message?: string}>}
     */
    static async verifyMember(identifier, password) {
        const cleanIdentifier = typeof identifier === 'string' ? identifier.trim() : '';
        const cleanPassword = typeof password === 'string' ? password : '';

        if (!cleanIdentifier || !cleanPassword) {
            return {
                success: false,
                message: GENERIC_AUTH_ERROR
            };
        }

        try {
            const query = `
                SELECT member_id, username, password_hash, name, email
                FROM members
                WHERE LOWER(username) = LOWER($1)
                   OR LOWER(email) = LOWER($1)
                LIMIT 1
            `;
            const result = await pool.query(query, [cleanIdentifier]);

            if (result.rows.length === 0) {
                // Perform dummy hash compare to mitigate timing-based account enumeration attacks
                await bcrypt.compare(cleanPassword, '$2b$12$e8r0.M3pL4w5k6v7u8t9seOG4Qd6lW7n3vOQ7bE.fJ7dZ0j7a2mG.');
                return {
                    success: false,
                    message: GENERIC_AUTH_ERROR
                };
            }

            const member = result.rows[0];
            const isValid = await this.comparePassword(cleanPassword, member.password_hash);

            if (!isValid) {
                return {
                    success: false,
                    message: GENERIC_AUTH_ERROR
                };
            }

            // Return minimal sanitized identity object (NEVER return password_hash)
            return {
                success: true,
                user: {
                    id: member.member_id,
                    username: member.username,
                    name: member.name,
                    email: member.email,
                    role: 'member'
                }
            };
        } catch (err) {
            console.error('Error during member verification:', err.message);
            throw err;
        }
    }

    /**
     * Deserializes session identity and loads fresh user record by id and role.
     * @param {number|string} id 
     * @param {string} role 
     * @returns {Promise<object|null>}
     */
    static async getUserByIdAndRole(id, role) {
        const parsedId = parseInt(id, 10);
        if (isNaN(parsedId) || parsedId <= 0) return null;

        try {
            if (role === 'admin') {
                const query = `
                    SELECT admin_id, username, role
                    FROM admins
                    WHERE admin_id = $1
                `;
                const res = await pool.query(query, [parsedId]);
                if (res.rows.length === 0) return null;
                const admin = res.rows[0];
                return {
                    id: admin.admin_id,
                    username: admin.username,
                    role: 'admin'
                };
            } else if (role === 'member') {
                const query = `
                    SELECT member_id, username, email, name, phone, address, membership_date
                    FROM members
                    WHERE member_id = $1
                `;
                const res = await pool.query(query, [parsedId]);
                if (res.rows.length === 0) return null;
                const member = res.rows[0];
                return {
                    id: member.member_id,
                    username: member.username,
                    email: member.email,
                    name: member.name,
                    phone: member.phone,
                    address: member.address,
                    membership_date: member.membership_date,
                    role: 'member'
                };
            }
            return null;
        } catch (err) {
            console.error('Error in getUserByIdAndRole:', err.message);
            return null;
        }
    }

    /**
     * Validates and normalizes member self-registration inputs.
     * @param {{ username: any, email: any, password: any, confirmPassword: any }} input
     * @returns {{ valid: boolean, normalized?: { username: string, email: string, password: string }, fieldErrors?: object, message?: string }}
     */
    static validateRegistrationInput(input = {}) {
        const { username, email, password, confirmPassword } = input || {};
        const fieldErrors = {};

        // 1. Username: string, trimmed, lowercased, 3-50 chars, no '@', ^[a-z0-9._-]+$
        let normalizedUsername = '';
        if (typeof username !== 'string') {
            fieldErrors.username = 'Please enter a valid username.';
        } else {
            normalizedUsername = username.trim().toLowerCase();
            if (!normalizedUsername) {
                fieldErrors.username = 'Username is required.';
            } else if (normalizedUsername.includes('@')) {
                fieldErrors.username = 'Username cannot contain the @ character.';
            } else if (normalizedUsername.length < 3 || normalizedUsername.length > 50) {
                fieldErrors.username = 'Username must be between 3 and 50 characters.';
            } else if (!USERNAME_PATTERN.test(normalizedUsername)) {
                fieldErrors.username = 'Username can only contain lowercase letters, numbers, dots, underscores, and hyphens.';
            }
        }

        // 2. Email: string, trimmed, lowercased, max 150 chars, valid email format
        let normalizedEmail = '';
        if (typeof email !== 'string') {
            fieldErrors.email = 'Please enter a valid email address.';
        } else {
            normalizedEmail = email.trim().toLowerCase();
            if (!normalizedEmail) {
                fieldErrors.email = 'Email address is required.';
            } else if (normalizedEmail.length > 150) {
                fieldErrors.email = 'Email address cannot exceed 150 characters.';
            } else if (!EMAIL_PATTERN.test(normalizedEmail)) {
                fieldErrors.email = 'Please enter a valid email address.';
            }
        }

        // 3. Password: string, min 8 chars, max 72 UTF-8 bytes (no silent truncation)
        if (typeof password !== 'string' || password.length === 0) {
            fieldErrors.password = 'Password is required.';
        } else if (password.length < MIN_REGISTRATION_PASSWORD_LENGTH) {
            fieldErrors.password = 'Password must be at least 8 characters long.';
        } else if (Buffer.byteLength(password, 'utf8') > MAX_BCRYPT_PASSWORD_BYTES) {
            fieldErrors.password = 'Password cannot exceed 72 UTF-8 bytes.';
        }

        // 4. Confirm password: string and exact match
        if (typeof confirmPassword !== 'string' || confirmPassword.length === 0) {
            fieldErrors.confirmPassword = 'Please confirm your password.';
        } else if (typeof password === 'string' && password !== confirmPassword) {
            fieldErrors.confirmPassword = 'Passwords do not match.';
        }

        const errorMessages = Object.values(fieldErrors);
        if (errorMessages.length > 0) {
            return {
                valid: false,
                fieldErrors,
                message: errorMessages[0],
                normalized: {
                    username: normalizedUsername,
                    email: normalizedEmail
                }
            };
        }

        return {
            valid: true,
            fieldErrors: {},
            normalized: {
                username: normalizedUsername,
                email: normalizedEmail,
                password
            }
        };
    }

    /**
     * Registers a new self-service member account.
     * Enforces role='member', bcrypt (12 rounds), parameterized SQL, and non-enumerating duplicate handling.
     * @param {{ username: any, email: any, password: any, confirmPassword: any }} input
     * @returns {Promise<{ success: boolean, status?: number, code?: string, user?: object, message?: string, fieldErrors?: object, normalized?: object }>}
     */
    static async registerMember(input = {}) {
        const validation = this.validateRegistrationInput(input);
        if (!validation.valid) {
            return {
                success: false,
                status: 400,
                code: 'VALIDATION_ERROR',
                message: validation.message,
                fieldErrors: validation.fieldErrors,
                normalized: validation.normalized
            };
        }

        const { username, email, password } = validation.normalized;
        const passwordHash = await this.hashPassword(password);

        const query = `
            INSERT INTO members (
                username,
                email,
                password_hash,
                name,
                phone,
                address,
                membership_date,
                admin_id
            )
            VALUES ($1, $2, $3, NULL, NULL, NULL, CURRENT_DATE, NULL)
            RETURNING member_id, username, email, name, phone, address, membership_date
        `;

        try {
            const result = await pool.query(query, [username, email, passwordHash]);
            const row = result.rows[0];
            return {
                success: true,
                status: 201,
                user: {
                    id: row.member_id,
                    username: row.username,
                    email: row.email,
                    name: row.name,
                    phone: row.phone,
                    address: row.address,
                    membership_date: row.membership_date,
                    role: 'member'
                }
            };
        } catch (err) {
            if (err && err.code === '23505') {
                return {
                    success: false,
                    status: 409,
                    code: 'DUPLICATE_ACCOUNT',
                    message: GENERIC_REGISTRATION_DUPLICATE_ERROR,
                    fieldErrors: {},
                    normalized: { username, email }
                };
            }
            console.error('Error during member registration:', err.message);
            throw err;
        }
    }
}

module.exports = AuthService;
module.exports.GENERIC_REGISTRATION_DUPLICATE_ERROR = GENERIC_REGISTRATION_DUPLICATE_ERROR;
