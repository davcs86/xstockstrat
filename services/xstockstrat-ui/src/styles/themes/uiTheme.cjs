'use strict';
// Build-time theme helper shared by next.config.js, the bundle checker, vitest and e2e. It must stay
// dependency-free (fs/path only): CI runs it on a host with no `pnpm install`.

const fs = require('fs');
const path = require('path');

const THEMES = ['staging', 'production'];

function resolveUiTheme(v) {
  if (v === undefined) return 'staging';
  if (THEMES.includes(v)) return v;
  throw new Error(`UI_THEME must be one of "staging", "production" (got "${v}")`);
}

// ---------------------------------------------------------------------------------------------
// Tokenizer

/** Replace comments with spaces, keeping byte offsets stable. Strings are left intact. */
function blankComments(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const end = skipString(css, i);
      out += css.slice(i, end);
      i = end;
    } else if (ch === '\\') {
      out += css.slice(i, i + 2);
      i += 2;
    } else if (ch === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      const end = close === -1 ? css.length : close + 2;
      out += css.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/** Index just past the string literal that starts at `i` (handles `\` escapes). */
function skipString(s, i) {
  const quote = s[i];
  let j = i + 1;
  while (j < s.length && s[j] !== quote) j += s[j] === '\\' ? 2 : 1;
  return Math.min(j + 1, s.length);
}

/** Index of the `)` matching the `(` at `open`, skipping strings and escapes. */
function matchParen(s, open) {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    const ch = s[j];
    if (ch === '"' || ch === "'") j = skipString(s, j) - 1;
    else if (ch === '\\') j += 1;
    else if (ch === '(') depth += 1;
    else if (ch === ')' && --depth === 0) return j;
  }
  return s.length;
}

const DECL_NAME = /^-{0,2}[A-Za-z_][\w-]*$/;

function pushDeclaration(out, css, start, end) {
  const seg = css.slice(start, end);
  const colon = seg.indexOf(':');
  if (colon === -1) return;
  const name = seg.slice(0, colon).trim();
  if (!DECL_NAME.test(name)) return;
  let rel = colon + 1;
  while (rel < seg.length && /\s/.test(seg[rel])) rel += 1;
  const value = seg
    .slice(rel)
    .replace(/\s*!\s*important\s*$/i, '')
    .trimEnd();
  out.push({ name, value, valueOffset: start + rel });
}

/**
 * Every declaration in `css`, at any nesting depth, as {name, value, valueOffset}. Preludes
 * (selectors, at-rule conditions) are never returned or scanned.
 */
function cssDeclarations(css) {
  const src = blankComments(css);
  const out = [];
  let blockDepth = 0;
  let parenDepth = 0;
  let segStart = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      i = skipString(src, i) - 1;
    } else if (ch === '\\') {
      i += 1;
    } else if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (parenDepth === 0 && ch === '{') {
      blockDepth += 1;
      segStart = i + 1;
    } else if (parenDepth === 0 && (ch === ';' || ch === '}')) {
      if (blockDepth > 0) pushDeclaration(out, src, segStart, i);
      if (ch === '}') blockDepth = Math.max(0, blockDepth - 1);
      segStart = i + 1;
    }
  }
  return out;
}

const COLOR_FUNCTIONS = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'oklch',
  'oklab',
  'lab',
  'lch',
  'hwb',
  'color',
]);
const IDENT_START = /[A-Za-z_-]/;
const IDENT_CHAR = /[\w-]/;

/** Split `s` on depth-0 commas, returning {text, start} pieces. */
function splitTopLevel(s) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'") i = skipString(s, i) - 1;
    else if (ch === '\\') i += 1;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push({ text: s.slice(start, i), start });
      start = i + 1;
    }
  }
  parts.push({ text: s.slice(start), start });
  return parts;
}

