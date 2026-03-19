import './style.css';
import { AMPscriptEngine } from './ampscript-engine.js';
import { deEngine } from './de-engine.js';
import { samples } from './samples.js';

// ── Load subscriber.json ───────────────────────────────────────────────────
const subscriberModules = import.meta.glob('/subscriber.json', { import: 'default', eager: true });
let subscriberData = {};
for (const mod of Object.values(subscriberModules)) {
  subscriberData = mod;
}

// ── State ──────────────────────────────────────────────────────────────────
let renderTimer    = null;
let currentDEName  = deEngine.getNames()[0] ?? '';
let subscriberList = [];   // [] = single-subscriber mode (editor textarea)
let currentSubIdx  = 0;

// Content blocks (3 fixed slots, editable Name/Key/ID + HTML)
const CB_LS_KEY = 'mce-dev-content-blocks';
let contentBlocks = [
  { name: 'Block 1', key: '7160b2dc-0351-4836-87b9-a7b66c312d61', id: '5593491', html: '' },
  { name: 'Block 2', key: '2160b2dc-0351-4836-87b9-a7b66c312d61', id: '3333491', html: '' },
  { name: 'Block 3', key: '9160b2dc-0351-4836-87b9-a7b66c312d61', id: '1213491', html: '' },
];

// ── DOM refs ───────────────────────────────────────────────────────────────
const templateEditor   = document.getElementById('template-editor');
const previewFrame     = document.getElementById('preview-frame');
const errorBar         = document.getElementById('error-bar');
const sampleSelect     = document.getElementById('sample-select');
const modeBadge        = document.getElementById('mode-badge');
const deSelect         = document.getElementById('de-select');
const deUploadInput    = document.getElementById('de-upload-input');
const deUploadBtn      = document.getElementById('de-upload-btn');
const deClearBtn       = document.getElementById('de-clear-btn');
const deRowsEditor     = document.getElementById('de-rows-editor');
const subscriberEditor = document.getElementById('subscriber-editor');
const subUploadInput   = document.getElementById('sub-upload-input');
const subUploadBtn     = document.getElementById('sub-upload-btn');
const subClearBtn      = document.getElementById('sub-clear-btn');
const subCount         = document.getElementById('sub-count');
const subPrevBtn       = document.getElementById('sub-prev-btn');
const subNextBtn       = document.getElementById('sub-next-btn');
const subNavInfo       = document.getElementById('sub-nav-info');
const paramsEditor     = document.getElementById('params-editor');
const httpEditor       = document.getElementById('http-editor');
const writeLogDetails  = document.getElementById('write-log-details');
const writeLogBody     = document.getElementById('write-log-body');
const writeLogCount    = document.getElementById('write-log-count');

// ── Populate sample selector ───────────────────────────────────────────────
samples.forEach((s, i) => {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = s.label;
  sampleSelect.appendChild(opt);
});

// ── DE selector helpers ────────────────────────────────────────────────────
const LS_KEY = 'mce-dev-uploaded-des';

function rebuildDEDropdown() {
  const prev = deSelect.value;
  deSelect.innerHTML = '';
  deEngine.getNames().forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name + (deEngine.getUploadedNames().includes(name) ? ' ↑' : '');
    deSelect.appendChild(opt);
  });
  // Restore selection if still valid, else fall back to first
  deSelect.value = deEngine.getNames().includes(prev) ? prev : (deEngine.getNames()[0] ?? '');
  currentDEName = deSelect.value;
  if (currentDEName) loadDEIntoEditor(currentDEName);
}

function persistUploadedDEs() {
  const data = {};
  deEngine.getUploadedNames().forEach(n => { data[n] = deEngine.getDE(n); });
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

function restoreUploadedDEs() {
  try {
    const stored = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    for (const [name, rows] of Object.entries(stored)) {
      deEngine.addUploadedDE(name, rows);
    }
  } catch (_) { /* ignore corrupt storage */ }
}

// Restore persisted uploads before building dropdown
restoreUploadedDEs();

// Populate DE dropdown (uses all current DE names)
rebuildDEDropdown();

// Snapshot the Subscribers DE in its initial state (before any subscriber-list override).
// Used to restore when the subscriber list is cleared.
const originalSubscribersDE = deEngine.getDE('Subscribers').map(r => ({ ...r }));

// Upload CSV button → trigger hidden file input
deUploadBtn.addEventListener('click', () => deUploadInput.click());

// Handle file selection
deUploadInput.addEventListener('change', () => {
  const files = [...deUploadInput.files];
  if (!files.length) return;
  let loaded = 0;
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      const name = file.name.replace(/\.csv$/i, '');
      const rows = deEngine.parseCSV(e.target.result);
      deEngine.addUploadedDE(name, rows);
      loaded++;
      if (loaded === files.length) {
        persistUploadedDEs();
        rebuildDEDropdown();
        // Select the last uploaded DE
        deSelect.value = String(files[files.length - 1].name.replace(/\.csv$/i, '')).toLowerCase();
        currentDEName = deSelect.value;
        loadDEIntoEditor(currentDEName);
      }
    };
    reader.readAsText(file);
  });
  deUploadInput.value = ''; // allow re-uploading same file
});

// Clear all uploaded DEs
deClearBtn.addEventListener('click', () => {
  deEngine.removeUploadedDEs();
  localStorage.removeItem(LS_KEY);
  rebuildDEDropdown();
});

// ── Subscriber list (multi-subscriber CSV upload) ──────────────────────────
const SUB_LS_KEY = 'mce-dev-subscriber-list';

function persistSubscriberList() {
  localStorage.setItem(SUB_LS_KEY, JSON.stringify(subscriberList));
}

