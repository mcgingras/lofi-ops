/**
 * STORE screen (`store`, params: tab?, gun?): spend CoD Points.
 *
 * - Weapons (BO1 style): guns grouped by class with a quick search; each row shows the gun, owned
 *   state or price / unlock level and "n/m attachments owned". Picking a gun opens its page: a live
 *   3D turntable, stats, the gun's own Buy, then its attachments (name, description, unlock state,
 *   price, Buy). Back (or B / Esc) returns to the list.
 * - Camos (global: bought once, every gun), Reticles, Emblems: card grids.
 *
 * The browsing model is pure (`shared/frontend/store-browse.ts`); lock states come from the store
 * rules (defs/store.ts) and the server validates every purchase (`economy.buy`) and equip
 * (`economy.equip`). Every card and row keeps one focusable action (Buy / Owned / Locked...) under
 * a stable `data-k`, so controller focus survives a purchase.
 */
import { CAMO_BY_ID } from '../../../shared/defs/camos';
import { EMBLEM_BACKGROUND_BY_ID, gateReason, LOCK_TEXT, lockReason, owns, RETICLE_BY_ID, storeCatalog, type StoreItem } from '../../../shared/defs/store';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import { STAT_LABELS, weaponStats, type WeaponStats } from '../../../shared/frontend/loadout-rules';
import {
  attachmentCountLabel,
  filterGunGroups,
  groupLabel,
  gunPageFocusKey,
  storeGun,
  storeGunGroups,
  type BrowseAttachment,
  type BrowseGun,
  type BrowseItem,
} from '../../../shared/frontend/store-browse';
import { hashString } from '../../../shared/math';
import type { Profile } from '../../../shared/profile';
import { h } from '../../menus/dom';
import { net } from '../../net';
import { registerScreen } from '../../registry';
import { back } from '../../router';
import { cnv, ctx2d, makeRand } from '../../render/developer';
import { WeaponPreview } from '../frontend/preview';
import { camoPreview } from './camos';
import { gunThumb, releaseGunThumbs } from './gun-thumbs';
import { drawEmblemBackground, drawReticle } from './paint';

type Tab = 'weapon' | 'camo' | 'reticle' | 'emblem';

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'weapon', label: 'Weapons', hint: 'Pick a gun to see its attachments. Guns unlock by level, then cost CoD Points; attachments are bought per gun.' },
  { id: 'camo', label: 'Camos', hint: 'Camos are bought once and work on every gun. Pick one per weapon in Create-a-Class.' },
  { id: 'reticle', label: 'Reticles', hint: 'Reticles show in red dot, reflex and ACOG sights. Buy one, then equip it.' },
  { id: 'emblem', label: 'Emblems', hint: 'Emblem backgrounds show behind your emblem in lobbies. Buy one, then equip it.' },
];

const SLOT_NAMES: Record<string, string> = { optic: 'Optic', muzzle: 'Muzzle', underbarrel: 'Underbarrel', magazine: 'Magazine', other: 'Other' };

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

/** Short state line for a gun row in the list. */
function gunRowState(g: BrowseGun): { text: string; cls: string } {
  if (g.state === 'owned') return g.usable ? { text: g.item.free && !g.item.price ? 'Starter' : 'Owned', cls: 'ok' } : { text: `Owned · ${g.requirement}`, cls: 'warn' };
  if (g.state === 'buy') return { text: cp(g.item.price), cls: 'hi' };
  if (g.state === 'funds') return { text: cp(g.item.price), cls: 'warn' };
  return { text: g.requirement ?? 'Locked', cls: 'lock' };
}

