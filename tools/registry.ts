// Single source of truth for every way into the site: curl, the terminal's assistant, and MCP.
// Adding a tool is a one-entry change here. Handlers are pure over the public content export.
import { reflow } from '../shell/ansi.ts';
import { bm25, chunksFor, findFile, findRepo, readLines, searchCode, sourceLabel, MAX_READ_LINES, type CodeIndex } from './code.ts';
import { z } from 'zod';

export type Link = { label: string; url: string };
export type Project = {
  title: string; slug: string; kind: string; summary: string; period: string; role?: string;
  stack: string[]; links: Link[]; liveUrl?: string; media: string[]; body: string;
};
export type Experience = { org: string; title: string; period: string; start?: string; end?: string; place?: string; project?: string; summary?: string };
export type Site = {
  name: string; role: string; location: string; tagline: string; domain: string; links: Link[]; bio: string; awards?: string[];
  experience?: Experience[];
  education?: { school: string; degree: string; date: string; detail?: string }[];
  publications?: { cite: string; doi?: string; project?: string }[];
  skills?: { area: string; items: string[] }[];
};
export type Content = {
  site: Site;
  projects: Project[];
  media: Media[];
  builtAt?: number;
};
export type Media = {
  id: string; type: 'image' | 'video' | 'pdf' | 'embed'; src: string; url?: string; poster?: string;
  title: string; alt: string; caption: string; projects: string[]; bytes?: number;
};
// Personal-tier entries. Only the Worker ever passes these in; they never reach a browser bundle.
export type PersonalEntry = { slug: string; title: string; tier: 'personal' | 'gated'; tags: string[]; body: string };

export type UiAction =
  | { component: 'CodeBlock' | 'Sources' | 'MessageForm' | 'OnePager' | 'ProfileHeader' | 'ProjectGrid' | 'Timeline' | 'SkillMap' | 'ProjectCard' | 'MediaViewer' | 'SitePreview' | 'ResumeViewer' | 'ContactForm' | 'GitHubActivity' | 'Gallery' | 'WebSources' | 'FitReport' | 'ShellRun'; props: object }
  | { effect: 'theme'; theme: { name: string } }
  | { effect: 'ambience'; level: 'plain' | 'phosphor' | 'color' | 'alive' | 'wake' }
  | { effect: 'confetti' | 'chicken' | 'matrix' | 'konami' };

export type Ctx = {
  content: Content; host: string; ansi: boolean; width?: number;
  personal?: PersonalEntry[]; // server-side only
  unlocked?: boolean; // server-verified unlock cookie; gated entries require it
  loadCode?: () => Promise<CodeIndex>; // public-repo code index (Worker only)
};
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
      return { text: `\n  ${p(s.name, 'bold', 'blue')}\n  ${p(s.role, 'pink')} ${p('· ' + s.location, 'gray')}\n\n${wrap(s.tagline, W(ctx))}\n\n${links}\n`, ui: { component: 'ProfileHeader', props: {} } };
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
      return { text: `\n${p('projects', 'bold')}\n\n${rows}\n\n  ${p(ctx.ansi ? 'curl ' + ctx.host + '/p/<slug>  ·  or open ' + ctx.host + ' in a browser' : 'Use show_project with a slug for details.', 'dim')}\n`, ui: { component: 'ProjectGrid', props: { slugs: ps.map((x) => x.slug) } } };
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
      const links = [...x.links, ...(x.liveUrl ? [{ label: 'live', url: x.liveUrl }] : [])]
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
      const p = paint(ctx), s = ctx.content.site, w = W(ctx);
      const exp = (s.experience ?? []).map((e) => {
        const proj = e.project ? findProject(ctx, e.project) : undefined;
        const text = e.summary ?? proj?.summary ?? '';
        return `  ${p(e.title, 'bold')}, ${e.org} ${p([e.period, e.place].filter(Boolean).join(' · '), 'gray')}${text ? '\n' + wrap(text, w - 2, '    ') : ''}`;
      }).join('\n\n');
      const projects = ctx.content.projects.filter((x) => x.kind !== 'professional' && x.kind !== 'research')
        .map((x) => `  ${p(x.title, 'blue')} ${p(x.period, 'gray')}\n${wrap(x.summary, w - 2, '    ')}`).join('\n\n');
      const edu = (s.education ?? []).map((e) => `  ${e.degree}, ${e.school}, ${e.date}${e.detail ? ` (${e.detail})` : ''}`).join('\n');
      const skills = (s.skills ?? []).map((k) => wrap(`${k.area}: ${k.items.join(', ')}`, w - 2, '  ')).join('\n');
      const sec = (t: string) => '\n' + p(t, 'bold', 'pink') + '\n';
      return {
        text: `\n  ${p(s.name, 'bold')} · ${s.role} · ${s.location}\n  PDF: https://${ctx.host}/resume.pdf\n${sec('Experience')}${exp}\n${sec('Projects')}${projects}\n${sec('Education')}${edu}\n${sec('Awards')}${(s.awards ?? []).map((a) => '  ' + a).join('\n')}\n${sec('Skills')}${skills}\n`,
        ui: { component: 'ResumeViewer', props: { src: '/resume.pdf' } },
      };
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


