import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
    // Real-server socket tests are timing-sensitive and the map walk floods are CPU-heavy; capping
    // workers keeps a loaded machine from starving the 60 Hz loops (8 workers timed out once the
    // suite passed ~1200 tests and 16 maps).
    maxWorkers: 4,
  },
});
