import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:18422',
    headless: true,
    actionTimeout: 10000,
  },
  webServer: {
    command: 'npx tsx src/main.ts --dev',
    port: 18422,
    env: { PORT: '18422' },
    timeout: 30000,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
