'use strict';
// Post-build gate chained into `pnpm build`: fails the build when the emitted CSS breaks the theme
// contract (feature 307). Sources resolve from __dirname so the result is independent of cwd.

const fs = require('fs');
const path = require('path');
const {
  resolveUiTheme,
  parseRootTokens,
  cssDeclarations,
  colorLiterals,
  cssColorToSrgb,
  colorsEqual,
  themeCssPath,
} = require('./uiTheme.cjs');

const SHARED_ROLES = ['--color-buy', '--color-sell', '--color-paper', '--color-warning'];
const NON_LITERAL = /var\(|calc\(/;

function sharedLiterals(globalsCss) {
  const values = new Map();
  for (const d of cssDeclarations(globalsCss)) {
    if (SHARED_ROLES.includes(d.name) && !NON_LITERAL.test(d.value)) values.set(d.name, d.value);
  }
  return values;
}

/** Check (c): every shared order-side role is emitted and colour-equals its globals.css literal. */
function checkShared(decls, sources) {
  const failures = [];
  const expected = sharedLiterals(sources.globalsCss);
  for (const role of SHARED_ROLES) {
    const want = expected.get(role);
    if (!want) {
      failures.push(`shared colour ${role} is not declared in globals.css`);
      continue;
    }
    const literal = decls.filter((d) => d.name === role && !NON_LITERAL.test(d.value));
    if (literal.length === 0) failures.push(`shared colour ${role} is not emitted in the bundle`);
    for (const d of literal) {
      if (!colorsEqual(d.value, want)) {
        failures.push(
          `shared colour ${role} at ${d.file}:${d.valueOffset} is ${d.value}, expected ${want}`,
        );
      }
    }
  }
  return failures;
}

const LENGTH = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i;
const normaliseLength = (v) => {
  const m = LENGTH.exec(v.trim());
  return m ? `${parseFloat(m[1])}${m[2].toLowerCase()}` : null;
};
const isLiteralToken = (T, d) => T.has(d.name) && !NON_LITERAL.test(d.value);

/** N: every colour token whose staging and production values differ, for both themes. */
function nonSharedTokens(themeTokens) {
  const N = [];
  for (const [name, stagingValue] of themeTokens.staging) {
    if (name === '--radius') continue;
    const productionValue = themeTokens.production.get(name);
    if (colorsEqual(stagingValue, productionValue)) continue;
    N.push({ theme: 'staging', name, color: cssColorToSrgb(stagingValue, `staging.css ${name}`) });
    N.push({
      theme: 'production',
      name,
      color: cssColorToSrgb(productionValue, `production.css ${name}`),
    });
  }
  return N;
}

/** Check (a): every literal token declaration equals the selected theme's value; each is declared. */
function checkSelected(decls, T, selected, theme) {
  const failures = [];
  const declared = new Set();
  for (const d of decls) {
    if (!isLiteralToken(T, d)) continue;
    declared.add(d.name);
    const want = selected.get(d.name);
    const where = `${d.file}:${d.valueOffset}`;
    if (d.name === '--radius') {
      const got = normaliseLength(d.value);
      if (got === null) failures.push(`unparseable token value ${d.value} at ${where}`);
      else if (got !== normaliseLength(want)) {
        failures.push(
          `theme token ${d.name} at ${where} is ${d.value}, expected ${theme} value ${want}`,
        );
      }
      continue;
    }
    let got;
    try {
      got = cssColorToSrgb(d.value, where);
    } catch {
      failures.push(`unparseable token value ${d.value} at ${where}`);
      continue;
    }
    if (!colorsEqual(got, want)) {
      failures.push(
        `theme token ${d.name} at ${where} is ${d.value}, expected ${theme} value ${want}`,
      );
    }
  }
  for (const name of selected.keys()) {
    if (!declared.has(name)) failures.push(`theme token ${name} has no literal declaration`);
  }
  return failures;
}

/** Check (b): no colour literal outside the token declarations equals a non-shared token. */
function checkHardcoded(decls, T, N) {
  const failures = [];
  for (const d of decls) {
    if (isLiteralToken(T, d)) continue;
    for (const lit of colorLiterals(d.value, d.valueOffset)) {
      const where = `${d.file}:${lit.offset}`;
      let color;
      try {
        color = cssColorToSrgb(lit.text, where);
      } catch (err) {
        failures.push(err.message);
        continue;
      }
      for (const n of N) {
        if (colorsEqual(color, n.color)) {
          failures.push(
            `colour literal ${lit.text} at ${where} equals ${n.theme} ${n.name}; use the theme token`,
          );
        }
      }
    }
  }
  return failures;
}

/** All failures for the emitted `cssFiles` ({file, css}) built for `theme`. */
function checkBundle(cssFiles, theme, sources) {
  resolveUiTheme(theme);
  const decls = cssFiles.flatMap(({ file, css }) =>
    cssDeclarations(css).map((d) => ({ ...d, file })),
  );
  const themeTokens = {
    staging: parseRootTokens(sources.stagingCss),
    production: parseRootTokens(sources.productionCss),
  };
  const T = new Set([...themeTokens.staging.keys(), ...themeTokens.production.keys()]);
  return [
    ...checkSelected(decls, T, themeTokens[theme], theme),
    ...checkHardcoded(decls, T, nonSharedTokens(themeTokens)),
    ...checkShared(decls, sources),
  ];
}

function loadSources() {
  const read = (file) => fs.readFileSync(file, 'utf8');
  return {
    globalsCss: read(path.join(__dirname, '..', '..', 'app', 'globals.css')),
    stagingCss: read(themeCssPath('staging')),
    productionCss: read(themeCssPath('production')),
  };
}

function main(argv) {
  const at = argv.indexOf('--css-dir');
  const dir = path.resolve(at === -1 ? path.join('.next', 'static', 'css') : argv[at + 1]);
  const theme = resolveUiTheme(process.env.UI_THEME);
  const files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { recursive: true })
        .map(String)
        .filter((f) => f.endsWith('.css'))
        .sort()
    : [];
  if (files.length === 0) {
    console.error(`checkThemeBundle: no CSS under ${dir}`);
    return 1;
  }
  const cssFiles = files.map((f) => ({ file: f, css: fs.readFileSync(path.join(dir, f), 'utf8') }));
  const failures = checkBundle(cssFiles, theme, loadSources());
  if (failures.length > 0) {
    for (const f of failures) console.error(`checkThemeBundle: ${f}`);
    return 1;
  }
  console.log(`checkThemeBundle: ${theme} bundle OK (${files.length} css files)`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { checkBundle, loadSources, main };
