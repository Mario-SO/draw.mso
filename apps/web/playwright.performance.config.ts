import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './performance',
  timeout: 180_000,
  workers: 1,
  fullyParallel: false,
  reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:4173' },
  projects: [{ name: 'chromium-production', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
