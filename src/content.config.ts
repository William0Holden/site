import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const link = z.object({ label: z.string(), url: z.string().url() });

const projects = defineCollection({
  loader: glob({ pattern: '*.md', base: './content/projects' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    kind: z.enum(['professional', 'research', 'project', 'personal-site', 'homelab']),
    summary: z.string(),
    period: z.string(),
    role: z.string().optional(),
    stack: z.array(z.string()),
    links: z.array(link).default([]),
    liveUrl: z.string().url().optional(),
    media: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    order: z.number(),
    draft: z.boolean().default(false),
    theme: z.object({
      accent: z.string(),
      accent2: z.string(),
      bg: z.string(),
      mood: z.string(),
    }),
  }),
});

const site = defineCollection({
  loader: glob({ pattern: 'site.md', base: './content' }),
  schema: z.object({
    name: z.string(),
    shortName: z.string(),
    role: z.string(),
    location: z.string(),
    tagline: z.string(),
    domain: z.string(),
    links: z.array(link),
  }),
});

export const collections = { projects, site };
