/**
 * ONIX Generator — Main Application Controller
 */

// ============================================================
// State
// ============================================================
let books = [];
let selectedIds = new Set();
let currentBookId = null;
let settings = {};
let sortCol = 'id';
let sortOrder = 'asc';
let clipboard = { col: null, value: null };
let searchTimeout = null;
let activeCell = null;
let totalCount = 0;
let currentPage = 1;
let pageSize = 100;
let currentSearch = '';
let currentFilters = { language: '', status: '', drm: '' };
let cachedStats = { books: 0 };
let lastClickedBookId = null;
const MAX_SELECT_ALL_IDS = 50000;
const tr = (key, vars = {}) => (window.I18N ? window.I18N.t(key, vars) : key);
const TABLE_FIELD_MAP = {
    isbn: 'isbn',
    title: 'title',
    subtitle: 'subtitle',
    language_code: 'language_code',
};

/** Column order must match table body cells with data-col (left → right). */
const TABLE_PASTE_COLS = ['isbn', 'title', 'subtitle', 'authors', 'bisac_main', 'thema_main', 'wgs_main', 'language_code', 'price', 'territory', 'publishing_status'];

const BOOK_SCALAR_KEYS = [
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
    'product_availability',
];

// ============================================================
// Init
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        settings = await API.getSettings();
    } catch (e) {
        alert(tr('error.api', { message: e.message }));
        return;
    }
    await I18N.init(settings.ui_language || 'en');

    // Load codelists
    await Codelists.load();

    applyTheme(settings.theme || 'light');

    // Populate dropdowns
    populateDropdowns();
    populateFilterDropdowns();

    // Load books
    await loadBooks();

    // Bind events
    bindEvents();

    updateSortArrows();
    document.getElementById('s-api-key').value = API.getApiKey();
});

// ============================================================
// Theme
// ============================================================
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
}

// ============================================================
// Populate dropdowns with codelists
// ============================================================
function populateDropdowns() {
    // Settings modal
    Codelists.populateSelect(document.getElementById('s-default-language'), Codelists.languages, { selectedValue: settings.default_language });
    Codelists.populateSelect(document.getElementById('s-default-currency'), Codelists.currencies, { selectedValue: settings.default_currency, addEmpty: false });
    Codelists.populateSelect(document.getElementById('s-publisher-country'), Codelists.countries, { selectedValue: settings.publisher_country });
    Codelists.populateOnixSelect(document.getElementById('s-default-drm'), 'drmTypes', settings.default_drm);
    Codelists.populateOnixSelect(document.getElementById('s-default-price-type'), 'priceTypes', settings.default_price_type);

    // Detail form
    Codelists.populateSelect(document.getElementById('f-language'), Codelists.languages, {});
    Codelists.populateSelect(document.getElementById('f-original-language'), Codelists.languages, { placeholder: tr('ui.noneTranslation') });
    Codelists.populateSelect(document.getElementById('f-publisher-country'), Codelists.countries, {});
    Codelists.populateOnixSelect(document.getElementById('f-notification-type'), 'notificationTypes', '03');
    Codelists.populateOnixSelect(document.getElementById('f-drm'), 'drmTypes', settings.default_drm);
    Codelists.populateOnixSelect(document.getElementById('f-publishing-status'), 'publishingStatuses', '04');

    // Bulk edit modal
    Codelists.populateSelect(document.getElementById('b-language'), Codelists.languages, { placeholder: tr('ui.noChange') });
    Codelists.populateOnixSelect(document.getElementById('b-drm'), 'drmTypes');
    document.getElementById('b-drm').insertAdjacentHTML('afterbegin', `<option value="">${tr('ui.noChange')}</option>`);
    Codelists.populateOnixSelect(document.getElementById('b-status'), 'publishingStatuses');
    document.getElementById('b-status').insertAdjacentHTML('afterbegin', `<option value="">${tr('ui.noChange')}</option>`);
    Codelists.populateSelect(document.getElementById('b-currency'), Codelists.currencies, { addEmpty: false, selectedValue: settings.default_currency });

    // Fill settings form values
    document.getElementById('s-sender-name').value = settings.sender_name || '';
    document.getElementById('s-contact-name').value = settings.contact_name || '';
    document.getElementById('s-email').value = settings.email || '';
    document.getElementById('s-publisher-name').value = settings.publisher_name || '';
    document.getElementById('s-publisher-city').value = settings.publisher_city || '';
    document.getElementById('s-default-territory').value = settings.default_territory || 'WORLD';
    // Bookwire / Supplier settings
    document.getElementById('s-message-note').value = settings.message_note || '-';
    document.getElementById('s-supplier-role').value = settings.supplier_role || '06';
    document.getElementById('s-supplier-name').value = settings.supplier_name || '';
    document.getElementById('s-supplier-id-value').value = settings.supplier_id_value || '';
    document.getElementById('s-onix-format').value = settings.onix_format || 'short';
    document.getElementById('s-ui-language').value = settings.ui_language || 'en';
    document.getElementById('s-api-key').value = API.getApiKey();
}

// ============================================================
// Load books from API
// ============================================================
async function loadBooks(search = '') {
    currentSearch = search;
    const params = {
        sort: sortCol,
        order: sortOrder,
        limit: pageSize,
        offset: (currentPage - 1) * pageSize,
    };
    if (search) params.search = search;
    if (currentFilters.language) params.language = currentFilters.language;
    if (currentFilters.status) params.status = currentFilters.status;
    if (currentFilters.drm) params.drm = currentFilters.drm;
    try {
        const result = await API.getBooks(params);
        books = result.books || [];
        totalCount = result.total || 0;
    } catch (e) {
        toast(tr('error.api', { message: e.message }), 'error');
        return;
    }
    renderTable();
    updateEmptyState();
    updateStats();
    updatePagination();
}

// ============================================================
// Render table
// ============================================================
function renderTable() {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';

    for (let i = 0; i < books.length; i++) {
        const b = books[i];
        const tr = document.createElement('tr');
        tr.dataset.id = b.id;
        if (selectedIds.has(b.id)) tr.classList.add('selected');
        if (currentBookId === b.id) tr.classList.add('editing');

        const statusBadge = getStatusBadge(b.publishing_status);

        tr.innerHTML = `
            <td class="col-checkbox"><input type="checkbox" ${selectedIds.has(b.id) ? 'checked' : ''} data-id="${b.id}"></td>
            <td class="col-num">${((currentPage - 1) * pageSize) + i + 1}</td>
            <td class="col-isbn" data-col="isbn">${esc(b.isbn)}</td>
            <td class="col-title" data-col="title" title="${esc(b.title)}">${esc(b.title)}</td>
            <td class="col-subtitle" data-col="subtitle" title="${esc(b.subtitle)}">${esc(b.subtitle || '')}</td>
            <td class="col-author" data-col="authors" title="${esc(b.authors)}">${esc(b.authors || '')}</td>
            <td class="col-bisac" data-col="bisac_main" title="${Codelists.getText(Codelists.bisac, b.bisac_main)}">${esc(b.bisac_main || '')}</td>
            <td class="col-thema" data-col="thema_main" title="${Codelists.getText(Codelists.thema, b.thema_main)}">${esc(b.thema_main || '')}</td>
            <td class="col-wgs" data-col="wgs_main" title="${Codelists.getText(Codelists.wgs, b.wgs_main)}">${esc(b.wgs_main || '')}</td>
            <td class="col-lang" data-col="language_code">${esc(b.language_code || '')}</td>
            <td class="col-price" data-col="price">${b.price != null ? Number(b.price).toFixed(2) : ''} ${esc(b.currency || '')}</td>
            <td class="col-territory" data-col="territory">${esc(b.territory || '')}</td>
            <td class="col-status" data-col="publishing_status">${statusBadge}</td>
        `;

        tbody.appendChild(tr);
    }
    syncSelectAll();
    clearActiveCell();
}

