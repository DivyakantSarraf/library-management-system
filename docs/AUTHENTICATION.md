# Authentication Architecture & Session Management

## 1. Overview & Stack

The Library Management System employs a unified, role-based authentication and secure session architecture supporting two roles:
- **`admin`**: System administrators managing the catalog, members, issues, returns, and reports.
- **`member`**: Library patrons browsing the book catalog, reviewing their active loans, history, and profile.

### Core Technologies
- **Runtime**: Node.js & Express 5
- **Authentication**: Passport.js (Local Strategies) & Bcrypt (12 salt rounds)
- **Session Storage**: `express-session` backed by PostgreSQL (`connect-pg-simple`)
- **Database**: PostgreSQL / Supabase
- **View Engine**: EJS with custom Design System tokens

---

## 2. Authentication Architecture

### 2.1 Role-Based Strategies
Authentication uses two distinct Passport Local Strategies backed by `services/authService.js`:

1. **`admin-local` Strategy (`/admin/login`)**:
   - Matches against the `admins` table.
   - Credential inputs: `username`, `password`.
   - Constraint checks: `role = 'ADMIN'`.

2. **`member-local` Strategy (`/member/login`)**:
   - Matches against the `members` table.
   - Credential inputs: `username` (accepts either `username` or registered `email`), `password`.
   - Safely rejects accounts with placeholder credentials (e.g. `DEFERRED_AUTH`) without runtime errors or information leakage.

### 2.2 Security Guarantees
- **Bcrypt Password Hashing**: All passwords are encrypted with bcrypt using 12 salt rounds. Plaintext passwords are never persisted, cached, or logged.
- **Generic Error Responses**: All failed attempts (user not found, wrong password, inactive hash) return identical generic error messages:
  `"Invalid credentials. Please check your details and try again."`
  This eliminates username enumeration vulnerabilities.
- **Timing Attack Mitigation**: When an account lookup finds no record, a dummy bcrypt comparison is executed against a standard hash so execution timing remains indistinguishable from valid user lookups.
- **Untrusted Input Protection**: Roles and user IDs submitted in query strings or form bodies are never trusted for authorization. The verified database record strictly determines role assignment and session binding.
- **Minimal Session Footprint**: Only minimal identity (`{ id, role }`) is serialized into the session. Password hashes, tokens, or unnecessary member metadata are never stored in session cookies or session records.

---

## 3. Session Configuration (`config/session.js`)

Sessions are persisted directly in PostgreSQL to prevent memory exhaustion and enable horizontal scaling:

- **Storage Engine**: `connect-pg-simple` connected to the primary PostgreSQL connection pool (`config/db.js`).
- **Session Table**: `"session"` with primary key `sid` and indexed `expire` timestamp.
- **Cookie Security Attributes**:
  - `name`: `lms.sid` (customized to obscure underlying framework signature)
  - `httpOnly`: `true` (prohibits client-side JavaScript access via `document.cookie`, mitigating XSS session theft)
  - `secure`: Enabled in production (`process.env.NODE_ENV === 'production'`) to enforce HTTPS-only cookie transmission
  - `sameSite`: `'lax'` (mitigates Cross-Site Request Forgery during external navigation)
  - `maxAge`: 24 hours (`86,400,000` ms)
  - `rolling`: `true` (extends active user session lifetime with ongoing interaction)

### 3.1 Lifecycle & Anti-Fixation
- **Login Session Regeneration**: After successful authentication, `req.session.regenerate()` is executed before attaching user state. This prevents session fixation attacks where an adversary pre-seeds a session identifier.
- **Logout Destruction**: Session termination is strictly restricted to `POST /logout` with a valid CSRF token. `req.logout()` revokes the Passport context, `req.session.destroy()` purges the row from the PostgreSQL `session` table, and `res.clearCookie('lms.sid')` clears the browser cookie. Direct `GET /logout` requests are strictly non-destructive and rejected with `405 Method Not Allowed` (`Allow: POST`).

---

