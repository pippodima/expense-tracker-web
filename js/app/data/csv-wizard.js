/* CSV / JSON import wizard: categories from the file, column mapping, and the preview. */
'use strict';

/* ======================= CSV import wizard ======================= */

/* ---- Categories carried by the file itself ----
   An export from another money app usually already has a category column, and it
   is better evidence than our keyword rules: it is what the user actually filed
   the transaction under. Names that match a category here are reused; the rest can
   be created, so importing a year of history doesn't land wholesale in "Other". */

/** Comparison form for a category name: case, accents and spacing don't count. */
function catKey(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

/** A plausible icon for a category we've never seen, in Italian or English.
    Only a guess — the user can change it in Settings like any other category. */
function catEmojiFor(name) {
  const TABLE = [
    [/spesa|spese|grocer|supermerc|alimentar/, '🛒'],
    [/ristorant|restaurant|pizz|trattoria|sushi|mensa/, '🍽️'],
    [/^bar$|caffe|caff\b|coffee|colazione/, '☕'],
    [/intrattenim|entertain|svago|cinema|concert|musica|music/, '🎬'],
    [/giochi|gioco|gaming|videogame|game/, '🎮'],
    [/benzina|carburant|fuel|rifornim/, '⛽'],
    [/auto|macchina|\bcar\b|parcheg|parking/, '🚗'],
    [/trasport|transport|viaggi|treno|train|taxi|\bbus\b|metro/, '🚌'],
    [/shopping|abbigliam|vestit|clothes|clothing/, '🛍️'],
    [/bollett|utenz|utilit|bills?|luce|energia|gas\b/, '💡'],
    [/casa|affitto|rent|home|house|mutuo/, '🏠'],
    [/telefon|phone|mobile|internet|wifi/, '📱'],
    [/salute|sanita|health|farmac|medic|dottore|dentist/, '💊'],
    [/sport|palestra|\bgym\b|fitness|benessere/, '❤️'],
    [/libri|book|scuola|school|corso|course/, '📚'],
    [/volo|flight|aereo|airline/, '✈️'],
    [/vacanz|holiday|vacation|hotel/, '🏖️'],
    [/regal|gift/, '🎁'],
    [/stipendio|salary|salari|paycheck|entrate|income/, '💰'],
    [/lavoro|work|business|freelance/, '💼'],
    [/investim|invest|risparmi|saving/, '📈'],
    [/animal|\bpet\b|cane|gatto/, '🐾'],
    [/bambin|bimb|child|baby|figli/, '👶'],
    [/universit|studi|educaz|educat/, '🎓'],
    [/ripar|repair|manutenz|maintenance/, '🔧']
  ];
  const n = catKey(name);
  for (const [re, icon] of TABLE) if (re.test(n)) return icon;
  return '📦';
}

/** Match a file's category names against the app's own.
    Returns { existing: Map(key → categoryId), fresh: [{ key, name, icon, color, count }] },
    `fresh` in first-seen order, each with a colour that continues the palette rather
    than repeating one. */
function planImportCategories(rawNames, cats) {
  const existing = new Map();
  for (const c of cats) {
    const k = catKey(c.name);
    if (k && !existing.has(k)) existing.set(k, c.id);
  }
  const fresh = new Map();
  for (const raw of rawNames) {
    const k = catKey(raw);
    if (!k || existing.has(k)) continue;
    if (fresh.has(k)) { fresh.get(k).count++; continue; }
    fresh.set(k, {
      key: k, name: String(raw).trim(), icon: catEmojiFor(raw), count: 1,
      color: U.PALETTE_ORDER[(cats.length + fresh.size) % U.PALETTE_ORDER.length]
    });
  }
  return { existing, fresh: [...fresh.values()] };
}

/** Import any bank CSV or another app's JSON export: the shape is worked out
    from the header names *and* the values, then shown for confirmation. */
function openCsvWizard() {
  if (DB.state.accounts.length === 0) return toast('Create an account first');
  pickFile('.csv,.json,.txt,text/csv,application/json,text/plain', (text, filename) => {
    const trimmed = text.trim();
    let rows = null;

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      let json;
      try { json = JSON.parse(trimmed); } catch { return toast('That JSON could not be read'); }
      // Our own formats have dedicated importers
      if (json && json.kind === 'bank-sync') return handleBankSyncData(json);
      if (json && json.app === 'expense-tracker') {
        return toast('That is an app backup — use Backup → Import backup');
      }
      const records = Detect.findRecordArray(json);
      if (!records || !records.length) return toast('No transactions found in that JSON');
      // Flatten objects to rows so the same mapping UI works for JSON and CSV
      const keys = [...records.reduce((set, r) => {
        Object.keys(r || {}).forEach((k) => {
          if (r[k] === null || typeof r[k] !== 'object') set.add(k);
        });
        return set;
      }, new Set())];
      rows = [keys, ...records.map((r) => keys.map((k) => (r && r[k] != null ? String(r[k]) : '')))];
    } else {
      const parsed = CSV.parse(text);
      if (!parsed.rows.length) return toast('Could not read that file');
      rows = parsed.rows;
      // Drop preamble junk above the real header (many banks add account info)
      const hdr = Detect.findHeaderRow(rows);
      if (hdr.headerIndex > 0) rows = rows.slice(hdr.headerIndex);
      else if (!hdr.hasHeader) rows = [rows[0].map((_, i) => 'Column ' + (i + 1)), ...rows];
    }

    if (!rows || rows.length < 2 || rows[0].length < 2) {
      return toast('Could not find columns in that file');
    }
    openMappingSheet(rows, filename);
  });
}

