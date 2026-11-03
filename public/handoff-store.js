// Short-lived, extension-origin storage for PDFs fetched in a site's own login
// context. Bytes never pass through a public URL or an external service.
globalThis.paperlineStore = {
  async open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('paperline-handoffs-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  async put(record) {
    const db = await this.open();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('documents', 'readwrite');
        const store = tx.objectStore('documents');
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (entry) { if (entry.value.created < Date.now() - 10 * 60 * 1000) entry.delete(); entry.continue(); }
        };
        store.put(record);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  },
};
