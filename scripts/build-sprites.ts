// Builds the vehicle sprite atlases and the matching TypeScript mapping module.
// Run with `yarn sprites:build` (or `yarn tsx scripts/build-sprites.ts`).
//
// Outputs:
//   public/sprites/vehicles.png         body atlas: white silhouettes, drawn with `mask: true`
//   public/sprites/vehicle-details.png  detail atlas: glass, shading, lights; drawn unmasked on top
//   src/lib/vehicleSprites.ts           icon mappings + sizes for deck.gl's IconLayer
//   public/apple-icon.png
//
// Every sprite is drawn at PX_PER_M pixels per metre, pointing north (front at the top of its
// cell), with the vehicle footprint centred in the cell. Drawing code below works in metres with
// the footprint spanning x ∈ [0, W] (left → right) and y ∈ [0, L] (front → rear).
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { TYPE_PARAMS } from '../src/sim/params';

const PX_PER_M = 16;
const PAD = 8; // transparent px around each footprint, room for light glow
const GUTTER = 4; // px between cells, avoids texture bleeding between frames
const LIGHT_STATES = ['none', 'brake', 'left', 'right', 'brake-left', 'brake-right'] as const;
type LightState = (typeof LIGHT_STATES)[number];

const GLASS = 'fill="#1b2a2f" fill-opacity="0.85"';
const HEADLIGHT = 'fill="#fff4c8" fill-opacity="0.95"';
const TAIL_DIM = '#6a1d19';
const TAIL_ON = '#ff3b30';
const AMBER = '#ffb020';

const n = (v: number) => +v.toFixed(3);

/** Rounded rect path with separate front (top) and rear (bottom) corner radii. */
function rrect(x: number, y: number, w: number, h: number, rf: number, rr = rf) {
  return `M${n(x + rf)},${n(y)} H${n(x + w - rf)} Q${n(x + w)},${n(y)} ${n(x + w)},${n(y + rf)} V${n(y + h - rr)} Q${n(x + w)},${n(y + h)} ${n(x + w - rr)},${n(y + h)} H${n(x + rr)} Q${n(x)},${n(y + h)} ${n(x)},${n(y + h - rr)} V${n(y + rf)} Q${n(x)},${n(y)} ${n(x + rf)},${n(y)} Z`;
}
/** Body outline with long, soft front corners (cars, cabs). */
function carShell(W: number, L: number, rf: number, rr: number) {
  return `M${n(rf)},0 H${n(W - rf)} C${n(W - rf * 0.35)},0 ${n(W)},${n(rf * 0.45)} ${n(W)},${n(rf * 1.2)} V${n(L - rr)} C${n(W)},${n(L - rr * 0.4)} ${n(W - rr * 0.4)},${n(L)} ${n(W - rr)},${n(L)} H${n(rr)} C${n(rr * 0.4)},${n(L)} 0,${n(L - rr * 0.4)} 0,${n(L - rr)} V${n(rf * 1.2)} C0,${n(rf * 0.45)} ${n(rf * 0.35)},0 ${n(rf)},0 Z`;
}
/** Quadrilateral with a curved front edge (windscreens). */
function screen(
  y0: number,
  y1: number,
  xf0: number,
  xf1: number,
  xr0: number,
  xr1: number,
  bulge: number,
) {
  return `M${n(xf0)},${n(y0)} Q${n((xf0 + xf1) / 2)},${n(y0 - bulge)} ${n(xf1)},${n(y0)} L${n(xr1)},${n(y1)} Q${n((xr0 + xr1) / 2)},${n(y1 - bulge * 0.6)} ${n(xr0)},${n(y1)} Z`;
}
const path = (d: string, attrs = '') => `<path d="${d}" ${attrs}/>`;
const rect = (x: number, y: number, w: number, h: number, r: number, attrs = '') =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}" ${attrs}/>`;
const circle = (cx: number, cy: number, r: number, attrs = '') =>
  `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" ${attrs}/>`;
const ellipse = (cx: number, cy: number, rx: number, ry: number, attrs = '') =>
  `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" ${attrs}/>`;
const line = (x1: number, y1: number, x2: number, y2: number, attrs = '') =>
  `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ${attrs}/>`;

