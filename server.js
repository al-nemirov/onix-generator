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

// Migrations — add new columns to existing databases
(function runMigrations() {
    const settingsCols = db.pragma('table_info(settings)').map(c => c.name);
    const booksCols = db.pragma('table_info(books)').map(c => c.name);
    // v1.2.0: Bookwire compliance fields
    const settingsMigrations = [
        ['message_note', "TEXT NOT NULL DEFAULT '-'"],
        ['supplier_role', "TEXT NOT NULL DEFAULT '06'"],
        ['supplier_name', "TEXT NOT NULL DEFAULT ''"],
        ['supplier_id_type', "TEXT NOT NULL DEFAULT '01'"],
        ['supplier_id_value', "TEXT NOT NULL DEFAULT ''"],
        ['default_epub_usage_type', "TEXT NOT NULL DEFAULT ''"],
        ['default_epub_usage_status', "TEXT NOT NULL DEFAULT '01'"],
        ['ui_language', "TEXT NOT NULL DEFAULT 'en'"],
    ];
    for (const [col, def] of settingsMigrations) {
        if (!settingsCols.includes(col)) {
            db.exec(`ALTER TABLE settings ADD COLUMN ${col} ${def}`);
        }
    }
    // v1.2.0: per-book product availability
    if (!booksCols.includes('product_availability')) {
        db.exec("ALTER TABLE books ADD COLUMN product_availability TEXT NOT NULL DEFAULT '20'");
    }
})();

// ---------------------------------------------------------------------------
// Middleware — Security
// ---------------------------------------------------------------------------

