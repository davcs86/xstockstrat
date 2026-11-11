'use strict';
// Post-build gate chained into `pnpm build`: fails the build when the emitted CSS breaks the theme
// contract (feature 307). Sources resolve from __dirname so the result is independent of cwd.

const fs = require('fs');
const path = require('path');
const { resolveUiTheme, cssDeclarations, colorsEqual } = require('./uiTheme.cjs');

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

/** All failures for the emitted `cssFiles` ({file, css}) built for `theme`. */
function checkBundle(cssFiles, theme, sources) {
  resolveUiTheme(theme);
  const decls = cssFiles.flatMap(({ file, css }) =>
    cssDeclarations(css).map((d) => ({ ...d, file })),
  );
  return checkShared(decls, sources);
}

function loadSources() {
  return {
    globalsCss: fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'globals.css'), 'utf8'),
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

module.exports = { checkBundle, main };
