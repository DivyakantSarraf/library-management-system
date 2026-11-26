const pool = require('../config/db');
const IssueModel = require('./issueModel');

class MemberPortalModel {
    /**
     * Resolves the default member when authentication is deferred.
     */
    static async getDefaultMember() {
        const query = `
            SELECT member_id, name, email, phone, address, membership_date, admin_id
            FROM members
            ORDER BY member_id ASC
            LIMIT 1
        `;
        const result = await pool.query(query);
        return result.rows.length ? result.rows[0] : null;
    }

    /**
     * Retrieves a member profile by member_id.
     */
    static async getMemberById(memberId) {
        const query = `
            SELECT member_id, name, email, phone, address, membership_date, admin_id
            FROM members
            WHERE member_id = $1
        `;
        const result = await pool.query(query, [memberId]);
        return result.rows.length ? result.rows[0] : null;
    }

    /**
     * Fetches dashboard metrics and recent loans for a given member.
     */
    static async getDashboardData(memberId) {
        // Sync overdue statuses first so all metrics and records are up to date
        await IssueModel.syncOverdueStatuses();

        // 1. Metric counts
        const metricsQuery = `
            SELECT 
                (SELECT COUNT(*) FROM issues WHERE member_id = $1 AND status = 'Issued') AS active_loans,
                (SELECT COUNT(*) FROM issues WHERE member_id = $1 AND status = 'Overdue') AS overdue_loans,
                (SELECT COUNT(*) FROM issues WHERE member_id = $1 AND status = 'Returned') AS returned_books,
                (SELECT COUNT(*) FROM issues WHERE member_id = $1) AS total_borrowed
        `;
        const metricsResult = await pool.query(metricsQuery, [memberId]);
        const metrics = metricsResult.rows[0];

        // 2. Calculate outstanding overdue fines dynamically
        const overdueQuery = `
            SELECT due_date, fine_amount
            FROM issues
            WHERE member_id = $1 AND status = 'Overdue'
        `;
        const overdueResult = await pool.query(overdueQuery, [memberId]);
        let totalOverdueFine = 0;
        overdueResult.rows.forEach(iss => {
            const calc = IssueModel.calculateFine(iss.due_date, new Date());
            totalOverdueFine += calc.fineAmount;
        });

        // 3. Recent activity loans (most recent 5)
        const recentQuery = `
            SELECT 
                i.issue_id,
                b.book_id,
                b.title AS book_title,
                b.author AS book_author,
                b.isbn,
                b.category,
                i.issue_date,
                i.due_date,
                i.return_date,
                i.status,
                i.fine_amount
            FROM issues i
            JOIN books b ON i.book_id = b.book_id
            WHERE i.member_id = $1
            ORDER BY 
                CASE 
                    WHEN i.status = 'Overdue' THEN 1
                    WHEN i.status = 'Issued' THEN 2
                    ELSE 3 
                END,
                i.issue_date DESC, i.issue_id DESC
            LIMIT 5
        `;
        const recentResult = await pool.query(recentQuery, [memberId]);

        const recentActivity = recentResult.rows.map(issue => {
            let lateDays = 0;
            let displayFine = parseFloat(issue.fine_amount);

            if (issue.status === 'Overdue') {
                const calc = IssueModel.calculateFine(issue.due_date, new Date());
                lateDays = calc.lateDays;
                displayFine = calc.fineAmount;
            } else if (issue.status === 'Returned' && issue.return_date) {
                const calc = IssueModel.calculateFine(issue.due_date, issue.return_date);
                lateDays = calc.lateDays;
            }

            return {
                ...issue,
                lateDays,
                displayFine
            };
        });

        return {
            metrics: {
                activeLoans: parseInt(metrics.active_loans, 10),
                overdueLoans: parseInt(metrics.overdue_loans, 10),
                returnedBooks: parseInt(metrics.returned_books, 10),
                totalBorrowed: parseInt(metrics.total_borrowed, 10),
                totalOverdueFine: totalOverdueFine
            },
            recentActivity
        };
    }

    /**
     * Browse books for members with search, filters, and pagination.
     * Does not expose admin mutation actions.
     */
    static async getBrowseBooks({ search = '', category = 'all', availability = 'all', page = 1, limit = 10 } = {}) {
        const safePage = Math.max(1, parseInt(page, 10) || 1);
        const safeLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
        const safeSearch = (typeof search === 'string' ? search : '').trim();
        const safeCategory = (typeof category === 'string' ? category : 'all').trim();
        const rawAvailability = typeof availability === 'string' ? availability.toLowerCase().trim() : 'all';
        const safeAvailability = ['all', 'available', 'unavailable'].includes(rawAvailability) ? rawAvailability : 'all';

        let query = `
            SELECT book_id, title, author, isbn, category, available_copies
            FROM books
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 1;

        if (safeSearch) {
            query += ` AND (title ILIKE $${paramCount} OR author ILIKE $${paramCount} OR isbn ILIKE $${paramCount})`;
            params.push(`%${safeSearch}%`);
            paramCount++;
        }

        if (safeAvailability === 'available') {
            query += ` AND available_copies > 0`;
        } else if (safeAvailability === 'unavailable') {
            query += ` AND available_copies = 0`;
        }

        if (safeCategory && safeCategory !== 'all') {
            query += ` AND category = $${paramCount}`;
            params.push(safeCategory);
            paramCount++;
        }

        const countQuery = `SELECT COUNT(*) FROM (${query}) AS filtered_books`;
        const countResult = await pool.query(countQuery, params);
        const totalRows = parseInt(countResult.rows[0].count, 10);

        query += ` ORDER BY title ASC, book_id ASC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(safeLimit);
        params.push((safePage - 1) * safeLimit);

        const result = await pool.query(query, params);

        return {
            books: result.rows,
            totalRows,
            totalPages: Math.ceil(totalRows / safeLimit)
        };
    }

