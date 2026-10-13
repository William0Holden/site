// Single source of truth for every way into the site: curl, /terminal, SSH, chat, MCP.
// Adding a tool is a one-entry change here. Handlers are pure over the public content export.
import { z } from 'zod';

export type Link = { label: string; url: string };
export type Project = {
  title: string; slug: string; kind: string; summary: string; period: string; role?: string;
  stack: string[]; links: Link[]; liveUrl?: string; media: string[]; body: string;
};
export type Content = {
  site: { name: string; role: string; location: string; tagline: string; domain: string; links: Link[]; bio: string };
  projects: Project[];
  media: unknown[];
};

export type UiAction =
  | { component: 'ProjectCard' | 'MediaViewer' | 'SitePreview' | 'ResumeViewer' | 'ContactForm' | 'GitHubActivity' | 'Gallery'; props: object }
  | { effect: 'theme'; theme: object }
  | { effect: 'confetti' | 'chicken' | 'matrix' | 'konami' | 'terminal' };

export type Ctx = { content: Content; host: string; ansi: boolean; width?: number };
export type Surface = 'chat' | 'cli' | 'ssh' | 'mcp';

export type Tool<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  input: S;
  visibility: 'listed' | 'hidden';
  tier: 'public' | 'personal' | 'gated';
  surfaces: Surface[];
  // CLI: extra command names, positional args (in order), and the curl path (":arg" segments).
  cli?: { aliases?: string[]; args?: string[]; path?: string; usage?: string };
  handler: (input: z.infer<S>, ctx: Ctx) => Promise<{ text: string; ui?: UiAction }>;
};

const tool = <S extends z.ZodType>(t: Tool<S>) => t as unknown as Tool;

// ---- text formatting (ANSI when the client is a terminal) ----
const codes = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', blue: '\x1b[38;5;111m', pink: '\x1b[38;5;212m', gray: '\x1b[38;5;245m' };
type Style = keyof typeof codes;
const paint = (ctx: Ctx) => (s: string, ...st: Style[]) => (ctx.ansi ? st.map((k) => codes[k]).join('') + s + codes.reset : s);

export function wrap(text: string, width = 76, indent = '  ') {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if ((line + ' ' + word).trim().length > width) { out.push(indent + line); line = word; }
      else line = (line + ' ' + word).trim();
    }
    out.push(indent + line);
  }
  return out.join('\n');
}
const plain = (md: string) =>
  md.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)').replace(/^#+\s*/gm, '');

const W = (ctx: Ctx) => Math.max(30, Math.min(76, ctx.width ?? 76));
const findProject = (ctx: Ctx, slug: string) => ctx.content.projects.find((p) => p.slug === slug.toLowerCase());