interface Lights {
  /** Tail lamps as [x, y, w, h] rects. */
  tail: [number, number, number, number][];
  /** Indicator dots [x, y] on the vehicle's left side; mirrored for the right. */
  indicators: [number, number][];
  dot: number; // indicator dot radius
}
interface Design {
  /** Silhouette shapes in metres, without fill (reused for the body atlas and as a clip path). */
  body: (W: number, L: number) => string;
  /** Static details (glass, shading, features), drawn under the lights. */
  detail: (W: number, L: number, clip: string) => string;
  lights: (W: number, L: number) => Lights;
}

/** Soft inner edge shading + a roof highlight clipped to the silhouette. */
const edgeShade = (shape: string, clip: string, width = 0.22) =>
  `<g clip-path="url(#${clip})"><g fill="none" stroke="#000" stroke-opacity="0.22" stroke-width="${width}">${shape}</g></g>`;

const DESIGNS: Design[] = [
  // 0 · two-wheeler: narrow scooter body, handlebar spanning the full width, rider on top.
  {
    body: (W, L) => {
      const c = W / 2;
      return [
        rect(c - 0.07, 0, 0.14, 0.5, 0.07),
        rect(0, 0.42, W, 0.11, 0.055),
        rect(c - 0.15, 0.22, 0.3, 0.5, 0.13),
        rect(c - 0.21, 0.55, 0.42, 1.05, 0.19),
        rect(c - 0.13, 1.3, 0.26, L - 1.3, 0.1),
      ].join('');
    },
    detail: (W, L) => {
      const c = W / 2;
      const rider = '#3f4f60';
      return [
        rect(c - 0.05, 0, 0.1, 0.24, 0.05, 'fill="#12171a"'),
        ellipse(c, 0.3, 0.07, 0.045, HEADLIGHT),
        rect(0.05, 0.445, W - 0.1, 0.06, 0.03, 'fill="#1d2326"'),
        rect(0, 0.43, 0.12, 0.09, 0.04, 'fill="#101416"'),
        rect(W - 0.12, 0.43, 0.12, 0.09, 0.04, 'fill="#101416"'),
        // arms, shoulders, helmet
        line(
          c - 0.19,
          1.06,
          c - 0.3,
          0.5,
          `stroke="${rider}" stroke-width="0.12" stroke-linecap="round"`,
        ),
        line(
          c + 0.19,
          1.06,
          c + 0.3,
          0.5,
          `stroke="${rider}" stroke-width="0.12" stroke-linecap="round"`,
        ),
        ellipse(c, 1.2, 0.26, 0.21, `fill="${rider}"`),
        ellipse(c, 1.26, 0.15, 0.08, 'fill="#fff" fill-opacity="0.14"'),
        circle(
          c,
          1.03,
          0.145,
          'fill="#0c1012" stroke="#000" stroke-opacity="0.4" stroke-width="0.03"',
        ),
        ellipse(c, 0.95, 0.085, 0.04, 'fill="#fff" fill-opacity="0.35"'),
        // rear rack
        rect(c - 0.09, L - 0.42, 0.18, 0.26, 0.05, 'fill="#000" fill-opacity="0.25"'),
      ].join('');
    },
    lights: (W, L) => ({
      tail: [[W / 2 - 0.08, L - 0.1, 0.16, 0.08]],
      indicators: [
        [0.07, 0.36],
        [W / 2 - 0.13, L - 0.2],
      ],
      dot: 0.07,
    }),
  },
  // 1 · auto-rickshaw: tapered nose with a single headlight, canopy with rounded front.
  {
    body: (W, L) => {
      const c = W / 2;
      return [
        path(
          `M${n(c - 0.24)},0.1 Q${n(c)},-0.1 ${n(c + 0.24)},0.1 L${n(c + 0.52)},0.85 L${n(c - 0.52)},0.85 Z`,
        ),
        path(rrect(0, 0.55, W, L - 0.55, 0.5, 0.14)),
      ].join('');
    },
    detail: (W, L, clip) => {
      const c = W / 2;
      const top = 1.0;
      return [
        edgeShade(path(rrect(0, 0.55, W, L - 0.55, 0.5, 0.14)), clip, 0.18),
        circle(c, 0.16, 0.08, HEADLIGHT),
        ellipse(c, 0.42, 0.14, 0.05, 'fill="#000" fill-opacity="0.2"'),
        path(screen(0.66, top, 0.18, W - 0.18, 0.1, W - 0.1, 0.12), GLASS),
        // black canopy with seams and a yellow trim line
        path(
          rrect(0.07, top, W - 0.14, L - top - 0.07, 0.08, 0.1),
          'fill="#15191a" fill-opacity="0.42" stroke="#0e1112" stroke-width="0.1"',
        ),
        line(0.1, top + 0.02, W - 0.1, top + 0.02, 'stroke="#f2c230" stroke-width="0.06"'),
        line(0.1, L - 0.1, W - 0.1, L - 0.1, 'stroke="#f2c230" stroke-width="0.05"'),
        ...[0.45, 0.9].map((f) =>
          line(
            0.1,
            top + (L - top) * f,
            W - 0.1,
            top + (L - top) * f,
            'stroke="#000" stroke-opacity="0.55" stroke-width="0.06"',
          ),
        ),
        rect(0.28, top + 0.14, W - 0.56, (L - top) * 0.28, 0.08, 'fill="#fff" fill-opacity="0.12"'),
      ].join('');
    },
    lights: (W, L) => ({
      tail: [
        [0.1, L - 0.1, 0.22, 0.08],
        [W - 0.32, L - 0.1, 0.22, 0.08],
      ],
      indicators: [
        [W / 2 - 0.4, 0.62],
        [0.12, L - 0.2],
      ],
      dot: 0.09,
    }),
  },
  // 2 · car
  {
    body: (W, L) => path(carShell(W, L, 0.55, 0.38)),
    detail: (W, L, clip) => carDetail(W, L, clip, false),
    lights: carLights,
  },
  // 3 · cab: a car with a roof light bar
  {
    body: (W, L) => path(carShell(W, L, 0.55, 0.38)),
    detail: (W, L, clip) => carDetail(W, L, clip, true),
    lights: carLights,
  },
  // 4 · bus
  {
    body: (W, L) => path(rrect(0, 0, W, L, 0.45, 0.28)),
    detail: (W, L, clip) => {
      const c = W / 2;
      const sideW = 0.2;
      return [
        edgeShade(path(rrect(0, 0, W, L, 0.45, 0.28)), clip, 0.2),
        path(rrect(0.1, 0.08, W - 0.2, 0.55, 0.36, 0.06), GLASS),
        rect(0.35, 0.7, W - 0.7, 0.12, 0.05, 'fill="#000" fill-opacity="0.2"'),
        // side window strips
        rect(0.06, 0.95, sideW, L - 1.5, 0.06, GLASS),
        rect(W - 0.06 - sideW, 0.95, sideW, L - 1.5, 0.06, GLASS),
        // roof: AC unit with two fans, hatches
        rect(
          c - 0.85,
          2.0,
          1.7,
          3.4,
          0.22,
          'fill="#dfe6e8" fill-opacity="0.75" stroke="#000" stroke-opacity="0.35" stroke-width="0.08"',
        ),
        circle(c, 2.85, 0.42, 'fill="#1b2a2f" fill-opacity="0.55"'),
        circle(c, 4.55, 0.42, 'fill="#1b2a2f" fill-opacity="0.55"'),
        rect(
          c - 0.4,
          6.7,
          0.8,
          0.8,
          0.08,
          'fill="#000" fill-opacity="0.22" stroke="#fff" stroke-opacity="0.3" stroke-width="0.07"',
        ),
        rect(
          c - 0.4,
          8.7,
          0.8,
          0.8,
          0.08,
          'fill="#000" fill-opacity="0.22" stroke="#fff" stroke-opacity="0.3" stroke-width="0.07"',
        ),
        rect(c - 0.5, L - 1.25, 1.0, 0.55, 0.08, 'fill="#000" fill-opacity="0.18"'),
        rect(0.35, L - 0.36, W - 0.7, 0.2, 0.06, GLASS),
      ].join('');
    },
    lights: (W, L) => ({
      tail: [
        [0.08, L - 0.14, 0.26, 0.1],
        [W - 0.34, L - 0.14, 0.26, 0.1],
      ],
      indicators: [
        [0.13, 0.12],
        [0.13, L - 0.32],
      ],
      dot: 0.13,
    }),
  },
  // 5 · truck: narrower cab, gap, tarpaulin-covered cargo bed
  {
    body: (W, L) =>
      [path(rrect(0.1, 0, W - 0.2, 2.1, 0.32, 0.06)), path(rrect(0, 2.35, W, L - 2.35, 0.1))].join(
        '',
      ),
    detail: (W, L, clip) => {
      const c = W / 2;
      const bed = 2.35;
      const ribs = Array.from({ length: 6 }, (_, i) => bed + ((L - bed) * (i + 1)) / 7);
      return [
        edgeShade(path(rrect(0.1, 0, W - 0.2, 2.1, 0.32, 0.06)), clip, 0.2),
        rect(0.28, 0.02, 0.4, 0.1, 0.04, HEADLIGHT),
        rect(W - 0.68, 0.02, 0.4, 0.1, 0.04, HEADLIGHT),
        path(screen(0.2, 0.7, 0.3, W - 0.3, 0.38, W - 0.38, 0.12), GLASS),
        rect(0.4, 0.85, W - 0.8, 1.05, 0.12, 'fill="#fff" fill-opacity="0.18"'),
        rect(0, 0.35, 0.14, 0.3, 0.04, 'fill="#20272a"'),
        rect(W - 0.14, 0.35, 0.14, 0.3, 0.04, 'fill="#20272a"'),
        // cargo tarp: edge rail, ridge, ribs
        path(
          rrect(0.05, bed + 0.05, W - 0.1, L - bed - 0.1, 0.08),
          'fill="none" stroke="#000" stroke-opacity="0.4" stroke-width="0.1"',
        ),
        rect(c - 0.18, bed + 0.12, 0.36, L - bed - 0.24, 0.1, 'fill="#fff" fill-opacity="0.16"'),
        ...ribs.map((y) =>
          rect(0.05, y - 0.08, W - 0.1, 0.16, 0.04, 'fill="#000" fill-opacity="0.3"'),
        ),
      ].join('');
    },
    lights: (W, L) => ({
      tail: [
        [0.1, L - 0.14, 0.3, 0.1],
        [W - 0.4, L - 0.14, 0.3, 0.1],
      ],
      indicators: [
        [0.24, 0.17],
        [0.12, L - 0.34],
      ],
      dot: 0.13,
    }),
  },
];

