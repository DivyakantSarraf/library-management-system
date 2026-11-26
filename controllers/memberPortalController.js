const MemberPortalModel = require('../models/memberPortalModel');
const BookModel = require('../models/bookModel');

class MemberPortalController {
    /**
     * Resolves the active member context exclusively from the authenticated session.
     * Query parameters (?member_id=X) and request body fields are strictly ignored.
     */
    static async resolveMember(req) {
        if (req && req.user && req.user.role === 'member' && req.user.id) {
            const member = await MemberPortalModel.getMemberById(req.user.id);
            if (!member) {
                return null;
            }
            if (member.status && String(member.status).toLowerCase() !== 'active') {
                return null;
            }
            if (member.membership_status && String(member.membership_status).toLowerCase() !== 'active') {
                return null;
            }
            return member;
        }
        return null;
    }

    /**
     * GET /member - Member Dashboard Overview
     */
    static async getDashboard(req, res) {
        try {
            const currentMember = await MemberPortalController.resolveMember(req);
            
            if (!currentMember) {
                return res.redirect('/member/login');
            }

            const { metrics, recentActivity } = await MemberPortalModel.getDashboardData(currentMember.member_id);

            res.render('member/dashboard', {
                currentMember,
                metrics,
                recentActivity,
                error: null
            });
        } catch (err) {
            console.error('Error loading member dashboard:', err);
            res.render('member/dashboard', {
                currentMember: null,
                metrics: null,
                recentActivity: [],
                error: 'Dashboard data is temporarily unavailable. Please try again.'
            });
        }
    }

    /**
     * GET /member/books - Browse Books Catalog
     */
    static async getBrowseBooks(req, res) {
        try {
            const currentMember = await MemberPortalController.resolveMember(req);
            if (!currentMember) {
                return res.redirect('/member/login');
            }

            const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
            const rawAvailability = typeof req.query.availability === 'string' ? req.query.availability.toLowerCase().trim() : 'all';
            const availability = ['all', 'available', 'unavailable'].includes(rawAvailability) ? rawAvailability : 'all';
            const category = typeof req.query.category === 'string' ? req.query.category.trim() : 'all';
            const page = Math.max(1, parseInt(req.query.page, 10) || 1);
            const limit = 10;

            const categories = await BookModel.getCategories();
            const { books, totalRows, totalPages } = await MemberPortalModel.getBrowseBooks({
                search,
                availability,
                category,
                page,
                limit
            });

            res.render('member/books', {
                currentMember,
                books,
                categories,
                search,
                availability,
                category,
                page,
                totalPages,
                totalRows,
                limit,
                error: null
            });
        } catch (err) {
            console.error('Error loading browse books:', err);
            res.render('member/books', {
                currentMember: null,
                books: [],
                categories: [],
                search: '',
                availability: 'all',
                category: 'all',
                page: 1,
                totalPages: 0,
                totalRows: 0,
                limit: 10,
                error: 'Failed to load book catalog. Please try again.'
            });
        }
    }

    /**
     * GET /member/issues - My Books (Member Loans & Circulation)
     */
    static async getMyBooks(req, res) {
        try {
            const currentMember = await MemberPortalController.resolveMember(req);

            if (!currentMember) {
                return res.redirect('/member/login');
            }

            const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
            const rawStatus = typeof req.query.status === 'string' ? req.query.status.trim() : 'all';
            const allowedStatuses = ['all', 'Issued', 'Overdue', 'Returned'];
            const status = allowedStatuses.find(s => s.toLowerCase() === rawStatus.toLowerCase()) || 'all';
            const page = Math.max(1, parseInt(req.query.page, 10) || 1);
            const limit = 10;

            const { metrics } = await MemberPortalModel.getDashboardData(currentMember.member_id);

            const { issues, totalRows, totalPages } = await MemberPortalModel.getMyBooks(currentMember.member_id, {
                search,
                status,
                page,
                limit
            });

            res.render('member/issues', {
                currentMember,
                metrics,
                issues,
                search,
                status,
                page,
                totalPages,
                totalRows,
                limit,
                error: null
            });
        } catch (err) {
            console.error('Error loading member borrowed books:', err);
            res.render('member/issues', {
                currentMember: null,
                metrics: null,
                issues: [],
                search: '',
                status: 'all',
                page: 1,
                totalPages: 0,
                totalRows: 0,
                limit: 10,
                error: 'Failed to load circulation records. Please try again.'
            });
        }
    }

