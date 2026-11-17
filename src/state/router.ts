// hash 路由：#/projects | venue | layout | analysis | report
export type Route = 'projects' | 'venue' | 'layout' | 'analysis' | 'report';

const VALID: Route[] = ['projects', 'venue', 'layout', 'analysis', 'report'];

export function currentRoute(): Route {
  const raw = location.hash.replace(/^#\//, '') as Route;
  return VALID.includes(raw) ? raw : 'projects';
}

export function navigate(route: Route): void {
  location.hash = `#/${route}`;
}

export function onRouteChange(fn: (r: Route) => void): () => void {
  const handler = () => fn(currentRoute());
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}