    /**
     * Fetches loans/issues history for a specific member.
     */
    static async getMyBooks(memberId, { search = '', status = 'all', page = 1, limit = 10 } = {}) {
        await IssueModel.syncOverdueStatuses();

        const safePage = Math.max(1, parseInt(page, 10) || 1);
        const safeLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
        const safeSearch = (typeof search === 'string' ? search : '').trim();
        const rawStatus = typeof status === 'string' ? status.trim() : 'all';
        const allowedStatuses = ['all', 'Issued', 'Overdue', 'Returned'];
        const matchedStatus = allowedStatuses.find(s => s.toLowerCase() === rawStatus.toLowerCase()) || 'all';

        let query = `
            SELECT 
                i.issue_id,
                b.book_id,
                b.title AS book_title,
                b.author AS book_author,
                b.isbn,
                b.category,
                i.issue_date,
                i.due_date,
                i.return_date,
                i.status,
                i.fine_amount
            FROM issues i
            JOIN books b ON i.book_id = b.book_id
            WHERE i.member_id = $1
        `;
        const params = [memberId];
        let paramCount = 2;

        if (safeSearch) {
            query += ` AND (b.title ILIKE $${paramCount} OR b.author ILIKE $${paramCount} OR b.isbn ILIKE $${paramCount})`;
            params.push(`%${safeSearch}%`);
            paramCount++;
        }

        if (matchedStatus !== 'all') {
            query += ` AND i.status = $${paramCount}`;
            params.push(matchedStatus);
            paramCount++;
        }

        const countQuery = `SELECT COUNT(*) FROM (${query}) AS filtered_member_issues`;
        const countResult = await pool.query(countQuery, params);
        const totalRows = parseInt(countResult.rows[0].count, 10);

        query += ` ORDER BY 
            CASE 
                WHEN i.status = 'Overdue' THEN 1
                WHEN i.status = 'Issued' THEN 2
                ELSE 3 
            END,
            i.issue_date DESC, i.issue_id DESC
            LIMIT $${paramCount} OFFSET $${paramCount + 1}
        `;
        params.push(safeLimit);
        params.push((safePage - 1) * safeLimit);

        const result = await pool.query(query, params);

        const issues = result.rows.map(issue => {
            let lateDays = 0;
            let displayFine = parseFloat(issue.fine_amount) || 0;
            let isDynamicFine = false;

            if (issue.status === 'Overdue') {
                const calc = IssueModel.calculateFine(issue.due_date, new Date());
                lateDays = calc.lateDays;
                displayFine = calc.fineAmount;
                isDynamicFine = true;
            } else if (issue.status === 'Returned' && issue.return_date) {
                const calc = IssueModel.calculateFine(issue.due_date, issue.return_date);
                lateDays = calc.lateDays;
                displayFine = parseFloat(issue.fine_amount) || 0;
                isDynamicFine = false;
            }

            return {
                ...issue,
                lateDays,
                displayFine,
                isDynamicFine
            };
        });

        return {
            issues,
            totalRows,
            totalPages: Math.ceil(totalRows / safeLimit)
        };
    }

    /**
     * Updates member profile details (only permitted fields: name, phone, address).
     */
    static async updateProfile(memberId, { name, phone, address }) {
        const trimmedName = typeof name === 'string' ? name.trim() : '';
        if (!trimmedName) {
            throw new Error('NAME_REQUIRED');
        }
        if (trimmedName.length < 2) {
            throw new Error('NAME_TOO_SHORT');
        }
        if (trimmedName.length > 100) {
            throw new Error('NAME_TOO_LONG');
        }

        let trimmedPhone = null;
        if (phone !== undefined && phone !== null) {
            const p = String(phone).trim();
            if (p.length > 0) {
                if (p.length > 20) {
                    throw new Error('PHONE_TOO_LONG');
                }
                const phoneRegex = /^[0-9+\-()\s]+$/;
                if (!phoneRegex.test(p)) {
                    throw new Error('PHONE_INVALID');
                }
                trimmedPhone = p;
            }
        }

        let trimmedAddress = null;
        if (address !== undefined && address !== null) {
            const a = String(address).trim();
            if (a.length > 0) {
                if (a.length > 500) {
                    throw new Error('ADDRESS_TOO_LONG');
                }
                trimmedAddress = a;
            }
        }

        const query = `
            UPDATE members
            SET name = $1, phone = $2, address = $3
            WHERE member_id = $4
            RETURNING member_id, name, email, phone, address, membership_date, admin_id
        `;
        try {
            const result = await pool.query(query, [
                trimmedName,
                trimmedPhone,
                trimmedAddress,
                memberId
            ]);

            if (result.rows.length === 0) {
                throw new Error('MEMBER_NOT_FOUND');
            }

            return result.rows[0];
        } catch (dbErr) {
            if (dbErr.code === '22001') {
                throw new Error('PHONE_TOO_LONG');
            }
            throw dbErr;
        }
    }
}

module.exports = MemberPortalModel;