## 4. Database Schema & Migration

The session table schema is managed in `database/migrations/create_session_table.sql` and incorporated into `database/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS "session" (
    "sid" VARCHAR NOT NULL COLLATE "default",
    "sess" JSON NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,
    CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
```

---

## 5. Account Provisioning Procedure

Accounts must be provisioned using the dedicated administrative utility: `scripts/provision-user.js`.

> [!SECURITY]
> For security compliance, passing passwords via CLI flags (`--password`) is strictly prohibited to prevent exposure in process listings and terminal/shell history. Passwords are entered interactively with hidden character input and confirmation.

### 5.1 Provisioning a New Administrator
```bash
node scripts/provision-user.js --role admin --username <admin_username>
# When prompted, securely type the password and confirmation (characters are hidden)
```

### 5.2 Provisioning a New Member
```bash
node scripts/provision-user.js --role member --username <member_username> --email <email_address> --name "<Full Name>"
# When prompted, securely type the password and confirmation (characters are hidden)
```

### 5.3 Updating Existing Credentials (e.g. Migrating Member from DEFERRED_AUTH)
Existing account records can be updated securely. The utility prompts for explicit operator confirmation before modifying credentials:
```bash
node scripts/provision-user.js --update-password --role member --username <member_username>
```

### 5.4 Provisioning Safety Rules
1. Never pass passwords as command-line arguments.
2. Passwords are typed interactively without echo to terminal.
3. Passwords must be at least 8 characters long and confirmed.
4. Existing accounts require explicit operator confirmation before any credential updates.
5. Generated password hashes and plaintext credentials are never printed to terminal logs.

---

## 6. Complete Application Route Inventory & Security Architecture

The application registers exactly **26 route endpoints** (14 `GET` and 12 `POST`). All state-changing operations are restricted to `POST` requests and protected by global synchronizer-token CSRF middleware (`csrfProtection`).

### 6.1 Public & Authentication Routes (8 Routes: 5 GET, 3 POST)

| Method | Path | Middleware Pipeline | Access Level | State-Changing | CSRF Protected | Description |
|---|---|---|---|:---:|:---:|---|
| `GET` | `/` | `csrfProtection`, templateContext | Public | No | Bypassed (Safe) | Public landing page |
| `GET` | `/login` | `csrfProtection`, templateContext | Public | No | Bypassed (Safe) | Portal selection / login redirect |
| `GET` | `/admin/login` | `csrfProtection`, templateContext | Public | No | Bypassed (Safe) | Admin sign-in interface (redirects if active admin) |
| `POST` | `/admin/login` | `csrfProtection`, `adminLoginLimiter` | Public | **Yes** | **Enforced** | Authenticates administrator credentials |
| `GET` | `/member/login` | `csrfProtection`, templateContext | Public | No | Bypassed (Safe) | Member sign-in interface (redirects if active member) |
| `POST` | `/member/login` | `csrfProtection`, `memberLoginLimiter` | Public | **Yes** | **Enforced** | Authenticates member credentials |
| `GET` | `/logout` | `csrfProtection`, templateContext | Public / Auth | No | Bypassed (Safe) | Rejects with HTTP 405 Method Not Allowed (`Allow: POST`); preserves session |
| `POST` | `/logout` | `csrfProtection` | Public / Auth | **Yes** | **Enforced** | Destroys session in PostgreSQL, clears cookie, redirects to home |

### 6.2 Administrator Management Routes (13 Routes: 5 GET, 7 POST)