// Helmet: sets various HTTP headers for security
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'none'"],
        },
    },
}));

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
    const apiKey = req.headers['x-api-key'];
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
    if (typeof val !== 'string' || !/^\d{8}$/.test(val)) return false;
    const year = Number(val.slice(0, 4));
    const month = Number(val.slice(4, 6));
    const day = Number(val.slice(6, 8));
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const dt = new Date(Date.UTC(year, month - 1, day));
    return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
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
        'product_availability', 'audience_range_qualifier', 'series_collection_type'];
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

    // Validate related_products — Fix #5: validate relation codes
    // 06 = alternative format (EPUB/PDF of same work), 23 = similar product
    const validRelationCodes = ['06', '23', '01', '02', '03', '05', '13', '27'];
    if (data.related_products !== undefined) {
        if (!Array.isArray(data.related_products)) return 'related_products must be an array';
        if (data.related_products.length > 50) return 'Too many related_products (max 50)';
        for (const rp of data.related_products) {
            if (rp.relation_code && !validRelationCodes.includes(rp.relation_code)) {
                return `Invalid relation_code "${rp.relation_code}". Use 06 for alternative format (EPUB/PDF), 23 for similar product`;
            }
        }
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
        'default_price_type', 'message_note',
        'supplier_role', 'supplier_name', 'supplier_id_type', 'supplier_id_value',
        'default_epub_usage_type', 'default_epub_usage_status',
        'onix_format', 'theme', 'ui_language'
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
    if (req.body.ui_language && !['en', 'es', 'de', 'ru'].includes(req.body.ui_language)) {
        return res.status(400).json({ error: 'ui_language must be one of: en, es, de, ru' });
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

const BOOKS_LIST_SELECT = `
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
        FROM books b`;

/** Shared filter (search + toolbar filters) for list / id export. */
function buildBooksWhereClause(query) {
    const { search, language, status, drm } = query;
    const params = {};
    const where = [];
    if (search) {
        const sanitized = '"' + search.replace(/"/g, '""') + '"';
        where.push(`b.id IN (SELECT rowid FROM books_fts WHERE books_fts MATCH @search)`);
        params.search = sanitized;
    }
    if (language) {
        where.push(`b.language_code = @language`);
        params.language = String(language);
    }
    if (status) {
        where.push(`b.publishing_status = @status`);
        params.status = String(status);
    }
    if (drm) {
        where.push(`b.drm = @drm`);
        params.drm = String(drm);
    }
    const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    return { whereSql, params };
}

const BOOKS_SORT_SQL = {
    id: 'b.id',
    isbn: 'b.isbn',
    title: 'b.title',
    subtitle: 'b.subtitle',
    language_code: 'b.language_code',
    publishing_status: 'b.publishing_status',
    publishing_date: 'b.publishing_date',
    created_at: 'b.created_at',
    updated_at: 'b.updated_at',
    authors: 'authors',
    bisac_main: 'bisac_main',
    thema_main: 'thema_main',
    wgs_main: 'wgs_main',
    price: 'price',
    territory: 'territory',
};

function booksOrderByClause(sort, order) {
    const sortOrder = order === 'desc' ? 'DESC' : 'ASC';
    const key = typeof sort === 'string' && BOOKS_SORT_SQL[sort] ? sort : 'id';
    return ` ORDER BY ${BOOKS_SORT_SQL[key]} ${sortOrder}`;
}

const MAX_BOOK_IDS_EXPORT = 50000;

// All book ids matching current filters (for "select all results")
app.get('/api/books/ids', (req, res) => {
    const { whereSql, params } = buildBooksWhereClause(req.query);
    const sql = `SELECT b.id FROM books b${whereSql} ORDER BY b.id ASC LIMIT ${MAX_BOOK_IDS_EXPORT}`;
    const rows = db.prepare(sql).all(params);
    res.json({
        ids: rows.map((r) => r.id),
        capped: rows.length >= MAX_BOOK_IDS_EXPORT,
    });
});

// List all books (table view: lightweight, only main columns)
app.get('/api/books', (req, res) => {
    const { sort, order, limit, offset } = req.query;
    const { whereSql, params } = buildBooksWhereClause(req.query);
    let sql = BOOKS_LIST_SELECT + whereSql;
    sql += booksOrderByClause(sort, order);

    if (limit) {
        sql += ` LIMIT @limit`;
        params.limit = parseInt(limit) || 100;
    }
    if (offset) {
        sql += ` OFFSET @offset`;
        params.offset = parseInt(offset) || 0;
    }

    const books = db.prepare(sql).all(params);
    let totalSql = 'SELECT COUNT(*) as count FROM books b';
    totalSql += whereSql;
    const total = db.prepare(totalSql).get(params).count;
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
            'cover_filename', 'content_filename',
            'product_availability'
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
            'cover_filename', 'content_filename',
            'product_availability'
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
app.post('/api/import', strictLimiter, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        
        // Read file based on extension
        const ext = path.extname(req.file.originalname || '').toLowerCase();
        if (ext === '.csv') {
            await workbook.csv.readFile(req.file.path);
        } else {
            await workbook.xlsx.readFile(req.file.path);
        }
        
        const worksheet = workbook.getWorksheet(1);
        if (!worksheet) {
            throw new Error('No worksheet found in file');
        }
        
        // Convert to JSON
        const data = [];
        const headers = [];
        
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) {
                // First row - headers
                row.eachCell((cell) => {
                    headers.push(cell.value ? String(cell.value).trim() : '');
                });
            } else {
                // Data rows
                const rowData = {};
                row.eachCell((cell, colNumber) => {
                    const header = headers[colNumber - 1] || `Column${colNumber}`;
                    rowData[header] = cell.value;
                });
                data.push(rowData);
            }
        });

        // Clean up temp file
        fs.unlinkSync(req.file.path);

        // Return parsed data for column mapping on frontend
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
app.get('/api/export/:format', async (req, res) => {
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
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Books');
        
        // Define columns
        const columns = [
            { header: 'ISBN', key: 'isbn' },
            { header: 'Title', key: 'title' },
            { header: 'Subtitle', key: 'subtitle' },
            { header: 'Authors', key: 'authors' },
            { header: 'Language', key: 'language_code' },
            { header: 'Pages', key: 'page_count' },
            { header: 'BISAC Codes', key: 'bisac_codes' },
            { header: 'Thema Codes', key: 'thema_codes' },
            { header: 'WGS Codes', key: 'wgs_codes' },
            { header: 'Keywords', key: 'keywords' },
            { header: 'Price', key: 'price' },
            { header: 'Currency', key: 'currency' },
            { header: 'Status', key: 'publishing_status' },
            { header: 'Pub Date', key: 'publishing_date' },
            { header: 'Publisher', key: 'publisher_name' },
            { header: 'Description', key: 'description' },
        ];
        worksheet.columns = columns;
        
        // Add rows
        for (const book of books) {
            worksheet.addRow({
                isbn: book.isbn,
                title: book.title,
                subtitle: book.subtitle,
                authors: book.authors,
                language_code: book.language_code,
                page_count: book.page_count,
                bisac_codes: book.bisac_codes,
                thema_codes: book.thema_codes,
                wgs_codes: book.wgs_codes,
                keywords: book.keywords,
                price: book.price,
                currency: book.currency,
                publishing_status: book.publishing_status,
                publishing_date: book.publishing_date,
                publisher_name: book.publisher_name,
                description: book.description,
            });
        }

        if (format === 'xlsx') {
            const buf = await workbook.xlsx.writeBuffer();
            res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.set('Content-Disposition', 'attachment; filename="onix_books.xlsx"');
            res.send(buf);
        } else {
            const buf = await workbook.csv.writeBuffer();
            res.set('Content-Type', 'text/csv');
            res.set('Content-Disposition', 'attachment; filename="onix_books.csv"');
            res.send(buf);
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
        ip: req.ip || req.socket?.remoteAddress || '',
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

// Fix #3: Resolve ProductAvailability from book fields (not hardcoded 20)
// Bookwire takedown statuses: 01, 30, 40, 46, 51, 52
function resolveProductAvailability(book) {
    // If explicitly set on the book, use it
    if (book.product_availability) return book.product_availability;
    // Derive from notification_type / publishing_status
    if (book.notification_type === '05') return '40'; // takedown → not available
    const status = book.publishing_status || '04';
    const takedownStatuses = { '07': '40', '08': '46', '10': '01', '11': '51' };
    if (takedownStatuses[status]) return takedownStatuses[status];
    return '20'; // default: available
}

// Fix #7: Validate Bookwire price interval rules
// Rule: next interval start_date must be prev end_date + 1 day; last may omit end_date
function validatePriceIntervals(prices) {
    const warnings = [];
    const dated = prices.filter(p => p.start_date).sort((a, b) => a.start_date.localeCompare(b.start_date));
    for (let i = 0; i < dated.length - 1; i++) {
        const curr = dated[i];
        const next = dated[i + 1];
        if (!curr.end_date) {
            // Only last interval may omit end_date
            warnings.push(`Price interval ${i + 1} (start=${curr.start_date}) has no end_date but is not the last interval`);
            continue;
        }
        // Check next start = curr end + 1 day
        const endDate = new Date(
            parseInt(curr.end_date.substring(0, 4)),
            parseInt(curr.end_date.substring(4, 6)) - 1,
            parseInt(curr.end_date.substring(6, 8))
        );
        endDate.setDate(endDate.getDate() + 1);
        const expectedNext = endDate.toISOString().slice(0, 10).replace(/-/g, '');
        if (next.start_date !== expectedNext) {
            warnings.push(`Price interval gap: interval ${i + 1} ends ${curr.end_date}, interval ${i + 2} starts ${next.start_date} (expected ${expectedNext})`);
        }
    }
    return warnings;
}
// Fix #4: Short-to-reference tag name mapping for ONIX 3.0
// When settings.onix_format === 'reference', use full tag names instead of short codes
const SHORT_TO_REF = {
    'x298': 'SenderName', 'x299': 'ContactName', 'j272': 'EmailAddress',
    'm183': 'MessageNote', 'x307': 'SentDateTime', 'm184': 'DefaultLanguageOfText',
    'a001': 'RecordReference', 'a002': 'NotificationType', 'a194': 'RecordSourceType',
    'b221': 'ProductIDType', 'b233': 'IDTypeName', 'b244': 'IDValue',
    'x314': 'ProductComposition', 'b012': 'ProductForm', 'b333': 'ProductFormDetail',
    'x416': 'PrimaryContentType', 'x317': 'EpubTechnicalProtection',
    'x318': 'EpubUsageType', 'x319': 'EpubUsageStatus',
    'x329': 'CollectionType', 'b202': 'TitleType', 'x409': 'TitleElementLevel',
    'x410': 'PartNumber', 'b203': 'TitleText', 'b029': 'Subtitle',
    'b034': 'SequenceNumber', 'b035': 'ContributorRole',
    'b036': 'PersonName', 'b037': 'PersonNameInverted',
    'b038': 'TitlesBeforeNames', 'b039': 'NamesBeforeKey', 'b247': 'PrefixToKey',
    'b040': 'KeyNames', 'b041': 'NamesAfterKey', 'b047': 'CorporateName',
    'b044': 'BiographicalNote', 'b057': 'EditionNumber', 'b058': 'EditionStatement',
    'b253': 'LanguageRole', 'b252': 'LanguageCode',
    'b218': 'ExtentType', 'b219': 'ExtentValue', 'b220': 'ExtentUnit',
    'x425': 'MainSubject', 'b067': 'SubjectSchemeIdentifier', 'b068': 'SubjectSchemeVersion',
    'b069': 'SubjectCode', 'b070': 'SubjectHeadingText',
    'b074': 'AudienceRangeQualifier', 'b075': 'AudienceRangePrecision', 'b076': 'AudienceRangeValue',
    'x426': 'TextType', 'x427': 'ContentAudience', 'd104': 'Text',
    'd107': 'TextAuthor', 'x428': 'SourceTitle', 'x429': 'ContentDateRole',
    'x436': 'ResourceContentType', 'x437': 'ResourceMode', 'x441': 'ResourceForm', 'x435': 'ResourceLink',
    'b291': 'PublishingRole', 'b081': 'PublisherName',
    'b209': 'CityOfPublication', 'b083': 'CountryOfPublication',
    'b394': 'PublishingStatus', 'x448': 'PublishingDateRole', 'b306': 'Date',
    'b089': 'SalesRightsType', 'x450': 'RegionsIncluded', 'x449': 'CountriesIncluded',
    'b381': 'SalesRestrictionType', 'x453': 'SalesRestrictionNote',
    'b393': 'SalesOutletIDType', 'b382': 'SalesOutletName',
    'x456': 'ROWSalesRightsType', 'x455': 'ProductRelationCode',
    'j292': 'SupplierRole', 'j345': 'SupplierIDType', 'j137': 'SupplierName',
    'j396': 'ProductAvailability', 'x461': 'SupplyDateRole',
    'x462': 'PriceType', 'j151': 'PriceAmount', 'j152': 'CurrencyCode',
    'x469': 'UnpricedItemType', 'x476': 'PriceDateRole',
};

// Composite element names (short → reference)
const ELEM_TO_REF = {
    'header': 'Header', 'sender': 'Sender', 'product': 'Product',
    'productidentifier': 'ProductIdentifier', 'descriptivedetail': 'DescriptiveDetail',
    'epubusageconstraint': 'EpubUsageConstraint', 'collection': 'Collection',
    'titledetail': 'TitleDetail', 'titleelement': 'TitleElement',
    'contributor': 'Contributor', 'language': 'Language', 'extent': 'Extent',
    'subject': 'Subject', 'audiencerange': 'AudienceRange',
    'collateraldetail': 'CollateralDetail', 'textcontent': 'TextContent',
    'contentdate': 'ContentDate', 'supportingresource': 'SupportingResource',
    'resourceversion': 'ResourceVersion', 'publishingdetail': 'PublishingDetail',
    'publisher': 'Publisher', 'publishingdate': 'PublishingDate',
    'salesrights': 'SalesRights', 'territory': 'Territory',
    'salesrestriction': 'SalesRestriction', 'salesoutlet': 'SalesOutlet',
    'salesoutletidentifier': 'SalesOutletIdentifier',
    'relatedmaterial': 'RelatedMaterial', 'relatedproduct': 'RelatedProduct',
    'productsupply': 'ProductSupply', 'supplydetail': 'SupplyDetail',
    'supplier': 'Supplier', 'supplieridentifier': 'SupplierIdentifier',
    'supplydate': 'SupplyDate', 'price': 'Price', 'pricedate': 'PriceDate',
};

function generateOnixXml(settings, books) {
    const lines = [];
    const ind = (level) => '    '.repeat(level);
    const useRef = settings.onix_format === 'reference';

    // Tag helpers: output short or reference format
    // Short: <x298 refname="SenderName">value</x298>
    // Reference: <SenderName>value</SenderName>
    const tag = (shortCode, value) => {
        if (useRef) {
            const refName = SHORT_TO_REF[shortCode] || shortCode;
            return `<${refName}>${value}</${refName}>`;
        }
        return `<${shortCode} refname="${SHORT_TO_REF[shortCode] || shortCode}">${value}</${shortCode}>`;
    };
    const selfTag = (shortCode) => {
        if (useRef) {
            const refName = SHORT_TO_REF[shortCode] || shortCode;
            return `<${refName}/>`;
        }
        return `<${shortCode} refname="${SHORT_TO_REF[shortCode] || shortCode}"/>`;
    };
    const tagAttr = (shortCode, attrs, value) => {
        if (useRef) {
            const refName = SHORT_TO_REF[shortCode] || shortCode;
            return `<${refName} ${attrs}>${value}</${refName}>`;
        }
        return `<${shortCode} refname="${SHORT_TO_REF[shortCode] || shortCode}" ${attrs}>${value}</${shortCode}>`;
    };
    const open = (elem) => useRef ? `<${ELEM_TO_REF[elem] || elem}>` : `<${elem}>`;
    const close = (elem) => useRef ? `</${ELEM_TO_REF[elem] || elem}>` : `</${elem}>`;
    const rootNs = useRef
        ? 'http://ns.editeur.org/onix/3.0/reference'
        : 'http://ns.editeur.org/onix/3.0/short';
    const rootTag = useRef ? 'ONIXMessage' : 'ONIXmessage';

    lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    lines.push(`<${rootTag} release="3.0" xmlns="${rootNs}">`);

    // Header — Fix #1: m183 MessageNote, Fix #4: reference format support
    lines.push(`${ind(1)}${open('header')}`);
    lines.push(`${ind(2)}${open('sender')}`);
    if (settings.sender_name) lines.push(`${ind(3)}${tag('x298', esc(settings.sender_name))}`);
    if (settings.contact_name) lines.push(`${ind(3)}${tag('x299', esc(settings.contact_name))}`);
    if (settings.email) lines.push(`${ind(3)}${tag('j272', esc(settings.email))}`);
    lines.push(`${ind(2)}${close('sender')}`);
    const messageNote = settings.message_note || '-';
    lines.push(`${ind(2)}${tag('m183', esc(messageNote))}`);
    lines.push(`${ind(2)}${tag('x307', formatDate(new Date()))}`);
    if (settings.default_language) lines.push(`${ind(2)}${tag('m184', esc(settings.default_language))}`);
    lines.push(`${ind(1)}${close('header')}`);

    // Products
    for (const book of books) {
        const contributors = db.prepare('SELECT * FROM contributors WHERE book_id = ? ORDER BY sequence_number').all(book.id);
        const subjects = db.prepare('SELECT * FROM subjects WHERE book_id = ?').all(book.id);
        const prices = db.prepare('SELECT * FROM prices WHERE book_id = ?').all(book.id);
        const salesRights = db.prepare('SELECT * FROM sales_rights WHERE book_id = ?').all(book.id);
        const related = db.prepare('SELECT * FROM related_products WHERE book_id = ?').all(book.id);
        const reviews = db.prepare('SELECT * FROM reviews WHERE book_id = ?').all(book.id);

        lines.push(`${ind(1)}${open('product')}`);

        // Record reference
        const ref = book.internal_ref || `${Date.now()}_${book.isbn || book.id}`;
        lines.push(`${ind(2)}${tag('a001', esc(ref))}`);
        lines.push(`${ind(2)}${tag('a002', esc(book.notification_type || '03'))}`);
        lines.push(`${ind(2)}${tag('a194', '02')}`);

        // Product identifiers
        if (book.isbn) {
            lines.push(`${ind(2)}${open('productidentifier')}`);
            lines.push(`${ind(3)}${tag('b221', '15')}`);
            lines.push(`${ind(3)}${tag('b244', esc(book.isbn))}`);
            lines.push(`${ind(2)}${close('productidentifier')}`);
            lines.push(`${ind(2)}${open('productidentifier')}`);
            lines.push(`${ind(3)}${tag('b221', '03')}`);
            lines.push(`${ind(3)}${tag('b244', esc(book.isbn))}`);
            lines.push(`${ind(2)}${close('productidentifier')}`);
        }
        if (book.order_number) {
            lines.push(`${ind(2)}${open('productidentifier')}`);
            lines.push(`${ind(3)}${tag('b221', '01')}`);
            lines.push(`${ind(3)}${tag('b233', 'Publishers Order No')}`);
            lines.push(`${ind(3)}${tag('b244', esc(book.order_number))}`);
            lines.push(`${ind(2)}${close('productidentifier')}`);
        }

        // Descriptive detail
        lines.push(`${ind(2)}${open('descriptivedetail')}`);
        lines.push(`${ind(3)}${tag('x314', '00')}`);
        lines.push(`${ind(3)}${tag('b012', esc(book.product_form || 'ED'))}`);

        const formDetails = (book.product_form_detail || 'E101').split('+').map(s => s.trim());
        for (const fd of formDetails) {
            lines.push(`${ind(3)}${tag('b333', esc(fd))}`);
        }

        lines.push(`${ind(3)}${tag('x416', esc(book.primary_content_type || '10'))}`);

        // DRM
        const drm = book.drm || settings.default_drm;
        if (drm) lines.push(`${ind(3)}${tag('x317', esc(drm))}`);

        // Usage constraint — Fix #9
        const usageType = book.epub_usage_type || settings.default_epub_usage_type;
        if (usageType) {
            lines.push(`${ind(3)}${open('epubusageconstraint')}`);
            lines.push(`${ind(4)}${tag('x318', esc(usageType))}`);
            lines.push(`${ind(4)}${tag('x319', esc(book.epub_usage_status || settings.default_epub_usage_status || '01'))}`);
            lines.push(`${ind(3)}${close('epubusageconstraint')}`);
        }

        // Series / Collection
        if (book.series_name) {
            lines.push(`${ind(3)}${open('collection')}`);
            lines.push(`${ind(4)}${tag('x329', esc(book.series_collection_type || '10'))}`);
            lines.push(`${ind(4)}${open('titledetail')}`);
            lines.push(`${ind(5)}${tag('b202', '01')}`);
            lines.push(`${ind(5)}${open('titleelement')}`);
            lines.push(`${ind(6)}${tag('x409', '02')}`);
            lines.push(`${ind(6)}${tag('b203', esc(book.series_name))}`);
            lines.push(`${ind(5)}${close('titleelement')}`);
            lines.push(`${ind(4)}${close('titledetail')}`);
            lines.push(`${ind(3)}${close('collection')}`);
        }

        // Title
        lines.push(`${ind(3)}${open('titledetail')}`);
        lines.push(`${ind(4)}${tag('b202', '01')}`);
        lines.push(`${ind(4)}${open('titleelement')}`);
        lines.push(`${ind(5)}${tag('x409', '01')}`);
        if (book.part_number) lines.push(`${ind(5)}${tag('x410', esc(book.part_number))}`);
        lines.push(`${ind(5)}${tag('b203', esc(book.title))}`);
        if (book.subtitle) lines.push(`${ind(5)}${tag('b029', esc(book.subtitle))}`);
        lines.push(`${ind(4)}${close('titleelement')}`);
        lines.push(`${ind(3)}${close('titledetail')}`);

        // Contributors
        for (const c of contributors) {
            lines.push(`${ind(3)}${open('contributor')}`);
            lines.push(`${ind(4)}${tag('b034', String(c.sequence_number))}`);
            lines.push(`${ind(4)}${tag('b035', esc(c.contributor_role))}`);
            if (c.corporate_name) {
                lines.push(`${ind(4)}${tag('b047', esc(c.corporate_name))}`);
            } else {
                if (c.person_name) lines.push(`${ind(4)}${tag('b036', esc(c.person_name))}`);
                if (c.person_name_inverted) lines.push(`${ind(4)}${tag('b037', esc(c.person_name_inverted))}`);
                if (c.titles_before) lines.push(`${ind(4)}${tag('b038', esc(c.titles_before))}`);
                if (c.names_before_key) lines.push(`${ind(4)}${tag('b039', esc(c.names_before_key))}`);
                if (c.prefix_to_key) lines.push(`${ind(4)}${tag('b247', esc(c.prefix_to_key))}`);
                if (c.key_names) lines.push(`${ind(4)}${tag('b040', esc(c.key_names))}`);
                if (c.names_after_key) lines.push(`${ind(4)}${tag('b041', esc(c.names_after_key))}`);
            }
            if (c.biographical_note) lines.push(`${ind(4)}${tag('b044', esc(c.biographical_note))}`);
            lines.push(`${ind(3)}${close('contributor')}`);
        }

        // Edition
        if (book.edition_number) lines.push(`${ind(3)}${tag('b057', esc(book.edition_number))}`);
        if (book.edition_statement) lines.push(`${ind(3)}${tag('b058', esc(book.edition_statement))}`);

        // Language
        const lang = book.language_code || settings.default_language;
        if (lang) {
            lines.push(`${ind(3)}${open('language')}`);
            lines.push(`${ind(4)}${tag('b253', '01')}`);
            lines.push(`${ind(4)}${tag('b252', esc(lang))}`);
            lines.push(`${ind(3)}${close('language')}`);
        }
        if (book.original_language) {
            lines.push(`${ind(3)}${open('language')}`);
            lines.push(`${ind(4)}${tag('b253', '02')}`);
            lines.push(`${ind(4)}${tag('b252', esc(book.original_language))}`);
            lines.push(`${ind(3)}${close('language')}`);
        }

        // Pages / Extent
        if (book.page_count) {
            lines.push(`${ind(3)}${open('extent')}`);
            lines.push(`${ind(4)}${tag('b218', '08')}`);
            lines.push(`${ind(4)}${tag('b219', String(book.page_count))}`);
            lines.push(`${ind(4)}${tag('b220', '03')}`);
            lines.push(`${ind(3)}${close('extent')}`);
            lines.push(`${ind(3)}${open('extent')}`);
            lines.push(`${ind(4)}${tag('b218', '11')}`);
            lines.push(`${ind(4)}${tag('b219', String(book.page_count))}`);
            lines.push(`${ind(4)}${tag('b220', '03')}`);
            lines.push(`${ind(3)}${close('extent')}`);
        }

        // Subjects
        for (const s of subjects) {
            lines.push(`${ind(3)}${open('subject')}`);
            if (s.is_main) lines.push(`${ind(4)}${selfTag('x425')}`);
            lines.push(`${ind(4)}${tag('b067', esc(s.scheme_id))}`);
            if (s.scheme_version) lines.push(`${ind(4)}${tag('b068', esc(s.scheme_version))}`);
            if (s.subject_code) lines.push(`${ind(4)}${tag('b069', esc(s.subject_code))}`);
            if (s.subject_text) lines.push(`${ind(4)}${tag('b070', esc(s.subject_text))}`);
            lines.push(`${ind(3)}${close('subject')}`);
        }

        // Audience range
        if (book.audience_age_from != null) {
            lines.push(`${ind(3)}${open('audiencerange')}`);
            lines.push(`${ind(4)}${tag('b074', esc(book.audience_range_qualifier || '17'))}`);
            lines.push(`${ind(4)}${tag('b075', '03')}`);
            lines.push(`${ind(4)}${tag('b076', String(book.audience_age_from))}`);
            if (book.audience_age_to != null) {
                lines.push(`${ind(4)}${tag('b075', '04')}`);
                lines.push(`${ind(4)}${tag('b076', String(book.audience_age_to))}`);
            }
            lines.push(`${ind(3)}${close('audiencerange')}`);
        }

        lines.push(`${ind(2)}${close('descriptivedetail')}`);

        // Collateral detail
        const hasCollateral = book.description || book.biography || book.toc || reviews.length > 0 || book.cover_filename || book.content_filename;
        if (hasCollateral) {
            lines.push(`${ind(2)}${open('collateraldetail')}`);

            if (book.description) {
                lines.push(`${ind(3)}${open('textcontent')}`);
                lines.push(`${ind(4)}${tag('x426', '03')}`);
                lines.push(`${ind(4)}${tag('x427', '00')}`);
                if (book.description_format === 'xhtml') {
                    lines.push(`${ind(4)}${tagAttr('d104', 'textformat="05"', book.description)}`);
                } else {
                    lines.push(`${ind(4)}${tag('d104', esc(book.description))}`);
                }
                lines.push(`${ind(3)}${close('textcontent')}`);
            }

            if (book.biography) {
                lines.push(`${ind(3)}${open('textcontent')}`);
                lines.push(`${ind(4)}${tag('x426', '12')}`);
                lines.push(`${ind(4)}${tag('x427', '00')}`);
                lines.push(`${ind(4)}${tag('d104', esc(book.biography))}`);
                lines.push(`${ind(3)}${close('textcontent')}`);
            }

            if (book.toc) {
                lines.push(`${ind(3)}${open('textcontent')}`);
                lines.push(`${ind(4)}${tag('x426', '04')}`);
                lines.push(`${ind(4)}${tag('x427', '00')}`);
                lines.push(`${ind(4)}${tag('d104', esc(book.toc))}`);
                lines.push(`${ind(3)}${close('textcontent')}`);
            }

            // Reviews — Fix #10: ContentDate instead of datestamp
            for (const r of reviews) {
                lines.push(`${ind(3)}${open('textcontent')}`);
                lines.push(`${ind(4)}${tag('x426', '06')}`);
                lines.push(`${ind(4)}${tag('x427', '00')}`);
                lines.push(`${ind(4)}${tag('d104', esc(r.review_text))}`);
                if (r.text_author) lines.push(`${ind(4)}${tag('d107', esc(r.text_author))}`);
                if (r.source_title) lines.push(`${ind(4)}${tag('x428', esc(r.source_title))}`);
                if (r.review_date) {
                    lines.push(`${ind(4)}${open('contentdate')}`);
                    lines.push(`${ind(5)}${tag('x429', '01')}`);
                    lines.push(`${ind(5)}${tag('b306', esc(r.review_date))}`);
                    lines.push(`${ind(4)}${close('contentdate')}`);
                }
                lines.push(`${ind(3)}${close('textcontent')}`);
            }

            if (book.cover_filename) {
                lines.push(`${ind(3)}${open('supportingresource')}`);
                lines.push(`${ind(4)}${tag('x436', '01')}`);
                lines.push(`${ind(4)}${tag('x427', '00')}`);
                lines.push(`${ind(4)}${tag('x437', '03')}`);
                lines.push(`${ind(4)}${open('resourceversion')}`);
                lines.push(`${ind(5)}${tag('x441', '02')}`);
                lines.push(`${ind(5)}${tag('x435', esc(book.cover_filename))}`);
                lines.push(`${ind(4)}${close('resourceversion')}`);
                lines.push(`${ind(3)}${close('supportingresource')}`);
            }
            if (book.content_filename) {
                lines.push(`${ind(3)}${open('supportingresource')}`);
                lines.push(`${ind(4)}${tag('x436', '28')}`);
                lines.push(`${ind(4)}${tag('x427', '00')}`);
                lines.push(`${ind(4)}${tag('x437', '04')}`);
                lines.push(`${ind(4)}${open('resourceversion')}`);
                lines.push(`${ind(5)}${tag('x441', '02')}`);
                lines.push(`${ind(5)}${tag('x435', esc(book.content_filename))}`);
                lines.push(`${ind(4)}${close('resourceversion')}`);
                lines.push(`${ind(3)}${close('supportingresource')}`);
            }

            lines.push(`${ind(2)}${close('collateraldetail')}`);
        }

        // Publishing detail
        lines.push(`${ind(2)}${open('publishingdetail')}`);
        const pubName = book.publisher_name || settings.publisher_name;
        if (pubName) {
            lines.push(`${ind(3)}${open('publisher')}`);
            lines.push(`${ind(4)}${tag('b291', '01')}`);
            lines.push(`${ind(4)}${tag('b081', esc(pubName))}`);
            lines.push(`${ind(3)}${close('publisher')}`);
        }
        const pubCity = book.publisher_city || settings.publisher_city;
        if (pubCity) lines.push(`${ind(3)}${tag('b209', esc(pubCity))}`);
        const pubCountry = book.publisher_country || settings.publisher_country;
        if (pubCountry) lines.push(`${ind(3)}${tag('b083', esc(pubCountry))}`);

        lines.push(`${ind(3)}${tag('b394', esc(book.publishing_status || '04'))}`);

        if (book.publishing_date) {
            lines.push(`${ind(3)}${open('publishingdate')}`);
            lines.push(`${ind(4)}${tag('x448', '01')}`);
            lines.push(`${ind(4)}${tag('b306', esc(book.publishing_date))}`);
            lines.push(`${ind(3)}${close('publishingdate')}`);
        }
        if (book.print_pub_date) {
            lines.push(`${ind(3)}${open('publishingdate')}`);
            lines.push(`${ind(4)}${tag('x448', '19')}`);
            lines.push(`${ind(4)}${tag('b306', esc(book.print_pub_date))}`);
            lines.push(`${ind(3)}${close('publishingdate')}`);
        }
        if (book.announcement_date) {
            lines.push(`${ind(3)}${open('publishingdate')}`);
            lines.push(`${ind(4)}${tag('x448', '09')}`);
            lines.push(`${ind(4)}${tag('b306', esc(book.announcement_date))}`);
            lines.push(`${ind(3)}${close('publishingdate')}`);
        }

        // Sales rights — Fix #6: ROW x456 bound to its salesrights type 03
        for (const sr of salesRights) {
            lines.push(`${ind(3)}${open('salesrights')}`);
            lines.push(`${ind(4)}${tag('b089', esc(sr.rights_type))}`);
            lines.push(`${ind(4)}${open('territory')}`);
            if (sr.regions) lines.push(`${ind(5)}${tag('x450', esc(sr.regions))}`);
            if (sr.countries) lines.push(`${ind(5)}${tag('x449', esc(sr.countries))}`);
            lines.push(`${ind(4)}${close('territory')}`);

            const restrictions = db.prepare('SELECT * FROM sales_restrictions WHERE sales_right_id = ?').all(sr.id);
            for (const rest of restrictions) {
                lines.push(`${ind(4)}${open('salesrestriction')}`);
                lines.push(`${ind(5)}${tag('b381', esc(rest.restriction_type))}`);
                if (rest.restriction_note) lines.push(`${ind(5)}${tag('x453', esc(rest.restriction_note))}`);
                if (rest.outlet_id_value) {
                    lines.push(`${ind(5)}${open('salesoutlet')}`);
                    lines.push(`${ind(6)}${open('salesoutletidentifier')}`);
                    lines.push(`${ind(7)}${tag('b393', esc(rest.outlet_id_type || '01'))}`);
                    lines.push(`${ind(7)}${tag('b244', esc(rest.outlet_id_value))}`);
                    lines.push(`${ind(6)}${close('salesoutletidentifier')}`);
                    if (rest.outlet_name) lines.push(`${ind(6)}${tag('b382', esc(rest.outlet_name))}`);
                    lines.push(`${ind(5)}${close('salesoutlet')}`);
                }
                lines.push(`${ind(4)}${close('salesrestriction')}`);
            }

            lines.push(`${ind(3)}${close('salesrights')}`);

            // Fix #6: ROW rights immediately after its salesrights type 03 block
            if (sr.rights_type === '03' && sr.row_rights_type) {
                lines.push(`${ind(3)}${tag('x456', esc(sr.row_rights_type))}`);
            }
        }

        lines.push(`${ind(2)}${close('publishingdetail')}`);

        // Related material — Fix #5: validate relation codes at data level
        if (related.length > 0) {
            lines.push(`${ind(2)}${open('relatedmaterial')}`);
            for (const rp of related) {
                lines.push(`${ind(3)}${open('relatedproduct')}`);
                lines.push(`${ind(4)}${tag('x455', esc(rp.relation_code))}`);
                lines.push(`${ind(4)}${open('productidentifier')}`);
                lines.push(`${ind(5)}${tag('b221', '15')}`);
                lines.push(`${ind(5)}${tag('b244', esc(rp.related_isbn))}`);
                lines.push(`${ind(4)}${close('productidentifier')}`);
                lines.push(`${ind(3)}${close('relatedproduct')}`);
            }
            lines.push(`${ind(2)}${close('relatedmaterial')}`);
        }

        // Product supply — Fix #2/#3/#7/#8
        if (prices.length > 0) {
            const warnings = validatePriceIntervals(prices);
            if (warnings.length > 0) {
                for (const w of warnings) lines.push(`<!-- WARNING: ${esc(w)} -->`);
            }

            lines.push(`${ind(2)}${open('productsupply')}`);
            lines.push(`${ind(3)}${open('supplydetail')}`);

            // Fix #2: Supplier with role/identifier from settings
            const supplierRole = settings.supplier_role || '01';
            const supplierName = settings.supplier_name || pubName;
            lines.push(`${ind(4)}${open('supplier')}`);
            lines.push(`${ind(5)}${tag('j292', esc(supplierRole))}`);
            if (settings.supplier_id_value) {
                lines.push(`${ind(5)}${open('supplieridentifier')}`);
                lines.push(`${ind(6)}${tag('j345', esc(settings.supplier_id_type || '01'))}`);
                lines.push(`${ind(6)}${tag('b244', esc(settings.supplier_id_value))}`);
                lines.push(`${ind(5)}${close('supplieridentifier')}`);
            }
            if (supplierName) lines.push(`${ind(5)}${tag('j137', esc(supplierName))}`);
            lines.push(`${ind(4)}${close('supplier')}`);

            // Fix #3: configurable availability
            const availability = resolveProductAvailability(book);
            lines.push(`${ind(4)}${tag('j396', esc(availability))}`);

            if (book.publishing_date) {
                lines.push(`${ind(4)}${open('supplydate')}`);
                lines.push(`${ind(5)}${tag('x461', '08')}`);
                lines.push(`${ind(5)}${tag('b306', esc(book.publishing_date))}`);
                lines.push(`${ind(4)}${close('supplydate')}`);
            }

            // Fix #8: free books
            for (const p of prices) {
                lines.push(`${ind(4)}${open('price')}`);
                lines.push(`${ind(5)}${tag('x462', esc(p.price_type))}`);
                if (parseFloat(p.amount) === 0) {
                    lines.push(`${ind(5)}${tag('j151', '0.00')}`);
                    lines.push(`${ind(5)}${tag('x469', '01')}`);
                } else {
                    lines.push(`${ind(5)}${tag('j151', String(p.amount))}`);
                }
                lines.push(`${ind(5)}${tag('j152', esc(p.currency_code))}`);
                if (p.territory) {
                    lines.push(`${ind(5)}${open('territory')}`);
                    lines.push(`${ind(6)}${tag('x449', esc(p.territory))}`);
                    lines.push(`${ind(5)}${close('territory')}`);
                }
                if (p.start_date) {
                    lines.push(`${ind(5)}${open('pricedate')}`);
                    lines.push(`${ind(6)}${tag('x476', '14')}`);
                    lines.push(`${ind(6)}${tag('b306', esc(p.start_date))}`);
                    lines.push(`${ind(5)}${close('pricedate')}`);
                }
                if (p.end_date) {
                    lines.push(`${ind(5)}${open('pricedate')}`);
                    lines.push(`${ind(6)}${tag('x476', '15')}`);
                    lines.push(`${ind(6)}${tag('b306', esc(p.end_date))}`);
                    lines.push(`${ind(5)}${close('pricedate')}`);
                }
                lines.push(`${ind(4)}${close('price')}`);
            }

            lines.push(`${ind(3)}${close('supplydetail')}`);
            lines.push(`${ind(2)}${close('productsupply')}`);
        }

        lines.push(`${ind(1)}${close('product')}`);
    }

    lines.push(`</${rootTag}>`);
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
