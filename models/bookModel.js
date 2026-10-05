const pool = require('../config/db');

class BookModel {
    static async getBooks({ search = '', availability = 'all', category = 'all', page = 1, limit = 10 }) {
        let query = `
            SELECT book_id, title, author, isbn, category, available_copies, admin_id 
            FROM books 
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 1;

        if (search) {
            query += ` AND (title ILIKE $${paramCount} OR author ILIKE $${paramCount} OR isbn ILIKE $${paramCount})`;
            params.push(`%${search}%`);
            paramCount++;
        }

        if (availability === 'available') {
            query += ` AND available_copies > 0`;
        } else if (availability === 'unavailable') {
            query += ` AND available_copies = 0`;
        }

        if (category && category !== 'all') {
            query += ` AND category = $${paramCount}`;
            params.push(category);
            paramCount++;
        }

        // Count query for pagination
        const countQuery = `SELECT COUNT(*) FROM (${query}) AS filtered_books`;
        const countResult = await pool.query(countQuery, params);
        const totalRows = parseInt(countResult.rows[0].count, 10);

        // Sorting and Pagination
        query += ` ORDER BY title ASC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(limit);
        params.push((page - 1) * limit);

        const result = await pool.query(query, params);
        
        return {
            books: result.rows,
            totalRows,
            totalPages: Math.ceil(totalRows / limit)
        };
    }

    static async getCategories() {
        const query = `SELECT DISTINCT category FROM books ORDER BY category ASC`;
        const result = await pool.query(query);
        return result.rows.map(row => row.category);
    }

    static async getAdminId() {
        // Find the first available admin for contextual writes. If none exists, return null.
        const query = `SELECT admin_id FROM admins LIMIT 1`;
        const result = await pool.query(query);
        return result.rows.length ? result.rows[0].admin_id : null;
    }

    static async addBook({ title, author, isbn, category, available_copies }) {
        const admin_id = await this.getAdminId();
        if (!admin_id) {
            throw new Error('ADMIN_REQUIRED');
        }
        
        try {
            const query = `
                INSERT INTO books (title, author, isbn, category, available_copies, admin_id)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *
            `;
            const result = await pool.query(query, [title, author, isbn, category, available_copies, admin_id]);
            return result.rows[0];
        } catch (err) {
            if (err.constraint === 'books_isbn_key') {
                throw new Error('DUPLICATE_ISBN');
            }
            throw err;
        }
    }

    static async updateBook(book_id, { title, author, isbn, category, available_copies }) {
        const admin_id = await this.getAdminId();
        if (!admin_id) {
            throw new Error('ADMIN_REQUIRED');
        }

        try {
            const query = `
                UPDATE books 
                SET title = $1, author = $2, isbn = $3, category = $4, available_copies = $5
                WHERE book_id = $6
                RETURNING *
            `;
            const result = await pool.query(query, [title, author, isbn, category, available_copies, book_id]);
            return result.rows[0];
        } catch (err) {
            if (err.constraint === 'books_isbn_key') {
                throw new Error('DUPLICATE_ISBN');
            }
            throw err;
        }
    }

    static async deleteBook(book_id) {
        try {
            const query = `DELETE FROM books WHERE book_id = $1 RETURNING *`;
            const result = await pool.query(query, [book_id]);
            return result.rows[0];
        } catch (err) {
            if (err.constraint === 'issues_book_fk') {
                throw new Error('FOREIGN_KEY_VIOLATION');
            }
            throw err;
        }
    }
}

module.exports = BookModel;
