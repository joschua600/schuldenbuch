'use strict';
/*
 * app.js – Die eigentliche App: Ansichten, Formulare und Aktionen.
 *
 * Aufbau dieser Datei:
 *   1. Zustand       – alle Daten liegen zusätzlich im Arbeitsspeicher
 *   2. Berechnungen  – Restbeträge, Salden, Summen, Verlauf
 *   3. Helfer        – Icons, Toast-Meldung, Dialog, Sheets
 *   4. Ansichten     – Übersicht, Person, Verlauf, Statistik
 *   5. Formulare     – Schuld, Person, Rückzahlung, Details
 *   6. Löschen
 *   7. Aktionen, Navigation & Start
 *
 * Prinzip: Bei jeder Änderung schreiben wir in die Datenbank, laden die
 * Daten neu und zeichnen die aktuelle Ansicht komplett neu. Das ist einfach
 * zu verstehen und bei ein paar hundert Einträgen trotzdem blitzschnell.
 */

/* =====================================================================
   1. Zustand
   ===================================================================== */
const state = { persons: [], debts: [], payments: [] };

// Einstellungen der Oberfläche (welcher Filter ist gerade gewählt usw.)
const ui = { personFilter: 'all', historyFilter: 'all', statsRange: 'all' };

async function loadData() {
  const [persons, debts, payments] = await Promise.all([
    DB.getAll('persons'),
    DB.getAll('debts'),
    DB.getAll('payments'),
  ]);
  state.persons = persons;
  state.debts = debts;
  state.payments = payments;
}

/** Änderungen speichern, Daten neu laden, Ansicht neu zeichnen. */
async function save(operations) {
  await DB.write(operations);
  await loadData();
  render();
}

/* =====================================================================
   2. Berechnungen
   ===================================================================== */

/** +1, wenn mir die Person etwas schuldet; −1, wenn ich ihr etwas schulde. */
function sign(direction) {
  return direction === 'owed' ? 1 : -1;
}

const personById = (id) => state.persons.find((p) => p.id === id);
const debtById = (id) => state.debts.find((d) => d.id === id);
const debtsOf = (personId) => state.debts.filter((d) => d.personId === personId);
const paymentsOf = (debtId) => state.payments.filter((p) => p.debtId === debtId);

/** Wie viel von einer Schuld schon zurückgezahlt wurde (in Cent). */
function paidAmount(debt) {
  return paymentsOf(debt.id).reduce((sum, p) => sum + p.amount, 0);
}

/** Restbetrag einer Schuld (nie kleiner als 0). */
function remaining(debt) {
  return Math.max(debt.amount - paidAmount(debt), 0);
}

function isDone(debt) {
  return remaining(debt) === 0;
}

/**
 * Saldo einer Person:
 *   positiv → die Person schuldet mir etwas
 *   negativ → ich schulde der Person etwas
 */
function balanceOf(personId) {
  return debtsOf(personId).reduce((sum, d) => sum + sign(d.direction) * remaining(d), 0);
}

/** Gesamtsummen für die Übersicht (pro Person verrechnet). */
function totals() {
  let owedToMe = 0;
  let iOwe = 0;
  for (const person of state.persons) {
    const balance = balanceOf(person.id);
    if (balance > 0) owedToMe += balance;
    else iOwe -= balance;
  }
  return { owedToMe, iOwe, net: owedToMe - iOwe };
}