registerScreen('store', (root, params) => {
  let tab: Tab = params.tab === 'attachment' ? 'weapon' : (TABS.find((t) => t.id === params.tab)?.id ?? 'weapon');
  let gunId: string | null = tab === 'weapon' && params.gun ? params.gun : null;
  let query = '';
  let busy = false;
  let justBought: string | null = null;
  let listScroll = 0;
  let preview: WeaponPreview | null = null;
  let previewGun = '';
  let hoverAtt: string | null = null;

  // ---- persistent chrome ------------------------------------------------------------------
  const balance = h('span', { class: 'lf-chip ec-balance' });
  const status = h('div', { class: 'lf-status', role: 'status', 'aria-live': 'polite' });
  const backBtn = h('button', { class: 'lf-btn small', type: 'button', 'data-pad-back': true, onclick: () => goBack() }, 'Back');
  const crumbs = h('nav', { class: 'ec-crumbs', 'aria-label': 'Breadcrumb' });
  // Built once (padnav's LB/RB focuses the tab it clicked, so it must survive a render).
  const tabButtons = TABS.map((x) => h('button', { type: 'button', role: 'tab', 'data-k': `tab:${x.id}`, onclick: () => openTab(x.id) }, x.label));
  const tabs = h('div', { class: 'lf-seg ec-tabs', role: 'tablist' }, ...tabButtons);
  const hint = h('div', { class: 'lf-hint' });

  const search = h('input', { class: 'ec-search', type: 'search', placeholder: 'Search guns', 'aria-label': 'Search guns', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  search.addEventListener('input', () => {
    query = search.value;
    renderList();
  });
  const searchCount = h('span', { class: 'ec-dim' });
  const groupsBox = h('div', { class: 'ec-groups' });
  const listView = h('div', { class: 'ec-view' }, h('div', { class: 'ec-search-row' }, search, searchCount), groupsBox);

  const previewBox = h('div', { class: 'ec-preview' });
  const gunInfo = h('div', { class: 'ec-gun-info' });
  const attBox = h('div', { class: 'ec-atts' });
  const gunView = h(
    'div',
    { class: 'ec-view' },
    h('div', { class: 'ec-gun-top' }, previewBox, gunInfo),
    attBox,
    h('div', { class: 'ec-camo-note' }, h('span', {}, 'Camos are bought once and work on every gun.'), h('button', { class: 'lf-btn small', type: 'button', 'data-k': 'tab:camo', onclick: () => openTab('camo') }, 'Browse camos')),
  );
  const grid = h('div', { class: 'ec-grid' });

  // ---- focus helpers ----------------------------------------------------------------------
  const focusedKey = (): string | null => {
    const a = document.activeElement as HTMLElement | null;
    return a && root.contains(a) ? (a.dataset.k ?? null) : null;
  };
  const focusKey = (k: string | null): boolean => {
    if (!k) return false;
    const el = root.querySelector<HTMLElement>(`[data-k="${CSS.escape(k)}"]`);
    if (!el || el.closest('[hidden]')) return false;
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest' });
    return true;
  };
  const scroller = () => root; // #screen scrolls

  // ---- navigation -------------------------------------------------------------------------
  const openGun = (id: string) => {
    listScroll = scroller().scrollTop;
    gunId = id;
    hoverAtt = null;
    justBought = null;
    status.textContent = '';
    render();
    scroller().scrollTop = 0;
    const gun = storeGun(net.profile, id);
    if (gun) focusKey(gunPageFocusKey(gun));
  };
  const closeGun = () => {
    const from = gunId;
    gunId = null;
    justBought = null;
    status.textContent = '';
    disposePreview();
    render();
    scroller().scrollTop = listScroll;
    if (!focusKey(`gun:${from}`)) focusKey('search');
  };
  const openTab = (t: Tab) => {
    if (gunId) {
      gunId = null;
      disposePreview();
    }
    tab = t;
    justBought = null;
    status.textContent = '';
    render();
    scroller().scrollTop = 0;
  };
  const goBack = () => (gunId ? closeGun() : back(params));

  const disposePreview = () => {
    preview?.dispose();
    preview = null;
    previewGun = '';
    previewBox.replaceChildren();
  };

  // ---- actions ----------------------------------------------------------------------------
  const say = (text: string, warn = false) => {
    status.textContent = text;
    status.classList.toggle('warn', warn);
  };

  const buy = async (item: StoreItem, label = item.name) => {
    if (busy) return;
    busy = true;
    say(`Buying ${label}...`);
    try {
      const res = await net.rpc('economy.buy', { item: item.key });
      if (net.profile) {
        net.profile.codPoints = res.codPoints;
        net.profile.owned = res.owned;
      }
      justBought = item.key;
      say(`Bought ${label}`);
    } catch (err) {
      say(err instanceof Error ? err.message.replace(/^\w+: /, '') : 'Purchase failed', true);
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
      say(`Equipped ${item.name}`);
    } catch (err) {
      say(err instanceof Error ? err.message : 'Could not equip', true);
    }
    render();
  };

  /** The one action button of a gun or attachment (always focusable, so focus survives a purchase). */
  const actionButton = (b: BrowseItem, label: string) => {
    const k = b.item.key;
    const base = { type: 'button', 'data-k': k, class: 'lf-btn small ec-act' } as const;
    switch (b.state) {
      case 'buy':
        return h('button', { ...base, class: `${base.class} primary`, onclick: () => buy(b.item, label) }, `Buy ${cp(b.item.price)}`);
      case 'owned':
        return h('button', { ...base, class: `${base.class} owned`, 'aria-disabled': 'true', onclick: () => say(b.usable ? `${label}: owned` : `${label}: owned, ${b.requirement} to use`, !b.usable) }, b.usable ? (b.item.free && !b.item.price ? 'Starter' : 'Owned') : 'Owned');
      case 'funds':
        return h('button', { ...base, class: `${base.class} warn`, 'aria-disabled': 'true', onclick: () => say(`${label}: ${LOCK_TEXT.funds} (${b.requirement})`, true) }, cp(b.item.price));
      case 'locked':
        return h('button', { ...base, class: `${base.class} lock`, 'aria-disabled': 'true', onclick: () => say(`${label}: ${b.requirement ?? LOCK_TEXT[b.lock ?? 'unknown']}`, true) }, 'Locked');
    }
  };

  // ---- rendering --------------------------------------------------------------------------
  const renderHead = (gun: BrowseGun | null) => {
    const p = net.profile;
    balance.replaceChildren(h('b', {}, p ? cp(p.codPoints) : '-'));
    const t = TABS.find((x) => x.id === tab)!;
    const link = (label: string, fn: () => void) => h('span', { class: 'ec-crumb link', role: 'link', onclick: fn }, label);
    const parts: Node[] = [link('Store', () => openTab('weapon'))];
    if (gun) parts.push(link('Weapons', closeGun), h('span', { class: 'ec-crumb' }, groupLabel(gun.group)), h('span', { class: 'ec-crumb cur', 'aria-current': 'page' }, gun.name));
    else parts.push(h('span', { class: 'ec-crumb cur', 'aria-current': 'page' }, t.label));
    crumbs.replaceChildren(...parts);
    backBtn.textContent = gun ? 'Weapons' : 'Back';
    backBtn.setAttribute('aria-label', gun ? 'Back to weapons' : 'Back');
    tabs.hidden = !!gun;
    hint.hidden = !!gun;
    hint.textContent = t.hint;
    for (const b of tabButtons) {
      b.setAttribute('aria-pressed', String(b.dataset.k === `tab:${tab}`));
      b.setAttribute('aria-selected', String(b.dataset.k === `tab:${tab}`));
    }
  };

  const renderList = () => {
    const all = storeGunGroups(net.profile);
    const groups = filterGunGroups(all, query);
    const total = all.reduce((n, g) => n + g.guns.length, 0);
    const shown = groups.reduce((n, g) => n + g.guns.length, 0);
    searchCount.textContent = query.trim() ? `${shown}/${total} guns` : `${total} guns`;
    groupsBox.replaceChildren(
      ...(groups.length
        ? groups.map((g) =>
            h(
              'section',
              { class: 'ec-group', 'aria-label': g.label },
              h('h3', { class: 'ec-group-h' }, g.label, h('small', {}, `${g.guns.filter((x) => x.owned).length}/${g.guns.length} owned`)),
              h(
                'div',
                { class: 'ec-gun-list' },
                ...g.guns.map((gun) => {
                  const st = gunRowState(gun);
                  const pips = gun.attachments.map((a) => h('i', { class: a.owned ? 'on' : '' }));
                  return h(
                    'button',
                    { type: 'button', class: `ec-gun${gun.owned ? ' owned' : ''}${gun.state === 'locked' ? ' locked' : ''}`, 'data-k': `gun:${gun.id}`, onclick: () => openGun(gun.id), 'aria-label': `${gun.name}, ${st.text}, ${attachmentCountLabel(gun)}` },
                    gunThumb(gun.model, gun.name),
                    h('span', { class: 'ec-gun-main' }, h('span', { class: 'ec-name' }, gun.name), h('span', { class: `ec-state ${st.cls}` }, st.text)),
                    h('span', { class: 'ec-gun-atts' }, h('span', {}, attachmentCountLabel(gun)), gun.attachments.length ? h('span', { class: 'ec-pips' }, ...pips) : null),
                    h('span', { class: 'ec-chev', 'aria-hidden': 'true' }, '>'),
                  );
                }),
              ),
            ),
          )
        : [h('div', { class: 'ec-empty' }, `No guns match "${query.trim()}"`)]),
    );
  };

  const statBars = (base: WeaponStats, cmp: WeaponStats | null) =>
    h(
      'div',
      { class: 'ec-stats' },
      ...(Object.keys(STAT_LABELS) as (keyof WeaponStats)[]).flatMap((k) => {
        const a = base[k];
        const b = cmp ? cmp[k] : a;
        const lo = Math.min(a, b);
        const bar = h('span', { class: 'ec-stat', role: 'meter', 'aria-label': STAT_LABELS[k], 'aria-valuenow': b, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: `width:${lo}%` }));
        if (b !== a) bar.append(h('i', { class: b > a ? 'up' : 'down', style: `left:${lo}%;width:${Math.abs(b - a)}%` }));
        return [h('span', { class: 'ec-dim' }, STAT_LABELS[k]), bar, h('span', { class: `ec-stat-n${b > a ? ' up' : b < a ? ' down' : ''}` }, String(b))];
      }),
    );

  let statsHost: HTMLElement | null = null;
  const showAttachment = (gun: BrowseGun, att: BrowseAttachment | null) => {
    hoverAtt = att?.id ?? null;
    const def = WEAPON_BY_ID.get(gun.id);
    if (preview && def) preview.show(def.model, att ? [att.id] : [], 'none');
    if (statsHost && def) statsHost.replaceChildren(statBars(weaponStats(def), att ? weaponStats(def, [att.id]) : null));
  };

  const renderGun = (gun: BrowseGun) => {
    const def = WEAPON_BY_ID.get(gun.id)!;
    if (previewGun !== gun.id) {
      disposePreview();
      previewGun = gun.id;
      preview = new WeaponPreview(previewBox);
      if (!preview.ok) previewBox.append(h('div', { class: 'lf-center ec-dim' }, '3D preview unavailable'));
      previewBox.append(h('div', { class: 'ec-cap' }, gun.name, h('small', {}, groupLabel(gun.group))));
    }
    const hovered = gun.attachments.find((a) => a.id === hoverAtt) ?? null;
    statsHost = h('div', {});
    const stateLine = gun.state === 'owned' ? (gun.usable ? 'Owned' : `Owned · ${gun.requirement} to use`) : gun.state === 'buy' ? 'Available' : (gun.requirement ?? 'Locked');
    gunInfo.replaceChildren(
      h('h2', { class: 'ec-gun-title' }, gun.name),
      h('div', { class: 'ec-meta' }, [groupLabel(gun.group), gun.unlockLevel > 1 ? `Unlocks at level ${gun.unlockLevel}` : 'Unlocked from the start', gun.item.price ? cp(gun.item.price) : 'Free'].join(' · ')),
      ...(gun.blurb ? [h('p', { class: 'ec-blurb' }, gun.blurb)] : []),
      statsHost,
      h('div', { class: `ec-gun-buy${justBought === gun.item.key ? ' just' : ''}` }, h('span', { class: `ec-state ${gunRowState(gun).cls}` }, stateLine), actionButton(gun, gun.name)),
    );
    showAttachment(gun, hovered);

    attBox.replaceChildren(
      h('h3', { class: 'ec-group-h' }, 'Attachments', h('small', {}, attachmentCountLabel(gun))),
      ...(gun.attachments.length
        ? gun.attachments.map((a) => {
            const label = `${a.name} (${gun.name})`;
            const req =
              a.state === 'owned'
                ? a.usable
                  ? h('span', { class: 'ec-state ok' }, a.item.free && !a.item.price ? 'Starter' : 'Owned')
                  : h('span', { class: 'ec-state warn' }, `Owned · ${a.requirement} to use`)
                : a.lock === 'kills'
                  ? h('span', { class: 'ec-req' }, h('span', { class: 'ec-state lock' }, a.requirement ?? ''), h('span', { class: 'ec-kbar' }, h('i', { style: `width:${Math.round((100 * Math.min(a.kills.have, a.kills.need)) / Math.max(1, a.kills.need))}%` })))
                  : a.state === 'buy'
                    ? h('span', { class: 'ec-state hi' }, a.kills.need ? `Unlocked (${a.kills.need} kills)` : 'Available')
                    : h('span', { class: `ec-state ${a.state === 'funds' ? 'warn' : 'lock'}` }, a.requirement ?? LOCK_TEXT[a.lock ?? 'unknown']);
            const row = h(
              'div',
              { class: `ec-att${a.owned ? ' owned' : ''}${a.state === 'locked' ? ' locked' : ''}${justBought === a.item.key ? ' just' : ''}` },
              h('span', { class: 'ec-slot' }, SLOT_NAMES[a.slot ?? 'other'] ?? 'Other'),
              h('span', { class: 'ec-att-main' }, h('span', { class: 'ec-name' }, a.name), a.blurb ? h('span', { class: 'ec-att-blurb' }, a.blurb) : null, req),
              h('span', { class: 'ec-att-buy' }, h('span', { class: 'ec-price' }, a.item.price ? cp(a.item.price) : 'Free'), actionButton(a, label)),
            );
            const on = () => showAttachment(gun, a);
            const off = () => showAttachment(gun, null);
            row.addEventListener('pointerenter', on);
            row.addEventListener('pointerleave', off);
            row.addEventListener('focusin', on);
            row.addEventListener('focusout', off);
            return row;
          })
        : [h('div', { class: 'ec-empty' }, `The ${gun.name} takes no attachments.`)]),
    );
  };

  const renderGrid = () => {
    const p = net.profile;
    const items = storeCatalog().filter((i) => i.kind === tab);
    const eq = equipped(p);
    grid.replaceChildren(
      ...items.map((item) => {
        const owned = p ? owns(p, item) : false;
        const reason = p ? lockReason(p, item.key) : 'unknown';
        const gate = p ? gateReason(p, item) : null;
        const isEquipped = (item.kind === 'reticle' && eq.reticle === item.id) || (item.kind === 'emblem' && eq.emblem === item.id);
        const meta: string[] = [];
        if (item.kind === 'camo' && CAMO_BY_ID.get(item.id)?.tier === 'special') meta.push('Special');
        const unlock = unlockText(item);
        if (unlock) meta.push(unlock);
        const base = { type: 'button', 'data-k': item.key, class: 'lf-btn small ec-act' } as const;
        let action: HTMLElement;
        if (owned) {
          if ((item.kind === 'reticle' || item.kind === 'emblem') && !gate)
            action = isEquipped ? h('button', { ...base, class: `${base.class} owned`, 'aria-disabled': 'true' }, 'Equipped') : h('button', { ...base, onclick: () => equip(item) }, 'Equip');
          else action = h('button', { ...base, class: `${base.class} owned`, 'aria-disabled': 'true', onclick: () => gate && say(`${item.name}: ${LOCK_TEXT[gate]}`, true) }, gate ? LOCK_TEXT[gate] : item.free ? 'Starter' : 'Owned');
        } else if (reason === null) action = h('button', { ...base, class: `${base.class} primary`, onclick: () => buy(item) }, `Buy ${cp(item.price)}`);
        else action = h('button', { ...base, class: `${base.class} ${reason === 'funds' ? 'warn' : 'lock'}`, 'aria-disabled': 'true', onclick: () => say(`${item.name}: ${LOCK_TEXT[reason ?? 'unknown']}`, true) }, reason === 'funds' ? cp(item.price) : 'Locked');
        return h(
          'div',
          { class: `ec-card${owned ? ' owned' : ''}${reason && reason !== 'owned' && reason !== 'funds' ? ' locked' : ''}${justBought === item.key ? ' just' : ''}` },
          itemPreview(item),
          h(
            'div',
            { class: 'ec-card-body' },
            h('div', { class: 'ec-name' }, item.name),
            h('div', { class: 'ec-meta' }, meta.join(' · ') || ' '),
            h('div', { class: 'ec-price' }, owned ? '' : item.price ? cp(item.price) : 'Free'),
            reason && reason !== 'owned' && reason !== 'funds' ? h('div', { class: 'ec-state lock' }, LOCK_TEXT[reason]) : null,
            action,
          ),
        );
      }),
    );
  };

  /** Redraw the current view, keeping the focused control (by `data-k`) focused. */
  const render = () => {
    const keep = focusedKey();
    const gun = tab === 'weapon' && gunId ? storeGun(net.profile, gunId) : null;
    if (gunId && !gun && net.profile) gunId = null; // not sold (stale link)
    renderHead(gun);
    listView.hidden = !(tab === 'weapon' && !gun);
    gunView.hidden = !gun;
    grid.hidden = tab === 'weapon';
    if (gun) renderGun(gun);
    else if (tab === 'weapon') renderList();
    else renderGrid();
    if (keep && document.activeElement?.getAttribute('data-k') !== keep) focusKey(keep);
  };

  search.dataset.k = 'search';
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Escape') return;
    if (e.target === search && search.value) {
      search.value = '';
      query = '';
      renderList();
      return;
    }
    goBack();
  };
  addEventListener('keydown', onKey);

  root.append(
    h(
      'div',
      { class: 'lf-page lf-bg ec-page' },
      h('div', { class: 'ec-store-head' }, h('div', { class: 'lf-row ec-head-row' }, backBtn, h('h2', { class: 'lf-h2' }, 'Store'), crumbs, h('div', { class: 'lf-spacer' }), balance), status),
      tabs,
      hint,
      listView,
      gunView,
      grid,
    ),
  );
  render();
  if (gunId) {
    const gun = storeGun(net.profile, gunId);
    if (gun) requestAnimationFrame(() => focusKey(gunPageFocusKey(gun)));
  }
  const offs = [net.on('profile', () => render()), net.on('welcome', () => render()), net.onStatus(() => render())];
  return () => {
    offs.forEach((f) => f());
    removeEventListener('keydown', onKey);
    disposePreview();
    releaseGunThumbs();
  };
});
