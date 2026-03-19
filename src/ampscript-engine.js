/**
 * AMPscript Engine — browser-side interpreter for MCE AMPscript
 *
 * Key design: the template is converted to a single flat "script" before execution.
 * HTML segments between %%[ ]%% blocks become __HTML__("...") output statements so
 * that IF/ELSEIF/ELSE/ENDIF can span across multiple %%[ ]%% blocks correctly.
 *
 *   Input:  %%[ IF @x == 'a' THEN ]%%  <p>A</p>  %%[ ELSE ]%%  <p>B</p>  %%[ ENDIF ]%%
 *   Script: IF @x == 'a' THEN
 *           __HTML__("<p>A</p>")
 *           ELSE
 *           __HTML__("<p>B</p>")
 *           ENDIF
 */

import { deEngine } from './de-engine.js';

// Load ContentBlocks at build time
const contentBlockFiles = import.meta.glob('/ContentBlocks/*.html', { query: '?raw', import: 'default', eager: true });
const _contentBlocks = {};
for (const [path, html] of Object.entries(contentBlockFiles)) {
  const name = path.split('/').pop().replace('.html', '').toLowerCase();
  _contentBlocks[name] = html;
}

export class AMPscriptEngine {
  constructor(subscriberAttrs = {}, params = {}, mockHttp = {}, contentBlocks = []) {
    this.subscriber    = subscriberAttrs;
    this.params        = params;
    this.mockHttp      = mockHttp;
    this.contentBlocks = contentBlocks;
    this.vars          = {};
    this.writeLog      = [];
  }

  render(template) {
    try {
      // Convert template to a flat script, then execute it as one program
      const script  = this._templateToScript(template);
      const raw     = this._runBlock(script);
      // Resolve remaining %%=expr=%% and %%PersonalizationString%% in output
      const html    = this._resolveInlineExpressions(raw);
      return { html, error: null, writeLog: this.writeLog };
    } catch (e) {
      return { html: '', error: e.message, writeLog: this.writeLog };
    }
  }

  // ─── Template → Script conversion ────────────────────────────────────────
  // Splits template into alternating HTML/code segments.
  // HTML segments become __HTML__("...") statements so control flow
  // can span across multiple %%[ ]%% blocks.

  _templateToScript(template) {
    const parts = [];
    let lastIndex = 0;
    const re = /%%\[([\s\S]*?)\]%%/g;
    let match;
    while ((match = re.exec(template)) !== null) {
      const htmlBefore = template.slice(lastIndex, match.index);
      if (htmlBefore) parts.push(`__HTML__(${JSON.stringify(htmlBefore)})`);
      const code = match[1].trim();
      if (code) parts.push(code);
      lastIndex = match.index + match[0].length;
    }
    const remaining = template.slice(lastIndex);
    if (remaining) parts.push(`__HTML__(${JSON.stringify(remaining)})`);
    return parts.join('\n');
  }

  // ─── Block runner ─────────────────────────────────────────────────────────

  _runBlock(code) {
    const lines = this._splitStatements(code);
    let output = '';
    let i = 0;
    while (i < lines.length) {
      const result = this._executeStatement(lines, i);
      output += result.output;
      i = result.nextIndex;
    }
    return output;
  }

