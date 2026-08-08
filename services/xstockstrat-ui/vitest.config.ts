import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit-test layer seeded by feature 065 (FR-10). Node-environment LOGIC tests only —
// component/jsdom testing is intentionally out of scope for this seed. Coverage is scoped to
// `src/lib/**` (where unit-testable logic lives); a whole-`src` threshold over the large,
// e2e-only UI codebase would be unearnable at seed time.
export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's `paths: { "@/*": ["./src/*"] }` — Next.js's own bundler reads that
    // mapping automatically, but Vite/Vitest does not, so any test whose import graph touches an
    // `@/...`-aliased import (e.g. src/components/ui/* since feature 119's shadcn CLI migration,
    // which regenerates those files with alias imports instead of the old relative ones) fails to
    // resolve without this. Added when feature 119's button.test.ts/badge.test.ts surfaced it —
    // also fixes a pre-existing failure in src/lib/copilot.test.ts (transitively imports badge.tsx).
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text'],
      // Scope coverage to the logic layer; the node-test CI job (Step 13) uploads coverage/lcov.info.
      include: ['src/lib/**'],
      // gRPC/Node-runtime plumbing is exercised only by Playwright e2e, not unit tests — exclude
      // it so it doesn't drag the src/lib threshold below the 40% platform floor.
      exclude: ['src/lib/*Bff.ts', 'src/lib/connectClients.ts', 'src/lib/identity.ts'],
      // Only count files actually exercised by a unit test toward the threshold. Most of src/lib
      // is e2e-only (browserClients, strategyCatalog, bffShared, auth, headers, basepath, …); a
      // whole-src/lib floor would be unearnable at seed time. As more unit tests are added, their
      // files begin to count — so the 40% floor applies to unit-tested logic and grows naturally.
      all: false,
      thresholds: {
        lines: 40,
        functions: 40,
        statements: 40,
      },
    },
  },
});
