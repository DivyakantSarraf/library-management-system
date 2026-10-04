-- ============================================
-- LIBRARY MANAGEMENT SYSTEM
-- Database Schema
-- PostgreSQL / Supabase
-- ============================================

-- ============================================
-- 1. ADMINS TABLE
-- ============================================

CREATE TABLE admins (
    admin_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'ADMIN',

    CONSTRAINT admins_role_check
        CHECK (role = 'ADMIN')
);


-- ============================================
-- 2. MEMBERS TABLE
-- ============================================

CREATE TABLE members (
    member_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    phone VARCHAR(15),
    address TEXT,
    membership_date DATE NOT NULL DEFAULT CURRENT_DATE,
    admin_id INTEGER NOT NULL,

    CONSTRAINT members_admin_fk
        FOREIGN KEY (admin_id)
        REFERENCES admins(admin_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);


-- ============================================
-- 3. BOOKS TABLE
-- ============================================

CREATE TABLE books (
    book_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    author VARCHAR(150) NOT NULL,
    isbn VARCHAR(20) NOT NULL UNIQUE,
    category VARCHAR(100) NOT NULL,
    available_copies INTEGER NOT NULL DEFAULT 0,
    admin_id INTEGER NOT NULL,

    CONSTRAINT books_available_copies_check
        CHECK (available_copies >= 0),

    CONSTRAINT books_admin_fk
        FOREIGN KEY (admin_id)
        REFERENCES admins(admin_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);


-- ============================================
-- 4. ISSUES TABLE
-- ============================================

CREATE TABLE issues (
    issue_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    book_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    admin_id INTEGER NOT NULL,
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE NOT NULL,
    return_date DATE,
    fine_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(20) NOT NULL DEFAULT 'Issued',

    CONSTRAINT issues_book_fk
        FOREIGN KEY (book_id)
        REFERENCES books(book_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT issues_member_fk
        FOREIGN KEY (member_id)
        REFERENCES members(member_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT issues_admin_fk
        FOREIGN KEY (admin_id)
        REFERENCES admins(admin_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT issues_fine_check
        CHECK (fine_amount >= 0),

    CONSTRAINT issues_status_check
        CHECK (status IN ('Issued', 'Returned', 'Overdue')),

    CONSTRAINT issues_due_date_check
        CHECK (due_date >= issue_date),

    CONSTRAINT issues_return_date_check
        CHECK (return_date IS NULL OR return_date >= issue_date)
);


-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_books_title
    ON books(title);

CREATE INDEX idx_books_author
    ON books(author);

CREATE INDEX idx_books_category
    ON books(category);

CREATE INDEX idx_issues_member
    ON issues(member_id);

CREATE INDEX idx_issues_book
    ON issues(book_id);

CREATE INDEX idx_issues_status
    ON issues(status);