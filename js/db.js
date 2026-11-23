'use strict';
/*
 * db.js – Speichern der Daten in der IndexedDB des Browsers.
 *
 * Die IndexedDB ist eine kleine Datenbank direkt auf dem Gerät.
 * Es gibt drei "Stores" (vergleichbar mit Tabellen):
 *
 *   persons:  { id, name, createdAt }
 *   debts:    { id, personId, direction, amount, reason, date, createdAt }
 *               direction: 'owe'  = ich schulde der Person etwas
 *                          'owed' = die Person schuldet mir etwas
 *               amount:    Betrag in Cent
 *   payments: { id, debtId, amount, date, createdAt }   (Rückzahlungen)
 */
const DB = (() => {
  const NAME = 'schuldenbuch';
  const VERSION = 1;
  const STORES = ['persons', 'debts', 'payments'];
  let dbPromise = null;

  /** Öffnet die Datenbank (beim ersten Mal wird sie angelegt). */
  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(NAME, VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          for (const store of STORES) {
            if (!db.objectStoreNames.contains(store)) {
              db.createObjectStore(store, { keyPath: 'id' });
            }
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return dbPromise;
  }

  /** Liest alle Einträge eines Stores, z. B. getAll('persons'). */
  async function getAll(store) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Führt mehrere Änderungen auf einmal aus – entweder ALLE oder KEINE
   * (eine "Transaktion"). Beispiel:
   *   write([
   *     { store: 'debts', put: schuld },        // anlegen oder überschreiben
   *     { store: 'payments', delete: 'abc123' } // löschen per id
   *   ])
   */
  async function write(operations) {
    if (operations.length === 0) return;
    const db = await open();
    const stores = [...new Set(operations.map((op) => op.store))];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite');
      for (const op of operations) {
        const store = tx.objectStore(op.store);
        if (op.delete !== undefined) store.delete(op.delete);
        else store.put(op.put);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return { getAll, write };
})();
