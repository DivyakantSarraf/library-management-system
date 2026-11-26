# Library Management System

A robust, full-stack Library Management System built with **Node.js**, **Express 5**, **EJS**, **PostgreSQL** (hosted via Supabase), and vanilla **CSS & JavaScript**. The application provides distinct portals for **Library Administrators** (catalog management, circulation desk, member administration, fines, and reports) and **Library Members** (loan overview, book browsing, circulation history, and profile management).

---

## Table of Contents

- [Project Overview](#project-overview)
- [Technology Stack](#technology-stack)
- [Key Features](#key-features)
  - [Admin Portal](#admin-portal)
  - [Member Portal](#member-portal)
- [Circulation & Fine Policies](#circulation--fine-policies)
- [Database Architecture](#database-architecture)
- [Project Directory Structure](#project-directory-structure)
- [Prerequisites](#prerequisites)
- [Installation & Local Setup](#installation--local-setup)
- [Environment Configuration](#environment-configuration)
- [Database Setup](#database-setup)
- [Running the Application](#running-the-application)
- [Testing](#testing)
- [Security Considerations & Known Limitations](#security-considerations--known-limitations)
- [Future Enhancements](#future-enhancements)

---

## Project Overview

The Library Management System is designed to manage day-to-day library circulation, track real-time book availability, maintain member records, calculate overdue fines transparently, and provide members with a self-service digital catalog and borrowing dashboard.

---

## Technology Stack

- **Runtime & Backend Framework:** Node.js (v18+) & Express.js (v5.x)
- **Database:** PostgreSQL (Supabase-hosted or local instance)
- **Database Driver:** `pg` (node-postgres connection pool)
- **Templating Engine:** EJS (Embedded JavaScript)
- **Styling & Design System:** Custom CSS design tokens (`tokens.css`, `components.css`, `layout.css`, `responsive.css`)
- **Iconography:** Lucide Icons
- **Testing:** Native Node.js `assert` test harness (`tests/unit_tests.js`)

---

## Key Features

### Admin Portal

1. **Dashboard (`/admin`):**
   - KPI metrics overview: Total Books, Total Members, Issued Books, Overdue Books, Total Fines.
   - Recent library transactions and circulation activity log.
2. **Book Catalog (`/admin/books`):**
   - Search by title, author, or ISBN.
   - Filter by category and real-time inventory status.
   - Add new book drawer with server-side validation.
   - Edit book metadata drawer using safe DOM data binding.
   - Delete book records.
3. **Member Management (`/admin/members`):**
   - View registered members with membership dates and contact details.
   - Register new members with email uniqueness and input validation.
4. **Circulation Desk (`/admin/issues`):**
   - Issue book modal: Select book, member, issue date, and due date.
   - Transactional inventory check ensuring book is in stock (`available_copies > 0`).
   - Return book modal: Record return date, auto-calculate overdue fines at ₹5/day, and restock inventory.
5. **Circulation & Fine Reports (`/admin/reports`):**
   - Filter transactions across time periods (Last 7 Days, Last 30 Days, Custom Date Range).
   - Summary statistics on total loans, overdue loans, and fine collection metrics.

### Member Portal

1. **Member Dashboard (`/member`):**
   - Personalized welcome header with navigation breadcrumbs.
   - Account standing banner displaying good standing status or overdue loan alerts with accumulated dues.
   - 4 standardized KPI summary cards: Active Loans, Overdue Books, Estimated Dues, and Returned Books.
   - Recent borrowing activity table with status indicators and fine badges.
2. **Browse Books (`/member/books`):**
   - Explore library inventory with real-time availability badges (`Available` with stock count vs `Out of Stock`).
   - Multi-field search toolbar (title, author, ISBN).
   - Category filtering and stock availability filter (`Available Only`, `Out of Stock`, `All`).
   - Accessible pagination preserving active filters and member context across pages.
   - Mobile-responsive table converting to structured cards on viewports `<= 767px` with non-destructive column display.
   - Safe member read-only view: no admin mutation controls (Add/Edit/Delete) exposed.
3. **My Books / Circulation History (`/member/issues`):**
   - 4-metric summary overview bar (Active Loans, Overdue Books, Total Borrowed, Outstanding Fines).
   - Loan status filter tabs: `All`, `Issued`, `Overdue`, `Returned`.
   - Real-time dynamic overdue fine badges for active late loans vs settled fine badges for returned books.
   - Preserves search and filter parameters across pagination controls.
4. **Member Profile (`/member/profile`):**
   - Dual-card layout: Personal summary & borrowing statistics on the left, editable profile form on the right.
   - Clear visual distinction between editable fields (Name, Phone, Address) and immutable fields (Email, Member ID, Membership Date).
   - Read-only fields marked with lock badges, `readonly`, and `disabled` attributes.
   - Strict server-side validation rejecting invalid names, malformed phone numbers, and oversized inputs.
   - Submitted form values are preserved upon validation errors (HTTP 400 response).
   - Duplicate submission protection with client-side loading indicator and Back/Forward Cache (bfcache) recovery.

---

## Circulation & Fine Policies

- **Overdue Fine Policy:**
  - Standard rate: **₹5.00 per day** for every day a book is retained past its due date.
  - **Grace Period:** None.
  - **Fine Cap:** None.
  - **Due Date:** The due date itself is on-time (late days = 0, fine = ₹0.00).
- **Fine Lifecycle:**
  - **Active Loans:** Calculated dynamically against the current date for loans marked `Overdue`.
  - **Returned Loans:** Finalized upon book return and immutably persisted in the database record (`fine_amount`).
- **Inventory Tracking:**
  - When a book is issued, `available_copies` is atomically decremented by 1 within a database transaction.
  - When a book is returned, `available_copies` is atomically incremented by 1 within a database transaction.
  - Inventory checks enforce `available_copies > 0` before issuing; negative stock is strictly prohibited by database constraints.

---

## Database Architecture

The application uses PostgreSQL with relational integrity, foreign key cascades, and check constraints defined in `database/schema.sql`:

- **`admins`**: Administrator accounts (`admin_id`, `username`, `password_hash`, `role`).
- **`members`**: Library members (`member_id`, `username`, `password_hash`, `name`, `email`, `phone`, `address`, `membership_date`, `admin_id`).
- **`books`**: Book catalog (`book_id`, `title`, `author`, `isbn`, `category`, `available_copies`, `admin_id`).
- **`issues`**: Circulation records (`issue_id`, `book_id`, `member_id`, `admin_id`, `issue_date`, `due_date`, `return_date`, `fine_amount`, `status`).

*For detailed schema definitions, ER relationships, and transaction lifecycles, see [docs/CIRCULATION_AND_SCHEMA.md](docs/CIRCULATION_AND_SCHEMA.md).*

---

## Project Directory Structure

```
library-management-system/
├── app.js                          # Express application entry point & routing
├── package.json                    # Project metadata, dependencies, & npm scripts
├── .gitignore                      # Git exclusion rules (node_modules, .env, OS files)
├── README.md                       # Main project documentation
├── config/
│   └── db.js                       # PostgreSQL connection pool configuration
├── controllers/
│   ├── bookController.js           # Admin book catalog controller
│   ├── issueController.js          # Admin circulation (issue/return) controller
│   ├── memberController.js         # Admin member management controller
│   ├── memberPortalController.js   # Member portal controller (Dashboard, Books, Issues, Profile)
│   └── reportController.js         # Admin circulation & fine reports controller
├── database/
│   ├── schema.sql                  # PostgreSQL DDL schema & table constraints
│   └── test-db.js                  # Database connection verification diagnostic
├── docs/
│   └── CIRCULATION_AND_SCHEMA.md   # Detailed schema and circulation lifecycle documentation
├── models/
│   ├── bookModel.js                # Book catalog database queries & transactions
│   ├── issueModel.js               # Issue/return transactions, fine policy, & status sync
│   ├── memberModel.js              # Member database queries
│   ├── memberPortalModel.js        # Member queries, filters, pagination, & profile updates
│   └── reportModel.js              # Aggregate circulation & fine reporting queries
├── public/
│   ├── css/
│   │   ├── tokens.css              # Centralized CSS design tokens (colors, fonts, radii, spacing)
│   │   ├── components.css          # Shared UI component styles (cards, tables, badges, alerts)
│   │   ├── layout.css              # Application shell, sidebar, and grid layout styles
│   │   └── responsive.css          # Media queries for tablet and mobile viewports
│   └── js/
│       └── shell.js                # Mobile navigation drawer & UI interactions
├── tests/
│   └── unit_tests.js               # Comprehensive unit & diagnostic test suite (76 tests)
└── views/
    ├── admin/                      # Admin portal EJS templates
    │   ├── books.ejs
    │   ├── dashboard.ejs
    │   ├── issues.ejs
    │   ├── members.ejs
    │   └── reports.ejs
    ├── member/                     # Member portal EJS templates
    │   ├── books.ejs
    │   ├── dashboard.ejs
    │   ├── issues.ejs
    │   └── profile.ejs
    └── partials/                   # Reusable EJS template components
        ├── head.ejs
        ├── member-sidebar.ejs
        ├── page-header.ejs
        ├── pagination.ejs
        ├── sidebar.ejs
        ├── status-badge.ejs
        └── topbar.ejs
```

---

## Prerequisites

- **Node.js:** v18.0.0 or higher (v20+ recommended)
- **npm:** v9.0.0 or higher
- **PostgreSQL Database:** Supabase PostgreSQL instance or local PostgreSQL server (v14+)

---

## Installation & Local Setup

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd library-management-system
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   Create a `.env` file in the root directory (see [Environment Configuration](#environment-configuration)).

4. **Verify database connectivity:**
   ```bash
   node database/test-db.js
   ```

---

## Environment Configuration

Create a `.env` file in the project root directory.

> **Security Note:** Never commit `.env` or expose real database passwords. `.env` is listed in `.gitignore`.

Required environment variables:

```ini
# PostgreSQL Connection String (Supabase or local PostgreSQL)
DATABASE_URL=postgresql://<username>:<password>@<host>:<port>/<database>?sslmode=require

# Application Port (defaults to 3000 if omitted)
PORT=3000

# Environment Mode (development or production)
NODE_ENV=development

# Session Signing Secret (use a 32+ character random string in production)
SESSION_SECRET=your_secure_random_session_secret_here
```

---

## Database Setup & User Provisioning

1. Open your PostgreSQL console, `psql`, or Supabase SQL Editor.
2. Execute the DDL statements in `database/schema.sql` to create all required tables, constraints, indexes, and the PostgreSQL session table:
   ```bash
   psql -d <your-database-name> -f database/schema.sql
   ```
3. Securely provision administrative and member credentials using the interactive CLI utility:
   ```bash
   # Provision an Administrator account
   node scripts/provision-user.js --role admin --username <admin_username>
   # Type password and confirmation interactively when prompted (characters are hidden)

   # Provision a Member account
   node scripts/provision-user.js --role member --username <member_username> --email <member_email> --name "<Full Name>"
   # Type password and confirmation interactively when prompted (characters are hidden)
   ```

---

## Running the Application

### Development Mode
```bash
node app.js
```
The server will start at `http://localhost:3000`.

- **Public Landing Page:** [http://localhost:3000/](http://localhost:3000/)
- **Admin Sign In:** [http://localhost:3000/admin/login](http://localhost:3000/admin/login)
- **Member Sign In:** [http://localhost:3000/member/login](http://localhost:3000/member/login)
- **Protected Admin Portal:** [http://localhost:3000/admin](http://localhost:3000/admin) (Requires `admin` authentication)
- **Protected Member Portal:** [http://localhost:3000/member](http://localhost:3000/member) (Requires `member` authentication)

---

## Testing

The project includes a comprehensive, multi-layer automated test suite comprising **116 unit tests** and **20 HTTP integration tests** with **100% passing results**.

### Run Test Suites
```bash
# Run unit test suite (116 tests)
npm test

# Run multi-session HTTP integration tests on real loopback sockets (20 tests)
npm run test:http
```

### Test Coverage Areas
1. **Fine Calculation (`IssueModel.calculateFine`):**
   - On-time and early returns (₹0 fine, 0 late days).
   - 1-day, 5-day, and multi-month overdue scenarios at the invariant ₹5/day rate.
   - Timestamp normalization (end-of-day vs next-morning boundaries).
2. **Local Calendar Handling (`getLocalDateString`):**
   - Correct YYYY-MM-DD parsing, single-digit month/day zero-padding, and boundary preservation.
3. **Report Date Validation:**
   - From/To date consistency, same-day reports, and default 30-day window.
4. **Database Connectivity Diagnostic:**
   - Real-time query ping verifying database pool availability.
5. **EJS Template Compilation & Accessibility:**
   - Compilation of all Admin and Member templates and partials.
   - Functional rendering tests for `page-header`, `status-badge`, `pagination`, and sidebars.
   - Accessibility tests verifying presence of ARIA labels, semantic headings, and clean URL navigation.
6. **Member Portal Model & Validation Tests:**
   - Member resolution, dashboard metrics, search/filter normalization, and pagination clamping.
   - Name, phone, and address validation with boundary testing and immutable column protection.
7. **Authentication & Password Security:**
   - Bcrypt hashing with 12 salt rounds; verification of valid, invalid, and legacy `DEFERRED_AUTH` hashes.
   - Safe deserialization preventing password hash leakage and role confusion.
   - Timing-attack mitigation and generic error messages preventing username enumeration.
8. **Role-Based Authorization & Session Lifecycle:**
   - Strict `requireAdmin` and `requireMember` enforcement; unauthenticated access redirects to login (or 401 JSON for AJAX).
   - Session regeneration and CSRF token rotation on login (preventing session fixation).
   - Server-side session destruction on `POST /logout`; `GET /logout` returns HTTP 405 Method Not Allowed.
   - Member horizontal ownership derived strictly from session identity (`req.user.id`).
   - `no-store` cache headers on protected endpoints and open-redirect defense.
9. **CSRF Synchronizer Token Protection:**
   - Token enforcement on all 12 state-changing `POST` routes with rejection of missing or forged tokens.
   - Strict rejection of query-string CSRF tokens (`?_csrf=...`).
10. **Login Rate Limiting & Anti-DoS:**
    - Two-tier rate limiter (5 failed attempts per compound IP+username, 10 attempts per IP over 15 minutes).
    - 6th attempt blocked with HTTP 429 and `Retry-After` header.
    - Anti-DoS isolation ensuring attacker IP cannot lock out legitimate users.
11. **Multi-Session HTTP Integration Tests:**
    - Real socket HTTP tests verifying cross-role blocking, multi-member isolation, CSRF rejection, and logout invalidation.

---

## Security Architecture & Controls

1. **Authentication:**
   - Passport.js Local Strategies backed by PostgreSQL.
   - Bcrypt with 12 salt rounds for password storage.
   - Support for login by username (Admin) or username/email (Member).
   - Interactive hidden CLI password provisioning (`scripts/provision-user.js`).
2. **Session Security:**
   - PostgreSQL-backed persistent sessions (`connect-pg-simple`).
   - Session regeneration on login to prevent fixation attacks.
   - Customized cookie name (`lms.sid`) with `httpOnly`, `sameSite: 'lax'`, and conditional `secure` (production).
   - Session destruction and cookie clearance on `POST /logout`. Non-destructive `GET /logout` returns HTTP 405.
3. **Cross-Site Request Forgery (CSRF):**
   - Synchronizer-token pattern with 32-byte crypto tokens on all 12 state-changing `POST` routes.
   - Constant-time comparison (`crypto.timingSafeEqual`) preventing timing side-channels.
   - Automated token rotation post-login. Query-string tokens strictly prohibited.
4. **Login Rate Limiting:**
   - Two-tier in-memory limiter: 5 failures per (IP + username) and 10 failures per IP.
   - 6th attempt returns HTTP 429 with `Retry-After` header.
   - Indistinguishable responses between existing and non-existing accounts.
5. **Authorization & Horizontal Isolation:**
   - Server-side middleware gates: `requireAdmin` and `requireMember`.
   - Member records, loans, and profiles resolve strictly from `req.user.id`.
   - Tampering via query parameters (`?member_id=X`) or form bodies is strictly ignored.
6. **Data & Cache Protection:**
   - `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate` on all protected endpoints.
   - Generic error messages on login failures and application error views.

---

## Future Enhancements

- Multi-Factor Authentication (MFA / TOTP) for Administrator accounts.
- Automated email reminder notifications for books due within 48 hours.
- Self-service hold/reservation queue for books currently marked `Out of Stock`.
- CSV and PDF export for circulation reports and overdue fine audit logs.

---

## License

This project is licensed under the ISC License.
