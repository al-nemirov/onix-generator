/**
 * ONIX Generator — Codelists Manager
 * Loads codelist JSON files and provides lookup/search functions.
 */
const Codelists = {
    bisac: [],
    thema: [],
    wgs: [],
    languages: [],
    currencies: [],
    countries: [],
    onixCodes: {},
    t(key, vars = {}) {
        if (window.I18N && typeof window.I18N.t === 'function') {
            return window.I18N.t(key, vars);
        }
        return key;
    },

    async load() {
        const [bisac, thema, wgs, languages, currencies, countries, onixCodes] = await Promise.all([
            fetch('/codelists/bisac.json').then(r => r.json()).catch(() => []),
            fetch('/codelists/thema.json').then(r => r.json()).catch(() => []),
            fetch('/codelists/wgs.json').then(r => r.json()).catch(() => []),
            fetch('/codelists/languages.json').then(r => r.json()).catch(() => []),
            fetch('/codelists/currencies.json').then(r => r.json()).catch(() => []),
            fetch('/codelists/countries.json').then(r => r.json()).catch(() => []),
            fetch('/codelists/onix-codes.json').then(r => r.json()).catch(() => ({}))
        ]);
        this.bisac = bisac;
        this.thema = thema;
        this.wgs = wgs;
        this.languages = languages;
        this.currencies = currencies;
        this.countries = countries;
        this.onixCodes = onixCodes;
        console.log(`Codelists loaded: BISAC=${bisac.length}, Thema=${thema.length}, WGS=${wgs.length}, Lang=${languages.length}, Currency=${currencies.length}, Countries=${countries.length}`);
    },

    /** Search within a codelist by code or text */
    search(list, query, limit = 20) {
        if (!query) return list.slice(0, limit);
        const q = query.toLowerCase();
        return list.filter(item =>
            item.code.toLowerCase().includes(q) ||
            item.text.toLowerCase().includes(q)
        ).slice(0, limit);
    },

    /** Get text for a code from a codelist */
    getText(list, code) {
        if (!code) return '';
        const item = list.find(i => i.code === code);
        return item ? item.text : code;
    },

    /** Get codelist by scheme ID */
    getListByScheme(schemeId) {
        switch (schemeId) {
            case '10': return this.bisac;
            case '93': return this.thema;
            case '26': return this.wgs;
            default: return [];
        }
    },

    /** Populate a <select> element from a codelist */
    populateSelect(selectEl, list, options = {}) {
        const { placeholder, selectedValue, addEmpty = true } = options;
        selectEl.innerHTML = '';
        if (addEmpty) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = placeholder || this.t('ui.select');
            selectEl.appendChild(opt);
        }
        for (const item of list) {
            const opt = document.createElement('option');
            opt.value = item.code;
            opt.textContent = `${item.code} — ${item.text}`;
            if (item.code === selectedValue) opt.selected = true;
            selectEl.appendChild(opt);
        }
    },

    /** Populate select from ONIX code list object */
    populateOnixSelect(selectEl, listName, selectedValue = '') {
        const list = this.onixCodes[listName] || [];
        selectEl.innerHTML = '';
        for (const item of list) {
            const opt = document.createElement('option');
            opt.value = item.code;
            opt.textContent = `${item.code} — ${item.text}`;
            if (item.code === selectedValue) opt.selected = true;
            selectEl.appendChild(opt);
        }
    }
};