// ---- tools ----
export const tools: Tool[] = [
  tool({
    name: 'about',
    description: 'Business card: name, role, tagline, and links.',
    input: z.object({}),
    visibility: 'listed', tier: 'public', surfaces: ['cli', 'ssh', 'mcp'],
    cli: { aliases: ['whoami', 'card'], path: '/' },
    async handler(_i, ctx) {
      const p = paint(ctx), s = ctx.content.site;
      const links = s.links.map((l) => `  ${p(l.label.padEnd(9), 'gray')}${l.url.replace('mailto:', '')}`).join('\n');
      return { text: `\n  ${p(s.name, 'bold', 'blue')}\n  ${p(s.role, 'pink')} ${p('· ' + s.location, 'gray')}\n\n${wrap(s.tagline, W(ctx))}\n\n${links}\n` };
    },
  }),
  tool({
    name: 'list_projects',
    description: 'List all of William\'s public projects with slug, title, and period.',
    input: z.object({}),
    visibility: 'listed', tier: 'public', surfaces: ['chat', 'cli', 'ssh', 'mcp'],
    cli: { aliases: ['projects', 'ls'], path: '/projects' },
    async handler(_i, ctx) {
      const p = paint(ctx), ps = ctx.content.projects;
      const w = Math.max(...ps.map((x) => x.slug.length));
      const rows = ps.map((x) => `  ${p(x.slug.padEnd(w), 'blue')}  ${x.title} ${p(`(${x.period})`, 'gray')}`).join('\n');
      return { text: `\n${p('projects', 'bold')}\n\n${rows}\n\n  ${p(ctx.ansi ? 'show <slug>  ·  curl ' + ctx.host + '/p/<slug>' : 'Use show_project with a slug for details.', 'dim')}\n` };
    },
  }),
  tool({
    name: 'show_project',
    description: 'Full write-up of one project by slug (see list_projects for slugs).',
    input: z.object({ slug: z.string().regex(/^[a-z0-9-]{1,64}$/i).describe('Project slug, e.g. "decktection"') }),
    visibility: 'listed', tier: 'public', surfaces: ['chat', 'cli', 'ssh', 'mcp'],
    cli: { aliases: ['show', 'open', 'cat'], args: ['slug'], path: '/p/:slug', usage: 'show <slug>' },
    async handler({ slug }, ctx) {
      const p = paint(ctx), x = findProject(ctx, slug);
      if (!x) return { text: `\n  no project "${slug}". try: list_projects\n` };
      const links = [...x.links, ...(x.liveUrl ? [{ label: 'live', url: x.liveUrl }] : []), { label: 'web', url: `https://${ctx.host}/p/${x.slug}` }]
        .map((l) => `  ${p(l.label + ':', 'gray')} ${l.url}`).join('\n');
      const role = x.role ? '\n' + p(wrap(x.role, W(ctx)), 'pink') : '';
      return {
        text: `\n  ${p(x.title, 'bold', 'blue')} ${p(x.period, 'gray')}${role}\n\n${wrap(x.summary, W(ctx))}\n\n${wrap(plain(x.body), W(ctx) - 2)}\n\n${wrap('stack: ' + x.stack.join(', '), W(ctx))}\n${links}\n`,
        ui: { component: 'ProjectCard', props: { slug: x.slug } },
      };
    },
  }),
  tool({
    name: 'get_resume',
    description: 'Resume overview with a link to the PDF.',
    input: z.object({}),
    visibility: 'listed', tier: 'public', surfaces: ['chat', 'cli', 'ssh', 'mcp'],
    cli: { aliases: ['resume', 'cv'], path: '/resume' },
    async handler(_i, ctx) {
      const p = paint(ctx), s = ctx.content.site;
      const items = ctx.content.projects.map((x) => `  ${p(x.title, 'blue')} ${p(x.period, 'gray')}\n${wrap(x.summary, W(ctx) - 2, '    ')}`).join('\n\n');
      return { text: `\n  ${p(s.name, 'bold')} · ${s.role}\n  PDF: https://${ctx.host}/resume.pdf\n\n${items}\n`, ui: { component: 'ResumeViewer', props: { src: '/resume.pdf' } } };
    },
  }),
  tool({
    name: 'contact',
    description: 'How to reach William (email, GitHub, LinkedIn).',
    input: z.object({}),
    visibility: 'listed', tier: 'public', surfaces: ['chat', 'cli', 'ssh', 'mcp'],
    cli: { aliases: ['email'], path: '/contact' },
    async handler(_i, ctx) {
      const p = paint(ctx);
      return { text: '\n' + ctx.content.site.links.map((l) => `  ${p(l.label.padEnd(9), 'gray')}${l.url.replace('mailto:', '')}`).join('\n') + '\n', ui: { component: 'ContactForm', props: {} } };
    },
  }),
  tool({
    name: 'sudo_hire_me',
    description: 'Celebrate and show contact details.',
    input: z.object({}),
    visibility: 'hidden', tier: 'public', surfaces: ['chat', 'cli', 'ssh'],
    cli: { aliases: ['sudo hire-me', 'hire'] },
    async handler(_i, ctx) {
      const p = paint(ctx), email = ctx.content.site.links.find((l) => l.url.startsWith('mailto:'))?.url.slice(7);
      return { text: `\n  ${p('🎉 permission granted.', 'bold', 'pink')} ${email ? `say hi: ${email}` : ''}\n`, ui: { effect: 'confetti' } };
    },
  }),
  tool({
    name: 'chicken_mode',
    description: 'A pixel chicken with a YOLO-style bounding box. A nod to the thesis.',
    input: z.object({}),
    visibility: 'hidden', tier: 'public', surfaces: ['chat', 'cli', 'ssh'],
    cli: { aliases: ['chicken'] },
    async handler(_i, ctx) {
      const p = paint(ctx);
      const box = ['┌─ broiler 0.99 ─┐', '│      __//      │', '│    /.__.\\      │', '│    \\ \\/ /      │', "│ '__/    \\      │", "│  \\-      )     │", '│   \\_____/      │', '│ _____|_____    │', '└────────────────┘'];
      return { text: '\n' + box.map((l, i) => '  ' + (i === 0 || i === box.length - 1 ? p(l, 'pink') : l)).join('\n') + '\n', ui: { effect: 'chicken' } };
    },
  }),
];

