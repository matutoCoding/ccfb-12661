// 极简 hyperscript + 状态订阅，避免引入框架依赖
export type El = HTMLElement;

type Child = El | string | number | false | null | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'dataset' && typeof v === 'object') {
      Object.assign(el.dataset, v);
    } else if (v === true) {
      el.setAttribute(k, '');
    } else if (v !== false && v != null) {
      el.setAttribute(k, String(v));
    }
  }
  for (const child of children.flat()) {
    if (child === false || child == null) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el: El): void {
  el.replaceChildren();
}

export function mount(el: El, ...nodes: Child[]): void {
  el.replaceChildren();
  for (const n of nodes.flat()) if (n != null && n !== false) el.append(n instanceof Node ? n : document.createTextNode(String(n)));
}

export function labeled(label: string, control: El): El {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control);
}

export function numInput(value: number, onInput: (v: number) => void, step = 1, min?: number, max?: number): HTMLInputElement {
  const input = h('input', {
    type: 'number',
    value: String(value),
    step: String(step),
    ...(min != null ? { min: String(min) } : {}),
    ...(max != null ? { max: String(max) } : {}),
    oninput: () => {
      const v = parseFloat(input.value);
      if (!Number.isNaN(v)) onInput(v);
    }
  }) as HTMLInputElement;
  return input;
}

export function textInput(value: string, onInput: (v: string) => void): HTMLInputElement {
  const input = h('input', {
    type: 'text',
    value,
    oninput: () => onInput(input.value)
  }) as HTMLInputElement;
  return input;
}

export function selectInput(options: { value: string; label: string }[], value: string, onChange: (v: string) => void): HTMLSelectElement {
  const sel = h('select', {
    onchange: () => onChange(sel.value)
  }) as HTMLSelectElement;
  for (const o of options) {
    sel.append(h('option', { value: o.value, ...(o.value === value ? { selected: true } : {}) }, o.label));
  }
  return sel;
}

export function button(label: string, onClick: () => void, kind: 'primary' | 'ghost' | 'danger' = 'ghost'): HTMLButtonElement {
  return h('button', { class: `btn btn-${kind}`, onclick: onClick }, label) as HTMLButtonElement;
}

export function badge(text: string, tone: 'ok' | 'warn' | 'bad' | 'info' = 'info'): El {
  return h('span', { class: `badge badge-${tone}` }, text);
}

export function table(headers: string[], rows: (string | number | El)[][], opts: { cellClass?: (r: number, c: number) => string | undefined } = {}): El {
  const thead = h('thead', {}, h('tr', {}, ...headers.map((x) => h('th', {}, x))));
  const tbody = h('tbody', {});
  rows.forEach((row, r) => {
    const tr = h('tr', {});
    row.forEach((cell, c) => {
      const td = h('td', opts.cellClass ? { class: opts.cellClass(r, c) ?? '' } : {}, cell as Child);
      tr.append(td);
    });
    tbody.append(tr);
  });
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' }, thead, tbody));
}

export function section(title: string, ...children: Child[]): El {
  return h('section', { class: 'panel' }, h('h3', { class: 'panel-title' }, title), ...children);
}

export function toast(message: string, tone: 'ok' | 'err' = 'ok'): void {
  const t = h('div', { class: `toast toast-${tone}` }, message);
  document.body.append(t);
  setTimeout(() => { t.classList.add('show'); }, 10);
  setTimeout(() => { t.remove(); }, 2600);
}
