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

  const engine = new AMPscriptEngine(sub, params, mockHttp);
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

// ── Tab switching ──────────────────────────────────────────────────────────
document.querySelectorAll('.panel-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + target).classList.add('active');
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
    { name: 'LookupOrderedRows()', syntax: "LookupOrderedRows('DE',10,'F',@v,'Sort','ASC')", desc: 'Return sorted & limited row set',        snippet: "%%[ SET @rows = LookupOrderedRows('DEName',10,'Field',@val,'SortField','ASC') ]%%" },
    { name: 'RowCount()',          syntax: "RowCount(@rows)",                             desc: 'Number of rows in a row set',               snippet: "%%=RowCount(@rows)=%%" },
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
    { name: 'Base64Encode()',            syntax: "Base64Encode(@var)",         desc: 'Encode string to Base64',                     snippet: "%%=Base64Encode(@var)=%%" },
    { name: 'Base64Decode()',            syntax: "Base64Decode(@var)",         desc: 'Decode a Base64 string',                      snippet: "%%=Base64Decode(@var)=%%" },
  ],
  'date': [
    { name: 'Now()',       syntax: "Now()",                          desc: 'Current date and time',                       snippet: "%%=Now()=%%" },
    { name: 'Format()',    syntax: "Format(Now(),'MM/DD/YYYY')",     desc: 'Format a date value as a string',             snippet: "%%=Format(Now(),'MM/DD/YYYY')=%%" },
    { name: 'DateAdd()',   syntax: "DateAdd(Now(),'D',7)",           desc: "Add time units — D=days, M=months, Y=years, H=hours", snippet: "%%=DateAdd(Now(),'D',7)=%%" },
    { name: 'DateDiff()',  syntax: "DateDiff(@start,Now(),'D')",     desc: 'Difference between two dates in specified units', snippet: "%%=DateDiff(@startDate,Now(),'D')=%%" },
    { name: 'DateParse()', syntax: "DateParse('2026-01-15')",        desc: 'Parse a date string into a date value',       snippet: "%%=DateParse('2026-01-15')=%%" },
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
    { name: 'GUID()',             syntax: "GUID()",                    desc: 'Generate a unique identifier (UUID v4)',           snippet: "%%=GUID()=%%" },
  ],
  'simulated': [
    { name: 'QueryParameter()',      syntax: "QueryParameter('paramName')",            desc: 'URL/form param — define in URL / Form Params tab',      snippet: "%%=QueryParameter('paramName')=%%" },
    { name: 'AttributeValue()',      syntax: "AttributeValue('FirstName')",            desc: 'Subscriber attribute — edit in Subscriber tab',         snippet: "%%=AttributeValue('FirstName')=%%" },
    { name: 'ContentBlockbyName()',  syntax: "ContentBlockbyName('header')",           desc: 'HTML snippet from ContentBlocks/ folder',               snippet: "%%=ContentBlockbyName('header')=%%" },
    { name: 'ContentBlockbyKey()',   syntax: "ContentBlockbyKey('key')",              desc: 'HTML snippet by key from ContentBlocks/ folder',        snippet: "%%=ContentBlockbyKey('key')=%%" },
    { name: 'CloudPagesURL()',       syntax: "CloudPagesURL(12345,'key',@val)",        desc: 'Simulated CloudPages URL with optional params',         snippet: "%%=CloudPagesURL(12345,'key',@val)=%%" },
    { name: 'HTTPGet()',             syntax: "HTTPGet('https://api.example.com')",     desc: 'Mock HTTP call — configure in Mock HTTP tab',           snippet: "%%=HTTPGet('https://api.example.com/data')=%%" },
    { name: 'EncryptSymmetric()',    syntax: "EncryptSymmetric(@val,'aes256',...)",    desc: 'Returns [ENCRYPTED:base64] placeholder',               snippet: "%%=EncryptSymmetric(@val,'aes256','','iv','','password')=%%" },
    { name: 'TreatAsContent()',      syntax: "TreatAsContent(@html)",                  desc: 'Re-render a string as an AMPscript template',           snippet: "%%=TreatAsContent(@html)=%%" },
  ],
  'personalization': [
    { name: '%%FirstName%%',           syntax: '%%FirstName%%',           desc: 'Subscriber first name',               snippet: '%%FirstName%%' },
    { name: '%%LastName%%',            syntax: '%%LastName%%',            desc: 'Subscriber last name',                snippet: '%%LastName%%' },
    { name: '%%EmailAddress%%',        syntax: '%%EmailAddress%%',        desc: 'Subscriber email address',            snippet: '%%EmailAddress%%' },
    { name: '%%profile_center_url%%',  syntax: '%%profile_center_url%%',  desc: 'Link to the preference center page', snippet: '%%profile_center_url%%' },
    { name: '%%unsub_center_url%%',    syntax: '%%unsub_center_url%%',    desc: 'Link to the unsubscribe page',        snippet: '%%unsub_center_url%%' },
  ],
};

// ── Reference bar rendering ────────────────────────────────────────────────
const refContent  = document.getElementById('ref-content');
const refBar      = document.getElementById('ref-bar');
const refToggle   = document.getElementById('ref-toggle');
let activeCat     = 'output';

function renderRefContent(cat) {
  const entries = REF[cat] ?? [];
  refContent.innerHTML = entries.map(e =>
    `<div class="ref-entry">
      <span class="ref-name" data-snippet="${e.snippet.replace(/"/g, '&quot;')}">${e.name}</span>
      <span class="ref-syntax">${e.syntax}</span>
      <span class="ref-desc">${e.desc}</span>
    </div>`
  ).join('');
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

// Toggle collapse
refToggle.addEventListener('click', () => {
  const collapsed = refBar.classList.toggle('collapsed');
  refToggle.textContent = collapsed ? '▲ Show' : '▼ Hide';
});

// Snippet insertion via event delegation
refContent.addEventListener('click', e => {
  const name = e.target.closest('.ref-name');
  if (!name) return;
  const snippet = name.dataset.snippet;
  if (!snippet) return;
  const start = templateEditor.selectionStart;
  const end   = templateEditor.selectionEnd;
  const val   = templateEditor.value;
  templateEditor.value = val.slice(0, start) + snippet + val.slice(end);
  templateEditor.selectionStart = templateEditor.selectionEnd = start + snippet.length;
  templateEditor.focus();
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
document.getElementById('render-btn').addEventListener('click', render);

// ── Vertical splitter (resize left col / preview) ──────────────────────────
const vSplitter = document.getElementById('v-splitter');
const leftCol   = document.getElementById('left-col');

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

// ── Data panel collapse toggle ─────────────────────────────────────────────
const dataTabsArea = document.getElementById('data-tabs-area');
const dataToggle   = document.getElementById('data-toggle');

dataToggle.addEventListener('click', () => {
  const collapsed = dataTabsArea.classList.toggle('collapsed');
  dataToggle.textContent = collapsed ? '▲' : '▼';
  dataToggle.title = collapsed ? 'Show data panel' : 'Hide data panel';
});

// ── Boot ───────────────────────────────────────────────────────────────────
updateSubNav();  // sync Prev/Next states from any restored subscriber list
loadSample(0);