function getStatusBadge(status) {
    switch (status) {
        case '04': return `<span class="badge badge-active">${tr('status.active')}</span>`;
        case '02': return `<span class="badge badge-draft">${tr('status.forthcoming')}</span>`;
        case '05': case '07': case '08': return `<span class="badge badge-deleted">${tr('status.inactive')}</span>`;
        default: return `<span class="badge">${status || '—'}</span>`;
    }
}

function updateEmptyState() {
    const empty = document.getElementById('empty-state');
    const table = document.getElementById('spreadsheet');
    if (books.length === 0) {
        empty.style.display = 'flex';
        table.style.display = 'none';
    } else {
        empty.style.display = 'none';
        table.style.display = '';
    }
}

async function updateStats() {
    const stats = await API.getStats();
    cachedStats = stats;
    document.getElementById('stats').textContent = `${tr('status.books', { count: totalCount })} / ${stats.books}`;
    document.getElementById('selection-info').textContent = selectedIds.size > 0
        ? tr('status.selected', { count: selectedIds.size })
        : tr('status.books', { count: totalCount });
}

// ============================================================
// Bind events
// ============================================================
function bindEvents() {
    // Header
    document.getElementById('btn-theme').addEventListener('click', toggleTheme);
    document.getElementById('btn-settings').addEventListener('click', () => openModal('settings-modal'));

    // Toolbar
    document.getElementById('btn-add').addEventListener('click', addBook);
    document.getElementById('btn-clone').addEventListener('click', cloneSelected);
    document.getElementById('btn-delete').addEventListener('click', deleteSelected);
    document.getElementById('btn-select-all-filter').addEventListener('click', selectAllMatchingFilter);
    document.getElementById('btn-bulk').addEventListener('click', openBulkEdit);
    document.getElementById('btn-import').addEventListener('click', openImportModal);
    document.getElementById('btn-export').addEventListener('click', () => openModal('export-modal'));
    document.getElementById('btn-generate').addEventListener('click', generateXml);
    document.getElementById('btn-preview').addEventListener('click', () => previewXml());

    // Search
    document.getElementById('search-input').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentPage = 1;
            loadBooks(e.target.value);
        }, 220);
    });
    document.getElementById('filter-language').addEventListener('change', (e) => {
        currentFilters.language = e.target.value;
        currentPage = 1;
        loadBooks(currentSearch);
    });
    document.getElementById('filter-status').addEventListener('change', (e) => {
        currentFilters.status = e.target.value;
        currentPage = 1;
        loadBooks(currentSearch);
    });
    document.getElementById('filter-drm').addEventListener('change', (e) => {
        currentFilters.drm = e.target.value;
        currentPage = 1;
        loadBooks(currentSearch);
    });
    document.getElementById('btn-reset-filters').addEventListener('click', () => {
        currentFilters = { language: '', status: '', drm: '' };
        document.getElementById('filter-language').value = '';
        document.getElementById('filter-status').value = '';
        document.getElementById('filter-drm').value = '';
        document.getElementById('search-input').value = '';
        currentSearch = '';
        currentPage = 1;
        loadBooks('');
    });

    // Select all checkbox
    document.getElementById('select-all').addEventListener('change', (e) => {
        if (e.target.checked) {
            books.forEach(b => selectedIds.add(b.id));
        } else {
            selectedIds.clear();
        }
        renderTable();
        updateStats();
    });

    // Table click (row select + detail open)
    document.getElementById('table-body').addEventListener('click', (e) => {
        const tr = e.target.closest('tr');
        if (!tr) return;
        const id = parseInt(tr.dataset.id);
        const clickedCell = e.target.closest('td[data-col]');
        setActiveCell(clickedCell || null);

        // Checkbox click
        if (e.target.type === 'checkbox') {
            if (e.target.checked) selectedIds.add(id);
            else selectedIds.delete(id);
            tr.classList.toggle('selected', selectedIds.has(id));
            lastClickedBookId = id;
            updateStats();
            syncSelectAll();
            return;
        }

        // Shift+click for range select (anchor = last clicked row on this page)
        if (e.shiftKey && lastClickedBookId != null) {
            const allIds = books.map(b => b.id);
            const fromIdx = allIds.indexOf(lastClickedBookId);
            const toIdx = allIds.indexOf(id);
            if (fromIdx >= 0 && toIdx >= 0) {
                const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
                for (let i = start; i <= end; i++) selectedIds.add(allIds[i]);
                renderTable();
                updateStats();
                syncSelectAll();
                return;
            }
        }

        // Ctrl+click for toggle select
        if (e.ctrlKey || e.metaKey) {
            if (selectedIds.has(id)) selectedIds.delete(id);
            else selectedIds.add(id);
            tr.classList.toggle('selected', selectedIds.has(id));
            lastClickedBookId = id;
            updateStats();
            syncSelectAll();
            return;
        }

        // Normal click — open detail panel
        lastClickedBookId = id;
        openDetailPanel(id);
    });

    // Table double-click — inline edit
    document.getElementById('table-body').addEventListener('dblclick', (e) => {
        const td = e.target.closest('td[data-col]');
        if (!td) return;
        startInlineEdit(td);
    });

    // Context menu
    document.getElementById('table-body').addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const tr = e.target.closest('tr');
        if (!tr) return;
        const id = parseInt(tr.dataset.id);
        const td = e.target.closest('td[data-col]');
        if (td) setActiveCell(td);
        if (!selectedIds.has(id)) {
            selectedIds.clear();
            selectedIds.add(id);
            renderTable();
        }
        showContextMenu(e.clientX, e.clientY, id);
    });

    // Context menu actions
    document.getElementById('context-menu').addEventListener('click', (e) => {
        const item = e.target.closest('.context-menu-item');
        if (!item) return;
        handleContextAction(item.dataset.action);
        hideContextMenu();
    });

    // Close context menu on click elsewhere
    document.addEventListener('click', hideContextMenu);

    document.addEventListener('paste', handleDocumentPaste, true);

    // Column sort
    document.querySelectorAll('.spreadsheet th[data-col]').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.col;
            if (sortCol === col) {
                sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                sortCol = col;
                sortOrder = 'asc';
            }
            updateSortArrows();
            currentPage = 1;
            loadBooks(document.getElementById('search-input').value);
        });
    });
    document.getElementById('page-size').addEventListener('change', (e) => {
        pageSize = parseInt(e.target.value) || 100;
        currentPage = 1;
        loadBooks(currentSearch);
    });
    document.getElementById('btn-prev-page').addEventListener('click', () => {
        if (currentPage <= 1) return;
        currentPage -= 1;
        loadBooks(currentSearch);
    });
    document.getElementById('btn-next-page').addEventListener('click', () => {
        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        if (currentPage >= totalPages) return;
        currentPage += 1;
        loadBooks(currentSearch);
    });

    // Detail panel tabs
    document.getElementById('detail-tabs').addEventListener('click', (e) => {
        const tab = e.target.closest('.detail-tab');
        if (!tab) return;
        document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });

    // Detail panel save
    document.getElementById('btn-save-detail').addEventListener('click', saveDetail);

    // Detail panel close
    document.getElementById('btn-close-detail').addEventListener('click', () => {
        document.getElementById('detail-panel').classList.remove('open');
        currentBookId = null;
        renderTable();
    });

    // Settings save
    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

    // Import
    const dropzone = document.getElementById('import-dropzone');
    const fileInput = document.getElementById('import-file');
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files[0]) handleImportFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) handleImportFile(e.target.files[0]);
    });
    document.getElementById('btn-apply-import').addEventListener('click', applyImport);

    // Bulk edit apply
    document.getElementById('btn-apply-bulk').addEventListener('click', applyBulkEdit);

    // XML preview
    document.getElementById('btn-copy-xml').addEventListener('click', () => {
        const text = getRawXml();
        navigator.clipboard.writeText(text).then(() => toast(tr('toast.xmlCopied'), 'success'));
    });
    document.getElementById('btn-download-xml').addEventListener('click', downloadXmlFromPreview);
    document.getElementById('btn-backup').addEventListener('click', downloadBackup);

    // Description character counter
    document.getElementById('f-description').addEventListener('input', (e) => {
        const len = e.target.value.length;
        document.getElementById('desc-counter').textContent = `${tr('status.characters', { count: len })}${len < 50 ? tr('status.minChars') : ''}`;
        document.getElementById('desc-counter').style.color = len < 50 ? 'var(--danger)' : 'var(--text-muted)';
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Delete' && selectedIds.size > 0 && !isEditing()) {
            deleteSelected();
        }
        if (e.key === 'Escape') {
            hideContextMenu();
            document.getElementById('xml-preview').classList.remove('open');
        }
        // Ctrl+C — copy cell
        if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !isEditing()) {
            if (activeCell) {
                clipboard.col = activeCell.dataset.col;
                clipboard.value = activeCell.textContent.trim();
                toast(tr('toast.copiedValue', { value: clipboard.value }), 'info');
            }
        }
    });
}

