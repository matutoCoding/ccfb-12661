import { store } from './state/store';
import { router } from './ui/router';
import { h } from './ui/dom';
import './ui/styles.css';

async function bootstrap(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) throw new Error('缺少 #app 挂载点');
  const loading = h('div', {
    style: 'display:flex;height:100vh;align-items:center;justify-content:center;color:#93a0b2',
    text: '正在加载本地声学数据库…',
  });
  app.append(loading);
  try {
    await store.init();
  } catch (err) {
    loading.textContent = '初始化失败：' + (err as Error).message;
    return;
  }
  loading.remove();
  router.attach(app);
}

void bootstrap();
