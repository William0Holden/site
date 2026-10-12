// Build step: export public content as JSON so the Worker (curl, MCP), the Go SSH app, and the
// chat all read the same data as the website. Never include content/personal here.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => matter(readFileSync(join(root, p), 'utf8'));
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '').trim();

const site = read('content/site.md');
const projects = readdirSync(join(root, 'content/projects'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => read(`content/projects/${f}`))
  .filter(({ data }) => !data.draft)
  .map(({ data, content }) => ({ ...data, body: stripComments(content) }))
  .sort((a, b) => a.order - b.order);
const media = JSON.parse(readFileSync(join(root, 'content/media.json'), 'utf8'));

const out = join(root, 'dist/api');
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'content.json'),
  JSON.stringify({ site: { ...site.data, bio: stripComments(site.content) }, projects, media }, null, 2),
);
console.log(`exported ${projects.length} projects to dist/api/content.json`);

const { manifest } = await import('../tools/registry.ts');
writeFileSync(join(out, 'registry.json'), JSON.stringify(manifest(), null, 2));
console.log('exported tool registry to dist/api/registry.json');