// ============================================================
// Inline editing
// ============================================================
function startInlineEdit(td) {
    if (td.classList.contains('editing')) return;
    const col = td.dataset.col;
    const field = TABLE_FIELD_MAP[col];
    if (!field) {
        toast(tr('toast.editInDetailPanel'), 'info');
        return;
    }
    const tr = td.closest('tr');
    const bookId = parseInt(tr.dataset.id);
    const oldValue = td.textContent.trim();

    td.classList.add('editing');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = oldValue;
    td.textContent = '';
    td.appendChild(input);
    input.focus();
    input.select();

    const finish = async (save) => {
        td.classList.remove('editing');
        const newValue = input.value.trim();
        td.textContent = newValue;

        if (save && newValue !== oldValue) {
            await API.updateBook(bookId, { [field]: newValue });
            toast(tr('toast.updated'), 'success');
            await loadBooks(currentSearch);
        }
    };

    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); input.value = oldValue; finish(false); }
        if (e.key === 'Tab') {
            e.preventDefault();
            finish(true);
            // Move to next cell
            const nextTd = e.shiftKey ? td.previousElementSibling : td.nextElementSibling;
            if (nextTd && nextTd.dataset.col) {
                setTimeout(() => startInlineEdit(nextTd), 50);
            }
        }
    });
}

function isEditing() {
    return document.querySelector('.spreadsheet td.editing') !== null ||
           document.activeElement.tagName === 'INPUT' ||
           document.activeElement.tagName === 'TEXTAREA' ||
           document.activeElement.tagName === 'SELECT';
}

// ============================================================
// Context menu
// ============================================================
function showContextMenu(x, y, bookId) {
    const menu = document.getElementById('context-menu');
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.classList.add('open');
    menu.dataset.bookId = bookId;
    requestAnimationFrame(() => {
        const r = menu.getBoundingClientRect();
        let nx = r.left;
        let ny = r.top;
        const pad = 6;
        if (r.right > window.innerWidth - pad) nx = window.innerWidth - r.width - pad;
        if (r.bottom > window.innerHeight - pad) ny = window.innerHeight - r.height - pad;
        if (nx < pad) nx = pad;
        if (ny < pad) ny = pad;
        menu.style.left = `${nx}px`;
        menu.style.top = `${ny}px`;
    });
}

function hideContextMenu() {
    document.getElementById('context-menu').classList.remove('open');
}

async function handleContextAction(action) {
    const ids = [...selectedIds];
    switch (action) {
        case 'edit':
            if (ids.length > 0) openDetailPanel(ids[0]);
            break;
        case 'copy-cell': {
            if (activeCell) {
                clipboard.col = activeCell.dataset.col;
                clipboard.value = activeCell.textContent.trim();
                toast(tr('toast.copiedValue', { value: clipboard.value }), 'info');
            }
            break;
        }
        case 'paste-cell':
            if (clipboard.value) pasteToSelected();
            break;
        case 'paste-excel':
            if (navigator.clipboard && navigator.clipboard.readText) {
                navigator.clipboard.readText().then((t) => {
                    if (!activeCell) {
                        toast(tr('toast.pasteSelectCell'), 'info');
                        return;
                    }
                    processPastedPlainText(t);
                }).catch(() => toast(tr('toast.clipboardReadDenied'), 'info'));
            } else {
                toast(tr('toast.clipboardReadDenied'), 'info');
            }
            break;
        case 'fill-down':
            if (clipboard.value) pasteToSelected();
            break;
        case 'clone':
            await cloneSelected();
            break;
        case 'preview-one':
            await previewXml(ids);
            break;
        case 'delete':
            await deleteSelected();
            break;
    }
}

async function pasteToSelected() {
    if (!clipboard.col || !clipboard.value || selectedIds.size === 0) return;
    const field = TABLE_FIELD_MAP[clipboard.col];
    if (field) {
        await API.bulkUpdate([...selectedIds], { [field]: clipboard.value });
        toast(tr('toast.pastedToBooks', { value: clipboard.value, count: selectedIds.size }), 'success');
        await loadBooks(currentSearch);
        return;
    }
    if (TABLE_PASTE_COLS.includes(clipboard.col)) {
        await pasteValueToBookIds([...selectedIds], clipboard.col, clipboard.value);
    }
}

function shouldHandleSpreadsheetPaste() {
    if (!activeCell) return false;
    if (isEditing()) return false;
    const ae = document.activeElement;
    if (ae && ae !== document.body) {
        if (ae.closest('.modal-overlay.open')) return false;
        if (ae.closest('#detail-panel.open')) return false;
        if (ae.matches('#search-input, #filter-language, #filter-status, #filter-drm, #page-size')) return false;
        if (ae.closest('.footer') && ae.matches('select, input, button')) return false;
        if (ae.closest('#settings-modal') && ae.matches('input, textarea, select')) return false;
    }
    return true;
}

function handleDocumentPaste(e) {
    const text = e.clipboardData?.getData('text/plain');
    if (text == null) return;
    if (!shouldHandleSpreadsheetPaste()) return;
    e.preventDefault();
    e.stopPropagation();
    processPastedPlainText(text).catch((err) => {
        toast(tr('toast.pasteFailed', { message: err.message || String(err) }), 'error');
    });
}

async function processPastedPlainText(text) {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const isGrid = normalized.includes('\t') || normalized.includes('\n');
    if (isGrid) {
        await pasteExcelGrid(normalized);
    } else {
        await pasteExcelSingleValue(normalized);
    }
}