  // Split a block of code into logical statements (one per line at depth 0).
  // Tracks string literals so parens/newlines inside strings don't mislead.
  _splitStatements(code) {
    const stmts = [];
    let current = '';
    let depth = 0;
    let inStr = false;
    let strChar = '';
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (inStr) {
        current += ch;
        if (ch === strChar) inStr = false;
      } else if (ch === "'" || ch === '"') {
        inStr = true; strChar = ch; current += ch;
      } else if (ch === '(') {
        depth++; current += ch;
      } else if (ch === ')') {
        depth--; current += ch;
      } else if (ch === '\n' && depth === 0) {
        const t = current.trim().replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (t) stmts.push(t);
        current = '';
      } else {
        current += ch;
      }
    }
    const t = current.trim().replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (t) stmts.push(t);
    return stmts;
  }

  _executeStatement(lines, i) {
    const line = lines[i];

    // __HTML__("...") — output a literal HTML segment (resolve inline exprs immediately)
    if (/^__HTML__\s*\(/i.test(line)) {
      const fnMatch = line.match(/^(\w+)\s*\(([\s\S]*)\)$/);
      if (fnMatch) {
        const result = this._callFunction(fnMatch[1], this._parseArgs(fnMatch[2]));
        return { output: this._resolveInlineExpressions(String(result ?? '')), nextIndex: i + 1 };
      }
    }

    // VAR @a, @b
    if (/^VAR\s+/i.test(line)) {
      line.slice(4).split(',').map(s => s.trim())
        .forEach(n => { if (!(n in this.vars)) this.vars[n] = null; });
      return { output: '', nextIndex: i + 1 };
    }

    // SET @var = expr
    if (/^SET\s+@/i.test(line)) {
      const m = line.match(/^SET\s+(@\w+)\s*=\s*([\s\S]+)$/i);
      if (m) this.vars[m[1].toLowerCase()] = this._evalExpr(m[2].trim());
      return { output: '', nextIndex: i + 1 };
    }

    // OUTPUT(expr)
    if (/^OUTPUT\s*\(/i.test(line)) {
      const fnMatch = line.match(/^(\w+)\s*\(([\s\S]*)\)$/);
      if (fnMatch) {
        const result = this._callFunction(fnMatch[1], this._parseArgs(fnMatch[2]));
        return { output: this._resolveInlineExpressions(String(result ?? '')), nextIndex: i + 1 };
      }
    }

    if (/^IF\s+/i.test(line))  return this._executeIf(lines, i);
    if (/^FOR\s+/i.test(line)) return this._executeFor(lines, i);

    // Bare function call (side-effect: UpsertDE, InsertDE, etc.)
    const fnMatch = line.match(/^(\w+)\s*\(([\s\S]*)\)$/);
    if (fnMatch) this._callFunction(fnMatch[1], this._parseArgs(fnMatch[2]));

    return { output: '', nextIndex: i + 1 };
  }

  // ─── IF / ELSEIF / ELSE / ENDIF ──────────────────────────────────────────

  _executeIf(lines, startIndex) {
    const branches = [];
    let elseBranch = null;
    let i = startIndex;
    let depth = 0;

    const condMatch = lines[i].match(/^IF\s+([\s\S]+)$/i);
    let currentCond = condMatch ? condMatch[1].trim().replace(/\s+THEN\s*$/i, '') : 'false';
    let currentBody = [];
    i++;

    while (i < lines.length) {
      if (/^IF\s+/i.test(lines[i])) depth++;

      if (depth === 0 && /^ELSEIF\s+/i.test(lines[i])) {
        branches.push({ cond: currentCond, body: currentBody });
        const m = lines[i].match(/^ELSEIF\s+([\s\S]+)$/i);
        currentCond = m ? m[1].trim().replace(/\s+THEN\s*$/i, '') : 'false';
        currentBody = [];
      } else if (depth === 0 && /^ELSE\b/i.test(lines[i])) {
        branches.push({ cond: currentCond, body: currentBody });
        currentCond = null;
        currentBody = [];
        elseBranch = [];
      } else if (/^ENDIF\b/i.test(lines[i])) {
        if (depth === 0) {
          if (currentCond === null) elseBranch = currentBody;
          else branches.push({ cond: currentCond, body: currentBody });
          i++;
          break;
        }
        depth--;
        currentBody.push(lines[i]);
      } else {
        currentBody.push(lines[i]);
      }
      i++;
    }

    for (const branch of branches) {
      if (this._evalCondition(branch.cond)) {
        return { output: this._runBlock(branch.body.join('\n')), nextIndex: i };
      }
    }
    if (elseBranch !== null) {
      return { output: this._runBlock(elseBranch.join('\n')), nextIndex: i };
    }
    return { output: '', nextIndex: i };
  }

  // ─── FOR loop ─────────────────────────────────────────────────────────────

  _executeFor(lines, startIndex) {
    const m = lines[startIndex].match(/^FOR\s+(@\w+)\s*=\s*(\S+)\s+TO\s+(\S+)\s+DO$/i);
    if (!m) return { output: '', nextIndex: startIndex + 1 };

    const varName = m[1].toLowerCase();
    const from    = Number(this._evalExpr(m[2]));
    const to      = Number(this._evalExpr(m[3]));
    const body    = [];
    let i = startIndex + 1;
    let depth = 0;

    while (i < lines.length) {
      if (/^FOR\s+/i.test(lines[i])) depth++;
      if (/^NEXT\b/i.test(lines[i])) {
        if (depth === 0) { i++; break; }
        depth--;
      }
      body.push(lines[i]);
      i++;
    }

    let output = '';
    for (let n = from; n <= to; n++) {
      this.vars[varName] = n;
      output += this._runBlock(body.join('\n'));
    }
    return { output, nextIndex: i };
  }

  // ─── Inline expression resolution ────────────────────────────────────────
  // Resolves %%=expr=%% and %%PersonalizationString%% remaining in HTML output.

  _resolveInlineExpressions(template) {
    template = template.replace(/%%=([\s\S]*?)=%%/g, (_, expr) => {
      return String(this._evalExpr(expr.trim()) ?? '');
    });
    template = template.replace(/%%(\w+)%%/g, (_, name) => {
      return String(this.subscriber[name] ?? this.vars[('@' + name).toLowerCase()] ?? '');
    });
    return template;
  }

  // ─── Expression evaluator ─────────────────────────────────────────────────

  _evalExpr(expr) {
    if (expr == null) return null;
    if (typeof expr !== 'string') return expr;
    expr = expr.trim();

    if (/^'([\s\S]*)'$/.test(expr))   return expr.slice(1, -1);
    if (/^"([\s\S]*)"$/.test(expr))   { try { return JSON.parse(expr); } catch { return expr.slice(1, -1); } }
    if (/^-?\d+(\.\d+)?$/.test(expr)) return parseFloat(expr);
    if (/^true$/i.test(expr))  return true;
    if (/^false$/i.test(expr)) return false;
    if (/^@\w+$/i.test(expr))  return this.vars[expr.toLowerCase()] ?? null;

    const fnMatch = expr.match(/^(\w+)\s*\(([\s\S]*)\)$/);
    if (fnMatch) return this._callFunction(fnMatch[1], this._parseArgs(fnMatch[2]));

    if (expr.includes(' & ')) {
      return expr.split(' & ').map(p => String(this._evalExpr(p.trim()) ?? '')).join('');
    }

    // Comparison / logical expression (used in IIF first argument, etc.)
    if (/ == | != | >= | <= | > | < | AND | OR /i.test(expr)) {
      return this._evalCondition(expr);
    }

    return null;
  }

  _evalCondition(condStr) {
    if (!condStr) return false;
    if (/ AND /i.test(condStr)) return condStr.split(/ AND /i).every(p => this._evalCondition(p.trim()));
    if (/ OR /i.test(condStr))  return condStr.split(/ OR /i).some(p => this._evalCondition(p.trim()));

    const ops = [' == ', ' != ', ' >= ', ' <= ', ' > ', ' < '];
    for (const op of ops) {
      if (condStr.includes(op)) {
        const [left, right] = condStr.split(op).map(s => this._evalExpr(s.trim()));
        switch (op.trim()) {
          case '==': return left == right;
          case '!=': return left != right;
          case '>=': return left >= right;
          case '<=': return left <= right;
          case '>':  return left > right;
          case '<':  return left < right;
        }
      }
    }
    const val = this._evalExpr(condStr);
    return val !== null && val !== '' && val !== false && val !== 0;
  }

  // Parse comma-separated args (string-aware, respects nested parens)
  _parseArgs(argsStr) {
    const args = [];
    let current = '';
    let depth = 0;
    let inStr = false;
    let strChar = '';
    for (let i = 0; i < argsStr.length; i++) {
      const ch = argsStr[i];
      if (inStr) {
        current += ch;
        if (ch === strChar) inStr = false;
      } else if (ch === "'" || ch === '"') {
        inStr = true; strChar = ch; current += ch;
      } else if (ch === '(') {
        depth++; current += ch;
      } else if (ch === ')') {
        depth--; current += ch;
      } else if (ch === ',' && depth === 0) {
        args.push(this._evalExpr(current.trim()));
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) args.push(this._evalExpr(current.trim()));
    return args;
  }

  // ─── Function library ─────────────────────────────────────────────────────

  _callFunction(name, args) {
    const fn = name.toUpperCase();

    // ── Internal output helpers ───────────────────────────────────────────
    if (fn === '__HTML__') return args[0] ?? '';
    if (fn === 'OUTPUT')   return args.map(a => String(a ?? '')).join('');
    if (fn === 'V')        return args[0] ?? '';

    // ── String ────────────────────────────────────────────────────────────
    if (fn === 'CONCAT')     return args.map(a => String(a ?? '')).join('');
    if (fn === 'TRIM')       return String(args[0] ?? '').trim();
    if (fn === 'UPPERCASE')  return String(args[0] ?? '').toUpperCase();
    if (fn === 'LOWERCASE')  return String(args[0] ?? '').toLowerCase();
    if (fn === 'PROPERCASE') {
      return String(args[0] ?? '').replace(/\w\S*/g, t => t[0].toUpperCase() + t.slice(1).toLowerCase());
    }
    if (fn === 'SUBSTRING') {
      const str   = String(args[0] ?? '');
      const start = (Number(args[1]) || 1) - 1;
      const len   = Number(args[2]);
      return isNaN(len) ? str.slice(start) : str.slice(start, start + len);
    }
    if (fn === 'INDEXOF')  return String(args[0] ?? '').indexOf(String(args[1] ?? '')) + 1;
    if (fn === 'REPLACE')  return String(args[0] ?? '').split(String(args[1] ?? '')).join(String(args[2] ?? ''));
    if (fn === 'LENGTH')   return String(args[0] ?? '').length;
    if (fn === 'CHAR')     return String.fromCharCode(Number(args[0]));
    if (fn === 'ASC')      return String(args[0] ?? ' ').charCodeAt(0);
    if (fn === 'ESCAPEXML' || fn === 'ESCAPEHTML') {
      return String(args[0] ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    if (fn === 'UNESCAPEXML' || fn === 'UNESCAPEHTML') {
      return String(args[0] ?? '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    }
    if (fn === 'REGEXMATCH') {
      try {
        const m = new RegExp(String(args[1] ?? ''), String(args[2] ?? 'i')).exec(String(args[0] ?? ''));
        return m ? (m[Number(args[3] ?? 0)] ?? m[0] ?? '') : '';
      } catch { return ''; }
    }
    if (fn === 'BUILDROWSETFROMSTRING') {
      return String(args[0] ?? '').split(String(args[1] ?? ',')).map(v => ({ Value: v.trim() }));
    }
    if (fn === 'BUILDROWSETFROMJSON') {
      try {
        const p = JSON.parse(String(args[0] ?? '[]'));
        return Array.isArray(p) ? p : [p];
      } catch { return []; }
    }
    if (fn === 'BUILDROWSETFROMXML') {
      try {
        const doc = new DOMParser().parseFromString(String(args[0] ?? ''), 'text/xml');
        return Array.from(doc.documentElement.children).map(n => {
          const row = {}; Array.from(n.children).forEach(c => { row[c.tagName] = c.textContent; }); return row;
        });
      } catch { return []; }
    }
    if (fn === 'URLENCODE') return encodeURIComponent(String(args[0] ?? ''));
    if (fn === 'URLDECODE' || fn === 'DECODEURLPARAMETER') {
      try { return decodeURIComponent(String(args[0] ?? '')); } catch { return String(args[0] ?? ''); }
    }
    if (fn === 'STRINGTOHEX') {
      return Array.from(String(args[0] ?? '')).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    }
    if (fn === 'HEXTOSTRING') {
      return String(args[0] ?? '').replace(/../g, hex => String.fromCharCode(parseInt(hex, 16)));
    }
    if (fn === 'REPLACELIST') {
      let s = String(args[0] ?? '');
      for (let i = 1; i + 1 < args.length; i += 2) s = s.split(String(args[i] ?? '')).join(String(args[i + 1] ?? ''));
      return s;
    }

    // ── Logic ─────────────────────────────────────────────────────────────
    if (fn === 'EMPTY')  return args[0] == null || args[0] === '';
    if (fn === 'ISNULL') return args[0] == null;
    if (fn === 'IIF')    return args[0] ? args[1] : args[2];
    if (fn === 'ISEMAILADDRESS') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(args[0] ?? ''));
    if (fn === 'ISPHONENUMBER')  return /^[\d\s\-\+\(\)]{7,15}$/.test(String(args[0] ?? ''));
    if (fn === 'ISNULLDEFAULT' || fn === 'NULLDEFAULT') {
      return (args[0] == null || args[0] === '') ? (args[1] ?? null) : args[0];
    }
    if (fn === 'NOT') return !args[0];
    if (fn === 'RAISEERROR') throw new Error(String(args[0] ?? 'RaiseError() called'));
    if (fn === 'DOMAIN') {
      const m = String(args[0] ?? '').match(/@([^@]+)$/);
      return m ? m[1] : '';
    }
    if (fn === 'OUTPUTLINE') return args.map(a => String(a ?? '')).join('') + '<br>';

    // ── Date ──────────────────────────────────────────────────────────────
    if (fn === 'NOW' || fn === 'GETSYSTEMDATETIME') {
      return new Date().toISOString().slice(0, 19).replace('T', ' ');
    }
    if (fn === 'DATEPARSE' || fn === 'STRINGTODATE') {
      return new Date(String(args[0] ?? '')).toISOString().slice(0, 19).replace('T', ' ');
    }
    if (fn === 'DATEADD') {
      const d    = new Date(String(args[0]));
      const part = String(args[1]).toUpperCase();
      const n    = Number(args[2]);
      if (part === 'D')  d.setDate(d.getDate() + n);
      else if (part === 'M')  d.setMonth(d.getMonth() + n);
      else if (part === 'Y')  d.setFullYear(d.getFullYear() + n);
      else if (part === 'H')  d.setHours(d.getHours() + n);
      else if (part === 'MI') d.setMinutes(d.getMinutes() + n);
      return d.toISOString().slice(0, 19).replace('T', ' ');
    }
    if (fn === 'DATEDIFF') {
      const ms   = new Date(String(args[1])) - new Date(String(args[0]));
      const part = String(args[2] ?? 'D').toUpperCase();
      if (part === 'H')  return Math.round(ms / 3600000);
      if (part === 'MI') return Math.round(ms / 60000);
      return Math.round(ms / 86400000);
    }
    if (fn === 'FORMAT' || fn === 'FORMATDATE') {
      const val = args[0];
      const fmt = String(args[1] ?? '');
      if (val instanceof Date || (typeof val === 'string' && !isNaN(Date.parse(val)))) {
        const d = new Date(val);
        return fmt
          .replace('MMMM', d.toLocaleString('default', { month: 'long' }))
          .replace('MMM',  d.toLocaleString('default', { month: 'short' }))
          .replace('MM',   String(d.getMonth() + 1).padStart(2, '0'))
          .replace('M',    String(d.getMonth() + 1))
          .replace('YYYY', d.getFullYear())
          .replace('YY',   String(d.getFullYear()).slice(-2))
          .replace('DD',   String(d.getDate()).padStart(2, '0'))
          .replace('D',    String(d.getDate()))
          .replace('HH',   String(d.getHours()).padStart(2, '0'))
          .replace('mm',   String(d.getMinutes()).padStart(2, '0'));
      }
      return String(val ?? '');
    }
    if (fn === 'FORMATNUMBER')   return Number(args[0]).toFixed(Number(args[1] ?? 2));
    if (fn === 'FORMATCURRENCY') {
      return Number(args[0]).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    }
    if (fn === 'DATEPART') {
      const d = new Date(String(args[0] ?? '')), part = String(args[1] ?? '').toUpperCase();
      if (part === 'YEAR'   || part === 'YY' || part === 'YYYY') return d.getFullYear();
      if (part === 'MONTH'  || part === 'MM' || part === 'M')    return d.getMonth() + 1;
      if (part === 'DAY'    || part === 'DD' || part === 'D')    return d.getDate();
      if (part === 'HOUR'   || part === 'HH' || part === 'H')    return d.getHours();
      if (part === 'MINUTE' || part === 'MI')                    return d.getMinutes();
      if (part === 'SECOND' || part === 'SS' || part === 'S')    return d.getSeconds();
      if (part === 'WEEKDAY'|| part === 'DW')                    return d.getDay() + 1;
      return null;
    }
    if (fn === 'SYSTEMDATETOLOCALDATE') {
      const d = new Date(String(args[0] ?? ''));
      return isNaN(d) ? '' : d.toLocaleDateString('en-US') + ' ' + d.toLocaleTimeString('en-US', { hour12: false });
    }
    if (fn === 'LOCALDATETOSYSTEMDATE') {
      const d = new Date(String(args[0] ?? ''));
      return isNaN(d) ? '' : d.toISOString().slice(0, 19).replace('T', ' ');
    }

    // ── Math ──────────────────────────────────────────────────────────────
    if (fn === 'ADD')      return Number(args[0]) + Number(args[1]);
    if (fn === 'SUBTRACT') return Number(args[0]) - Number(args[1]);
    if (fn === 'MULTIPLY') return Number(args[0]) * Number(args[1]);
    if (fn === 'DIVIDE')   return Number(args[0]) / Number(args[1]);
    if (fn === 'MOD')      return Number(args[0]) % Number(args[1]);
    if (fn === 'ABS')      return Math.abs(Number(args[0]));
    if (fn === 'FLOOR')    return Math.floor(Number(args[0]));
    if (fn === 'CEILING')  return Math.ceil(Number(args[0]));
    if (fn === 'ROUND')    return Number(Number(args[0]).toFixed(Number(args[1] ?? 0)));
    if (fn === 'POW')      return Math.pow(Number(args[0]), Number(args[1]));
    if (fn === 'MAX')      return Math.max(...args.map(Number));
    if (fn === 'MIN')      return Math.min(...args.map(Number));
    if (fn === 'RANDOM') {
      const lo = Number(args[0] ?? 0), hi = Number(args[1] ?? 100);
      return Math.floor(Math.random() * (hi - lo + 1)) + lo;
    }
    if (fn === 'SQRT') return Math.sqrt(Number(args[0]));

    // ── Utility ───────────────────────────────────────────────────────────
    if (fn === 'GUID') return crypto.randomUUID();

    // ── Subscriber / params ───────────────────────────────────────────────
    if (fn === 'ATTRIBUTEVALUE') {
      const attr = String(args[0] ?? '');
      return this.subscriber[attr] ?? this.subscriber[attr.toLowerCase()] ?? null;
    }
    if (fn === 'QUERYPARAMETER' || fn === 'REQUESTPARAMETER') {
      const key = String(args[0] ?? '');
      return this.params[key] ?? this.params[key.toLowerCase()] ?? null;
    }

    // ── CloudPages URL (simulated) ────────────────────────────────────────
    if (fn === 'CLOUDPAGESURL') {
      const pageId = String(args[0] ?? '');
      const pairs  = [];
      for (let i = 1; i + 1 < args.length; i += 2) {
        pairs.push(`${encodeURIComponent(String(args[i] ?? ''))}=${encodeURIComponent(String(args[i+1] ?? ''))}`);
      }
      return `https://pub.s6.exacttarget.com/${pageId}${pairs.length ? '?' + pairs.join('&') : ''}`;
    }

    // ── Content Blocks ────────────────────────────────────────────────────
    if (fn === 'CONTENTBLOCKBYNAME' || fn === 'CONTENTBLOCKBYKEY') {
      const q  = String(args[0] ?? '').toLowerCase();
      const ui = fn === 'CONTENTBLOCKBYNAME'
        ? this.contentBlocks.find(b => b.name.toLowerCase() === q)
        : this.contentBlocks.find(b => b.key.toLowerCase() === q);
      if (ui) return ui.html ? this.render(ui.html).html : '';
      return _contentBlocks[q] ?? `<!-- ContentBlock '${args[0]}' not found -->`;
    }
    if (fn === 'CONTENTBLOCKBYID') {
      const id  = String(args[0] ?? '');
      const ui  = this.contentBlocks.find(b => String(b.id) === id);
      if (ui) return ui.html ? this.render(ui.html).html : '';
      const key = Object.keys(_contentBlocks).find(k => k.startsWith(id));
      return key ? _contentBlocks[key] : `<!-- ContentBlock ID ${id} not found -->`;
    }
    if (fn === 'TREATASCONTENT') {
      const { html } = this.render(String(args[0] ?? ''));
      return html;
    }
    if (fn === 'BARCODEURL') {
      const val = encodeURIComponent(String(args[0] ?? '')), type = String(args[1] ?? 'qr').toLowerCase();
      return `https://barcode.tec-it.com/barcode.ashx?DATA=${val}&TYPE=${type}&UNIT=Fit&WIDTH=200&HEIGHT=200`;
    }
    if (fn === 'WRAPLONGURL') return String(args[0] ?? '');
    if (fn === 'BUILDOPTIONLIST') {
      const rows = args[0], valField = String(args[1] ?? 'Value'), txtField = String(args[2] ?? valField), sel = args[3];
      if (!Array.isArray(rows)) return '';
      return rows.map(r => {
        const v = r[valField] ?? '', t = r[txtField] ?? v;
        return `<option value="${String(v).replace(/"/g, '&quot;')}"${String(v) === String(sel) ? ' selected' : ''}>${t}</option>`;
      }).join('');
    }

    // ── HTTP mocks ────────────────────────────────────────────────────────
    if (fn === 'HTTPGET' || fn === 'HTTPPOST' || fn === 'HTTPREQUEST') {
      const url = String(args[0] ?? '');
      for (const [pattern, response] of Object.entries(this.mockHttp)) {
        if (url.includes(pattern)) return response;
      }
      return `[mock-http: no match for "${url}"]`;
    }

    // ── DE read ───────────────────────────────────────────────────────────
    if (fn === 'LOOKUP')            return deEngine.lookup(args[0], args[1], args[2], args[3]);
    if (fn === 'LOOKUPROWS')        return deEngine.lookupRows(args[0], args[1], args[2]);
    if (fn === 'LOOKUPORDEREDROWS')   return deEngine.lookupOrderedRows(args[0], args[1], args[2], args[3], args[4]);
    if (fn === 'LOOKUPROWSCS')        return deEngine.lookupRows(args[0], args[1], args[2]);
    if (fn === 'LOOKUPORDEREDROWSCS') return deEngine.lookupOrderedRows(args[0], args[1], args[2], args[3], args[4]);
    if (fn === 'DATAEXTENSIONROWCOUNT') return deEngine.getDE(args[0]).length;
    if (fn === 'FIELD') {
      const row = args[0], col = String(args[1] ?? '');
      if (Array.isArray(row))             return row.map(r => r[col] ?? null);
      if (row && typeof row === 'object') return row[col] ?? null;
      return null;
    }
    if (fn === 'ROWCOUNT') return Array.isArray(args[0]) ? args[0].length : 0;
    if (fn === 'ROW') {
      const rows = args[0], idx = Number(args[1]) - 1;
      return Array.isArray(rows) ? rows[idx] ?? null : null;
    }

    // ── DE write ─────────────────────────────────────────────────────────
    if (fn === 'INSERTDE' || fn === 'INSERTDATA') {
      const deName = String(args[0] ?? ''), row = _pairs(args.slice(1));
      deEngine.insertRow(deName, row);
      this.writeLog.push({ op: 'INSERT', de: deName, row });
      return 1;
    }
    if (fn === 'UPDATEDE' || fn === 'UPDATEDATA') {
      const deName = String(args[0] ?? ''), kf = Number(args[1] ?? 1);
      const data   = _pairs(args.slice(2)), keys = Object.fromEntries(Object.entries(data).slice(0, kf));
      deEngine.updateRows(deName, keys, data);
      this.writeLog.push({ op: 'UPDATE', de: deName, keys, data });
      return 1;
    }
    if (fn === 'UPSERTDE' || fn === 'UPSERTDATA') {
      const deName = String(args[0] ?? ''), kf = Number(args[1] ?? 1);
      const data   = _pairs(args.slice(2));
      deEngine.upsertRow(deName, kf, data);
      this.writeLog.push({ op: 'UPSERT', de: deName, data });
      return 1;
    }
    if (fn === 'DELETEDE' || fn === 'DELETEDATA') {
      const deName = String(args[0] ?? ''), filter = _pairs(args.slice(1));
      deEngine.deleteRows(deName, filter);
      this.writeLog.push({ op: 'DELETE', de: deName, filter });
      return 1;
    }

    // ── Crypto / encoding ─────────────────────────────────────────────────
    if (fn === 'BASE64ENCODE') {
      try { return btoa(unescape(encodeURIComponent(String(args[0] ?? '')))); } catch { return ''; }
    }
    if (fn === 'BASE64DECODE') {
      try { return decodeURIComponent(escape(atob(String(args[0] ?? '')))); } catch { return ''; }
    }
    if (fn === 'ENCRYPTSYMMETRIC') {
      try { return `[ENCRYPTED:${btoa(String(args[0] ?? ''))}]`; } catch { return '[ENCRYPTED]'; }
    }
    if (fn === 'DECRYPTSYMMETRIC') {
      const m = String(args[0] ?? '').match(/^\[ENCRYPTED:(.+)\]$/);
      try { return m ? atob(m[1]) : '[DECRYPTED]'; } catch { return '[DECRYPTED]'; }
    }

    console.warn(`[AMPscript] Unknown function: ${name}()`);
    return null;
  }
}

function _pairs(arr) {
  const obj = {};
  for (let i = 0; i + 1 < arr.length; i += 2) obj[String(arr[i] ?? '')] = arr[i + 1];
  return obj;
}