/** Alphabetisch (für Auswahllisten). */
function sortedPersons() {
  return [...state.persons].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/**
 * Nach Saldo (für die Übersicht): oben, wer dir am meisten schuldet,
 * unten, wem du am meisten schuldest. Bei gleichem Saldo alphabetisch.
 */
function personsByBalance() {
  return sortedPersons().sort((a, b) => balanceOf(b.id) - balanceOf(a.id));
}

/** Satz wie "Max schuldet dir" oder "Du schuldest Lisa". */
function balanceSentence(name, balance) {
  if (balance > 0) return `${name} schuldet dir`;
  if (balance < 0) return `Du schuldest ${name}`;
  return 'Alles ausgeglichen';
}

/**
 * Alle Ereignisse (Schulden + Rückzahlungen) als eine Liste,
 * neueste zuerst. Mit personId nur die einer Person.
 */
function buildEvents(personId) {
  const events = [];
  for (const debt of state.debts) {
    if (personId && debt.personId !== personId) continue;
    events.push({ type: 'debt', date: debt.date, createdAt: debt.createdAt, debt });
  }
  for (const payment of state.payments) {
    const debt = debtById(payment.debtId);
    if (!debt || (personId && debt.personId !== personId)) continue;
    events.push({ type: 'payment', date: payment.date, createdAt: payment.createdAt, debt, payment });
  }
  return events.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

/** Filter "offen / erledigt / alle". Rückzahlungen folgen ihrer Schuld. */
function applyFilter(events, filter) {
  if (filter === 'open') return events.filter((e) => !isDone(e.debt));
  if (filter === 'done') return events.filter((e) => isDone(e.debt));
  return events;
}

/**
 * Verteilt eine Rückzahlung an eine Person auf deren offene Schulden –
 * die älteste zuerst. Ergebnis: [{ debt, amount }, ...]
 */
function distributePayment(personId, direction, amount) {
  const openDebts = debtsOf(personId)
    .filter((d) => d.direction === direction && !isDone(d))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);

  const parts = [];
  let rest = amount;
  for (const debt of openDebts) {
    if (rest <= 0) break;
    const part = Math.min(rest, remaining(debt));
    parts.push({ debt, amount: part });
    rest -= part;
  }
  return parts;
}

/** Summe der offenen Beträge einer Person in einer Richtung. */
function openSum(personId, direction) {
  return debtsOf(personId)
    .filter((d) => d.direction === direction)
    .reduce((sum, d) => sum + remaining(d), 0);
}

/**
 * Datenpunkte für das Liniendiagramm "Saldo-Verlauf":
 * Für jeden Tag mit einer Änderung der Saldo danach.
 */
function balanceSeries(range) {
  // 1. Alle Änderungen sammeln, nach Tag zusammengefasst
  const changesByDay = new Map();
  const addChange = (date, delta) => changesByDay.set(date, (changesByDay.get(date) || 0) + delta);
  for (const debt of state.debts) addChange(debt.date, sign(debt.direction) * debt.amount);
  for (const payment of state.payments) {
    const debt = debtById(payment.debtId);
    if (debt) addChange(payment.date, -sign(debt.direction) * payment.amount);
  }
  const days = [...changesByDay.keys()].sort();
  if (days.length === 0) return [];

  // 2. Startdatum je nach gewähltem Zeitraum
  const today = DateUtil.today();
  const months = { '1m': 1, '3m': 3, '1y': 12 }[range];
  const start = months ? DateUtil.addMonths(today, -months) : days[0];

  // 3. Aufsummieren
  let value = 0;
  const points = [];
  for (const day of days) {
    if (day < start) {
      value += changesByDay.get(day); // liegt vor dem Zeitraum: nur mitzählen
      continue;
    }
    if (points.length === 0) points.push({ date: start, value });
    value += changesByDay.get(day);
    points.push({ date: day, value });
  }
  if (points.length === 0) points.push({ date: start, value });
  if (points[points.length - 1].date < today) points.push({ date: today, value });

  return points.map((p) => ({ ...p, t: DateUtil.toDate(p.date).getTime() }));
}

/** Neue Schulden pro Monat für die letzten 12 Monate. */
function monthlyNewDebts() {
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const first = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: DateUtil.fromDate(first).slice(0, 7), date: first, owed: 0, owe: 0 });
  }
  for (const debt of state.debts) {
    const month = months.find((m) => m.key === debt.date.slice(0, 7));
    if (month) month[debt.direction] += debt.amount;
  }
  return months;
}

/* =====================================================================
   3. Helfer
   ===================================================================== */

/** Text für HTML unschädlich machen (z. B. wenn ein Name "<" enthält). */
function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Eindeutige ID für neue Einträge. */
function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** Runder Kreis mit Anfangsbuchstabe und einer zum Namen passenden Farbe. */
function avatar(name, extraClass = '') {
  const colors = ['#ff9500', '#af52de', '#5856d6', '#007aff', '#32ade6', '#00c7be', '#a2845e', '#8e8e93'];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  const letter = Array.from(name.trim())[0] || '?';
  return `<span class="avatar ${extraClass}" style="background:${colors[hash % colors.length]}" aria-hidden="true">${esc(letter.toUpperCase())}</span>`;
}

