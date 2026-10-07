/**
 * STORE screen (`store`, params: tab?): spend CoD Points on weapons, attachments, camos, reticles
 * and emblem backgrounds. Lock states come from the shared rules (defs/store.ts); the server
 * validates every purchase (`economy.buy`) and equips (`economy.equip`).
 */
import { CAMO_BY_ID } from '../../../shared/defs/camos';
import { EMBLEM_BACKGROUND_BY_ID, gateReason, LOCK_TEXT, lockReason, owns, RETICLE_BY_ID, storeCatalog, type StoreItem, type StoreKind } from '../../../shared/defs/store';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import { hashString } from '../../../shared/math';
import type { Profile } from '../../../shared/profile';
import { h } from '../../menus/dom';
import { net } from '../../net';
import { registerScreen } from '../../registry';
import { back } from '../../router';
import { cnv, ctx2d, makeRand } from '../../render/developer';
import { camoPreview } from './camos';
import { drawEmblemBackground, drawReticle } from './paint';

const TABS: { id: StoreKind; label: string }[] = [
  { id: 'weapon', label: 'Weapons' },
  { id: 'attachment', label: 'Attachments' },
  { id: 'camo', label: 'Camos' },
  { id: 'reticle', label: 'Reticles' },
  { id: 'emblem', label: 'Emblems' },
];

const CLASS_NAMES: Record<string, string> = { ar: 'Assault', smg: 'SMG', lmg: 'LMG', sniper: 'Sniper', shotgun: 'Shotgun', pistol: 'Pistol', launcher: 'Launcher', special: 'Special' };

export const cp = (n: number) => `${Math.round(n).toLocaleString('en-US')} CP`;

function equipped(p: Profile | null) {
  const e = (p?.ext.economy ?? {}) as { equipped?: { reticle?: string; emblem?: string } };
  return { reticle: e.equipped?.reticle ?? 'dot', emblem: e.equipped?.emblem ?? 'plain' };
}

