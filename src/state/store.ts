import type {
  AppDatabase,
  ChannelPreset,
  DrySample,
  Layout,
  Material,
  Project,
  SpeakerModel,
  AmpModel,
  Venue,
} from '../core/types';
import { loadDatabase, saveDatabase } from './storage';

type Listener = () => void;

/**
 * 全局应用状态。单一不可变快照 + 发布订阅，
 * 变更后防抖写入 IndexedDB，所有数据仅存浏览器本地。
 */
class AppStore {
  private db: AppDatabase | null = null;
  private listeners = new Set<Listener>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving = false;

  async init(): Promise<void> {
    if (this.db) return;
    this.db = await loadDatabase();
    this.emit();
  }

  get state(): AppDatabase {
    if (!this.db) throw new Error('Store 尚未初始化，请先 await store.init()');
    return this.db;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 所有写操作的唯一入口 */
  mutate(fn: (db: AppDatabase) => void): void {
    if (!this.db) return;
    fn(this.db);
    this.emit();
    this.scheduleSave();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.persist();
    }, 400);
  }

  async persist(): Promise<void> {
    if (!this.db || this.saving) return;
    this.saving = true;
    try {
      await saveDatabase(this.db);
    } finally {
      this.saving = false;
    }
  }

  async replaceDatabase(db: AppDatabase): Promise<void> {
    this.db = db;
    await saveDatabase(db);
    this.emit();
  }

  // ---------- 项目 ----------
  listProjects(): Project[] {
    return Object.values(this.state.projects).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // ---------- 材料 ----------
  listMaterials(): Material[] {
    return Object.values(this.state.materials).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  }

  // ---------- 型号库 ----------
  listSpeakerModels(): SpeakerModel[] {
    return Object.values(this.state.speakerModels);
  }
  listAmpModels(): AmpModel[] {
    return Object.values(this.state.ampModels);
  }

  // ---------- 预设 ----------
  listPresets(): ChannelPreset[] {
    return Object.values(this.state.presets).sort((a, b) => b.createdAt - a.createdAt);
  }

  // ---------- 干声 ----------
  listDrySamples(): DrySample[] {
    return Object.values(this.state.drySamples);
  }

  getVenue(id: string): Venue | undefined {
    return this.state.venues[id];
  }

  getLayout(id: string): Layout | undefined {
    return this.state.layouts[id];
  }
}

export const store = new AppStore();
