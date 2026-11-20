import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

type Srgb = { r: number; g: number; b: number };
type Lab = [number, number, number];
type Sim = 'normal' | 'deuteranopia' | 'protanopia';
type Matrix = number[][];

const req = createRequire(import.meta.url);
const cv = req('./colorVision.cjs') as {
  MACHADO: Record<'deuteranopia' | 'protanopia', Matrix>;
  simulate: (srgb: Srgb, sim: Sim) => Srgb;
  toLab: (srgb: Srgb) => Lab;
  ciede2000: (lab1: Lab, lab2: Lab) => number;
  pairDistances: (
    colors: string[],
    sim: Sim,
  ) => { i: number; j: number; adjacent: boolean; dE: number }[];
};
const ui = req('./uiTheme.cjs') as {
  cssColorToSrgb: (text: string) => Srgb & { a: number };
};

const CVD = ['deuteranopia', 'protanopia'] as const;

function expectWithin(actual: number[], expected: number[], tol: number) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((v, k) => expect(Math.abs(v - expected[k])).toBeLessThanOrEqual(tol));
}
const channels = ({ r, g, b }: Srgb) => [r, g, b];

// Sharma, Wu and Dalal (2005), Table 1, verbatim from ciede2000testdata.txt (sha256 44aebb39…a4b8):
// L1 a1 b1 L2 a2 b2 dE. Keep the text byte-for-byte; reformatting the numbers hides transcription errors.
const SHARMA_2005 = `
50.0000 2.6772 -79.7751 50.0000 0.0000 -82.7485 2.0425
50.0000 3.1571 -77.2803 50.0000 0.0000 -82.7485 2.8615
50.0000 2.8361 -74.0200 50.0000 0.0000 -82.7485 3.4412
50.0000 -1.3802 -84.2814 50.0000 0.0000 -82.7485 1.0000
50.0000 -1.1848 -84.8006 50.0000 0.0000 -82.7485 1.0000
50.0000 -0.9009 -85.5211 50.0000 0.0000 -82.7485 1.0000
50.0000 0.0000 0.0000 50.0000 -1.0000 2.0000 2.3669
50.0000 -1.0000 2.0000 50.0000 0.0000 0.0000 2.3669
50.0000 2.4900 -0.0010 50.0000 -2.4900 0.0009 7.1792
50.0000 2.4900 -0.0010 50.0000 -2.4900 0.0010 7.1792
50.0000 2.4900 -0.0010 50.0000 -2.4900 0.0011 7.2195
50.0000 2.4900 -0.0010 50.0000 -2.4900 0.0012 7.2195
50.0000 -0.0010 2.4900 50.0000 0.0009 -2.4900 4.8045
50.0000 -0.0010 2.4900 50.0000 0.0010 -2.4900 4.8045
50.0000 -0.0010 2.4900 50.0000 0.0011 -2.4900 4.7461
50.0000 2.5000 0.0000 50.0000 0.0000 -2.5000 4.3065
50.0000 2.5000 0.0000 73.0000 25.0000 -18.0000 27.1492
50.0000 2.5000 0.0000 61.0000 -5.0000 29.0000 22.8977
50.0000 2.5000 0.0000 56.0000 -27.0000 -3.0000 31.9030
50.0000 2.5000 0.0000 58.0000 24.0000 15.0000 19.4535
50.0000 2.5000 0.0000 50.0000 3.1736 0.5854 1.0000
50.0000 2.5000 0.0000 50.0000 3.2972 0.0000 1.0000
50.0000 2.5000 0.0000 50.0000 1.8634 0.5757 1.0000
50.0000 2.5000 0.0000 50.0000 3.2592 0.3350 1.0000
60.2574 -34.0099 36.2677 60.4626 -34.1751 39.4387 1.2644
63.0109 -31.0961 -5.8663 62.8187 -29.7946 -4.0864 1.2630
61.2901 3.7196 -5.3901 61.4292 2.2480 -4.9620 1.8731
35.0831 -44.1164 3.7933 35.0232 -40.0716 1.5901 1.8645
22.7233 20.0904 -46.6940 23.0331 14.9730 -42.5619 2.0373
36.4612 47.8580 18.3852 36.2715 50.5065 21.2231 1.4146
90.8027 -2.0831 1.4410 91.1528 -1.6435 0.0447 1.4441
90.9257 -0.5406 -0.9208 88.6381 -0.8985 -0.7239 1.5381
6.7747 -0.2908 -2.4247 5.8714 -0.0985 -2.2286 0.6377
2.0776 0.0795 -1.1350 0.9033 -0.0636 -0.5514 0.9082
`
  .trim()
  .split('\n')
  .map((line) => line.trim().split(/\s+/).map(Number));

