'use strict';

const { cssColorToSrgb } = require('./uiTheme.cjs');

// Severity-1.0 matrices of Machado, Oliveira and Fernandes (2009), transcribed from the colour-science
// 0.4.7 package, colour/blindness/datasets/machado2010.py (Deuteranomaly / Protanomaly at 1.0).
const MACHADO = {
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

// Bruce Lindbloom, "RGB/XYZ Matrices", sRGB / D65 row (brucelindbloom.com/Eqn_RGB_XYZ_Matrix.html).
const SRGB_TO_XYZ = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
];
// White point is the matrix's row sums (D-21), so sRGB white maps to L=100, a=b=0 exactly.
const WHITE = SRGB_TO_XYZ.map((row) => row[0] + row[1] + row[2]);

const decode = (s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
const encode = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

const mul = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const linear = ({ r, g, b }) => [r, g, b].map((v) => decode(v / 255));

function simulate(srgb, sim) {
  if (sim === 'normal') return srgb;
  const m = MACHADO[sim];
  if (!m) throw new Error(`unknown simulation: ${sim}`);
  const [r, g, b] = mul(m, linear(srgb)).map((c) => encode(Math.min(1, Math.max(0, c))) * 255);
  return { r, g, b };
}

function toLab(srgb) {
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = mul(SRGB_TO_XYZ, linear(srgb)).map((v, i) => f(v / WHITE[i]));
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const RAD = Math.PI / 180;
const hueDeg = (b, a) => (a === 0 && b === 0 ? 0 : (((Math.atan2(b, a) / RAD) % 360) + 360) % 360);

function ciede2000([L1, a1, b1], [L2, a2, b2]) {
  const Cbar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = hueDeg(b1, a1p);
  const h2p = hueDeg(b2, a2p);
  const zero = C1p * C2p === 0;

  let dhp = h2p - h1p;
  if (zero) dhp = 0;
  else if (dhp > 180) dhp -= 360;
  else if (dhp < -180) dhp += 360;
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * RAD);

  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (!zero) {
    if (Math.abs(h1p - h2p) <= 180) hbp /= 2;
    else hbp = hbp < 360 ? (hbp + 360) / 2 : (hbp - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbp - 30) * RAD) +
    0.24 * Math.cos(2 * hbp * RAD) +
    0.32 * Math.cos((3 * hbp + 6) * RAD) -
    0.2 * Math.cos((4 * hbp - 63) * RAD);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * dTheta * RAD) * RC;
  const l = dLp / SL;
  const c = dCp / SC;
  const h = dHp / SH;
  return Math.sqrt(l * l + c * c + h * h + RT * c * h);
}

function pairDistances(colors, sim) {
  const labs = colors.map((text) => toLab(simulate(cssColorToSrgb(text), sim)));
  const out = [];
  for (let i = 0; i < labs.length; i++) {
    for (let j = i + 1; j < labs.length; j++) {
      const adjacent = j - i === 1 || (i === 0 && j === labs.length - 1);
      out.push({ i, j, adjacent, dE: ciede2000(labs[i], labs[j]) });
    }
  }
  return out;
}

module.exports = { MACHADO, simulate, toLab, ciede2000, pairDistances };
