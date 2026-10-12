import { getCollection, getEntry } from 'astro:content';

export async function getProjects() {
  const all = await getCollection('projects', ({ data }) => !data.draft);
  return all.sort((a, b) => a.data.order - b.data.order);
}

export async function getSite() {
  const entry = await getEntry('site', 'site');
  if (!entry) throw new Error('content/site.md missing');
  return entry;
}

export const themeStyle = (t: { accent: string; accent2: string; bg: string }) =>
  `--accent:${t.accent};--accent2:${t.accent2};--bg:${t.bg}`;