function restoreSubscriberList() {
  try {
    const stored = JSON.parse(localStorage.getItem(SUB_LS_KEY) || '[]');
    if (Array.isArray(stored) && stored.length > 0) {
      subscriberList = stored;
      currentSubIdx  = 0;
    }
  } catch (_) { /* ignore corrupt storage */ }
}

/** Sync Prev/Next button states, count badge, and subscriber editor textarea. */
function updateSubNav() {
  const total = subscriberList.length;
  if (total === 0) {
    subNavInfo.textContent = '';
    subCount.textContent   = '';
    subPrevBtn.disabled    = true;
    subNextBtn.disabled    = true;
  } else {
    subNavInfo.textContent = `${currentSubIdx + 1} / ${total}`;
    subCount.textContent   = `${total} subscriber${total === 1 ? '' : 's'}`;
    subPrevBtn.disabled    = currentSubIdx === 0;
    subNextBtn.disabled    = currentSubIdx === total - 1;
    // Mirror the active subscriber into the editor so users can see its data
    subscriberEditor.value = JSON.stringify(subscriberList[currentSubIdx], null, 2);
  }
}

// Restore persisted subscriber list before first render
restoreSubscriberList();

// Upload CSV → parse rows → store as subscriber list
subUploadBtn.addEventListener('click', () => subUploadInput.click());
subUploadInput.addEventListener('change', () => {
  const file = subUploadInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const rows = deEngine.parseCSV(e.target.result);
    if (!rows.length) return;
    subscriberList = rows;
    currentSubIdx  = 0;
    persistSubscriberList();
    // Immediately sync to Subscribers DE so Lookup() calls work,
    // and refresh the DE panel editor if the user is currently viewing it.
    deEngine.setDE('Subscribers', subscriberList);
    if (currentDEName.toLowerCase() === 'subscribers') loadDEIntoEditor(currentDEName);
    updateSubNav();
    scheduleRender();
  };
  reader.readAsText(file);
  subUploadInput.value = ''; // allow re-upload of same file
});

// Clear subscriber list → fall back to single-subscriber editor
subClearBtn.addEventListener('click', () => {
  subscriberList = [];
  currentSubIdx  = 0;
  localStorage.removeItem(SUB_LS_KEY);
  subscriberEditor.value = JSON.stringify(subscriberData, null, 2);
  // Restore the Subscribers DE to its pre-upload state
  deEngine.setDE('Subscribers', originalSubscribersDE);
  if (currentDEName.toLowerCase() === 'subscribers') loadDEIntoEditor(currentDEName);
  updateSubNav();
  scheduleRender();
});

// Prev / Next navigation
subPrevBtn.addEventListener('click', () => {
  if (currentSubIdx > 0) { currentSubIdx--; updateSubNav(); render(); }
});
subNextBtn.addEventListener('click', () => {
  if (currentSubIdx < subscriberList.length - 1) { currentSubIdx++; updateSubNav(); render(); }
});

// ── Initialize editors ─────────────────────────────────────────────────────
subscriberEditor.value = JSON.stringify(subscriberData, null, 2);

// ── Parse URL/Form params from textarea (key=value lines) ──────────────────
function parseParams(text) {
  const map = {};
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) {
      map[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  }
  return map;
}

// ── Parse mock HTTP JSON ───────────────────────────────────────────────────
function parseMockHttp(text) {
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

// ── Render ─────────────────────────────────────────────────────────────────
function render() {
  let sub = {};
  if (subscriberList.length > 0) {
    // Multi-subscriber mode: use the currently selected subscriber
    sub = subscriberList[currentSubIdx] ?? {};
  } else {
    // Single-subscriber mode: parse editor textarea
    try { sub = JSON.parse(subscriberEditor.value); } catch (_) { sub = subscriberData; }
  }

  // Apply DE edits from the panel
  try {
    const edited = JSON.parse(deRowsEditor.value);
    if (Array.isArray(edited)) deEngine.setDE(currentDEName, edited);
  } catch (_) { /* keep */ }

  // When a subscriber list is loaded it IS the Subscribers DE — always override
  // AFTER the panel sync so it wins even if the user has Subscribers DE selected.
  if (subscriberList.length > 0) {
    deEngine.setDE('Subscribers', subscriberList);
  }

  const params   = parseParams(paramsEditor.value);
  const mockHttp = parseMockHttp(httpEditor.value);

  const engine = new AMPscriptEngine(sub, params, mockHttp, contentBlocks);
  const { html, error, writeLog } = engine.render(templateEditor.value);

  // Error bar
  if (error) {
    errorBar.textContent = '⚠ ' + error;
    errorBar.classList.add('visible');
  } else {
    errorBar.classList.remove('visible');
  }

  // Write log
  if (writeLog && writeLog.length > 0) {
    writeLogCount.textContent = `(${writeLog.length})`;
    writeLogBody.textContent = JSON.stringify(writeLog, null, 2);
    writeLogDetails.style.display = 'block';
  } else {
    writeLogDetails.style.display = 'none';
    writeLogBody.textContent = '';
    writeLogCount.textContent = '';
  }

  // Preview
  const doc = previewFrame.contentDocument || previewFrame.contentWindow.document;
  doc.open();
  doc.write(html || '<p style="font-family:sans-serif;color:#aaa;padding:24px;">No output yet.</p>');
  doc.close();
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 300);
}

// ── Load sample ────────────────────────────────────────────────────────────
function loadSample(index) {
  const s = samples[index];
  if (!s) return;
  templateEditor.value = s.template.trim();
  modeBadge.textContent = s.mode === 'landing-page' ? 'Landing Page' : 'Email';
  scheduleRender();
}

