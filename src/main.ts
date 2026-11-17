import './ui/styles.css';
import { store } from './state/store';
import { renderApp } from './ui/app';

async function bootstrap(): Promise<void> {
  const loading = document.createElement('div');
  loading.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#93a4b8;font-family:system-ui;font-size:14px;';
  loading.textContent = '正在初始化扩声设计工坊…';
  document.body.append(loading);
  try {
    await store.init();
    loading.remove();
    renderApp();
  } catch (err) {
    loading.textContent = '初始化失败：' + (err as Error).message;
  }
}

bootstrap();