function carDetail(W: number, L: number, clip: string, cab: boolean) {
  const c = W / 2;
  const [ws0, ws1, rw0, rw1] = [1.3, 1.9, 3.3, 3.72];
  const roofX = 0.34;
  return [
    edgeShade(path(carShell(W, L, 0.55, 0.38)), clip, 0.24),
    // headlights
    path(`M0.2,0.2 Q0.3,0.07 0.62,0.06 L0.6,0.2 Z`, HEADLIGHT),
    path(
      `M${n(W - 0.2)},0.2 Q${n(W - 0.3)},0.07 ${n(W - 0.62)},0.06 L${n(W - 0.6)},0.2 Z`,
      HEADLIGHT,
    ),
    // bonnet crease
    rect(c - 0.35, 0.45, 0.7, 0.7, 0.2, 'fill="#fff" fill-opacity="0.1"'),
    // mirrors
    rect(-0.1, ws0 + 0.02, 0.2, 0.12, 0.05, 'fill="#20272a"'),
    rect(W - 0.1, ws0 + 0.02, 0.2, 0.12, 0.05, 'fill="#20272a"'),
    // greenhouse: windscreen, side windows, rear window
    path(screen(ws0, ws1, 0.2, W - 0.2, roofX, W - roofX, 0.14), GLASS),
    path(
      `M0.14,${n(ws1 - 0.08)} L${n(roofX - 0.02)},${ws1} V${rw0} L0.16,${n(rw0 + 0.1)} Z`,
      GLASS,
    ),
    path(
      `M${n(W - 0.14)},${n(ws1 - 0.08)} L${n(W - roofX + 0.02)},${ws1} V${rw0} L${n(W - 0.16)},${n(rw0 + 0.1)} Z`,
      GLASS,
    ),
    path(screen(rw0, rw1, roofX, W - roofX, 0.24, W - 0.24, -0.06), GLASS),
    // roof highlight and a darker rear edge for depth
    rect(
      roofX + 0.06,
      ws1 + 0.1,
      W - 2 * roofX - 0.12,
      rw0 - ws1 - 0.2,
      0.18,
      'fill="#fff" fill-opacity="0.2"',
    ),
    rect(roofX, rw0 - 0.1, W - 2 * roofX, 0.1, 0.03, 'fill="#000" fill-opacity="0.18"'),
    cab
      ? rect(
          c - 0.3,
          ws1 + 0.2,
          0.6,
          0.24,
          0.06,
          'fill="#ffd23f" stroke="#141414" stroke-width="0.05"',
        ) + rect(c - 0.18, ws1 + 0.29, 0.36, 0.06, 0.02, 'fill="#141414"')
      : '',
  ].join('');
}
function carLights(W: number, L: number): Lights {
  return {
    tail: [
      [0.1, L - 0.13, 0.36, 0.11],
      [W - 0.46, L - 0.13, 0.36, 0.11],
    ],
    indicators: [
      [0.14, 0.3],
      [0.14, L - 0.3],
    ],
    dot: 0.11,
  };
}