function bookToUpdatePayload(book) {
    const out = {};
    for (const k of BOOK_SCALAR_KEYS) {
        const v = book[k];
        out[k] = v === undefined || v === null ? '' : v;
    }
    out.contributors = book.contributors || [];
    out.subjects = book.subjects || [];
    out.prices = (book.prices || []).map((p) => ({
        ...p,
        amount: p.amount != null ? Number(p.amount) : 0,
    }));
    out.sales_rights = (book.sales_rights || []).map((sr) => ({
        ...sr,
        restrictions: sr.restrictions || [],
    }));
    out.related_products = book.related_products || [];
    out.reviews = book.reviews || [];
    return out;
}

function parsePriceCell(s, defaultCurrency) {
    const t = String(s).trim().replace(/\u00a0/g, ' ');
    if (!t) return null;
    let amount = null;
    let currency = (defaultCurrency || 'EUR').toUpperCase();
    const numMatch = t.match(/(\d+(?:[.,]\d+)?)/);
    if (numMatch) amount = parseFloat(numMatch[1].replace(',', '.'));
    const curMatch = t.match(/\b([A-Za-z]{3})\b/);
    if (curMatch) currency = curMatch[1].toUpperCase();
    if (amount == null || Number.isNaN(amount)) return null;
    return { amount, currency };
}

function normalizePublishingStatus(v) {
    const t = String(v).trim();
    if (!t) return null;
    if (/^\d{2}$/.test(t)) return t;
    const lower = t.toLowerCase();
    const map = {
        active: '04',
        forthcoming: '02',
        inactive: '05',
        cancelled: '05',
        canceled: '05',
        deleted: '05',
    };
    if (map[lower]) return map[lower];
    if (lower === tr('status.active').toLowerCase()) return '04';
    if (lower === tr('status.forthcoming').toLowerCase()) return '02';
    if (lower === tr('status.inactive').toLowerCase()) return '05';
    return null;
}

function setMainSubject(book, schemeId, version, code) {
    const v = String(code).trim();
    const subs = book.subjects || [];
    if (!v) {
        book.subjects = subs.filter((s) => !(String(s.scheme_id) === schemeId && Number(s.is_main) === 1));
        return;
    }
    const others = subs.filter((s) => !(String(s.scheme_id) === schemeId && Number(s.is_main) === 1));
    book.subjects = [
        ...others,
        {
            scheme_id: schemeId,
            scheme_version: version,
            subject_code: v,
            subject_text: '',
            is_main: 1,
        },
    ];
}

function setAuthorA01(book, v) {
    const rest = (book.contributors || []).filter((c) => c.contributor_role !== 'A01');
    if (!v) {
        book.contributors = rest.map((c, i) => ({ ...c, sequence_number: i + 1 }));
        return;
    }
    const a01 = {
        sequence_number: 1,
        contributor_role: 'A01',
        person_name: v,
        person_name_inverted: '',
        titles_before: '',
        names_before_key: '',
        prefix_to_key: '',
        key_names: '',
        names_after_key: '',
        corporate_name: '',
        biographical_note: '',
    };
    book.contributors = [a01, ...rest.map((c, i) => ({ ...c, sequence_number: i + 2 }))];
}

function setDefaultPrice(book, amount, currency) {
    const list = book.prices || [];
    const def = list.find((p) => (!p.start_date || p.start_date === '') && (!p.end_date || p.end_date === ''));
    const rest = list.filter((p) => p !== def);
    const row = def
        ? { ...def, amount: Number(amount), currency_code: currency }
        : {
              price_type: settings.default_price_type || '42',
              amount: Number(amount),
              currency_code: currency,
              territory: '',
              start_date: '',
              end_date: '',
          };
    book.prices = [row, ...rest];
}

function setPrimaryTerritory(book, v) {
    const raw = String(v).trim();
    const srs = book.sales_rights || [];
    if (srs.length === 0) {
        book.sales_rights = [{ rights_type: '02', countries: '', regions: raw, row_rights_type: '', restrictions: [] }];
        return;
    }
    const sr0 = { ...srs[0], restrictions: srs[0].restrictions || [] };
    const compact = raw.replace(/\s+/g, ' ').trim();
    if (/^([A-Z]{2})(\s+[A-Z]{2})*$/i.test(compact)) {
        sr0.countries = compact.toUpperCase();
        sr0.regions = '';
    } else {
        sr0.regions = raw;
        sr0.countries = '';
    }
    book.sales_rights = [sr0, ...srs.slice(1)];
}

function applyPastedCellToBook(book, col, raw) {
    if (raw === undefined || raw === null) return;
    const v = String(raw).trim();
    switch (col) {
        case 'isbn':
            book.isbn = v.replace(/[\s-]/g, '');
            break;
        case 'title':
            book.title = v;
            break;
        case 'subtitle':
            book.subtitle = v;
            break;
        case 'language_code': {
            if (!v) {
                book.language_code = '';
                break;
            }
            const lc = v.toLowerCase();
            if (/^[a-z]{3}$/.test(lc)) book.language_code = lc;
            break;
        }
        case 'publishing_status': {
            if (!v) break;
            const code = normalizePublishingStatus(v);
            if (code) book.publishing_status = code;
            break;
        }
        case 'authors':
            setAuthorA01(book, v);
            break;
        case 'bisac_main':
            setMainSubject(book, '10', '2017', v);
            break;
        case 'thema_main':
            setMainSubject(book, '93', '', v);
            break;
        case 'wgs_main':
            setMainSubject(book, '26', '', v);
            break;
        case 'price': {
            if (!v) break;
            const parsed = parsePriceCell(v, settings.default_currency || 'EUR');
            if (parsed) setDefaultPrice(book, parsed.amount, parsed.currency);
            break;
        }
        case 'territory':
            setPrimaryTerritory(book, v);
            break;
        default:
            break;
    }
}

async function pasteValueToBookIds(ids, col, value) {
    const CONC = 6;
    let ok = 0;
    let errors = 0;
    for (let i = 0; i < ids.length; i += CONC) {
        const chunk = ids.slice(i, i + CONC);
        const results = await Promise.all(
            chunk.map(async (id) => {
                try {
                    const full = await API.getBook(id);
                    applyPastedCellToBook(full, col, value);
                    await API.updateBook(full.id, bookToUpdatePayload(full));
                    return true;
                } catch (e) {
                    console.error(e);
                    return false;
                }
            }),
        );
        results.forEach((success) => (success ? ok++ : errors++));
    }
    await loadBooks(currentSearch);
    if (errors > 0) toast(tr('toast.pastedGridWithErrors', { ok, errors }), 'info');
    else toast(tr('toast.pastedGridOk', { ok }), 'success');
}

async function pasteExcelSingleValue(text) {
    const v = String(text).trim();
    const col = activeCell.dataset.col;
    if (!TABLE_PASTE_COLS.includes(col)) {
        toast(tr('toast.editInDetailPanel'), 'info');
        return;
    }
    const rowId = parseInt(activeCell.closest('tr').dataset.id, 10);
    const targets = selectedIds.size > 0 ? [...selectedIds] : [rowId];
    await pasteValueToBookIds(targets, col, v);
}

