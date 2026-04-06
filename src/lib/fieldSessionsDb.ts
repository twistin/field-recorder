import type { FieldSession } from '../types/fieldSessions';

const DB_NAME = 'field-session-atlas';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this browser.'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB.'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (
    store: IDBObjectStore,
    resolve: (value: T) => void,
    reject: (reason?: unknown) => void,
  ) => void,
): Promise<T> {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);

    function closeDatabase() {
      database.close();
    }

    transaction.onabort = () => {
      closeDatabase();
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    };
    transaction.onerror = () => {
      closeDatabase();
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    };
    transaction.oncomplete = () => closeDatabase();

    action(store, resolve, reject);
  });
}

export async function listFieldSessions(): Promise<FieldSession[]> {
  const rows = await withStore<FieldSession[]>('readonly', (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result as FieldSession[]) ?? []);
    request.onerror = () => reject(request.error ?? new Error('Unable to load field sessions.'));
  });

  return rows.sort(
    (left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime(),
  );
}

export async function saveFieldSession(session: FieldSession): Promise<void> {
  await withStore<void>('readwrite', (store, resolve, reject) => {
    const request = store.put(session);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Unable to save field session.'));
  });
}

export async function deleteFieldSession(sessionId: string): Promise<void> {
  await withStore<void>('readwrite', (store, resolve, reject) => {
    const request = store.delete(sessionId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Unable to delete field session.'));
  });
}