// ── DE panel sync ──────────────────────────────────────────────────────────
function loadDEIntoEditor(name) {
  deRowsEditor.value = JSON.stringify(deEngine.getDE(name), null, 2);
}

deSelect.addEventListener('change', () => {
  currentDEName = deSelect.value;
  loadDEIntoEditor(currentDEName);
});

// ── Tab switching (data panel) ─────────────────────────────────────────────
document.querySelectorAll('.panel-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + target).classList.add('active');
  });
});

// ── Content block state + wiring ───────────────────────────────────────────
function persistContentBlocks() {
  localStorage.setItem(CB_LS_KEY, JSON.stringify(contentBlocks));
}

function updateCBTabLabel(idx) {
  const tab = document.getElementById(`tmpl-tab-block-${idx}`);
  if (tab) tab.textContent = contentBlocks[idx].name || `Block ${idx + 1}`;
}

function restoreContentBlocks() {
  try {
    const stored = JSON.parse(localStorage.getItem(CB_LS_KEY) || '[]');
    if (Array.isArray(stored) && stored.length === 3) contentBlocks = stored;
  } catch (_) { /* use defaults */ }
  // Populate inputs and textareas from state
  document.querySelectorAll('.cb-name').forEach(el => {
    const idx = Number(el.dataset.idx);
    el.value = contentBlocks[idx].name;
    updateCBTabLabel(idx);
  });
  document.querySelectorAll('.cb-key').forEach(el => {
    el.value = contentBlocks[Number(el.dataset.idx)].key;
  });
  document.querySelectorAll('.cb-id').forEach(el => {
    el.value = contentBlocks[Number(el.dataset.idx)].id;
  });
  document.querySelectorAll('.cb-editor').forEach(el => {
    el.value = contentBlocks[Number(el.dataset.idx)].html;
  });
}

restoreContentBlocks();

// Template tab bar switching
document.querySelectorAll('.tmpl-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tmpl-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tmpl-pane').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tmpl-pane-' + tab.dataset.pane).classList.add('active');
  });
});

// Content block metadata inputs
document.querySelectorAll('.cb-name').forEach(input => {
  input.addEventListener('input', () => {
    const idx = Number(input.dataset.idx);
    contentBlocks[idx].name = input.value;
    updateCBTabLabel(idx);
    persistContentBlocks();
  });
});
document.querySelectorAll('.cb-key').forEach(input => {
  input.addEventListener('input', () => {
    contentBlocks[Number(input.dataset.idx)].key = input.value;
    persistContentBlocks();
  });
});
document.querySelectorAll('.cb-id').forEach(input => {
  input.addEventListener('input', () => {
    contentBlocks[Number(input.dataset.idx)].id = input.value;
    persistContentBlocks();
  });
});

// Content block HTML editors
document.querySelectorAll('.cb-editor').forEach(ta => {
  ta.addEventListener('input', () => {
    contentBlocks[Number(ta.dataset.idx)].html = ta.value;
    persistContentBlocks();
    scheduleRender();
  });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart;
      ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(s);
      ta.selectionStart = ta.selectionEnd = s + 2;
    }
  });
});

