/* Bottom sheets and dialogs: open/close, drag-to-dismiss, and the confirm sheet. */
'use strict';

/* ======================= Sheets & dialogs ======================= */

function openSheet(title, build, opts) {
  const z = ++ui.sheetZ;
  const backdrop = el('div', { class: 'sheet-backdrop', style: `z-index:${z}` });
  const head = el('div', { class: 'sheet-head' }, [
    el('h2', { text: title }),
    el('button', { class: 'btn small ghost', text: 'Close' })
  ]);
  const body = el('div', { class: 'sheet-body' });
  /* A sibling of the scrolling body, not a sticky child of it: a sticky footer still
     has the rest of the list passing underneath it, which reads as a misplaced bar
     floating over the content. Out here nothing can scroll past it. */
  const foot = el('div', { class: 'sheet-foot', hidden: true });
  const grip = el('div', { class: 'sheet-grip' });
  const sheet = el('div', { class: 'sheet' + (opts && opts.tall ? ' tall' : ''), style: `z-index:${z + 1}` },
    [grip, head, body, foot]);
  document.body.append(backdrop, sheet);
  requestAnimationFrame(() => { backdrop.classList.add('show'); sheet.classList.add('show'); });

  const api = {
    body,
    close() {
      backdrop.classList.remove('show');
      sheet.classList.remove('show');
      setTimeout(() => { backdrop.remove(); sheet.remove(); }, 260);
    },
    setTitle(t) { head.querySelector('h2').textContent = t; },
    /** Pin a bar below the scroll area. Pass null to take it away again. */
    setFooter(node) {
      foot.innerHTML = '';
      if (node) foot.append(node);
      foot.hidden = !node;
    }
  };
  head.querySelector('button').addEventListener('click', api.close);
  backdrop.addEventListener('click', api.close);
  enableDragClose(sheet, backdrop, body, [grip, head], api.close);
  build(body, api);
  return api;
}

/* Drag a sheet downward to dismiss it. A drag starts only from the grip/header,
   or from the body when it's scrolled to the top — so inner scrolling still works. */
function enableDragClose(sheet, backdrop, body, handles, close) {
  let startY = 0, startX = 0, curDy = 0, dragging = false, decided = false, fromHandle = false;

  sheet.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    startY = t.clientY; startX = t.clientX; curDy = 0;
    dragging = false; decided = false;
    fromHandle = handles.some((h) => h.contains(e.target));
  }, { passive: true });

  sheet.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    const dy = t.clientY - startY, dx = t.clientX - startX;
    if (!decided) {
      if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
      decided = true;
      dragging = dy > 0 && Math.abs(dy) > Math.abs(dx) &&
        (fromHandle || body.scrollTop <= 0);
    }
    if (!dragging) return;
    curDy = Math.max(0, dy);
    e.preventDefault();
    sheet.style.transition = 'none';
    sheet.style.transform = `translateY(${curDy}px)`;
    backdrop.style.opacity = String(Math.max(0, 1 - curDy / 420));
  }, { passive: false });

  const end = () => {
    if (!dragging) return;
    sheet.style.transition = '';
    backdrop.style.opacity = '';
    if (curDy > 110) close();
    else sheet.style.transform = '';
    dragging = false;
  };
  sheet.addEventListener('touchend', end);
  sheet.addEventListener('touchcancel', end);
}

function confirmSheet(message, confirmLabel, danger) {
  return new Promise((resolve) => {
    const api = openSheet('Are you sure?', (body) => {
      body.append(
        el('p', { text: message, style: 'padding:4px 2px 18px;line-height:1.5' }),
        el('button', {
          class: 'btn block ' + (danger ? 'danger' : 'primary'),
          text: confirmLabel || 'Confirm',
          onclick: () => { done(true); }
        }),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn block', text: 'Cancel', onclick: () => done(false) })
      );
      function done(v) { api.close(); resolve(v); }
    });
  });
}
