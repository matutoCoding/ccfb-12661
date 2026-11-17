import { h, mount } from './dom';
import { currentRoute, navigate, onRouteChange, type Route } from '../state/router';
import { store } from '../state/store';
import { renderProjectsPage } from './pages/projects-page';
import { renderVenuePage } from './pages/venue-page';
import { renderLayoutPage } from './pages/layout-page';
import { renderAnalysisPage } from './pages/analysis-page';
import { renderReportPage } from './pages/report-page';

const NAV: { route: Route; label: string; icon: string }[] = [
  { route: 'projects', label: '项目列表', icon: '📁' },
  { route: 'venue', label: '场地建模', icon: '🏛' },
  { route: 'layout', label: '音箱布置', icon: '🔊' },
  { route: 'analysis', label: '声场分析', icon: '📈' },
  { route: 'report', label: '报告', icon: '📄' }
];

const TITLES: Record<Route, string> = {
  projects: '项目列表',
  venue: '场地建模 · 房间/观众区/材料',
  layout: '音箱布置 · 线阵列/信号流/DSP',
  analysis: '声场分析 · SPL/RT60/啸叫/反射/试听',
  report: '设计报告 · 设备清单/吊挂/功耗'
};

export function renderApp(): void {
  const root = document.getElementById('app')!;
  const content = h('div', { class: 'content' });
  const busyBar = h('div', { class: 'progress-bar', style: { display: 'none', width: '180px' } }, h('div', { style: { width: '0%' } }));
  const busyText = h('span', { class: 'crumb' }, '');

  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'logo' }, '扩声设计工坊', h('small', {}, 'SR Design Studio · WebGL2 + Web Audio')),
    ...NAV.map((n) => h('button', {
      class: `nav-item ${currentRoute() === n.route ? 'active' : ''}`,
      dataset: { route: n.route },
      onclick: () => navigate(n.route)
    }, h('span', { class: 'ico' }, n.icon), n.label)),
    h('div', { class: 'sidebar-foot' },
      '数据全部存储于本机 IndexedDB', h('br'), '反射/啸叫计算运行于 Web Worker', h('br'), '零外部服务依赖'
    )
  );

  const topbar = h('div', { class: 'topbar' },
    h('h2', { id: 'page-title' }, TITLES[currentRoute()]),
    h('span', { class: 'crumb', id: 'project-crumb' }, projectCrumb()),
    h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' } }, busyText, busyBar)
  );

  mount(root, sidebar, h('div', { class: 'workspace' }, topbar, content));

  const renderRoute = (route: Route) => {
    document.querySelectorAll<HTMLElement>('.nav-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.route === route);
    });
    (document.getElementById('page-title') as HTMLElement).textContent = TITLES[route];
    (document.getElementById('project-crumb') as HTMLElement).textContent = projectCrumb();
    content.scrollTop = 0;
    if (route === 'projects') renderProjectsPage(content);
    else if (route === 'venue') renderVenuePage(content);
    else if (route === 'layout') renderLayoutPage(content);
    else if (route === 'analysis') renderAnalysisPage(content);
    else renderReportPage(content);
  };

  onRouteChange(renderRoute);
  store.subscribe(() => {
    (document.getElementById('project-crumb') as HTMLElement).textContent = projectCrumb();
    const { busy } = store.state;
    busyBar.style.display = busy.active ? 'block' : 'none';
    (busyBar.firstElementChild as HTMLElement).style.width = `${busy.percent}%`;
    busyText.textContent = busy.active ? `${busy.phase} ${busy.percent}%` : '';
    if (currentRoute() === 'projects') renderProjectsPage(content);
  });
  renderRoute(currentRoute());
}

function projectCrumb(): string {
  const p = store.currentProject;
  const l = store.currentLayout;
  if (!p) return '';
  return `${p.name}${l ? ' · ' + l.name : ''}`;
}
