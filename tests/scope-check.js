/* Scope check — the class of bug `node --check` cannot see (Chapter 28).
   For each named function, every identifier it reads must be declared inside it,
   declared at module level in app.js, or be a known global. */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(ROOT + '/js/app.js', 'utf8');

const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  .replace(/`(?:\\.|\$\{[^}]*\}|[^`\\])*`/g, '``')
  .replace(/'(?:\\.|[^'\\])*'/g, "''")
  .replace(/"(?:\\.|[^"\\])*"/g, '""');

function extract(name, text) {
  const start = text.indexOf('function ' + name + '(');
  if (start < 0) return null;
  let depth = 0;
  for (let j = text.indexOf('{', start); j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}') { depth--; if (depth === 0) return text.slice(start, j + 1); }
  }
  return null;
}

/* Declarations are collected from the RAW source: a stray match inside a comment
   or string only makes the check more permissive, never less, whereas regex
   string-stripping can swallow whole regions and hide real declarations. */
function collectDecls(text, into) {
  for (const m of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) into.add(m[1]);
  for (const m of text.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) into.add(m[1]);
  // second and later declarators: const a = 1, b = 2;
  for (const m of text.matchAll(/,\s*([A-Za-z_$][\w$]*)\s*=(?!=)/g)) into.add(m[1]);
  // destructuring: const { a, b: c } = x   /   const [a, b] = x
  for (const m of text.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
    m[1].split(',').forEach((p) => {
      const id = p.split(':').pop().trim().replace(/=.*/, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(id)) into.add(id);
    });
  }
  for (const m of text.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]/g)) {
    m[1].split(',').forEach((p) => {
      const id = p.trim(); if (/^[A-Za-z_$][\w$]*$/.test(id)) into.add(id);
    });
  }
  // destructured callback params: ({ tx, count }) => …  /  ([id, value]) => …
  for (const m of text.matchAll(/\(\s*\{([^}]*)\}\s*\)\s*=>/g)) {
    m[1].split(',').forEach((p) => {
      const id = p.split(':').pop().trim().replace(/=.*/, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(id)) into.add(id);
    });
  }
  for (const m of text.matchAll(/\(\s*\[([^\]]*)\]\s*\)\s*=>/g)) {
    m[1].split(',').forEach((p) => {
      const id = p.trim(); if (/^[A-Za-z_$][\w$]*$/.test(id)) into.add(id);
    });
  }
  return into;
}
const moduleDecls = collectDecls(src, new Set());

const GLOBALS = new Set(['window', 'document', 'navigator', 'location', 'history', 'console',
  'Math', 'Date', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Map', 'Set',
  'Promise', 'Error', 'RegExp', 'Intl', 'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader',
  'crypto', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'isFinite', 'isNaN',
  'parseInt', 'parseFloat', 'requestAnimationFrame', 'indexedDB', 'localStorage', 'alert',
  'prompt', 'confirm', 'TextEncoder', 'TextDecoder', 'Uint8Array', 'ArrayBuffer', 'btoa', 'atob',
  'DB', 'U', 'CSV', 'Charts', 'Detect', 'undefined', 'null', 'true', 'false', 'this', 'arguments', 'globalThis', 'Infinity', 'NaN']);
const KEYWORDS = new Set(['function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch',
  'case', 'break', 'continue', 'const', 'let', 'var', 'new', 'typeof', 'instanceof', 'in', 'of',
  'delete', 'void', 'try', 'catch', 'finally', 'throw', 'async', 'await', 'yield', 'class',
  'extends', 'super', 'static', 'get', 'set', 'default', 'export', 'import', 'from', 'as']);

const targets = process.argv.slice(2);
let problems = 0;
for (const name of targets) {
  const body = extract(name, src);
  if (!body) { console.log('  ✗ ' + name + ' — not found'); problems++; continue; }
  const c = strip(body);
  const local = collectDecls(body, new Set([name]));
  // arrow / function params
  for (const m of c.matchAll(/\(([^()]*)\)\s*=>/g)) {
    m[1].split(',').forEach((p) => {
      const id = p.trim().replace(/=.*/, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(id)) local.add(id);
    });
  }
  for (const m of c.matchAll(/\b([A-Za-z_$][\w$]*)\s*=>/g)) local.add(m[1]);
  for (const m of c.matchAll(/function\s*[A-Za-z_$\w]*\s*\(([^()]*)\)/g)) {
    m[1].split(',').forEach((p) => {
      const id = p.trim().replace(/=.*/, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(id)) local.add(id);
    });
  }
  for (const m of c.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
  for (const m of c.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) local.add(m[1]);

  // Identifiers actually read: skip property accesses (.foo) and object keys (foo:)
  const unknown = new Set();
  const noProps = c.replace(/\.\s*[A-Za-z_$][\w$]*/g, '.')
                   .replace(/([{,]\s*)[A-Za-z_$][\w$]*\s*:/g, '$1');
  for (const m of noProps.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
    const id = m[1];
    if (KEYWORDS.has(id) || GLOBALS.has(id) || local.has(id) || moduleDecls.has(id)) continue;
    unknown.add(id);
  }
  if (unknown.size) {
    console.log('  ✗ ' + name + ' — undeclared: ' + [...unknown].join(', '));
    problems++;
  } else {
    console.log('  ✓ ' + name + ' — every identifier resolves');
  }
}
console.log(problems ? '\n' + problems + ' FAILED' : '\nscope check clean');
process.exit(problems ? 1 : 0);
