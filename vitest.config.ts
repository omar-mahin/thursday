import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        // Pure logic: no DOM, no layout.
        test: { name: 'node', environment: 'node', include: ['tests/unit/*.test.ts'] },
      },
      {
        // DOM structure and attributes, still no layout -- jsdom is enough for
        // accessible-name computation and element identity (PLAN.md 2.6).
        test: { name: 'dom', environment: 'jsdom', include: ['tests/unit/dom/*.test.ts'] },
      },
    ],
  },
});