function openMappingSheet(rows, filename) {
  const st = {
    hasHeader: true,
    dateCol: 0, descCol: 1, mode: 'single',
    amountCol: Math.max(rows[0].length - 1, 2), debitCol: 2, creditCol: 3,
    invert: false,
    catCol: null,
    accountId: DB.state.accounts[0].id
  };
  // Detection: header names + what the values actually look like
  const dataRows = rows.slice(1);
  const guess = Detect.detectColumns(rows[0], dataRows);
  if (guess.date) st.dateCol = guess.date.i;
  if (guess.description) st.descCol = guess.description.i;
  if (guess.amount) st.amountCol = guess.amount.i;
  if (guess.category) st.catCol = guess.category.i;
  if (guess.pair) {
    st.mode = 'double';
    st.debitCol = guess.debit.i;
    st.creditCol = guess.credit.i;
  }
  // Unsigned amount + a separate Uscita/Entrata (or Debit/Credit) column?
  if (!guess.pair) {
    const skip = new Set([st.dateCol, st.amountCol, st.descCol]);
    const dir = Detect.detectDirectionColumn(rows[0], dataRows, skip);
    if (dir) {
      st.mode = 'typed';
      st.typeCol = dir.i;
      st.typeMap = {};
      dir.values.forEach((v) => { st.typeMap[v] = Detect.classifyDirection(v) || 'expense'; });
    }
  }
  // Date convention (DD/MM vs MM/DD vs ISO) and decimal convention
  const dateVals = dataRows.map((r) => r[st.dateCol]);
  st.dateFmt = Detect.detectDateFormat(dateVals);
  const amtVals = dataRows.map((r) => r[st.mode === 'double' ? st.debitCol : st.amountCol]);
  st.amtFmt = Detect.detectAmountFormat(amtVals);
  st.detected = guess;

  openSheet('Check the columns', (body, api) => {
    const colOptions = (selected) => {
      const sel = el('select');
      rows[0].forEach((h, i) => sel.append(el('option', {
        value: String(i),
        text: (st.hasHeader ? h || '(column ' + (i + 1) + ')' : 'Column ' + (i + 1))
      })));
      sel.value = String(selected);
      return sel;
    };

    function draw() {
      body.innerHTML = '';

      // Preset picker
      if (DB.state.presets.length) {
        const pre = el('select', {}, [el('option', { value: '', text: 'Bank preset…' })]);
        DB.state.presets.forEach((p) => pre.append(el('option', { value: p.id, text: p.name })));
        pre.addEventListener('change', () => {
          const p = DB.state.presets.find((x) => x.id === pre.value);
          if (!p) return;
          const m = p.mapping;
          // Prefer header-name matching; fall back to stored indices
          const byName = (nm, idx) => {
            if (nm != null) {
              const i = rows[0].findIndex((h) => h.trim().toLowerCase() === String(nm).trim().toLowerCase());
              if (i >= 0) return i;
            }
            return Math.min(idx || 0, rows[0].length - 1);
          };
          st.hasHeader = m.hasHeader !== false;
          st.mode = m.mode || 'single';
          if (m.typeCol != null) st.typeCol = m.typeCol;
          if (m.typeMap) st.typeMap = Object.assign({}, m.typeMap);
          st.invert = !!m.invert;
          st.dateCol = byName(m.dateName, m.dateCol);
          st.descCol = byName(m.descName, m.descCol);
          st.amountCol = byName(m.amountName, m.amountCol);
          st.debitCol = byName(m.debitName, m.debitCol);
          st.creditCol = byName(m.creditName, m.creditCol);
          // A preset saved before category columns existed simply has none
          st.catCol = m.catCol == null ? null : byName(m.catName, m.catCol);
          draw();
        });
        body.append(el('div', { class: 'field' }, [pre]));
      }

      const headerToggle = el('input', { type: 'checkbox' });
      headerToggle.checked = st.hasHeader;
      headerToggle.addEventListener('change', () => { st.hasHeader = headerToggle.checked; draw(); });

      const dateSel = colOptions(st.dateCol);
      const descSel = colOptions(st.descCol);
      dateSel.addEventListener('change', () => { st.dateCol = +dateSel.value; });
      descSel.addEventListener('change', () => { st.descCol = +descSel.value; });

      // Optional: a column already holding the category, as other money apps export
      const catSel = colOptions(st.catCol == null ? 0 : st.catCol);
      catSel.prepend(el('option', { value: '', text: 'None — use my keyword rules' }));
      catSel.value = st.catCol == null ? '' : String(st.catCol);
      catSel.addEventListener('change', () => {
        st.catCol = catSel.value === '' ? null : +catSel.value;
      });

      const modeSeg = el('div', { class: 'seg seg-4' });
      const bSingle = el('button', { text: 'Signed amount', class: st.mode === 'single' ? 'active' : '' });
      const bDouble = el('button', { text: 'Debit + credit', class: st.mode === 'double' ? 'active' : '' });
      const bTyped = el('button', { text: 'Amount + type', class: st.mode === 'typed' ? 'active' : '' });
      bSingle.addEventListener('click', () => { st.mode = 'single'; draw(); });
      bDouble.addEventListener('click', () => { st.mode = 'double'; draw(); });
      bTyped.addEventListener('click', () => {
        st.mode = 'typed';
        if (st.typeCol == null) {
          const skip = new Set([st.dateCol, st.amountCol, st.descCol]);
          const dir = Detect.detectDirectionColumn(rows[0], rows.slice(1), skip);
          st.typeCol = dir ? dir.i : rows[0].findIndex((_, i) => !skip.has(i));
        }
        if (!st.typeMap) st.typeMap = {};
        draw();
      });
      modeSeg.append(bSingle, bDouble, bTyped);

      const acctSel = el('select', {}, DB.state.accounts.map((a) =>
        el('option', { value: a.id, text: acctIcon(a.type) + ' ' + a.name })));
      acctSel.value = st.accountId;
      acctSel.addEventListener('change', () => { st.accountId = acctSel.value; });

      const amountFields = el('div');
      if (st.mode === 'single') {
        const amtSel = colOptions(st.amountCol);
        amtSel.addEventListener('change', () => { st.amountCol = +amtSel.value; });
        const inv = el('input', { type: 'checkbox' });
        inv.checked = st.invert;
        inv.addEventListener('change', () => { st.invert = inv.checked; });
        amountFields.append(
          el('div', { class: 'field' }, [el('label', { text: 'Amount column (negative = expense)' }), amtSel]),
          el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:0.85rem;margin-bottom:14px' },
            [inv, el('span', { text: 'Invert sign (positive numbers are expenses)' })])
        );
      } else if (st.mode === 'typed') {
        const amtSel = colOptions(st.amountCol);
        amtSel.addEventListener('change', () => { st.amountCol = +amtSel.value; draw(); });
        const typeSel = colOptions(st.typeCol);
        typeSel.addEventListener('change', () => {
          st.typeCol = +typeSel.value; st.typeMap = {}; draw();
        });
        amountFields.append(
          el('div', { class: 'field' }, [
            el('label', { text: 'Amount column (always positive)' }), amtSel]),
          el('div', { class: 'field' }, [
            el('label', { text: 'Expense / income column' }), typeSel])
        );
        // Map each distinct label to a direction — works for any wording
        const labels = [...new Set(rows.slice(1)
          .map((r) => Detect.norm(r[st.typeCol]))
          .filter((v) => v))].slice(0, 8);
        if (!st.typeMap) st.typeMap = {};
        labels.forEach((v) => {
          if (!st.typeMap[v]) st.typeMap[v] = Detect.classifyDirection(v) || 'expense';
        });
        const mapWrap = el('div', { class: 'field' }, [
          el('label', { text: 'What each label means' })]);
        labels.forEach((v) => {
          const seg2 = el('div', { class: 'seg', style: 'flex:0 0 auto' });
          const be = el('button', { text: 'Expense' });
          const bi = el('button', { text: 'Income' });
          const sync = () => {
            be.className = st.typeMap[v] === 'expense' ? 'active exp' : '';
            bi.className = st.typeMap[v] === 'income' ? 'active inc' : '';
          };
          be.addEventListener('click', () => { st.typeMap[v] = 'expense'; sync(); });
          bi.addEventListener('click', () => { st.typeMap[v] = 'income'; sync(); });
          sync(); seg2.append(be, bi);
          mapWrap.append(el('div', { class: 'typemap-row' }, [
            el('span', { class: 'typemap-label', text: v || '(empty)' }), seg2
          ]));
        });
        amountFields.append(mapWrap);
      } else {
        const debSel = colOptions(st.debitCol);
        const creSel = colOptions(st.creditCol);
        debSel.addEventListener('change', () => { st.debitCol = +debSel.value; });
        creSel.addEventListener('change', () => { st.creditCol = +creSel.value; });
        amountFields.append(
          el('div', { class: 'field-row' }, [
            el('div', { class: 'field' }, [el('label', { text: 'Debit (expenses)' }), debSel]),
            el('div', { class: 'field' }, [el('label', { text: 'Credit (income)' }), creSel])
          ])
        );
      }

      // First-rows preview
      const prev = el('div', { class: 'csv-preview' });
      const table = el('table');
      const preview = rows.slice(0, 4);
      preview.forEach((r0, ri) => {
        const tr = el('tr');
        r0.forEach((cell) => tr.append(el(ri === 0 && st.hasHeader ? 'th' : 'td',
          { text: String(cell).slice(0, 26) })));
        table.append(tr);
      });
      prev.append(table);

      const presetName = el('input', { type: 'text', placeholder: 'e.g. Intesa, Fineco (optional)' });

      const fmtRow = el('div', { class: 'field' }, [el('label', { text: 'Date format' })]);
      const dfSel = el('select', {}, [
        el('option', { value: 'dmy', text: 'Day/Month/Year (31/12/2026)' }),
        el('option', { value: 'mdy', text: 'Month/Day/Year (12/31/2026)' }),
        el('option', { value: 'iso', text: 'Year-Month-Day (2026-12-31)' }),
        el('option', { value: 'text', text: 'With month name (3 luglio 2026)' })
      ]);
      dfSel.value = (st.dateFmt && st.dateFmt.format) || 'dmy';
      dfSel.addEventListener('change', () => {
        st.dateFmt = { format: dfSel.value, ambiguous: false, confidence: 1 };
        draw();
      });
      fmtRow.append(dfSel);
      if (st.dateFmt && st.dateFmt.ambiguous) {
        fmtRow.append(el('div', { class: 'note-suggest', text:
          'Every date fits both readings (no day above 12), so check this is right.' }));
      }

      const detectedNote = el('p', { class: 'muted', style: 'margin-bottom:10px', text:
        filename + ' · ' + (rows.length - 1) + ' rows · detected ' +
        (st.mode === 'double' ? 'debit/credit columns'
          : st.mode === 'typed' ? 'an amount column plus an expense/income column'
          : 'a single signed amount column') +
        (st.amtFmt ? ', ' + (st.amtFmt.format === 'eu' ? '1.234,56' : '1,234.56') + ' numbers' : '') });

      body.append(
        detectedNote,
        prev,
        el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:0.85rem;margin-bottom:14px' },
          [headerToggle, el('span', { text: 'First row is a header' })]),
        el('div', { class: 'field' }, [el('label', { text: 'Date column' }), dateSel]),
        fmtRow,
        el('div', { class: 'field' }, [el('label', { text: 'Description column' }), descSel]),
        el('div', { class: 'field' }, [
          el('label', { text: 'Category column (optional)' }), catSel,
          el('div', { class: 'note-suggest', text:
            'Names matching your categories are reused; the rest can be created in the ' +
            'next step. Leave as None to categorize from your keyword rules instead.' })
        ]),
        el('div', { class: 'field' }, [el('label', { text: 'Amount layout' }), modeSeg]),
        amountFields,
        el('div', { class: 'field' }, [el('label', { text: 'Import into account' }), acctSel]),
        el('div', { class: 'field' }, [el('label', { text: 'Save mapping as preset' }), presetName]),
        el('button', {
          class: 'btn block primary', text: 'Preview import',
          onclick: async () => {
            if (presetName.value.trim()) {
              await DB.put('presets', {
                id: null, name: presetName.value.trim(),
                mapping: {
                  hasHeader: st.hasHeader, mode: st.mode, invert: st.invert,
                  typeCol: st.typeCol, typeMap: st.typeMap,
                  dateCol: st.dateCol, descCol: st.descCol, amountCol: st.amountCol,
                  debitCol: st.debitCol, creditCol: st.creditCol, catCol: st.catCol,
                  dateName: st.hasHeader ? rows[0][st.dateCol] : null,
                  descName: st.hasHeader ? rows[0][st.descCol] : null,
                  amountName: st.hasHeader ? rows[0][st.amountCol] : null,
                  debitName: st.hasHeader ? rows[0][st.debitCol] : null,
                  creditName: st.hasHeader ? rows[0][st.creditCol] : null,
                  catName: st.hasHeader && st.catCol != null ? rows[0][st.catCol] : null
                }
              });
            }
            api.close();
            openImportPreview(rows, st);
          }
        })
      );
    }
    draw();
  });
}