/** Kleine Symbole als SVG (keine Bilddateien nötig). */
const svg = (paths, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${paths}</svg>`;
const ICON = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  back: '<svg viewBox="0 0 12 20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2 2 10l8 8"/></svg>',
  repay: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  edit: svg('<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>', 'stroke-width="2.5"'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>', 'stroke-width="2.5"'),
};

/** Kurze Meldung oben am Bildschirm. */
function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 1800);
}

/**
 * Bestätigungs-Dialog im iOS-Stil.
 * Gibt ein Promise zurück: true = bestätigt, false = abgebrochen.
 */
function confirmDialog({ title, message, confirmLabel = 'Löschen' }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'alert-wrap';
    wrap.innerHTML = `
      <div class="alert" role="alertdialog" aria-modal="true">
        <div class="alert-text"><h3>${esc(title)}</h3><p>${esc(message)}</p></div>
        <div class="alert-buttons">
          <button type="button" data-answer="no">Abbrechen</button>
          <button type="button" data-answer="yes" class="destructive">${esc(confirmLabel)}</button>
        </div>
      </div>`;
    wrap.addEventListener('click', (event) => {
      const button = event.target.closest('[data-answer]');
      if (!button) return;
      wrap.remove();
      resolve(button.dataset.answer === 'yes');
    });
    document.body.appendChild(wrap);
  });
}

/*
 * Sheets: Fenster, die von unten hochfahren (wie bei iOS).
 * Es ist immer höchstens ein Sheet offen.
 *   title     – Überschrift
 *   body      – HTML-Inhalt
 *   onSubmit  – Funktion, die beim Tippen auf "Sichern" läuft.
 *               Ohne onSubmit gibt es nur einen "Fertig"-Button.
 */
const sheetRoot = document.getElementById('sheet-root');
let sheetToken = 0;

function openSheet({ title, body, onSubmit, submitLabel = 'Sichern' }) {
  sheetToken++;
  const left = onSubmit ? '<button type="button" class="sheet-btn" data-close>Abbrechen</button>' : '<span></span>';
  const right = onSubmit
    ? `<button type="submit" class="sheet-btn strong">${esc(submitLabel)}</button>`
    : '<button type="button" class="sheet-btn strong" data-close>Fertig</button>';

  sheetRoot.innerHTML = `
    <div class="backdrop" data-close></div>
    <form class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}" novalidate autocomplete="off">
      <header class="sheet-head">${left}<h2>${esc(title)}</h2>${right}</header>
      <div class="sheet-body">${body}</div>
    </form>`;

  const form = sheetRoot.querySelector('form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!onSubmit) return;
    const button = form.querySelector('[type=submit]');
    const errorBox = form.querySelector('.form-error');
    button.disabled = true;
    try {
      await onSubmit(form);
    } catch (error) {
      // Fehlermeldung im Formular anzeigen
      if (errorBox) errorBox.textContent = error.message;
      else alert(error.message);
    } finally {
      button.disabled = false;
    }
  });

  // Segment-Schalter innerhalb eines Formulars (z. B. "Ich schulde / Mir wird geschuldet")
  form.querySelectorAll('.segmented[data-name]').forEach((group) => {
    group.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-value]');
      if (!button) return;
      group.dataset.value = button.dataset.value;
      group.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === button));
      group.dispatchEvent(new Event('change'));
    });
  });

  sheetRoot.classList.remove('open');
  void sheetRoot.offsetHeight; // Browser zwingen, den Startzustand zu zeichnen (für die Animation)
  sheetRoot.classList.add('open');
  document.body.classList.add('sheet-open');
  return form;
}

function closeSheet() {
  const token = ++sheetToken;
  // Tastatur schließen (Eingabefeld verlassen), bevor das Sheet verschwindet
  if (document.activeElement && sheetRoot.contains(document.activeElement)) document.activeElement.blur();
  sheetRoot.classList.remove('open');
  document.body.classList.remove('sheet-open');
  // Nach der Animation den Inhalt entfernen (falls nicht schon ein neues Sheet offen ist)
  setTimeout(() => { if (token === sheetToken) sheetRoot.innerHTML = ''; }, 320);
}

sheetRoot.addEventListener('click', (event) => {
  if (event.target.closest('[data-close]')) closeSheet();
});

/** Validierungsfehler: bricht das Speichern ab und zeigt den Text an. */
function fail(message) {
  throw new Error(message);
}

/** Segment-Schalter als HTML. options = [[wert, beschriftung], ...] */
function segmented(options, value, attrs = '', extraClass = '') {
  return `<div class="segmented ${extraClass}" ${attrs} data-value="${esc(value)}">${options.map(([v, label]) =>
    `<button type="button" class="${v === value ? 'active' : ''}" data-value="${esc(v)}">${esc(label)}</button>`
  ).join('')}</div>`;
}

/** Filter-Schalter "Offen / Erledigt / Alle" für Listen. */
function filterControl(scope, value) {
  const options = [['open', 'Offen'], ['done', 'Erledigt'], ['all', 'Alle']];
  return `<div class="segmented" role="tablist">${options.map(([v, label]) =>
    `<button type="button" class="${v === value ? 'active' : ''}" data-action="set-filter" data-scope="${scope}" data-value="${v}">${label}</button>`
  ).join('')}</div>`;
}

function emptyState(emoji, title, text, buttonHtml = '') {
  return `<div class="card empty"><div class="emoji">${emoji}</div><h2>${esc(title)}</h2><p>${esc(text)}</p>${buttonHtml}</div>`;
}

/* =====================================================================
   4. Ansichten
   ===================================================================== */

/* ---------- Übersicht (Startseite) ---------- */
function viewHome() {
  const t = totals();
  let netClass = '';
  let netText = 'Alles ausgeglichen';
  if (t.net > 0) { netClass = 'pos'; netText = 'Unterm Strich wird dir mehr geschuldet'; }
  if (t.net < 0) { netClass = 'neg'; netText = 'Unterm Strich schuldest du mehr'; }

  const persons = personsByBalance();
  const list = persons.length
    ? `<ul class="list card persons">${persons.map(personRow).join('')}</ul>`
    : emptyState('📒', 'Noch keine Einträge',
        'Tippe auf das blaue ＋, um deine erste Schuld einzutragen.',
        '<button type="button" class="btn primary" data-action="new-debt">Erste Schuld eintragen</button>');

  return `
    <header class="large-title"><h1>Schuldenbuch</h1></header>
    <section class="card summary" aria-label="Gesamtsumme">
      <div class="summary-net">
        <span class="label">Netto</span>
        <span class="big ${netClass}">${Money.formatSigned(t.net)}</span>
        <span class="label">${netText}</span>
      </div>
      <div class="summary-row">
        <div><span class="label">Mir wird geschuldet</span><span class="amount pos">${Money.format(t.owedToMe)}</span></div>
        <div><span class="label">Ich schulde</span><span class="amount neg">${Money.format(t.iOwe)}</span></div>
      </div>
    </section>
    <div class="section-head">
      <h2>Personen</h2>
      <button type="button" class="link-btn" data-action="new-person">Hinzufügen</button>
    </div>
    ${list}`;
}

function personRow(person) {
  const balance = balanceOf(person.id);
  const hasDebts = debtsOf(person.id).length > 0;
  const amountClass = balance > 0 ? 'pos' : 'neg';
  const sub = hasDebts ? balanceSentence(person.name, balance) : 'Noch keine Einträge';
  return `
    <li><a class="row" href="#/person/${person.id}">
      ${avatar(person.name)}
      <span class="row-main">
        <span class="row-title">${esc(person.name)}</span>
        <span class="row-sub">${esc(sub)}</span>
      </span>
      ${balance !== 0 ? `<span class="row-amount ${amountClass}">${Money.format(Math.abs(balance))}</span>` : ''}
      <span class="chevron" aria-hidden="true">›</span>
    </a></li>`;
}

/* ---------- Seite einer Person ---------- */
function viewPerson(person) {
  const balance = balanceOf(person.id);
  const amountClass = balance > 0 ? 'pos' : balance < 0 ? 'neg' : '';
  const hasDebts = debtsOf(person.id).length > 0;
  const events = applyFilter(buildEvents(person.id), ui.personFilter);

  let content;
  if (!hasDebts) {
    content = emptyState('✍️', 'Noch keine Einträge', `Trag die erste Schuld mit ${person.name} ein.`,
      `<button type="button" class="btn primary" data-action="new-debt" data-person="${person.id}">Schuld eintragen</button>`);
  } else {
    content = filterControl('person', ui.personFilter) +
      (events.length ? renderEvents(events, false) : '<p class="empty-small">Keine Einträge für diesen Filter.</p>');
  }

  return `
    <nav class="navbar"><a class="back" href="#/">${ICON.back}Übersicht</a></nav>
    <header class="person-head">
      ${avatar(person.name, 'big')}
      <h1>${esc(person.name)}</h1>
      <span class="big ${amountClass}">${Money.format(Math.abs(balance))}</span>
      <p class="muted">${esc(balanceSentence(person.name, balance))}</p>
    </header>
    <div class="action-row">
      <button type="button" class="action-tile" data-action="new-debt" data-person="${person.id}">${ICON.plus}Schuld</button>
      <button type="button" class="action-tile" data-action="person-payment" data-id="${person.id}">${ICON.repay}Rückzahlung</button>
      <button type="button" class="action-tile" data-action="rename-person" data-id="${person.id}">${ICON.edit}Umbenennen</button>
      <button type="button" class="action-tile destructive" data-action="delete-person" data-id="${person.id}">${ICON.trash}Löschen</button>
    </div>
    ${content}`;
}

/* ---------- Gesamtverlauf ---------- */
function viewHistory() {
  const events = applyFilter(buildEvents(null), ui.historyFilter);
  let content;
  if (state.debts.length === 0) {
    content = emptyState('🕘', 'Noch kein Verlauf', 'Hier erscheinen alle Schulden und Rückzahlungen, sobald du etwas einträgst.');
  } else {
    content = filterControl('history', ui.historyFilter) +
      (events.length ? renderEvents(events, true) : '<p class="empty-small">Keine Einträge für diesen Filter.</p>');
  }
  return `<header class="large-title"><h1>Verlauf</h1></header>${content}`;
}

/** Liste von Ereignissen, gruppiert nach Monat. */
function renderEvents(events, showPerson) {
  let html = '';
  let currentMonth = null;
  for (const event of events) {
    const month = event.date.slice(0, 7);
    if (month !== currentMonth) {
      if (currentMonth !== null) html += '</ul>';
      html += `<h3 class="month-title">${DateUtil.monthTitle(event.date)}</h3><ul class="list card">`;
      currentMonth = month;
    }
    html += event.type === 'debt' ? debtRow(event.debt, showPerson) : paymentRow(event.payment, event.debt, showPerson);
  }
  return html + '</ul>';
}

function debtRow(debt, showPerson) {
  const person = personById(debt.personId);
  const name = person ? person.name : '?';
  const owed = debt.direction === 'owed';
  let who;
  if (showPerson) who = owed ? `${name} schuldet dir` : `Du schuldest ${name}`;
  else who = owed ? 'Schuldet dir' : 'Du schuldest';
  const rest = remaining(debt);
  const badge = rest === 0
    ? '<span class="badge done">✓ erledigt</span>'
    : rest < debt.amount
      ? `<span class="badge">offen ${Money.format(rest)}</span>`
      : '<span class="badge">offen</span>';

  return `
    <li><button type="button" class="row" data-action="open-debt" data-id="${debt.id}">
      <span class="ev-icon ${debt.direction}">${owed ? ICON.down : ICON.up}</span>
      <span class="row-main">
        <span class="row-title">${esc(debt.reason)}</span>
        <span class="row-sub">${esc(who)} · ${DateUtil.format(debt.date)}</span>
      </span>
      <span class="row-end">
        <span class="row-amount ${owed ? 'pos' : 'neg'}">${Money.format(debt.amount)}</span>
        ${badge}
      </span>
    </button></li>`;
}

function paymentRow(payment, debt, showPerson) {
  const person = personById(debt.personId);
  const name = person ? person.name : '?';
  const owed = debt.direction === 'owed';
  let who;
  if (showPerson) who = owed ? `${name} hat dir zurückgezahlt` : `Du hast ${name} zurückgezahlt`;
  else who = owed ? 'Hat dir zurückgezahlt' : 'Du hast zurückgezahlt';

  return `
    <li><button type="button" class="row" data-action="open-debt" data-id="${debt.id}">
      <span class="ev-icon payment">${ICON.repay}</span>
      <span class="row-main">
        <span class="row-title">Rückzahlung: ${esc(debt.reason)}</span>
        <span class="row-sub">${esc(who)} · ${DateUtil.format(payment.date)}</span>
      </span>
      <span class="row-end"><span class="row-amount muted">−${Money.format(payment.amount)}</span></span>
    </button></li>`;
}

/* ---------- Statistik ---------- */
function viewStats() {
  const header = '<header class="large-title"><h1>Statistik</h1></header>';
  if (state.debts.length === 0) {
    return header + emptyState('📊', 'Noch keine Daten', 'Sobald du Schulden einträgst, siehst du hier Diagramme.');
  }
  const ranges = [['1m', '1 M'], ['3m', '3 M'], ['1y', '1 J'], ['all', 'Alles']];
  return `
    ${header}
    <section class="card chart-card">
      <h2>Saldo-Verlauf</h2>
      <p class="chart-sub">Über 0: Dir wird mehr geschuldet. Unter 0: Du schuldest mehr. Tippe ins Diagramm für Details.</p>
      <div class="segmented" role="tablist">${ranges.map(([v, label]) =>
        `<button type="button" class="${v === ui.statsRange ? 'active' : ''}" data-action="set-range" data-value="${v}">${label}</button>`
      ).join('')}</div>
      <div class="chart-readout" id="line-readout"></div>
      <div class="chart" id="chart-line"></div>
    </section>

    <section class="card chart-card">
      <h2>Wer schuldet dir am meisten?</h2>
      <p class="chart-sub">Aktuell offene Beträge, pro Person verrechnet</p>
      ${rankingHtml(1)}
    </section>

    <section class="card chart-card">
      <h2>Wem schuldest du am meisten?</h2>
      <p class="chart-sub">Aktuell offene Beträge, pro Person verrechnet</p>
      ${rankingHtml(-1)}
    </section>

    <section class="card chart-card">
      <h2>Neue Schulden pro Monat</h2>
      <p class="chart-sub">Letzte 12 Monate · Tippe auf einen Monat für Details</p>
      <div class="legend">
        <span><i style="background:var(--green)"></i>Dir geschuldet</span>
        <span><i style="background:var(--red)"></i>Von dir geschuldet</span>
      </div>
      <div class="chart-readout" id="month-readout"></div>
      <div class="chart" id="chart-months"></div>
    </section>`;
}

/** Balkendiagramm (aus einfachen HTML-Balken) für die Top 5. */
function rankingHtml(direction) {
  const list = state.persons
    .map((p) => ({ person: p, value: balanceOf(p.id) * direction }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  if (list.length === 0) {
    return `<p class="muted">${direction > 0 ? 'Niemand schuldet dir gerade etwas.' : 'Du schuldest gerade niemandem etwas. 🎉'}</p>`;
  }
  const max = list[0].value;
  const cls = direction > 0 ? 'pos' : 'neg';
  return list.map(({ person, value }) => `
    <div class="rank-row">
      <span class="rank-name">${esc(person.name)}</span>
      <span class="rank-bar"><span class="${cls}" style="width:${Math.max(3, (value / max) * 100)}%"></span></span>
      <span class="rank-val ${cls}">${Money.format(value)}</span>
    </div>`).join('');
}

/** Die SVG-Diagramme brauchen die echte Breite – deshalb erst nach dem Einfügen zeichnen. */
function drawCharts() {
  const lineEl = document.getElementById('chart-line');
  if (!lineEl) return;

  const points = balanceSeries(ui.statsRange);
  const lineReadout = document.getElementById('line-readout');
  const showLineValue = (point, date) => {
    lineReadout.innerHTML = `${DateUtil.format(date)}: <span class="${point.value > 0 ? 'pos' : point.value < 0 ? 'neg' : ''}">${Money.formatSigned(point.value)}</span>`;
  };
  const last = points[points.length - 1];
  showLineValue(last, last.date);
  Charts.line(lineEl, points, showLineValue);

  const months = monthlyNewDebts();
  const monthReadout = document.getElementById('month-readout');
  const showMonth = (m) => {
    const title = m.date.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    monthReadout.innerHTML = `${title}: <span class="pos">${Money.format(m.owed)}</span> · <span class="neg">${Money.format(m.owe)}</span>`;
  };
  showMonth(months[months.length - 1]);
  Charts.months(document.getElementById('chart-months'), months, showMonth);
}

/* =====================================================================
   5. Formulare
   ===================================================================== */

/* ---------- Schuld anlegen / bearbeiten ---------- */
function openDebtForm({ debt = null, personId = null } = {}) {
  const editing = Boolean(debt);
  const persons = sortedPersons();

  // Vorauswahl: bearbeitete Schuld → deren Person; sonst übergebene oder zuletzt benutzte Person
  let selected = debt ? debt.personId : personId || localStorage.getItem('lastPerson');
  if (!personById(selected)) selected = persons.length ? persons[0].id : '__new';
  const direction = debt ? debt.direction : localStorage.getItem('lastDirection') || 'owed';

  const personOptions = persons
    .map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`)
    .join('') + `<option value="__new" ${selected === '__new' ? 'selected' : ''}>＋ Neue Person …</option>`;

  const body = `
    <div class="card amount-card">
      <input class="amount-input" name="amount" inputmode="decimal" placeholder="0,00" aria-label="Betrag in Euro"
             value="${debt ? Money.toInput(debt.amount) : ''}">
      <span class="currency">€</span>
    </div>
    ${segmented([['owe', 'Ich schulde'], ['owed', 'Mir wird geschuldet']], direction, 'data-name="direction"', 'large')}
    <div class="card form">
      <label class="field"><span>Person</span><select name="person">${personOptions}</select></label>
      <label class="field" data-new-person ${selected === '__new' ? '' : 'hidden'}>
        <span>Name</span><input name="newName" placeholder="z. B. Max" maxlength="60" autocapitalize="words">
      </label>
      <label class="field"><span>Grund</span>
        <input name="reason" placeholder="z. B. Pizza, Kino, Tanken" maxlength="200" value="${debt ? esc(debt.reason) : ''}">
      </label>
      <label class="field"><span>Datum</span>
        <input type="date" name="date" value="${debt ? debt.date : DateUtil.today()}" required>
      </label>
    </div>
    <p class="form-error" role="alert"></p>`;

  const form = openSheet({
    title: editing ? 'Schuld bearbeiten' : 'Neue Schuld',
    body,
    onSubmit: async (f) => {
      const amount = Money.parse(f.amount.value);
      if (!amount) fail('Bitte gib einen gültigen Betrag ein, z. B. 12,50.');
      const reason = f.reason.value.trim();
      if (!reason) fail('Bitte gib einen Grund an.');
      const date = f.date.value;
      if (!DateUtil.isValid(date)) fail('Bitte wähle ein Datum.');
      const dir = f.querySelector('[data-name=direction]').dataset.value;

      const operations = [];
      let targetPersonId = f.person.value;
      if (targetPersonId === '__new') {
        const newPerson = makePerson(f.newName.value);
        operations.push({ store: 'persons', put: newPerson });
        targetPersonId = newPerson.id;
      }

      if (editing) {
        const paid = paidAmount(debt);
        if (amount < paid) fail(`Es wurden schon ${Money.format(paid)} zurückgezahlt – der Betrag darf nicht kleiner sein.`);
        operations.push({ store: 'debts', put: { ...debt, personId: targetPersonId, direction: dir, amount, reason, date } });
      } else {
        operations.push({ store: 'debts', put: {
          id: newId(), personId: targetPersonId, direction: dir, amount, reason, date, createdAt: Date.now(),
        } });
      }

      await save(operations);
      localStorage.setItem('lastPerson', targetPersonId);
      localStorage.setItem('lastDirection', dir);
      closeSheet();
      toast(editing ? 'Änderung gespeichert' : 'Schuld eingetragen');
    },
  });

  // "Neue Person …" gewählt → Namensfeld einblenden
  const newPersonRow = form.querySelector('[data-new-person]');
  form.person.addEventListener('change', () => {
    newPersonRow.hidden = form.person.value !== '__new';
    if (!newPersonRow.hidden) form.newName.focus({ preventScroll: true });
  });
}

