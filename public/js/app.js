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

// ============================================================
// Init
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    // Load codelists
    await Codelists.load();

    // Load settings
    settings = await API.getSettings();
    applyTheme(settings.theme || 'light');

    // Populate dropdowns
    populateDropdowns();

    // Load books
    await loadBooks();

    // Bind events
    bindEvents();

    updateStats();
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
    Codelists.populateSelect(document.getElementById('f-original-language'), Codelists.languages, { placeholder: '— None (not a translation) —' });
    Codelists.populateSelect(document.getElementById('f-publisher-country'), Codelists.countries, {});
    Codelists.populateOnixSelect(document.getElementById('f-notification-type'), 'notificationTypes', '03');
    Codelists.populateOnixSelect(document.getElementById('f-drm'), 'drmTypes', settings.default_drm);
    Codelists.populateOnixSelect(document.getElementById('f-publishing-status'), 'publishingStatuses', '04');

    // Bulk edit modal
    Codelists.populateSelect(document.getElementById('b-language'), Codelists.languages, { placeholder: "— Don't change —" });
    Codelists.populateOnixSelect(document.getElementById('b-drm'), 'drmTypes');
    document.getElementById('b-drm').insertAdjacentHTML('afterbegin', '<option value="">— Don\'t change —</option>');
    Codelists.populateOnixSelect(document.getElementById('b-status'), 'publishingStatuses');
    document.getElementById('b-status').insertAdjacentHTML('afterbegin', '<option value="">— Don\'t change —</option>');
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
}

// ============================================================
// Load books from API
// ============================================================
async function loadBooks(search = '') {
    const params = { sort: sortCol, order: sortOrder };
    if (search) params.search = search;
    const result = await API.getBooks(params);
    books = result.books || [];
    renderTable();
    updateEmptyState();
    updateStats();
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
            <td class="col-num">${i + 1}</td>
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
}

function getStatusBadge(status) {
    switch (status) {
        case '04': return '<span class="badge badge-active">Active</span>';
        case '02': return '<span class="badge badge-draft">Forthcoming</span>';
        case '05': case '07': case '08': return '<span class="badge badge-deleted">Inactive</span>';
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
    document.getElementById('stats').textContent = `${stats.books} books`;
    document.getElementById('selection-info').textContent = selectedIds.size > 0
        ? `${selectedIds.size} selected`
        : `${books.length} books`;
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
    document.getElementById('btn-bulk').addEventListener('click', openBulkEdit);
    document.getElementById('btn-import').addEventListener('click', openImportModal);
    document.getElementById('btn-export').addEventListener('click', () => openModal('export-modal'));
    document.getElementById('btn-generate').addEventListener('click', generateXml);
    document.getElementById('btn-preview').addEventListener('click', previewXml);

    // Search
    document.getElementById('search-input').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => loadBooks(e.target.value), 300);
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

        // Checkbox click
        if (e.target.type === 'checkbox') {
            if (e.target.checked) selectedIds.add(id);
            else selectedIds.delete(id);
            tr.classList.toggle('selected', selectedIds.has(id));
            updateStats();
            return;
        }

        // Shift+click for range select
        if (e.shiftKey && selectedIds.size > 0) {
            const allIds = books.map(b => b.id);
            const lastSelected = [...selectedIds].pop();
            const fromIdx = allIds.indexOf(lastSelected);
            const toIdx = allIds.indexOf(id);
            const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
            for (let i = start; i <= end; i++) selectedIds.add(allIds[i]);
            renderTable();
            updateStats();
            return;
        }

        // Ctrl+click for toggle select
        if (e.ctrlKey || e.metaKey) {
            if (selectedIds.has(id)) selectedIds.delete(id);
            else selectedIds.add(id);
            tr.classList.toggle('selected', selectedIds.has(id));
            updateStats();
            return;
        }

        // Normal click — open detail panel
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
            loadBooks(document.getElementById('search-input').value);
        });
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
        navigator.clipboard.writeText(text).then(() => toast('XML copied to clipboard', 'success'));
    });
    document.getElementById('btn-download-xml').addEventListener('click', downloadXmlFromPreview);

    // Description character counter
    document.getElementById('f-description').addEventListener('input', (e) => {
        const len = e.target.value.length;
        document.getElementById('desc-counter').textContent = `${len} characters${len < 50 ? ' (min. 50 required)' : ''}`;
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
            const focused = document.querySelector('.spreadsheet tr.selected td[data-col]');
            if (focused) {
                clipboard.col = focused.dataset.col;
                clipboard.value = focused.textContent.trim();
                toast(`Copied: ${clipboard.value}`, 'info');
            }
        }
        // Ctrl+V — paste to selected
        if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !isEditing() && clipboard.value) {
            pasteToSelected();
        }
    });
}

