import { defineConfig } from 'astro/config';

const [githubOwner, githubRepository] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const isUserSite = githubRepository === `${githubOwner}.github.io`;
const inferredBase =
  isGitHubActions && githubRepository && !isUserSite ? `/${githubRepository}` : '/';
const inferredSite =
  isGitHubActions && githubOwner ? `https://${githubOwner}.github.io` : undefined;

export default defineConfig({
  base: process.env.BASE_PATH ?? inferredBase,
  site: process.env.SITE_URL ?? inferredSite,
  compressHTML: true,
});