/** Prüft einen Namen und erstellt ein neues Personen-Objekt. */
function makePerson(rawName) {
  const name = rawName.trim();
  if (!name) fail('Bitte gib einen Namen ein.');
  checkDuplicateName(name, null);
  return { id: newId(), name, createdAt: Date.now() };
}

function checkDuplicateName(name, ownId) {
  const taken = state.persons.some((p) => p.id !== ownId && p.name.toLowerCase() === name.toLowerCase());
  if (taken) fail(`Es gibt schon eine Person namens „${name}“.`);
}

/* ---------- Person anlegen / umbenennen ---------- */
function openPersonForm(person = null) {
  const form = openSheet({
    title: person ? 'Umbenennen' : 'Neue Person',
    body: `
      <div class="card form">
        <label class="field"><span>Name</span>
          <input name="personName" placeholder="z. B. Max" maxlength="60" autocapitalize="words" value="${person ? esc(person.name) : ''}">
        </label>
      </div>
      <p class="form-error" role="alert"></p>`,
    onSubmit: async (f) => {
      if (person) {
        const name = f.personName.value.trim();
        if (!name) fail('Bitte gib einen Namen ein.');
        checkDuplicateName(name, person.id);
        await save([{ store: 'persons', put: { ...person, name } }]);
        closeSheet();
        toast('Umbenannt');
      } else {
        const newPerson = makePerson(f.personName.value);
        await DB.write([{ store: 'persons', put: newPerson }]);
        await loadData();
        closeSheet();
        location.hash = `#/person/${newPerson.id}`;
        render();
        toast('Person angelegt');
      }
    },
  });
  // preventScroll: Das Sheet fährt gerade noch von unten herein. Ohne diese Option würde
  // Safari die ganze Seite nach unten scrollen, um das (noch verdeckte) Feld zu zeigen.
  form.personName.focus({ preventScroll: true });
}

