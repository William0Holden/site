// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// Static build. The Cloudflare Worker in worker/ serves dist/ as assets and adds /api, /mcp,
// and curl handling on top.
export default defineConfig({
  site: 'https://wholden.com',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [react()],
});
