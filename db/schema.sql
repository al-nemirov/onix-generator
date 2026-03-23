-- ONIX Generator — SQLite Schema
-- Based on ONIX 3.0 / Bookwire E-Book Specification v1.0

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- Publisher / Sender settings (singleton, one row)
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    sender_name     TEXT NOT NULL DEFAULT '',
    contact_name    TEXT NOT NULL DEFAULT '',
    email           TEXT NOT NULL DEFAULT '',
    default_language TEXT NOT NULL DEFAULT 'eng',       -- ISO 639-2/B
    publisher_name  TEXT NOT NULL DEFAULT '',
    publisher_city  TEXT NOT NULL DEFAULT '',
    publisher_country TEXT NOT NULL DEFAULT '',          -- ISO 3166-1 alpha-2
    default_currency TEXT NOT NULL DEFAULT 'EUR',       -- ISO 4217
    default_drm     TEXT NOT NULL DEFAULT '02',         -- 00=none, 01=Adobe DRM, 02=watermark, 03=DRM
    default_territory TEXT NOT NULL DEFAULT 'WORLD',
    default_price_type TEXT NOT NULL DEFAULT '42',      -- 02=RRP, 04=fixed, 42=agency
    message_note    TEXT NOT NULL DEFAULT '-',            -- m183 MessageNote (Bookwire: '-' by default)
    -- Supplier / Distributor (supplydetail block)
    supplier_role   TEXT NOT NULL DEFAULT '06',          -- j292: 01=publisher, 06=distributor
    supplier_name   TEXT NOT NULL DEFAULT '',             -- j137: e.g. 'Bookwire' (falls back to publisher_name)
    supplier_id_type TEXT NOT NULL DEFAULT '01',          -- j345: 01=proprietary
    supplier_id_value TEXT NOT NULL DEFAULT '',           -- b244: e.g. 'Bookwire'
    -- Default epub usage constraint
    default_epub_usage_type   TEXT NOT NULL DEFAULT '',   -- e.g. '06' printing
    default_epub_usage_status TEXT NOT NULL DEFAULT '01', -- 01=permitted, 02=prohibited
    onix_format     TEXT NOT NULL DEFAULT 'short',      -- 'short' or 'reference'
    theme           TEXT NOT NULL DEFAULT 'light',      -- 'light' or 'dark'
    ui_language     TEXT NOT NULL DEFAULT 'en',         -- en|es|de|ru
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO settings (id) VALUES (1);

-- ============================================================
-- Books (one row = one ONIX <product>)
-- ============================================================
CREATE TABLE IF NOT EXISTS books (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Identifiers
    isbn                TEXT NOT NULL DEFAULT '',                -- ISBN-13
    internal_ref        TEXT NOT NULL DEFAULT '',                -- RecordReference (auto-generated if empty)
    order_number        TEXT NOT NULL DEFAULT '',                -- Internal order number (ProductIDType 01)
    -- Notification
    notification_type   TEXT NOT NULL DEFAULT '03',              -- 03=confirmed, 05=takedown
    -- Product form (EPUB only)
    product_form        TEXT NOT NULL DEFAULT 'ED',              -- ED=Digital download
    product_form_detail TEXT NOT NULL DEFAULT 'E101',            -- E101=EPUB reflow, E101+E201=EPUB FXL
    primary_content_type TEXT NOT NULL DEFAULT '10',             -- 10=text
    drm                 TEXT NOT NULL DEFAULT '',                -- inherits from settings if empty
    epub_usage_type     TEXT NOT NULL DEFAULT '',                -- e.g. '06' for printing
    epub_usage_status   TEXT NOT NULL DEFAULT '',                -- e.g. '01' for permitted
    -- Title
    title               TEXT NOT NULL DEFAULT '',
    subtitle            TEXT NOT NULL DEFAULT '',
    -- Series
    series_name         TEXT NOT NULL DEFAULT '',
    series_collection_type TEXT NOT NULL DEFAULT '10',           -- 10=Publisher collection
    part_number         TEXT NOT NULL DEFAULT '',
    -- Edition
    edition_number      TEXT NOT NULL DEFAULT '',
    edition_statement   TEXT NOT NULL DEFAULT '',
    -- Language
    language_code       TEXT NOT NULL DEFAULT '',                -- ISO 639-2/B (inherits from settings)
    original_language   TEXT NOT NULL DEFAULT '',                -- for translations (LanguageRole 01 vs 02)
    -- Extent / Pages
    page_count          INTEGER,                                -- ExtentType 08 + 11
    -- Audience
    audience_range_qualifier TEXT NOT NULL DEFAULT '17',         -- 17=interest age, 18=reading age
    audience_age_from   INTEGER,
    audience_age_to     INTEGER,
    -- Collateral / Description
    description         TEXT NOT NULL DEFAULT '',                -- TextType 03
    description_format  TEXT NOT NULL DEFAULT 'text',            -- 'text' or 'xhtml'
    biography           TEXT NOT NULL DEFAULT '',                -- TextType 12
    toc                 TEXT NOT NULL DEFAULT '',                -- TextType 04
    -- Publishing
    publisher_name      TEXT NOT NULL DEFAULT '',                -- inherits from settings if empty
    publisher_city      TEXT NOT NULL DEFAULT '',
    publisher_country   TEXT NOT NULL DEFAULT '',
    publishing_status   TEXT NOT NULL DEFAULT '04',              -- 04=active
    publishing_date     TEXT NOT NULL DEFAULT '',                -- YYYYMMDD, DateRole 01
    print_pub_date      TEXT NOT NULL DEFAULT '',                -- DateRole 19
    announcement_date   TEXT NOT NULL DEFAULT '',                -- DateRole 09
    -- Supply
    product_availability TEXT NOT NULL DEFAULT '20',             -- j396: 20=available, 01/30/40/46=takedown
    -- Cover & content file
    cover_filename      TEXT NOT NULL DEFAULT '',                -- e.g. 9781234567890.jpg
    content_filename    TEXT NOT NULL DEFAULT '',                -- e.g. 9781234567890.epub
    -- Metadata
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_books_isbn ON books(isbn);
CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);

