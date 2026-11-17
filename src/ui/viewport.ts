import { h } from './dom';
import { SceneRenderer, type SceneOptions, type ScenePick } from '../render/scene';
import type { AnalysisSnapshot, Layout, Library, Project } from '../core/types';

/** 可挂载的 3D 视图组件，内部用 rAF 持续渲染相机交互 */
export function viewport(
  project: Project,
  getLayout: () => Layout | null,
  getSnapshot: () => AnalysisSnapshot | null,
  library: Library,
  options: () => SceneOptions,
  onPick?: (p: ScenePick | null) => void,
  onRenderer?: (r: SceneRenderer) => void
): { el: HTMLElement; renderer: SceneRenderer } {
  const canvas = h('canvas', {}) as HTMLCanvasElement;
  const el = h('div', { class: 'viewport' },
    canvas,
    h('div', { class: 'viewport-hint' }, '左键旋转 · Shift+左键平移 · 滚轮缩放 · 单击拾取设备/座位'),
    h('div', { class: 'viewport-legend' },
      h('div', {}, h('span', { class: 'legend-sw', style: { background: '#ffbf33' } }), '音箱'),
      h('div', {}, h('span', { class: 'legend-sw', style: { background: '#ff5966' } }), '话筒/回声点'),
      h('div', {}, h('span', { class: 'legend-sw', style: { background: '#66d9ff' } }), '线阵列/一阶反射'),
      h('div', {}, h('span', { class: 'legend-sw', style: { background: '#3970e6' } }), '二阶反射')
    )
  );
  const renderer = new SceneRenderer(canvas, onPick);
  renderer.frameVenue(project.venue);
  let raf = 0;
  const loop = () => {
    renderer.render(project, getLayout(), library, getSnapshot(), options());
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  // 离开 DOM 后停止
  new MutationObserver(() => {
    if (!el.isConnected) cancelAnimationFrame(raf);
  }).observe(document.body, { childList: true, subtree: true });
  onRenderer?.(renderer);
  return { el, renderer };
}

export const DEFAULT_SCENE_OPTS: SceneOptions = {
  showHeatmap: false,
  showReflections: false,
  showEcho: false,
  showCoverage: true,
  heatmapRange: [70, 100]
};
