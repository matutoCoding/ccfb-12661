import { h, clear, toast, downloadText } from '../dom';
import { store } from '../../state/store';
import { createProject, createVenue, createLayout } from '../../core/factory';
import { exportDatabase, importDatabase } from '../../state/storage';
import type { Router } from '../router';

export function renderProjectsPage(host: HTMLElement, router: Router): void {
  const sidebar = h('div', { class: 'sidebar' });
  const content = h('div', { class: 'content scroll' });
  host.append(sidebar, content);

  const renderSidebar = () => {
    clear(sidebar);
    sidebar.append(
      h('div', { class: 'panel' }, [
        h('h3', { text: '数据管理' }),
        h('div', { class: 'btn-row' }, [
          h('button', {
            class: 'btn ghost small',
            text: '导出全部数据 (JSON)',
            onclick: () => {
              downloadText('acoustic-studio-backup.json', exportDatabase(store.state));
              toast('已导出本地数据备份');
            },
          }),
          h('button', {
            class: 'btn ghost small',
            text: '导入数据',
            onclick: () => {
              const input = h('input', { type: 'file', accept: '.json' }) as HTMLInputElement;
              input.onchange = async () => {
                const file = input.files?.[0];
                if (!file) return;
                const text = await file.text();
                try {
                  const db = await importDatabase(text);
                  await store.replaceDatabase(db);
                  toast('导入成功');
                  renderAll();
                } catch (err) {
                  toast('导入失败：' + (err as Error).message);
                }
              };
              input.click();
            },
          }),
        ]),
      ]),
      h('div', { class: 'panel' }, [
        h('h3', { text: '本地资源库' }),
        h('div', { class: 'muted', style: 'line-height:1.8;font-size:12.5px' }, [
          `材料：${Object.keys(store.state.materials).length} 种`,
          h('br'),
          `音箱型号：${Object.keys(store.state.speakerModels).length} 个`,
          h('br'),
          `功放型号：${Object.keys(store.state.ampModels).length} 个`,
          h('br'),
          `DSP 预设：${Object.keys(store.state.presets).length} 条`,
          h('br'),
          `干声样本：${Object.keys(store.state.drySamples).length} 段`,
        ]),
      ]),
    );
  };

  const renderContent = () => {
    clear(content);
    const projects = store.listProjects();
    content.append(
      h('div', { class: 'panel' }, [
        h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [
          h('h3', { text: '项目列表', style: 'margin:0' }),
          h('button', {
            class: 'btn',
            text: '+ 新建项目',
            onclick: () => openCreateDialog(),
          }),
        ]),
      ]),
    );
    if (projects.length === 0) {
      content.append(
        h('div', { class: 'panel muted', style: 'text-align:center;padding:48px' }, [
          '还没有项目，点击「新建项目」开始第一个剧场扩声设计。',
        ]),
      );
      return;
    }
    const grid = h('div', { class: 'grid-2' });
    for (const p of projects) {
      const venue = p.venueId ? store.getVenue(p.venueId) : undefined;
      grid.append(
        h('div', { class: 'list-item', onclick: () => router.go({ name: 'venue', projectId: p.id }) }, [
          h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [
            h('div', { class: 'title', text: p.name }),
            h('span', {
              class: `badge ${p.layoutIds.length ? 'ok' : 'warn'}`,
              text: `${p.layoutIds.length} 套方案`,
            }),
          ]),
          h('div', { class: 'sub', text: p.description || '无描述' }),
          h('div', { class: 'sub', text: venue ? `场地：${venue.name}（${venue.room.length}×${venue.room.width}×${venue.room.height}m）` : '尚未建立场地' }),
          h('div', { class: 'sub', text: `更新于 ${new Date(p.updatedAt).toLocaleString('zh-CN')}` }),
          h('div', { class: 'btn-row', style: 'margin-top:10px' }, [
            h('button', {
              class: 'btn ghost small',
              text: '复制项目',
              onclick: (e: Event) => {
                e.stopPropagation();
                duplicateProject(p.id);
              },
            }),
            h('button', {
              class: 'btn danger small',
              text: '删除',
              onclick: (e: Event) => {
                e.stopPropagation();
                if (confirm(`确认删除项目「${p.name}」及其全部方案？`)) deleteProject(p.id);
              },
            }),
          ]),
        ]),
      );
    }
    content.append(grid);
  };

  function renderAll() {
    renderSidebar();
    renderContent();
  }

  function openCreateDialog() {
    const nameInput = h('input', { value: `剧场项目 ${store.listProjects().length + 1}` }) as HTMLInputElement;
    const descInput = h('textarea', { rows: '3', placeholder: '项目说明（可选）' }) as HTMLTextAreaElement;
    const backdrop = h('div', { class: 'modal-backdrop' }, [
      h('div', { class: 'modal' }, [
        h('h2', { text: '新建项目' }),
        h('label', { class: 'field' }, [h('span', { text: '项目名称' }), nameInput]),
        h('label', { class: 'field' }, [h('span', { text: '项目描述' }), descInput]),
        h('div', { class: 'btn-row right' }, [
          h('button', { class: 'btn ghost', text: '取消', onclick: () => backdrop.remove() }),
          h('button', {
            class: 'btn',
            text: '创建并进入场地建模',
            onclick: () => {
              const project = createProject(nameInput.value.trim() || '未命名项目', descInput.value);
              const venue = createVenue(`${project.name} 场地`);
              const layout = createLayout(venue.id, '方案 A');
              project.venueId = venue.id;
              project.layoutIds = [layout.id];
              store.mutate((db) => {
                db.projects[project.id] = project;
                db.venues[venue.id] = venue;
                db.layouts[layout.id] = layout;
              });
              backdrop.remove();
              toast('项目已创建');
              router.go({ name: 'venue', projectId: project.id });
            },
          }),
        ]),
      ]),
    ]);
    document.body.append(backdrop);
  }

  function duplicateProject(id: string) {
    const src = store.state.projects[id];
    if (!src) return;
    store.mutate((db) => {
      const project = createProject(src.name + ' 副本', src.description);
      project.venueId = src.venueId;
      if (src.venueId && db.venues[src.venueId]) {
        const vSrc = db.venues[src.venueId];
        const venue = structuredClone(vSrc);
        venue.id = 'venue_' + Math.random().toString(36).slice(2, 10);
        venue.name = vSrc.name + ' 副本';
        for (const lid of src.layoutIds) {
          const lSrc = db.layouts[lid];
          if (!lSrc) continue;
          const layout = structuredClone(lSrc);
          layout.id = 'lay_' + Math.random().toString(36).slice(2, 10);
          layout.venueId = venue.id;
          layout.name = lSrc.name + ' 副本';
          db.layouts[layout.id] = layout;
          project.layoutIds.push(layout.id);
        }
        db.venues[venue.id] = venue;
        project.venueId = venue.id;
      }
      db.projects[project.id] = project;
    });
    toast('项目已复制');
    renderAll();
  }

  function deleteProject(id: string) {
    store.mutate((db) => {
      const p = db.projects[id];
      if (!p) return;
      for (const lid of p.layoutIds) delete db.layouts[lid];
      if (p.venueId) delete db.venues[p.venueId];
      delete db.projects[id];
    });
    toast('项目已删除');
    renderAll();
  }

  renderAll();
}
