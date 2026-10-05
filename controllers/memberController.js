const MemberModel = require('../models/memberModel');

exports.getMembers = async (req, res) => {
    try {
        const search = req.query.q || '';
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        
        const { members, totalRows, totalPages } = await MemberModel.getMembers({
            search,
            page,
            limit
        });

        res.render('admin/members', {
            members,
            search,
            page,
            totalPages,
            totalRows,
            error: null,
            success: null
        });
    } catch (err) {
        console.error('Error fetching members:', err);
        res.render('admin/members', {
            members: [],
            search: '',
            page: 1,
            totalPages: 0,
            totalRows: 0,
            error: 'Failed to load the members list. Please try again.',
            success: null
        });
    }
};

exports.addMember = async (req, res) => {
    try {
        const { name, email, phone, address, membership_date } = req.body;
        
        if (!name || !email || !membership_date) {
            throw new Error('INVALID_INPUT');
        }

        await MemberModel.addMember({
            name: name.trim(),
            email: email.trim().toLowerCase(),
            phone: phone ? phone.trim() : null,
            address: address ? address.trim() : null,
            membership_date
        });

        res.redirect('/admin/members?success=Member+added+successfully');
    } catch (err) {
        console.error('Add Member Error:', err);
        let errorMsg = 'Unable to add the member.';
        if (err.message === 'ADMIN_REQUIRED') {
            errorMsg = 'An Admin context is required to create a member, but no admins exist in the database.';
        } else if (err.message === 'DUPLICATE_EMAIL') {
            errorMsg = 'This email is already registered.';
        } else if (err.message === 'INVALID_INPUT') {
            errorMsg = 'Please provide valid input for all required fields.';
        }
        res.redirect('/admin/members?error=' + encodeURIComponent(errorMsg));
    }
};

exports.updateMember = async (req, res) => {
    try {
        const member_id = req.params.id;
        const { name, email, phone, address, membership_date } = req.body;

        if (!name || !email || !membership_date) {
            throw new Error('INVALID_INPUT');
        }

        await MemberModel.updateMember(member_id, {
            name: name.trim(),
            email: email.trim().toLowerCase(),
            phone: phone ? phone.trim() : null,
            address: address ? address.trim() : null,
            membership_date
        });

        res.redirect('/admin/members?success=Member+updated+successfully');
    } catch (err) {
        console.error('Update Member Error:', err);
        let errorMsg = 'Unable to update the member.';
        if (err.message === 'ADMIN_REQUIRED') {
            errorMsg = 'An Admin context is required to update a member, but no admins exist in the database.';
        } else if (err.message === 'DUPLICATE_EMAIL') {
            errorMsg = 'This email is already registered.';
        } else if (err.message === 'INVALID_INPUT') {
            errorMsg = 'Please provide valid input for all required fields.';
        }
        res.redirect('/admin/members?error=' + encodeURIComponent(errorMsg));
    }
};

exports.deleteMember = async (req, res) => {
    try {
        const member_id = req.params.id;
        await MemberModel.deleteMember(member_id);
        res.redirect('/admin/members?success=Member+deleted+successfully');
    } catch (err) {
        console.error('Delete Member Error:', err);
        let errorMsg = 'Unable to delete the member.';
        if (err.message === 'FOREIGN_KEY_VIOLATION') {
            errorMsg = 'This member cannot be deleted because they have circulation records.';
        }
        res.redirect('/admin/members?error=' + encodeURIComponent(errorMsg));
    }
};
