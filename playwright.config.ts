import { defineConfig, devices } from '@playwright/test';

const shouldUseExternalServer = process.env.PLAYWRIGHT_USE_EXTERNAL_SERVER === '1';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixelRatio: 0.015,
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    timezoneId: 'Europe/Madrid',
    locale: 'es-ES',
    viewport: { width: 1440, height: 1024 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1024 },
      },
    },
  ],
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  webServer: shouldUseExternalServer
    ? undefined
    : {
        command: 'npx vite --port 3000 --host 127.0.0.1',
        url: 'http://127.0.0.1:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
