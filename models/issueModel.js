const pool = require('../config/db');

class IssueModel {
    static calculateFine(dueDateInput, referenceDateInput) {
        const dueDate = new Date(dueDateInput);
        const refDate = new Date(referenceDateInput);
        
        dueDate.setHours(0, 0, 0, 0);
        refDate.setHours(0, 0, 0, 0);
        
        if (refDate <= dueDate) {
            return { lateDays: 0, fineAmount: 0 };
        }
        
        const lateDays = Math.round((refDate - dueDate) / (1000 * 60 * 60 * 24));
        return { lateDays, fineAmount: lateDays * 5 };
    }

    static async syncOverdueStatuses() {
        const query = `
            UPDATE issues 
            SET status = 'Overdue' 
            WHERE status = 'Issued' 
              AND return_date IS NULL 
              AND due_date < CURRENT_DATE
        `;
        await pool.query(query);
    }

    static async getIssues({ search = '', status = '', page = 1, limit = 10 }) {
        await this.syncOverdueStatuses();
        
        let query = `
            SELECT
                i.issue_id,
                i.book_id,
                b.title AS book_title,
                b.isbn,
                i.member_id,
                m.name AS member_name,
                m.email AS member_email,
                i.issue_date,
                i.due_date,
                i.return_date,
                i.fine_amount,
                i.status
            FROM issues i
            JOIN books b ON b.book_id = i.book_id
            JOIN members m ON m.member_id = i.member_id
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 1;

        if (search) {
            query += ` AND (b.title ILIKE $${paramCount} OR m.name ILIKE $${paramCount} OR b.isbn ILIKE $${paramCount})`;
            params.push(`%${search}%`);
            paramCount++;
        }

        if (status) {
            query += ` AND i.status = $${paramCount}`;
            params.push(status);
            paramCount++;
        }

        // Count query for pagination
        const countQuery = `SELECT COUNT(*) FROM (${query}) AS filtered_issues`;
        const countResult = await pool.query(countQuery, params);
        const totalRows = parseInt(countResult.rows[0].count, 10);

        // Sorting and Pagination
        query += ` ORDER BY i.issue_date DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(limit);
        params.push((page - 1) * limit);

        const result = await pool.query(query, params);
        
        const issues = result.rows.map(issue => {
            let lateDays = 0;
            let displayFine = parseFloat(issue.fine_amount);
            
            if (issue.status === 'Overdue') {
                const calc = this.calculateFine(issue.due_date, new Date());
                lateDays = calc.lateDays;
                displayFine = calc.fineAmount;
            } else if (issue.status === 'Returned' && issue.return_date) {
                const calc = this.calculateFine(issue.due_date, issue.return_date);
                lateDays = calc.lateDays;
                // fine_amount is already persisted and returned in the query
            }

            return {
                ...issue,
                lateDays,
                displayFine
            };
        });

        return {
            issues,
            totalRows,
            totalPages: Math.ceil(totalRows / limit)
        };
    }

    static async getAvailableBooks() {
        const query = `
            SELECT book_id, title, author, available_copies 
            FROM books 
            WHERE available_copies > 0 
            ORDER BY title ASC
        `;
        const result = await pool.query(query);
        return result.rows;
    }

    static async getMembersForIssue() {
        const query = `
            SELECT member_id, name, email 
            FROM members 
            ORDER BY name ASC
        `;
        const result = await pool.query(query);
        return result.rows;
    }

    static async getAdminId() {
        const query = `SELECT admin_id FROM admins LIMIT 1`;
        const result = await pool.query(query);
        return result.rows.length ? result.rows[0].admin_id : null;
    }

    static async createIssue({ book_id, member_id, issue_date, due_date }) {
        const admin_id = await this.getAdminId();
        if (!admin_id) throw new Error('ADMIN_REQUIRED');

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // 1. Verify member exists
            const memberCheck = await client.query('SELECT member_id FROM members WHERE member_id = $1', [member_id]);
            if (memberCheck.rows.length === 0) {
                throw new Error('MEMBER_NOT_FOUND');
            }

            // 2. Lock the book row and check availability
            const bookCheck = await client.query('SELECT available_copies FROM books WHERE book_id = $1 FOR UPDATE', [book_id]);
            if (bookCheck.rows.length === 0) {
                throw new Error('BOOK_NOT_FOUND');
            }
            if (bookCheck.rows[0].available_copies <= 0) {
                throw new Error('BOOK_UNAVAILABLE');
            }

            // 3. Insert issue record
            const insertIssueQuery = `
                INSERT INTO issues (book_id, member_id, admin_id, issue_date, due_date, status)
                VALUES ($1, $2, $3, $4, $5, 'Issued')
                RETURNING *
            `;
            const issueResult = await client.query(insertIssueQuery, [book_id, member_id, admin_id, issue_date, due_date]);

            // 4. Decrement available_copies
            await client.query('UPDATE books SET available_copies = available_copies - 1 WHERE book_id = $1', [book_id]);

            await client.query('COMMIT');
            return issueResult.rows[0];
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    static async returnIssue(issue_id) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // 1. Lock the issue row
            const issueCheck = await client.query('SELECT book_id, due_date, return_date, status FROM issues WHERE issue_id = $1 FOR UPDATE', [issue_id]);
            if (issueCheck.rows.length === 0) {
                throw new Error('ISSUE_NOT_FOUND');
            }
            
            const issue = issueCheck.rows[0];
            if (issue.return_date !== null || issue.status === 'Returned') {
                throw new Error('ALREADY_RETURNED');
            }

            // 2. Lock the associated book row
            await client.query('SELECT book_id FROM books WHERE book_id = $1 FOR UPDATE', [issue.book_id]);

            // 3. Update the issue record
            // Use current date for return_date
            const returnDate = new Date().toISOString().split('T')[0];
            const { fineAmount } = this.calculateFine(issue.due_date, returnDate);

            await client.query(
                `UPDATE issues SET return_date = $1, status = 'Returned', fine_amount = $2 WHERE issue_id = $3`,
                [returnDate, fineAmount, issue_id]
            );

            // 4. Increment available_copies
            await client.query('UPDATE books SET available_copies = available_copies + 1 WHERE book_id = $1', [issue.book_id]);

            await client.query('COMMIT');
            return true;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }
}

module.exports = IssueModel;
