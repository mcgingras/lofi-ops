/**
 * Killfeed icons for the machine pistols (12 x 7 pixel units beside the weapon name, like the wonder
 * weapons'): a small full-auto sidearm silhouette in gunmetal with each gun's tell-tale part (the
 * G18's long magazine, the Skorpion's forward magazine and wooden grip, the CZ75 Auto's compensator
 * and spare mag, the TMP's front grip, the MP9's folded stock). A kill with one reads as a machine
 * pistol kill at a glance.
 */
import { rect } from '../../hud/draw';
import { registerKillfeedIcon, type KillfeedIcon } from '../../registry';

const METAL = '#5a6066';
const DARK = '#2e3236';
const WOOD = '#8a5a30';

type Draw = (g: CanvasRenderingContext2D, x: number, y: number, u: number) => void;
const icon = (draw: Draw): KillfeedIcon => (g, x, y, u) => {
  const w = 12 * u;
  draw(g, x - w, y + u, u);
  return w;
};
/** The shared body: slide / receiver along the top (muzzle left), grip at the back. */
const body = (g: CanvasRenderingContext2D, x: number, y: number, u: number, len = 9, grip = METAL) => {
  rect(g, x + (11 - len) * u, y, len * u, 2 * u, METAL);
  rect(g, x + 8 * u, y + 2 * u, 2 * u, 3 * u, grip);
  rect(g, x + 6 * u, y + 2 * u, u, u, DARK);
};

export const MACHINE_PISTOL_ICONS: Record<string, Draw> = {
  g18: (g, x, y, u) => {
    body(g, x, y, u, 8);
    rect(g, x + 8 * u, y + 5 * u, 2 * u, 2 * u, DARK); // long mag out of the grip
  },
  skorpion: (g, x, y, u) => {
    body(g, x, y, u, 10, WOOD);
    rect(g, x + 4 * u, y + 2 * u, u, 3 * u, DARK); // magazine ahead of the trigger
    rect(g, x + 2 * u, y - u, 8 * u, u, DARK); // folded wire stock
  },
  cz75auto: (g, x, y, u) => {
    body(g, x, y, u, 8);
    rect(g, x + u, y, 2 * u, 2 * u, DARK); // compensator
    rect(g, x + 4 * u, y + 2 * u, u, 2 * u, DARK); // spare mag foregrip
  },
  tmp: (g, x, y, u) => {
    body(g, x, y, u, 10);
    rect(g, x + 3 * u, y + 2 * u, u, 3 * u, METAL); // front grip
  },
  mp9: (g, x, y, u) => {
    body(g, x, y, u, 10);
    rect(g, x + 3 * u, y + 2 * u, u, 3 * u, METAL);
    rect(g, x + 2 * u, y - u, 9 * u, u, DARK); // top rail / folded stock
  },
};

for (const [id, draw] of Object.entries(MACHINE_PISTOL_ICONS)) registerKillfeedIcon(id, icon(draw));
