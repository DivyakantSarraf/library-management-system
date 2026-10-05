const pool = require('../config/db');
const IssueModel = require('./issueModel');

class ReportModel {
    static async getSummaryMetrics(fromDate, toDate) {
        // Sync overdue statuses first to ensure accuracy
        await IssueModel.syncOverdueStatuses();

        const params = [fromDate, toDate];

        // Global metrics (Independent of date range)
        const globalQuery = `
            SELECT 
                (SELECT COUNT(*) FROM books) AS total_books,
                (SELECT COALESCE(SUM(available_copies), 0) FROM books) AS available_copies,
                (SELECT COUNT(*) FROM issues WHERE status = 'Issued') AS active_issues,
                (SELECT COUNT(*) FROM issues WHERE status = 'Overdue') AS overdue_issues
        `;
        
        // Period metrics (Dependent on date range)
        // issues_in_period: issued between dates
        // returns_in_period: returned between dates
        // overdues_in_period: currently overdue and was issued between dates
        const periodQuery = `
            SELECT
                (SELECT COUNT(*) FROM issues WHERE issue_date >= $1 AND issue_date <= $2) AS issues_in_period,
                (SELECT COUNT(*) FROM issues WHERE return_date >= $1 AND return_date <= $2) AS returns_in_period,
                (SELECT COUNT(*) FROM issues WHERE status = 'Overdue' AND issue_date >= $1 AND issue_date <= $2) AS overdues_in_period,
                (SELECT COALESCE(SUM(fine_amount), 0) FROM issues WHERE return_date >= $1 AND return_date <= $2) AS fines_generated_in_period
        `;

        const [globalResult, periodResult] = await Promise.all([
            pool.query(globalQuery),
            pool.query(periodQuery, params)
        ]);

        return {
            global: globalResult.rows[0],
            period: periodResult.rows[0]
        };
    }

    static async getDetailedCirculation(fromDate, toDate, page = 1, limit = 20) {
        // Fetch issues where issue_date OR return_date falls in the period
        const offset = (page - 1) * limit;
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
            WHERE (i.issue_date >= $1 AND i.issue_date <= $2)
               OR (i.return_date >= $1 AND i.return_date <= $2)
            ORDER BY i.issue_date DESC, i.issue_id DESC
            LIMIT $3 OFFSET $4
        `;
        
        const countQuery = `
            SELECT COUNT(*) 
            FROM issues 
            WHERE (issue_date >= $1 AND issue_date <= $2)
               OR (return_date >= $1 AND return_date <= $2)
        `;

        const [result, countResult] = await Promise.all([
            pool.query(query, [fromDate, toDate, limit, offset]),
            pool.query(countQuery, [fromDate, toDate])
        ]);

        const totalRows = parseInt(countResult.rows[0].count, 10);

        const issues = result.rows.map(issue => {
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

            return { ...issue, lateDays, displayFine };
        });

        return {
            issues,
            totalRows,
            totalPages: Math.ceil(totalRows / limit)
        };
    }

    static async getOverdueReport() {
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
            WHERE i.status = 'Overdue'
            ORDER BY i.due_date ASC
        `;
        
        const result = await pool.query(query);
        return result.rows.map(issue => {
            const calc = IssueModel.calculateFine(issue.due_date, new Date());
            return {
                ...issue,
                lateDays: calc.lateDays,
                displayFine: calc.fineAmount
            };
        });
    }
}

module.exports = ReportModel;
