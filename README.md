# ONIX Generator

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express)
![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

[English](#english) | [Русский](#русский)

---

## English

Web-based ONIX 3.0 metadata generator for e-books. Spreadsheet-style UI for managing hundreds of books, with full Bookwire specification support.

### Features

- **Spreadsheet table** — manage hundreds of books at once, inline editing, multi-select
- **Full ONIX 3.0** — Bookwire E-Book specification, short tags with refname attributes
- **SQLite database** — persistent storage with full-text search (FTS5)
- **8-tab detail panel** — all ONIX fields: basic info, contributors, subjects, description, publishing, pricing, rights, resources
- **Bulk operations** — select multiple books, apply price/category/language to all at once
- **Copy/paste** — Ctrl+C/V cells between rows, right-click context menu, fill down
- **International codelists** — BISAC (~100), Thema (1249), WGS (407), 250 countries, 46 currencies, 50 languages, 611 ONIX codes
- **Import XLSX/CSV** — drag & drop with column mapping
- **Export** — ONIX XML, XLSX, CSV, JSON, database backup
- **XML preview** — syntax-highlighted preview with copy/download
- **Dark/light theme**
- **ISBN-13 validation** — auto check digit calculation

### Quick Start

```bash
git clone https://github.com/al-nemirov/onix-generator.git
cd onix-generator
npm install
npm start
```

Open http://localhost:3000 in your browser.

### ONIX Specification

Generated XML follows **Bookwire ONIX E-Book Specification v1.0** (February 2023):

- ONIX 3.0 short tags with `refname` attributes
- EPUB only: E101 (reflowable), E101+E201 (fixed layout)
- Product identifiers: ISBN-13 (type 15) + EAN (type 03)
- Subjects: BISAC, Thema, WGS, keywords
- Prices: agency (42), fixed (04), RRP (02) with future price dates
- Sales rights: territorial, library/subscription/freemium restrictions, shop control
- Related products: alternative format (06), similar (23)
- Supporting resources: cover image, content file

### Project Structure

```
onix-generator/
├── server.js               # Express backend + ONIX XML engine
├── package.json
├── db/
│   └── schema.sql          # SQLite schema (9 tables + FTS5)
├── public/
│   ├── index.html          # SPA frontend
│   ├── css/app.css         # Flexbox layout, dark/light theme
│   └── js/
│       ├── app.js          # Main controller
│       ├── db.js           # API client
│       ├── table.js        # Column resize
│       ├── detail.js       # ISBN validation
│       ├── onix.js         # XML syntax highlighting
│       └── codelists.js    # Codelist loader
├── codelists/              # International classification data
│   ├── bisac.json          # BISAC subject codes
│   ├── thema.json          # Thema subject codes (1249)
│   ├── wgs.json            # WGS codes (407)
│   ├── languages.json      # ISO 639-2/B (50)
│   ├── currencies.json     # ISO 4217 (46)
│   ├── countries.json      # ISO 3166-1 (250)
│   └── onix-codes.json     # ONIX code lists (611)
└── LICENSE
```

### API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/books` | List books (with search, sort, pagination) |
| GET | `/api/books/:id` | Get book with all related data |
| POST | `/api/books` | Create book |
| PUT | `/api/books/:id` | Update book |
| DELETE | `/api/books` | Delete books (batch) |
| POST | `/api/books/clone` | Clone books |
| PUT | `/api/books/bulk` | Bulk update fields |
| POST | `/api/generate` | Download ONIX XML |
| POST | `/api/preview` | Preview ONIX XML |
| POST | `/api/import` | Upload XLSX/CSV |
| POST | `/api/import/apply` | Apply mapped import |
| GET | `/api/export/:format` | Export (xlsx/csv/json) |
| GET/PUT | `/api/settings` | Publisher settings |

### Requirements

- Node.js 18+
- npm

### Contributing

Contributions are welcome! Fork, create a branch, submit a PR.

---

## Русский

Веб-генератор метаданных ONIX 3.0 для электронных книг. Интерфейс в стиле таблицы для управления сотнями книг, полная поддержка спецификации Bookwire.

### Возможности

- **Таблица-spreadsheet** — управление сотнями книг, inline-редактирование, мульти-выделение
- **Полный ONIX 3.0** — спецификация Bookwire E-Book, short tags с refname
- **SQLite база данных** — постоянное хранение с полнотекстовым поиском (FTS5)
- **8 табов детальной панели** — все поля ONIX: основное, авторы, рубрики, описание, публикация, цены, права, ресурсы
- **Массовые операции** — выделить несколько книг, применить цену/рубрику/язык ко всем
- **Copy/paste** — Ctrl+C/V ячеек, контекстное меню, заполнение вниз
- **Международные справочники** — BISAC, Thema (1249), WGS (407), 250 стран, 46 валют, 50 языков, 611 кодов ONIX
- **Импорт XLSX/CSV** — drag & drop с маппингом колонок
- **Экспорт** — ONIX XML, XLSX, CSV, JSON, бэкап БД
- **Предпросмотр XML** — с подсветкой синтаксиса
- **Тёмная/светлая тема**
- **Валидация ISBN-13** — авто-расчёт контрольной цифры

### Быстрый старт

```bash
git clone https://github.com/al-nemirov/onix-generator.git
cd onix-generator
npm install
npm start
```

Откройте http://localhost:3000 в браузере.

### Спецификация ONIX

Генерируемый XML соответствует **Bookwire ONIX E-Book Specification v1.0** (февраль 2023):

- ONIX 3.0 short tags с атрибутами `refname`
- Только EPUB: E101 (reflowable), E101+E201 (fixed layout)
- ISBN-13 (type 15) + EAN (type 03)
- Рубрики: BISAC, Thema, WGS, ключевые слова
- Цены: agency (42), fixed (04), RRP (02) с future prices
- Права продаж: территориальные, библиотеки/подписки/freemium, контроль магазинов
- Связанные продукты: альтернативный формат (06), похожий (23)
- Ресурсы: обложка, файл контента

---

## Author / Автор

**Alexander Nemirov** — [GitHub](https://github.com/al-nemirov)

## License / Лицензия

[MIT](LICENSE)