// ── Reference bar data ─────────────────────────────────────────────────────
const REF = {
  'output': [
    { name: 'v(@var)',    syntax: "%%=v(@var)=%%",              desc: 'Inline output of a variable',           snippet: "%%=v(@var)=%%" },
    { name: 'OUTPUT()',   syntax: "%%[ OUTPUT(v(@var)) ]%%",    desc: 'Block output statement',                snippet: "%%[ OUTPUT(v(@var)) ]%%" },
    { name: 'SET',        syntax: "%%[ SET @var = 'value' ]%%", desc: 'Assign a value to a variable',          snippet: "%%[ SET @var = 'value' ]%%" },
    { name: 'VAR',        syntax: "%%[ VAR @var ]%%",           desc: 'Declare a variable (null default)',     snippet: "%%[ VAR @var ]%%" },
  ],
  'control': [
    { name: 'IF / ELSEIF / ELSE', syntax: "%%[ IF @x == 'a' THEN ]%% … %%[ ENDIF ]%%", desc: 'Conditional block spanning any number of %%[ ]%% segments', snippet: "%%[ IF @var == 'x' THEN\n]%%\n%%[\nELSE\n]%%\n%%[\nENDIF\n]%%" },
    { name: 'FOR / NEXT',         syntax: "%%[ FOR @i = 1 TO @n DO ]%% … %%[ NEXT ]%%", desc: 'Count-controlled loop',                                     snippet: "%%[ FOR @i = 1 TO @count DO\n]%%\n%%[\nNEXT\n]%%" },
  ],
  'de-read': [
    { name: 'Lookup()',            syntax: "Lookup('DE','Return','Lookup',@val)",         desc: 'Return first matching field value',          snippet: "%%=Lookup('DEName','ReturnField','LookupField',@val)=%%" },
    { name: 'LookupRows()',        syntax: "LookupRows('DE','Field',@val)",               desc: 'Return all matching rows as a row set',      snippet: "%%[ SET @rows = LookupRows('DEName','Field',@val) ]%%" },
    { name: 'LookupOrderedRows()',   syntax: "LookupOrderedRows('DE',10,'F',@v,'Sort','ASC')", desc: 'Return sorted & limited row set',              snippet: "%%[ SET @rows = LookupOrderedRows('DEName',10,'Field',@val,'SortField','ASC') ]%%" },
    { name: 'LookupRowsCS()',       syntax: "LookupRowsCS('DE','Field',@val)",               desc: 'Case-sensitive row lookup (simulated same as LookupRows)', snippet: "%%[ SET @rows = LookupRowsCS('DEName','Field',@val) ]%%" },
    { name: 'LookupOrderedRowsCS()',syntax: "LookupOrderedRowsCS('DE',10,'F',@v,'S','ASC')", desc: 'Case-sensitive ordered row lookup',            snippet: "%%[ SET @rows = LookupOrderedRowsCS('DEName',10,'Field',@val,'SortField','ASC') ]%%" },
    { name: 'RowCount()',           syntax: "RowCount(@rows)",                               desc: 'Number of rows in a row set',                 snippet: "%%=RowCount(@rows)=%%" },
    { name: 'Row()',               syntax: "Row(@rows, @i)",                              desc: 'Get a single row by 1-based index',         snippet: "%%[ SET @row = Row(@rows,@i) ]%%" },
    { name: 'Field()',             syntax: "Field(@row,'Column')",                        desc: 'Get a column value from a row object',      snippet: "%%=Field(@row,'ColumnName')=%%" },
  ],
  'de-write': [
    { name: 'UpsertDE()',  syntax: "UpsertDE('DE',1,'Key',@k,'Field',@v)", desc: 'Insert or update a row matching key fields', snippet: "%%[ UpsertDE('DEName',1,'KeyField',@keyVal,'Field2',@val2) ]%%" },
    { name: 'InsertDE()',  syntax: "InsertDE('DE','Field',@v)",            desc: 'Add a new row unconditionally',             snippet: "%%[ InsertDE('DEName','Field1',@val1,'Field2',@val2) ]%%" },
    { name: 'UpdateDE()',  syntax: "UpdateDE('DE',1,'Key',@k,'F',@v)",    desc: 'Update fields on all matching rows',        snippet: "%%[ UpdateDE('DEName',1,'KeyField',@keyVal,'UpdateField',@newVal) ]%%" },
    { name: 'DeleteDE()',  syntax: "DeleteDE('DE','KeyField',@k)",         desc: 'Remove rows matching key field',            snippet: "%%[ DeleteDE('DEName','KeyField',@keyVal) ]%%" },
  ],
  'string': [
    { name: 'Concat()',                  syntax: "Concat('a','b',...)",        desc: 'Join two or more strings',                    snippet: "%%=Concat('a','b')=%%" },
    { name: 'Trim()',                    syntax: "Trim(@var)",                 desc: 'Strip leading and trailing spaces',           snippet: "%%=Trim(@var)=%%" },
    { name: 'Uppercase()',               syntax: "Uppercase(@var)",            desc: 'Convert string to upper case',                snippet: "%%=Uppercase(@var)=%%" },
    { name: 'Lowercase()',               syntax: "Lowercase(@var)",            desc: 'Convert string to lower case',                snippet: "%%=Lowercase(@var)=%%" },
    { name: 'ProperCase()',              syntax: "ProperCase(@var)",           desc: 'Capitalize each word',                        snippet: "%%=ProperCase(@var)=%%" },
    { name: 'Substring()',               syntax: "Substring(@var,1,5)",        desc: 'Extract characters by start position and length', snippet: "%%=Substring(@var,1,5)=%%" },
    { name: 'IndexOf()',                 syntax: "IndexOf(@var,'text')",       desc: '1-based position of substring (0 = not found)', snippet: "%%=IndexOf(@var,'text')=%%" },
    { name: 'Replace()',                 syntax: "Replace(@var,'old','new')",  desc: 'Find and replace all occurrences',            snippet: "%%=Replace(@var,'old','new')=%%" },
    { name: 'Length()',                  syntax: "Length(@var)",               desc: 'Character count of a string',                 snippet: "%%=Length(@var)=%%" },
    { name: 'RegExMatch()',              syntax: "RegExMatch(@var,'\\d+')",    desc: 'Return first regex match',                    snippet: "%%=RegExMatch(@var,'\\d+')=%%" },
    { name: 'BuildRowsetFromString()',   syntax: "BuildRowsetFromString(@v,',')", desc: 'Split delimited string into a row set',   snippet: "%%=BuildRowsetFromString(@var,',')=%%" },
    { name: 'EscapeXML()',              syntax: "EscapeXML(@var)",            desc: 'Escape HTML/XML special characters',          snippet: "%%=EscapeXML(@var)=%%" },
    { name: 'Base64Encode()',            syntax: "Base64Encode(@var)",            desc: 'Encode string to Base64',                          snippet: "%%=Base64Encode(@var)=%%" },
    { name: 'Base64Decode()',            syntax: "Base64Decode(@var)",            desc: 'Decode a Base64 string',                           snippet: "%%=Base64Decode(@var)=%%" },
    { name: 'URLEncode()',               syntax: "URLEncode(@url)",               desc: 'Percent-encode a string for use in a URL',         snippet: "%%=URLEncode(@url)=%%" },
    { name: 'URLDecode()',               syntax: "URLDecode(@encoded)",           desc: 'Decode a percent-encoded URL string',              snippet: "%%=URLDecode(@encoded)=%%" },
    { name: 'StringToHex()',             syntax: "StringToHex(@var)",             desc: 'Convert string to hexadecimal representation',    snippet: "%%=StringToHex(@var)=%%" },
    { name: 'HexToString()',             syntax: "HexToString(@hex)",             desc: 'Convert hex string back to text',                  snippet: "%%=HexToString(@hex)=%%" },
    { name: 'ReplaceList()',             syntax: "ReplaceList(@s,'a','1','b','2')", desc: 'Replace multiple find/replace pairs in one call', snippet: "%%=ReplaceList(@str,'old1','new1','old2','new2')=%%" },
    { name: 'BuildRowsetFromJSON()',     syntax: "BuildRowsetFromJSON(@json)",     desc: 'Parse a JSON array string into a row set',        snippet: "%%=BuildRowsetFromJSON(@json)=%%" },
    { name: 'BuildRowsetFromXml()',      syntax: "BuildRowsetFromXml(@xml)",       desc: 'Parse an XML string into a row set',              snippet: "%%=BuildRowsetFromXml(@xml)=%%" },
    { name: 'FormatNumber()',            syntax: "FormatNumber(@num,2)",           desc: 'Format number to N decimal places',               snippet: "%%=FormatNumber(@num,2)=%%" },
    { name: 'FormatCurrency()',          syntax: "FormatCurrency(@amount)",        desc: 'Format as USD currency string',                   snippet: "%%=FormatCurrency(@amount)=%%" },
  ],
  'date': [
    { name: 'Now()',       syntax: "Now()",                          desc: 'Current date and time',                       snippet: "%%=Now()=%%" },
    { name: 'Format()',    syntax: "Format(Now(),'MM/DD/YYYY')",     desc: 'Format a date value as a string',             snippet: "%%=Format(Now(),'MM/DD/YYYY')=%%" },
    { name: 'DateAdd()',   syntax: "DateAdd(Now(),'D',7)",           desc: "Add time units — D=days, M=months, Y=years, H=hours", snippet: "%%=DateAdd(Now(),'D',7)=%%" },
    { name: 'DateDiff()',  syntax: "DateDiff(@start,Now(),'D')",     desc: 'Difference between two dates in specified units', snippet: "%%=DateDiff(@startDate,Now(),'D')=%%" },
    { name: 'DateParse()',              syntax: "DateParse('2026-01-15')",            desc: 'Parse a date string into a date value',                     snippet: "%%=DateParse('2026-01-15')=%%" },
    { name: 'DatePart()',              syntax: "DatePart(Now(),'Year')",             desc: "Extract part of a date — Year, Month, Day, Hour, Minute, Second, Weekday", snippet: "%%=DatePart(Now(),'Year')=%%" },
    { name: 'SystemDateToLocalDate()', syntax: "SystemDateToLocalDate(Now())",       desc: 'Convert UTC system date to browser local time',             snippet: "%%=SystemDateToLocalDate(Now())=%%" },
    { name: 'LocalDateToSystemDate()', syntax: "LocalDateToSystemDate(@localDate)",  desc: 'Convert local date/time to UTC system date',               snippet: "%%=LocalDateToSystemDate(@localDate)=%%" },
    { name: 'GetSystemDateTime()',     syntax: "GetSystemDateTime()",                desc: 'Alias for Now() — returns current system date/time',       snippet: "%%=GetSystemDateTime()=%%" },
  ],
  'logic': [
    { name: 'IIF()',              syntax: "IIF(@a == @b,'yes','no')",  desc: 'Inline conditional — returns one of two values',  snippet: "%%=IIF(@a == @b,'yes','no')=%%" },
    { name: 'Empty()',            syntax: "Empty(@var)",               desc: 'True if variable is null or empty string',        snippet: "%%=Empty(@var)=%%" },
    { name: 'IsNull()',           syntax: "IsNull(@var)",              desc: 'True if variable is null',                        snippet: "%%=IsNull(@var)=%%" },
    { name: 'IsEmailAddress()',   syntax: "IsEmailAddress(@email)",    desc: 'Validate email address format',                   snippet: "%%=IsEmailAddress(@email)=%%" },
    { name: 'Random()',           syntax: "Random(1,100)",             desc: 'Random integer between min and max (inclusive)',   snippet: "%%=Random(1,100)=%%" },
    { name: 'Round()',            syntax: "Round(@num,2)",             desc: 'Round to N decimal places',                       snippet: "%%=Round(@num,2)=%%" },
    { name: 'Add()',              syntax: "Add(@a,@b)",                desc: 'Add two numbers',                                 snippet: "%%=Add(@a,@b)=%%" },
    { name: 'Subtract()',         syntax: "Subtract(@a,@b)",           desc: 'Subtract two numbers',                            snippet: "%%=Subtract(@a,@b)=%%" },
    { name: 'Multiply()',         syntax: "Multiply(@a,@b)",           desc: 'Multiply two numbers',                            snippet: "%%=Multiply(@a,@b)=%%" },
    { name: 'Divide()',           syntax: "Divide(@a,@b)",             desc: 'Divide two numbers',                              snippet: "%%=Divide(@a,@b)=%%" },
    { name: 'GUID()',            syntax: "GUID()",                    desc: 'Generate a unique identifier (UUID v4)',              snippet: "%%=GUID()=%%" },
    { name: 'IsPhoneNumber()',  syntax: "IsPhoneNumber(@phone)",     desc: 'Validate phone number format (7–15 digits)',          snippet: "%%=IsPhoneNumber(@phone)=%%" },
    { name: 'IsNullDefault()',  syntax: "IsNullDefault(@var,'val')", desc: 'Return default if variable is null or empty',         snippet: "%%=IsNullDefault(@var,'default')=%%" },
    { name: 'Not()',            syntax: "Not(@bool)",                desc: 'Logical NOT — reverse a boolean value',              snippet: "%%=Not(@bool)=%%" },
    { name: 'Domain()',         syntax: "Domain(@email)",            desc: 'Extract domain portion from an email address',       snippet: "%%=Domain(@email)=%%" },
    { name: 'OutputLine()',     syntax: "OutputLine(@var)",          desc: 'Output value followed by a line break (<br>)',       snippet: "%%[ OutputLine(@var) ]%%" },
    { name: 'RaiseError()',     syntax: "RaiseError('msg')",         desc: 'Stop rendering and display an error message',        snippet: "%%[ RaiseError('Error message here') ]%%" },
    { name: 'Sqrt()',           syntax: "Sqrt(@num)",                desc: 'Square root of a number',                           snippet: "%%=Sqrt(@num)=%%" },
    { name: 'Abs()',            syntax: "Abs(@num)",                 desc: 'Absolute value',                                    snippet: "%%=Abs(@num)=%%" },
    { name: 'Floor()',          syntax: "Floor(@num)",               desc: 'Round down to nearest integer',                     snippet: "%%=Floor(@num)=%%" },
    { name: 'Ceiling()',        syntax: "Ceiling(@num)",             desc: 'Round up to nearest integer',                       snippet: "%%=Ceiling(@num)=%%" },
    { name: 'Mod()',            syntax: "Mod(@a,@b)",                desc: 'Remainder after division (modulo)',                  snippet: "%%=Mod(@a,@b)=%%" },
    { name: 'Pow()',            syntax: "Pow(@base,@exp)",           desc: 'Raise base to the power of exp',                    snippet: "%%=Pow(@base,@exp)=%%" },
    { name: 'Max()',            syntax: "Max(@a,@b)",                desc: 'Larger of two or more values',                      snippet: "%%=Max(@a,@b)=%%" },
    { name: 'Min()',            syntax: "Min(@a,@b)",                desc: 'Smaller of two or more values',                     snippet: "%%=Min(@a,@b)=%%" },
  ],
  'simulated': [
    { name: 'QueryParameter()',      syntax: "QueryParameter('paramName')",            desc: 'URL/form param — define in URL / Form Params tab',      snippet: "%%=QueryParameter('paramName')=%%" },
    { name: 'AttributeValue()',      syntax: "AttributeValue('FirstName')",            desc: 'Subscriber attribute — edit in Subscriber tab',         snippet: "%%=AttributeValue('FirstName')=%%" },
    { name: 'ContentBlockbyName()',  syntax: "ContentBlockbyName('header')",           desc: 'HTML snippet from ContentBlocks/ folder',               snippet: "%%=ContentBlockbyName('header')=%%" },
    { name: 'ContentBlockbyKey()',   syntax: "ContentBlockbyKey('key')",              desc: 'HTML snippet by key from ContentBlocks/ folder',        snippet: "%%=ContentBlockbyKey('key')=%%" },
    { name: 'CloudPagesURL()',       syntax: "CloudPagesURL(12345,'key',@val)",        desc: 'Simulated CloudPages URL with optional params',         snippet: "%%=CloudPagesURL(12345,'key',@val)=%%" },
    { name: 'HTTPGet()',             syntax: "HTTPGet('https://api.example.com')",     desc: 'Mock HTTP call — configure in Mock HTTP tab',           snippet: "%%=HTTPGet('https://api.example.com/data')=%%" },
    { name: 'EncryptSymmetric()',    syntax: "EncryptSymmetric(@val,'aes256',...)",    desc: 'Returns [ENCRYPTED:base64] placeholder',               snippet: "%%=EncryptSymmetric(@val,'aes256','','iv','','password')=%%" },
    { name: 'TreatAsContent()',      syntax: "TreatAsContent(@html)",                     desc: 'Re-render a string as an AMPscript template',           snippet: "%%=TreatAsContent(@html)=%%" },
    { name: 'ContentBlockbyID()',   syntax: "ContentBlockbyID(5593491)",                 desc: 'HTML snippet by numeric ID — matches Block tabs above',  snippet: "%%=ContentBlockbyID(5593491)=%%" },
    { name: 'RequestParameter()',   syntax: "RequestParameter('key')",                   desc: 'POST/GET parameter — alias for QueryParameter()',        snippet: "%%=RequestParameter('key')=%%" },
    { name: 'HTTPPost()',           syntax: "HTTPPost('url','Content-Type','application/json',@body)", desc: 'Mock HTTP POST — configure in Mock HTTP tab', snippet: "%%=HTTPPost('https://api.example.com/data','Content-Type','application/json',@body)=%%" },
    { name: 'DecryptSymmetric()',   syntax: "DecryptSymmetric(@enc,'aes256',...)",        desc: 'Decodes [ENCRYPTED:base64] placeholder',                snippet: "%%=DecryptSymmetric(@enc,'aes256','','iv','','password')=%%" },
    { name: 'BarcodeUrl()',         syntax: "BarcodeUrl(@val,'qr')",                      desc: 'Generate a barcode/QR code image URL (simulated)',       snippet: "%%=BarcodeUrl(@val,'qr')=%%" },
    { name: 'WrapLongURL()',        syntax: "WrapLongURL(@url)",                          desc: 'Returns URL unchanged (no-op — wrapping requires live MCE)', snippet: "%%=WrapLongURL(@url)=%%" },
    { name: 'BuildOptionList()',    syntax: "BuildOptionList(@rows,'ValFld','TxtFld',@sel)", desc: 'Render <option> tags from a row set for a <select>',  snippet: "%%=BuildOptionList(@rows,'Value','Label',@selected)=%%" },
  ],
  'personalization': [
    { name: '%%FirstName%%',           syntax: '%%FirstName%%',           desc: 'Subscriber first name',               snippet: '%%FirstName%%' },
    { name: '%%LastName%%',            syntax: '%%LastName%%',            desc: 'Subscriber last name',                snippet: '%%LastName%%' },
    { name: '%%EmailAddress%%',        syntax: '%%EmailAddress%%',        desc: 'Subscriber email address',            snippet: '%%EmailAddress%%' },
    { name: '%%profile_center_url%%',  syntax: '%%profile_center_url%%',  desc: 'Link to the preference center page', snippet: '%%profile_center_url%%' },
    { name: '%%unsub_center_url%%',    syntax: '%%unsub_center_url%%',    desc: 'Link to the unsubscribe page',        snippet: '%%unsub_center_url%%' },
  ],
  'unsupported': [
    { name: 'MD5() / SHA1() / SHA256() / SHA512()', syntax: "MD5(@str)",              desc: 'Cryptographic hash functions — browser Web Crypto API is async-only, incompatible with the synchronous AMPscript engine',         unsupported: true },
    { name: 'GetJwt() / GetJwtByKeyName()',          syntax: "GetJwt('keyName')",      desc: 'Generate a signed JWT — requires platform key store and signing infrastructure',                                                    unsupported: true },
    { name: 'RedirectTo()',                          syntax: "RedirectTo(@url)",       desc: 'Creates a tracked MCE redirect link — requires live link tracking service (MID-specific)',                                         unsupported: true },
    { name: 'RequestHeader()',                       syntax: "RequestHeader('header')",desc: 'Reads a live HTTP request header — requires real server context, not available in browser',                                       unsupported: true },
    { name: 'GetSendTime()',                         syntax: "GetSendTime()",          desc: 'Returns the scheduled send time — populated only during a live email send job',                                                    unsupported: true },
    { name: 'ContentArea() / ContentAreaByName()',   syntax: "ContentArea(12345)",     desc: 'References a CloudPages content area by ID — requires live MCE org',                                                              unsupported: true },
    { name: 'TreatAsContentArea()',                  syntax: "TreatAsContentArea(@html)", desc: 'Renders HTML as a CloudPages content area — CloudPages runtime only',                                                          unsupported: true },
    { name: 'ClaimRow() / ClaimRowValue()',          syntax: "ClaimRow('DE','Field')", desc: 'Atomically claim a unique row in a DE — requires live platform for concurrency guarantees',                                       unsupported: true },
    { name: 'ExecuteFilter() / ExecuteFilterOrderedRows()', syntax: "ExecuteFilter('filterName')", desc: 'Run a saved DE filter — filters must exist in the live MCE org',                                                       unsupported: true },
    { name: 'IsMobileSubscriber()',                  syntax: "IsMobileSubscriber()",   desc: 'Check if the recipient is a MobileConnect subscriber — requires live subscriber context',                                         unsupported: true },
    { name: 'IsChtmlBrowser()',                      syntax: "IsChtmlBrowser()",       desc: 'Detect a CHTML mobile browser — requires live HTTP request context',                                                              unsupported: true },
    { name: 'GetPortfolioItem()',                    syntax: "GetPortfolioItem('name')", desc: 'Retrieve a file from MCE media portfolio — requires live org',                                                                  unsupported: true },
    { name: 'Image() / ImageById() / ImageByKey()',  syntax: "Image('name')",          desc: 'Embed an image from MCE portfolio — requires live portfolio and content builder',                                                 unsupported: true },
    { name: 'AttachFile()',                          syntax: "AttachFile(@url)",        desc: 'Attach a file to an email send — requires live MCE email sending infrastructure',                                                unsupported: true },
    { name: 'SendEmailMessage() / SendSMSMessage()', syntax: "SendEmailMessage(@sub,@def)", desc: 'Trigger a transactional send — requires live MCE send infrastructure and definitions',                                      unsupported: true },
    { name: 'BeginImpressionRegion() / EndImpressionRegion()', syntax: "BeginImpressionRegion('name')", desc: 'Analytics impression regions — requires live MCE tracking service',                                             unsupported: true },
    { name: 'MicrositeURL() / LiveContentMicrositeURL() / MobileCloudPagesURL()', syntax: "MicrositeURL('name')", desc: 'Generate microsite/CloudPages URL variants — require live MCE org and published pages',               unsupported: true },
    { name: 'AuthenticatedEmployeeId() and related', syntax: "AuthenticatedEmployeeId()", desc: 'Return SSO / authenticated user details — require a live CloudPages login session',                                          unsupported: true },
    { name: 'InvokeCreate() / InvokeRetrieve() / InvokeUpdate() / InvokeDelete()', syntax: "InvokeRetrieve(...)", desc: 'SOAP API calls — require live SFMC REST/SOAP credentials and cannot run in a browser context',       unsupported: true },
    { name: 'CreateSalesforceObject() and related',  syntax: "CreateSalesforceObject('Lead',1,'field',@v)", desc: 'Salesforce CRM integration functions — require live Salesforce org connection',                             unsupported: true },
    { name: 'RetrieveMscrmRecords() and related',    syntax: "RetrieveMscrmRecords(...)", desc: 'Microsoft Dynamics CRM functions — require live MSCRM API connection',                                                       unsupported: true },
    { name: 'CreateSmsConversation() and related',   syntax: "CreateSmsConversation(...)", desc: 'MobileConnect SMS functions — require live MobileConnect keyword and short code',                                           unsupported: true },
    { name: 'GetPublishedSocialContent() and related', syntax: "GetSocialPublishUrl(...)", desc: 'Social media functions — require live Social Studio connection',                                                             unsupported: true },
    { name: 'Script { } (SSJS)',                     syntax: "%%[ Script { var x = 1; } ]%%", desc: 'Server-Side JavaScript block — requires a server-side JavaScript runtime; cannot execute in a browser',               unsupported: true },
  ],
};

