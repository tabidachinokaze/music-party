import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/desktop',
  timeout: 45000,
  workers: 1,
  use: { trace: 'retain-on-failure' },
})