async function pasteExcelGrid(text) {
    let rows = text.split('\n');
    while (rows.length && rows[rows.length - 1] === '') rows.pop();
    const grid = rows.map((line) => line.split('\t'));
    const startCol = TABLE_PASTE_COLS.indexOf(activeCell.dataset.col);
    if (startCol < 0) return;
    const trEl = activeCell.closest('tr');
    const startRow = books.findIndex((b) => b.id === parseInt(trEl.dataset.id, 10));
    if (startRow < 0) return;

    const CONC = 6;
    let ok = 0;
    let errors = 0;
    let skippedRows = 0;
    const jobs = [];

    for (let r = 0; r < grid.length; r++) {
        const line = grid[r];
        if (line.every((c) => String(c).trim() === '')) continue;
        const bookIdx = startRow + r;
        if (bookIdx >= books.length) {
            skippedRows += 1;
            continue;
        }
        const bookId = books[bookIdx].id;
        jobs.push(async () => {
            try {
                const full = await API.getBook(bookId);
                for (let c = 0; c < line.length; c++) {
                    const colIdx = startCol + c;
                    if (colIdx >= TABLE_PASTE_COLS.length) break;
                    applyPastedCellToBook(full, TABLE_PASTE_COLS[colIdx], line[c]);
                }
                await API.updateBook(full.id, bookToUpdatePayload(full));
                return true;
            } catch (e) {
                console.error(e);
                return false;
            }
        });
    }

    if (jobs.length === 0) return;

    for (let i = 0; i < jobs.length; i += CONC) {
        const chunk = jobs.slice(i, i + CONC);
        const results = await Promise.all(chunk.map((j) => j()));
        results.forEach((success) => (success ? ok++ : errors++));
    }

    await loadBooks(currentSearch);
    if (errors > 0) toast(tr('toast.pastedGridWithErrors', { ok, errors }), 'info');
    else toast(tr('toast.pastedGridOk', { ok }), 'success');
    if (skippedRows > 0) toast(tr('toast.pasteSkippedBeyondPage', { count: skippedRows }), 'info');
}

// ============================================================
// Sort
// ============================================================
function updateSortArrows() {
    document.querySelectorAll('.spreadsheet th[data-col]').forEach(th => {
        const arrow = th.querySelector('.sort-arrow');
        if (!arrow) return;
        if (th.dataset.col === sortCol) {
            arrow.textContent = sortOrder === 'asc' ? '▲' : '▼';
        } else {
            arrow.textContent = '';
        }
    });
}

// ============================================================
// CRUD Operations
// ============================================================
async function addBook() {
    const book = await API.createBook({});
    toast(tr('toast.newBookAdded'), 'success');
    await loadBooks(currentSearch);
    openDetailPanel(book.id);
}

async function cloneSelected() {
    if (selectedIds.size === 0) return toast(tr('toast.selectBooksToClone'), 'info');
    const result = await API.cloneBooks([...selectedIds]);
    toast(tr('toast.clonedBooks', { count: result.cloned.length }), 'success');
    selectedIds.clear();
    await loadBooks(currentSearch);
}

async function deleteSelected() {
    if (selectedIds.size === 0) return toast(tr('toast.selectBooksToDelete'), 'info');
    if (!confirm(tr('confirm.deleteBooks', { count: selectedIds.size }))) return;
    await API.deleteBooks([...selectedIds]);
    toast(tr('toast.deletedBooks', { count: selectedIds.size }), 'success');
    selectedIds.clear();
    if (currentBookId && !books.find(b => b.id === currentBookId)) {
        document.getElementById('detail-panel').classList.remove('open');
        currentBookId = null;
    }
    await loadBooks(currentSearch);
}

// ============================================================
// Detail Panel
// ============================================================
async function openDetailPanel(bookId) {
    currentBookId = bookId;
    const book = await API.getBook(bookId);
    document.getElementById('detail-panel').classList.add('open');
    document.getElementById('detail-title').innerHTML = `${tr('ui.bookDetails')} <span>#${book.id} — ${esc(book.title || tr('ui.untitled'))}</span>`;
    renderTable(); // highlight current row

    // Fill basic tab
    document.getElementById('f-isbn').value = book.isbn || '';
    document.getElementById('f-order-number').value = book.order_number || '';
    document.getElementById('f-notification-type').value = book.notification_type || '03';
    document.getElementById('f-product-form-detail').value = book.product_form_detail || 'E101';
    document.getElementById('f-drm').value = book.drm || settings.default_drm || '';
    document.getElementById('f-title').value = book.title || '';
    document.getElementById('f-subtitle').value = book.subtitle || '';
    document.getElementById('f-series-name').value = book.series_name || '';
    document.getElementById('f-part-number').value = book.part_number || '';
    document.getElementById('f-edition-number').value = book.edition_number || '';
    document.getElementById('f-edition-statement').value = book.edition_statement || '';
    document.getElementById('f-language').value = book.language_code || settings.default_language || '';
    document.getElementById('f-original-language').value = book.original_language || '';
    document.getElementById('f-page-count').value = book.page_count || '';
    document.getElementById('f-age-from').value = book.audience_age_from || '';
    document.getElementById('f-age-to').value = book.audience_age_to || '';

    // Description tab
    document.getElementById('f-description').value = book.description || '';
    document.getElementById('f-biography').value = book.biography || '';
    document.getElementById('f-toc').value = book.toc || '';
    document.getElementById('desc-counter').textContent = tr('status.characters', { count: (book.description || '').length });

    // Publishing tab
    document.getElementById('f-publisher-name').value = book.publisher_name || '';
    document.getElementById('f-publisher-city').value = book.publisher_city || '';
    document.getElementById('f-publisher-country').value = book.publisher_country || '';
    document.getElementById('f-publishing-status').value = book.publishing_status || '04';
    document.getElementById('f-publishing-date').value = onixDateToInput(book.publishing_date);
    document.getElementById('f-print-pub-date').value = onixDateToInput(book.print_pub_date);
    document.getElementById('f-announcement-date').value = onixDateToInput(book.announcement_date);

    // Resources tab
    document.getElementById('f-cover-filename').value = book.cover_filename || '';
    document.getElementById('f-content-filename').value = book.content_filename || '';

    // Dynamic lists
    renderContributors(book.contributors || []);
    renderSubjects(book.subjects || []);
    renderPrices(book.prices || []);
    renderRights(book.sales_rights || []);
    renderRelated(book.related_products || []);
    renderReviews(book.reviews || []);

    // Keywords (extract from subjects with scheme_id='20')
    const keywords = (book.subjects || []).filter(s => s.scheme_id === '20').map(s => s.subject_text).join(', ');
    document.getElementById('f-keywords').value = keywords;
}

async function saveDetail() {
    if (!currentBookId) return;

    const data = {
        isbn: document.getElementById('f-isbn').value,
        order_number: document.getElementById('f-order-number').value,
        notification_type: document.getElementById('f-notification-type').value,
        product_form_detail: document.getElementById('f-product-form-detail').value,
        drm: document.getElementById('f-drm').value,
        title: document.getElementById('f-title').value,
        subtitle: document.getElementById('f-subtitle').value,
        series_name: document.getElementById('f-series-name').value,
        part_number: document.getElementById('f-part-number').value,
        edition_number: document.getElementById('f-edition-number').value,
        edition_statement: document.getElementById('f-edition-statement').value,
        language_code: document.getElementById('f-language').value,
        original_language: document.getElementById('f-original-language').value,
        page_count: parseInt(document.getElementById('f-page-count').value) || null,
        audience_age_from: parseInt(document.getElementById('f-age-from').value) || null,
        audience_age_to: parseInt(document.getElementById('f-age-to').value) || null,
        description: document.getElementById('f-description').value,
        biography: document.getElementById('f-biography').value,
        toc: document.getElementById('f-toc').value,
        publisher_name: document.getElementById('f-publisher-name').value,
        publisher_city: document.getElementById('f-publisher-city').value,
        publisher_country: document.getElementById('f-publisher-country').value,
        publishing_status: document.getElementById('f-publishing-status').value,
        publishing_date: inputDateToOnix(document.getElementById('f-publishing-date').value),
        print_pub_date: inputDateToOnix(document.getElementById('f-print-pub-date').value),
        announcement_date: inputDateToOnix(document.getElementById('f-announcement-date').value),
        cover_filename: document.getElementById('f-cover-filename').value,
        content_filename: document.getElementById('f-content-filename').value,
        contributors: collectContributors(),
        subjects: collectSubjects(),
        prices: collectPrices(),
        sales_rights: collectRights(),
        related_products: collectRelated(),
        reviews: collectReviews(),
    };

    // Add keywords as subjects
    const kw = document.getElementById('f-keywords').value;
    if (kw) {
        for (const word of kw.split(',').map(s => s.trim()).filter(Boolean)) {
            data.subjects.push({ scheme_id: '20', subject_text: word });
        }
    }

    await API.updateBook(currentBookId, data);
    toast(tr('toast.bookSaved'), 'success');
    await loadBooks(currentSearch);
}

