/**
 * Foto aus dem Foto-Assistenten bis zum Bilder-Schritt merken: Beim Anlegen gibt es noch kein Inserat, an das man es
 * hochladen könnte. Liegt nur im Browser (IndexedDB), höchstens zehn Minuten, und wird beim Übernehmen gelöscht.
 * Fehler (privates Fenster, gesperrter Speicher) werden ignoriert – dann lädt man das Foto eben selbst hoch.
 */
const DB = 'markterl';
const STORE = 'pending-photo';
const KEY = 'new-listing';
const MAX_AGE_MS = 10 * 60_000;

interface Entry {
  blob: Blob;
  savedAt: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
  } catch {
    return undefined;
  }
}

export async function savePendingPhoto(blob: Blob) {
  await run('readwrite', (store) => store.put({ blob, savedAt: Date.now() } satisfies Entry, KEY));
}

export async function clearPendingPhoto() {
  await run('readwrite', (store) => store.delete(KEY));
}

/** Holt das gemerkte Foto (falls frisch genug) und löscht es, damit es nur einmal übernommen wird. */
export async function takePendingPhoto(): Promise<File | null> {
  const entry = (await run('readonly', (store) => store.get(KEY))) as Entry | undefined;
  if (!entry) return null;
  await clearPendingPhoto();
  if (!(entry.blob instanceof Blob) || Date.now() - entry.savedAt > MAX_AGE_MS) return null;
  return new File([entry.blob], 'foto.jpg', { type: entry.blob.type || 'image/jpeg' });
}