/** Colour literals in a declaration value, as {text, offset} (offset = valueOffset + index). */
function colorLiterals(value, valueOffset = 0) {
  const out = [];
  let i = 0;
  while (i < value.length) {
    const ch = value[i];
    if (ch === '"' || ch === "'") {
      i = skipString(value, i);
    } else if (ch === '\\') {
      i += 2;
    } else if (ch === '#') {
      let j = i + 1;
      while (j < value.length && /[0-9a-fA-F]/.test(value[j])) j += 1;
      const len = j - i - 1;
      if ([3, 4, 6, 8].includes(len) && !(j < value.length && IDENT_CHAR.test(value[j]))) {
        out.push({ text: value.slice(i, j), offset: valueOffset + i });
      }
      while (j < value.length && IDENT_CHAR.test(value[j])) j += 1;
      i = j;
    } else if (IDENT_START.test(ch) && !(i > 0 && IDENT_CHAR.test(value[i - 1]))) {
      let j = i + 1;
      while (j < value.length && IDENT_CHAR.test(value[j])) j += 1;
      if (value[j] !== '(') {
        i = j;
        continue;
      }
      const fn = value.slice(i, j).toLowerCase();
      const close = matchParen(value, j);
      const args = value.slice(j + 1, close);
      const argsOffset = valueOffset + j + 1;
      if (fn === 'url') {
        // skipped as a unit
      } else if (COLOR_FUNCTIONS.has(fn)) {
        const nested = /[A-Za-z_-][\w-]*\(/.test(args) || /\bfrom\b/i.test(args);
        if (!nested) out.push({ text: value.slice(i, close + 1), offset: valueOffset + i });
      } else if (fn === 'color-mix') {
        for (const part of splitTopLevel(args).slice(1)) {
          const operand = part.text.replace(/\s+[\d.]+%\s*$/, '');
          out.push(...colorLiterals(operand, argsOffset + part.start));
        }
      } else {
        out.push(...colorLiterals(args, argsOffset));
      }
      i = close + 1;
    } else {
      i += 1;
    }
  }
  return out;
}

/** The custom properties of the single `:root{}` block in `css`, in declaration order. */
function parseRootTokens(css) {
  const src = blankComments(css);
  const open = src.search(/:root\s*\{/);
  if (open === -1) throw new Error('no :root block');
  const start = src.indexOf('{', open);
  const close = src.indexOf('}', start);
  const map = new Map();
  for (const d of cssDeclarations(src)) {
    if (d.valueOffset > start && d.valueOffset < close && d.name.startsWith('--'))
      map.set(d.name, d.value);
  }
  return map;
}

// ---------------------------------------------------------------------------------------------
// Colour maths

function unsupported(where) {
  return new Error(`unsupported colour syntax at ${where}`);
}

function parseNumber(tok, pctScale, where) {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg)?$/i.exec(tok);
  if (!m) throw unsupported(where);
  const n = parseFloat(m[1]);
  return m[2] === '%' ? (n / 100) * pctScale : n;
}

function parseAlpha(tok, where) {
  return tok === undefined ? 1 : Math.min(1, Math.max(0, parseNumber(tok, 1, where)));
}

/** Split colour-function arguments into channel tokens and an optional alpha token. */
function channelTokens(args) {
  if (args.includes(',')) {
    const parts = args.split(',').map((p) => p.trim());
    return { ch: parts.slice(0, 3), alpha: parts[3] };
  }
  const [main, alpha] = args.split('/');
  return { ch: main.trim().split(/\s+/), alpha: alpha === undefined ? undefined : alpha.trim() };
}

const toByte = (c) => Math.min(1, Math.max(0, c)) * 255;
const gamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function oklchToSrgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function hslToSrgb(H, S, L) {
  const k = (n) => (n + H / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n) => L - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

/** Parse a colour literal to {r,g,b} in 0–255 (clamped, unrounded) and alpha a in 0–1. */
function cssColorToSrgb(text, where = 'input') {
  const t = String(text).trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(t);
  if (hex) {
    let h = hex[1];
    if (![3, 4, 6, 8].includes(h.length)) throw unsupported(where);
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^([a-z-]+)\((.*)\)$/is.exec(t);
  if (!fn) throw unsupported(where);
  const name = fn[1].toLowerCase();
  const { ch, alpha } = channelTokens(fn[2]);
  if (ch.length !== 3) throw unsupported(where);
  let rgb;
  if (name === 'rgb' || name === 'rgba') {
    rgb = ch.map((c) => parseNumber(c, 255, where) / 255);
  } else if (name === 'hsl' || name === 'hsla') {
    rgb = hslToSrgb(
      parseNumber(ch[0], 1, where),
      parseNumber(ch[1], 1, where),
      parseNumber(ch[2], 1, where),
    );
  } else if (name === 'oklch') {
    rgb = oklchToSrgb(
      parseNumber(ch[0], 1, where),
      parseNumber(ch[1], 0.4, where),
      parseNumber(ch[2], 1, where),
    );
  } else {
    throw unsupported(where);
  }
  const [r, g, b] = rgb.map(toByte);
  return { r, g, b, a: parseAlpha(alpha, where) };
}

function themeCssPath(theme) {
  return path.join(__dirname, `${resolveUiTheme(theme)}.css`);
}

/** The theme's `--background` as lowercase `#rrggbb` (PWA chrome colour, FR-12). */
function themeBackgroundHex(theme) {
  const bg = parseRootTokens(fs.readFileSync(themeCssPath(theme), 'utf8')).get('--background');
  const { r, g, b } = cssColorToSrgb(bg, themeCssPath(theme));
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

const asColor = (x) => (typeof x === 'string' ? cssColorToSrgb(x) : x);

function relativeLuminance(c) {
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const { r, g, b } = asColor(c);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(x, y) {
  const [hi, lo] = [relativeLuminance(x), relativeLuminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/** sRGB channels (rounded 0–255) each within ±1 and alpha within ±0.01. */
function colorsEqual(x, y) {
  const a = asColor(x);
  const b = asColor(y);
  return (
    ['r', 'g', 'b'].every((k) => Math.abs(Math.round(a[k]) - Math.round(b[k])) <= 1) &&
    Math.abs(a.a - b.a) <= 0.01
  );
}

module.exports = {
  resolveUiTheme,
  parseRootTokens,
  cssDeclarations,
  colorLiterals,
  cssColorToSrgb,
  relativeLuminance,
  contrastRatio,
  colorsEqual,
  themeCssPath,
  themeBackgroundHex,
};