/** Preview canvas for a store item (camo swatch, reticle, emblem background, weapon plate). */
export function itemPreview(item: StoreItem, size = 56): HTMLCanvasElement {
  if (item.kind === 'camo') return camoPreview(item.id, size);
  const c = cnv(size, size);
  const g = ctx2d(c);
  g.imageSmoothingEnabled = false;
  if (item.kind === 'reticle') {
    const r = RETICLE_BY_ID.get(item.id)!;
    g.fillStyle = '#1a1d1a';
    g.fillRect(0, 0, size, size);
    drawReticle(g, size / 2, size / 2, size * 0.55, r.shape, r.color);
  } else if (item.kind === 'emblem') {
    drawEmblemBackground(g, size, size, EMBLEM_BACKGROUND_BY_ID.get(item.id)!, makeRand(hashString(item.id)));
  } else {
    const w = WEAPON_BY_ID.get(item.weapon ?? item.id);
    g.fillStyle = '#20232a';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#ece2ce';
    g.font = `${Math.round(size / 4)}px Silkscreen, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const label = item.kind === 'attachment' ? item.id.slice(0, 5).toUpperCase() : (w?.name ?? item.id).replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase();
    g.fillText(label, size / 2, size / 2);
    g.fillStyle = '#ffd84a';
    g.fillRect(4, size - 6, size - 8, 2);
  }
  return c;
}

function unlockText(item: StoreItem): string {
  const u = item.unlock;
  const parts: string[] = [];
  if (u.prestige) parts.push(`Prestige ${u.prestige}`);
  if (u.level && u.level > 1) parts.push(`Level ${u.level}`);
  if (u.weaponKills) parts.push(`${u.weaponKills} kills`);
  if (u.challenge) parts.push('Challenge');
  return parts.join(' + ');
}

registerScreen('store', (root, params) => {
  let tab: StoreKind = (TABS.find((t) => t.id === params.tab)?.id ?? 'weapon') as StoreKind;
  let busy = false;
  const balance = h('span', { class: 'lf-chip ec-balance' });
  const status = h('div', { class: 'lf-status', role: 'status', 'aria-live': 'polite' });
  const tabs = h('div', { class: 'lf-seg', role: 'tablist' });
  const grid = h('div', { class: 'ec-grid' });

  const render = () => {
    const p = net.profile;
    balance.replaceChildren(h('b', {}, p ? cp(p.codPoints) : '-'));
    tabs.replaceChildren(
      ...TABS.map((t) =>
        h('button', { type: 'button', role: 'tab', 'aria-pressed': String(t.id === tab), 'aria-selected': String(t.id === tab), onclick: () => ((tab = t.id), render()) }, t.label),
      ),
    );
    const items = storeCatalog().filter((i) => i.kind === tab);
    const eq = equipped(p);
    grid.replaceChildren(
      ...items.map((item) => {
        const owned = p ? owns(p, item) : false;
        const reason = p ? lockReason(p, item.key) : 'unknown';
        const gate = p ? gateReason(p, item) : null;
        const isEquipped = (item.kind === 'reticle' && eq.reticle === item.id) || (item.kind === 'emblem' && eq.emblem === item.id);
        const meta: (string | Node)[] = [];
        if (item.kind === 'weapon') {
          const w = WEAPON_BY_ID.get(item.id);
          if (w) meta.push(CLASS_NAMES[w.class] ?? w.class);
        }
        if (item.kind === 'camo' && CAMO_BY_ID.get(item.id)?.tier === 'special') meta.push('Special');
        const unlock = unlockText(item);
        if (unlock) meta.push(unlock);
        let action: HTMLElement;
        if (owned) {
          if ((item.kind === 'reticle' || item.kind === 'emblem') && !gate)
            action = h('button', { class: 'lf-btn small', type: 'button', disabled: isEquipped, onclick: () => equip(item) }, isEquipped ? 'Equipped' : 'Equip');
          else action = h('span', { class: 'ec-tag owned' }, gate ? LOCK_TEXT[gate] : item.free ? 'Starter' : 'Owned');
        } else if (reason === null) action = h('button', { class: 'lf-btn small primary', type: 'button', onclick: () => buy(item) }, `Buy ${cp(item.price)}`);
        else action = h('span', { class: `ec-tag ${reason === 'funds' ? 'warn' : ''}` }, reason === 'funds' ? `${cp(item.price)}: ${LOCK_TEXT.funds}` : LOCK_TEXT[reason ?? 'unknown']);
        return h(
          'div',
          { class: `ec-card${owned ? ' owned' : ''}${reason && reason !== 'owned' && reason !== 'funds' ? ' locked' : ''}` },
          itemPreview(item),
          h('div', { class: 'ec-card-body' }, h('div', { class: 'ec-name' }, item.name), h('div', { class: 'ec-meta' }, meta.join(' · ') || ' '), h('div', { class: 'ec-price' }, owned ? '' : item.price ? cp(item.price) : 'Free'), action),
        );
      }),
    );
  };

  const buy = async (item: StoreItem) => {
    if (busy) return;
    busy = true;
    status.textContent = `Buying ${item.name}...`;
    try {
      const res = await net.rpc('economy.buy', { item: item.key });
      if (net.profile) {
        net.profile.codPoints = res.codPoints;
        net.profile.owned = res.owned;
      }
      status.textContent = `Bought ${item.name}`;
    } catch (err) {
      status.textContent = err instanceof Error ? err.message.replace(/^\w+: /, '') : 'Purchase failed';
    } finally {
      busy = false;
      render();
    }
  };

  const equip = async (item: StoreItem) => {
    try {
      const res = await net.rpc('economy.equip', { kind: item.kind === 'reticle' ? 'reticle' : 'emblem', id: item.id });
      if (net.profile) {
        const e = (net.profile.ext.economy ??= {}) as { equipped?: unknown };
        e.equipped = res.equipped;
      }
      status.textContent = `Equipped ${item.name}`;
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'Could not equip';
    }
    render();
  };

  root.append(
    h(
      'div',
      { class: 'lf-page lf-bg ec-page' },
      h('div', { class: 'lf-row ec-head' }, h('button', { class: 'lf-btn small', type: 'button', onclick: () => back(params) }, 'Back'), h('h2', { class: 'lf-h2' }, 'Store'), h('div', { class: 'lf-spacer' }), balance),
      h('div', { class: 'lf-hint' }, 'Weapons unlock by level, then cost CoD Points. Attachments are bought per weapon. Camos work on every gun; pick them per weapon in Create-a-Class.'),
      tabs,
      status,
      grid,
    ),
  );
  render();
  const offs = [net.on('profile', () => render()), net.on('welcome', () => render()), net.onStatus(() => render())];
  return () => offs.forEach((f) => f());
});
