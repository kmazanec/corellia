import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup-env.ts'],
    // Run-output mirrors (commission:run copies returned file artifacts under
    // out/, including test files) and factory worktrees are records, not suite
    // members — without these excludes vitest picks their test files up.
    exclude: ['**/node_modules/**', 'out/**', '.corellia/**', '.claude/**'],
  },
});