function lightsSvg(W: number, L: number, lights: Lights, state: LightState) {
  const braking = state.startsWith('brake');
  const side = state.endsWith('left') ? -1 : state.endsWith('right') ? 1 : 0;
  const out: string[] = [];
  for (const [x, y, w, h] of lights.tail) {
    const cx = x + w / 2;
    if (braking) {
      out.push(ellipse(cx, L, w * 0.5 + 0.35, 0.42, 'fill="url(#glowRed)"'));
      out.push(rect(x, y, w, h, h / 2, `fill="${TAIL_ON}"`));
      out.push(rect(x + w * 0.2, y + h * 0.3, w * 0.6, h * 0.4, h * 0.2, 'fill="#ffb3ad"'));
    } else out.push(rect(x, y, w, h, h / 2, `fill="${TAIL_DIM}"`));
  }
  if (side)
    for (const [lx, y] of lights.indicators) {
      const x = side < 0 ? lx : W - lx;
      out.push(circle(x, y, lights.dot + 0.3, 'fill="url(#glowAmber)"'));
      out.push(circle(x, y, lights.dot, `fill="${AMBER}"`));
    }
  return out.join('');
}

const DEFS = `<defs>
<radialGradient id="glowRed"><stop offset="0" stop-color="${TAIL_ON}" stop-opacity="0.8"/><stop offset="0.5" stop-color="${TAIL_ON}" stop-opacity="0.35"/><stop offset="1" stop-color="${TAIL_ON}" stop-opacity="0"/></radialGradient>
<radialGradient id="glowAmber"><stop offset="0" stop-color="${AMBER}" stop-opacity="0.85"/><stop offset="0.45" stop-color="${AMBER}" stop-opacity="0.4"/><stop offset="1" stop-color="${AMBER}" stop-opacity="0"/></radialGradient>
</defs>`;