// ── Reference bar rendering ────────────────────────────────────────────────
const refContent  = document.getElementById('ref-content');
const refBar      = document.getElementById('ref-bar');
const refToggle   = document.getElementById('ref-toggle');
let activeCat     = 'output';

// Resolve target editor from whichever template tab is currently active
function getActiveEditorTextarea() {
  const activeTab = document.querySelector('.tmpl-tab.active');
  const pane = activeTab?.dataset.pane ?? 'template';
  if (pane === 'template') return templateEditor;
  const m = pane.match(/^block-(\d+)$/);
  return m ? (document.querySelector(`.cb-editor[data-idx="${m[1]}"]`) ?? templateEditor) : templateEditor;
}

function renderRefContent(cat) {
  const entries = REF[cat] ?? [];
  refContent.innerHTML = entries.map(e => {
    if (e.unsupported) {
      return `<div class="ref-entry ref-unsupported">
        <span class="ref-name ref-name-disabled">⚠ ${e.name}</span>
        <span class="ref-syntax">${e.syntax}</span>
        <span class="ref-desc">${e.desc}</span>
      </div>`;
    }
    return `<div class="ref-entry">
      <span class="ref-name" data-snippet="${e.snippet.replace(/"/g, '&quot;')}">${e.name}</span>
      <span class="ref-syntax">${e.syntax}</span>
      <span class="ref-desc">${e.desc}</span>
    </div>`;
  }).join('');
}

