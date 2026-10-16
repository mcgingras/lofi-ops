/**
 * Create-a-class (screen 'create-a-class'): custom class slots, primary + attachments (one, two
 * with Warlord / an `attachmentSlots` perk), camo per weapon, secondary, lethal, tactical, one perk
 * per tier, three killstreaks sorted by kill count. Locked items show their unlock requirement.
 * A live 3D turntable preview of the weapon and stat bars (hover an item to compare). Every
 * change is validated locally with the same rules as the server, then saved (frontend.saveLoadout).
 */
import { ATTACHMENT_BY_ID } from '../../../shared/defs/attachments';
import { CAMOS, CAMO_BY_ID } from '../../../shared/defs/camos';
import { KILLSTREAKS, KILLSTREAK_BY_ID } from '../../../shared/defs/killstreaks';
import { PERKS, PERK_BY_ID } from '../../../shared/defs/perks';
import { WEAPONS, WEAPON_BY_ID, type WeaponClass } from '../../../shared/defs/weapons';
import { WAGER_ONLY_WEAPONS } from '../../../shared/defs/wager-weapons';
import { EQUIPMENT, EQUIPMENT_BY_ID } from '../../../shared/frontend/equipment';
import { attachmentSlotsFor, canEditClasses, classSlotsFor, itemLock, STAT_LABELS, validateLoadout, weaponStats, type ItemKind, type WeaponStats } from '../../../shared/frontend/loadout-rules';
import { cloneLoadout, DEFAULT_LOADOUTS, type Loadout, type WeaponLoadout } from '../../../shared/loadout';
import type { Profile } from '../../../shared/profile';
import { net } from '../../net';
import { registerScreen } from '../../registry';
import { back } from '../../router';
import { WeaponPreview } from './preview';
import { debounce, errText, h } from './ui';

type Section = 'name' | 'primary' | 'primaryAtt' | 'primaryCamo' | 'secondary' | 'secondaryAtt' | 'secondaryCamo' | 'lethal' | 'tactical' | 'perk1' | 'perk2' | 'perk3' | 'streaks';

const CLASS_NAMES: Record<WeaponClass, string> = { ar: 'Assault rifles', smg: 'Submachine guns', lmg: 'Light machine guns', sniper: 'Sniper rifles', shotgun: 'Shotguns', pistol: 'Pistols', launcher: 'Launchers', special: 'Specials' };
const wName = (id: string) => WEAPON_BY_ID.get(id)?.name ?? id;
const camoColor = (id: string) => {
  const c = CAMO_BY_ID.get(id)?.recipe?.colors?.[0];
  return c === undefined ? 'transparent' : `#${c.toString(16).padStart(6, '0')}`;
};

