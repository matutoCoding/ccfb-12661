import type { Library, Project, Layout, AnalysisSnapshot } from '../core/types';
import { deepClone } from '../core/math/vec3';
import { db } from './storage';

export interface AppState {
  ready: boolean;
  library: Library;
  projects: Project[];
  currentProjectId: string | null;
  currentLayoutId: string | null;
  layouts: Layout[];
  snapshots: Record<string, AnalysisSnapshot>;
  /** 对比模式选中的两个方案 id */
  compareIds: [string | null, string | null];
  busy: { active: boolean; phase: string; percent: number };
}

type Listener = (state: AppState) => void;

class Store {
  state: AppState = {
    ready: false,
    library: { materials: [], speakers: [], amps: [], presets: [] },
    projects: [],
    currentProjectId: null,
    currentLayoutId: null,
    layouts: [],
    snapshots: {},
    compareIds: [null, null],
    busy: { active: false, phase: '', percent: 0 }
  };
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 以可变方式更新后统一通知，patch 内可直接改 draft */
  update(mutator: (draft: AppState) => void): void {
    mutator(this.state);
    for (const fn of this.listeners) fn(this.state);
  }

  async init(): Promise<void> {
    await db.ensureSeed();
    const [projects, library] = await Promise.all([db.listProjects(), db.getLibrary()]);
    this.update((s) => {
      s.ready = true;
      s.projects = projects;
      s.library = library;
      if (projects[0]) s.currentProjectId = projects[0].id;
    });
    if (this.state.currentProjectId) await this.openProject(this.state.currentProjectId);
  }

  async openProject(projectId: string): Promise<void> {
    const project = await db.getProject(projectId);
    if (!project) return;
    const layouts = await db.listLayouts(project.layoutIds);
    this.update((s) => {
      s.currentProjectId = projectId;
      s.layouts = layouts;
      s.currentLayoutId = layouts[0]?.id ?? null;
      s.snapshots = {};
      s.compareIds = [layouts[0]?.id ?? null, layouts[1]?.id ?? null];
    });
  }

  get currentProject(): Project | undefined {
    return this.state.projects.find((p) => p.id === this.state.currentProjectId);
  }

  get currentLayout(): Layout | undefined {
    return this.state.layouts.find((l) => l.id === this.state.currentLayoutId);
  }

  async saveProject(): Promise<void> {
    const p = this.currentProject;
    if (p) await db.saveProject(deepClone(p));
  }

  async saveLayout(layout?: Layout): Promise<void> {
    const target = layout ?? this.currentLayout;
    if (target) await db.saveLayout(deepClone(target));
  }

  async refreshProjects(): Promise<void> {
    this.update((s) => {
      s.projects = [...s.projects].sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }

  async saveLibrary(): Promise<void> {
    await db.saveLibrary(deepClone(this.state.library));
  }

  setBusy(active: boolean, phase = '', percent = 0): void {
    this.update((s) => {
      s.busy = { active, phase, percent };
    });
  }
}

export const store = new Store();