function openImportPreview(rows, st) {
  const dataRows = st.hasHeader ? rows.slice(1) : rows;
  const existing = DB.existingDupKeys();
  const seen = new Set();
  const good = [], dups = [];
  let invalid = 0;

  for (const r of dataRows) {
    const dateISO = st.dateFmt
      ? Detect.parseDateSmart(r[st.dateCol], st.dateFmt.format)
      : CSV.parseDate(r[st.dateCol]);
    const desc = String(r[st.descCol] || '').trim();
    let signed = null;
    const money = (v) => (st.amtFmt
      ? Detect.parseAmountSmart(v, st.amtFmt.format) : CSV.parseAmount(v));
    if (st.mode === 'typed') {
      const val = money(r[st.amountCol]);
      if (val != null) {
        const dir = st.typeMap[Detect.norm(r[st.typeCol])] ||
          Detect.classifyDirection(r[st.typeCol]) || 'expense';
        signed = dir === 'income' ? Math.abs(val) : -Math.abs(val);
      }
    } else if (st.mode === 'single') {
      signed = money(r[st.amountCol]);
      if (signed != null && st.invert) signed = -signed;
    } else {
      const deb = money(r[st.debitCol]);
      const cre = money(r[st.creditCol]);
      if (deb != null && deb !== 0) signed = -Math.abs(deb);
      else if (cre != null && cre !== 0) signed = Math.abs(cre);
    }
    if (!dateISO || signed == null || signed === 0) { invalid++; continue; }
    signed = Math.round(signed * 100) / 100;

    const key = DB.dupKey(dateISO, signed, desc);
    if (existing.has(key) || seen.has(key)) { dups.push(r); continue; }
    seen.add(key);

    good.push({
      id: null,
      date: dateISO,
      amount: Math.abs(signed),
      type: signed >= 0 ? 'income' : 'expense',
      categoryId: null,                       // resolved below, once the plan is known
      accountId: st.accountId,
      note: desc,
      _rawCat: st.catCol == null ? '' : String(r[st.catCol] || '').trim(),
      // Money leaving the bank with a withdrawal wording: probably cash, not spending
      _withdrawal: signed < 0 && Detect.looksWithdrawal(desc)
    });
  }

  /* Categories can't be assigned row by row above: the ones the file names but the
     app doesn't have yet don't exist until the user agrees to create them. */
  const plan = st.catCol == null
    ? { existing: new Map(), fresh: [] }
    : planImportCategories(good.map((g) => g._rawCat), DB.state.categories);
  const toCreate = new Set(plan.fresh.map((f) => f.key));   // every new name, on by default
  const freshByKey = new Map(plan.fresh.map((f) => [f.key, f]));

  /* Precedence: the file's own category beats a keyword rule, because it's what the
     user actually filed the transaction under rather than something we inferred. */
  function assignCategories() {
    const fallback = DB.state.categories.find((c) => c.name === 'Other') ||
      DB.state.categories[0];
    for (const g of good) {
      const k = catKey(g._rawCat);
      if (k && plan.existing.has(k)) { g.categoryId = plan.existing.get(k); g._catSource = 'file'; }
      else if (k && toCreate.has(k)) { g.categoryId = null; g._catSource = 'new'; }
      else {
        const c = DB.suggestCategory(g.note);
        g.categoryId = (c || fallback).id;
        g._catSource = c ? 'rule' : 'fallback';
      }
    }
  }
  assignCategories();

  /** What the Category cell should read, including categories not created yet. */
  const catLabel = (g) => {
    if (g._catSource === 'new') {
      const f = freshByKey.get(catKey(g._rawCat));
      return f ? f.icon + ' ' + f.name + ' · new' : '';
    }
    const c = DB.category(g.categoryId);
    return c ? c.icon + ' ' + c.name : '';
  };

  openSheet('Confirm import', (body, api) => {
    const summary = el('div', { class: 'import-summary card' });
    const drawSummary = () => {
      const fromFile = good.filter((g) => g._catSource === 'file' || g._catSource === 'new').length;
      summary.innerHTML =
        `<span class="ok">${good.length} new transactions</span> ready to import<br>` +
        `<span class="dup">${dups.length} duplicates skipped (same date + amount + description)</span><br>` +
        (invalid ? `<span class="dup">${invalid} rows skipped (no valid date/amount)</span><br>` : '') +
        (st.catCol == null ? ''
          : `<span class="dup">${fromFile} categorized from the file</span><br>`) +
        `<span class="dup">${good.filter((g) => g._catSource === 'rule').length} auto-categorized by your rules</span>`;
    };
    drawSummary();
    body.append(summary);

    // --- Cash withdrawals: offer to book them as transfers to a cash account ---
    const cashAccts = DB.state.accounts.filter((a) => a.type === 'cash');
    const wset = Object.assign({ mode: 'transfer', toAccountId: (cashAccts[0] || {}).id },
      DB.state.meta.withdrawalSettings || {});
    const withdrawals = good.filter((g) => g._withdrawal);
    if (withdrawals.length) {
      const card = el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [
          el('h2', { text: 'Cash withdrawals' }),
          el('span', { class: 'muted', text: withdrawals.length + ' found' })
        ]),
        el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:10px', text:
          'These look like cash coming out of the bank rather than money spent. Booking ' +
          'them as transfers keeps your balances right and avoids counting the same money ' +
          'twice when you log what the cash was spent on.' })
      ]);
      const seg = el('div', { class: 'seg', style: 'margin-bottom:10px' });
      const bT = el('button', { text: 'Transfer to cash' });
      const bE = el('button', { text: 'Treat as expense' });
      const acctSel = el('select', {}, DB.state.accounts.map((a) =>
        el('option', { value: a.id, text: acctIcon(a.type) + ' ' + a.name })));
      if (wset.toAccountId) acctSel.value = wset.toAccountId;
      acctSel.addEventListener('change', () => { wset.toAccountId = acctSel.value; });
      const acctField = el('div', { class: 'field' },
        [el('label', { text: 'Cash goes to' }), acctSel]);
      const syncW = () => {
        bT.className = wset.mode === 'transfer' ? 'active' : '';
        bE.className = wset.mode === 'expense' ? 'active' : '';
        acctField.style.display = wset.mode === 'transfer' ? '' : 'none';
      };
      bT.addEventListener('click', () => { wset.mode = 'transfer'; syncW(); });
      bE.addEventListener('click', () => { wset.mode = 'expense'; syncW(); });
      syncW(); seg.append(bT, bE);
      card.append(seg, acctField);
      // Each row can be opted out — protects against a false positive
      withdrawals.forEach((g) => {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = true;
        cb.addEventListener('change', () => { g._withdrawal = cb.checked; });
        card.append(el('label', { class: 'switch-row' }, [
          el('div', { class: 's-main' }, [
            el('div', { text: g.note.slice(0, 34) || 'Withdrawal' }),
            el('div', { class: 's-sub', text: U.fmtDate(g.date) + ' · ' + fmtEUR(g.amount) })
          ]),
          cb
        ]));
      });
      body.append(card);
      st._wset = wset;
    }

    // --- Categories the file names but this app doesn't have yet ---
    const previewWrap = el('div');
    const drawPreview = () => {
      previewWrap.innerHTML = '';
      if (!good.length) return;
      const prev = el('div', { class: 'csv-preview' });
      const table = el('table');
      const tr = el('tr');
      ['Date', 'Description', 'Amount', 'Category'].forEach((h) => tr.append(el('th', { text: h })));
      table.append(tr);
      good.slice(0, 8).forEach((g) => {
        const row = el('tr');
        row.append(
          el('td', { text: U.fmtDate(g.date, { day: '2-digit', month: '2-digit', year: 'numeric' }) }),
          el('td', { text: g.note.slice(0, 30) }),
          el('td', { text: (g.type === 'income' ? '+' : '−') + fmtEUR(g.amount) }),
          el('td', { text: catLabel(g) })
        );
        table.append(row);
      });
      prev.append(table);
      previewWrap.append(prev);
      if (good.length > 8) {
        previewWrap.append(el('p', { class: 'muted', text: '…and ' + (good.length - 8) + ' more' }));
      }
    };

    if (plan.fresh.length) {
      const matched = new Set(good.filter((g) => g._catSource === 'file')
        .map((g) => catKey(g._rawCat))).size;
      const card = el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [
          el('h2', { text: 'New categories' }),
          el('span', { class: 'muted', text: plan.fresh.length + ' found' })
        ]),
        el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:10px', text:
          'The file files these transactions under names you don\'t have yet' +
          (matched ? ' (' + matched + ' other name' + (matched === 1 ? '' : 's') +
            ' already matched your categories)' : '') +
          '. Create them and the history keeps its own categories; leave one off and ' +
          'those rows fall back to your keyword rules. You can rename or re-icon any of ' +
          'them later in Settings.' })
      ]);
      plan.fresh.forEach((f) => {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = true;
        cb.addEventListener('change', () => {
          if (cb.checked) toCreate.add(f.key); else toCreate.delete(f.key);
          assignCategories(); drawSummary(); drawPreview();
        });
        card.append(el('label', { class: 'switch-row' }, [
          el('span', { class: 'tx-icon', text: f.icon, style: 'background:' + U.tintOf(f.color) }),
          el('div', { class: 's-main' }, [
            el('div', { text: f.name }),
            el('div', { class: 's-sub', text: f.count + ' transaction' + (f.count === 1 ? '' : 's') })
          ]),
          cb
        ]));
      });
      body.append(card);
    }

    drawPreview();
    body.append(previewWrap);

    body.append(
      el('div', { class: 'spacer' }),
      el('button', {
        class: 'btn block primary',
        text: good.length ? 'Import ' + good.length + ' transactions' : 'Nothing to import',
        onclick: async () => {
          if (!good.length) return;
          /* Create first, then re-resolve: the withdrawal pass below clears the
             category on rows it turns into transfers, so it has to run after this. */
          const creating = plan.fresh.filter((f) => toCreate.has(f.key));
          if (creating.length) {
            const objs = creating.map((f) => ({ id: null, name: f.name, icon: f.icon, color: f.color }));
            await DB.bulkPut('categories', objs);        // bulkPut fills in each id
            creating.forEach((f, i) => plan.existing.set(f.key, objs[i].id));
            assignCategories();
          }
          const wcfg = st._wset;
          if (wcfg && wcfg.mode === 'transfer' && wcfg.toAccountId) {
            good.forEach((g) => {
              if (!g._withdrawal || g.type !== 'expense') return;
              if (wcfg.toAccountId === g.accountId) return;   // can't transfer to itself
              g.type = 'transfer';
              g.toAccountId = wcfg.toAccountId;
              g.categoryId = null;
              delete g.needsReview;
            });
            await DB.setMeta('withdrawalSettings',
              { mode: wcfg.mode, toAccountId: wcfg.toAccountId });
          } else if (wcfg) {
            await DB.setMeta('withdrawalSettings', { mode: 'expense' });
          }
          good.forEach((g) => {
            delete g._withdrawal; delete g._rawCat; delete g._catSource;
          });
          await DB.bulkPut('transactions', good);
          await bumpChanges(good.length);
          await DB.setMeta('everImported', true);   // ticks the setup checklist
          api.close();
          toast(good.length + ' transactions imported');
          show('transactions');
        }
      })
    );
  });
}
