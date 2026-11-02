/**
 * Fotos aus dem Inserieren-Formular bis zum Bilder-Schritt merken: Beim Anlegen gibt es noch kein Inserat, an das man
 * sie hochladen könnte. Liegen nur im Browser (IndexedDB), höchstens zehn Minuten, und werden beim Übernehmen gelöscht.
 * Fehler (privates Fenster, gesperrter Speicher) werden ignoriert – dann lädt man die Fotos eben selbst hoch.
 */
const DB = 'markterl';
const STORE = 'pending-photo';
const KEY = 'new-listing';
const MAX_AGE_MS = 10 * 60_000;

interface Entry {
  /** Ältere Einträge (ein Foto) hatten `blob` statt `blobs` */
  blobs?: Blob[];
  blob?: Blob;
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

export async function savePendingPhotos(blobs: Blob[]) {
  if (!blobs.length) return clearPendingPhotos();
  await run('readwrite', (store) => store.put({ blobs, savedAt: Date.now() } satisfies Entry, KEY));
}

export async function clearPendingPhotos() {
  await run('readwrite', (store) => store.delete(KEY));
}

/** Holt die gemerkten Fotos (falls frisch genug) und löscht sie, damit sie nur einmal übernommen werden. */
export async function takePendingPhotos(): Promise<File[]> {
  const entry = (await run('readonly', (store) => store.get(KEY))) as Entry | undefined;
  if (!entry) return [];
  await clearPendingPhotos();
  if (Date.now() - entry.savedAt > MAX_AGE_MS) return [];
  const blobs = (entry.blobs ?? (entry.blob ? [entry.blob] : [])).filter((b): b is Blob => b instanceof Blob);
  return blobs.map((blob, i) => new File([blob], `foto-${i + 1}.jpg`, { type: blob.type || 'image/jpeg' }));
}
