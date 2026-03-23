export interface RecordingMetadata {
  placeName: string;
  environmentType: string;
  weather: string;
  equipment: string;
  description: string;
  tags: string[];
}

export interface StoredRecording {
  id: string;
  createdAt: string;
  durationMs: number;
  mode: 'manual' | 'walk';
  gps: {
    lat: number;
    lon: number;
    accuracy: number | null;
  };
  mimeType: string;
  audioBlob: Blob;
  placeName?: string;
  environmentType?: string;
  weather?: string;
  equipment?: string;
  description?: string;
  title?: string;
  tags?: string[];
  notes?: string;
  imageUrl?: string;
  prompt?: string;
}

const DB_NAME = 'field-recorder-atlas';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';

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
  action: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
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

export async function listStoredRecordings(): Promise<StoredRecording[]> {
  const rows = await withStore<StoredRecording[]>('readonly', (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result as StoredRecording[]) ?? []);
    request.onerror = () => reject(request.error ?? new Error('Unable to load recordings.'));
  });

  return rows.sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

export async function saveStoredRecording(recording: StoredRecording): Promise<void> {
  await withStore<void>('readwrite', (store, resolve, reject) => {
    const request = store.put(recording);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Unable to save recording.'));
  });
}

export async function deleteStoredRecording(id: string): Promise<void> {
  await withStore<void>('readwrite', (store, resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Unable to delete recording.'));
  });
}

async function patchStoredRecording(id: string, patch: Partial<StoredRecording>): Promise<void> {
  await withStore<void>('readwrite', (store, resolve, reject) => {
    const readRequest = store.get(id);

    readRequest.onsuccess = () => {
      const current = readRequest.result as StoredRecording | undefined;
      if (!current) {
        reject(new Error(`Recording ${id} was not found.`));
        return;
      }

      const writeRequest = store.put({
        ...current,
        ...patch,
      });

      writeRequest.onsuccess = () => resolve();
      writeRequest.onerror = () => reject(writeRequest.error ?? new Error('Unable to update recording.'));
    };

    readRequest.onerror = () => reject(readRequest.error ?? new Error('Unable to load recording visual data.'));
  });
}

export async function updateStoredRecordingVisual(
  id: string,
  imageUrl: string,
  prompt: string,
): Promise<void> {
  await patchStoredRecording(id, { imageUrl, prompt });
}

export async function updateStoredRecordingMetadata(
  id: string,
  metadata: RecordingMetadata,
): Promise<void> {
  await patchStoredRecording(id, {
    placeName: metadata.placeName,
    environmentType: metadata.environmentType,
    weather: metadata.weather,
    equipment: metadata.equipment,
    description: metadata.description,
    title: metadata.placeName,
    tags: metadata.tags,
    notes: metadata.description,
  });
}
