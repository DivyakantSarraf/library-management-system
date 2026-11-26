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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_PATTERN = /^[0-9+\-()\s]+$/;

function parseAdminMemberPayload(body = {}) {
    const { name, email, phone, address, membership_date } = body || {};

    let normalizedName = null;
    if (name !== undefined && name !== null) {
        if (typeof name !== 'string') throw new Error('INVALID_INPUT');
        const trimmed = name.trim();
        if (trimmed.length > 0) {
            if (trimmed.length > 100) throw new Error('INVALID_INPUT');
            normalizedName = trimmed;
        }
    }

    if (typeof email !== 'string') throw new Error('INVALID_INPUT');
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || normalizedEmail.length > 150 || !EMAIL_PATTERN.test(normalizedEmail)) {
        throw new Error('INVALID_INPUT');
    }

    if (typeof membership_date !== 'string') throw new Error('INVALID_INPUT');
    const normalizedDate = membership_date.trim();
    if (!DATE_PATTERN.test(normalizedDate) || isNaN(Date.parse(normalizedDate))) {
        throw new Error('INVALID_INPUT');
    }

    let normalizedPhone = null;
    if (phone !== undefined && phone !== null) {
        if (typeof phone !== 'string' && typeof phone !== 'number') throw new Error('INVALID_INPUT');
        const p = String(phone).trim();
        if (p.length > 0) {
            if (p.length > 20 || !PHONE_PATTERN.test(p)) throw new Error('INVALID_INPUT');
            normalizedPhone = p;
        }
    }

    let normalizedAddress = null;
    if (address !== undefined && address !== null) {
        if (typeof address !== 'string') throw new Error('INVALID_INPUT');
        const a = address.trim();
        if (a.length > 0) {
            if (a.length > 500) throw new Error('INVALID_INPUT');
            normalizedAddress = a;
        }
    }

    return {
        name: normalizedName,
        email: normalizedEmail,
        phone: normalizedPhone,
        address: normalizedAddress,
        membership_date: normalizedDate
    };
}

function mapAdminMemberError(err, fallbackMsg) {
    if (!err) return fallbackMsg;
    if (err.message === 'ADMIN_REQUIRED') {
        return 'An Admin context is required to manage members, but no admins exist in the database.';
    }
    if (err.message === 'DUPLICATE_EMAIL') {
        return 'This email is already registered.';
    }
    if (err.message === 'DUPLICATE_USERNAME') {
        return 'A member with this username already exists.';
    }
    if (err.message === 'DUPLICATE_MEMBER') {
        return 'A member with this email or username already exists.';
    }
    if (err.message === 'INVALID_INPUT') {
        return 'Please provide valid input for all required fields.';
    }
    return fallbackMsg;
}

exports.addMember = async (req, res) => {
    try {
        const payload = parseAdminMemberPayload(req.body);
        await MemberModel.addMember(payload);
        res.redirect('/admin/members?success=Member+added+successfully');
    } catch (err) {
        console.error('Add Member Error:', err);
        const errorMsg = mapAdminMemberError(err, 'Unable to add the member.');
        res.redirect('/admin/members?error=' + encodeURIComponent(errorMsg));
    }
};

exports.updateMember = async (req, res) => {
    try {
        const member_id = req.params.id;
        const payload = parseAdminMemberPayload(req.body);
        await MemberModel.updateMember(member_id, payload);
        res.redirect('/admin/members?success=Member+updated+successfully');
    } catch (err) {
        console.error('Update Member Error:', err);
        const errorMsg = mapAdminMemberError(err, 'Unable to update the member.');
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
