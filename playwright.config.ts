import { defineConfig, devices } from '@playwright/test';

const port = 4321;
const [githubOwner, githubRepository] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
const isUserSite = githubRepository === `${githubOwner}.github.io`;
const inferredBase =
  process.env.GITHUB_ACTIONS === 'true' && githubRepository && !isUserSite
    ? `/${githubRepository}/`
    : '/';
const configuredBase = process.env.BASE_PATH ?? inferredBase;
const basePath = `/${configuredBase}`.replace(/\/+/g, '/').replace(/\/?$/, '/');
const previewUrl = `http://127.0.0.1:${port}${basePath}`;

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results',
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: previewUrl,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${port}`,
    url: previewUrl,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
    },
  ],
});
