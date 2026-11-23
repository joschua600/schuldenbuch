'use strict';
/*
 * charts.js – Selbst gezeichnete Diagramme mit SVG.
 *
 * SVG ist eine Bildsprache, die der Browser direkt versteht:
 *   <line>  = Linie, <rect> = Rechteck, <path> = beliebige Form, <text> = Text
 * Weil keine fremde Bibliothek nachgeladen wird, funktioniert alles offline.
 *
 * Die Farben kommen aus style.css (Klassen wie "line pos" oder "bar-owe"),
 * dadurch passen sie sich automatisch an den Dark Mode an.
 */
const Charts = (() => {
  let uid = 0; // für eindeutige IDs innerhalb der SVGs

  /**
   * "Schöne" Achsenwerte berechnen, z. B. 0 / 50 / 100 / 150 statt 0 / 37 / 74.
   * Werte in Cent; der kleinste Abstand ist 1 €.
   */
  function niceTicks(min, max, count = 4) {
    const span = Math.max(max - min, 100);
    const rough = span / count;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / magnitude;
    const step = Math.max(100, (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * magnitude);
    const ticks = [];
    for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + 0.5; v += step) ticks.push(v);
    if (ticks.length < 2) ticks.push(ticks[0] + step);
    return ticks;
  }

  /** Datumsbeschriftung der x-Achse: bei langen Zeiträumen Monat, sonst Tag. */
  function axisDate(ms, spanMs) {
    const d = new Date(ms);
    if (spanMs > 120 * 86400000) return d.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  }

  /** Breite des Containers in Pixeln. */
  function widthOf(el) {
    return Math.max(Math.floor(el.clientWidth), 260);
  }

  /**
   * Liniendiagramm (Stufenlinie) für den Saldo-Verlauf.
   *   points:   [{ t: Zeit in ms, value: Cent, date }]
   *   onSelect: wird beim Antippen mit (Punkt, Datum) aufgerufen
   * Über der 0-Linie wird grün gezeichnet, darunter rot.
   */
  function line(el, points, onSelect) {
    const W = widthOf(el);
    const H = 200;
    const pad = { left: 58, right: 10, top: 10, bottom: 24 };
    const id = 'chart' + ++uid;

    const t0 = points[0].t;
    let t1 = points[points.length - 1].t;
    if (t1 <= t0) t1 = t0 + 86400000; // mindestens ein Tag Breite

    const values = points.map((p) => p.value);
    const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
    const vMin = ticks[0];
    const vMax = ticks[ticks.length - 1];

    // Umrechnung: Zeit/Wert → Pixel-Position
    const x = (t) => pad.left + ((t - t0) / (t1 - t0)) * (W - pad.left - pad.right);
    const y = (v) => pad.top + ((vMax - v) / (vMax - vMin)) * (H - pad.top - pad.bottom);

    // Stufenlinie: waagerecht bis zum nächsten Tag, dann senkrecht auf den neuen Wert
    let d = `M${x(points[0].t)},${y(points[0].value)}`;
    for (let i = 1; i < points.length; i++) d += `H${x(points[i].t)}V${y(points[i].value)}`;
    const zeroY = y(0);
    const area = `${d}V${zeroY}H${x(points[0].t)}Z`;

    const grid = ticks.map((v) => `
      <line class="grid${v === 0 ? ' zero' : ''}" x1="${pad.left}" x2="${W - pad.right}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis" x="${pad.left - 8}" y="${y(v) + 4}" text-anchor="end">${Money.formatShort(v)}</text>`).join('');

    const span = t1 - t0;
    const xLabels = [[t0, 'start'], [t0 + span / 2, 'middle'], [t1, 'end']]
      .map(([t, anchor]) => `<text class="axis" x="${x(t)}" y="${H - 6}" text-anchor="${anchor}">${axisDate(t, span)}</text>`)
      .join('');

    el.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Saldo-Verlauf">
        <defs>
          <clipPath id="${id}-up"><rect x="0" y="0" width="${W}" height="${zeroY}"/></clipPath>
          <clipPath id="${id}-down"><rect x="0" y="${zeroY}" width="${W}" height="${H - zeroY}"/></clipPath>
        </defs>
        ${grid}${xLabels}
        <g clip-path="url(#${id}-up)"><path class="area pos" d="${area}"/><path class="line pos" d="${d}"/></g>
        <g clip-path="url(#${id}-down)"><path class="area neg" d="${area}"/><path class="line neg" d="${d}"/></g>
        <line class="cursor" x1="0" x2="0" y1="${pad.top}" y2="${H - pad.bottom}" visibility="hidden"/>
        <circle class="dot" r="5" visibility="hidden"/>
      </svg>`;

    // Antippen / Wischen: Wert an dieser Stelle anzeigen
    const svgEl = el.querySelector('svg');
    const cursor = svgEl.querySelector('.cursor');
    const dot = svgEl.querySelector('.dot');
    function select(clientX) {
      const box = svgEl.getBoundingClientRect();
      const px = Math.min(Math.max((clientX - box.left) * (W / box.width), pad.left), W - pad.right);
      const t = t0 + ((px - pad.left) / (W - pad.left - pad.right)) * (t1 - t0);
      let point = points[0];
      for (const p of points) if (p.t <= t) point = p; // letzter Punkt vor dieser Stelle
      cursor.setAttribute('x1', px);
      cursor.setAttribute('x2', px);
      cursor.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', px);
      dot.setAttribute('cy', y(point.value));
      dot.setAttribute('visibility', 'visible');
      onSelect(point, DateUtil.fromDate(new Date(t)));
    }
    svgEl.addEventListener('pointerdown', (e) => select(e.clientX));
    svgEl.addEventListener('pointermove', (e) => select(e.clientX));
  }

  /**
   * Gruppiertes Balkendiagramm: neue Schulden pro Monat.
   *   months:   [{ date, owed, owe }]   (Beträge in Cent)
   *   onSelect: wird beim Antippen eines Monats aufgerufen
   */
  function months(el, data, onSelect) {
    const W = widthOf(el);
    const H = 180;
    const pad = { left: 50, right: 4, top: 8, bottom: 22 };

    const max = Math.max(0, ...data.map((m) => Math.max(m.owed, m.owe)));
    const ticks = niceTicks(0, max, 3);
    const vMax = ticks[ticks.length - 1];
    const y = (v) => pad.top + (1 - v / vMax) * (H - pad.top - pad.bottom);

    const groupW = (W - pad.left - pad.right) / data.length;
    const barW = Math.max(3, Math.min(12, (groupW - 8) / 2));
    const shortLabels = groupW < 30; // bei wenig Platz nur Anfangsbuchstaben: J F M A …

    let bars = '';
    data.forEach((m, i) => {
      const cx = pad.left + groupW * i + groupW / 2;
      const hOwed = y(0) - y(m.owed);
      const hOwe = y(0) - y(m.owe);
      bars += `<rect class="hit${i === data.length - 1 ? ' active' : ''}" data-i="${i}" x="${cx - groupW / 2 + 1}" y="${pad.top}" width="${groupW - 2}" height="${H - pad.top - pad.bottom}" rx="6"/>`;
      if (m.owed) bars += `<rect class="bar-owed" x="${cx - barW - 1}" y="${y(m.owed)}" width="${barW}" height="${Math.max(hOwed, 1)}" rx="2"/>`;
      if (m.owe) bars += `<rect class="bar-owe" x="${cx + 1}" y="${y(m.owe)}" width="${barW}" height="${Math.max(hOwe, 1)}" rx="2"/>`;
      const label = m.date.toLocaleDateString('de-DE', { month: shortLabels ? 'narrow' : 'short' }).replace('.', '');
      bars += `<text class="axis" x="${cx}" y="${H - 6}" text-anchor="middle">${label}</text>`;
    });

    const grid = ticks.map((v) => `
      <line class="grid${v === 0 ? ' zero' : ''}" x1="${pad.left}" x2="${W - pad.right}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis" x="${pad.left - 8}" y="${y(v) + 4}" text-anchor="end">${Money.formatShort(v)}</text>`).join('');

    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Neue Schulden pro Monat">${grid}${bars}</svg>`;

    el.querySelector('svg').addEventListener('click', (e) => {
      const hit = e.target.closest('.hit');
      if (!hit) return;
      el.querySelectorAll('.hit').forEach((h) => h.classList.toggle('active', h === hit));
      onSelect(data[Number(hit.dataset.i)]);
    });
  }

  return { line, months };
})();