// ============================================================
// Dynamic list renderers
// ============================================================
function renderContributors(list) {
    const container = document.getElementById('contributors-list');
    container.innerHTML = '';
    for (const c of list) {
        addContributorRow(container, c);
    }
}

function addContributor() {
    const container = document.getElementById('contributors-list');
    addContributorRow(container, { sequence_number: container.children.length + 1, contributor_role: 'A01' });
}

function addContributorRow(container, c) {
    const div = document.createElement('div');
    div.className = 'dynamic-list-item';
    const roles = (Codelists.onixCodes.contributorRoles || []).map(r =>
        `<option value="${r.code}" ${r.code === c.contributor_role ? 'selected' : ''}>${r.code} — ${r.text}</option>`
    ).join('');
    div.innerHTML = `
        <select class="c-role">${roles}</select>
        <input class="c-name" placeholder="${esc(tr('ui.personName'))}" value="${esc(c.person_name || '')}">
        <input class="c-inverted" placeholder="${esc(tr('ui.invertedName'))}" value="${esc(c.person_name_inverted || '')}">
        <input class="c-corporate" placeholder="${esc(tr('ui.corporateName'))}" value="${esc(c.corporate_name || '')}">
        <span class="btn-remove" onclick="this.parentElement.remove()">✕</span>
    `;
    container.appendChild(div);
}

function collectContributors() {
    return [...document.querySelectorAll('#contributors-list .dynamic-list-item')].map((div, i) => ({
        sequence_number: i + 1,
        contributor_role: div.querySelector('.c-role').value,
        person_name: div.querySelector('.c-name').value,
        person_name_inverted: div.querySelector('.c-inverted').value,
        corporate_name: div.querySelector('.c-corporate').value,
    }));
}

function renderSubjects(list) {
    const container = document.getElementById('subjects-list');
    container.innerHTML = '';
    for (const s of list) {
        if (s.scheme_id === '20') continue; // keywords handled separately
        addSubjectRow(container, s);
    }
}

function addSubject() {
    const container = document.getElementById('subjects-list');
    addSubjectRow(container, { scheme_id: '10', scheme_version: '2017', is_main: 0 });
}

function addSubjectRow(container, s) {
    const div = document.createElement('div');
    div.className = 'dynamic-list-item';
    div.innerHTML = `
        <select class="s-scheme">
            <option value="10" ${s.scheme_id === '10' ? 'selected' : ''}>BISAC</option>
            <option value="93" ${s.scheme_id === '93' ? 'selected' : ''}>Thema</option>
            <option value="26" ${s.scheme_id === '26' ? 'selected' : ''}>WGS</option>
        </select>
        <input class="s-code" placeholder="${esc(tr('ui.code'))}" value="${esc(s.subject_code || '')}">
        <input class="s-version" placeholder="${esc(tr('ui.version'))}" value="${esc(s.scheme_version || '')}">
        <label style="display:flex;align-items:center;gap:4px;font-size:11px;white-space:nowrap;">
            <input type="checkbox" class="s-main" ${s.is_main ? 'checked' : ''}> ${esc(tr('ui.main'))}
        </label>
        <span class="btn-remove" onclick="this.parentElement.remove()">✕</span>
    `;
    container.appendChild(div);
}

function collectSubjects() {
    return [...document.querySelectorAll('#subjects-list .dynamic-list-item')].map(div => ({
        scheme_id: div.querySelector('.s-scheme').value,
        subject_code: div.querySelector('.s-code').value,
        scheme_version: div.querySelector('.s-version').value,
        is_main: div.querySelector('.s-main').checked ? 1 : 0,
    }));
}

function renderPrices(list) {
    const container = document.getElementById('prices-list');
    container.innerHTML = '';
    for (const p of list) addPriceRow(container, p);
}

function addPrice() {
    const container = document.getElementById('prices-list');
    addPriceRow(container, { price_type: settings.default_price_type || '42', currency_code: settings.default_currency || 'EUR' });
}

function addPriceRow(container, p) {
    const div = document.createElement('div');
    div.className = 'dynamic-list-item';
    const types = (Codelists.onixCodes.priceTypes || []).map(t =>
        `<option value="${t.code}" ${t.code === p.price_type ? 'selected' : ''}>${t.code} — ${t.text}</option>`
    ).join('');
    const currencies = Codelists.currencies.map(c =>
        `<option value="${c.code}" ${c.code === p.currency_code ? 'selected' : ''}>${c.code}</option>`
    ).join('');
    div.innerHTML = `
        <select class="p-type">${types}</select>
        <input class="p-amount" type="number" step="0.01" placeholder="${esc(tr('ui.amount'))}" value="${p.amount || ''}">
        <select class="p-currency">${currencies}</select>
        <input class="p-territory" placeholder="${esc(tr('ui.countryCodes'))}" value="${esc(p.territory || '')}">
        <input class="p-start" type="date" placeholder="${esc(tr('ui.start'))}" value="${onixDateToInput(p.start_date)}" title="${esc(tr('ui.startDate'))}">
        <input class="p-end" type="date" placeholder="${esc(tr('ui.end'))}" value="${onixDateToInput(p.end_date)}" title="${esc(tr('ui.endDate'))}">
        <span class="btn-remove" onclick="this.parentElement.remove()">✕</span>
    `;
    container.appendChild(div);
}

function collectPrices() {
    return [...document.querySelectorAll('#prices-list .dynamic-list-item')].map(div => ({
        price_type: div.querySelector('.p-type').value,
        amount: parseFloat(div.querySelector('.p-amount').value) || 0,
        currency_code: div.querySelector('.p-currency').value,
        territory: div.querySelector('.p-territory').value,
        start_date: inputDateToOnix(div.querySelector('.p-start').value),
        end_date: inputDateToOnix(div.querySelector('.p-end').value),
    }));
}

function renderRights(list) {
    const container = document.getElementById('rights-list');
    container.innerHTML = '';
    for (const r of list) addRightRow(container, r);
}

function addSalesRight() {
    const container = document.getElementById('rights-list');
    addRightRow(container, { rights_type: '02', regions: settings.default_territory === 'WORLD' ? 'WORLD' : '', countries: settings.default_territory !== 'WORLD' ? settings.default_territory : '' });
}

function addRightRow(container, r) {
    const div = document.createElement('div');
    div.className = 'dynamic-list-item';
    const types = (Codelists.onixCodes.salesRightsTypes || []).map(t =>
        `<option value="${t.code}" ${t.code === r.rights_type ? 'selected' : ''}>${t.code} — ${t.text}</option>`
    ).join('');
    div.innerHTML = `
        <select class="r-type">${types}</select>
        <input class="r-countries" placeholder="${esc(tr('ui.countriesExample'))}" value="${esc(r.countries || '')}" style="flex:1">
        <input class="r-regions" placeholder="${esc(tr('ui.regionExample'))}" value="${esc(r.regions || '')}">
        <span class="btn-remove" onclick="this.parentElement.remove()">✕</span>
    `;
    container.appendChild(div);
}

