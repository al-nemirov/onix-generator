/**
 * ONIX Generator — API Client
 * All communication with the Express/SQLite backend.
 */
const API = {
    getApiKey() {
        return localStorage.getItem('onix_api_key') || '';
    },
    setApiKey(key) {
        localStorage.setItem('onix_api_key', key || '');
    },
    ensureApiKey() {
        let key = this.getApiKey();
        if (!key) {
            key = window.prompt((window.I18N && window.I18N.t('prompt.enterApiKey')) || 'Enter API key');
            if (key) this.setApiKey(key.trim());
        }
        return this.getApiKey();
    },
    async request(url, options = {}) {
        const headers = new Headers(options.headers || {});
        const key = this.ensureApiKey();
        if (key) headers.set('X-API-Key', key);
        const response = await fetch(url, { ...options, headers });
        if (!response.ok) {
            let message = `HTTP ${response.status}`;
            try {
                const err = await response.json();
                message = err.error || err.message || message;
            } catch (_) {
                // no-op
            }
            const error = new Error(message);
            error.status = response.status;
            throw error;
        }
        return response;
    },
    async json(url, options = {}) {
        const res = await this.request(url, options);
        return res.json();
    },
    async blob(url, options = {}) {
        const res = await this.request(url, options);
        return res.blob();
    },

    // ---- Settings ----
    async getSettings() {
        return this.json('/api/settings');
    },
    async saveSettings(data) {
        return this.json('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
    },

    // ---- Books ----
    async getBooks(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return this.json(`/api/books?${qs}`);
    },
    async getBookIds(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return this.json(`/api/books/ids?${qs}`);
    },
    async getBook(id) {
        return this.json(`/api/books/${id}`);
    },
    async createBook(data = {}) {
        return this.json('/api/books', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
    },
    async updateBook(id, data) {
        return this.json(`/api/books/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
    },
    async deleteBooks(ids) {
        return this.json('/api/books', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
        });
    },
    async cloneBooks(ids) {
        return this.json('/api/books/clone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
        });
    },
    async bulkUpdate(ids, fields) {
        return this.json('/api/books/bulk', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, fields }),
        });
    },

    // ---- ONIX Generation ----
    async generateXml(bookIds = null) {
        return this.blob('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookIds }),
        });
    },
    async previewXml(bookIds = null) {
        return this.json('/api/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookIds }),
        });
    },

    // ---- Import ----
    async uploadFile(file) {
        const form = new FormData();
        form.append('file', file);
        return this.json('/api/import', { method: 'POST', body: form });
    },
    async applyImport(rows, mapping) {
        return this.json('/api/import/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows, mapping }),
        });
    },

    // ---- Export / Backup ----
    async exportData(format) {
        return this.blob(`/api/export/${format}`);
    },
    async getBackup() {
        return this.blob('/api/db/backup');
    },

    // ---- Stats ----
    async getStats() {
        return this.json('/api/stats');
    },
};
