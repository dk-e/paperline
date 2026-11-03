type Handoff = { id: string; name: string; blob: Blob; created: number };
export async function readHandoff(id: string): Promise<{ bytes: Uint8Array; name: string }> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('paperline-handoffs-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const record = await new Promise<Handoff>((resolve, reject) => {
      const request = db.transaction('documents').objectStore('documents').get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!record || record.created < Date.now() - 10 * 60 * 1000) throw Error('This PDF handoff expired. Open the link again from its original page.');
    const bytes = new Uint8Array(await record.blob.arrayBuffer());
    // Opening the document transfers recovery to the existing local-draft store.
    const tx = db.transaction('documents', 'readwrite');
    tx.objectStore('documents').delete(id);
    return { bytes, name: record.name };
  } finally { db.close(); }
}
