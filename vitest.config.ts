import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    reporters: [
      ...configDefaults.reporters,
      ['html', { outputDir: 'test-report' }],
      ['junit', { outputFile: 'test-report/junit.xml' }],
    ],
  },
});
