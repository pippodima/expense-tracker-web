/* The app's source, as the browser sees it: every <script> under js/app/ in
   index.html, in load order, joined into one string. The files share one global
   scope at runtime, so tests extract functions from this text exactly as they did
   when it was a single js/app.js.

     const { src, files, scripts } = require('./app-source');
       src      — the joined js/app/ source
       files    — js/app/ paths, in load order
       scripts  — every local <script src> in index.html, in load order */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
const files = scripts.filter((s) => s.startsWith('js/app/'));
if (!files.length) throw new Error('no js/app/ scripts found in index.html');

const src = files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n\n');

module.exports = { ROOT, src, files, scripts };
