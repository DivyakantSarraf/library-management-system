const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const AuthService = require('../services/authService');

// 1. Admin Strategy (Mounts strictly to admins table)
passport.use('admin-local', new LocalStrategy(
    {
        usernameField: 'username',
        passwordField: 'password'
    },
    async (username, password, done) => {
        try {
            const result = await AuthService.verifyAdmin(username, password);
            if (!result.success) {
                return done(null, false, { message: result.message });
            }
            return done(null, result.user);
        } catch (err) {
            return done(err);
        }
    }
));

// 2. Member Strategy (Mounts strictly to members table; accepts username or email)
passport.use('member-local', new LocalStrategy(
    {
        usernameField: 'username',
        passwordField: 'password'
    },
    async (identifier, password, done) => {
        try {
            const result = await AuthService.verifyMember(identifier, password);
            if (!result.success) {
                return done(null, false, { message: result.message });
            }
            return done(null, result.user);
        } catch (err) {
            return done(err);
        }
    }
));

// 3. Serialize user into session (strictly store minimal identity: id and role)
passport.serializeUser((user, done) => {
    if (!user || !user.id || !user.role) {
        return done(new Error('Invalid user object for serialization'));
    }
    done(null, { id: user.id, role: user.role });
});

// 4. Deserialize user from session (retrieves live record from PostgreSQL; prevents deleted/stale access)
passport.deserializeUser(async (serialized, done) => {
    try {
        if (!serialized || !serialized.id || !serialized.role) {
            return done(null, false);
        }

        // Strict role validation: role must be one of the recognized types
        if (!['admin', 'member'].includes(serialized.role)) {
            return done(null, false);
        }

        const user = await AuthService.getUserByIdAndRole(serialized.id, serialized.role);
        
        // If account was deleted, deactivated, or not found in PostgreSQL, deny access immediately
        if (!user || user.role !== serialized.role) {
            return done(null, false);
        }

        // Defense-in-depth: Ensure password hashes are never present on req.user
        delete user.password_hash;
        delete user.password;

        return done(null, user);
    } catch (err) {
        return done(err);
    }
});

module.exports = passport;
