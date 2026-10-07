import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
    // Real-server socket tests are timing-sensitive; capping workers keeps a loaded machine from
    // starving their 60 Hz loops (seen as rare flakes once the bigger maps landed).
    maxWorkers: 8,
  },
});
