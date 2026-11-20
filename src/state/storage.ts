import type {
  AmpModel,
  AppDatabase,
  ChannelPreset,
  DrySample,
  Layout,
  Material,
  Project,
  SpeakerModel,
  Venue,
} from '../core/types';
import { defaultAmpModels, defaultMaterials, defaultSpeakerModels, generateDrySample } from '../core/defaults';
import { newId } from '../core/types';

const DB_NAME = 'acoustic-design-studio';
const STORE = 'kv';
const DB_KEY = 'app-db-v1';
const SCHEMA_VERSION = 1;

function emptyDb(): AppDatabase {
  return {
    projects: {},
    venues: {},
    layouts: {},
    materials: {},
    speakerModels: {},
    ampModels: {},
    presets: {},
    drySamples: {},
    schemaVersion: SCHEMA_VERSION,
  };
}

/** 首次启动时写入内置库与三条干声样本 */
function seedDefaults(db: AppDatabase): AppDatabase {
  for (const m of defaultMaterials()) db.materials[m.id] = m;
  for (const m of defaultSpeakerModels()) db.speakerModels[m.id] = m;
  for (const m of defaultAmpModels()) db.ampModels[m.id] = m;
  if (Object.keys(db.drySamples).length === 0) {
    for (const kind of ['voice', 'percussion', 'noise'] as const) {
      const sample = generateDrySample(kind, kind === 'noise' ? 2 : 3);
      db.drySamples[sample.id] = sample;
    }
  }
  return db;
}

let openPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (openPromise) return openPromise;
  openPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(STORE)) idb.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return openPromise;
}

function txn<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (idb) =>
      new Promise<T>((resolve, reject) => {
        const t = idb.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function loadDatabase(): Promise<AppDatabase> {
  const raw = await txn<AppDatabase | undefined>('readonly', (s) => s.get(DB_KEY));
  const db = raw ?? seedDefaults(emptyDb());
  // 每次加载补齐新增的内置材料/型号
  seedDefaults(db);
  return db;
}

export async function saveDatabase(db: AppDatabase): Promise<void> {
  await txn('readwrite', (s) => s.put(db, DB_KEY));
}

/** 导出整库为 JSON（Float32Array 转普通数组） */
export function exportDatabase(db: AppDatabase): string {
  const replacer = (_key: string, value: unknown) => {
    if (value instanceof Float32Array) return { __float32: Array.from(value) };
    return value;
  };
  return JSON.stringify(db, replacer, 2);
}

export async function importDatabase(json: string): Promise<AppDatabase> {
  const parsed = JSON.parse(json, (_key, value) => {
    if (value && typeof value === 'object' && Array.isArray((value as { __float32?: number[] }).__float32)) {
      return new Float32Array((value as { __float32: number[] }).__float32);
    }
    return value;
  }) as AppDatabase;
  await saveDatabase(parsed);
  return parsed;
}

export type {
  AppDatabase,
  Project,
  Venue,
  Layout,
  Material,
  SpeakerModel,
  AmpModel,
  ChannelPreset,
  DrySample,
};

export { newId };
