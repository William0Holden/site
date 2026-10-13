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
    awards: z.array(z.string()).default([]),
    experience: z.array(z.object({
      org: z.string(), title: z.string(), period: z.string(), start: z.string().optional(), end: z.string().optional(),
      place: z.string().optional(), project: z.string().optional(), summary: z.string().optional(),
    })).default([]),
    education: z.array(z.object({ school: z.string(), degree: z.string(), date: z.string(), detail: z.string().optional() })).default([]),
    publications: z.array(z.object({ cite: z.string(), doi: z.string().optional(), project: z.string().optional() })).default([]),
    skills: z.array(z.object({ area: z.string(), items: z.array(z.string()) })).default([]),
    links: z.array(link),
  }),
});

export const collections = { projects, site };
