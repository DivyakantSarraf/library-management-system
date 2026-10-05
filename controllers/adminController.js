const AdminModel = require('../models/adminModel');

exports.getDashboard = async (req, res) => {
    try {
        const metrics = await AdminModel.getDashboardMetrics();
        const recentCirculation = await AdminModel.getRecentCirculation(8);
        
        res.render('admin/dashboard', {
            metrics,
            recentCirculation,
            error: null
        });
    } catch (error) {
        console.error('Error fetching admin dashboard data:', error);
        res.render('admin/dashboard', {
            metrics: null,
            recentCirculation: null,
            error: 'Dashboard data is temporarily unavailable. Please try again.'
        });
    }
};