let ghCache: { at: number; events: unknown[] } | null = null; // GitHub's unauthenticated limit is 60/hour
const mediaFor = (ctx: Ctx, ids: string[]) => ids.map((id) => ctx.content.media.find((m) => m.id === id)).filter((m): m is Media => Boolean(m));
const words = (s: string) => s.toLowerCase().match(/[a-z0-9+#.-]{2,}/g) ?? [];

tools.push(
  tool({
    name: 'show_media',
    description: 'Show images, figures, or video inline. Pick specific media ids from the media catalog (best: the 1-3 most relevant), or a project slug for all of its media.',
    input: z.object({
      ids: z.array(z.string().regex(/^[a-z0-9-]{1,64}$/i)).max(6).optional().describe('Media ids from the catalog, most relevant first'),
      project: z.string().regex(/^[a-z0-9-]{1,64}$/i).optional(),
      id: z.string().regex(/^[a-z0-9-]{1,64}$/i).optional(),
    }),
    visibility: 'listed', tier: 'public', surfaces: ['chat', 'mcp'],
    async handler({ ids, project, id }, ctx) {
      const picked = ids?.length ? ids : id ? [id] : [];
      const items = (picked.length ? mediaFor(ctx, picked) : project ? (findProject(ctx, project)?.media ?? []).map((m) => mediaFor(ctx, [m])[0]).filter(Boolean) : [])
        .filter((m) => m.type === 'image' || m.type === 'video');
      if (!items.length) return { text: `No media found${project ? ` for "${project}"` : ''}. Projects with media: ${ctx.content.projects.filter((p) => p.media.length).map((p) => p.slug).join(', ') || 'none'}.` };
      return {
        text: `Showing ${items.length} item(s): ` + items.map((m) => `${m.title} (${m.caption})`).join('; '),
        ui: items.length === 1 ? { component: 'MediaViewer', props: { id: items[0].id } } : { component: 'Gallery', props: { ids: items.map((m) => m.id) } },
      };
    },
  }),
  tool({
    name: 'open_site',
    description: 'Show a live preview of a website William built (projects that have a live URL).',
    input: z.object({ slug: z.string().regex(/^[a-z0-9-]{1,64}$/i) }),
    visibility: 'listed', tier: 'public', surfaces: ['chat', 'mcp'],
    async handler({ slug }, ctx) {
      const x = findProject(ctx, slug);
      if (!x?.liveUrl) return { text: `No live site for "${slug}". Sites: ${ctx.content.projects.filter((p) => p.liveUrl).map((p) => p.slug).join(', ') || 'none'}.` };
      return { text: `Live preview of ${x.title}: ${x.liveUrl}`, ui: { component: 'SitePreview', props: { url: x.liveUrl, title: x.title } } };
    },
  }),
  tool({
    name: 'github_activity',
    description: 'Recent public GitHub activity (pushes, new repos) for William.',
    input: z.object({}),
    visibility: 'listed', tier: 'public', surfaces: ['chat', 'cli', 'ssh', 'mcp'],
    cli: { aliases: ['github', 'gh'] },
    async handler(_i, ctx) {
      type Ev = { type: string; repo: { name: string }; created_at: string; payload?: { commits?: unknown[] } };
      let events: Ev[] = [];
      if (ghCache && Date.now() - ghCache.at < 5 * 60_000) events = ghCache.events as Ev[];
      else {
        try {
          const res = await fetch('https://api.github.com/users/William0Holden/events/public?per_page=30', { headers: { 'user-agent': 'wholden.com', accept: 'application/vnd.github+json' } });
          if (res.ok) { events = await res.json(); ghCache = { at: Date.now(), events }; }
        } catch { /* offline: fall through */ }
      }
      const items = events
        .filter((e) => ['PushEvent', 'CreateEvent', 'PublicEvent', 'ReleaseEvent'].includes(e.type))
        .slice(0, 8)
        .map((e) => ({ repo: e.repo.name, type: e.type.replace('Event', ''), date: e.created_at.slice(0, 10), commits: e.payload?.commits?.length ?? 0 }));
      if (!items.length) return { text: 'No recent public GitHub activity (or GitHub is unreachable). Profile: https://github.com/William0Holden' };
      const p = paint(ctx);
      return {
        text: '\n' + items.map((i) => `  ${p(i.date, 'gray')}  ${i.type.padEnd(7)} ${i.repo}${i.commits ? ` (${i.commits} commit${i.commits > 1 ? 's' : ''})` : ''}`).join('\n') + '\n',
        ui: { component: 'GitHubActivity', props: { items } },
      };
    },
  }),
  tool({
    name: 'search_corpus',
    description: "Ranked full-text search over everything public: William's resume, project write-ups, and the READMEs/docs in his project repos. Returns passages with their sources. Use it before saying you don't know, and for specific numbers or details.",
    input: z.object({ query: z.string().min(2).max(200) }),
    visibility: 'listed', tier: 'public', surfaces: ['chat', 'cli', 'mcp'],
    cli: { aliases: ['search', 'grep'], args: ['query'], usage: 'search <words>' },
    async handler({ query }, ctx) {
      const idx = ctx.loadCode ? await ctx.loadCode().catch(() => []) : [];
      const hits = bm25(chunksFor(ctx.content, idx), query, 6);
      if (!hits.length) return { text: `No matches for "${query}".` };
      return {
        text: hits.map((h) => `[source: ${sourceLabel(h.source)}]\n${h.text.slice(0, 600)}`).join('\n\n'),
        ui: { component: 'Sources', props: { refs: hits.slice(0, 4).map((h) => h.source) } },
      };
    },
  }),
  tool({
    name: 'search_code',
    description: "Search the source code of William's public project repos (Python, TypeScript, notebooks, configs). Returns file:line matches. Follow with read_code to show the code.",
    input: z.object({ query: z.string().min(2).max(120), repo: z.string().regex(/^[\w.-]{1,80}$/).optional().describe('Repo name or project slug to limit the search') }),
    visibility: 'listed', tier: 'public', surfaces: ['chat', 'mcp'],
    async handler({ query, repo }, ctx) {
      const idx = ctx.loadCode ? await ctx.loadCode().catch(() => []) : [];
      if (!idx.length) return { text: 'The code index is unavailable right now.' };
      const hits = searchCode(idx, query, repo);
      if (!hits.length) return { text: `No code matches for "${query}"${repo ? ` in ${repo}` : ''}. Repos: ${idx.map((r) => r.name).join(', ')}.` };
      return { text: hits.map((h) => `${h.repo.name}/${h.path}:${h.line}${h.repo.team ? ' (team repo)' : ''}: ${h.text}`).join('\n') };
    },
  }),
  tool({
    name: 'list_code',
    description: "List William's indexed project repos, or the files in one repo (optionally under a directory).",
    input: z.object({ repo: z.string().regex(/^[\w.-]{1,80}$/).optional(), dir: z.string().max(200).optional() }),
    visibility: 'listed', tier: 'public', surfaces: ['chat', 'mcp'],
    async handler({ repo, dir }, ctx) {
      const idx = ctx.loadCode ? await ctx.loadCode().catch(() => []) : [];
      if (!idx.length) return { text: 'The code index is unavailable right now.' };
      if (!repo) return { text: idx.map((r) => `${r.name} (project: ${r.project}${r.team ? ', team repo: co-written with classmates' : ''}): ${r.files.length} files`).join('\n') };
      const r = findRepo(idx, repo);
      if (!r) return { text: `No repo "${repo}". Repos: ${idx.map((x) => x.name).join(', ')}.` };
      const prefix = (dir ?? '').replace(/^\/+|\/+$/g, '');
      const paths = r.files.map((f) => f.path).filter((p) => !prefix || p.startsWith(prefix + '/'));
      return { text: `${r.name}${r.team ? ' (team repo)' : ''}, ${paths.length} files:\n${paths.slice(0, 150).join('\n')}` };
    },
  }),
  tool({
    name: 'read_code',
    description: `Show lines of a file from one of William's repos inline, with line numbers and a GitHub link (max ${MAX_READ_LINES} lines). Use search_code or list_code first to find the path and lines.`,
    input: z.object({
      repo: z.string().regex(/^[\w.-]{1,80}$/),
      path: z.string().min(1).max(300),
      start: z.number().int().min(1).optional(),
      end: z.number().int().min(1).optional(),
    }),
    visibility: 'listed', tier: 'public', surfaces: ['chat', 'mcp'],
    async handler({ repo, path, start, end }, ctx) {
      const idx = ctx.loadCode ? await ctx.loadCode().catch(() => []) : [];
      const r = idx.length ? findRepo(idx, repo) : undefined;
      if (!r) return { text: `No repo "${repo}".` };
      const f = findFile(r, path);
      if (!f) return { text: `No file "${path}" in ${r.name}. Use list_code or search_code to find it.` };
      const out = readLines(f, start ?? 1, end);
      return {
        text: `${r.name}/${f.path} lines ${out.start}-${out.end} of ${out.total}${r.team ? ' (team repo: co-written with classmates; do not attribute it to William alone)' : ''}:\n` + out.lines.map((l, i) => `${out.start + i}: ${l}`).join('\n'),
        ui: { component: 'CodeBlock', props: { repo: r.name, path: f.path, start: out.start, end: out.end } },
      };
    },
  }),
  tool({
    name: 'theme',
    description: 'Switch the terminal between dark (default) and light.',
    input: z.object({ name: z.enum(['default', 'light']) }),
    visibility: 'hidden', tier: 'public', surfaces: ['chat'],
    async handler({ name }) {
      return { text: `Theme set to ${name}.`, ui: { effect: 'theme', theme: { name } } };
    },
  }),
  tool({
    name: 'ambience',
    description: 'Change how alive the terminal looks: plain (bare monochrome tty), phosphor (soft CRT glow), color (ANSI colours), or alive (the default: colours plus a drifting background, scan beam and shifting cursor). Use when the visitor asks to calm it down, turn effects off, make it plain or retro, or liven it up.',
    input: z.object({ level: z.enum(['plain', 'phosphor', 'color', 'alive']) }),
    visibility: 'hidden', tier: 'public', surfaces: ['chat'],
    async handler({ level }) {
      return { text: `Ambience set to ${level}.`, ui: { effect: 'ambience', level } };
    },
  }),
  tool({
    name: 'konami',
    description: 'The Konami code easter egg.',
    input: z.object({}),
    visibility: 'hidden', tier: 'public', surfaces: ['chat', 'cli'],
    cli: { aliases: ['↑↑↓↓←→←→ba', 'uuddlrlrba'] },
    async handler() {
      return { text: '+30 lives. Nice.', ui: { effect: 'konami' } };
    },
  }),
  tool({
    name: 'ask_about',
    description: 'Look up something personal about William (hobbies, interests, life outside work) by topic. Only use when the visitor asks a personal question.',
    input: z.object({ topic: z.string().min(2).max(80) }),
    visibility: 'hidden', tier: 'personal', surfaces: ['chat'],
    async handler({ topic }, ctx) {
      const entries = (ctx.personal ?? []).filter((e) => e.tier === 'personal' || ctx.unlocked);
      const q = new Set(words(topic));
      const hit = entries
        .map((e) => ({ e, score: words([e.title, e.tags.join(' '), e.slug].join(' ')).filter((w) => q.has(w)).length * 3 + words(e.body).filter((w) => q.has(w)).length }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)[0];
      if (hit) return { text: `${hit.e.title}\n${hit.e.body}` };
      // Same reply whether or not a friends-only entry matched, so topics can't be probed.
      const topics = entries.map((e) => e.title).join(', ');
      const friends = !ctx.unlocked && (ctx.personal ?? []).some((e) => e.tier === 'gated') ? ' Some things are just for friends with an unlock link from William.' : '';
      return { text: (topics ? `Nothing on "${topic}". Topics William has shared: ${topics}.` : "William hasn't shared anything on that here.") + friends };
    },
  }),
);


// ---- job fit: map requirements to evidence ----
const SYNONYMS: Record<string, string[]> = {
  ml: ['machine', 'learning', 'pytorch', 'tensorflow', 'scikit-learn', 'model'], ai: ['llm', 'llms', 'agentic', 'rag', 'model'],
  llm: ['llms', 'llm', 'agentic', 'rag', 'orchestration', 'gpt', 'claude', 'translation'], genai: ['llm', 'llms', 'agentic', 'rag'],
  cv: ['vision', 'yolo', 'opencv', 'detection', 'tracking', 'video', 'image'], vision: ['yolo', 'opencv', 'detection', 'video', 'x3d', 'sam'],
  nlp: ['language', 'translation', 'sentiment', 'whisper', 'llm', 'text'], rag: ['retrieval', 'retrieval-augmented', 'vector', 'search'],
  cloud: ['aws', 'terraform', 'docker'], devops: ['docker', 'terraform', 'gitops', 'grafana', 'actions', 'ci'], frontend: ['react', 'typescript', 'javascript'],
  backend: ['django', 'node.js', 'postgresql', 'mongodb', 'api'], data: ['duckdb', 'pandas', 'sql', 'postgresql'], research: ['publication', 'paper', 'thesis', 'published'],
  deep: ['pytorch', 'tensorflow', 'cnn', '3d-cnn', 'x3d'], inference: ['onnx', 'optimization', 'whisper', 'latency', 'quantization'], kubernetes: ['k8s', 'flux', 'gitops'],
};
const clip = (t: string, n: number) => (t.length <= n ? t : t.slice(0, t.lastIndexOf(' ', n) > n / 2 ? t.lastIndexOf(' ', n) : n).replace(/[,;:.]$/, '') + '…');
type Evidence = { slug: string; title: string; why: string; score: number };
function evidenceFor(ctx: Ctx, req: string): { strength: 'strong' | 'partial' | 'none'; evidence: Evidence[]; skill?: string } {
  const base = words(req).filter((w) => !STOP.has(w));
  const terms = new Set(base.flatMap((w) => [w, ...(SYNONYMS[w] ?? [])]));
  const skillHit = (ctx.content.site.skills ?? []).flatMap((k) => k.items).find((it) => {
    const iw = words(it);
    return iw.length > 0 && iw.every((w) => base.includes(w)) || base.some((w) => it.toLowerCase() === w);
  });
  const ev: Evidence[] = [];
  for (const p of ctx.content.projects) {
    const lines = [p.summary, p.role ? `${p.title}: ${p.role}` : '', ...plain(p.body).replace(/\n(?![-*\n])/g, ' ').split('\n'), 'stack: ' + p.stack.join(', ')].filter((l) => l.trim());
    let best = { line: '', score: 0 };
    for (const l of lines) {
      const lw = words(l);
      const score = lw.filter((w) => base.includes(w)).length * 2 + lw.filter((w) => terms.has(w)).length;
      if (score > best.score) best = { line: l, score };
    }
    if (best.score >= 2) ev.push({ slug: p.slug, title: p.title, why: clip(best.line.replace(/^[-*]\s*/, '').trim(), 120), score: best.score });
  }
  ev.sort((a, b) => b.score - a.score);
  const top = ev.slice(0, 3);
  const strength = (skillHit && top.length) || (top[0]?.score ?? 0) >= 4 ? 'strong' : skillHit || top.length ? 'partial' : 'none';
  return { strength, evidence: top, skill: skillHit };
}
const STOP = new Set(['experience', 'with', 'and', 'the', 'for', 'years', 'year', 'strong', 'knowledge', 'ability', 'skills', 'using', 'work', 'working', 'plus', 'preferred', 'required', 'familiarity', 'understanding', 'systems', 'system', 'tools', 'tool', 'frameworks', 'framework', 'technologies', 'environment', 'environments', 'production', 'proficiency', 'proficient', 'in', 'of', 'to', 'or', 'an', 'a', 'on', 'build', 'building', 'develop', 'developing', 'excellent', 'solid', 'hands-on']);

// ---------- tailored one-pager ----------
// Built only from site content: the model picks the role label, requirements, and projects; every
// line in the document is copied verbatim from William's resume or project write-ups.
export type OnePagerInput = { role: string; requirements: string[]; projects: string[] };
export type OnePager = {
  role: string; name: string; headline: string; contact: string[];
  experience: { title: string; org: string; period: string; summary: string }[];
  projects: { slug: string; title: string; period: string; summary: string; bullets: string[] }[];
  skills: string[]; education: string[]; awards: string[];
};
const bulletLines = (md: string) => reflow(md).split('\n').filter((l) => /^\s*[-*]\s+/.test(l)).map((l) => plain(l.replace(/^\s*[-*]\s+/, '')).trim()).filter((l) => l.length > 20);
export function composeOnePager(content: Content, input: OnePagerInput): OnePager {
  const s = content.site;
  const terms = new Set(input.requirements.flatMap((r) => words(r)).filter((w) => !STOP.has(w)).flatMap((w) => [w, ...(SYNONYMS[w] ?? [])]));
  const score = (text: string) => words(text).filter((w) => terms.has(w)).length;
  const projects = input.projects
    .map((slug) => content.projects.find((p) => p.slug === slug))
    .filter((p): p is Project => Boolean(p) && p!.kind !== 'professional')
    .filter((p, i, a) => a.indexOf(p) === i)
    .slice(0, 4)
    .map((p) => ({
      slug: p.slug, title: p.title, period: p.period, summary: p.summary,
      bullets: bulletLines(p.body).map((l, i) => ({ l, i, n: score(l) })).sort((a, b) => b.n - a.n || a.i - b.i).slice(0, 3).sort((a, b) => a.i - b.i).map((x) => x.l),
    }));
  const allSkills = (s.skills ?? []).flatMap((k) => k.items);
  const skills = allSkills.map((it, i) => ({ it, i, n: score(it) + (terms.has(it.toLowerCase()) ? 2 : 0) })).sort((a, b) => b.n - a.n || a.i - b.i).slice(0, 14).map((x) => x.it);
  return {
    role: input.role.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80),
    name: s.name, headline: `${s.role} · ${s.location}`,
    contact: s.links.map((l) => l.url.replace(/^mailto:/, '').replace(/^https?:\/\/(www\.)?/, '')),
    experience: (s.experience ?? []).filter((e) => e.start && e.start >= '2022').slice(0, 3).map((e) => {
      const proj = e.project ? content.projects.find((p) => p.slug === e.project) : undefined;
      return { title: e.title, org: e.org, period: e.period ?? '', summary: e.summary ?? proj?.summary ?? '' };
    }),
    projects, skills,
    education: (s.education ?? []).map((e) => `${e.degree}, ${e.school}, ${e.date}${e.detail ? ` (${e.detail})` : ''}`),
    awards: (s.awards ?? []).slice(0, 3),
  };
}
// Printable HTML for the one-pager; every value is escaped (the role label comes from the model).
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
export function onePagerHtml(o: OnePager) {
  const sec = (t: string, body: string) => `<h2>${esc(t)}</h2>${body}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.name)}${o.role ? ' · ' + esc(o.role) : ''}</title><style>
body{font:11pt/1.45 ui-sans-serif,system-ui,sans-serif;color:#000;max-width:7.2in;margin:.5in auto;padding:0 .2in}
h1{font-size:20pt;margin:0}h2{font-size:10pt;letter-spacing:.08em;text-transform:uppercase;border-bottom:1px solid #000;margin:14pt 0 5pt}
p{margin:2pt 0 6pt}ul{margin:2pt 0 6pt;padding-left:14pt}.m{color:#444}.r{font-style:italic;margin-top:6pt}
@page{margin:.5in}@media print{body{margin:0 auto}}</style></head><body>
<h1>${esc(o.name)}</h1><div>${esc(o.headline)}</div><div class="m">${o.contact.map(esc).join(' · ')}</div>
${o.role ? `<div class="r">Relevant experience for: ${esc(o.role)}</div>` : ''}
${sec('Experience', o.experience.map((e) => `<p><b>${esc(e.title)}</b>, ${esc(e.org)} <span class="m">${esc(e.period)}</span><br>${esc(e.summary)}</p>`).join(''))}
${sec('Selected projects', o.projects.map((p) => `<p><b>${esc(p.title)}</b> <span class="m">${esc(p.period)}</span><br>${esc(p.summary)}</p>${p.bullets.length ? `<ul>${p.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}`).join(''))}
${sec('Skills', `<p>${o.skills.map(esc).join(', ')}</p>`)}
${sec('Education', `<ul>${o.education.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`)}
${o.awards.length ? sec('Awards', `<ul>${o.awards.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`) : ''}
</body></html>`;
}

export function onePagerMarkdown(o: OnePager): string {
  return [
    `# ${o.name}`, `${o.headline}  `, o.contact.join(' · '), '', o.role ? `*Relevant experience for: ${o.role}*` : '', '',
    '## Experience', ...o.experience.flatMap((e) => [`**${e.title}**, ${e.org} (${e.period})  `, e.summary, '']),
    '## Selected projects', ...o.projects.flatMap((p) => [`**${p.title}** (${p.period})  `, p.summary, ...p.bullets.map((b) => `- ${b}`), '']),
    '## Skills', o.skills.join(', '), '',
    '## Education', ...o.education.map((e) => `- ${e}`), '',
    ...(o.awards.length ? ['## Awards', ...o.awards.map((a) => `- ${a}`)] : []),
  ].join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

