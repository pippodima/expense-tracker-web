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
  /* With the keyboard up, the backdrop is most of what's still visible above the
     sheet, so tapping it is how people lower the keyboard. That tap must not throw
     away a half-filled form: it lowers the keyboard, and the next tap closes. Whether
     you were typing is read on touch-down, before the browser can move focus. */
  let typingAtTouch = false;
  backdrop.addEventListener('pointerdown', () => { typingAtTouch = !!typingIn(sheet); });
  backdrop.addEventListener('click', () => {
    if (typingAtTouch || typingIn(sheet)) { lowerKeyboard(sheet); typingAtTouch = false; return; }
    api.close();
  });
  enableDragClose(sheet, backdrop, body, [grip, head], api.close);
  build(body, api);
  return api;
}

/* The field inside `sheet` that has the keyboard up, or null. Checkboxes, buttons
   and the like take focus too but bring up no keyboard, so they don't count. */
const NO_KEYBOARD = ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'];
function typingIn(sheet) {
  const a = document.activeElement;
  if (!a || a === document.body || !sheet.contains(a)) return null;
  if (a.tagName === 'TEXTAREA' || a.isContentEditable) return a;
  if (a.tagName === 'INPUT' && !NO_KEYBOARD.includes(a.type)) return a;
  return null;
}

function lowerKeyboard(sheet) {
  const a = typingIn(sheet);
  if (a) a.blur();
}

/* Drag a sheet downward to dismiss it. A drag starts only from the grip/header,
   or from the body when it's scrolled to the top — so inner scrolling still works.
   While you're typing, a downward swipe is how you push the keyboard away; it
   lowers the keyboard and leaves the sheet — and what you typed — where it is. */
function enableDragClose(sheet, backdrop, body, handles, close) {
  let startY = 0, startX = 0, curDy = 0, dragging = false, decided = false, fromHandle = false;
  let typing = false;

  sheet.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    startY = t.clientY; startX = t.clientX; curDy = 0;
    dragging = false; decided = false;
    fromHandle = handles.some((h) => h.contains(e.target));
    typing = !!typingIn(sheet);
  }, { passive: true });

  sheet.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    const dy = t.clientY - startY, dx = t.clientX - startX;
    if (!decided) {
      if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
      decided = true;
      const downward = dy > 0 && Math.abs(dy) > Math.abs(dx);
      if (downward && typing) { lowerKeyboard(sheet); return; }
      dragging = downward && (fromHandle || body.scrollTop <= 0);
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
