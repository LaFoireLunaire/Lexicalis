// Optional, partitioned browser storage. Failure must never prevent playing.
const DATABASE = 'lexicalis-vector-cache';
const STORE = 'datasets';
const OPEN_TIMEOUT_MS = 2000;
const TRANSACTION_TIMEOUT_MS = 10000;

export function openDatasetCache() {
  return new Promise(resolve => {
    let request;
    let settled = false;
    const finish = value => {
      if (settled) { value?.close(); return; }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), OPEN_TIMEOUT_MS);
    try {
      request = globalThis.indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        try {
          const store = request.result.createObjectStore(STORE, { keyPath: 'manifestUrl' });
          store.createIndex('identity', ['manifestUrl', 'fingerprint'], { unique: true });
        } catch {
          try { request.transaction.abort(); } catch { /* Unavailable storage. */ }
          finish(null);
        }
      };
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        finish(database);
      };
    } catch { finish(null); }
  });
}

function transaction(database, mode, operation) {
  if (!database) return Promise.resolve(null);
  return new Promise(resolve => {
    let tx;
    let value = null;
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { tx?.abort(); } catch { /* Already finished or closed. */ }
      finish(null);
    }, TRANSACTION_TIMEOUT_MS);
    try {
      tx = database.transaction(STORE, mode);
      const request = operation(tx.objectStore(STORE));
      request.onsuccess = () => { value = request.result ?? (mode === 'readwrite' ? true : null); };
      tx.oncomplete = () => finish(value);
      tx.onerror = () => finish(null);
      tx.onabort = () => finish(null);
    } catch { finish(null); }
  });
}

export function readDatasetCache(database, manifestUrl, fingerprint) {
  // The index avoids reading 117 MiB of obsolete data after a version change.
  return transaction(database, 'readonly', store => store.index('identity').get([manifestUrl, fingerprint]));
}

export function writeDatasetCache(database, manifestUrl, fingerprint, buffers, validationVersion) {
  // One entry per source URL: a successful update replaces its previous version atomically.
  return transaction(database, 'readwrite', store => store.put({
    manifestUrl, fingerprint, validationVersion, blobs: buffers.map(buffer => new Blob([buffer])),
  }));
}

export function deleteDatasetCache(database, manifestUrl) {
  return transaction(database, 'readwrite', store => store.delete(manifestUrl));
}