/* ---------- Rückzahlung erfassen ---------- */
/*
 * Zwei Varianten:
 *   { debtId }   – für eine bestimmte Schuld
 *   { personId } – für eine Person; wird auf die ältesten offenen Schulden verteilt
 */
function openPaymentForm({ debtId = null, personId = null }) {
  const debt = debtId ? debtById(debtId) : null;
  const person = personById(debt ? debt.personId : personId);
  if (!person) return;

  // Welche Richtungen haben überhaupt offene Beträge?
  let direction;
  let directions = [];
  if (debt) {
    direction = debt.direction;
  } else {
    if (openSum(person.id, 'owed') > 0) directions.push('owed');
    if (openSum(person.id, 'owe') > 0) directions.push('owe');
    if (directions.length === 0) {
      toast(`Keine offenen Schulden mit ${person.name}`);
      return;
    }
    direction = directions[0];
  }
  const openAmount = () => (debt ? remaining(debt) : openSum(person.id, direction));

  const directionSwitch = directions.length === 2
    ? segmented([['owed', `Von ${person.name} erhalten`], ['owe', `An ${person.name} gezahlt`]], direction, 'data-name="direction"')
    : '';
  const intro = debt
    ? `<p class="hint" style="margin-top:0">Für „${esc(debt.reason)}“ – ${debt.direction === 'owed' ? `${esc(person.name)} zahlt dir zurück` : `du zahlst ${esc(person.name)} zurück`}.</p>`
    : directions.length === 1
      ? `<p class="hint" style="margin-top:0">${direction === 'owed' ? `${esc(person.name)} zahlt dir zurück.` : `Du zahlst ${esc(person.name)} zurück.`}</p>`
      : '';

  const body = `
    ${intro}
    ${directionSwitch}
    <div class="card amount-card">
      <input class="amount-input" name="amount" inputmode="decimal" placeholder="0,00" aria-label="Betrag in Euro">
      <span class="currency">€</span>
    </div>
    <div class="quick-row">
      <span>Offen: <strong data-open>${Money.format(openAmount())}</strong></span>
      <button type="button" class="chip" data-fill-all>Alles</button>
    </div>
    <div class="card form">
      <label class="field"><span>Datum</span><input type="date" name="date" value="${DateUtil.today()}" required></label>
    </div>
    <p class="form-error" role="alert"></p>
    ${debt ? '' : '<p class="hint" style="margin-top:0">Der Betrag wird automatisch auf die ältesten offenen Schulden verteilt.</p>'}`;

  const form = openSheet({
    title: 'Rückzahlung',
    body,
    onSubmit: async (f) => {
      const amount = Money.parse(f.amount.value);
      if (!amount) fail('Bitte gib einen gültigen Betrag ein, z. B. 5,00.');
      const date = f.date.value;
      if (!DateUtil.isValid(date)) fail('Bitte wähle ein Datum.');
      const open = openAmount();
      if (amount > open) fail(`Der Betrag ist größer als der offene Betrag von ${Money.format(open)}.`);

      const parts = debt ? [{ debt, amount }] : distributePayment(person.id, direction, amount);
      const now = Date.now();
      const operations = parts.map((part, i) => ({
        store: 'payments',
        put: { id: newId(), debtId: part.debt.id, amount: part.amount, date, createdAt: now + i },
      }));
      await save(operations);
      const doneCount = parts.filter((p) => isDone(debtById(p.debt.id))).length;
      if (debt) openDebtDetail(debt.id); else closeSheet();
      toast(doneCount > 0 ? `Gespeichert · ${doneCount === 1 ? '1 Schuld' : doneCount + ' Schulden'} erledigt ✓` : 'Rückzahlung gespeichert');
    },
  });

  const updateOpen = () => { form.querySelector('[data-open]').textContent = Money.format(openAmount()); };
  form.querySelector('[data-fill-all]').addEventListener('click', () => {
    form.amount.value = Money.toInput(openAmount());
  });
  const switcher = form.querySelector('[data-name=direction]');
  if (switcher) switcher.addEventListener('change', () => { direction = switcher.dataset.value; updateOpen(); });
}

