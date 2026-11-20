import { h, clear } from './dom';
import { store } from '../state/store';
import { renderProjectsPage } from './pages/projectsPage';
import { renderVenuePage } from './pages/venuePage';
import { renderLayoutPage } from './pages/layoutPage';
import { renderAnalysisPage } from './pages/analysisPage';
import { renderReportPage } from './pages/reportPage';

export type Route =
  | { name: 'projects' }
  | { name: 'venue'; projectId: string }
  | { name: 'layout'; projectId: string; layoutId: string }
  | { name: 'analysis'; projectId: string; layoutId: string; compareLayoutId?: string }
  | { name: 'report'; projectId: string; layoutId: string };

const TAB_DEFS: Array<{ key: Route['name']; label: string }> = [
  { key: 'projects', label: '项目列表' },
  { key: 'venue', label: '场地建模' },
  { key: 'layout', label: '音箱布置' },
  { key: 'analysis', label: '声场分析' },
  { key: 'report', label: '报告' },
];

export class Router {
  current: Route = { name: 'projects' };
  private host: HTMLElement | null = null;
  private headerMeta: HTMLElement | null = null;

  attach(host: HTMLElement): void {
    this.host = host;
    window.addEventListener('hashchange', () => this.handleHash());
    this.handleHash();
  }

  private handleHash(): void {
    const hash = location.hash.slice(1) || '/';
    const parts = hash.split('/').filter(Boolean);
    if (parts[0] === 'venue' && parts[1]) {
      this.current = { name: 'venue', projectId: parts[1] };
    } else if (parts[0] === 'layout' && parts[1] && parts[2]) {
      this.current = { name: 'layout', projectId: parts[1], layoutId: parts[2] };
    } else if (parts[0] === 'analysis' && parts[1] && parts[2]) {
      this.current = {
        name: 'analysis',
        projectId: parts[1],
        layoutId: parts[2],
        compareLayoutId: parts[3],
      };
    } else if (parts[0] === 'report' && parts[1] && parts[2]) {
      this.current = { name: 'report', projectId: parts[1], layoutId: parts[2] };
    } else {
      this.current = { name: 'projects' };
    }
    this.render();
  }

  go(route: Route): void {
    let hash = '/';
    if (route.name === 'venue') hash = `/venue/${route.projectId}`;
    if (route.name === 'layout') hash = `/layout/${route.projectId}/${route.layoutId}`;
    if (route.name === 'analysis') {
      hash = `/analysis/${route.projectId}/${route.layoutId}${route.compareLayoutId ? '/' + route.compareLayoutId : ''}`;
    }
    if (route.name === 'report') hash = `/report/${route.projectId}/${route.layoutId}`;
    location.hash = hash;
  }

  render(): void {
    if (!this.host) return;
    const host = this.host;
    clear(host);
    const route = this.current;
    const projectId = 'projectId' in route ? route.projectId : undefined;
    const project = projectId ? store.state.projects[projectId] : undefined;

    const header = h('header', { class: 'topbar' }, [
      h('div', { class: 'brand', text: '扩声设计工作室 ADS' }),
      h(
        'nav',
        { class: 'tabs' },
        TAB_DEFS.map((t) =>
          h(
            'button',
            {
              class: t.key === route.name ? 'active' : '',
              onclick: () => {
                if (t.key === 'projects') this.go({ name: 'projects' });
                else if (project) this.navigateWithin(project.id, t.key as Route['name']);
              },
            },
            [t.label],
          ),
        ),
      ),
      h('div', { class: 'meta', id: 'header-meta' }, [
        project ? `当前项目：${project.name}` : '本地数据 · 无需联网',
      ]),
    ]);
    this.headerMeta = header.querySelector('#header-meta');

    const main = h('main', { class: 'page' });
    host.append(header, main);

    if (route.name === 'projects') renderProjectsPage(main, this);
    if (route.name === 'venue' && project) renderVenuePage(main, this, project);
    if (route.name === 'layout' && project) renderLayoutPage(main, this, project, route.layoutId);
    if (route.name === 'analysis' && project)
      renderAnalysisPage(main, this, project, route.layoutId, route.compareLayoutId);
    if (route.name === 'report' && project) renderReportPage(main, this, project, route.layoutId);
  }

  /** 在同一项目内切换页签，自动沿用当前场地/方案 */
  private navigateWithin(projectId: string, key: Route['name']): void {
    const project = store.state.projects[projectId];
    if (!project) return this.go({ name: 'projects' });
    if (key === 'venue') return this.go({ name: 'venue', projectId });
    const layoutId = project.layoutIds[0];
    if (!layoutId) {
      this.go({ name: 'venue', projectId });
      return;
    }
    if (key === 'layout') this.go({ name: 'layout', projectId, layoutId });
    if (key === 'analysis') this.go({ name: 'analysis', projectId, layoutId });
    if (key === 'report') this.go({ name: 'report', projectId, layoutId });
  }

  setMeta(text: string): void {
    if (this.headerMeta) this.headerMeta.textContent = text;
  }
}

export const router = new Router();
