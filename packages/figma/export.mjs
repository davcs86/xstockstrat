#!/usr/bin/env node
/**
 * packages/figma/export.mjs
 *
 * Exports xstockstrat design tokens and component metadata to a Figma file
 * using the Figma Variables REST API (v1).
 *
 * Usage:
 *   FIGMA_API_KEY=<token> FIGMA_FILE_KEY=<fileKey> node export.mjs
 *
 * What it does:
 *   1. Reads tokens.json (W3C DTCG format)
 *   2. Creates/updates a "xstockstrat / Colors" variable collection in Figma
 *      with one "Default (Dark)" mode
 *   3. Creates/updates a "xstockstrat / Radius" variable collection
 *   4. Prints a summary of created/updated variables
 *
 * Requirements:
 *   - Node.js 18+ (uses native fetch)
 *   - A Figma file that your FIGMA_API_KEY has edit access to
 *   - The Figma Variables REST API is currently in Beta — enable via
 *     Figma → Developer settings → Enable Variables REST API
 *
 * Figma API docs:
 *   https://www.figma.com/developers/api#variables
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const FIGMA_API_KEY = process.env.FIGMA_API_KEY;
const FIGMA_FILE_KEY = process.env.FIGMA_FILE_KEY;
const FIGMA_API_BASE = 'https://api.figma.com/v1';

if (!FIGMA_API_KEY || !FIGMA_FILE_KEY) {
  console.error('ERROR: Set FIGMA_API_KEY and FIGMA_FILE_KEY environment variables.');
  console.error('  FIGMA_API_KEY  — Personal Access Token from Figma → Account settings → Personal access tokens');
  console.error('  FIGMA_FILE_KEY — The key from your Figma file URL: figma.com/file/<FIGMA_FILE_KEY>/...');
  process.exit(1);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Convert an HSL string ("hsl(H, S%, L%)") to a Figma RGBA object {r,g,b,a}
 * where each channel is in [0, 1].
 */
function hslStringToFigmaColor(hslStr) {
  const match = hslStr.match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/i);
  if (!match) throw new Error(`Cannot parse HSL value: "${hslStr}"`);
  const h = parseFloat(match[1]);
  const s = parseFloat(match[2]) / 100;
  const l = parseFloat(match[3]) / 100;

  // HSL → RGB
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));

  return { r: f(0), g: f(8), b: f(4), a: 1 };
}

/**
 * Convert a dimension string ("0.5rem", "calc(0.5rem - 2px)") to a pixel float.
 * Approximation: 1rem = 16px. calc() expressions are simplified.
 */
function dimensionToPixels(value) {
  if (value.startsWith('calc(')) {
    // e.g. calc(0.5rem - 2px) → "0.5rem - 2px"
    const inner = value.slice(5, -1).trim();
    const parts = inner.split(/\s*([-+])\s*/);
    let px = 0;
    let sign = 1;
    for (const part of parts) {
      if (part === '-') { sign = -1; continue; }
      if (part === '+') { sign = 1; continue; }
      if (part.endsWith('rem')) px += sign * parseFloat(part) * 16;
      else if (part.endsWith('px')) px += sign * parseFloat(part);
      sign = 1;
    }
    return px;
  }
  if (value.endsWith('rem')) return parseFloat(value) * 16;
  if (value.endsWith('px')) return parseFloat(value);
  return parseFloat(value);
}

