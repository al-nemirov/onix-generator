/**
 * ONIX Generator - lightweight i18n runtime
 */
(function () {
    const FALLBACK_LANG = 'en';
    const SUPPORTED = ['en', 'es', 'de', 'ru'];
    let current = FALLBACK_LANG;
    let messages = {};

    function interpolate(template, vars = {}) {
        return String(template).replace(/\{(\w+)\}/g, (_, key) => (vars[key] ?? ''));
    }

    async function loadMessages(lang) {
        const safeLang = SUPPORTED.includes(lang) ? lang : FALLBACK_LANG;
        const [fallback, selected] = await Promise.all([
            fetch(`/i18n/${FALLBACK_LANG}.json`).then(r => r.json()).catch(() => ({})),
            safeLang === FALLBACK_LANG
                ? Promise.resolve({})
                : fetch(`/i18n/${safeLang}.json`).then(r => r.json()).catch(() => ({})),
        ]);
        messages = { ...fallback, ...selected };
        current = safeLang;
        document.documentElement.lang = safeLang;
    }

    function t(key, vars) {
        const value = messages[key] ?? key;
        return interpolate(value, vars);
    }

    function applyStaticTranslations() {
        document.querySelectorAll('[data-i18n]').forEach((el) => {
            const key = el.getAttribute('data-i18n');
            if (!key) return;
            el.textContent = t(key);
        });
        document.querySelectorAll('[data-i18n-html]').forEach((el) => {
            const key = el.getAttribute('data-i18n-html');
            if (!key) return;
            el.innerHTML = t(key);
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (!key) return;
            el.setAttribute('placeholder', t(key));
        });
        document.querySelectorAll('[data-i18n-title]').forEach((el) => {
            const key = el.getAttribute('data-i18n-title');
            if (!key) return;
            el.setAttribute('title', t(key));
        });

        const map = [
            ['#btn-settings', 'ui.settingsButton'],
            ['#btn-add', 'ui.addBook'],
            ['#btn-clone', 'ui.clone'],
            ['#btn-delete', 'ui.delete'],
            ['#btn-bulk', 'ui.bulkEdit'],
            ['#btn-import', 'ui.import'],
            ['#btn-export', 'ui.export'],
            ['#btn-generate', 'ui.generateXml'],
            ['#btn-preview', 'ui.preview'],
            ['#search-input', 'ui.search', 'placeholder'],
            ['#footer-status', 'ui.ready'],
            ['#btn-save-settings', 'ui.saveSettings'],
            ['#btn-backup', 'ui.downloadBackup'],
            ['#btn-apply-import', 'ui.importBooks'],
            ['#btn-apply-bulk', 'ui.applyToSelected'],
            ['#btn-copy-xml', 'ui.copy'],
            ['#btn-download-xml', 'ui.download'],
        ];
        for (const [selector, key, attr] of map) {
            const el = document.querySelector(selector);
            if (!el) continue;
            if (attr) el.setAttribute(attr, t(key));
            else el.textContent = t(key);
        }

        const htmlMap = [
            ['title', 'ui.appTitle'],
            ['.header-logo', 'ui.headerLogoHtml', 'html'],
            ['.col-isbn', 'ui.colIsbnHtml', 'html'],
            ['.col-title', 'ui.colTitleHtml', 'html'],
            ['.col-subtitle', 'ui.colSubtitle'],
            ['.col-author', 'ui.colAuthor'],
            ['.col-bisac', 'ui.colBisac'],
            ['.col-thema', 'ui.colThema'],
            ['.col-wgs', 'ui.colWgs'],
            ['.col-lang', 'ui.colLang'],
            ['.col-price', 'ui.colPrice'],
            ['.col-territory', 'ui.colTerritory'],
            ['.col-status', 'ui.colStatus'],
            ['#empty-state p', 'ui.emptyState'],
            ['#empty-state .btn-primary', 'ui.addBook'],
            ['#empty-state .btn:not(.btn-primary)', 'ui.import'],
            ['#btn-save-detail', 'ui.save'],
            ['[data-tab="basic"]', 'ui.tabBasic'],
            ['[data-tab="contributors"]', 'ui.tabContributors'],
            ['[data-tab="subjects"]', 'ui.tabSubjects'],
            ['[data-tab="description"]', 'ui.tabDescription'],
            ['[data-tab="publishing"]', 'ui.tabPublishing'],
            ['[data-tab="pricing"]', 'ui.tabPricing'],
            ['[data-tab="rights"]', 'ui.tabRights'],
            ['[data-tab="related"]', 'ui.tabRelated'],
            ['#settings-modal h2', 'ui.publisherSettings'],
            ['#settings-modal .modal-footer .btn', 'ui.cancel'],
            ['#import-modal h2', 'ui.importBooks'],
            ['#import-modal #import-dropzone p:first-child', 'ui.dragDrop'],
            ['#import-modal #import-dropzone p:last-child', 'ui.clickBrowse'],
            ['#import-modal .import-mapping h3', 'ui.columnMapping'],
            ['#export-modal h2', 'ui.export'],
            ['#bulk-modal h2', 'ui.bulkEdit'],
            ['#bulk-modal .modal-footer .btn', 'ui.cancel'],
            ['#xml-preview .xml-preview-header > span', 'ui.xmlPreview'],
            ['#context-menu [data-action="edit"]', 'ui.ctxEdit'],
            ['#context-menu [data-action="copy-cell"]', 'ui.ctxCopyCell'],
            ['#context-menu [data-action="paste-cell"]', 'ui.ctxPasteSelected'],
            ['#context-menu [data-action="fill-down"]', 'ui.ctxFillDown'],
            ['#context-menu [data-action="clone"]', 'ui.ctxCloneBook'],
            ['#context-menu [data-action="preview-one"]', 'ui.ctxPreviewXml'],
            ['#context-menu [data-action="delete"]', 'ui.ctxDelete'],
        ];
        for (const [selector, key, mode] of htmlMap) {
            const el = document.querySelector(selector);
            if (!el) continue;
            const value = t(key);
            if (mode === 'html') el.innerHTML = value;
            else el.textContent = value;
        }

        // Fallback mass replacement for remaining static labels/text.
        const textMap = {
            'Publisher settings': 'ui.settingsButton',
            'Clone selected books': 'ui.clone',
            'Delete selected books': 'ui.delete',
            'Bulk edit selected books': 'ui.bulkEdit',
            'Import XLSX/CSV': 'ui.import',
            'Export data': 'ui.export',
            'Preview XML': 'ui.preview',
            'Book Details': 'ui.bookDetails',
            'Basic Info': 'ui.tabBasic',
            'Contributors': 'ui.tabContributors',
            'Subjects & Keywords': 'ui.tabSubjects',
            'Description': 'ui.description',
            'Publishing': 'ui.tabPublishing',
            'Pricing': 'ui.tabPricing',
            'Rights & Sales': 'ui.tabRights',
            'Related & Resources': 'ui.tabRelated',
            'Sender Name': 'ui.senderName',
            'Contact Name': 'ui.contactName',
            'Email': 'ui.email',
            'Default Language': 'ui.defaultLanguage',
            'Default Currency': 'ui.defaultCurrency',
            'Default DRM': 'ui.defaultDrm',
            'Default Price Type': 'ui.defaultPriceType',
            'Default Territory': 'ui.defaultTerritory',
            'Interface Language': 'ui.interfaceLanguage',
            'Security': 'ui.security',
            'Bookwire / Supplier': 'ui.bookwireSupplier',
            'Supplier Role': 'ui.supplierRole',
            'Supplier Name': 'ui.supplierName',
            'Supplier ID Value': 'ui.supplierIdValue',
            'Tag Format': 'ui.tagFormat',
            'Language': 'ui.language',
            'Publishing Status': 'ui.colStatus',
            'Cancel': 'ui.cancel'
            ,'ISBN-13': 'ui.isbn13'
            ,'Internal Order #': 'ui.internalOrder'
            ,'Notification Type': 'ui.notificationType'
            ,'EPUB Format': 'ui.epubFormat'
            ,'EPUB Reflowable': 'ui.epubReflowable'
            ,'EPUB Fixed Layout': 'ui.epubFixed'
            ,'DRM / Copy Protection': 'ui.drmProtection'
            ,'Title': 'ui.colTitle'
            ,'Subtitle': 'ui.colSubtitle'
            ,'Series Name': 'ui.seriesName'
            ,'Part Number': 'ui.partNumber'
            ,'Edition Number': 'ui.editionNumber'
            ,'Edition Statement': 'ui.editionStatement'
            ,'Original Language': 'ui.originalLanguage'
            ,'Page Count': 'ui.pageCount'
            ,'Age Range: From': 'ui.ageFrom'
            ,'Age Range: To': 'ui.ageTo'
            ,'Subject Classifications': 'ui.subjectClassifications'
            ,'Keywords (comma-separated)': 'ui.keywordsComma'
            ,'Description (min. 50 characters)': 'ui.descriptionMin'
            ,'Author Biography': 'ui.authorBio'
            ,'Table of Contents': 'ui.tableOfContents'
            ,'Reviews': 'ui.reviews'
            ,'Publishing Date': 'ui.publishingDate'
            ,'Print Edition Date': 'ui.printEditionDate'
            ,'Announcement Date': 'ui.announcementDate'
            ,'Cover Image Filename': 'ui.coverFilename'
            ,'Content File (EPUB)': 'ui.contentFile'
            ,'Related Products': 'ui.relatedProducts'
            ,'Message Note (m183)': 'ui.messageNote'
            ,'ONIX Format': 'ui.onixFormat'
            ,'Import Books': 'ui.importBooks'
            ,'Export as XLSX (Excel)': 'ui.exportXlsx'
            ,'Export as CSV': 'ui.exportCsv'
            ,'Export as JSON': 'ui.exportJson'
            ,'Apply to Selected': 'ui.applyToSelected'
            ,'Set Price (amount + currency)': 'ui.setPrice'
            ,'Set Sales Territory': 'ui.setSalesTerritory'
            ,'Add Subject Code': 'ui.addSubjectCode'
            ,'XML Preview': 'ui.xmlPreview'
            ,'No selection': 'status.noSelection'
            ,'Ready': 'ui.ready'
            ,'Espanol': 'ui.langSpanish'
            ,'Deutsch': 'ui.langGerman'
            ,'Russian': 'ui.langRussian'
            ,'English': 'ui.langEnglish'
            ,'01 — Publisher to retailers': 'ui.supplierRole01'
            ,'06 — Publisher\'s distributor to retailers': 'ui.supplierRole06'
            ,'07 — Wholesaler to retailers': 'ui.supplierRole07'
            ,'Short tags (x298, b203…)': 'ui.shortTags'
            ,'Reference tags (SenderName, TitleText…)': 'ui.referenceTags'
            ,'BISAC': 'ui.colBisac'
            ,'Thema': 'ui.colThema'
            ,'WGS': 'ui.colWgs'
            ,'— Scheme —': 'ui.scheme'
        };
        const placeholderMap = {
            'Search by title, author, ISBN...': 'ui.search',
            'email@example.com': 'ui.emailPlaceholder',
            'Company name': 'ui.companyName',
            'Contact person': 'ui.contactPerson',
            'WORLD or DE AT CH': 'ui.worldOrCountries',
            'ogen_...': 'ui.apiKeyPlaceholder',
            '-': 'ui.dash'
        };

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);
        for (const node of textNodes) {
            const raw = node.nodeValue;
            const trimmed = raw && raw.trim();
            if (!trimmed || !textMap[trimmed]) continue;
            node.nodeValue = raw.replace(trimmed, t(textMap[trimmed]));
        }
        document.querySelectorAll('[placeholder]').forEach((el) => {
            const ph = el.getAttribute('placeholder');
            if (ph && placeholderMap[ph]) el.setAttribute('placeholder', t(placeholderMap[ph]));
        });
        document.querySelectorAll('[title]').forEach((el) => {
            const title = el.getAttribute('title');
            if (title && textMap[title]) el.setAttribute('title', t(textMap[title]));
        });
    }

    window.I18N = {
        async init(lang) {
            await loadMessages(lang || FALLBACK_LANG);
            applyStaticTranslations();
        },
        async setLanguage(lang) {
            await loadMessages(lang);
            applyStaticTranslations();
            return current;
        },
        getLanguage() {
            return current;
        },
        t,
    };
})();