registerScreen('create-a-class', (root, params) => {
  let profile: Profile | null = net.profile;
  let idx = profile ? Math.min(profile.selectedLoadout, profile.loadouts.length - 1) : 0;
  let work: Loadout = profile ? cloneLoadout(profile.loadouts[idx] ?? DEFAULT_LOADOUTS[0]!) : cloneLoadout(DEFAULT_LOADOUTS[0]!);
  let section: Section = 'primary';
  let hover: WeaponLoadout | null = null;
  let saving = false;

  const status = h('div', { class: 'lf-status', role: 'status' });
  const classList = h('div', { class: 'fe-list' });
  const rows = h('div', { class: 'fe-rows' });
  const previewBox = h('div', { class: 'fe-preview' });
  const caption = h('div', { class: 'cap' });
  previewBox.append(caption);
  const stats = h('div', { class: 'fe-stats' });
  const picker = h('div', { class: 'fe-picker' });
  const preview = new WeaponPreview(previewBox);
  if (!preview.ok) previewBox.append(h('div', { class: 'lf-center fe-small fe-dim' }, '3D preview unavailable'));

  const lock = (kind: ItemKind, id: string, weapon: string | null = null) => (profile ? itemLock(profile, kind, id, weapon) : { unlocked: true, requirement: null });

  // ---- saving ------------------------------------------------------------------------------
  const save = debounce(async () => {
    if (!profile) return;
    if (!canEditClasses(profile)) {
      status.textContent = 'Create-a-Class unlocks at level 4. Until then you spawn with the default classes.';
      status.classList.add('warn');
      return;
    }
    saving = true;
    status.textContent = 'Saving...';
    try {
      const res = await net.rpc('frontend.saveLoadout', { index: idx, loadout: work });
      if (net.profile) net.profile.loadouts = res.loadouts;
      profile = net.profile;
      status.textContent = res.problems.length ? `Saved with changes: ${res.problems.join('; ')}` : 'Saved';
      status.classList.toggle('warn', res.problems.length > 0);
      renderClasses();
    } catch (err) {
      status.textContent = `Not saved: ${errText(err)}`;
      status.classList.add('warn');
    } finally {
      saving = false;
    }
  }, 350);

  const edit = (fn: (l: Loadout) => void) => {
    fn(work);
    if (profile) {
      const v = validateLoadout(profile, work);
      work = v.loadout;
      if (v.problems.length) status.textContent = v.problems.join('; ');
    }
    render();
    save();
  };

  // ---- class slots ---------------------------------------------------------------------------
  const renderClasses = () => {
    const p = profile;
    classList.replaceChildren();
    if (!p) return;
    p.loadouts.forEach((l, i) => {
      classList.append(
        h(
          'button',
          {
            class: 'fe-li',
            type: 'button',
            'aria-pressed': String(i === idx),
            onclick: () => {
              idx = i;
              work = cloneLoadout(l);
              hover = null;
              render();
            },
          },
          l.name,
          i === p.selectedLoadout ? h('small', {}, 'Equipped') : null,
        ),
      );
    });
    const cap = classSlotsFor(p);
    if (!canEditClasses(p)) {
      classList.append(h('div', { class: 'fe-small fe-dim' }, 'Create-a-Class unlocks at level 4. Until then the default classes are used.'));
      return;
    }
    if (p.loadouts.length < cap) {
      classList.append(
        h(
          'button',
          {
            class: 'fe-li',
            type: 'button',
            onclick: () => {
              idx = p.loadouts.length;
              work = { ...cloneLoadout(DEFAULT_LOADOUTS[0]!), name: `Custom ${idx + 1}` };
              p.loadouts.push(cloneLoadout(work));
              render();
              save();
            },
          },
          '+ New class',
          h('small', {}, `${p.loadouts.length}/${cap}`),
        ),
      );
    } else classList.append(h('div', { class: 'fe-small fe-dim' }, `${Math.min(p.loadouts.length, cap)}/${cap} classes · more slots at levels 10, 20, 30, 40 and with prestige`));
  };

  const equip = h('button', { class: 'lf-btn small', type: 'button' }, 'Equip this class');
  equip.addEventListener('click', async () => {
    try {
      const r = await net.rpc('frontend.selectClass', { index: idx });
      if (net.profile) net.profile.selectedLoadout = r.selectedLoadout;
      status.textContent = `${work.name} equipped`;
      renderClasses();
    } catch (err) {
      status.textContent = errText(err);
    }
  });

  // ---- rows ----------------------------------------------------------------------------------
  const attNames = (w: WeaponLoadout) => (w.attachments.length ? w.attachments.map((a) => ATTACHMENT_BY_ID.get(a)?.name ?? a).join(' + ') : 'None');
  const perkOfTier = (t: number) => work.perks.find((p) => PERK_BY_ID.get(p)?.tier === t);
  const row = (s: Section, k: string, v: string) => h('button', { class: 'fe-row', type: 'button', 'aria-current': String(section === s), onclick: () => ((section = s), (hover = null), render()) }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));
  const head = (t: string) => h('div', { class: 'fe-row-head' }, t);
  const renderRows = () => {
    const slots = attachmentSlotsFor(work.perks);
    rows.replaceChildren(
      row('name', 'Name', work.name),
      head('Weapons'),
      row('primary', 'Primary', wName(work.primary.weapon)),
      row('primaryAtt', slots > 1 ? 'Attachments' : 'Attachment', attNames(work.primary)),
      row('primaryCamo', 'Camo', CAMO_BY_ID.get(work.primary.camo)?.name ?? 'None'),
      row('secondary', 'Secondary', wName(work.secondary.weapon)),
      row('secondaryAtt', 'Attachment', attNames(work.secondary)),
      row('secondaryCamo', 'Camo', CAMO_BY_ID.get(work.secondary.camo)?.name ?? 'None'),
      head('Equipment'),
      row('lethal', 'Lethal', work.lethal ? (EQUIPMENT_BY_ID.get(work.lethal)?.name ?? work.lethal) : 'None'),
      row('tactical', 'Tactical', work.tactical ? (EQUIPMENT_BY_ID.get(work.tactical)?.name ?? work.tactical) : 'None'),
      head('Perks'),
      ...[1, 2, 3].map((t) => row(`perk${t}` as Section, `Perk ${t}`, PERK_BY_ID.get(perkOfTier(t) ?? '')?.name ?? 'None')),
      head('Killstreaks'),
      row('streaks', 'Streaks', work.killstreaks.map((k) => `${KILLSTREAK_BY_ID.get(k)?.name ?? k} (${KILLSTREAK_BY_ID.get(k)?.kills ?? '?'})`).join(', ') || 'None'),
    );
  };

  // ---- preview + stats ---------------------------------------------------------------------
  const slotShown = (): 'primary' | 'secondary' => (section.startsWith('secondary') ? 'secondary' : 'primary');
  const renderPreview = () => {
    const slot = slotShown();
    const cur = work[slot];
    const shown = hover ?? cur;
    const def = WEAPON_BY_ID.get(shown.weapon);
    if (!def) return;
    preview.show(def.model, shown.attachments, shown.camo);
    caption.replaceChildren(def.name, h('small', {}, `${CLASS_NAMES[def.class] ?? def.class} · ${attNames(shown)}`));
    const base = weaponStats(WEAPON_BY_ID.get(cur.weapon) ?? def, cur.attachments);
    const next = hover ? weaponStats(def, shown.attachments) : null;
    stats.replaceChildren(
      ...(Object.keys(STAT_LABELS) as (keyof WeaponStats)[]).flatMap((k) => {
        const a = base[k];
        const b = next ? next[k] : a;
        const lo = Math.min(a, b);
        const bar = h('div', { class: 'fe-stat', role: 'meter', 'aria-label': STAT_LABELS[k], 'aria-valuenow': b, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: `width:${lo}%` }));
        if (b !== a) bar.append(h('i', { class: b > a ? 'up' : 'down', style: `left:${lo}%;width:${Math.abs(b - a)}%` }));
        return [h('span', { class: 'fe-dim' }, STAT_LABELS[k]), bar, h('span', {}, String(b))];
      }),
    );
  };

  // ---- pickers -------------------------------------------------------------------------------
  const item = (o: { label: string; sub?: string; pressed: boolean; kind?: ItemKind; id?: string; weapon?: string | null; onPick: () => void; onHover?: () => void; swatch?: string }) => {
    const l = o.kind && o.id ? lock(o.kind, o.id, o.weapon ?? null) : { unlocked: true, requirement: null };
    const el = h(
      'button',
      { class: `fe-item${l.unlocked ? '' : ' locked'}`, type: 'button', 'aria-pressed': String(o.pressed), 'aria-disabled': String(!l.unlocked), title: l.requirement ?? o.sub ?? '' },
      o.swatch ? h('div', { class: 'fe-swatch', style: `background:${o.swatch}` }) : null,
      o.label,
      o.sub ? h('small', {}, o.sub) : null,
      l.unlocked ? null : h('span', { class: 'lock' }, `Locked: ${l.requirement}`),
    );
    el.addEventListener('click', () => {
      if (l.unlocked) o.onPick();
    });
    if (o.onHover) {
      el.addEventListener('pointerenter', o.onHover);
      el.addEventListener('focus', o.onHover);
      el.addEventListener('pointerleave', () => {
        hover = null;
        renderPreview();
      });
    }
    return el;
  };
  const grid = (title: string, items: HTMLElement[]) => h('div', {}, h('h3', { class: 'fe-h' }, title), h('div', { class: 'fe-grid' }, ...items));

  const weaponPicker = (slot: 'primary' | 'secondary') => {
    const byClass = new Map<WeaponClass, HTMLElement[]>();
    // Wager-only weapons (crossbow, ballistic knife) are appended to WEAPONS but never allowed in
    // classes, nor are the Mystery Box's wonder weapons.
    for (const d of WEAPONS.filter((w) => w.slot === slot && !w.wonder && !WAGER_ONLY_WEAPONS.has(w.id))) {
      const list = byClass.get(d.class) ?? [];
      list.push(
        item({
          label: d.name,
          sub: `${d.mode} · ${d.rpm} rpm · ${d.magazine} rds`,
          pressed: work[slot].weapon === d.id,
          kind: 'weapon',
          id: d.id,
          onPick: () => edit((l) => (l[slot] = { weapon: d.id, attachments: [], camo: lock('camo', l[slot].camo, d.id).unlocked ? l[slot].camo : 'none' })),
          onHover: () => {
            hover = { weapon: d.id, attachments: [], camo: work[slot].camo };
            renderPreview();
          },
        }),
      );
      byClass.set(d.class, list);
    }
    return [...byClass].map(([c, items]) => grid(CLASS_NAMES[c] ?? c, items));
  };

  const attachmentPicker = (slot: 'primary' | 'secondary') => {
    const w = work[slot];
    const def = WEAPON_BY_ID.get(w.weapon);
    if (!def) return [];
    const max = slot === 'primary' ? attachmentSlotsFor(work.perks) : 1;
    const toggle = (id: string) =>
      edit((l) => {
        const cur = l[slot].attachments;
        if (cur.includes(id)) l[slot].attachments = cur.filter((a) => a !== id);
        else {
          const kind = ATTACHMENT_BY_ID.get(id)?.slot;
          let next = cur.filter((a) => ATTACHMENT_BY_ID.get(a)?.slot !== kind);
          if (next.length >= max) next = next.slice(next.length - max + 1);
          l[slot].attachments = [...next, id];
        }
      });
    const items = [
      item({ label: 'None', sub: 'Clear attachments', pressed: w.attachments.length === 0, onPick: () => edit((l) => (l[slot].attachments = [])) }),
      ...def.attachments.map((id) => {
        const a = ATTACHMENT_BY_ID.get(id);
        return item({
          label: a?.name ?? id,
          sub: a ? `${a.slot}${a.modifiers.suppressed ? ' · suppressed' : ''}${a.modifiers.zoom ? ` · ${a.modifiers.zoom}x` : ''}` : '',
          pressed: w.attachments.includes(id),
          kind: 'attachment',
          id,
          weapon: w.weapon,
          onPick: () => toggle(id),
          onHover: () => {
            const kind = a?.slot;
            const base = w.attachments.filter((x) => ATTACHMENT_BY_ID.get(x)?.slot !== kind);
            hover = { ...w, attachments: w.attachments.includes(id) ? w.attachments.filter((x) => x !== id) : [...base.slice(Math.max(0, base.length - max + 1)), id] };
            renderPreview();
          },
        });
      }),
    ];
    const note = max > 1 ? `Up to ${max} (Warlord)` : 'One attachment · Warlord allows two';
    return [grid(`${def.name} attachments · ${note}`, items)];
  };

  const camoPicker = (slot: 'primary' | 'secondary') => {
    const w = work[slot];
    return [
      grid(
        `${wName(w.weapon)} camo`,
        CAMOS.map((c) =>
          item({
            label: c.name,
            sub: c.price ? `${c.price} CP` : c.unlock ? 'Unlock' : '',
            pressed: w.camo === c.id,
            kind: 'camo',
            id: c.id,
            weapon: w.weapon,
            swatch: camoColor(c.id),
            onPick: () => edit((l) => (l[slot].camo = c.id)),
            onHover: () => {
              hover = { ...w, camo: c.id };
              renderPreview();
            },
          }),
        ),
      ),
    ];
  };

  const equipmentPicker = (kind: 'lethal' | 'tactical') => [
    grid(kind === 'lethal' ? 'Lethal' : 'Tactical', [
      item({ label: 'None', pressed: work[kind] === null, onPick: () => edit((l) => (l[kind] = null)) }),
      ...EQUIPMENT.filter((e) => e.kind === kind).map((e) => item({ label: e.name, sub: e.description, pressed: work[kind] === e.id, kind: 'equipment', id: e.id, onPick: () => edit((l) => (l[kind] = e.id)) })),
    ]),
  ];

  const perkPicker = (tier: 1 | 2 | 3) => {
    const cur = perkOfTier(tier);
    const set = (id: string | null) => edit((l) => (l.perks = [...l.perks.filter((p) => PERK_BY_ID.get(p)?.tier !== tier), ...(id ? [id] : [])]));
    return [
      grid(`Perk ${tier}`, [
        item({ label: 'None', pressed: !cur, onPick: () => set(null) }),
        ...PERKS.filter((p) => p.tier === tier).map((p) => item({ label: p.name, sub: `${p.description} Pro: ${p.pro.description}`, pressed: cur === p.id, kind: 'perk', id: p.id, onPick: () => set(p.id) })),
      ]),
    ];
  };

  const streakPicker = () => {
    const sorted = [...KILLSTREAKS].sort((a, b) => a.kills - b.kills || a.id.localeCompare(b.id));
    return [
      grid(`Killstreaks · pick 3 (${work.killstreaks.length}/3)`, [
        ...sorted.map((k) =>
          item({
            label: `${k.name} · ${k.kills}`,
            sub: k.description,
            pressed: work.killstreaks.includes(k.id),
            kind: 'killstreak',
            id: k.id,
            onPick: () =>
              edit((l) => {
                if (l.killstreaks.includes(k.id)) l.killstreaks = l.killstreaks.filter((x) => x !== k.id);
                else if (l.killstreaks.length < 3) l.killstreaks = [...l.killstreaks, k.id];
                else status.textContent = 'Three killstreaks max: remove one first';
              }),
          }),
        ),
      ]),
    ];
  };

  const namePicker = () => {
    const input = h('input', { class: 'fe-input fe-class-name', maxlength: 24, value: work.name, 'aria-label': 'Class name' });
    input.addEventListener('input', () => {
      work.name = input.value;
      renderRows();
      renderClasses();
      save();
    });
    queueMicrotask(() => input.focus());
    return [h('div', {}, h('h3', { class: 'fe-h' }, 'Class name'), input)];
  };

  const renderPicker = () => {
    const map: Record<Section, () => HTMLElement[]> = {
      name: namePicker,
      primary: () => weaponPicker('primary'),
      primaryAtt: () => attachmentPicker('primary'),
      primaryCamo: () => camoPicker('primary'),
      secondary: () => weaponPicker('secondary'),
      secondaryAtt: () => attachmentPicker('secondary'),
      secondaryCamo: () => camoPicker('secondary'),
      lethal: () => equipmentPicker('lethal'),
      tactical: () => equipmentPicker('tactical'),
      perk1: () => perkPicker(1),
      perk2: () => perkPicker(2),
      perk3: () => perkPicker(3),
      streaks: streakPicker,
    };
    picker.replaceChildren(...map[section]());
  };

  const render = () => {
    renderClasses();
    renderRows();
    renderPreview();
    renderPicker();
  };

  const backBtn = h('button', { class: 'lf-btn primary', type: 'button', onclick: () => back(params) }, 'Back');
  root.append(
    h(
      'div',
      { class: `fe-page${params.overlay === '1' ? '' : ' lf-bg'}` },
      h('div', { class: 'fe-top' }, h('h2', { class: 'lf-h2' }, 'Create a Class'), h('div', { class: 'fe-actions' }, equip, backBtn)),
      h(
        'div',
        { class: 'fe-cac' },
        h('section', { class: 'fe-panel' }, h('h3', { class: 'fe-h' }, 'Classes'), classList),
        h('section', { class: 'fe-panel' }, rows),
        h('section', { class: 'fe-panel' }, previewBox, stats, picker),
      ),
      status,
    ),
  );
  render();

  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape' && !(e.target instanceof HTMLInputElement)) back(params);
  };
  addEventListener('keydown', onKey);
  const offs = [
    net.on('welcome', (m) => {
      if (saving) return;
      profile = m.profile;
      idx = Math.min(profile.selectedLoadout, profile.loadouts.length - 1);
      work = cloneLoadout(profile.loadouts[idx] ?? DEFAULT_LOADOUTS[0]!);
      render();
    }),
  ];
  return () => {
    removeEventListener('keydown', onKey);
    for (const off of offs) off();
    preview.dispose();
  };
});