// Help is generated from the registry; only `listed` tools appear.
tools.push(tool({
  name: 'help',
  description: 'List available commands.',
  input: z.object({}),
  visibility: 'listed', tier: 'public', surfaces: ['cli', 'ssh'],
  cli: { aliases: ['?'], path: '/help' },
  async handler(_i, ctx) {
    const p = paint(ctx);
    const listed = tools.filter((t) => t.visibility === 'listed' && t.surfaces.includes('cli'));
    const curl = listed.filter((t) => t.cli?.path).map((t) => [`curl ${ctx.host}${t.cli!.path!.replace(/:(\w+)/g, '<$1>')}`, t.description]);
    const cmds = listed.map((t) => [t.cli?.usage ?? t.cli?.aliases?.[0] ?? t.name, t.description]);
    const fmt = (rows: string[][]) => { const w = Math.max(...rows.map((r) => r[0].length)); return rows.map(([a, b]) => `  ${p(a.padEnd(w), 'blue')}  ${b}`).join('\n'); };
    return { text: `\n${p('curl', 'bold')}\n${fmt(curl)}\n\n${p('terminal / ssh', 'bold')}\n${fmt(cmds)}\n` };
  },
}));

export const byName = (name: string) => tools.find((t) => t.name === name);

// Resolve a typed command line ("show decktection") to a tool and its parsed input.
export function resolveCommand(line: string, surface: Surface = 'cli'): { tool: Tool; input: unknown } | { error: string } | null {
  const trimmed = line.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  const candidates = tools.filter((t) => t.surfaces.includes(surface));
  for (const t of candidates) {
    for (const name of [t.name, ...(t.cli?.aliases ?? [])]) {
      if (trimmed === name || trimmed.startsWith(name + ' ')) {
        const rest = trimmed.slice(name.length).trim();
        const args = t.cli?.args ?? [];
        const values = rest ? rest.split(' ') : [];
        const raw = Object.fromEntries(args.map((a, i) => [a, i === args.length - 1 ? values.slice(i).join(' ') : values[i]]).filter(([, v]) => v));
        const parsed = t.input.safeParse(raw);
        if (!parsed.success) return { error: `usage: ${t.cli?.usage ?? name}` };
        return { tool: t, input: parsed.data };
      }
    }
  }
  return { error: `command not found: ${trimmed.split(' ')[0]}. try: help` };
}

// Resolve a curl path ("/p/decktection") to a tool and input.
export function resolvePath(pathname: string): { tool: Tool; input: unknown } | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  for (const t of tools) {
    const pattern = t.cli?.path;
    if (!pattern || !t.surfaces.includes('cli')) continue;
    const keys: string[] = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_m, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    const m = path.match(re);
    if (!m) continue;
    let values: string[];
    try { values = m.slice(1).map(decodeURIComponent); } catch { return null; }
    const parsed = t.input.safeParse(Object.fromEntries(keys.map((k, i) => [k, values[i]])));
    if (parsed.success) return { tool: t, input: parsed.data };
  }
  return null;
}

// Public manifest (no handlers) for SSH, MCP, and the chat's "what I can do" panel.
export const manifest = () =>
  tools.filter((t) => t.visibility === 'listed').map((t) => ({
    name: t.name, description: t.description, visibility: t.visibility, tier: t.tier, surfaces: t.surfaces,
    cli: t.cli ?? {}, inputSchema: z.toJSONSchema(t.input),
  }));
