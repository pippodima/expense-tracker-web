/* SVG charts: category donut + spending-over-time bars.
   Mark specs: 2px surface gaps between fills, bars ≤24px with 4px rounded
   data-end (square at baseline), hairline solid gridlines, text in ink tokens. */
'use strict';

const Charts = (() => {
  const css = (name) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function polar(cx, cy, r, angleDeg) {
    const a = ((angleDeg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }

  function arcPath(cx, cy, rOuter, rInner, a0, a1) {
    const [x0, y0] = polar(cx, cy, rOuter, a0);
    const [x1, y1] = polar(cx, cy, rOuter, a1);
    const [x2, y2] = polar(cx, cy, rInner, a1);
    const [x3, y3] = polar(cx, cy, rInner, a0);
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M ${x0} ${y0} A ${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1} ` +
           `L ${x2} ${y2} A ${rInner} ${rInner} 0 ${large} 0 ${x3} ${y3} Z`;
  }

  /**
   * Donut chart. items: [{ id, label, value, color(hex) }], total > 0.
   * onSelect(idOrNull) fires on slice tap. selectedId highlights one slice.
   */
  function donut(container, items, opts) {
    const { selectedId = null, onSelect = null, centerLabel = '', centerValue = '' } = opts || {};
    const size = 230;
    const cx = size / 2, cy = size / 2;
    const rOuter = 105, rInner = 68;
    const surface = css('--surface');
    const total = items.reduce((s, d) => s + d.value, 0);

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.style.maxWidth = '250px';
    svg.style.margin = '0 auto';

    let angle = 0;
    for (const d of items) {
      const sweep = total > 0 ? (d.value / total) * 360 : 0;
      if (sweep <= 0) continue;
      const p = document.createElementNS(NS, 'path');
      // Full-circle arcs degenerate; clamp just under 360.
      p.setAttribute('d', arcPath(cx, cy, rOuter, rInner, angle, angle + Math.min(sweep, 359.98)));
      p.setAttribute('fill', d.color);
      p.setAttribute('stroke', surface);      // 2px surface gap between segments
      p.setAttribute('stroke-width', '2');
      p.setAttribute('stroke-linejoin', 'round');
      if (selectedId && d.id !== selectedId) p.setAttribute('opacity', '0.3');
      if (onSelect) {
        p.style.cursor = 'pointer';
        p.addEventListener('click', (e) => {
          e.stopPropagation();
          onSelect(d.id === selectedId ? null : d.id);
        });
      }
      svg.appendChild(p);
      angle += sweep;
    }

    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'donut-center');
    const t1 = document.createElementNS(NS, 'text');
    t1.setAttribute('x', cx); t1.setAttribute('y', cy - 10);
    t1.setAttribute('text-anchor', 'middle');
    t1.setAttribute('class', 'dc-label');
    t1.textContent = centerLabel;
    const t2 = document.createElementNS(NS, 'text');
    t2.setAttribute('x', cx); t2.setAttribute('y', cy + 12);
    t2.setAttribute('text-anchor', 'middle');
    t2.setAttribute('class', 'dc-value');
    t2.textContent = centerValue;
    g.appendChild(t1); g.appendChild(t2);
    svg.appendChild(g);

    if (onSelect) svg.addEventListener('click', () => onSelect(null));

    container.innerHTML = '';
    container.appendChild(svg);
  }

  function niceMax(v) {
    if (v <= 0) return 10;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
      if (m * pow >= v) return m * pow;
    }
    return 10 * pow;
  }

  /**
   * Bar chart (single series). data: [{ label, tickLabel?, value }].
   * Tap a bar to see its value in a tooltip.
   */
  function bars(container, data, opts) {
    const { height = 190, color = css('--accent'), formatValue = String,
            onBar = null, refLine = null, refLabel = '' } = opts || {};
    const width = Math.max(280, container.clientWidth || 320);
    const pad = { top: 12, right: 6, bottom: 22, left: 44 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const max = niceMax(Math.max(...data.map((d) => d.value), refLine || 0, 0));

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const grid = css('--hairline');
    const axis = css('--muted');

    // Gridlines + y ticks (clean rounded numbers)
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const y = pad.top + plotH - (plotH * i) / ticks;
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', pad.left); line.setAttribute('x2', width - pad.right);
      line.setAttribute('y1', y); line.setAttribute('y2', y);
      line.setAttribute('stroke', i === 0 ? css('--border') : grid);
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);
      const label = document.createElementNS(NS, 'text');
      label.setAttribute('x', pad.left - 6);
      label.setAttribute('y', y + 3);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('font-size', '9');
      label.setAttribute('fill', axis);
      label.setAttribute('style', 'font-variant-numeric: tabular-nums');
      label.textContent = U.fmtNum((max * i) / ticks);
      svg.appendChild(label);
    }

    const n = data.length;
    const band = plotW / Math.max(n, 1);
    const gap = 2;                                   // surface gap between bars
    const barW = Math.min(24, Math.max(3, band - gap));
    const r = Math.min(4, barW / 2);

    // Thin out x labels so they never collide
    const maxLabels = Math.floor(plotW / 34);
    const step = Math.max(1, Math.ceil(n / maxLabels));

    data.forEach((d, i) => {
      const x = pad.left + band * i + (band - barW) / 2;
      const h = max > 0 ? (d.value / max) * plotH : 0;
      const y = pad.top + plotH - h;
      const p = document.createElementNS(NS, 'path');
      if (h > 0.5) {
        const rr = Math.min(r, h);   // rounded data-end, square at the baseline
        p.setAttribute('d',
          `M ${x} ${pad.top + plotH} L ${x} ${y + rr} Q ${x} ${y} ${x + rr} ${y} ` +
          `L ${x + barW - rr} ${y} Q ${x + barW} ${y} ${x + barW} ${y + rr} ` +
          `L ${x + barW} ${pad.top + plotH} Z`);
        p.setAttribute('fill', color);
      } else {
        p.setAttribute('d', `M ${x} ${pad.top + plotH - 1} h ${barW} v 1 h ${-barW} Z`);
        p.setAttribute('fill', grid);
      }
      svg.appendChild(p);

      // Oversized invisible hit target for touch
      const hit = document.createElementNS(NS, 'rect');
      hit.setAttribute('x', pad.left + band * i);
      hit.setAttribute('y', pad.top);
      hit.setAttribute('width', band);
      hit.setAttribute('height', plotH);
      hit.setAttribute('fill', 'transparent');
      if (onBar) hit.style.cursor = 'pointer';
      hit.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onBar) onBar(d, i);
        else showTip(container, e, d.label + ' · ' + formatValue(d.value));
      });
      svg.appendChild(hit);

      if (i % step === 0) {
        const label = document.createElementNS(NS, 'text');
        label.setAttribute('x', pad.left + band * i + band / 2);
        label.setAttribute('y', height - 6);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('font-size', '9');
        label.setAttribute('fill', axis);
        label.textContent = d.tickLabel != null ? d.tickLabel : d.label;
        svg.appendChild(label);
      }
    });

    // Reference line (a daily allowance, say) drawn over the bars
    if (refLine > 0 && refLine <= max) {
      const y = pad.top + plotH - (refLine / max) * plotH;
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', pad.left); l.setAttribute('x2', width - pad.right);
      l.setAttribute('y1', y); l.setAttribute('y2', y);
      l.setAttribute('stroke', css('--ink-2') || axis);
      l.setAttribute('stroke-width', '1');
      l.setAttribute('stroke-dasharray', '4 3');
      svg.appendChild(l);
      if (refLabel) {
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', width - pad.right); t.setAttribute('y', y - 4);
        t.setAttribute('text-anchor', 'end'); t.setAttribute('font-size', '9');
        t.setAttribute('fill', axis);
        t.textContent = refLabel;
        svg.appendChild(t);
      }
    }

    container.innerHTML = '';
    container.appendChild(svg);
    svg.addEventListener('click', () => hideTip(container));
  }

  function showTip(container, evt, text) {
    let tip = container.querySelector('.chart-tip');
    if (!tip) {
      tip = U.el('div', { class: 'chart-tip' });
      container.appendChild(tip);
    }
    tip.textContent = text;
    const rect = container.getBoundingClientRect();
    const x = Math.min(Math.max(evt.clientX - rect.left, 50), rect.width - 50);
    tip.style.left = x + 'px';
    tip.style.top = Math.max(evt.clientY - rect.top, 30) + 'px';
    tip.style.display = 'block';
    clearTimeout(tip._t);
    tip._t = setTimeout(() => { tip.style.display = 'none'; }, 2500);
  }

  function hideTip(container) {
    const tip = container.querySelector('.chart-tip');
    if (tip) tip.style.display = 'none';
  }

  /**
   * Grouped bars — one small bar per series within each time bucket.
   * buckets: [{ tick, <seriesKey>: value, label }]. series: [{ key, color, label }].
   */
  function groupedBars(container, buckets, series, opts) {
    const { height = 200, formatValue = String } = opts || {};
    const width = Math.max(280, container.clientWidth || 320);
    const pad = { top: 12, right: 6, bottom: 22, left: 46 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const max = niceMax(Math.max(
      ...buckets.flatMap((b) => series.map((s) => b[s.key] || 0)), 0));

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const grid = css('--hairline'), axis = css('--muted');

    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const y = pad.top + plotH - (plotH * i) / ticks;
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', pad.left); line.setAttribute('x2', width - pad.right);
      line.setAttribute('y1', y); line.setAttribute('y2', y);
      line.setAttribute('stroke', i === 0 ? css('--border') : grid);
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);
      const label = document.createElementNS(NS, 'text');
      label.setAttribute('x', pad.left - 6); label.setAttribute('y', y + 3);
      label.setAttribute('text-anchor', 'end'); label.setAttribute('font-size', '9');
      label.setAttribute('fill', axis);
      label.setAttribute('style', 'font-variant-numeric: tabular-nums');
      label.textContent = U.fmtNum((max * i) / ticks);
      svg.appendChild(label);
    }

    const n = buckets.length;
    const band = plotW / Math.max(n, 1);
    const gap = 2;
    const groupW = Math.min(band - 6, series.length * 20 + (series.length - 1) * gap);
    const barW = Math.max(3, (groupW - (series.length - 1) * gap) / series.length);
    const maxLabels = Math.floor(plotW / 34);
    const step = Math.max(1, Math.ceil(n / maxLabels));

    buckets.forEach((bk, i) => {
      const gx = pad.left + band * i + (band - groupW) / 2;
      series.forEach((s, si) => {
        const v = bk[s.key] || 0;
        const x = gx + si * (barW + gap);
        const h = max > 0 ? (v / max) * plotH : 0;
        const y = pad.top + plotH - h;
        const p = document.createElementNS(NS, 'path');
        if (h > 0.5) {
          const rr = Math.min(3, barW / 2, h);
          p.setAttribute('d',
            `M ${x} ${pad.top + plotH} L ${x} ${y + rr} Q ${x} ${y} ${x + rr} ${y} ` +
            `L ${x + barW - rr} ${y} Q ${x + barW} ${y} ${x + barW} ${y + rr} ` +
            `L ${x + barW} ${pad.top + plotH} Z`);
          p.setAttribute('fill', s.color);
          svg.appendChild(p);
        }
      });
      const hit = document.createElementNS(NS, 'rect');
      hit.setAttribute('x', pad.left + band * i); hit.setAttribute('y', pad.top);
      hit.setAttribute('width', band); hit.setAttribute('height', plotH);
      hit.setAttribute('fill', 'transparent');
      hit.addEventListener('click', (e) => {
        e.stopPropagation();
        showTip(container, e, bk.label + ' · ' +
          series.map((s) => s.label + ' ' + formatValue(bk[s.key] || 0)).join('  '));
      });
      svg.appendChild(hit);

      if (i % step === 0) {
        const label = document.createElementNS(NS, 'text');
        label.setAttribute('x', pad.left + band * i + band / 2);
        label.setAttribute('y', height - 6);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('font-size', '9'); label.setAttribute('fill', axis);
        label.textContent = bk.tick;
        svg.appendChild(label);
      }
    });

    container.innerHTML = '';
    container.appendChild(svg);
    svg.addEventListener('click', () => hideTip(container));
  }

  /**
   * Stacked bars — one column per bucket, segments in series order (bottom up).
   * buckets: [{ tick, label, <seriesKey>: value }]. series: [{ key, color, label }].
   * A 2px surface gap separates segments; only the top segment is rounded.
   */
  function stackedBars(container, buckets, series, opts) {
    const { height = 210, formatValue = String } = opts || {};
    const width = Math.max(280, container.clientWidth || 320);
    const pad = { top: 12, right: 6, bottom: 22, left: 46 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const totalOf = (b) => series.reduce((s, x) => s + (b[x.key] || 0), 0);
    const max = niceMax(Math.max(...buckets.map(totalOf), 0));

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const grid = css('--hairline'), axis = css('--muted');

    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const y = pad.top + plotH - (plotH * i) / ticks;
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', pad.left); line.setAttribute('x2', width - pad.right);
      line.setAttribute('y1', y); line.setAttribute('y2', y);
      line.setAttribute('stroke', i === 0 ? css('--border') : grid);
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);
      const label = document.createElementNS(NS, 'text');
      label.setAttribute('x', pad.left - 6); label.setAttribute('y', y + 3);
      label.setAttribute('text-anchor', 'end'); label.setAttribute('font-size', '9');
      label.setAttribute('fill', axis);
      label.setAttribute('style', 'font-variant-numeric: tabular-nums');
      label.textContent = U.fmtNum((max * i) / ticks);
      svg.appendChild(label);
    }

    const n = buckets.length;
    const band = plotW / Math.max(n, 1);
    const barW = Math.min(24, Math.max(4, band - 6));
    const maxLabels = Math.floor(plotW / 34);
    const step = Math.max(1, Math.ceil(n / maxLabels));
    const base = pad.top + plotH;

    buckets.forEach((bk, i) => {
      const x = pad.left + band * i + (band - barW) / 2;
      let acc = 0;
      // Top-most non-empty segment gets the rounded data-end
      let topKey = null;
      for (const s of series) if ((bk[s.key] || 0) > 0) topKey = s.key;
      series.forEach((s) => {
        const v = bk[s.key] || 0;
        if (v <= 0) return;
        const h = max > 0 ? (v / max) * plotH : 0;
        const yTop = base - ((acc + v) / max) * plotH;
        acc += v;
        const gap = h > 4 ? 2 : 0;                 // surface gap, skipped on slivers
        const hh = Math.max(1, h - gap);
        const p = document.createElementNS(NS, 'path');
        if (s.key === topKey) {
          const rr = Math.min(4, barW / 2, hh);
          p.setAttribute('d',
            `M ${x} ${yTop + hh} L ${x} ${yTop + rr} Q ${x} ${yTop} ${x + rr} ${yTop} ` +
            `L ${x + barW - rr} ${yTop} Q ${x + barW} ${yTop} ${x + barW} ${yTop + rr} ` +
            `L ${x + barW} ${yTop + hh} Z`);
        } else {
          p.setAttribute('d', `M ${x} ${yTop} h ${barW} v ${hh} h ${-barW} Z`);
        }
        p.setAttribute('fill', s.color);
        svg.appendChild(p);
      });

      const hit = document.createElementNS(NS, 'rect');
      hit.setAttribute('x', pad.left + band * i); hit.setAttribute('y', pad.top);
      hit.setAttribute('width', band); hit.setAttribute('height', plotH);
      hit.setAttribute('fill', 'transparent');
      hit.addEventListener('click', (e) => {
        e.stopPropagation();
        const parts = series.filter((s) => (bk[s.key] || 0) > 0)
          .sort((a, b) => (bk[b.key] || 0) - (bk[a.key] || 0)).slice(0, 4)
          .map((s) => s.label + ' ' + formatValue(bk[s.key]));
        showTip(container, e, bk.label + ' · ' + formatValue(totalOf(bk)) +
          (parts.length ? ' — ' + parts.join(', ') : ''));
      });
      svg.appendChild(hit);

      if (i % step === 0) {
        const label = document.createElementNS(NS, 'text');
        label.setAttribute('x', pad.left + band * i + band / 2);
        label.setAttribute('y', height - 6);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('font-size', '9'); label.setAttribute('fill', axis);
        label.textContent = bk.tick;
        svg.appendChild(label);
      }
    });

    container.innerHTML = '';
    container.appendChild(svg);
    svg.addEventListener('click', () => hideTip(container));
  }

  /**
   * Several lines sharing one x axis (comparisons: this month vs last, budget pace).
   * series: [{ label, color, dash?, points: [{ tick, label, value }] }] — points
   * may be shorter than the axis (a partial month simply stops early).
   */
  function multiLine(container, series, opts) {
    const { height = 200, formatValue = String, suffix = '' } = opts || {};
    const width = Math.max(280, container.clientWidth || 320);
    const pad = { top: 14, right: 12, bottom: 22, left: 46 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const nx = Math.max(...series.map((s) => s.points.length), 1);
    const all = series.flatMap((s) => s.points.map((p) => p.value));
    let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
    if (lo === hi) hi = lo + 1;
    const span = hi - lo;

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const grid = css('--hairline'), axis = css('--muted');
    const yOf = (v) => pad.top + plotH * (hi - v) / span;
    const xOf = (i) => (nx <= 1 ? pad.left + plotW / 2 : pad.left + (plotW * i) / (nx - 1));

    [hi, (hi + lo) / 2, lo].forEach((gv) => {
      const y = yOf(gv);
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', pad.left); l.setAttribute('x2', width - pad.right);
      l.setAttribute('y1', y); l.setAttribute('y2', y);
      l.setAttribute('stroke', gv === 0 ? css('--border') : grid);
      l.setAttribute('stroke-width', '1');
      svg.appendChild(l);
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', pad.left - 6); t.setAttribute('y', y + 3);
      t.setAttribute('text-anchor', 'end'); t.setAttribute('font-size', '9');
      t.setAttribute('fill', axis);
      t.setAttribute('style', 'font-variant-numeric: tabular-nums');
      t.textContent = U.fmtNum(gv) + suffix;
      svg.appendChild(t);
    });

    series.forEach((s) => {
      if (!s.points.length) return;
      const pts = s.points.map((p, i) => [xOf(i), yOf(p.value)]);
      const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ');
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d); path.setAttribute('fill', 'none');
      path.setAttribute('stroke', s.color);
      path.setAttribute('stroke-width', s.dash ? '1.5' : '2');
      if (s.dash) path.setAttribute('stroke-dasharray', '4 4');
      path.setAttribute('stroke-linejoin', 'round'); path.setAttribute('stroke-linecap', 'round');
      svg.appendChild(path);
      if (!s.dash) {
        const last = pts[pts.length - 1];
        const dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('cx', last[0]); dot.setAttribute('cy', last[1]); dot.setAttribute('r', '4');
        dot.setAttribute('fill', s.color);
        dot.setAttribute('stroke', css('--surface')); dot.setAttribute('stroke-width', '2');
        svg.appendChild(dot);
      }
    });

    // One hit target per x slot, reporting every series that reaches it
    const ticksSrc = series.reduce((a, b) => (b.points.length >= a.points.length ? b : a), series[0]);
    for (let i = 0; i < nx; i++) {
      const hit = document.createElementNS(NS, 'rect');
      const w = nx > 1 ? plotW / nx : plotW;
      hit.setAttribute('x', xOf(i) - w / 2); hit.setAttribute('y', pad.top);
      hit.setAttribute('width', w); hit.setAttribute('height', plotH);
      hit.setAttribute('fill', 'transparent');
      hit.addEventListener('click', (e) => {
        e.stopPropagation();
        const head = (ticksSrc.points[i] || {}).label || '';
        showTip(container, e, head + ' · ' + series
          .filter((s) => s.points[i])
          .map((s) => s.label + ' ' + formatValue(s.points[i].value)).join('  '));
      });
      svg.appendChild(hit);
      const p = ticksSrc.points[i];
      if (p && (nx <= 12 || i % Math.ceil(nx / 8) === 0)) {
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', xOf(i)); t.setAttribute('y', height - 6);
        t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '9');
        t.setAttribute('fill', axis);
        t.textContent = p.tick;
        svg.appendChild(t);
      }
    }

    container.innerHTML = '';
    container.appendChild(svg);
    svg.addEventListener('click', () => hideTip(container));
  }

  /** Tiny inline trend line for list rows. Returns the <svg> element. */
  function sparkline(values, opts) {
    const { color = css('--accent'), width = 56, height = 20 } = opts || {};
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'spark');
    const hi = Math.max(...values, 0.0001), lo = 0;
    const n = values.length;
    const xOf = (i) => (n <= 1 ? width / 2 : (width * i) / (n - 1));
    const yOf = (v) => height - 2 - ((v - lo) / (hi - lo || 1)) * (height - 4);
    const d = values.map((v, i) => (i ? 'L' : 'M') + xOf(i) + ' ' + yOf(v)).join(' ');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d); path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color); path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linejoin', 'round'); path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', xOf(n - 1)); dot.setAttribute('cy', yOf(values[n - 1] || 0));
    dot.setAttribute('r', '2'); dot.setAttribute('fill', color);
    svg.appendChild(dot);
    return svg;
  }

  /**
   * Line chart with a zero baseline (supports negatives), 10% area wash, end marker.
   * points: [{ tick, value, label }]. color is the series hue.
   */
  function line(container, points, opts) {
    const { height = 190, color = css('--accent'), formatValue = String } = opts || {};
    const width = Math.max(280, container.clientWidth || 320);
    const pad = { top: 14, right: 12, bottom: 22, left: 46 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const vals = points.map((p) => p.value);
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    if (lo === hi) hi = lo + 1;
    const span = hi - lo;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const grid = css('--hairline'), axis = css('--muted');

    const yOf = (v) => pad.top + plotH * (hi - v) / span;
    const xOf = (i) => points.length <= 1
      ? pad.left + plotW / 2
      : pad.left + (plotW * i) / (points.length - 1);

    // Gridlines at hi / 0 / lo
    [hi, 0, lo].forEach((gv) => {
      const y = yOf(gv);
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', pad.left); l.setAttribute('x2', width - pad.right);
      l.setAttribute('y1', y); l.setAttribute('y2', y);
      l.setAttribute('stroke', gv === 0 ? css('--border') : grid);
      l.setAttribute('stroke-width', '1');
      svg.appendChild(l);
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', pad.left - 6); t.setAttribute('y', y + 3);
      t.setAttribute('text-anchor', 'end'); t.setAttribute('font-size', '9');
      t.setAttribute('fill', axis);
      t.setAttribute('style', 'font-variant-numeric: tabular-nums');
      t.textContent = U.fmtNum(gv);
      svg.appendChild(t);
    });

    const pts = points.map((p, i) => [xOf(i), yOf(p.value)]);
    const linePath = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ');
    // Area wash down to the zero baseline
    const y0 = yOf(0);
    const area = document.createElementNS(NS, 'path');
    area.setAttribute('d', linePath + ` L ${pts[pts.length - 1][0]} ${y0} L ${pts[0][0]} ${y0} Z`);
    area.setAttribute('fill', color); area.setAttribute('opacity', '0.1');
    svg.appendChild(area);

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', linePath); path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color); path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linejoin', 'round'); path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);

    // End marker with surface ring
    const last = pts[pts.length - 1];
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', last[0]); dot.setAttribute('cy', last[1]); dot.setAttribute('r', '4');
    dot.setAttribute('fill', color);
    dot.setAttribute('stroke', css('--surface')); dot.setAttribute('stroke-width', '2');
    svg.appendChild(dot);

    // Per-point hit targets
    points.forEach((p, i) => {
      const hit = document.createElementNS(NS, 'rect');
      const w = points.length > 1 ? plotW / points.length : plotW;
      hit.setAttribute('x', xOf(i) - w / 2); hit.setAttribute('y', pad.top);
      hit.setAttribute('width', w); hit.setAttribute('height', plotH);
      hit.setAttribute('fill', 'transparent');
      hit.addEventListener('click', (e) => {
        e.stopPropagation();
        showTip(container, e, p.label + ' · ' + formatValue(p.value));
      });
      svg.appendChild(hit);
      if (points.length <= 12 || i % Math.ceil(points.length / 8) === 0) {
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', xOf(i)); t.setAttribute('y', height - 6);
        t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '9');
        t.setAttribute('fill', axis);
        t.textContent = p.tick;
        svg.appendChild(t);
      }
    });

    container.innerHTML = '';
    container.appendChild(svg);
    svg.addEventListener('click', () => hideTip(container));
  }

  return { donut, bars, groupedBars, stackedBars, line, multiLine, sparkline };
})();
