/**
 * DE Engine — simulates Salesforce Marketing Cloud Data Extensions
 * Data is loaded from /DataExtensions/*.csv at build time via import.meta.glob.
 * CSV column headers become field names. All lookups are case-insensitive on field names.
 */

// Load all CSV files from DataExtensions/ at build time
const rawFiles = import.meta.glob('/DataExtensions/*.csv', { query: '?raw', import: 'default', eager: true });

class DEEngine {
  constructor() {
    this._des = {};           // { deName: [{ col: val, ... }, ...] }
    this._uploadedNames = new Set();  // tracks user-uploaded DE names
    this._load(rawFiles);
  }

  _load(files) {
    for (const [path, content] of Object.entries(files)) {
      const name = path.split('/').pop().replace('.csv', '');
      this._des[name.toLowerCase()] = this._parseCSV(content);
    }
  }

  _parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = this._splitCSVLine(lines[0]);
    return lines.slice(1).map(line => {
      const vals = this._splitCSVLine(line);
      const row = {};
      headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
      return row;
    });
  }

  _splitCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  }

  /** Return the DE rows array by name (case-insensitive). */
  getDE(deName) {
    return this._des[String(deName).toLowerCase()] ?? [];
  }

  /** Replace DE data (used when user edits via the UI Data Panel). */
  setDE(deName, rows) {
    this._des[String(deName).toLowerCase()] = rows;
  }

  /** Public CSV parser — used by main.js for uploaded files. */
  parseCSV(text) { return this._parseCSV(text); }

  /** Add a user-uploaded DE (tracked separately for clear). */
  addUploadedDE(name, rows) {
    const key = String(name).toLowerCase();
    this._des[key] = rows;
    this._uploadedNames.add(key);
  }

  /** Remove all user-uploaded DEs. */
  removeUploadedDEs() {
    for (const key of this._uploadedNames) delete this._des[key];
    this._uploadedNames.clear();
  }

  /** Return names of user-uploaded DEs. */
  getUploadedNames() { return [...this._uploadedNames]; }

  /** Return all DE names for the UI selector. */
  getNames() {
    return Object.keys(this._des);
  }

  /**
   * Lookup(deName, returnField, lookupField, lookupValue)
   * Returns the first matching returnField value, or null.
   */
  lookup(deName, returnField, lookupField, lookupValue) {
    const rows = this.getDE(deName);
    const rf = String(returnField);
    const lf = String(lookupField);
    const lv = String(lookupValue ?? '');
    const row = rows.find(r => String(r[lf] ?? '') === lv);
    return row ? (row[rf] ?? null) : null;
  }

  /**
   * LookupRows(deName, lookupField, lookupValue)
   * Returns array of matching row objects.
   */
  lookupRows(deName, lookupField, lookupValue) {
    const rows = this.getDE(deName);
    const lf = String(lookupField);
    const lv = String(lookupValue ?? '');
    return rows.filter(r => String(r[lf] ?? '') === lv);
  }

  /**
   * LookupOrderedRows(deName, maxRows, lookupField, lookupValue, orderField, order)
   * Returns ordered, limited array of matching row objects.
   */
  lookupOrderedRows(deName, maxRows, lookupField, lookupValue, orderField, order = 'ASC') {
    let rows = this.lookupRows(deName, lookupField, lookupValue);
    if (orderField) {
      const dir = String(order).toUpperCase() === 'DESC' ? -1 : 1;
      rows = [...rows].sort((a, b) => {
        const av = a[orderField] ?? '';
        const bv = b[orderField] ?? '';
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    }
    return maxRows ? rows.slice(0, Number(maxRows)) : rows;
  }

  // ── Write operations (in-memory only — changes are visible to Lookup within the same render) ──

  /** InsertDE: add a new row to the DE. */
  insertRow(deName, row) {
    const key = String(deName).toLowerCase();
    if (!this._des[key]) this._des[key] = [];
    this._des[key].push(row);
  }

  /** UpdateDE: update fields on rows matching all keys. */
  updateRows(deName, keys, updates) {
    const rows = this.getDE(deName);
    rows.forEach(row => {
      const match = Object.entries(keys).every(([k, v]) => String(row[k] ?? '') === String(v ?? ''));
      if (match) Object.assign(row, updates);
    });
  }

  /** UpsertDE: update matching row or insert if no match found. */
  upsertRow(deName, keyFieldCount, data) {
    const entries = Object.entries(data);
    const keys    = Object.fromEntries(entries.slice(0, keyFieldCount));
    const rows    = this.getDE(deName);
    const existing = rows.find(row =>
      Object.entries(keys).every(([k, v]) => String(row[k] ?? '') === String(v ?? ''))
    );
    if (existing) {
      Object.assign(existing, data);
    } else {
      this.insertRow(deName, data);
    }
  }

  /** DeleteDE: remove rows matching all filter key/value pairs. */
  deleteRows(deName, filter) {
    const key = String(deName).toLowerCase();
    if (!this._des[key]) return;
    this._des[key] = this._des[key].filter(row =>
      !Object.entries(filter).every(([k, v]) => String(row[k] ?? '') === String(v ?? ''))
    );
  }

  /** Reset all DE data back to the original CSV-loaded state. */
  resetAll(originalData) {
    this._des = { ...originalData };
  }
}

export const deEngine = new DEEngine();
