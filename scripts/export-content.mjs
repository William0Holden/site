// Build step: export public content as JSON so the Worker (curl, MCP), the Go SSH app, and the
// chat all read the same data as the website. Never include content/personal here.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
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
// Images under src/assets get stable public URLs (dist/media/<id>.<ext>) so the chat, MCP, and SSH
// app can reference them without knowing Astro's hashed asset names.
mkdirSync(join(root, 'dist/media'), { recursive: true });
const media = JSON.parse(readFileSync(join(root, 'content/media.json'), 'utf8')).map((m) => {
  if (m.type === 'image' && m.src.startsWith('src/')) {
    const file = `${m.id}${extname(m.src)}`;
    copyFileSync(join(root, m.src), join(root, 'dist/media', file));
    return { ...m, url: `/media/${file}` };
  }
  return { ...m, url: m.src };
});

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

// Personal-tier entries go ONLY into the Worker bundle (worker/generated, gitignored), never dist/.
const personalDir = join(root, 'content/personal');
const personal = existsSync(personalDir)
  ? readdirSync(personalDir)
      .filter((f) => f.endsWith('.md') && f !== 'README.md')
      .map((f) => read(`content/personal/${f}`))
      .map(({ data, content }, i) => ({
        slug: data.slug ?? String(i), title: data.title, tier: data.tier === 'gated' ? 'gated' : 'personal',
        tags: data.tags ?? [], body: stripComments(content),
      }))
  : [];
mkdirSync(join(root, 'worker/generated'), { recursive: true });
writeFileSync(join(root, 'worker/generated/personal.json'), JSON.stringify(personal));
console.log(`exported ${personal.length} personal entries to worker/generated (not public)`);