tools.push(
  tool({
    name: 'tailor_one_pager',
    description: "Build a one-page summary of William tailored to a job: shows a preview the visitor can download as Markdown or save as PDF. Every line is copied from his resume and project write-ups; you choose only the role label, the job's key requirements, and which projects to feature. Best after a fit report.",
    input: z.object({
      role: z.string().min(2).max(80).describe('Job title / team, e.g. "ML Engineer, Perception"'),
      requirements: z.array(z.string().min(2).max(120)).min(1).max(10),
      projects: z.array(z.string().regex(/^[a-z0-9-]{1,64}$/)).min(1).max(4).describe('Project slugs to feature, most relevant first'),
    }),
    visibility: 'listed', tier: 'public', surfaces: ['chat'],
    async handler(input, ctx) {
      const o = composeOnePager(ctx.content, input);
      if (!o.projects.length) return { text: 'None of those project slugs exist (professional work is included automatically). Use list_projects.' };
      return {
        text: `Showed a one-pager preview for "${o.role}" featuring ${o.projects.map((p) => p.slug).join(', ')}; the visitor can download it. Don't repeat its contents.`,
        ui: { component: 'OnePager', props: { role: o.role, requirements: input.requirements, projects: o.projects.map((p) => p.slug) } },
      };
    },
  }),
  tool({
    name: 'leave_message',
    description: "Show a contact form so the visitor can send William a message (emailed to him). You may pre-fill name, email, and note from what the visitor said. Nothing is sent until the visitor reviews it and presses Send.",
    input: z.object({ name: z.string().max(80).optional(), email: z.string().max(120).optional(), note: z.string().max(1200).optional() }),
    visibility: 'listed', tier: 'public', surfaces: ['chat'],
    async handler({ name, email, note }) {
      return {
        text: 'Showed a message form. Tell the visitor to review it and press Send; nothing has been sent yet.',
        ui: { component: 'MessageForm', props: { name: name ?? '', email: email ?? '', note: note ?? '' } },
      };
    },
  }),
);

