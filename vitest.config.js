import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The simulation is plain node. The one UI test opts into jsdom with a
    // docblock, so nothing else pays for a fake DOM.
    environment: 'node',
    include: ['test/**/*.test.js'],
    testTimeout: 120000,
  },
});