// Severity-1.0 matrices of Machado, Oliveira and Fernandes (2009), from colour-science 0.4.7,
// colour/blindness/datasets/machado2010.py (Deuteranomaly / Protanomaly at 1.0).
const PUBLISHED_MACHADO: Record<(typeof CVD)[number], Matrix> = {
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
};

// colour-science 0.4.7: colour.XYZ_to_Lab(M @ colour.models.eotf_sRGB(rgb / 255),
// illuminant=colour.XYZ_to_xy(M.sum(axis=1))), M = Lindbloom sRGB/D65; not the package's default matrix.
const LAB_PINS: [string, Lab][] = [
  ['rgb(255 0 0)', [53.2408, 80.0925, 67.2032]],
  ['rgb(0 255 0)', [87.7347, -86.1827, 83.1793]],
  ['rgb(0 0 255)', [32.297, 79.1875, -107.8602]],
  ['rgb(128 128 128)', [53.585, 0, 0]],
];

const decode = (s: number) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
const encode = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

describe('colorVision reference pins', () => {
  it.each(SHARMA_2005)(
    'ciede2000 matches Sharma (2005): %f %f %f vs %f %f %f = %f',
    (L1, a1, b1, L2, a2, b2, dE) => {
      expect(cv.ciede2000([L1, a1, b1], [L2, a2, b2])).toBeCloseTo(dE, 4);
    },
  );

  it.each(CVD)('MACHADO.%s equals the published severity-1.0 matrix', (type) => {
    expect(cv.MACHADO[type]).toEqual(PUBLISHED_MACHADO[type]);
  });

  it.each(CVD.flatMap((type) => ['rgb(255 255 255)', 'rgb(0 0 0)'].map((c) => [type, c] as const)))(
    '%s keeps %s fixed',
    (type, color) => {
      const srgb = ui.cssColorToSrgb(color);
      expectWithin(channels(cv.simulate(srgb, type)), channels(srgb), 0.01);
    },
  );

  it.each(LAB_PINS)('toLab(%s) matches the pinned Lab', (color, lab) => {
    expectWithin(cv.toLab(ui.cssColorToSrgb(color)), lab, 0.01);
  });

  it.each(CVD.flatMap((type) => [255, 128].map((red) => [type, red] as const)))(
    '%s of rgb(%i 0 0) follows the published red column',
    (type, red) => {
      const lin = red === 255 ? 1 : decode(red / 255);
      const expected = PUBLISHED_MACHADO[type].map(
        (row) => encode(Math.min(1, Math.max(0, lin * row[0]))) * 255,
      );
      const actual = cv.simulate(ui.cssColorToSrgb(`rgb(${red} 0 0)`), type);
      expectWithin(channels(actual), expected, 0.01);
    },
  );

  it('pairDistances returns every pair with the wrap marked adjacent', () => {
    const rows = cv.pairDistances(
      ['rgb(255 0 0)', 'rgb(0 255 0)', 'rgb(0 0 255)', 'rgb(128 128 128)'],
      'normal',
    );
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.i).toBeLessThan(row.j);
      expect(Number.isFinite(row.dE)).toBe(true);
      expect(row.dE).toBeGreaterThan(0);
    }
    const adjacent = Object.fromEntries(rows.map((r) => [`${r.i},${r.j}`, r.adjacent]));
    expect(adjacent).toEqual({
      '0,1': true,
      '1,2': true,
      '2,3': true,
      '0,3': true,
      '0,2': false,
      '1,3': false,
    });
  });
});
