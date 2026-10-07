/** Small DOM helpers shared by the frontend screens. */
import { h } from '../../menus/dom';
import { screens } from '../../registry';
import { navigate } from '../../router';

export { h };

/** Go to a screen owned by another area; a friendly placeholder if it isn't registered yet. */
export function go(id: string, params: Record<string, string> = {}): void {
  if (screens.has(id)) navigate(id, params);
  else navigate('frontend.soon', { what: id });
}

/** Prestige emblem slot: the progression feature's emblem id, or a prestige number badge. */
export function emblem(prestige: number, emblemId: string | null = null, big = false): HTMLElement {
  const label = prestige > 0 ? String(prestige) : '·';
  return h('span', { class: `fe-emblem${prestige > 0 ? '' : ' p0'}${big ? ' big' : ''}`, title: emblemId ?? (prestige > 0 ? `Prestige ${prestige}` : 'No prestige'), 'data-emblem': emblemId ?? '' }, label);
}

/** A segmented control. `get` is read on every `update()`. */
export function seg<T extends string>(opts: readonly [T, string][], get: () => T, set: (v: T) => void, label = ''): HTMLElement & { update(disabled?: boolean): void } {
  const wrap = h('div', { class: 'fe-seg', role: 'group', 'aria-label': label }) as unknown as HTMLElement & { update(disabled?: boolean): void };
  const btns = opts.map(([v, text]) => {
    const b = h('button', { type: 'button', onclick: () => set(v) }, text);
    return [v, b] as const;
  });
  wrap.append(...btns.map(([, b]) => b));
  wrap.update = (disabled = false) => {
    const cur = get();
    for (const [v, b] of btns) {
      b.setAttribute('aria-pressed', String(v === cur));
      b.disabled = disabled;
    }
  };
  wrap.update();
  return wrap;
}

/**
 * A range slider with a value label. `update()` refreshes from `get` unless the user is dragging
 * it (so lobby pushes don't fight the host's hand).
 */
export function slider(min: number, max: number, step: number, get: () => number, set: (v: number, final: boolean) => void, fmt: (v: number) => string, label: string): HTMLElement & { update(disabled?: boolean): void } {
  const val = h('span', { class: 'val' });
  const input = h('input', { type: 'range', min, max, step, 'aria-label': label });
  const wrap = h('div', { class: 'fe-range' }, input, val) as unknown as HTMLElement & { update(disabled?: boolean): void };
  let dragging = false;
  input.addEventListener('pointerdown', () => (dragging = true));
  input.addEventListener('pointerup', () => (dragging = false));
  input.addEventListener('input', () => {
    val.textContent = fmt(Number(input.value));
    set(Number(input.value), false);
  });
  input.addEventListener('change', () => {
    dragging = false;
    set(Number(input.value), true);
  });
  wrap.update = (disabled = false) => {
    input.disabled = disabled;
    if (dragging) return;
    const v = get();
    input.value = String(v);
    val.textContent = fmt(v);
  };
  wrap.update();
  return wrap;
}

/** `fn` at most once per `ms`, with the last call always delivered. */
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: A | null = null;
  return (...a: A) => {
    last = a;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (last) fn(...last);
    }, ms);
  };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: 'position:fixed;left:-9999px' }, text);
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export const errText = (err: unknown) => (err instanceof Error ? err.message.replace(/^[a-z_]+: /, '') : String(err));

export function fmtTime(sec: number): string {
  if (sec <= 0) return 'Unlimited';
  return sec % 60 === 0 ? `${sec / 60} min` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