// Tab switching
document.querySelectorAll('.ref-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    activeCat = tab.dataset.cat;
    document.querySelectorAll('.ref-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    renderRefContent(activeCat);
  });
});

// Toggle collapse — also resize #main so the editors fill the freed space
const mainEl = document.getElementById('main');
refToggle.addEventListener('click', () => {
  const collapsed = refBar.classList.toggle('collapsed');
  refToggle.textContent = collapsed ? '▲ Show' : '▼ Hide';
  mainEl.style.bottom = collapsed ? '30px' : '';
});

// Snippet insertion via event delegation — target is whichever template tab is active
refContent.addEventListener('click', e => {
  const name = e.target.closest('.ref-name');
  if (!name) return;
  const snippet = name.dataset.snippet;
  if (!snippet) return;
  const ed    = getActiveEditorTextarea();
  const start = ed.selectionStart;
  const end   = ed.selectionEnd;
  ed.value = ed.value.slice(0, start) + snippet + ed.value.slice(end);
  ed.selectionStart = ed.selectionEnd = start + snippet.length;
  ed.focus();
  scheduleRender();
});

// Initial render
renderRefContent(activeCat);

// ── Tab key in template editor ─────────────────────────────────────────────
templateEditor.addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const s = templateEditor.selectionStart;
    templateEditor.value = templateEditor.value.slice(0, s) + '  ' + templateEditor.value.slice(s);
    templateEditor.selectionStart = templateEditor.selectionEnd = s + 2;
  }
});

