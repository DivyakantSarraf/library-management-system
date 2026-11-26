const bcrypt = require('bcrypt');
const pool = require('../config/db');

const BCRYPT_SALT_ROUNDS = 12;
const GENERIC_AUTH_ERROR = 'Invalid credentials. Please check your details and try again.';

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
                WHERE username = $1 OR email = $1
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
}

module.exports = AuthService;
