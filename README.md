# ONIX Generator

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express)
![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)
![i18n](https://img.shields.io/badge/i18n-EN%20%7C%20ES%20%7C%20DE%20%7C%20RU-blue)

[English](#english) | [Español](#español) | [Deutsch](#deutsch) | [Русский](#русский)

---

## English

Free web-based ONIX 3.0 metadata editor for e-books. Spreadsheet-style UI for managing hundreds of books, with full Bookwire specification support.

### Screenshots

Screenshots are temporarily unavailable in this repository (the `docs/screenshots/` directory is currently empty).
If needed, run the app locally and capture the main views: `Main Table`, `Book Details`, `Settings`, `Bulk Edit`, `Import`, `Export`.

### Features

- **Spreadsheet table** — manage hundreds of books at once, inline editing, multi-select
- **Full ONIX 3.0** — Bookwire E-Book specification, short tags with refname attributes
- **4 interface languages** — English, Spanish, German, Russian
- **SQLite database** — persistent storage with full-text search (FTS5)
- **8-tab detail panel** — all ONIX fields: basic info, contributors, subjects, description, publishing, pricing, rights, resources
- **Bulk operations** — select multiple books, apply price/category/language to all at once
- **Copy/paste** — Ctrl+C/V cells between rows, right-click context menu, fill down
- **International codelists** — BISAC (1417), Thema (1249), WGS (407), 250 countries, 46 currencies, 50 languages, 611 ONIX codes
- **Import XLSX/CSV** — drag & drop with column mapping
- **Export** — ONIX XML, XLSX, CSV, JSON, database backup
- **XML preview** — syntax-highlighted preview with copy/download
- **Dark/light theme**
- **ISBN-13 validation** — auto check digit calculation
- **API authentication** — X-API-Key header, role-based access

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
│   ├── i18n/               # Translation files
│   │   ├── en.json
│   │   ├── es.json
│   │   ├── de.json
│   │   └── ru.json
│   └── js/
│       ├── app.js          # Main controller
│       ├── db.js           # API client
│       ├── i18n.js         # Internationalization runtime
│       ├── table.js        # Column resize
│       ├── detail.js       # ISBN validation
│       ├── onix.js         # XML syntax highlighting
│       └── codelists.js    # Codelist loader
├── codelists/              # International classification data
│   ├── bisac.json          # BISAC subject codes (1417)
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
| GET | `/api/books` | List books (search, filters, sort, pagination; sort includes table columns e.g. authors, price, territory) |
| GET | `/api/books/ids` | All book ids matching current search/filters (up to 50k; for bulk selection) |
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

All API endpoints require `X-API-Key` header.

### Requirements

- Node.js 18+
- npm

---

## Español

Editor web gratuito de metadatos ONIX 3.0 para libros electrónicos. Interfaz tipo hoja de cálculo para gestionar cientos de libros, con soporte completo de la especificación Bookwire.

### Capturas de pantalla

Las capturas de pantalla no están disponibles temporalmente en este repositorio (el directorio `docs/screenshots/` está vacío).
Si hace falta, ejecute la app localmente y capture estas vistas: `Main Table`, `Book Details`, `Settings`, `Bulk Edit`, `Import`, `Export`.

### Funcionalidades

- **Tabla tipo hoja de cálculo** — gestione cientos de libros a la vez, edición en línea, selección múltiple
- **ONIX 3.0 completo** — especificación Bookwire E-Book, etiquetas cortas con atributos refname
- **4 idiomas de interfaz** — inglés, español, alemán, ruso
- **Base de datos SQLite** — almacenamiento persistente con búsqueda de texto completo (FTS5)
- **Panel de detalle con 8 pestañas** — todos los campos ONIX: información básica, colaboradores, temas, descripción, publicación, precios, derechos, recursos
- **Operaciones masivas** — seleccione varios libros, aplique precio/categoría/idioma a todos a la vez
- **Copiar/pegar** — Ctrl+C/V entre celdas, menú contextual, rellenar hacia abajo
- **Clasificadores internacionales** — BISAC (1417), Thema (1249), WGS (407), 250 países, 46 monedas, 50 idiomas, 611 códigos ONIX
- **Importar XLSX/CSV** — arrastrar y soltar con mapeo de columnas
- **Exportar** — ONIX XML, XLSX, CSV, JSON, copia de seguridad de la base de datos
- **Vista previa XML** — con resaltado de sintaxis, copiar/descargar
- **Tema oscuro/claro**
- **Validación ISBN-13** — cálculo automático del dígito de control
- **Autenticación API** — cabecera X-API-Key, acceso basado en roles

### Inicio rápido

```bash
git clone https://github.com/al-nemirov/onix-generator.git
cd onix-generator
npm install
npm start
```

Abra http://localhost:3000 en su navegador.

### Especificación ONIX

El XML generado sigue la **Bookwire ONIX E-Book Specification v1.0** (febrero 2023):

- ONIX 3.0 etiquetas cortas con atributos `refname`
- Solo EPUB: E101 (reflowable), E101+E201 (maquetación fija)
- Identificadores: ISBN-13 (tipo 15) + EAN (tipo 03)
- Temas: BISAC, Thema, WGS, palabras clave
- Precios: agencia (42), fijo (04), PVP (02) con fechas de precio futuro
- Derechos de venta: territoriales, bibliotecas/suscripciones/freemium
- Productos relacionados: formato alternativo (06), similar (23)
- Recursos: imagen de portada, archivo de contenido

---

## Deutsch

Kostenloser webbasierter ONIX 3.0 Metadaten-Editor für E-Books. Tabellenkalkulationsartige Oberfläche zur Verwaltung Hunderter Bücher, mit vollständiger Bookwire-Spezifikationsunterstützung.

### Bildschirmfotos

Screenshots sind in diesem Repository derzeit nicht verfugbar (das Verzeichnis `docs/screenshots/` ist leer).
Falls notig, starten Sie die App lokal und erstellen Sie Aufnahmen dieser Ansichten: `Main Table`, `Book Details`, `Settings`, `Bulk Edit`, `Import`, `Export`.

### Funktionen

- **Tabellenkalkulations-Ansicht** — verwalten Sie Hunderte Bücher gleichzeitig, Inline-Bearbeitung, Mehrfachauswahl
- **Vollständiges ONIX 3.0** — Bookwire E-Book-Spezifikation, Kurztags mit refname-Attributen
- **4 Oberflächensprachen** — Englisch, Spanisch, Deutsch, Russisch
- **SQLite-Datenbank** — persistente Speicherung mit Volltextsuche (FTS5)
- **Detailpanel mit 8 Tabs** — alle ONIX-Felder: Grunddaten, Mitwirkende, Themen, Beschreibung, Veröffentlichung, Preise, Rechte, Ressourcen
- **Massenoperationen** — mehrere Bücher auswählen, Preis/Kategorie/Sprache auf alle anwenden
- **Kopieren/Einfügen** — Ctrl+C/V zwischen Zellen, Kontextmenü, nach unten ausfüllen
- **Internationale Klassifikationen** — BISAC (1417), Thema (1249), WGS (407), 250 Länder, 46 Währungen, 50 Sprachen, 611 ONIX-Codes
- **XLSX/CSV-Import** — Drag & Drop mit Spaltenzuordnung
- **Export** — ONIX XML, XLSX, CSV, JSON, Datenbank-Backup
- **XML-Vorschau** — mit Syntaxhervorhebung, Kopieren/Herunterladen
- **Dunkles/helles Design**
- **ISBN-13-Validierung** — automatische Prüfziffernberechnung
- **API-Authentifizierung** — X-API-Key-Header, rollenbasierter Zugriff

### Schnellstart

```bash
git clone https://github.com/al-nemirov/onix-generator.git
cd onix-generator
npm install
npm start
```

Öffnen Sie http://localhost:3000 in Ihrem Browser.

### ONIX-Spezifikation

Das generierte XML entspricht der **Bookwire ONIX E-Book Specification v1.0** (Februar 2023):

- ONIX 3.0 Kurztags mit `refname`-Attributen
- Nur EPUB: E101 (Reflowable), E101+E201 (Festes Layout)
- Produktidentifikatoren: ISBN-13 (Typ 15) + EAN (Typ 03)
- Themen: BISAC, Thema, WGS, Schlagwörter
- Preise: Agentur (42), Festpreis (04), UVP (02) mit zukünftigen Preisdaten
- Vertriebsrechte: territorial, Bibliotheken/Abonnements/Freemium
- Verwandte Produkte: alternatives Format (06), ähnlich (23)
- Ressourcen: Coverbild, Inhaltsdatei

---

## Русский

Бесплатный веб-редактор метаданных ONIX 3.0 для электронных книг. Интерфейс в стиле таблицы для управления сотнями книг, полная поддержка спецификации Bookwire.

### Скриншоты

Скриншоты временно отсутствуют в этом репозитории (каталог `docs/screenshots/` сейчас пустой).
При необходимости запустите приложение локально и сделайте снимки экранов для: `Main Table`, `Book Details`, `Settings`, `Bulk Edit`, `Import`, `Export`.

### Возможности

- **Таблица-spreadsheet** — управление сотнями книг, inline-редактирование, мульти-выделение
- **Полный ONIX 3.0** — спецификация Bookwire E-Book, short tags с refname
- **4 языка интерфейса** — английский, испанский, немецкий, русский
- **SQLite база данных** — постоянное хранение с полнотекстовым поиском (FTS5)
- **8 табов детальной панели** — все поля ONIX: основное, авторы, рубрики, описание, публикация, цены, права, ресурсы
- **Массовые операции** — выделить несколько книг, применить цену/рубрику/язык ко всем
- **Copy/paste** — Ctrl+C/V ячеек, контекстное меню, заполнение вниз
- **Международные справочники** — BISAC (1417), Thema (1249), WGS (407), 250 стран, 46 валют, 50 языков, 611 кодов ONIX
- **Импорт XLSX/CSV** — drag & drop с маппингом колонок
- **Экспорт** — ONIX XML, XLSX, CSV, JSON, бэкап БД
- **Предпросмотр XML** — с подсветкой синтаксиса
- **Тёмная/светлая тема**
- **Валидация ISBN-13** — авто-расчёт контрольной цифры
- **Аутентификация API** — заголовок X-API-Key, ролевой доступ

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
- Права продаж: территориальные, библиотеки/подписки/freemium
- Связанные продукты: альтернативный формат (06), похожий (23)
- Ресурсы: обложка, файл контента

---

## Author / Автор

**Alexander Nemirov** — [GitHub](https://github.com/al-nemirov)

## License / Лицензия

[MIT](LICENSE)
