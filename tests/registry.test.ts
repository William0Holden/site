import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tools, resolveCommand, resolvePath, manifest, type Content } from '../tools/registry.ts';

const content: Content = JSON.parse(readFileSync(new URL('../dist/api/content.json', import.meta.url), 'utf8'));
const ctx = { content, host: 'wholden.com', ansi: false };

test('tool names are unique', () => {
  const names = tools.flatMap((t) => [t.name, ...(t.cli?.aliases ?? [])]);
  assert.equal(new Set(names).size, names.length);
});

test('help lists listed tools only', async () => {
  const { text } = await resolvePath('/help')!.tool.handler({}, ctx);
  assert.match(text, /curl wholden\.com\/p\/<slug>/);
  assert.match(text, /show <slug>/);
  assert.doesNotMatch(text, /chicken|hire/);
});

test('resolveCommand parses positional args and aliases', () => {
  const hit = resolveCommand('show decktection');
  assert.ok(hit && 'tool' in hit);
  assert.equal(hit.tool.name, 'show_project');
  assert.deepEqual(hit.input, { slug: 'decktection' });
  const bad = resolveCommand('show');
  assert.ok(bad && 'error' in bad && /usage/.test(bad.error));
  const nf = resolveCommand('frobnicate now');
  assert.ok(nf && 'error' in nf && /command not found/.test(nf.error));
});

test('resolvePath maps curl routes', () => {
  assert.equal(resolvePath('/')!.tool.name, 'about');
  assert.equal(resolvePath('/projects/')!.tool.name, 'list_projects');
  assert.deepEqual(resolvePath('/p/decktection')!.input, { slug: 'decktection' });
  assert.equal(resolvePath('/about'), null);
});

test('show_project renders a known project and rejects unknown', async () => {
  const t = tools.find((x) => x.name === 'show_project')!;
  assert.match((await t.handler({ slug: 'decktection' }, ctx)).text, /DeckTection/);
  assert.match((await t.handler({ slug: 'nope' }, ctx)).text, /no project/);
});

test('manifest has JSON schemas and no personal-tier tools', () => {
  const m = manifest();
  assert.ok(m.every((t) => t.inputSchema && t.tier === 'public'));
});