    /**
     * GET /member/profile - View Member Profile
     */
    static async getProfile(req, res) {
        try {
            const currentMember = await MemberPortalController.resolveMember(req);

            if (!currentMember) {
                return res.redirect('/member/login');
            }

            const { metrics } = await MemberPortalModel.getDashboardData(currentMember.member_id);

            res.render('member/profile', {
                currentMember,
                metrics,
                error: req.query.error || null,
                success: req.query.success || null
            });
        } catch (err) {
            console.error('Error loading member profile:', err);
            res.render('member/profile', {
                currentMember: null,
                metrics: null,
                error: 'Unable to load profile at this time.',
                success: null
            });
        }
    }

    /**
     * POST /member/profile - Update Member Profile
     */
    static async updateProfile(req, res) {
        let currentMember = null;
        try {
            currentMember = await MemberPortalController.resolveMember(req);

            if (!currentMember) {
                return res.redirect('/member/login');
            }

            const { name, phone, address } = req.body;

            // Helper to re-render form on validation error while preserving submitted values
            const renderValidationError = async (message) => {
                const { metrics } = await MemberPortalModel.getDashboardData(currentMember.member_id);
                const mergedMember = {
                    ...currentMember,
                    name: typeof name === 'string' ? name : currentMember.name,
                    phone: typeof phone === 'string' ? phone : currentMember.phone,
                    address: typeof address === 'string' ? address : currentMember.address
                };
                return res.status(400).render('member/profile', {
                    currentMember: mergedMember,
                    metrics,
                    error: message,
                    success: null
                });
            };

            // 1. Name validation: required, 2-100 characters after trimming
            const trimmedName = typeof name === 'string' ? name.trim() : '';
            if (!trimmedName) {
                return await renderValidationError('Full Name is required.');
            }
            if (trimmedName.length < 2) {
                return await renderValidationError('Full Name must be at least 2 characters.');
            }
            if (trimmedName.length > 100) {
                return await renderValidationError('Full Name cannot exceed 100 characters.');
            }

            // 2. Phone validation: optional, max 20 characters, allowed characters: digits, spaces, +, -, (, )
            let trimmedPhone = null;
            if (phone !== undefined && phone !== null) {
                const p = String(phone).trim();
                if (p.length > 0) {
                    if (p.length > 20) {
                        return await renderValidationError('Phone number cannot exceed 20 characters.');
                    }
                    const phoneRegex = /^[0-9+\-()\s]+$/;
                    if (!phoneRegex.test(p)) {
                        return await renderValidationError('Phone number can only contain digits, spaces, +, -, and parentheses.');
                    }
                    trimmedPhone = p;
                }
            }

            // 3. Address validation: optional, max 500 characters after trimming
            let trimmedAddress = null;
            if (address !== undefined && address !== null) {
                const a = String(address).trim();
                if (a.length > 0) {
                    if (a.length > 500) {
                        return await renderValidationError('Home address cannot exceed 500 characters.');
                    }
                    trimmedAddress = a;
                }
            }

            // Identity scoped strictly to authenticated currentMember.member_id
            await MemberPortalModel.updateProfile(currentMember.member_id, {
                name: trimmedName,
                phone: trimmedPhone,
                address: trimmedAddress
            });

            res.redirect(`/member/profile?success=${encodeURIComponent('Profile updated successfully.')}`);
        } catch (err) {
            console.error('Error updating member profile:', err);
            if (err.message === 'PHONE_TOO_LONG') {
                return await renderValidationError('Phone number cannot exceed 20 characters.');
            }
            if (err.message === 'PHONE_INVALID') {
                return await renderValidationError('Phone number can only contain digits, spaces, +, -, and parentheses.');
            }
            if (err.message === 'ADDRESS_TOO_LONG') {
                return await renderValidationError('Home address cannot exceed 500 characters.');
            }
            if (err.message === 'NAME_TOO_LONG') {
                return await renderValidationError('Full Name cannot exceed 100 characters.');
            }
            if (err.message === 'NAME_TOO_SHORT') {
                return await renderValidationError('Full Name must be at least 2 characters.');
            }
            if (err.message === 'NAME_REQUIRED') {
                return await renderValidationError('Full Name is required.');
            }

            res.redirect(`/member/profile?error=${encodeURIComponent('Failed to update profile. Please try again.')}`);
        }
    }
}

module.exports = MemberPortalController;
