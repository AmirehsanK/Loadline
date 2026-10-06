import { defineConfig } from 'vitest/config';

// These tests run simulations, and the machines CI uses are several times slower than a desk.
// The default of five seconds turns a slow machine into a failed test.
export default defineConfig({ test: { testTimeout: 60_000 } });
