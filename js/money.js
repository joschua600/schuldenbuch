'use strict';
/*
 * money.js – Hilfsfunktionen für Geldbeträge und Datumswerte.
 *
 * WICHTIG: Alle Beträge werden intern als GANZE CENT gespeichert.
 *   12,50 €  →  1250
 * Mit Kommazahlen rechnet ein Computer ungenau (0.1 + 0.2 = 0.30000000000000004).
 * Mit ganzen Zahlen passiert das nicht.
 */

// Intl.NumberFormat kennt das deutsche Format: "1.234,50 €"
const euroFormat = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const euroShortFormat = new Intl.NumberFormat('de-DE', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0,
});

const MAX_CENTS = 99999999; // 999.999,99 € – mehr braucht diese App nicht

const Money = {
  /** 1250 → "12,50 €" */
  format(cents) {
    return euroFormat.format(cents / 100);
  },

  /** 1250 → "+12,50 €", -800 → "−8,00 €" */
  formatSigned(cents) {
    if (cents > 0) return '+' + Money.format(cents);
    if (cents < 0) return '−' + Money.format(-cents);
    return Money.format(0);
  },

  /** Für Diagramm-Achsen ohne Nachkommastellen: 5000 → "50 €" */
  formatShort(cents) {
    return euroShortFormat.format(cents / 100);
  },

  /** 1250 → "12,50" (zum Vorbefüllen eines Eingabefelds) */
  toInput(cents) {
    const euros = Math.floor(cents / 100);
    const rest = String(cents % 100).padStart(2, '0');
    return euros + ',' + rest;
  },

  /**
   * Text aus einem Eingabefeld → Cent (oder null, wenn ungültig).
   * Erlaubt: "12", "12,5", "12,50", "12.50", "1.234,56", "1234,56 €"
   */
  parse(text) {
    let s = String(text).replace(/€/g, '').replace(/\s/g, '');
    if (s === '') return null;

    if (s.includes(',')) {
      // Deutsches Format: Punkte sind Tausendertrenner, Komma ist das Dezimalzeichen
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      // "1.000" ohne Komma → Tausendertrenner
      s = s.replace(/\./g, '');
    }

    // Jetzt muss es so aussehen: Ziffern, optional Punkt + 1–2 Ziffern
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;

    // Euro- und Cent-Teil getrennt umwandeln – ganz ohne Kommazahlen
    const [euros, cents = ''] = s.split('.');
    const result = parseInt(euros, 10) * 100 + parseInt((cents + '00').slice(0, 2), 10);
    return result > MAX_CENTS ? null : result;
  },
};

/*
 * Datumswerte speichern wir als Text "JJJJ-MM-TT" (z. B. "2026-11-23").
 * So lassen sie sich einfach sortieren und es gibt keine Zeitzonen-Probleme.
 */
const DateUtil = {
  /** Date-Objekt → "2026-11-23" (lokale Zeit) */
  fromDate(d) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  },

  /** "2026-11-23" → Date-Objekt (Mitternacht, lokale Zeit) */
  toDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  },

  today() {
    return DateUtil.fromDate(new Date());
  },

  isValid(iso) {
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !isNaN(DateUtil.toDate(iso).getTime());
  },

  /** "2026-11-23" → "23.11.2026" */
  format(iso) {
    return DateUtil.toDate(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  },

  /** "2026-11-23" → "November 2026" */
  monthTitle(iso) {
    return DateUtil.toDate(iso.slice(0, 7) + '-01').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  },

  /** "2026-11-23" plus n Monate (n darf negativ sein) */
  addMonths(iso, n) {
    const d = DateUtil.toDate(iso);
    d.setMonth(d.getMonth() + n);
    return DateUtil.fromDate(d);
  },
};
