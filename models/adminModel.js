const pool = require('../config/db');

const IssueModel = require('./issueModel');

class AdminModel {
    static async getDashboardMetrics() {
        await IssueModel.syncOverdueStatuses();
        
        const query = `
            SELECT 
                (SELECT COUNT(*) FROM books) AS total_books,
                (SELECT COUNT(*) FROM members) AS total_members,
                (SELECT COALESCE(SUM(available_copies), 0) FROM books) AS available_copies,
                (SELECT COUNT(*) FROM issues WHERE status = 'Issued') AS active_issues,
                (SELECT COUNT(*) FROM issues WHERE status = 'Overdue') AS overdue_issues,
                (SELECT COUNT(*) FROM books WHERE available_copies = 0) AS out_of_stock_books
        `;
        const result = await pool.query(query);
        return result.rows[0];
    }

    static async getRecentCirculation(limit = 8) {
        const query = `
            SELECT 
                i.issue_id,
                b.title AS book_title,
                m.name AS member_name,
                i.issue_date,
                i.due_date,
                i.return_date,
                i.status,
                i.fine_amount
            FROM issues i
            JOIN books b ON i.book_id = b.book_id
            JOIN members m ON i.member_id = m.member_id
            ORDER BY i.issue_date DESC, i.issue_id DESC
            LIMIT $1
        `;
        const result = await pool.query(query, [limit]);
        return result.rows.map(issue => {
            let displayFine = parseFloat(issue.fine_amount);
            if (issue.status === 'Overdue') {
                const calc = IssueModel.calculateFine(issue.due_date, new Date());
                displayFine = calc.fineAmount;
            }
            return {
                ...issue,
                displayFine
            };
        });
    }
}

module.exports = AdminModel;
