const ReportModel = require('../models/reportModel');

class ReportController {
    static async getReports(req, res) {
        try {
            // Default date range: Last 30 days up to today
            const today = new Date();
            const thirtyDaysAgo = new Date(today);
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const defaultTo = today.toISOString().split('T')[0];
            const defaultFrom = thirtyDaysAgo.toISOString().split('T')[0];

            let { from_date, to_date, page } = req.query;

            from_date = from_date || defaultFrom;
            to_date = to_date || defaultTo;
            const currentPage = parseInt(page, 10) || 1;

            if (new Date(from_date) > new Date(to_date)) {
                return res.render('admin/reports', {
                    error: "From Date cannot be later than To Date.",
                    summary: null,
                    circulation: null,
                    overdues: null,
                    from_date,
                    to_date,
                    page: currentPage
                });
            }

            const [summary, circulation, overdues] = await Promise.all([
                ReportModel.getSummaryMetrics(from_date, to_date),
                ReportModel.getDetailedCirculation(from_date, to_date, currentPage, 20),
                ReportModel.getOverdueReport()
            ]);

            res.render('admin/reports', {
                error: null,
                summary,
                circulation,
                overdues,
                from_date,
                to_date,
                page: currentPage
            });

        } catch (error) {
            console.error('Error generating reports:', error);
            res.render('admin/reports', {
                error: "Failed to generate reports. Please try again.",
                summary: null,
                circulation: null,
                overdues: null,
                from_date: req.query.from_date || '',
                to_date: req.query.to_date || '',
                page: 1
            });
        }
    }
}

module.exports = ReportController;