function collectRights() {
    return [...document.querySelectorAll('#rights-list .dynamic-list-item')].map(div => ({
        rights_type: div.querySelector('.r-type').value,
        countries: div.querySelector('.r-countries').value,
        regions: div.querySelector('.r-regions').value,
    }));
}

function renderRelated(list) {
    const container = document.getElementById('related-list');
    container.innerHTML = '';
    for (const r of list) addRelatedRow(container, r);
}

function addRelated() {
    const container = document.getElementById('related-list');
    addRelatedRow(container, { relation_code: '06' });
}

function addRelatedRow(container, r) {
    const div = document.createElement('div');
    div.className = 'dynamic-list-item';
    const codes = (Codelists.onixCodes.productRelationCodes || []).map(c =>
        `<option value="${c.code}" ${c.code === r.relation_code ? 'selected' : ''}>${c.code} — ${c.text}</option>`
    ).join('');
    div.innerHTML = `
        <select class="rel-code">${codes}</select>
        <input class="rel-isbn" placeholder="${esc(tr('ui.relatedIsbn'))}" value="${esc(r.related_isbn || '')}" style="flex:1">
        <span class="btn-remove" onclick="this.parentElement.remove()">✕</span>
    `;
    container.appendChild(div);
}

function collectRelated() {
    return [...document.querySelectorAll('#related-list .dynamic-list-item')].map(div => ({
        relation_code: div.querySelector('.rel-code').value,
        related_isbn: div.querySelector('.rel-isbn').value,
    }));
}

function renderReviews(list) {
    const container = document.getElementById('reviews-list');
    container.innerHTML = '';
    for (const r of list) addReviewRow(container, r);
}

function addReview() {
    const container = document.getElementById('reviews-list');
    addReviewRow(container, {});
}

function addReviewRow(container, r) {
    const div = document.createElement('div');
    div.className = 'dynamic-list-item';
    div.style.flexDirection = 'column';
    div.style.alignItems = 'stretch';
    div.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;">
            <input class="rv-author" placeholder="${esc(tr('ui.reviewer'))}" value="${esc(r.text_author || '')}" style="flex:1">
            <input class="rv-source" placeholder="${esc(tr('ui.sourcePublication'))}" value="${esc(r.source_title || '')}" style="flex:1">
            <input class="rv-date" type="date" value="${onixDateToInput(r.review_date)}">
            <span class="btn-remove" onclick="this.parentElement.parentElement.remove()">✕</span>
        </div>
        <textarea class="rv-text" rows="2" placeholder="${esc(tr('ui.reviewText'))}">${esc(r.review_text || '')}</textarea>
    `;
    container.appendChild(div);
}

function collectReviews() {
    return [...document.querySelectorAll('#reviews-list .dynamic-list-item')].map(div => ({
        review_text: div.querySelector('.rv-text').value,
        text_author: div.querySelector('.rv-author').value,
        source_title: div.querySelector('.rv-source').value,
        review_date: inputDateToOnix(div.querySelector('.rv-date').value),
    }));
}

// ============================================================
// Settings
// ============================================================
async function saveSettings() {
    const data = {
        sender_name: document.getElementById('s-sender-name').value,
        contact_name: document.getElementById('s-contact-name').value,
        email: document.getElementById('s-email').value,
        publisher_name: document.getElementById('s-publisher-name').value,
        publisher_city: document.getElementById('s-publisher-city').value,
        publisher_country: document.getElementById('s-publisher-country').value,
        default_language: document.getElementById('s-default-language').value,
        default_currency: document.getElementById('s-default-currency').value,
        default_drm: document.getElementById('s-default-drm').value,
        default_price_type: document.getElementById('s-default-price-type').value,
        default_territory: document.getElementById('s-default-territory').value,
        // Bookwire / Supplier
        message_note: document.getElementById('s-message-note').value,
        supplier_role: document.getElementById('s-supplier-role').value,
        supplier_name: document.getElementById('s-supplier-name').value,
        supplier_id_value: document.getElementById('s-supplier-id-value').value,
        onix_format: document.getElementById('s-onix-format').value,
        ui_language: document.getElementById('s-ui-language').value,
    };
    API.setApiKey(document.getElementById('s-api-key').value.trim());
    settings = await API.saveSettings(data);
    await I18N.setLanguage(settings.ui_language || 'en');
    populateFilterDropdowns();
    document.getElementById('filter-language').value = currentFilters.language;
    document.getElementById('filter-status').value = currentFilters.status;
    document.getElementById('filter-drm').value = currentFilters.drm;
    updatePagination();
    updateSortArrows();
    toast(tr('toast.settingsSaved'), 'success');
    closeModal('settings-modal');
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    API.saveSettings({ theme: next });
}

// ============================================================
// Import
// ============================================================
let importData = null;

function openImportModal() {
    openModal('import-modal');
    document.getElementById('import-mapping').style.display = 'none';
    document.getElementById('import-file').value = '';
}

async function handleImportFile(file) {
    document.getElementById('footer-status').textContent = tr('status.importing');
    try {
        const result = await API.uploadFile(file);
        importData = result;
        renderImportMapping(result);
        document.getElementById('footer-status').textContent = tr('ui.ready');
    } catch (e) {
        toast(tr('toast.importFailed', { message: e.message }), 'error');
        document.getElementById('footer-status').textContent = tr('ui.ready');
    }
}

function renderImportMapping(result) {
    document.getElementById('import-mapping').style.display = 'block';
    document.getElementById('import-info').textContent = tr('status.rowsFound', { count: result.totalRows });

    const onixFields = [
        { key: '', label: tr('ui.skip') },
        { key: 'isbn', label: tr('ui.colIsbn') },
        { key: 'title', label: tr('ui.colTitle') },
        { key: 'subtitle', label: tr('ui.colSubtitle') },
        { key: 'author', label: tr('ui.colAuthor') },
        { key: 'language', label: tr('ui.language') },
        { key: 'description', label: tr('ui.description') },
        { key: 'bisac_main', label: tr('ui.bisacMain') },
        { key: 'thema_main', label: tr('ui.themaMain') },
        { key: 'wgs', label: tr('ui.colWgs') },
        { key: 'keywords', label: tr('ui.keywords') },
        { key: 'price', label: tr('ui.colPrice') },
        { key: 'territory', label: tr('ui.colTerritory') },
    ];

    const autoMap = {
        'productid': '', 'producttype': '', 'title': 'title',
        'genrecodebisac1': 'bisac_main', 'genrecodethema1': 'thema_main',
        'genrecodewgs1': 'wgs', 'productinfotext': 'description',
        'keywords': 'keywords', 'territories': 'territory',
        'isbn': 'isbn', 'subtitle': 'subtitle', 'author': 'author',
        'language': 'language', 'price': 'price',
    };

    let html = `<tr><th>${tr('ui.fileColumn')}</th><th>${tr('ui.sampleData')}</th><th>${tr('ui.mapToOnix')}</th></tr>`;
    for (const header of result.headers) {
        const sample = result.preview[0] ? (result.preview[0][header] || '').toString().substring(0, 60) : '';
        const guess = autoMap[header.toLowerCase().replace(/[^a-z0-9]/g, '')] || '';
        const options = onixFields.map(f =>
            `<option value="${f.key}" ${f.key === guess ? 'selected' : ''}>${f.label}</option>`
        ).join('');
        html += `<tr><td><strong>${esc(header)}</strong></td><td style="color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;">${esc(sample)}</td><td><select class="map-field" data-header="${esc(header)}">${options}</select></td></tr>`;
    }
    document.getElementById('mapping-table').innerHTML = html;
}

async function applyImport() {
    if (!importData) return;
    const mapping = {};
    document.querySelectorAll('.map-field').forEach(sel => {
        if (sel.value) mapping[sel.value] = sel.dataset.header;
    });

    if (!mapping.title && !mapping.isbn) {
        return toast(tr('error.mapTitleOrIsbn'), 'error');
    }

    document.getElementById('footer-status').textContent = tr('status.importing');
    const result = await API.applyImport(importData.data, mapping);
    toast(tr('toast.importedBooks', { count: result.imported }), 'success');
    closeModal('import-modal');
    await loadBooks(currentSearch);
    document.getElementById('footer-status').textContent = tr('ui.ready');
}

// ============================================================
// Export
// ============================================================
async function exportData(format) {
    const blob = await API.exportData(format);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `onix_export_${new Date().toISOString().slice(0,10)}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    closeModal('export-modal');
    toast(tr('toast.exportingAs', { format: format.toUpperCase() }), 'info');
}