async function figmaRequest(method, path, body) {
  const url = `${FIGMA_API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'X-Figma-Token': FIGMA_API_KEY,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!res.ok) {
    console.error(`Figma API ${method} ${path} → HTTP ${res.status}`);
    console.error(JSON.stringify(json, null, 2));
    throw new Error(`Figma API error: ${res.status}`);
  }
  return json;
}

// ── Main export ───────────────────────────────────────────────────────────────

async function main() {
  const tokens = JSON.parse(readFileSync(join(__dirname, 'tokens.json'), 'utf8'));

  console.log('xstockstrat → Figma token export');
  console.log(`  File key : ${FIGMA_FILE_KEY}`);
  console.log(`  API base : ${FIGMA_API_BASE}\n`);

  // ── Step 1: Fetch existing local variables ─────────────────────────────────
  console.log('Fetching existing Figma variables…');
  const existing = await figmaRequest('GET', `/files/${FIGMA_FILE_KEY}/variables/local`);

  const existingCollections = Object.values(existing.meta?.variableCollections ?? {});
  const existingVariables = Object.values(existing.meta?.variables ?? {});

  const findCollection = (name) => existingCollections.find((c) => c.name === name);
  const findVariable = (collectionId, name) =>
    existingVariables.find((v) => v.variableCollectionId === collectionId && v.name === name);

  // ── Step 2: Build POST payload ─────────────────────────────────────────────

  const variableCollections = [];
  const variableModes = [];
  const variables = [];
  const variableModeValues = [];

  // Temporary IDs for new entities (Figma requires a unique string per POST)
  let tempId = 0;
  const tempCollectionId = () => `collection_${++tempId}`;
  const tempModeId = () => `mode_${++tempId}`;
  const tempVarId = () => `variable_${++tempId}`;

  // ── Color collection ───────────────────────────────────────────────────────
  const colorCollectionName = 'xstockstrat / Colors';
  let colorCollection = findCollection(colorCollectionName);
  let colorCollectionId;
  let colorModeId;

  if (colorCollection) {
    colorCollectionId = colorCollection.id;
    colorModeId = colorCollection.defaultModeId;
    console.log(`  ✓ Reusing existing collection: "${colorCollectionName}" (${colorCollectionId})`);
  } else {
    colorCollectionId = tempCollectionId();
    colorModeId = tempModeId();
    variableCollections.push({
      action: 'CREATE',
      id: colorCollectionId,
      name: colorCollectionName,
      initialModeId: colorModeId,
    });
    variableModes.push({
      action: 'UPDATE',
      id: colorModeId,
      name: 'Default (Dark)',
      variableCollectionId: colorCollectionId,
    });
    console.log(`  + Creating collection: "${colorCollectionName}"`);
  }

  for (const [tokenName, tokenDef] of Object.entries(tokens.color)) {
    if (tokenName.startsWith('$')) continue;
    if (tokenDef.$type && tokenDef.$type !== 'color') continue;

    const varName = `color/${tokenName}`;
    const figmaColor = hslStringToFigmaColor(tokenDef.$value);
    const existingVar = findVariable(colorCollectionId, varName);

    if (existingVar) {
      // Update existing variable value
      variableModeValues.push({
        action: 'UPDATE',
        variableId: existingVar.id,
        modeId: colorModeId,
        value: figmaColor,
      });
      console.log(`  ~ Update: ${varName}`);
    } else {
      const varId = tempVarId();
      variables.push({
        action: 'CREATE',
        id: varId,
        name: varName,
        variableCollectionId: colorCollectionId,
        resolvedType: 'COLOR',
        description: tokenDef.$description ?? '',
      });
      variableModeValues.push({
        action: 'CREATE',
        variableId: varId,
        modeId: colorModeId,
        value: figmaColor,
      });
      console.log(`  + Create: ${varName}`);
    }
  }

  // ── Radius collection ──────────────────────────────────────────────────────
  const radiusCollectionName = 'xstockstrat / Radius';
  let radiusCollection = findCollection(radiusCollectionName);
  let radiusCollectionId;
  let radiusModeId;

  if (radiusCollection) {
    radiusCollectionId = radiusCollection.id;
    radiusModeId = radiusCollection.defaultModeId;
    console.log(`  ✓ Reusing existing collection: "${radiusCollectionName}" (${radiusCollectionId})`);
  } else {
    radiusCollectionId = tempCollectionId();
    radiusModeId = tempModeId();
    variableCollections.push({
      action: 'CREATE',
      id: radiusCollectionId,
      name: radiusCollectionName,
      initialModeId: radiusModeId,
    });
    variableModes.push({
      action: 'UPDATE',
      id: radiusModeId,
      name: 'Default',
      variableCollectionId: radiusCollectionId,
    });
    console.log(`  + Creating collection: "${radiusCollectionName}"`);
  }

  for (const [tokenName, tokenDef] of Object.entries(tokens.radius)) {
    if (tokenName.startsWith('$')) continue;
    const varName = `radius/${tokenName}`;
    const px = dimensionToPixels(tokenDef.$value);
    const existingVar = findVariable(radiusCollectionId, varName);

    if (existingVar) {
      variableModeValues.push({
        action: 'UPDATE',
        variableId: existingVar.id,
        modeId: radiusModeId,
        value: px,
      });
      console.log(`  ~ Update: ${varName} → ${px}px`);
    } else {
      const varId = tempVarId();
      variables.push({
        action: 'CREATE',
        id: varId,
        name: varName,
        variableCollectionId: radiusCollectionId,
        resolvedType: 'FLOAT',
        description: tokenDef.$description ?? '',
      });
      variableModeValues.push({
        action: 'CREATE',
        variableId: varId,
        modeId: radiusModeId,
        value: px,
      });
      console.log(`  + Create: ${varName} → ${px}px`);
    }
  }

  // ── Step 3: POST to Figma ──────────────────────────────────────────────────
  const payload = { variableCollections, variableModes, variables, variableModeValues };

  const totalActions =
    variableCollections.length + variableModes.length + variables.length + variableModeValues.length;

  if (totalActions === 0) {
    console.log('\nNothing to update — all variables are already in sync.');
    return;
  }

  console.log(`\nPosting ${variables.length} variable(s) across ${variableCollections.length} new collection(s)…`);

  const result = await figmaRequest('POST', `/files/${FIGMA_FILE_KEY}/variables`, payload);

  console.log('\nFigma response:');
  console.log(JSON.stringify(result, null, 2));
  console.log('\nExport complete.');
  console.log(`Open your Figma file → Assets panel → Local variables to see the "xstockstrat / Colors" and "xstockstrat / Radius" collections.`);
}

main().catch((err) => {
  console.error('\nExport failed:', err.message);
  process.exit(1);
});
