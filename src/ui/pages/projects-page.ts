import { h, mount, button, toast } from '../dom';
import { store } from '../../state/store';
import { navigate } from '../../state/router';
import { db } from '../../state/storage';
import { defaultVenue } from '../../core/seed';
import { uid } from '../../core/math/vec3';
import type { Project } from '../../core/types';

export function renderProjectsPage(root: HTMLElement): void {
  const state = store.state;
  const createProject = () => {
    const now = Date.now();
    const project: Project = {
      id: uid('proj'),
      name: `新建项目 ${state.projects.length + 1}`,
      description: '',
      createdAt: now,
      updatedAt: now,
      venue: defaultVenue(),
      layoutIds: []
    };
    db.saveProject(project).then(async () => {
      await store.init();
      await store.openProject(project.id);
      navigate('venue');
      toast('项目已创建');
    });
  };

  const removeProject = (p: Project) => {
    if (!confirm(`确认删除项目「${p.name}」？其下全部布置方案将一并删除。`)) return;
    db.deleteProject(p.id).then(async () => {
      await store.init();
      toast('项目已删除');
    });
  };

  const exportData = () => {
    db.exportAll().then((json) => {
      const blob = new Blob([json], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `sr-design-backup-${Date.now()}.json` });
      a.click();
      URL.revokeObjectURL(a.href);
    });
  };

  const importData = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      db.importAll(String(reader.result)).then(async () => {
        await store.init();
        toast('数据导入完成');
      }).catch(() => toast('导入失败：文件格式不正确', 'err'));
    };
    reader.readAsText(file);
  };

  const cards = state.projects.map((p) =>
    h('div', { class: 'project-card', onclick: () => store.openProject(p.id).then(() => navigate('venue')) },
      h('h3', {}, p.name),
      h('div', { class: 'meta' },
        h('div', {}, `场地：${p.venue.width}m × ${p.venue.length}m × ${p.venue.height}m`),
        h('div', {}, `布置方案：${p.layoutIds.length} 套`),
        h('div', {}, `更新：${new Date(p.updatedAt).toLocaleString('zh-CN')}`),
        p.description ? h('div', { style: { marginTop: '6px', color: 'var(--fg)' } }, p.description) : null
      ),
      h('div', { style: { marginTop: '12px', display: 'flex', gap: '8px' } },
        button('打开', () => store.openProject(p.id).then(() => navigate('venue')), 'primary'),
        button('删除', () => removeProject(p), 'danger')
      )
    )
  );

  mount(root,
    h('div', { class: 'toolbar', style: { marginBottom: '16px', justifyContent: 'space-between' } },
      h('div', { style: { display: 'flex', gap: '8px' } },
        button('+ 新建项目', createProject, 'primary'),
        h('label', { class: 'btn' }, '导入备份',
          h('input', { type: 'file', accept: '.json', style: { display: 'none' }, onchange: (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) importData(f); } })
        )
      ),
      button('导出全部数据', exportData)
    ),
    h('div', { class: 'grid-3' }, ...cards),
    state.projects.length === 0 ? h('p', { class: 'muted' }, '暂无项目，点击「新建项目」开始。') : null
  );
}