// ============================================================
// XML Generation
// ============================================================
async function generateXml() {
    const ids = selectedIds.size > 0 ? [...selectedIds] : null;
    try {
        const blob = await API.generateXml(ids);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `onix_${new Date().toISOString().slice(0,10)}.xml`;
        a.click();
        URL.revokeObjectURL(url);
        const count = ids ? ids.length : (cachedStats.books || 0);
        toast(tr('toast.generatedXml', { count }), 'success');
    } catch (e) {
        toast(tr('error.api', { message: e.message }), 'error');
    }
}

async function previewXml(bookIds) {
    const ids = bookIds || (selectedIds.size > 0 ? [...selectedIds] : null);
    const result = await API.previewXml(ids);
    setXmlPreview(result.xml);
    document.getElementById('preview-count').textContent = tr('status.previewProducts', { count: result.bookCount });
    document.getElementById('xml-preview').classList.add('open');
}

function toggleXmlPreview() {
    document.getElementById('xml-preview').classList.toggle('open');
}

function downloadXmlFromPreview() {
    const text = getRawXml();
    const blob = new Blob([text], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `onix_${new Date().toISOString().slice(0,10)}.xml`;
    a.click();
    URL.revokeObjectURL(url);
}

async function downloadBackup() {
    const blob = await API.getBackup();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `onix_db_backup_${new Date().toISOString().slice(0,10)}.db`;
    a.click();
    URL.revokeObjectURL(url);
}

// ============================================================
// Bulk Edit
// ============================================================
function openBulkEdit() {
    if (selectedIds.size === 0) return toast(tr('toast.selectBooksFirst'), 'info');
    document.getElementById('bulk-count').textContent = selectedIds.size;
    openModal('bulk-modal');
}

async function applyBulkEdit() {
    const fields = {};
    const lang = document.getElementById('b-language').value;
    if (lang) fields.language_code = lang;
    const drm = document.getElementById('b-drm').value;
    if (drm) fields.drm = drm;
    const status = document.getElementById('b-status').value;
    if (status) fields.publishing_status = status;

    const price = parseFloat(document.getElementById('b-price').value);
    if (!isNaN(price)) {
        fields.set_price = {
            price_type: settings.default_price_type,
            amount: price,
            currency_code: document.getElementById('b-currency').value,
            territory: document.getElementById('b-territory').value || '',
        };
    }

    const scheme = document.getElementById('b-scheme').value;
    const code = document.getElementById('b-subject-code').value;
    if (scheme && code) {
        fields.add_subject = {
            scheme_id: scheme,
            subject_code: code,
            is_main: document.getElementById('b-main-subject').checked,
        };
    }

    await API.bulkUpdate([...selectedIds], fields);
    toast(tr('toast.updatedBooks', { count: selectedIds.size }), 'success');
    closeModal('bulk-modal');
    await loadBooks(currentSearch);
}

// ============================================================
// Modals
// ============================================================
function openModal(id) {
    document.getElementById(id).classList.add('open');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('open');
}

function syncSelectAll() {
    const selectAll = document.getElementById('select-all');
    if (!selectAll) return;
    if (books.length === 0) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
        return;
    }
    const selectedCount = books.reduce((count, b) => count + (selectedIds.has(b.id) ? 1 : 0), 0);
    selectAll.checked = selectedCount === books.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < books.length;
}

function updatePagination() {
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    document.getElementById('page-info').textContent = tr('ui.pageOf', { current: currentPage, total: totalPages });
    document.getElementById('btn-prev-page').disabled = currentPage <= 1;
    document.getElementById('btn-next-page').disabled = currentPage >= totalPages;
}

function populateFilterDropdowns() {
    const langEl = document.getElementById('filter-language');
    const statusEl = document.getElementById('filter-status');
    const drmEl = document.getElementById('filter-drm');
    if (!langEl || !statusEl || !drmEl) return;

    const langVal = langEl.value;
    const statusVal = statusEl.value;
    const drmVal = drmEl.value;

    Codelists.populateSelect(langEl, Codelists.languages, { placeholder: tr('ui.filterAllLanguages') });
    Codelists.populateOnixSelect(statusEl, 'publishingStatuses');
    statusEl.insertAdjacentHTML('afterbegin', `<option value="">${esc(tr('ui.filterAllStatuses'))}</option>`);
    Codelists.populateOnixSelect(drmEl, 'drmTypes');
    drmEl.insertAdjacentHTML('afterbegin', `<option value="">${esc(tr('ui.filterAllDrm'))}</option>`);

    if (langVal) langEl.value = langVal;
    if (statusVal) statusEl.value = statusVal;
    if (drmVal) drmEl.value = drmVal;
}

async function selectAllMatchingFilter() {
    const params = {};
    if (currentSearch) params.search = currentSearch;
    if (currentFilters.language) params.language = currentFilters.language;
    if (currentFilters.status) params.status = currentFilters.status;
    if (currentFilters.drm) params.drm = currentFilters.drm;
    try {
        const { ids, capped } = await API.getBookIds(params);
        selectedIds = new Set(ids);
        renderTable();
        await updateStats();
        syncSelectAll();
        if (capped) toast(tr('toast.selectAllCapped', { max: MAX_SELECT_ALL_IDS }), 'info');
        else toast(tr('toast.selectAllDone', { count: ids.length }), 'success');
    } catch (e) {
        toast(tr('error.api', { message: e.message }), 'error');
    }
}

function clearActiveCell() {
    if (activeCell) activeCell.classList.remove('cell-active');
    activeCell = null;
}

function setActiveCell(td) {
    if (activeCell === td) return;
    if (activeCell) activeCell.classList.remove('cell-active');
    activeCell = td;
    if (activeCell) activeCell.classList.add('cell-active');
}

// ============================================================
// Toast notifications
// ============================================================
function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const div = document.createElement('div');
    div.className = `toast ${type}`;
    div.textContent = message;
    container.appendChild(div);
    setTimeout(() => div.remove(), 4000);
}

// ============================================================
// Helpers
// ============================================================
function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

function onixDateToInput(d) {
    if (!d || d.length !== 8) return '';
    return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
}

function inputDateToOnix(d) {
    if (!d) return '';
    return d.replace(/-/g, '');
}