// ---- layout ---------------------------------------------------------------------------------
const even = (v: number) => Math.ceil(v / 2) * 2;
const cells = TYPE_PARAMS.map(({ length: L, width: W }) => ({
  L,
  W,
  width: even(W * PX_PER_M + 2 * PAD),
  height: even(L * PX_PER_M + 2 * PAD),
  x: 0,
}));
let cursor = 0;
for (const cell of cells) {
  cell.x = cursor;
  cursor += cell.width + GUTTER;
}
const atlasWidth = cursor - GUTTER;
const rowHeight = Math.max(...cells.map((c) => c.height));
const detailRow = rowHeight + GUTTER;

const place = (cell: (typeof cells)[number], top: number, inner: string) => {
  const ox = cell.x + (cell.width - cell.W * PX_PER_M) / 2;
  const oy = top + (cell.height - cell.L * PX_PER_M) / 2;
  return `<g transform="translate(${n(ox)} ${n(oy)}) scale(${PX_PER_M})">${inner}</g>`;
};
const svg = (w: number, h: number, body: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${DEFS}${body}</svg>`,
  );

const bodySvg = cells
  .map((cell, t) => place(cell, 0, `<g fill="#fff">${DESIGNS[t].body(cell.W, cell.L)}</g>`))
  .join('');
const detailSvg = cells
  .map((cell, t) => {
    const { W, L } = cell;
    const d = DESIGNS[t];
    const clip = `<clipPath id="clip${t}">${d.body(W, L)}</clipPath>`;
    const staticDetail = d.detail(W, L, `clip${t}`);
    const lights = d.lights(W, L);
    return LIGHT_STATES.map((state, s) =>
      place(
        cell,
        s * detailRow,
        `${s === 0 ? clip : ''}${staticDetail}${lightsSvg(W, L, lights, state)}`,
      ),
    ).join('');
  })
  .join('');

await mkdir('public/sprites', { recursive: true });
await sharp(svg(atlasWidth, rowHeight, bodySvg))
  .png()
  .toFile('public/sprites/vehicles.png');
await sharp(svg(atlasWidth, detailRow * LIGHT_STATES.length - GUTTER, detailSvg))
  .png()
  .toFile('public/sprites/vehicle-details.png');

// ---- mapping module -------------------------------------------------------------------------
const frame = (cell: (typeof cells)[number], y: number, mask: boolean) =>
  `{ x: ${cell.x}, y: ${y}, width: ${cell.width}, height: ${cell.height}, anchorX: ${cell.width / 2}, anchorY: ${cell.height / 2}, mask: ${mask} }`;
const bodyEntries = cells.map((cell, t) => `b${t}: ${frame(cell, 0, true)},`).join('\n');
const detailEntries = cells
  .flatMap((cell, t) =>
    LIGHT_STATES.map((state, s) => `'d${t}-${state}': ${frame(cell, s * detailRow, false)},`),
  )
  .join('\n');
const moduleSource = `// Generated by \`yarn tsx scripts/build-sprites.ts\` (\`yarn sprites:build\`). Do not edit by hand.
// Sprites point north and are drawn at PX_PER_M px per metre with the footprint centred in its cell.
// Draw the body atlas (vehicles.png, mask: true, tinted) and then the detail atlas
// (vehicle-details.png, unmasked) with the same position/angle and getSize = SPRITE_SIZE_M[type]
// in sizeUnits 'meters'; both cells share size and anchor so they overlay pixel-perfectly.

export const PX_PER_M = ${PX_PER_M};

export const LIGHT_STATES = [${LIGHT_STATES.map((s) => `'${s}'`).join(', ')}] as const;
export type LightState = (typeof LIGHT_STATES)[number];

export interface BodyFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  mask: true;
}
export interface DetailFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  mask: false;
}