/* ---------- Details einer Schuld ---------- */
function openDebtDetail(id) {
  const debt = debtById(id);
  if (!debt) { closeSheet(); return; }
  const person = personById(debt.personId);
  const name = person ? person.name : '?';
  const paid = paidAmount(debt);
  const rest = remaining(debt);
  const done = rest === 0;
  const owed = debt.direction === 'owed';
  const payments = paymentsOf(debt.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  const paymentList = payments.length
    ? `<div class="card">${payments.map((p) => `
        <div class="pay-row">
          <span class="grow">${DateUtil.format(p.date)}</span>
          <span class="row-amount">${Money.format(p.amount)}</span>
          <button type="button" class="icon-btn" data-action="delete-payment" data-id="${p.id}" aria-label="Rückzahlung löschen">${ICON.trash}</button>
        </div>`).join('')}</div>`
    : '<div class="card"><div class="kv"><span>Noch keine Rückzahlungen</span><span></span></div></div>';

  openSheet({
    title: 'Schuld',
    body: `
      <div class="detail-hero">
        <span class="badge ${done ? 'done' : ''}">${done ? '✓ Erledigt' : 'Offen'}</span>
        <div class="hero-amount ${owed ? 'pos' : 'neg'}">${Money.format(debt.amount)}</div>
        <div class="muted">${esc(owed ? `${name} schuldet dir` : `Du schuldest ${name}`)}</div>
      </div>
      <div class="card">
        <div class="progress" aria-hidden="true"><span style="width:${(paid / debt.amount) * 100}%"></span></div>
        <div class="kv"><span>Zurückgezahlt</span><span>${Money.format(paid)}</span></div>
        <div class="kv"><span>Restbetrag</span><strong>${Money.format(rest)}</strong></div>
      </div>
      <div class="card">
        <div class="kv"><span>Grund</span><span>${esc(debt.reason)}</span></div>
        <div class="kv"><span>Datum</span><span>${DateUtil.format(debt.date)}</span></div>
        <div class="kv"><span>Person</span><span>${esc(name)}</span></div>
      </div>
      <h3 class="section-label">Rückzahlungen</h3>
      ${paymentList}
      ${done ? '' : `<button type="button" class="btn primary" data-action="debt-payment" data-id="${debt.id}">Rückzahlung erfassen</button>`}
      <button type="button" class="btn" data-action="edit-debt" data-id="${debt.id}">Bearbeiten</button>
      <button type="button" class="btn destructive" data-action="delete-debt" data-id="${debt.id}">Schuld löschen</button>`,
  });
}

/* =====================================================================
   6. Löschen (immer mit Bestätigung)
   ===================================================================== */
async function deleteDebt(id) {
  const debt = debtById(id);
  if (!debt) return;
  const payments = paymentsOf(id);
  const ok = await confirmDialog({
    title: 'Schuld löschen?',
    message: `„${debt.reason}“ über ${Money.format(debt.amount)} wird endgültig gelöscht` +
      (payments.length ? `, zusammen mit ${payments.length === 1 ? '1 Rückzahlung' : payments.length + ' Rückzahlungen'}.` : '.'),
  });
  if (!ok) return;
  await save([
    ...payments.map((p) => ({ store: 'payments', delete: p.id })),
    { store: 'debts', delete: id },
  ]);
  closeSheet();
  toast('Gelöscht');
}

async function deletePayment(id) {
  const payment = state.payments.find((p) => p.id === id);
  if (!payment) return;
  const ok = await confirmDialog({
    title: 'Rückzahlung löschen?',
    message: `Die Rückzahlung über ${Money.format(payment.amount)} vom ${DateUtil.format(payment.date)} wird gelöscht. Der Restbetrag erhöht sich wieder.`,
  });
  if (!ok) return;
  await save([{ store: 'payments', delete: id }]);
  openDebtDetail(payment.debtId);
  toast('Gelöscht');
}

async function deletePerson(id) {
  const person = personById(id);
  if (!person) return;
  const debts = debtsOf(id);
  const ok = await confirmDialog({
    title: `${person.name} löschen?`,
    message: debts.length
      ? `${debts.length === 1 ? 'Die Schuld' : `Alle ${debts.length} Schulden`} und Rückzahlungen mit ${person.name} werden endgültig gelöscht.`
      : `${person.name} wird gelöscht.`,
  });
  if (!ok) return;
  const operations = [{ store: 'persons', delete: id }];
  for (const debt of debts) {
    operations.push({ store: 'debts', delete: debt.id });
    for (const payment of paymentsOf(debt.id)) operations.push({ store: 'payments', delete: payment.id });
  }
  await DB.write(operations);
  await loadData();
  location.hash = '#/';
  render();
  toast(`${person.name} gelöscht`);
}

/* =====================================================================
   7. Aktionen, Navigation & Start
   ===================================================================== */

/** Person der aktuell geöffneten Personen-Seite (oder null). */
function currentPersonId() {
  const match = location.hash.match(/^#\/person\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

/*
 * Jeder Button mit data-action="..." ruft hier die passende Funktion auf.
 * So brauchen wir nur EINEN Klick-Listener für die ganze App.
 */
const actions = {
  'new-debt': (el) => openDebtForm({ personId: el.dataset.person || currentPersonId() }),
  'new-person': () => openPersonForm(),
  'rename-person': (el) => openPersonForm(personById(el.dataset.id)),
  'delete-person': (el) => deletePerson(el.dataset.id),
  'person-payment': (el) => openPaymentForm({ personId: el.dataset.id }),
  'open-debt': (el) => openDebtDetail(el.dataset.id),
  'debt-payment': (el) => openPaymentForm({ debtId: el.dataset.id }),
  'edit-debt': (el) => openDebtForm({ debt: debtById(el.dataset.id) }),
  'delete-debt': (el) => deleteDebt(el.dataset.id),
  'delete-payment': (el) => deletePayment(el.dataset.id),
  'set-filter': (el) => { ui[el.dataset.scope + 'Filter'] = el.dataset.value; render(); },
  'set-range': (el) => { ui.statsRange = el.dataset.value; render(); },
};

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  const action = actions[el.dataset.action];
  if (action) action(el);
});

/*
 * Navigation über den Teil der Adresse nach dem "#":
 *   #/              → Übersicht
 *   #/person/<id>   → Seite einer Person
 *   #/verlauf       → Gesamtverlauf
 *   #/statistik     → Statistik
 */
function render() {
  const app = document.getElementById('app');
  const hash = location.hash || '#/';
  let tab = 'home';

  const personId = currentPersonId();
  if (personId) {
    const person = personById(personId);
    if (!person) { location.replace('#/'); return; }
    app.innerHTML = viewPerson(person);
  } else if (hash === '#/verlauf') {
    tab = 'history';
    app.innerHTML = viewHistory();
  } else if (hash === '#/statistik') {
    tab = 'stats';
    app.innerHTML = viewStats();
    drawCharts();
  } else {
    app.innerHTML = viewHome();
  }

  document.querySelectorAll('.tab').forEach((t) => {
    const active = t.dataset.tab === tab;
    t.classList.toggle('active', active);
    if (active) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
}

/** Ganz nach oben scrollen – auch noch einmal, nachdem die iPhone-Tastatur zugeklappt ist. */
function scrollToTop() {
  window.scrollTo(0, 0);
  setTimeout(() => window.scrollTo(0, 0), 350);
}

window.addEventListener('hashchange', () => {
  closeSheet();
  render();
  scrollToTop();
});

// Diagramme neu zeichnen, wenn sich die Breite ändert (z. B. Handy gedreht)
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (location.hash === '#/statistik') drawCharts(); }, 150);
});

// Damit :active (gedrückt-Effekt) auf dem iPhone funktioniert
document.addEventListener('touchstart', () => {}, { passive: true });

async function start() {
  try {
    await loadData();
    render();
  } catch (error) {
    console.error(error);
    document.getElementById('app').innerHTML = emptyState('⚠️', 'Daten konnten nicht geladen werden',
      'Der Speicher des Browsers ist nicht verfügbar (z. B. im privaten Modus). ' + (error && error.message ? error.message : ''));
  }

  // Den Browser bitten, unsere Daten nicht automatisch zu löschen
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // Service Worker anmelden → App funktioniert offline
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((error) => console.warn('Service Worker:', error));
  }
}

start();