// ============================================================
// Inline editing
// ============================================================
function startInlineEdit(td) {
    if (td.classList.contains('editing')) return;
    const col = td.dataset.col;
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
            // Map table column to API field
            const fieldMap = {
                isbn: 'isbn', title: 'title', subtitle: 'subtitle',
                language_code: 'language_code',
            };
            const field = fieldMap[col];
            if (field) {
                await API.updateBook(bookId, { [field]: newValue });
                toast('Updated', 'success');
            }
            await loadBooks(document.getElementById('search-input').value);
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
            const focused = document.querySelector('.spreadsheet tr.selected td[data-col]');
            if (focused) {
                clipboard.col = focused.dataset.col;
                clipboard.value = focused.textContent.trim();
                toast(`Copied: ${clipboard.value}`, 'info');
            }
            break;
        }
        case 'paste-cell':
            if (clipboard.value) pasteToSelected();
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
    const fieldMap = {
        isbn: 'isbn', title: 'title', subtitle: 'subtitle',
        language_code: 'language_code',
    };
    const field = fieldMap[clipboard.col];
    if (field) {
        await API.bulkUpdate([...selectedIds], { [field]: clipboard.value });
        toast(`Pasted "${clipboard.value}" to ${selectedIds.size} books`, 'success');
        await loadBooks(document.getElementById('search-input').value);
    }
}