-- ============================================================
-- Contributors (authors, editors, translators, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS contributors (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id         INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    sequence_number INTEGER NOT NULL DEFAULT 1,
    -- ONIX Code List 17
    contributor_role TEXT NOT NULL DEFAULT 'A01',        -- A01=Author, B01=Editor, B06=Translator, etc.
    -- Person name (for individuals)
    person_name     TEXT NOT NULL DEFAULT '',            -- "Jane Doe"
    person_name_inverted TEXT NOT NULL DEFAULT '',       -- "Doe, Jane"
    -- Complex name parts (optional)
    titles_before   TEXT NOT NULL DEFAULT '',            -- "Dr."
    names_before_key TEXT NOT NULL DEFAULT '',           -- "Jane"
    prefix_to_key   TEXT NOT NULL DEFAULT '',            -- "von"
    key_names       TEXT NOT NULL DEFAULT '',            -- "Doe"
    names_after_key TEXT NOT NULL DEFAULT '',            -- "Jr."
    -- Corporate name (for organizations)
    corporate_name  TEXT NOT NULL DEFAULT '',
    -- Bio (alternative to book.biography)
    biographical_note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_contributors_book ON contributors(book_id);

-- ============================================================
-- Subjects (BISAC, Thema, WGS, keywords)
-- ============================================================
CREATE TABLE IF NOT EXISTS subjects (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id         INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    -- SubjectSchemeIdentifier: 10=BISAC, 20=keyword, 26=WGS, 93=Thema
    scheme_id       TEXT NOT NULL DEFAULT '10',
    scheme_version  TEXT NOT NULL DEFAULT '',            -- e.g. '2017' for BISAC, '1.0' for Thema
    subject_code    TEXT NOT NULL DEFAULT '',            -- e.g. 'FIC004000'
    subject_text    TEXT NOT NULL DEFAULT '',            -- for keywords (scheme_id=20): SubjectHeadingText
    is_main         INTEGER NOT NULL DEFAULT 0           -- 1 = MainSubject
);

CREATE INDEX IF NOT EXISTS idx_subjects_book ON subjects(book_id);

-- ============================================================
-- Prices
-- ============================================================
CREATE TABLE IF NOT EXISTS prices (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id         INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    price_type      TEXT NOT NULL DEFAULT '42',          -- 02=RRP, 04=fixed, 42=agency
    amount          REAL NOT NULL DEFAULT 0,             -- PriceAmount (incl. VAT)
    currency_code   TEXT NOT NULL DEFAULT 'EUR',         -- ISO 4217
    territory       TEXT NOT NULL DEFAULT '',             -- country codes or empty for default
    -- Future prices (optional date range)
    start_date      TEXT NOT NULL DEFAULT '',             -- YYYYMMDD, PriceDateRole 14
    end_date        TEXT NOT NULL DEFAULT ''              -- YYYYMMDD, PriceDateRole 15
);

CREATE INDEX IF NOT EXISTS idx_prices_book ON prices(book_id);

-- ============================================================
-- Sales rights & restrictions
-- ============================================================
CREATE TABLE IF NOT EXISTS sales_rights (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id         INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    -- SalesRightsType: 02=for sale, 03=not for sale
    rights_type     TEXT NOT NULL DEFAULT '02',
    -- Territory: either countries (space-separated ISO codes) or region
    countries       TEXT NOT NULL DEFAULT '',             -- e.g. 'DE AT CH'
    regions         TEXT NOT NULL DEFAULT '',             -- e.g. 'WORLD'
    -- ROW (rest of world) sales rights
    row_rights_type TEXT NOT NULL DEFAULT ''              -- for exclusions: usually '02'
);

CREATE INDEX IF NOT EXISTS idx_sales_rights_book ON sales_rights(book_id);

-- ============================================================
-- Sales restrictions (library, subscription, freemium, shop control)
-- ============================================================
CREATE TABLE IF NOT EXISTS sales_restrictions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sales_right_id  INTEGER NOT NULL REFERENCES sales_rights(id) ON DELETE CASCADE,
    -- SalesRestrictionType: 00+FREEMIUM, 04=only shops, 09=no library, 11=exclude shops, 12=no subscription
    restriction_type TEXT NOT NULL DEFAULT '',
    restriction_note TEXT NOT NULL DEFAULT '',            -- e.g. 'FREEMIUM' for type 00
    -- Shop outlet (for types 04 and 11)
    outlet_id_type  TEXT NOT NULL DEFAULT '',             -- '01' = proprietary
    outlet_id_value TEXT NOT NULL DEFAULT '',             -- Shop ID e.g. 'MYAUL'
    outlet_name     TEXT NOT NULL DEFAULT ''              -- Shop name e.g. 'My Audiobook Library'
);

CREATE INDEX IF NOT EXISTS idx_sales_restrictions_right ON sales_restrictions(sales_right_id);

-- ============================================================
-- Related products
-- ============================================================
CREATE TABLE IF NOT EXISTS related_products (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id         INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    relation_code   TEXT NOT NULL DEFAULT '06',          -- 06=alternative format, 23=similar product
    related_isbn    TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_related_book ON related_products(book_id);

-- ============================================================
-- Reviews (TextType 06)
-- ============================================================
CREATE TABLE IF NOT EXISTS reviews (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id         INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    review_text     TEXT NOT NULL DEFAULT '',
    text_author     TEXT NOT NULL DEFAULT '',             -- reviewer name
    source_title    TEXT NOT NULL DEFAULT '',             -- publication name
    review_date     TEXT NOT NULL DEFAULT ''              -- YYYYMMDD
);

CREATE INDEX IF NOT EXISTS idx_reviews_book ON reviews(book_id);

-- ============================================================
-- Full-text search (FTS5)
-- ============================================================
CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
    isbn, title, subtitle, description, biography,
    content='books',
    content_rowid='id'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS books_ai AFTER INSERT ON books BEGIN
    INSERT INTO books_fts(rowid, isbn, title, subtitle, description, biography)
    VALUES (new.id, new.isbn, new.title, new.subtitle, new.description, new.biography);
END;

CREATE TRIGGER IF NOT EXISTS books_ad AFTER DELETE ON books BEGIN
    INSERT INTO books_fts(books_fts, rowid, isbn, title, subtitle, description, biography)
    VALUES ('delete', old.id, old.isbn, old.title, old.subtitle, old.description, old.biography);
END;

CREATE TRIGGER IF NOT EXISTS books_au AFTER UPDATE ON books BEGIN
    INSERT INTO books_fts(books_fts, rowid, isbn, title, subtitle, description, biography)
    VALUES ('delete', old.id, old.isbn, old.title, old.subtitle, old.description, old.biography);
    INSERT INTO books_fts(rowid, isbn, title, subtitle, description, biography)
    VALUES (new.id, new.isbn, new.title, new.subtitle, new.description, new.biography);
END;
