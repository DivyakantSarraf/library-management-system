const pool = require('../config/db');

class MemberModel {
    static async getMembers({ search = '', page = 1, limit = 10 }) {
        let query = `
            SELECT member_id, name, email, phone, address, membership_date, admin_id 
            FROM members 
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 1;

        if (search) {
            query += ` AND (name ILIKE $${paramCount} OR email ILIKE $${paramCount} OR phone ILIKE $${paramCount})`;
            params.push(`%${search}%`);
            paramCount++;
        }

        // Count query for pagination
        const countQuery = `SELECT COUNT(*) FROM (${query}) AS filtered_members`;
        const countResult = await pool.query(countQuery, params);
        const totalRows = parseInt(countResult.rows[0].count, 10);

        // Sorting and Pagination
        query += ` ORDER BY name ASC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(limit);
        params.push((page - 1) * limit);

        const result = await pool.query(query, params);
        
        return {
            members: result.rows,
            totalRows,
            totalPages: Math.ceil(totalRows / limit)
        };
    }

    static async getAdminId() {
        const query = `SELECT admin_id FROM admins LIMIT 1`;
        const result = await pool.query(query);
        return result.rows.length ? result.rows[0].admin_id : null;
    }

    static async addMember({ name, email, phone, address, membership_date }) {
        const admin_id = await this.getAdminId();
        if (!admin_id) {
            throw new Error('ADMIN_REQUIRED');
        }
        
        // Auto-generate deferred authentication fields to satisfy NOT NULL constraints
        const username = email.split('@')[0] + '_' + Date.now();
        const password_hash = 'DEFERRED_AUTH';

        try {
            const query = `
                INSERT INTO members (name, email, phone, address, membership_date, username, password_hash, admin_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
            `;
            const result = await pool.query(query, [name, email, phone, address, membership_date, username, password_hash, admin_id]);
            return result.rows[0];
        } catch (err) {
            if (err.constraint === 'members_email_key') {
                throw new Error('DUPLICATE_EMAIL');
            }
            throw err;
        }
    }

    static async updateMember(member_id, { name, email, phone, address, membership_date }) {
        const admin_id = await this.getAdminId();
        if (!admin_id) {
            throw new Error('ADMIN_REQUIRED');
        }

        try {
            const query = `
                UPDATE members 
                SET name = $1, email = $2, phone = $3, address = $4, membership_date = $5
                WHERE member_id = $6
                RETURNING *
            `;
            const result = await pool.query(query, [name, email, phone, address, membership_date, member_id]);
            return result.rows[0];
        } catch (err) {
            if (err.constraint === 'members_email_key') {
                throw new Error('DUPLICATE_EMAIL');
            }
            throw err;
        }
    }

    static async deleteMember(member_id) {
        try {
            const query = `DELETE FROM members WHERE member_id = $1 RETURNING *`;
            const result = await pool.query(query, [member_id]);
            return result.rows[0];
        } catch (err) {
            // "issues" table references members (usually as issues_member_fk)
            if (err.constraint && err.constraint.includes('fk')) {
                throw new Error('FOREIGN_KEY_VIOLATION');
            }
            throw err;
        }
    }
}

module.exports = MemberModel;