// ============================================================
// Sort
// ============================================================
function updateSortArrows() {
    document.querySelectorAll('.spreadsheet th[data-col]').forEach(th => {
        const arrow = th.querySelector('.sort-arrow');
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
    toast('New book added', 'success');
    await loadBooks();
    openDetailPanel(book.id);
}

async function cloneSelected() {
    if (selectedIds.size === 0) return toast('Select books to clone', 'info');
    const result = await API.cloneBooks([...selectedIds]);
    toast(`Cloned ${result.cloned.length} books`, 'success');
    selectedIds.clear();
    await loadBooks();
}

async function deleteSelected() {
    if (selectedIds.size === 0) return toast('Select books to delete', 'info');
    if (!confirm(`Delete ${selectedIds.size} book(s)? This cannot be undone.`)) return;
    await API.deleteBooks([...selectedIds]);
    toast(`Deleted ${selectedIds.size} books`, 'success');
    selectedIds.clear();
    if (currentBookId && !books.find(b => b.id === currentBookId)) {
        document.getElementById('detail-panel').classList.remove('open');
        currentBookId = null;
    }
    await loadBooks();
}

// ============================================================
// Detail Panel
// ============================================================
async function openDetailPanel(bookId) {
    currentBookId = bookId;
    const book = await API.getBook(bookId);
    document.getElementById('detail-panel').classList.add('open');
    document.getElementById('detail-title').innerHTML = `Book Details <span>#${book.id} — ${esc(book.title || 'Untitled')}</span>`;
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
    document.getElementById('desc-counter').textContent = `${(book.description || '').length} characters`;

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
    toast('Book saved', 'success');
    await loadBooks(document.getElementById('search-input').value);
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
        <select class="c-role" style="width:140px">${roles}</select>
        <input class="c-name" placeholder="Person Name" value="${esc(c.person_name || '')}">
        <input class="c-inverted" placeholder="Inverted (Doe, Jane)" value="${esc(c.person_name_inverted || '')}">
        <input class="c-corporate" placeholder="Corporate Name" value="${esc(c.corporate_name || '')}" style="width:120px">
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
        <select class="s-scheme" style="width:100px">
            <option value="10" ${s.scheme_id === '10' ? 'selected' : ''}>BISAC</option>
            <option value="93" ${s.scheme_id === '93' ? 'selected' : ''}>Thema</option>
            <option value="26" ${s.scheme_id === '26' ? 'selected' : ''}>WGS</option>
        </select>
        <input class="s-code" placeholder="Code" value="${esc(s.subject_code || '')}" style="width:120px">
        <input class="s-version" placeholder="Version" value="${esc(s.scheme_version || '')}" style="width:60px">
        <label style="display:flex;align-items:center;gap:4px;font-size:11px;white-space:nowrap;">
            <input type="checkbox" class="s-main" ${s.is_main ? 'checked' : ''}> Main
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
        <select class="p-type" style="width:140px">${types}</select>
        <input class="p-amount" type="number" step="0.01" placeholder="Amount" value="${p.amount || ''}" style="width:80px">
        <select class="p-currency" style="width:70px">${currencies}</select>
        <input class="p-territory" placeholder="Country codes" value="${esc(p.territory || '')}" style="width:80px">
        <input class="p-start" type="date" placeholder="Start" value="${onixDateToInput(p.start_date)}" style="width:120px" title="Start date">
        <input class="p-end" type="date" placeholder="End" value="${onixDateToInput(p.end_date)}" style="width:120px" title="End date">
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
        <select class="r-type" style="width:180px">${types}</select>
        <input class="r-countries" placeholder="Countries (DE AT CH)" value="${esc(r.countries || '')}" style="flex:1">
        <input class="r-regions" placeholder="Region (WORLD)" value="${esc(r.regions || '')}" style="width:80px">
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
        <select class="rel-code" style="width:200px">${codes}</select>
        <input class="rel-isbn" placeholder="Related ISBN" value="${esc(r.related_isbn || '')}" style="flex:1">
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
            <input class="rv-author" placeholder="Reviewer" value="${esc(r.text_author || '')}" style="flex:1">
            <input class="rv-source" placeholder="Source (publication)" value="${esc(r.source_title || '')}" style="flex:1">
            <input class="rv-date" type="date" value="${onixDateToInput(r.review_date)}" style="width:140px">
            <span class="btn-remove" onclick="this.parentElement.parentElement.remove()">✕</span>
        </div>
        <textarea class="rv-text" rows="2" placeholder="Review text...">${esc(r.review_text || '')}</textarea>
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
    };
    settings = await API.saveSettings(data);
    toast('Settings saved', 'success');
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
    document.getElementById('footer-status').textContent = 'Importing...';
    try {
        const result = await API.uploadFile(file);
        importData = result;
        renderImportMapping(result);
        document.getElementById('footer-status').textContent = 'Ready';
    } catch (e) {
        toast('Import failed: ' + e.message, 'error');
        document.getElementById('footer-status').textContent = 'Ready';
    }
}

function renderImportMapping(result) {
    document.getElementById('import-mapping').style.display = 'block';
    document.getElementById('import-info').textContent = `${result.totalRows} rows found`;

    const onixFields = [
        { key: '', label: '— Skip —' },
        { key: 'isbn', label: 'ISBN' },
        { key: 'title', label: 'Title' },
        { key: 'subtitle', label: 'Subtitle' },
        { key: 'author', label: 'Author' },
        { key: 'language', label: 'Language' },
        { key: 'description', label: 'Description' },
        { key: 'bisac_main', label: 'BISAC Main' },
        { key: 'thema_main', label: 'Thema Main' },
        { key: 'wgs', label: 'WGS' },
        { key: 'keywords', label: 'Keywords' },
        { key: 'price', label: 'Price' },
        { key: 'territory', label: 'Territory' },
    ];

    const autoMap = {
        'productid': '', 'producttype': '', 'title': 'title',
        'genrecodebisac1': 'bisac_main', 'genrecodethema1': 'thema_main',
        'genrecodewgs1': 'wgs', 'productinfotext': 'description',
        'keywords': 'keywords', 'territories': 'territory',
        'isbn': 'isbn', 'subtitle': 'subtitle', 'author': 'author',
        'language': 'language', 'price': 'price',
    };

    let html = '<tr><th>File Column</th><th>Sample Data</th><th>Map to ONIX Field</th></tr>';
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
        return toast('Please map at least Title or ISBN', 'error');
    }

    document.getElementById('footer-status').textContent = 'Importing...';
    const result = await API.applyImport(importData.data, mapping);
    toast(`Imported ${result.imported} books`, 'success');
    closeModal('import-modal');
    await loadBooks();
    document.getElementById('footer-status').textContent = 'Ready';
}

// ============================================================
// Export
// ============================================================
function exportData(format) {
    window.location = `/api/export/${format}`;
    closeModal('export-modal');
    toast(`Exporting as ${format.toUpperCase()}...`, 'info');
}

// ============================================================
// XML Generation
// ============================================================
async function generateXml() {
    const ids = selectedIds.size > 0 ? [...selectedIds] : null;
    const blob = await API.generateXml(ids);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `onix_${new Date().toISOString().slice(0,10)}.xml`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`ONIX XML generated (${ids ? ids.length : books.length} books)`, 'success');
}

async function previewXml(bookIds) {
    const ids = bookIds || (selectedIds.size > 0 ? [...selectedIds] : null);
    const result = await API.previewXml(ids);
    setXmlPreview(result.xml);
    document.getElementById('preview-count').textContent = `(${result.bookCount} products)`;
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

// ============================================================
// Bulk Edit
// ============================================================
function openBulkEdit() {
    if (selectedIds.size === 0) return toast('Select books first', 'info');
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
    toast(`Updated ${selectedIds.size} books`, 'success');
    closeModal('bulk-modal');
    await loadBooks(document.getElementById('search-input').value);
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