tools.push(tool({
  name: 'match_requirements',
  description: "Map job requirements to evidence in William's public work. Pass the key requirements extracted from a job description (short phrases like \"PyTorch\", \"RAG systems\", \"AWS\"). Returns, per requirement, a strength (strong/partial/none) and the projects that show it, and renders a fit table.",
  input: z.object({ requirements: z.array(z.string().min(2).max(120)).min(1).max(12) }),
  visibility: 'listed', tier: 'public', surfaces: ['chat', 'mcp'],
  async handler({ requirements }, ctx) {
    const rows = requirements.map((r) => ({ requirement: r, ...evidenceFor(ctx, r) }));
    const text = rows.map((r) => `- ${r.requirement}: ${r.strength}${r.skill ? ` (resume skill: ${r.skill})` : ''}${r.evidence.length ? `; evidence: ${r.evidence.map((e) => `${e.slug} ("${e.why}")`).join('; ')}` : '; nothing on the site shows this'}`).join('\n');
    return {
      text: `Fit table (shown to the visitor):\n${text}\nNote: "none" means the site doesn't show it, not that William can't do it.`,
      ui: { component: 'FitReport', props: { rows: rows.map((r) => ({ requirement: r.requirement, strength: r.strength, evidence: r.evidence.map((e) => ({ slug: e.slug, why: e.why })) })) } },
    };
  },
}));

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
    const fmt = (rows: string[][]) => { const w = Math.max(...rows.map((r) => r[0].length)); return rows.map(([a, b]) => `  ${p(a.padEnd(w), 'blue')}  ${b}`).join('\n'); };
    return { text: `\n${p('curl', 'bold')}\n${fmt(curl)}\n\n${p('browser', 'bold')}\n  https://${ctx.host} is a full terminal: try ${p('resume', 'blue')}, ${p('projects', 'blue')}, ${p('skills', 'blue')}, or just ask a question.\n` };
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

// Public manifest (no handlers) for MCP and other clients.
export const manifest = () =>
  tools.filter((t) => t.visibility === 'listed' && t.tier === 'public').map((t) => ({
    name: t.name, description: t.description, visibility: t.visibility, tier: t.tier, surfaces: t.surfaces,
    cli: t.cli ?? {}, inputSchema: z.toJSONSchema(t.input),
  }));