| Method | Path | Middleware Pipeline | Access Level | State-Changing | CSRF Protected | Description |
|---|---|---|---|:---:|:---:|---|
| `GET` | `/admin` | `csrfProtection`, `preventBrowserCaching`, `requireAdmin` | Admin | No | Bypassed (Safe) | Admin dashboard with KPI metrics & circulation log |
| `GET` | `/admin/books` | `csrfProtection`, `preventBrowserCaching`, `requireAdmin` | Admin | No | Bypassed (Safe) | Books catalog view with search and filters |
| `POST` | `/admin/books` | `csrfProtection`, `requireAdmin` | Admin | **Yes** | **Enforced** | Adds a new book to the catalog |
| `POST` | `/admin/books/:id/update` | `csrfProtection`, `requireAdmin` | Admin | **Yes** | **Enforced** | Updates an existing book record |
| `POST` | `/admin/books/:id/delete` | `csrfProtection`, `requireAdmin` | Admin | **Yes** | **Enforced** | Deletes a book record from the catalog |
| `GET` | `/admin/members` | `csrfProtection`, `preventBrowserCaching`, `requireAdmin` | Admin | No | Bypassed (Safe) | Member list view with search and filters |
| `POST` | `/admin/members` | `csrfProtection`, `requireAdmin` | Admin | **Yes** | **Enforced** | Registers a new library member |
| `POST` | `/admin/members/:id/update` | `csrfProtection`, `requireAdmin` | Admin | **Yes** | **Enforced** | Updates an existing member record |
| `POST` | `/admin/members/:id/delete` | `csrfProtection`, `requireAdmin` | Admin | **Yes** | **Enforced** | Deletes a member record |
| `GET` | `/admin/issues` | `csrfProtection`, `preventBrowserCaching`, `requireAdmin` | Admin | No | Bypassed (Safe) | Circulation desk view with active and returned loans |
| `POST` | `/admin/issues` | `csrfProtection`, `requireAdmin` | Admin | **Yes** | **Enforced** | Issues a book copy to a member |
| `POST` | `/admin/issues/:id/return` | `csrfProtection`, `requireAdmin` | Admin | **Yes** | **Enforced** | Marks an active loan returned & calculates overdue fine |
| `GET` | `/admin/reports` | `csrfProtection`, `preventBrowserCaching`, `requireAdmin` | Admin | No | Bypassed (Safe) | Circulation & overdue fine reports with date filters |

### 6.3 Member Portal Routes (5 Routes: 4 GET, 1 POST)

| Method | Path | Middleware Pipeline | Access Level | State-Changing | CSRF Protected | Description |
|---|---|---|---|:---:|:---:|---|
| `GET` | `/member` | `csrfProtection`, `preventBrowserCaching`, `requireMember` | Member | No | Bypassed (Safe) | Member dashboard with active loan summary cards |
| `GET` | `/member/books` | `csrfProtection`, `preventBrowserCaching`, `requireMember` | Member | No | Bypassed (Safe) | Member read-only book catalog search and availability |
| `GET` | `/member/issues` | `csrfProtection`, `preventBrowserCaching`, `requireMember` | Member | No | Bypassed (Safe) | Member loan history and active overdue tracking |
| `GET` | `/member/profile` | `csrfProtection`, `preventBrowserCaching`, `requireMember` | Member | No | Bypassed (Safe) | Member profile view with read-only and editable fields |
| `POST` | `/member/profile` | `csrfProtection`, `preventBrowserCaching`, `requireMember` | Member | **Yes** | **Enforced** | Updates member's own contact details (name, phone, address) |

---

### 6.4 Route Naming & Consistency Verification Summary

- **Nested RESTful Parameter Patterns**:
  - Book deletion uses `POST /admin/books/:id/delete` (controller receives `req.params.id`).
  - Book update uses `POST /admin/books/:id/update` (controller receives `req.params.id`).
  - Member deletion uses `POST /admin/members/:id/delete` (controller receives `req.params.id`).
  - Member update uses `POST /admin/members/:id/update` (controller receives `req.params.id`).
  - Loan return uses `POST /admin/issues/:id/return` (controller receives `req.params.id`).
- **Total Route Summary**:
  - Total Registered Routes: **26**
  - GET Routes: **14** (all safe and idempotent; `GET /logout` returns 405 Method Not Allowed)
  - POST Routes: **12** (all state-changing; all protected with synchronizer CSRF tokens)
  - PUT / PATCH / DELETE Routes: **0**