/** Body atlas (${atlasWidth}×${rowHeight}): white silhouettes keyed \`b{type}\`. */
export const BODY_MAPPING: Record<string, BodyFrame> = {
${bodyEntries}
};

/** Detail atlas (${atlasWidth}×${detailRow * LIGHT_STATES.length - GUTTER}): overlays keyed \`d{type}-{state}\`. */
export const DETAIL_MAPPING: Record<string, DetailFrame> = {
${detailEntries}
};

/** Cell height in metres per vehicle type: the IconLayer \`getSize\` for true scale. */
export const SPRITE_SIZE_M: number[] = [${cells.map((c) => c.height / PX_PER_M).join(', ')}];

export const bodyIcon = (type: number) => \`b\${type}\`;

/** Detail frame key; indicator -1 = left, 1 = right, 0 = off. */
export function detailIcon(type: number, braking: boolean, indicator: -1 | 0 | 1): string {
  const side = indicator < 0 ? 'left' : indicator > 0 ? 'right' : '';
  const state = braking ? (side ? \`brake-\${side}\` : 'brake') : side || 'none';
  return \`d\${type}-\${state}\`;
}
`;
const modulePath = 'src/lib/vehicleSprites.ts';
await writeFile(
  modulePath,
  await format(moduleSource, { ...(await resolveConfig(modulePath)), filepath: modulePath }),
);

await sharp(await readFile('public/icon.svg'))
  .resize(180, 180)
  .png()
  .toFile('public/apple-icon.png');
