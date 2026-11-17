import type { Library, Project, Layout } from '../core/types';
import { seedLibrary, createDemoProject } from '../core/seed';

const DB_NAME = 'sr-design-studio';
const DB_VERSION = 1;
const STORE = {
  projects: 'projects',
  layouts: 'layouts',
  library: 'library',
  meta: 'meta'
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE.projects)) db.createObjectStore(STORE.projects, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE.layouts)) db.createObjectStore(STORE.layouts, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE.library)) db.createObjectStore(STORE.library);
      if (!db.objectStoreNames.contains(STORE.meta)) db.createObjectStore(STORE.meta);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

// ---------- 项目 ----------
export const db = {
  async listProjects(): Promise<Project[]> {
    const rows = await tx(STORE.projects, 'readonly', (s) => s.getAll());
    return (rows as Project[]).sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async getProject(id: string): Promise<Project | undefined> {
    return tx(STORE.projects, 'readonly', (s) => s.get(id));
  },
  async saveProject(p: Project): Promise<void> {
    p.updatedAt = Date.now();
    await tx(STORE.projects, 'readwrite', (s) => s.put(p));
  },
  async deleteProject(id: string): Promise<void> {
    const project = await this.getProject(id);
    if (project) {
      for (const layoutId of project.layoutIds) {
        await tx(STORE.layouts, 'readwrite', (s) => s.delete(layoutId));
      }
    }
    await tx(STORE.projects, 'readwrite', (s) => s.delete(id));
  },

  // ---------- 布置方案 ----------
  async listLayouts(ids: string[]): Promise<Layout[]> {
    const all = (await tx(STORE.layouts, 'readonly', (s) => s.getAll())) as Layout[];
    return all.filter((l) => ids.includes(l.id)).sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async getLayout(id: string): Promise<Layout | undefined> {
    return tx(STORE.layouts, 'readonly', (s) => s.get(id));
  },
  async saveLayout(layout: Layout): Promise<void> {
    layout.updatedAt = Date.now();
    await tx(STORE.layouts, 'readwrite', (s) => s.put(layout));
  },
  async deleteLayout(id: string): Promise<void> {
    await tx(STORE.layouts, 'readwrite', (s) => s.delete(id));
  },

  // ---------- 全局库 ----------
  async getLibrary(): Promise<Library> {
    const lib = await tx(STORE.library, 'readonly', (s) => s.get('current'));
    if (lib) return lib as Library;
    const seeded = seedLibrary();
    await tx(STORE.library, 'readwrite', (s) => s.put(seeded, 'current'));
    return seeded;
  },
  async saveLibrary(lib: Library): Promise<void> {
    await tx(STORE.library, 'readwrite', (s) => s.put(lib, 'current'));
  },

  // ---------- 首启演示数据 ----------
  async ensureSeed(): Promise<void> {
    const initialized = await tx(STORE.meta, 'readonly', (s) => s.get('initialized'));
    if (initialized) return;
    const { project, layouts } = createDemoProject();
    await this.saveProject(project);
    for (const l of layouts) await this.saveLayout(l);
    await tx(STORE.meta, 'readwrite', (s) => s.put(true, 'initialized'));
  },

  async exportAll(): Promise<string> {
    const [projects, layouts, library] = await Promise.all([
      tx(STORE.projects, 'readonly', (s) => s.getAll()),
      tx(STORE.layouts, 'readonly', (s) => s.getAll()),
      this.getLibrary()
    ]);
    return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), projects, layouts, library }, null, 2);
  },

  async importAll(json: string): Promise<void> {
    const data = JSON.parse(json) as { projects: Project[]; layouts: Layout[]; library: Library };
    for (const p of data.projects ?? []) await this.saveProject(p);
    for (const l of data.layouts ?? []) await this.saveLayout(l);
    if (data.library) await this.saveLibrary(data.library);
  }
};
