/**
 * ONIX Generator — Express Server
 *
 * REST API for managing book metadata + SQLite storage.
 * Serves static frontend from /public.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'db', 'onix.db');

// ---------------------------------------------------------------------------
// Security: API key management
// ---------------------------------------------------------------------------
const API_KEYS_PATH = path.join(__dirname, 'db', 'api-keys.json');

function loadApiKeys() {
    try {
        if (fs.existsSync(API_KEYS_PATH)) {
            return JSON.parse(fs.readFileSync(API_KEYS_PATH, 'utf8'));
        }
    } catch (e) {
        console.error('Failed to load API keys, generating new defaults:', e.message);
    }
    // First run: generate default admin key
    const defaultKey = `ogen_${crypto.randomBytes(24).toString('hex')}`;
    const keys = [
        { key: defaultKey, role: 'admin', label: 'Default Admin Key', created: new Date().toISOString() }
    ];
    fs.writeFileSync(API_KEYS_PATH, JSON.stringify(keys, null, 2), 'utf8');
    console.log('='.repeat(70));
    console.log('FIRST RUN — Default admin API key generated:');
    console.log(`  ${defaultKey}`);
    console.log('Store this key securely. Set ONIX_API_KEY env var or pass');
    console.log('it in the X-API-Key header for all API requests.');
    console.log('='.repeat(70));
    return keys;
}

const apiKeys = loadApiKeys();

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------
const db = new Database(DB_PATH);

// Run schema
const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
db.exec(schema);

// Prepared statements (created once, reused)
const stmts = {};

// ---------------------------------------------------------------------------
// Middleware — Security
// ---------------------------------------------------------------------------

// Helmet: sets various HTTP headers for security
app.use(helmet({ contentSecurityPolicy: false }));

// Body size limits (1 MB for JSON, override per-route if needed)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Global rate limiter: 200 requests per minute per IP
const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', globalLimiter);

// Stricter rate limiter for sensitive endpoints (backup, import)
const strictLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded for this endpoint.' },
});

// ---------------------------------------------------------------------------
// Authentication middleware
// ---------------------------------------------------------------------------
function authenticate(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    if (!apiKey) {
        return res.status(401).json({ error: 'Authentication required. Provide X-API-Key header.' });
    }
    const keyEntry = apiKeys.find(k => k.key === apiKey);
    if (!keyEntry) {
        return res.status(403).json({ error: 'Invalid API key.' });
    }
    req.apiUser = keyEntry;
    next();
}

// Admin-only middleware (requires role === 'admin')
function requireAdmin(req, res, next) {
    if (!req.apiUser || req.apiUser.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
}

// CSRF / Origin check for mutating requests (POST, PUT, DELETE)
// Since the app uses API key auth (not cookies), CSRF is mitigated by design.
// This adds defense-in-depth: reject cross-origin mutating requests that
// lack the API key or come from an unexpected origin.
function originCheck(req, res, next) {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
        const origin = req.headers['origin'];
        const referer = req.headers['referer'];
        // If an Origin header is present, verify it matches our host
        if (origin) {
            const host = req.headers['host'];
            const allowed = [
                `http://${host}`,
                `https://${host}`,
                `http://localhost:${PORT}`,
                `https://localhost:${PORT}`,
            ];
            if (!allowed.some(a => origin.startsWith(a))) {
                // Allow if authenticated via API key (programmatic access)
                if (!req.apiUser) {
                    return res.status(403).json({ error: 'Cross-origin request blocked.' });
                }
            }
        }
    }
    next();
}

// Apply auth and origin check to all /api/ routes
app.use('/api/', authenticate, originCheck);

// ---------------------------------------------------------------------------
// Static files (served without auth — public frontend)
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

// Serve codelists as static JSON (public, no auth needed)
app.use('/codelists', express.static(path.join(__dirname, 'codelists')));

// File upload for XLSX/CSV import (5 MB limit for spreadsheets)
const upload = multer({ dest: path.join(__dirname, 'uploads/'), limits: { fileSize: 5 * 1024 * 1024 } });

// ---------------------------------------------------------------------------
// Helper: wrap DB operations in transaction
// ---------------------------------------------------------------------------
function withTransaction(fn) {
    const transaction = db.transaction(fn);
    return transaction();
}

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------
function validateString(val, maxLen = 1000) {
    return typeof val === 'string' && val.length <= maxLen;
}

function validateOptionalString(val, maxLen = 1000) {
    return val === undefined || val === null || validateString(val, maxLen);
}

function validateInt(val) {
    return Number.isInteger(val) || (typeof val === 'string' && /^-?\d+$/.test(val));
}

function validateOptionalInt(val) {
    return val === undefined || val === null || validateInt(val);
}

function validateIdArray(ids) {
    return Array.isArray(ids) && ids.length > 0 && ids.length <= 1000 && ids.every(id => validateInt(id));
}

function validateIsbn(val) {
    if (!val || val === '') return true; // optional field
    return typeof val === 'string' && /^[0-9X-]{10,17}$/.test(val.replace(/[-\s]/g, ''));
}

function validateOnixCode(val, maxLen = 10) {
    if (!val || val === '') return true;
    return typeof val === 'string' && val.length <= maxLen && /^[A-Za-z0-9+]+$/.test(val);
}

function validateDate(val) {
    if (!val || val === '') return true;
    return typeof val === 'string' && /^\d{4}\d{2}\d{2}$/.test(val);
}

// Validate book fields from request body, returns error string or null
function validateBookBody(data) {
    if (typeof data !== 'object' || data === null) return 'Request body must be an object';

    if (!validateOptionalString(data.isbn, 20)) return 'isbn must be a string (max 20 chars)';
    if (data.isbn && !validateIsbn(data.isbn)) return 'isbn format is invalid';
    if (!validateOptionalString(data.title, 500)) return 'title must be a string (max 500 chars)';
    if (!validateOptionalString(data.subtitle, 500)) return 'subtitle must be a string (max 500 chars)';
    if (!validateOptionalString(data.internal_ref, 100)) return 'internal_ref must be a string (max 100 chars)';
    if (!validateOptionalString(data.order_number, 100)) return 'order_number must be a string (max 100 chars)';
    if (!validateOptionalString(data.description, 50000)) return 'description must be a string (max 50000 chars)';
    if (!validateOptionalString(data.biography, 10000)) return 'biography must be a string (max 10000 chars)';
    if (!validateOptionalString(data.toc, 10000)) return 'toc must be a string (max 10000 chars)';
    if (!validateOptionalInt(data.page_count)) return 'page_count must be an integer';
    if (!validateOptionalInt(data.audience_age_from)) return 'audience_age_from must be an integer';
    if (!validateOptionalInt(data.audience_age_to)) return 'audience_age_to must be an integer';

    // Validate ONIX code fields
    const codeFields = ['notification_type', 'product_form', 'product_form_detail', 'primary_content_type',
        'drm', 'epub_usage_type', 'epub_usage_status', 'publishing_status',
        'audience_range_qualifier', 'series_collection_type'];
    for (const f of codeFields) {
        if (data[f] !== undefined && data[f] !== '' && !validateOnixCode(data[f], 20)) {
            return `${f} must be a valid ONIX code`;
        }
    }

    // Validate date fields
    for (const f of ['publishing_date', 'print_pub_date', 'announcement_date']) {
        if (!validateDate(data[f])) return `${f} must be YYYYMMDD format`;
    }

    // Validate language codes (ISO 639-2/B: 3 lowercase letters)
    for (const f of ['language_code', 'original_language']) {
        if (data[f] !== undefined && data[f] !== '' && !/^[a-z]{3}$/.test(data[f])) {
            return `${f} must be a 3-letter ISO 639-2/B code`;
        }
    }

    // Validate contributor sub-objects
    if (data.contributors !== undefined) {
        if (!Array.isArray(data.contributors)) return 'contributors must be an array';
        if (data.contributors.length > 100) return 'Too many contributors (max 100)';
        for (const c of data.contributors) {
            if (typeof c !== 'object') return 'Each contributor must be an object';
            if (!validateOptionalString(c.person_name, 300)) return 'contributor person_name too long';
            if (!validateOptionalString(c.corporate_name, 300)) return 'contributor corporate_name too long';
        }
    }

    // Validate subjects
    if (data.subjects !== undefined) {
        if (!Array.isArray(data.subjects)) return 'subjects must be an array';
        if (data.subjects.length > 200) return 'Too many subjects (max 200)';
        for (const s of data.subjects) {
            if (typeof s !== 'object') return 'Each subject must be an object';
            if (!validateOptionalString(s.subject_code, 50)) return 'subject_code too long';
            if (!validateOptionalString(s.subject_text, 500)) return 'subject_text too long';
        }
    }

    // Validate prices
    if (data.prices !== undefined) {
        if (!Array.isArray(data.prices)) return 'prices must be an array';
        if (data.prices.length > 50) return 'Too many prices (max 50)';
        for (const p of data.prices) {
            if (typeof p !== 'object') return 'Each price must be an object';
            if (p.amount !== undefined && (typeof p.amount !== 'number' || p.amount < 0 || p.amount > 999999)) {
                return 'price amount must be a number between 0 and 999999';
            }
        }
    }

    // Validate sales_rights
    if (data.sales_rights !== undefined) {
        if (!Array.isArray(data.sales_rights)) return 'sales_rights must be an array';
        if (data.sales_rights.length > 50) return 'Too many sales_rights (max 50)';
    }

    // Validate related_products
    if (data.related_products !== undefined) {
        if (!Array.isArray(data.related_products)) return 'related_products must be an array';
        if (data.related_products.length > 50) return 'Too many related_products (max 50)';
    }

    // Validate reviews
    if (data.reviews !== undefined) {
        if (!Array.isArray(data.reviews)) return 'reviews must be an array';
        if (data.reviews.length > 50) return 'Too many reviews (max 50)';
    }

    return null; // no errors
}

// ---------------------------------------------------------------------------
// SETTINGS API
// ---------------------------------------------------------------------------
app.get('/api/settings', (req, res) => {
    const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    res.json(row);
});

app.put('/api/settings', (req, res) => {
    const fields = [
        'sender_name', 'contact_name', 'email', 'default_language',
        'publisher_name', 'publisher_city', 'publisher_country',
        'default_currency', 'default_drm', 'default_territory',
        'default_price_type', 'onix_format', 'theme'
    ];

    // Validate settings input
    if (typeof req.body !== 'object' || req.body === null) {
        return res.status(400).json({ error: 'Request body must be an object' });
    }
    for (const f of fields) {
        if (req.body[f] !== undefined && !validateString(req.body[f], 500)) {
            return res.status(400).json({ error: `${f} must be a string (max 500 chars)` });
        }
    }
    if (req.body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.email) && req.body.email !== '') {
        return res.status(400).json({ error: 'Invalid email format' });
    }
    if (req.body.onix_format && !['short', 'reference'].includes(req.body.onix_format)) {
        return res.status(400).json({ error: 'onix_format must be "short" or "reference"' });
    }
    if (req.body.theme && !['light', 'dark'].includes(req.body.theme)) {
        return res.status(400).json({ error: 'theme must be "light" or "dark"' });
    }

    const sets = [];
    const values = {};
    for (const f of fields) {
        if (req.body[f] !== undefined) {
            sets.push(`${f} = @${f}`);
            values[f] = req.body[f];
        }
    }
    if (sets.length === 0) return res.json({ ok: true });
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE settings SET ${sets.join(', ')} WHERE id = 1`).run(values);
    res.json(db.prepare('SELECT * FROM settings WHERE id = 1').get());
});

// ---------------------------------------------------------------------------
// BOOKS API
// ---------------------------------------------------------------------------

// List all books (table view: lightweight, only main columns)
app.get('/api/books', (req, res) => {
    const { search, sort, order, limit, offset } = req.query;
    let sql = `
        SELECT b.id, b.isbn, b.title, b.subtitle, b.language_code,
               b.publishing_status, b.publishing_date, b.page_count,
               b.notification_type, b.product_form_detail, b.drm,
               b.created_at, b.updated_at,
               (SELECT GROUP_CONCAT(c.person_name, '; ')
                FROM contributors c WHERE c.book_id = b.id AND c.contributor_role = 'A01'
               ) AS authors,
               (SELECT s.subject_code FROM subjects s
                WHERE s.book_id = b.id AND s.scheme_id = '10' AND s.is_main = 1 LIMIT 1
               ) AS bisac_main,
               (SELECT s.subject_code FROM subjects s
                WHERE s.book_id = b.id AND s.scheme_id = '93' AND s.is_main = 1 LIMIT 1
               ) AS thema_main,
               (SELECT s.subject_code FROM subjects s
                WHERE s.book_id = b.id AND s.scheme_id = '26' AND s.is_main = 1 LIMIT 1
               ) AS wgs_main,
               (SELECT p.amount FROM prices p WHERE p.book_id = b.id AND p.start_date = '' AND p.end_date = '' LIMIT 1
               ) AS price,
               (SELECT p.currency_code FROM prices p WHERE p.book_id = b.id AND p.start_date = '' AND p.end_date = '' LIMIT 1
               ) AS currency,
               (SELECT COALESCE(sr.countries, sr.regions) FROM sales_rights sr WHERE sr.book_id = b.id LIMIT 1
               ) AS territory
        FROM books b
    `;
    const params = {};

    if (search) {
        sql += ` WHERE b.id IN (SELECT rowid FROM books_fts WHERE books_fts MATCH @search)`;
        params.search = search;
    }

    const sortCol = ['isbn', 'title', 'language_code', 'publishing_status', 'publishing_date', 'created_at', 'updated_at'].includes(sort) ? sort : 'id';
    const sortOrder = order === 'desc' ? 'DESC' : 'ASC';
    sql += ` ORDER BY b.${sortCol} ${sortOrder}`;

    if (limit) {
        sql += ` LIMIT @limit`;
        params.limit = parseInt(limit) || 100;
    }
    if (offset) {
        sql += ` OFFSET @offset`;
        params.offset = parseInt(offset) || 0;
    }

    const books = db.prepare(sql).all(params);
    const total = db.prepare('SELECT COUNT(*) as count FROM books').get().count;
    res.json({ books, total });
});

// Get single book with ALL related data
app.get('/api/books/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    book.contributors = db.prepare('SELECT * FROM contributors WHERE book_id = ? ORDER BY sequence_number').all(id);
    book.subjects = db.prepare('SELECT * FROM subjects WHERE book_id = ?').all(id);
    book.prices = db.prepare('SELECT * FROM prices WHERE book_id = ?').all(id);
    book.sales_rights = db.prepare('SELECT * FROM sales_rights WHERE book_id = ?').all(id);
    book.related_products = db.prepare('SELECT * FROM related_products WHERE book_id = ?').all(id);
    book.reviews = db.prepare('SELECT * FROM reviews WHERE book_id = ?').all(id);

    // Load sales restrictions for each sales right
    for (const sr of book.sales_rights) {
        sr.restrictions = db.prepare('SELECT * FROM sales_restrictions WHERE sales_right_id = ?').all(sr.id);
    }

    res.json(book);
});

// Create book
app.post('/api/books', (req, res) => {
    const validationError = validateBookBody(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    const result = withTransaction(() => {
        // Apply defaults from settings
        const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
        const data = { ...req.body };
        if (!data.language_code) data.language_code = settings.default_language;
        if (!data.drm) data.drm = settings.default_drm;
        if (!data.publisher_name) data.publisher_name = settings.publisher_name;
        if (!data.publisher_city) data.publisher_city = settings.publisher_city;
        if (!data.publisher_country) data.publisher_country = settings.publisher_country;

        const bookFields = [
            'isbn', 'internal_ref', 'order_number', 'notification_type',
            'product_form', 'product_form_detail', 'primary_content_type', 'drm',
            'epub_usage_type', 'epub_usage_status',
            'title', 'subtitle', 'series_name', 'series_collection_type', 'part_number',
            'edition_number', 'edition_statement',
            'language_code', 'original_language', 'page_count',
            'audience_range_qualifier', 'audience_age_from', 'audience_age_to',
            'description', 'description_format', 'biography', 'toc',
            'publisher_name', 'publisher_city', 'publisher_country',
            'publishing_status', 'publishing_date', 'print_pub_date', 'announcement_date',
            'cover_filename', 'content_filename'
        ];

        const cols = [];
        const placeholders = [];
        const values = {};
        for (const f of bookFields) {
            if (data[f] !== undefined) {
                cols.push(f);
                placeholders.push(`@${f}`);
                values[f] = data[f];
            }
        }

        let bookId;
        if (cols.length > 0) {
            const info = db.prepare(`INSERT INTO books (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`).run(values);
            bookId = info.lastInsertRowid;
        } else {
            const info = db.prepare('INSERT INTO books DEFAULT VALUES').run();
            bookId = info.lastInsertRowid;
        }

        // Insert related data
        insertRelatedData(bookId, data);

        return bookId;
    });

    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(result);
    res.status(201).json(book);
});

// Update book
app.put('/api/books/:id', (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid book ID' });

    const validationError = validateBookBody(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    const existing = db.prepare('SELECT id FROM books WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Book not found' });

    withTransaction(() => {
        const data = { ...req.body };
        const bookFields = [
            'isbn', 'internal_ref', 'order_number', 'notification_type',
            'product_form', 'product_form_detail', 'primary_content_type', 'drm',
            'epub_usage_type', 'epub_usage_status',
            'title', 'subtitle', 'series_name', 'series_collection_type', 'part_number',
            'edition_number', 'edition_statement',
            'language_code', 'original_language', 'page_count',
            'audience_range_qualifier', 'audience_age_from', 'audience_age_to',
            'description', 'description_format', 'biography', 'toc',
            'publisher_name', 'publisher_city', 'publisher_country',
            'publishing_status', 'publishing_date', 'print_pub_date', 'announcement_date',
            'cover_filename', 'content_filename'
        ];

        const sets = [];
        const values = { id };
        for (const f of bookFields) {
            if (data[f] !== undefined) {
                sets.push(`${f} = @${f}`);
                values[f] = data[f];
            }
        }
        if (sets.length > 0) {
            sets.push("updated_at = datetime('now')");
            db.prepare(`UPDATE books SET ${sets.join(', ')} WHERE id = @id`).run(values);
        }

        // Replace related data if provided
        if (data.contributors !== undefined) {
            db.prepare('DELETE FROM contributors WHERE book_id = ?').run(id);
        }
        if (data.subjects !== undefined) {
            db.prepare('DELETE FROM subjects WHERE book_id = ?').run(id);
        }
        if (data.prices !== undefined) {
            db.prepare('DELETE FROM prices WHERE book_id = ?').run(id);
        }
        if (data.sales_rights !== undefined) {
            // cascade deletes restrictions
            db.prepare('DELETE FROM sales_rights WHERE book_id = ?').run(id);
        }
        if (data.related_products !== undefined) {
            db.prepare('DELETE FROM related_products WHERE book_id = ?').run(id);
        }
        if (data.reviews !== undefined) {
            db.prepare('DELETE FROM reviews WHERE book_id = ?').run(id);
        }

        insertRelatedData(id, data);
    });

    // Return full book
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
    res.json(book);
});

// Delete books (supports single or batch)
app.delete('/api/books', (req, res) => {
    const ids = req.body.ids;
    if (!validateIdArray(ids)) {
        return res.status(400).json({ error: 'ids must be an array of integers (max 1000)' });
    }
    withTransaction(() => {
        const stmt = db.prepare('DELETE FROM books WHERE id = ?');
        for (const id of ids) {
            stmt.run(id);
        }
    });
    res.json({ deleted: ids.length });
});

// Clone books
app.post('/api/books/clone', (req, res) => {
    const ids = req.body.ids;
    if (!validateIdArray(ids)) {
        return res.status(400).json({ error: 'ids must be an array of integers (max 1000)' });
    }

    const newIds = withTransaction(() => {
        const result = [];
        for (const srcId of ids) {
            const src = db.prepare('SELECT * FROM books WHERE id = ?').get(srcId);
            if (!src) continue;

            // Clone book (clear ISBN, update timestamps)
            const cols = Object.keys(src).filter(k => !['id', 'isbn', 'created_at', 'updated_at', 'internal_ref'].includes(k));
            const placeholders = cols.map(c => `@${c}`);
            const info = db.prepare(`INSERT INTO books (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`).run(src);
            const newId = info.lastInsertRowid;

            // Clone related data
            for (const c of db.prepare('SELECT * FROM contributors WHERE book_id = ?').all(srcId)) {
                db.prepare(`INSERT INTO contributors (book_id, sequence_number, contributor_role, person_name, person_name_inverted, titles_before, names_before_key, prefix_to_key, key_names, names_after_key, corporate_name, biographical_note)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(newId, c.sequence_number, c.contributor_role, c.person_name, c.person_name_inverted, c.titles_before, c.names_before_key, c.prefix_to_key, c.key_names, c.names_after_key, c.corporate_name, c.biographical_note);
            }
            for (const s of db.prepare('SELECT * FROM subjects WHERE book_id = ?').all(srcId)) {
                db.prepare(`INSERT INTO subjects (book_id, scheme_id, scheme_version, subject_code, subject_text, is_main) VALUES (?, ?, ?, ?, ?, ?)`).run(newId, s.scheme_id, s.scheme_version, s.subject_code, s.subject_text, s.is_main);
            }
            for (const p of db.prepare('SELECT * FROM prices WHERE book_id = ?').all(srcId)) {
                db.prepare(`INSERT INTO prices (book_id, price_type, amount, currency_code, territory, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(newId, p.price_type, p.amount, p.currency_code, p.territory, p.start_date, p.end_date);
            }
            for (const sr of db.prepare('SELECT * FROM sales_rights WHERE book_id = ?').all(srcId)) {
                const srInfo = db.prepare(`INSERT INTO sales_rights (book_id, rights_type, countries, regions, row_rights_type) VALUES (?, ?, ?, ?, ?)`).run(newId, sr.rights_type, sr.countries, sr.regions, sr.row_rights_type);
                for (const rest of db.prepare('SELECT * FROM sales_restrictions WHERE sales_right_id = ?').all(sr.id)) {
                    db.prepare(`INSERT INTO sales_restrictions (sales_right_id, restriction_type, restriction_note, outlet_id_type, outlet_id_value, outlet_name) VALUES (?, ?, ?, ?, ?, ?)`).run(srInfo.lastInsertRowid, rest.restriction_type, rest.restriction_note, rest.outlet_id_type, rest.outlet_id_value, rest.outlet_name);
                }
            }
            for (const rp of db.prepare('SELECT * FROM related_products WHERE book_id = ?').all(srcId)) {
                db.prepare(`INSERT INTO related_products (book_id, relation_code, related_isbn) VALUES (?, ?, ?)`).run(newId, rp.relation_code, rp.related_isbn);
            }
            for (const r of db.prepare('SELECT * FROM reviews WHERE book_id = ?').all(srcId)) {
                db.prepare(`INSERT INTO reviews (book_id, review_text, text_author, source_title, review_date) VALUES (?, ?, ?, ?, ?)`).run(newId, r.review_text, r.text_author, r.source_title, r.review_date);
            }

            result.push(newId);
        }
        return result;
    });

    res.status(201).json({ cloned: newIds });
});

// Bulk update (apply field to multiple books)
app.put('/api/books/bulk', (req, res) => {
    const { ids, fields } = req.body;
    if (!validateIdArray(ids)) {
        return res.status(400).json({ error: 'ids must be an array of integers (max 1000)' });
    }
    if (!fields || typeof fields !== 'object') {
        return res.status(400).json({ error: 'fields object required' });
    }
    // Validate price amount if present
    if (fields.set_price) {
        if (typeof fields.set_price !== 'object') {
            return res.status(400).json({ error: 'set_price must be an object' });
        }
        if (fields.set_price.amount !== undefined &&
            (typeof fields.set_price.amount !== 'number' || fields.set_price.amount < 0 || fields.set_price.amount > 999999)) {
            return res.status(400).json({ error: 'set_price.amount must be a number between 0 and 999999' });
        }
    }

    withTransaction(() => {
        const bookFields = [
            'language_code', 'drm', 'publishing_status', 'publisher_name',
            'publisher_city', 'publisher_country', 'product_form_detail',
            'audience_range_qualifier', 'audience_age_from', 'audience_age_to'
        ];
        const sets = [];
        const values = {};
        for (const f of bookFields) {
            if (fields[f] !== undefined) {
                sets.push(`${f} = @${f}`);
                values[f] = fields[f];
            }
        }
        if (sets.length > 0) {
            sets.push("updated_at = datetime('now')");
            const stmt = db.prepare(`UPDATE books SET ${sets.join(', ')} WHERE id = @id`);
            for (const id of ids) {
                stmt.run({ ...values, id });
            }
        }

        // Bulk add subjects
        if (fields.add_subject) {
            const s = fields.add_subject;
            const stmt = db.prepare(`INSERT INTO subjects (book_id, scheme_id, scheme_version, subject_code, subject_text, is_main) VALUES (?, ?, ?, ?, ?, ?)`);
            for (const id of ids) {
                stmt.run(id, s.scheme_id, s.scheme_version || '', s.subject_code || '', s.subject_text || '', s.is_main ? 1 : 0);
            }
        }

        // Bulk set price
        if (fields.set_price) {
            const p = fields.set_price;
            // Remove existing default prices for this currency
            const delStmt = db.prepare(`DELETE FROM prices WHERE book_id = ? AND currency_code = ? AND start_date = '' AND end_date = ''`);
            const insStmt = db.prepare(`INSERT INTO prices (book_id, price_type, amount, currency_code, territory, start_date, end_date) VALUES (?, ?, ?, ?, ?, '', '')`);
            for (const id of ids) {
                delStmt.run(id, p.currency_code);
                insStmt.run(id, p.price_type, p.amount, p.currency_code, p.territory || '');
            }
        }

        // Bulk set sales rights
        if (fields.set_rights) {
            const r = fields.set_rights;
            const delStmt = db.prepare('DELETE FROM sales_rights WHERE book_id = ?');
            const insStmt = db.prepare(`INSERT INTO sales_rights (book_id, rights_type, countries, regions) VALUES (?, ?, ?, ?)`);
            for (const id of ids) {
                delStmt.run(id);
                insStmt.run(id, r.rights_type, r.countries || '', r.regions || '');
            }
        }
    });

    res.json({ updated: ids.length });
});

// ---------------------------------------------------------------------------
// ONIX XML generation
// ---------------------------------------------------------------------------
app.post('/api/generate', (req, res) => {
    const { bookIds } = req.body;
    if (bookIds !== undefined && (!Array.isArray(bookIds) || !bookIds.every(id => validateInt(id)))) {
        return res.status(400).json({ error: 'bookIds must be an array of integers' });
    }
    // optional: generate only selected books
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();

    let books;
    if (bookIds && Array.isArray(bookIds) && bookIds.length > 0) {
        const placeholders = bookIds.map(() => '?').join(', ');
        books = db.prepare(`SELECT * FROM books WHERE id IN (${placeholders})`).all(...bookIds);
    } else {
        books = db.prepare('SELECT * FROM books').all();
    }

    // Build ONIX XML
    const xml = generateOnixXml(settings, books);
    res.set('Content-Type', 'application/xml');
    res.set('Content-Disposition', 'attachment; filename="onix_output.xml"');
    res.send(xml);
});

// Preview XML (returns string, not download)
app.post('/api/preview', (req, res) => {
    const { bookIds } = req.body;
    if (bookIds !== undefined && (!Array.isArray(bookIds) || !bookIds.every(id => validateInt(id)))) {
        return res.status(400).json({ error: 'bookIds must be an array of integers' });
    }
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();

    let books;
    if (bookIds && Array.isArray(bookIds) && bookIds.length > 0) {
        const placeholders = bookIds.map(() => '?').join(', ');
        books = db.prepare(`SELECT * FROM books WHERE id IN (${placeholders})`).all(...bookIds);
    } else {
        books = db.prepare('SELECT * FROM books').all();
    }

    const xml = generateOnixXml(settings, books);
    res.json({ xml, bookCount: books.length });
});

// ---------------------------------------------------------------------------
// Import XLSX/CSV
// ---------------------------------------------------------------------------
app.post('/api/import', strictLimiter, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
        const XLSX = require('xlsx');
        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

        // Clean up temp file
        fs.unlinkSync(req.file.path);

        // Return parsed data for column mapping on frontend
        const headers = data.length > 0 ? Object.keys(data[0]) : [];
        const preview = data.slice(0, 5);
        res.json({ headers, preview, totalRows: data.length, data });
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(400).json({ error: `Import failed: ${err.message}` });
    }
});

// Import mapped data (after user confirms column mapping)
app.post('/api/import/apply', strictLimiter, (req, res) => {
    const { rows, mapping } = req.body;
    if (!Array.isArray(rows) || !mapping || typeof mapping !== 'object') {
        return res.status(400).json({ error: 'rows array and mapping object required' });
    }
    if (rows.length > 10000) {
        return res.status(400).json({ error: 'Too many rows (max 10000 per import)' });
    }

    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    let imported = 0;

    withTransaction(() => {
        for (const row of rows) {
            const book = {
                isbn: row[mapping.isbn] || '',
                title: row[mapping.title] || '',
                subtitle: row[mapping.subtitle] || '',
                language_code: row[mapping.language] || settings.default_language,
                description: row[mapping.description] || '',
                publisher_name: settings.publisher_name,
                publisher_city: settings.publisher_city,
                publisher_country: settings.publisher_country,
                drm: settings.default_drm,
            };

            const info = db.prepare(`INSERT INTO books (isbn, title, subtitle, language_code, description, publisher_name, publisher_city, publisher_country, drm) VALUES (@isbn, @title, @subtitle, @language_code, @description, @publisher_name, @publisher_city, @publisher_country, @drm)`).run(book);
            const bookId = info.lastInsertRowid;

            // Author
            const author = row[mapping.author];
            if (author) {
                const parts = author.split(',').map(s => s.trim());
                const inverted = parts.length >= 2 ? author : '';
                const normal = parts.length >= 2 ? `${parts[1]} ${parts[0]}` : author;
                db.prepare(`INSERT INTO contributors (book_id, sequence_number, contributor_role, person_name, person_name_inverted) VALUES (?, 1, 'A01', ?, ?)`).run(bookId, normal, inverted);
            }

            // BISAC
            const bisac = row[mapping.bisac_main];
            if (bisac) {
                db.prepare(`INSERT INTO subjects (book_id, scheme_id, scheme_version, subject_code, is_main) VALUES (?, '10', '2017', ?, 1)`).run(bookId, bisac);
            }

            // Thema
            const thema = row[mapping.thema_main];
            if (thema) {
                db.prepare(`INSERT INTO subjects (book_id, scheme_id, scheme_version, subject_code, is_main) VALUES (?, '93', '1.0', ?, 1)`).run(bookId, thema);
            }

            // WGS
            const wgs = row[mapping.wgs];
            if (wgs) {
                db.prepare(`INSERT INTO subjects (book_id, scheme_id, scheme_version, subject_code, is_main) VALUES (?, '26', '2.0', ?, 1)`).run(bookId, wgs);
            }

            // Keywords
            const kw = row[mapping.keywords];
            if (kw) {
                for (const keyword of kw.split(',').map(s => s.trim()).filter(Boolean)) {
                    db.prepare(`INSERT INTO subjects (book_id, scheme_id, subject_text) VALUES (?, '20', ?)`).run(bookId, keyword);
                }
            }

            // Price
            const price = parseFloat(row[mapping.price]);
            if (!isNaN(price)) {
                db.prepare(`INSERT INTO prices (book_id, price_type, amount, currency_code, territory, start_date, end_date) VALUES (?, ?, ?, ?, ?, '', '')`).run(bookId, settings.default_price_type, price, settings.default_currency, row[mapping.territory] || settings.default_territory);
            }

            // Default sales rights
            if (settings.default_territory) {
                const isWorld = settings.default_territory === 'WORLD';
                db.prepare(`INSERT INTO sales_rights (book_id, rights_type, countries, regions) VALUES (?, '02', ?, ?)`).run(bookId, isWorld ? '' : settings.default_territory, isWorld ? 'WORLD' : '');
            }

            imported++;
        }
    });

    res.json({ imported });
});

// ---------------------------------------------------------------------------
// Export (XLSX, CSV, JSON)
// ---------------------------------------------------------------------------
app.get('/api/export/:format', (req, res) => {
    const format = req.params.format;
    if (!['json', 'csv', 'xlsx'].includes(format)) {
        return res.status(400).json({ error: 'Supported formats: json, csv, xlsx' });
    }
    const books = db.prepare('SELECT * FROM books ORDER BY id').all();

    // Enrich with related data
    for (const book of books) {
        const authors = db.prepare("SELECT person_name FROM contributors WHERE book_id = ? AND contributor_role = 'A01' ORDER BY sequence_number").all(book.id);
        book.authors = authors.map(a => a.person_name).join('; ');

        const bisac = db.prepare("SELECT subject_code FROM subjects WHERE book_id = ? AND scheme_id = '10'").all(book.id);
        book.bisac_codes = bisac.map(s => s.subject_code).join(', ');

        const thema = db.prepare("SELECT subject_code FROM subjects WHERE book_id = ? AND scheme_id = '93'").all(book.id);
        book.thema_codes = thema.map(s => s.subject_code).join(', ');

        const wgs = db.prepare("SELECT subject_code FROM subjects WHERE book_id = ? AND scheme_id = '26'").all(book.id);
        book.wgs_codes = wgs.map(s => s.subject_code).join(', ');

        const keywords = db.prepare("SELECT subject_text FROM subjects WHERE book_id = ? AND scheme_id = '20'").all(book.id);
        book.keywords = keywords.map(s => s.subject_text).join(', ');

        const price = db.prepare("SELECT amount, currency_code FROM prices WHERE book_id = ? AND start_date = '' AND end_date = '' LIMIT 1").get(book.id);
        book.price = price ? price.amount : '';
        book.currency = price ? price.currency_code : '';
    }

    if (format === 'json') {
        res.json(books);
    } else if (format === 'csv' || format === 'xlsx') {
        const XLSX = require('xlsx');
        const rows = books.map(b => ({
            ISBN: b.isbn,
            Title: b.title,
            Subtitle: b.subtitle,
            Authors: b.authors,
            Language: b.language_code,
            Pages: b.page_count,
            'BISAC Codes': b.bisac_codes,
            'Thema Codes': b.thema_codes,
            'WGS Codes': b.wgs_codes,
            Keywords: b.keywords,
            Price: b.price,
            Currency: b.currency,
            Status: b.publishing_status,
            'Pub Date': b.publishing_date,
            Publisher: b.publisher_name,
            Description: b.description,
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Books');

        if (format === 'xlsx') {
            const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
            res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.set('Content-Disposition', 'attachment; filename="onix_books.xlsx"');
            res.send(buf);
        } else {
            const csv = XLSX.utils.sheet_to_csv(ws);
            res.set('Content-Type', 'text/csv');
            res.set('Content-Disposition', 'attachment; filename="onix_books.csv"');
            res.send(csv);
        }
    } else {
        res.status(400).json({ error: 'Supported formats: json, csv, xlsx' });
    }
});

// ---------------------------------------------------------------------------
// Database backup / restore (admin only, audit-logged)
// ---------------------------------------------------------------------------
const AUDIT_LOG_PATH = path.join(__dirname, 'db', 'audit.log');

function auditLog(action, req) {
    const entry = {
        timestamp: new Date().toISOString(),
        action,
        user: req.apiUser ? req.apiUser.label : 'unknown',
        role: req.apiUser ? req.apiUser.role : 'unknown',
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.headers['user-agent'] || '',
    };
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(AUDIT_LOG_PATH, line, 'utf8');
}

app.get('/api/db/backup', strictLimiter, requireAdmin, (req, res) => {
    auditLog('db_backup', req);
    const backup = db.serialize();
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', 'attachment; filename="onix_backup.db"');
    res.send(backup);
});

// Stats
app.get('/api/stats', (req, res) => {
    const books = db.prepare('SELECT COUNT(*) as count FROM books').get().count;
    const contributors = db.prepare('SELECT COUNT(*) as count FROM contributors').get().count;
    const subjects = db.prepare('SELECT COUNT(*) as count FROM subjects').get().count;
    const prices = db.prepare('SELECT COUNT(*) as count FROM prices').get().count;
    res.json({ books, contributors, subjects, prices });
});

// ---------------------------------------------------------------------------
// ONIX XML Generation Engine
// ---------------------------------------------------------------------------
function generateOnixXml(settings, books) {
    const lines = [];
    const ind = (level) => '    '.repeat(level);

    lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    lines.push('<ONIXmessage release="3.0" xmlns="http://ns.editeur.org/onix/3.0/short">');

    // Header
    lines.push(`${ind(1)}<header>`);
    lines.push(`${ind(2)}<sender>`);
    if (settings.sender_name) lines.push(`${ind(3)}<x298 refname="SenderName">${esc(settings.sender_name)}</x298>`);
    if (settings.contact_name) lines.push(`${ind(3)}<x299 refname="ContactName">${esc(settings.contact_name)}</x299>`);
    if (settings.email) lines.push(`${ind(3)}<j272 refname="EmailAddress">${esc(settings.email)}</j272>`);
    lines.push(`${ind(2)}</sender>`);
    lines.push(`${ind(2)}<x307 refname="SentDateTime">${formatDate(new Date())}</x307>`);
    if (settings.default_language) lines.push(`${ind(2)}<m184 refname="DefaultLanguageOfText">${esc(settings.default_language)}</m184>`);
    lines.push(`${ind(1)}</header>`);

    // Products
    for (const book of books) {
        const contributors = db.prepare('SELECT * FROM contributors WHERE book_id = ? ORDER BY sequence_number').all(book.id);
        const subjects = db.prepare('SELECT * FROM subjects WHERE book_id = ?').all(book.id);
        const prices = db.prepare('SELECT * FROM prices WHERE book_id = ?').all(book.id);
        const salesRights = db.prepare('SELECT * FROM sales_rights WHERE book_id = ?').all(book.id);
        const related = db.prepare('SELECT * FROM related_products WHERE book_id = ?').all(book.id);
        const reviews = db.prepare('SELECT * FROM reviews WHERE book_id = ?').all(book.id);

        lines.push(`${ind(1)}<product>`);

        // Record reference
        const ref = book.internal_ref || `${Date.now()}_${book.isbn || book.id}`;
        lines.push(`${ind(2)}<a001 refname="RecordReference">${esc(ref)}</a001>`);
        lines.push(`${ind(2)}<a002 refname="NotificationType">${esc(book.notification_type || '03')}</a002>`);
        lines.push(`${ind(2)}<a194 refname="RecordSourceType">02</a194>`);

        // Product identifiers
        if (book.isbn) {
            // ISBN-13
            lines.push(`${ind(2)}<productidentifier>`);
            lines.push(`${ind(3)}<b221 refname="ProductIDType">15</b221>`);
            lines.push(`${ind(3)}<b244 refname="IDValue">${esc(book.isbn)}</b244>`);
            lines.push(`${ind(2)}</productidentifier>`);
            // EAN (same as ISBN-13)
            lines.push(`${ind(2)}<productidentifier>`);
            lines.push(`${ind(3)}<b221 refname="ProductIDType">03</b221>`);
            lines.push(`${ind(3)}<b244 refname="IDValue">${esc(book.isbn)}</b244>`);
            lines.push(`${ind(2)}</productidentifier>`);
        }
        if (book.order_number) {
            lines.push(`${ind(2)}<productidentifier>`);
            lines.push(`${ind(3)}<b221 refname="ProductIDType">01</b221>`);
            lines.push(`${ind(3)}<b233 refname="IDTypeName">Publishers Order No</b233>`);
            lines.push(`${ind(3)}<b244 refname="IDValue">${esc(book.order_number)}</b244>`);
            lines.push(`${ind(2)}</productidentifier>`);
        }

        // Descriptive detail
        lines.push(`${ind(2)}<descriptivedetail>`);
        lines.push(`${ind(3)}<x314 refname="ProductComposition">00</x314>`);
        lines.push(`${ind(3)}<b012 refname="ProductForm">${esc(book.product_form || 'ED')}</b012>`);

        // Product form detail (EPUB)
        const formDetails = (book.product_form_detail || 'E101').split('+').map(s => s.trim());
        for (const fd of formDetails) {
            lines.push(`${ind(3)}<b333 refname="ProductFormDetail">${esc(fd)}</b333>`);
        }

        lines.push(`${ind(3)}<x416 refname="PrimaryContentType">${esc(book.primary_content_type || '10')}</x416>`);

        // DRM
        const drm = book.drm || settings.default_drm;
        if (drm) {
            lines.push(`${ind(3)}<x317 refname="EpubTechnicalProtection">${esc(drm)}</x317>`);
        }

        // Usage constraint
        if (book.epub_usage_type) {
            lines.push(`${ind(3)}<epubusageconstraint>`);
            lines.push(`${ind(4)}<x318 refname="EpubUsageType">${esc(book.epub_usage_type)}</x318>`);
            lines.push(`${ind(4)}<x319 refname="EpubUsageStatus">${esc(book.epub_usage_status || '01')}</x319>`);
            lines.push(`${ind(3)}</epubusageconstraint>`);
        }

        // Series / Collection
        if (book.series_name) {
            lines.push(`${ind(3)}<collection>`);
            lines.push(`${ind(4)}<x329 refname="CollectionType">${esc(book.series_collection_type || '10')}</x329>`);
            lines.push(`${ind(4)}<titledetail>`);
            lines.push(`${ind(5)}<b202 refname="TitleType">01</b202>`);
            lines.push(`${ind(5)}<titleelement>`);
            lines.push(`${ind(6)}<x409 refname="TitleElementLevel">02</x409>`);
            lines.push(`${ind(6)}<b203 refname="TitleText">${esc(book.series_name)}</b203>`);
            lines.push(`${ind(5)}</titleelement>`);
            lines.push(`${ind(4)}</titledetail>`);
            lines.push(`${ind(3)}</collection>`);
        }

        // Title
        lines.push(`${ind(3)}<titledetail>`);
        lines.push(`${ind(4)}<b202 refname="TitleType">01</b202>`);
        lines.push(`${ind(4)}<titleelement>`);
        lines.push(`${ind(5)}<x409 refname="TitleElementLevel">01</x409>`);
        if (book.part_number) {
            lines.push(`${ind(5)}<x410 refname="PartNumber">${esc(book.part_number)}</x410>`);
        }
        lines.push(`${ind(5)}<b203 refname="TitleText">${esc(book.title)}</b203>`);
        if (book.subtitle) {
            lines.push(`${ind(5)}<b029 refname="Subtitle">${esc(book.subtitle)}</b029>`);
        }
        lines.push(`${ind(4)}</titleelement>`);
        lines.push(`${ind(3)}</titledetail>`);

        // Contributors
        for (const c of contributors) {
            lines.push(`${ind(3)}<contributor>`);
            lines.push(`${ind(4)}<b034 refname="SequenceNumber">${c.sequence_number}</b034>`);
            lines.push(`${ind(4)}<b035 refname="ContributorRole">${esc(c.contributor_role)}</b035>`);
            if (c.corporate_name) {
                lines.push(`${ind(4)}<b047 refname="CorporateName">${esc(c.corporate_name)}</b047>`);
            } else {
                if (c.person_name) lines.push(`${ind(4)}<b036 refname="PersonName">${esc(c.person_name)}</b036>`);
                if (c.person_name_inverted) lines.push(`${ind(4)}<b037 refname="PersonNameInverted">${esc(c.person_name_inverted)}</b037>`);
                // Complex name parts
                if (c.titles_before) lines.push(`${ind(4)}<b038 refname="TitlesBeforeNames">${esc(c.titles_before)}</b038>`);
                if (c.names_before_key) lines.push(`${ind(4)}<b039 refname="NamesBeforeKey">${esc(c.names_before_key)}</b039>`);
                if (c.prefix_to_key) lines.push(`${ind(4)}<b247 refname="PrefixToKey">${esc(c.prefix_to_key)}</b247>`);
                if (c.key_names) lines.push(`${ind(4)}<b040 refname="KeyNames">${esc(c.key_names)}</b040>`);
                if (c.names_after_key) lines.push(`${ind(4)}<b041 refname="NamesAfterKey">${esc(c.names_after_key)}</b041>`);
            }
            if (c.biographical_note) lines.push(`${ind(4)}<b044 refname="BiographicalNote">${esc(c.biographical_note)}</b044>`);
            lines.push(`${ind(3)}</contributor>`);
        }

        // Edition
        if (book.edition_number) lines.push(`${ind(3)}<b057 refname="EditionNumber">${esc(book.edition_number)}</b057>`);
        if (book.edition_statement) lines.push(`${ind(3)}<b058 refname="EditionStatement">${esc(book.edition_statement)}</b058>`);

        // Language
        const lang = book.language_code || settings.default_language;
        if (lang) {
            lines.push(`${ind(3)}<language>`);
            lines.push(`${ind(4)}<b253 refname="LanguageRole">01</b253>`);
            lines.push(`${ind(4)}<b252 refname="LanguageCode">${esc(lang)}</b252>`);
            lines.push(`${ind(3)}</language>`);
        }
        if (book.original_language) {
            lines.push(`${ind(3)}<language>`);
            lines.push(`${ind(4)}<b253 refname="LanguageRole">02</b253>`);
            lines.push(`${ind(4)}<b252 refname="LanguageCode">${esc(book.original_language)}</b252>`);
            lines.push(`${ind(3)}</language>`);
        }

        // Pages / Extent
        if (book.page_count) {
            // Print counterpart pages
            lines.push(`${ind(3)}<extent>`);
            lines.push(`${ind(4)}<b218 refname="ExtentType">08</b218>`);
            lines.push(`${ind(4)}<b219 refname="ExtentValue">${book.page_count}</b219>`);
            lines.push(`${ind(4)}<b220 refname="ExtentUnit">03</b220>`);
            lines.push(`${ind(3)}</extent>`);
            // Content page count
            lines.push(`${ind(3)}<extent>`);
            lines.push(`${ind(4)}<b218 refname="ExtentType">11</b218>`);
            lines.push(`${ind(4)}<b219 refname="ExtentValue">${book.page_count}</b219>`);
            lines.push(`${ind(4)}<b220 refname="ExtentUnit">03</b220>`);
            lines.push(`${ind(3)}</extent>`);
        }

        // Subjects
        for (const s of subjects) {
            lines.push(`${ind(3)}<subject>`);
            if (s.is_main) lines.push(`${ind(4)}<x425 refname="MainSubject"/>`);
            lines.push(`${ind(4)}<b067 refname="SubjectSchemeIdentifier">${esc(s.scheme_id)}</b067>`);
            if (s.scheme_version) lines.push(`${ind(4)}<b068 refname="SubjectSchemeVersion">${esc(s.scheme_version)}</b068>`);
            if (s.subject_code) {
                lines.push(`${ind(4)}<b069 refname="SubjectCode">${esc(s.subject_code)}</b069>`);
            }
            if (s.subject_text) {
                lines.push(`${ind(4)}<b070 refname="SubjectHeadingText">${esc(s.subject_text)}</b070>`);
            }
            lines.push(`${ind(3)}</subject>`);
        }

        // Audience range
        if (book.audience_age_from != null) {
            lines.push(`${ind(3)}<audiencerange>`);
            lines.push(`${ind(4)}<b074 refname="AudienceRangeQualifier">${esc(book.audience_range_qualifier || '17')}</b074>`);
            lines.push(`${ind(4)}<b075 refname="AudienceRangePrecision">03</b075>`);
            lines.push(`${ind(4)}<b076 refname="AudienceRangeValue">${book.audience_age_from}</b076>`);
            if (book.audience_age_to != null) {
                lines.push(`${ind(4)}<b075 refname="AudienceRangePrecision">04</b075>`);
                lines.push(`${ind(4)}<b076 refname="AudienceRangeValue">${book.audience_age_to}</b076>`);
            }
            lines.push(`${ind(3)}</audiencerange>`);
        }

        lines.push(`${ind(2)}</descriptivedetail>`);

        // Collateral detail
        const hasCollateral = book.description || book.biography || book.toc || reviews.length > 0 || book.cover_filename || book.content_filename;
        if (hasCollateral) {
            lines.push(`${ind(2)}<collateraldetail>`);

            // Description
            if (book.description) {
                lines.push(`${ind(3)}<textcontent>`);
                lines.push(`${ind(4)}<x426 refname="TextType">03</x426>`);
                lines.push(`${ind(4)}<x427 refname="ContentAudience">00</x427>`);
                if (book.description_format === 'xhtml') {
                    lines.push(`${ind(4)}<d104 refname="Text" textformat="05">${book.description}</d104>`);
                } else {
                    lines.push(`${ind(4)}<d104 refname="Text">${esc(book.description)}</d104>`);
                }
                lines.push(`${ind(3)}</textcontent>`);
            }

            // Biography
            if (book.biography) {
                lines.push(`${ind(3)}<textcontent>`);
                lines.push(`${ind(4)}<x426 refname="TextType">12</x426>`);
                lines.push(`${ind(4)}<x427 refname="ContentAudience">00</x427>`);
                lines.push(`${ind(4)}<d104 refname="Text">${esc(book.biography)}</d104>`);
                lines.push(`${ind(3)}</textcontent>`);
            }

            // TOC
            if (book.toc) {
                lines.push(`${ind(3)}<textcontent>`);
                lines.push(`${ind(4)}<x426 refname="TextType">04</x426>`);
                lines.push(`${ind(4)}<x427 refname="ContentAudience">00</x427>`);
                lines.push(`${ind(4)}<d104 refname="Text">${esc(book.toc)}</d104>`);
                lines.push(`${ind(3)}</textcontent>`);
            }

            // Reviews
            for (const r of reviews) {
                lines.push(`${ind(3)}<textcontent>`);
                lines.push(`${ind(4)}<x426 refname="TextType">06</x426>`);
                lines.push(`${ind(4)}<x427 refname="ContentAudience">00</x427>`);
                if (r.review_date) {
                    lines.push(`${ind(4)}<d104 refname="Text" datestamp="${esc(r.review_date)}">${esc(r.review_text)}</d104>`);
                } else {
                    lines.push(`${ind(4)}<d104 refname="Text">${esc(r.review_text)}</d104>`);
                }
                if (r.text_author) lines.push(`${ind(4)}<d107 refname="TextAuthor">${esc(r.text_author)}</d107>`);
                if (r.source_title) lines.push(`${ind(4)}<x428 refname="SourceTitle">${esc(r.source_title)}</x428>`);
                lines.push(`${ind(3)}</textcontent>`);
            }

            // Supporting resources
            if (book.cover_filename) {
                lines.push(`${ind(3)}<supportingresource>`);
                lines.push(`${ind(4)}<x436 refname="ResourceContentType">01</x436>`);
                lines.push(`${ind(4)}<x427 refname="ContentAudience">00</x427>`);
                lines.push(`${ind(4)}<x437 refname="ResourceMode">03</x437>`);
                lines.push(`${ind(4)}<resourceversion>`);
                lines.push(`${ind(5)}<x441 refname="ResourceForm">02</x441>`);
                lines.push(`${ind(5)}<x435 refname="ResourceLink">${esc(book.cover_filename)}</x435>`);
                lines.push(`${ind(4)}</resourceversion>`);
                lines.push(`${ind(3)}</supportingresource>`);
            }
            if (book.content_filename) {
                lines.push(`${ind(3)}<supportingresource>`);
                lines.push(`${ind(4)}<x436 refname="ResourceContentType">28</x436>`);
                lines.push(`${ind(4)}<x427 refname="ContentAudience">00</x427>`);
                lines.push(`${ind(4)}<x437 refname="ResourceMode">04</x437>`);
                lines.push(`${ind(4)}<resourceversion>`);
                lines.push(`${ind(5)}<x441 refname="ResourceForm">02</x441>`);
                lines.push(`${ind(5)}<x435 refname="ResourceLink">${esc(book.content_filename)}</x435>`);
                lines.push(`${ind(4)}</resourceversion>`);
                lines.push(`${ind(3)}</supportingresource>`);
            }

            lines.push(`${ind(2)}</collateraldetail>`);
        }

        // Publishing detail
        lines.push(`${ind(2)}<publishingdetail>`);
        const pubName = book.publisher_name || settings.publisher_name;
        if (pubName) {
            lines.push(`${ind(3)}<publisher>`);
            lines.push(`${ind(4)}<b291 refname="PublishingRole">01</b291>`);
            lines.push(`${ind(4)}<b081 refname="PublisherName">${esc(pubName)}</b081>`);
            lines.push(`${ind(3)}</publisher>`);
        }
        const pubCity = book.publisher_city || settings.publisher_city;
        if (pubCity) lines.push(`${ind(3)}<b209 refname="CityOfPublication">${esc(pubCity)}</b209>`);
        const pubCountry = book.publisher_country || settings.publisher_country;
        if (pubCountry) lines.push(`${ind(3)}<b083 refname="CountryOfPublication">${esc(pubCountry)}</b083>`);

        lines.push(`${ind(3)}<b394 refname="PublishingStatus">${esc(book.publishing_status || '04')}</b394>`);

        if (book.publishing_date) {
            lines.push(`${ind(3)}<publishingdate>`);
            lines.push(`${ind(4)}<x448 refname="PublishingDateRole">01</x448>`);
            lines.push(`${ind(4)}<b306 refname="Date">${esc(book.publishing_date)}</b306>`);
            lines.push(`${ind(3)}</publishingdate>`);
        }
        if (book.print_pub_date) {
            lines.push(`${ind(3)}<publishingdate>`);
            lines.push(`${ind(4)}<x448 refname="PublishingDateRole">19</x448>`);
            lines.push(`${ind(4)}<b306 refname="Date">${esc(book.print_pub_date)}</b306>`);
            lines.push(`${ind(3)}</publishingdate>`);
        }
        if (book.announcement_date) {
            lines.push(`${ind(3)}<publishingdate>`);
            lines.push(`${ind(4)}<x448 refname="PublishingDateRole">09</x448>`);
            lines.push(`${ind(4)}<b306 refname="Date">${esc(book.announcement_date)}</b306>`);
            lines.push(`${ind(3)}</publishingdate>`);
        }

        // Sales rights
        for (const sr of salesRights) {
            lines.push(`${ind(3)}<salesrights>`);
            lines.push(`${ind(4)}<b089 refname="SalesRightsType">${esc(sr.rights_type)}</b089>`);
            lines.push(`${ind(4)}<territory>`);
            if (sr.regions) {
                lines.push(`${ind(5)}<x450 refname="RegionsIncluded">${esc(sr.regions)}</x450>`);
            }
            if (sr.countries) {
                lines.push(`${ind(5)}<x449 refname="CountriesIncluded">${esc(sr.countries)}</x449>`);
            }
            lines.push(`${ind(4)}</territory>`);

            // Sales restrictions
            const restrictions = db.prepare('SELECT * FROM sales_restrictions WHERE sales_right_id = ?').all(sr.id);
            for (const rest of restrictions) {
                lines.push(`${ind(4)}<salesrestriction>`);
                lines.push(`${ind(5)}<b381 refname="SalesRestrictionType">${esc(rest.restriction_type)}</b381>`);
                if (rest.restriction_note) {
                    lines.push(`${ind(5)}<x453 refname="SalesRestrictionNote">${esc(rest.restriction_note)}</x453>`);
                }
                if (rest.outlet_id_value) {
                    lines.push(`${ind(5)}<salesoutlet>`);
                    lines.push(`${ind(6)}<salesoutletidentifier>`);
                    lines.push(`${ind(7)}<b393 refname="SalesOutletIDType">${esc(rest.outlet_id_type || '01')}</b393>`);
                    lines.push(`${ind(7)}<b244 refname="IDValue">${esc(rest.outlet_id_value)}</b244>`);
                    lines.push(`${ind(6)}</salesoutletidentifier>`);
                    if (rest.outlet_name) lines.push(`${ind(6)}<b382 refname="SalesOutletName">${esc(rest.outlet_name)}</b382>`);
                    lines.push(`${ind(5)}</salesoutlet>`);
                }
                lines.push(`${ind(4)}</salesrestriction>`);
            }

            lines.push(`${ind(3)}</salesrights>`);
        }
        if (salesRights.length > 0) {
            // ROW sales rights (if any exclusion)
            const exclusion = salesRights.find(sr => sr.row_rights_type);
            if (exclusion) {
                lines.push(`${ind(3)}<x456 refname="ROWSalesRightsType">${esc(exclusion.row_rights_type)}</x456>`);
            }
        }

        lines.push(`${ind(2)}</publishingdetail>`);

        // Related material
        if (related.length > 0) {
            lines.push(`${ind(2)}<relatedmaterial>`);
            for (const rp of related) {
                lines.push(`${ind(3)}<relatedproduct>`);
                lines.push(`${ind(4)}<x455 refname="ProductRelationCode">${esc(rp.relation_code)}</x455>`);
                lines.push(`${ind(4)}<productidentifier>`);
                lines.push(`${ind(5)}<b221 refname="ProductIDType">15</b221>`);
                lines.push(`${ind(5)}<b244 refname="IDValue">${esc(rp.related_isbn)}</b244>`);
                lines.push(`${ind(4)}</productidentifier>`);
                lines.push(`${ind(3)}</relatedproduct>`);
            }
            lines.push(`${ind(2)}</relatedmaterial>`);
        }

        // Product supply
        if (prices.length > 0) {
            lines.push(`${ind(2)}<productsupply>`);
            lines.push(`${ind(3)}<supplydetail>`);

            // Supplier (publisher as distributor)
            lines.push(`${ind(4)}<supplier>`);
            lines.push(`${ind(5)}<j292 refname="SupplierRole">01</j292>`);
            if (pubName) lines.push(`${ind(5)}<j137 refname="SupplierName">${esc(pubName)}</j137>`);
            lines.push(`${ind(4)}</supplier>`);

            lines.push(`${ind(4)}<j396 refname="ProductAvailability">20</j396>`);

            // Supply date
            if (book.publishing_date) {
                lines.push(`${ind(4)}<supplydate>`);
                lines.push(`${ind(5)}<x461 refname="SupplyDateRole">08</x461>`);
                lines.push(`${ind(5)}<b306 refname="Date">${esc(book.publishing_date)}</b306>`);
                lines.push(`${ind(4)}</supplydate>`);
            }

            // Prices
            for (const p of prices) {
                lines.push(`${ind(4)}<price>`);
                lines.push(`${ind(5)}<x462 refname="PriceType">${esc(p.price_type)}</x462>`);
                lines.push(`${ind(5)}<j151 refname="PriceAmount">${p.amount}</j151>`);
                lines.push(`${ind(5)}<j152 refname="CurrencyCode">${esc(p.currency_code)}</j152>`);
                if (p.territory) {
                    lines.push(`${ind(5)}<territory>`);
                    lines.push(`${ind(6)}<x449 refname="CountriesIncluded">${esc(p.territory)}</x449>`);
                    lines.push(`${ind(5)}</territory>`);
                }
                if (p.start_date) {
                    lines.push(`${ind(5)}<pricedate>`);
                    lines.push(`${ind(6)}<x476 refname="PriceDateRole">14</x476>`);
                    lines.push(`${ind(6)}<b306 refname="Date">${esc(p.start_date)}</b306>`);
                    lines.push(`${ind(5)}</pricedate>`);
                }
                if (p.end_date) {
                    lines.push(`${ind(5)}<pricedate>`);
                    lines.push(`${ind(6)}<x476 refname="PriceDateRole">15</x476>`);
                    lines.push(`${ind(6)}<b306 refname="Date">${esc(p.end_date)}</b306>`);
                    lines.push(`${ind(5)}</pricedate>`);
                }
                lines.push(`${ind(4)}</price>`);
            }

            lines.push(`${ind(3)}</supplydetail>`);
            lines.push(`${ind(2)}</productsupply>`);
        }

        lines.push(`${ind(1)}</product>`);
    }

    lines.push('</ONIXmessage>');
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function insertRelatedData(bookId, data) {
    if (data.contributors) {
        const stmt = db.prepare(`INSERT INTO contributors (book_id, sequence_number, contributor_role, person_name, person_name_inverted, titles_before, names_before_key, prefix_to_key, key_names, names_after_key, corporate_name, biographical_note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const c of data.contributors) {
            stmt.run(bookId, c.sequence_number || 1, c.contributor_role || 'A01',
                c.person_name || '', c.person_name_inverted || '',
                c.titles_before || '', c.names_before_key || '', c.prefix_to_key || '',
                c.key_names || '', c.names_after_key || '',
                c.corporate_name || '', c.biographical_note || '');
        }
    }
    if (data.subjects) {
        const stmt = db.prepare(`INSERT INTO subjects (book_id, scheme_id, scheme_version, subject_code, subject_text, is_main) VALUES (?, ?, ?, ?, ?, ?)`);
        for (const s of data.subjects) {
            stmt.run(bookId, s.scheme_id || '10', s.scheme_version || '', s.subject_code || '', s.subject_text || '', s.is_main ? 1 : 0);
        }
    }
    if (data.prices) {
        const stmt = db.prepare(`INSERT INTO prices (book_id, price_type, amount, currency_code, territory, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        for (const p of data.prices) {
            stmt.run(bookId, p.price_type || '42', p.amount || 0, p.currency_code || 'EUR', p.territory || '', p.start_date || '', p.end_date || '');
        }
    }
    if (data.sales_rights) {
        for (const sr of data.sales_rights) {
            const info = db.prepare(`INSERT INTO sales_rights (book_id, rights_type, countries, regions, row_rights_type) VALUES (?, ?, ?, ?, ?)`).run(bookId, sr.rights_type || '02', sr.countries || '', sr.regions || '', sr.row_rights_type || '');
            if (sr.restrictions) {
                const rstmt = db.prepare(`INSERT INTO sales_restrictions (sales_right_id, restriction_type, restriction_note, outlet_id_type, outlet_id_value, outlet_name) VALUES (?, ?, ?, ?, ?, ?)`);
                for (const r of sr.restrictions) {
                    rstmt.run(info.lastInsertRowid, r.restriction_type || '', r.restriction_note || '', r.outlet_id_type || '', r.outlet_id_value || '', r.outlet_name || '');
                }
            }
        }
    }
    if (data.related_products) {
        const stmt = db.prepare(`INSERT INTO related_products (book_id, relation_code, related_isbn) VALUES (?, ?, ?)`);
        for (const rp of data.related_products) {
            stmt.run(bookId, rp.relation_code || '06', rp.related_isbn || '');
        }
    }
    if (data.reviews) {
        const stmt = db.prepare(`INSERT INTO reviews (book_id, review_text, text_author, source_title, review_date) VALUES (?, ?, ?, ?, ?)`);
        for (const r of data.reviews) {
            stmt.run(bookId, r.review_text || '', r.text_author || '', r.source_title || '', r.review_date || '');
        }
    }
}

function esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`ONIX Generator running at http://localhost:${PORT}`);
    console.log(`Database: ${DB_PATH}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close();
    process.exit(0);
});
