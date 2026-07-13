import { defineConfig } from 'vitest/config';

// Unit-test layer seeded by feature 065 (FR-10). Node-environment LOGIC tests only —
// component/jsdom testing is intentionally out of scope for this seed. Coverage is scoped to
// `src/lib/**` (where unit-testable logic lives); a whole-`src` threshold over the large,
// e2e-only UI codebase would be unearnable at seed time.
export default defineConfig({
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
      thresholds: {
        lines: 40,
        functions: 40,
        statements: 40,
      },
    },
  },
});
