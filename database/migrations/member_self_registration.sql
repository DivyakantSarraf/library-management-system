-- ============================================
-- Migration: Member Self-Registration (Part 9A)
-- Target Table: members
-- Safety: Transactional, idempotent, preserves existing records and DEFERRED_AUTH accounts.
-- ============================================

BEGIN;

-- 1. Allow optional Full Name so members can skip profile completion cleanly
ALTER TABLE members
    ALTER COLUMN name DROP NOT NULL;

-- 2. Allow NULL admin_id for self-registered members while preserving members_admin_fk (ON DELETE RESTRICT)
ALTER TABLE members
    ALTER COLUMN admin_id DROP NOT NULL;

-- 3. Align phone column length with application validation (20 characters)
ALTER TABLE members
    ALTER COLUMN phone TYPE VARCHAR(20);

-- 4. Guard against existing case-insensitive collisions before creating unique indexes
DO $$
DECLARE
    username_collisions INTEGER;
    email_collisions INTEGER;
BEGIN
    SELECT COUNT(*) INTO username_collisions
    FROM (
        SELECT LOWER(username)
        FROM members
        GROUP BY LOWER(username)
        HAVING COUNT(*) > 1
    ) AS dup_usernames;

    IF username_collisions > 0 THEN
        RAISE EXCEPTION 'Migration aborted: % case-insensitive duplicate username group(s) found in members.username.', username_collisions;
    END IF;

    SELECT COUNT(*) INTO email_collisions
    FROM (
        SELECT LOWER(email)
        FROM members
        GROUP BY LOWER(email)
        HAVING COUNT(*) > 1
    ) AS dup_emails;

    IF email_collisions > 0 THEN
        RAISE EXCEPTION 'Migration aborted: % case-insensitive duplicate email group(s) found in members.email.', email_collisions;
    END IF;
END $$;

-- 5. Enforce case-insensitive uniqueness on username and email
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_username_lower
    ON members (LOWER(username));

CREATE UNIQUE INDEX IF NOT EXISTS idx_members_email_lower
    ON members (LOWER(email));

COMMIT;