// ── Event listeners ────────────────────────────────────────────────────────
templateEditor.addEventListener('input', scheduleRender);
deRowsEditor.addEventListener('input', scheduleRender);
subscriberEditor.addEventListener('input', scheduleRender);
paramsEditor.addEventListener('input', scheduleRender);
httpEditor.addEventListener('input', scheduleRender);
sampleSelect.addEventListener('change', e => loadSample(Number(e.target.value)));

// ── Vertical splitter (resize left col / preview) ──────────────────────────
const vSplitter = document.getElementById('v-splitter');
const leftCol   = document.getElementById('left-col');
// Default left column to ~48% of viewport so the preview starts near the center
leftCol.style.width = Math.max(320, Math.round(window.innerWidth * 0.48)) + 'px';

vSplitter.addEventListener('mousedown', e => {
  e.preventDefault();
  const startX = e.clientX;
  const startW = leftCol.getBoundingClientRect().width;
  vSplitter.classList.add('dragging');
  document.body.style.userSelect = 'none';
  // Prevent the iframe from swallowing mousemove events during drag
  previewFrame.style.pointerEvents = 'none';

  function onMove(ev) {
    const maxW = window.innerWidth - 220;
    const newW = Math.max(150, Math.min(maxW, startW + ev.clientX - startX));
    leftCol.style.width = newW + 'px';
  }
  function onUp() {
    vSplitter.classList.remove('dragging');
    document.body.style.userSelect = '';
    previewFrame.style.pointerEvents = '';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

// ── Horizontal splitter (template ↕ data panel) ───────────────────────────
const hSplitter  = document.getElementById('h-splitter');
const dataTabsArea = document.getElementById('data-tabs-area');

hSplitter.addEventListener('mousedown', e => {
  e.preventDefault();
  const startY = e.clientY;
  const startH = dataTabsArea.getBoundingClientRect().height;
  hSplitter.classList.add('dragging');
  document.body.style.userSelect = 'none';

  function onMove(ev) {
    const leftColH = leftCol.getBoundingClientRect().height;
    // Dragging up → data panel grows; dragging down → data panel shrinks
    const newH = Math.max(80, Math.min(leftColH - 80, startH - (ev.clientY - startY)));
    dataTabsArea.style.height = newH + 'px';
  }
  function onUp() {
    hSplitter.classList.remove('dragging');
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

// ── Data panel collapse toggle ─────────────────────────────────────────────
const dataToggle   = document.getElementById('data-toggle');

dataToggle.addEventListener('click', () => {
  const collapsed = dataTabsArea.classList.toggle('collapsed');
  dataToggle.textContent = collapsed ? '▲' : '▼';
  dataToggle.title = collapsed ? 'Show data panel' : 'Hide data panel';
});

// ── Boot ───────────────────────────────────────────────────────────────────
updateSubNav();  // sync Prev/Next states from any restored subscriber list
loadSample(0);
