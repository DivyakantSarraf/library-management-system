const BookModel = require('../models/bookModel');

exports.getBooks = async (req, res) => {
    try {
        const search = req.query.q || '';
        const availability = req.query.availability || 'all';
        const category = req.query.category || 'all';
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        
        const categories = await BookModel.getCategories();
        const { books, totalRows, totalPages } = await BookModel.getBooks({
            search,
            availability,
            category,
            page,
            limit
        });

        res.render('admin/books', {
            books,
            categories,
            search,
            availability,
            category,
            page,
            totalPages,
            totalRows,
            error: null,
            success: null
        });
    } catch (err) {
        console.error('Error fetching books:', err);
        res.render('admin/books', {
            books: [],
            categories: [],
            search: '',
            availability: 'all',
            category: 'all',
            page: 1,
            totalPages: 0,
            totalRows: 0,
            error: 'Failed to load the catalog. Please try again.',
            success: null
        });
    }
};

exports.addBook = async (req, res) => {
    try {
        const { title, author, isbn, category, available_copies } = req.body;
        
        // Basic validation
        if (!title || !author || !isbn || !category || available_copies < 0) {
            throw new Error('INVALID_INPUT');
        }

        await BookModel.addBook({
            title: title.trim(),
            author: author.trim(),
            isbn: isbn.trim(),
            category: category.trim(),
            available_copies: parseInt(available_copies, 10)
        });

        // Normally we'd use flash messages and redirect, but passing query params directly for this simple implementation
        res.redirect('/admin/books?success=Book+added+successfully');
    } catch (err) {
        console.error('Add Book Error:', err);
        let errorMsg = 'Unable to add the book.';
        if (err.message === 'ADMIN_REQUIRED') {
            errorMsg = 'An Admin context is required to create a book, but no admins exist in the database.';
        } else if (err.message === 'DUPLICATE_ISBN') {
            errorMsg = 'That ISBN is already registered in the catalog.';
        } else if (err.message === 'INVALID_INPUT') {
            errorMsg = 'Please provide valid input for all required fields.';
        }
        res.redirect('/admin/books?error=' + encodeURIComponent(errorMsg));
    }
};

exports.updateBook = async (req, res) => {
    try {
        const book_id = req.params.id;
        const { title, author, isbn, category, available_copies } = req.body;

        if (!title || !author || !isbn || !category || available_copies < 0) {
            throw new Error('INVALID_INPUT');
        }

        await BookModel.updateBook(book_id, {
            title: title.trim(),
            author: author.trim(),
            isbn: isbn.trim(),
            category: category.trim(),
            available_copies: parseInt(available_copies, 10)
        });

        res.redirect('/admin/books?success=Book+updated+successfully');
    } catch (err) {
        console.error('Update Book Error:', err);
        let errorMsg = 'Unable to update the book.';
        if (err.message === 'ADMIN_REQUIRED') {
            errorMsg = 'An Admin context is required to update a book, but no admins exist in the database.';
        } else if (err.message === 'DUPLICATE_ISBN') {
            errorMsg = 'That ISBN is already registered in the catalog.';
        } else if (err.message === 'INVALID_INPUT') {
            errorMsg = 'Please provide valid input for all required fields.';
        }
        res.redirect('/admin/books?error=' + encodeURIComponent(errorMsg));
    }
};

exports.deleteBook = async (req, res) => {
    try {
        const book_id = req.params.id;
        await BookModel.deleteBook(book_id);
        res.redirect('/admin/books?success=Book+deleted+successfully');
    } catch (err) {
        console.error('Delete Book Error:', err);
        let errorMsg = 'Unable to delete the book.';
        if (err.message === 'FOREIGN_KEY_VIOLATION') {
            errorMsg = 'This book cannot be deleted because it has circulation records.';
        }
        res.redirect('/admin/books?error=' + encodeURIComponent(errorMsg));
    }
};
