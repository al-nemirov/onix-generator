/**
 * ONIX Generator — API Client
 * All communication with the Express/SQLite backend.
 */
const API = {
    // ---- Settings ----
    async getSettings() {
        const res = await fetch('/api/settings');
        return res.json();
    },
    async saveSettings(data) {
        const res = await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.json();
    },

    // ---- Books ----
    async getBooks(params = {}) {
        const qs = new URLSearchParams(params).toString();
        const res = await fetch(`/api/books?${qs}`);
        return res.json();
    },
    async getBook(id) {
        const res = await fetch(`/api/books/${id}`);
        return res.json();
    },
    async createBook(data = {}) {
        const res = await fetch('/api/books', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.json();
    },
    async updateBook(id, data) {
        const res = await fetch(`/api/books/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.json();
    },
    async deleteBooks(ids) {
        const res = await fetch('/api/books', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
        return res.json();
    },
    async cloneBooks(ids) {
        const res = await fetch('/api/books/clone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
        return res.json();
    },
    async bulkUpdate(ids, fields) {
        const res = await fetch('/api/books/bulk', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, fields })
        });
        return res.json();
    },

    // ---- ONIX Generation ----
    async generateXml(bookIds = null) {
        const res = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookIds })
        });
        return res.blob();
    },
    async previewXml(bookIds = null) {
        const res = await fetch('/api/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookIds })
        });
        return res.json();
    },

    // ---- Import ----
    async uploadFile(file) {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/import', { method: 'POST', body: form });
        return res.json();
    },
    async applyImport(rows, mapping) {
        const res = await fetch('/api/import/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows, mapping })
        });
        return res.json();
    },

    // ---- Stats ----
    async getStats() {
        const res = await fetch('/api/stats');
        return res.json();
    }
};
