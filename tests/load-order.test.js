/* The app is many plain scripts sharing one global scope (see js/app/core/state.js).
   That brings failure modes `node --check` can't see, file by file:
     · two files declaring the same top-level name — a SyntaxError at load;
     · a file using another file's const at load time, before that file has run;
     · a script missing from sw.js — fine online, broken offline.
   So: load every <script> from index.html, in order, into ONE context (as the browser
   does), and compare the list against the service worker's. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { ROOT, scripts } = require('./app-source');

let fails = 0;
const ok = (n, c, extra) => {
  if (c) console.log('  ✓ ' + n);
  else { fails++; console.log('  ✗ ' + n + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};

console.log('index.html');
const missingOnDisk = scripts.filter((s) => !fs.existsSync(path.join(ROOT, s)));
ok('every script exists', !missingOnDisk.length, missingOnDisk);
ok('boot.js loads last', scripts[scripts.length - 1] === 'js/app/boot.js', scripts.slice(-1));
ok('no script listed twice', new Set(scripts).size === scripts.length);

console.log('sw.js');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const assets = [...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
const uncached = scripts.filter((s) => !assets.includes(s));
ok('every script is cached for offline', !uncached.length, uncached);
const stale = assets.filter((a) => a.endsWith('.js') && !scripts.includes(a));
ok('no cached script that the page no longer loads', !stale.length, stale);

console.log('loading in one shared scope');
const listeners = [];
const ctx = vm.createContext({
  console, Intl, Date, Math, Number, String, Array, Object, JSON, Map, Set, Promise,
  setTimeout, clearTimeout, crypto: { randomUUID: () => 'x' },
  window: { matchMedia: () => ({ matches: false }), addEventListener() {} },
  document: { addEventListener: (type, fn) => listeners.push(type),
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
    querySelector: () => null, body: {} },
  navigator: {}, location: { search: '' }
});
let loaded = 0;
for (const s of scripts) {
  try {
    new vm.Script(fs.readFileSync(path.join(ROOT, s), 'utf8'), { filename: s }).runInContext(ctx);
    loaded++;
  } catch (e) {
    ok(s + ' loads', false, e.message);
  }
}
ok('all ' + scripts.length + ' scripts load without throwing', loaded === scripts.length);
ok('boot waits for DOMContentLoaded', listeners.includes('DOMContentLoaded'), listeners);
ok('boot is reachable from the shared scope', vm.runInContext('typeof boot', ctx) === 'function');

if (fails) { console.log(fails + ' failed'); process.exit(1); }
