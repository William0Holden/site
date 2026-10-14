// Single source of truth for every way into the site: curl, the terminal's assistant, and MCP.
// Adding a tool is a one-entry change here. Handlers are pure over the public content export.
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
  | { component: 'ProfileHeader' | 'ProjectGrid' | 'Timeline' | 'SkillMap' | 'ProjectCard' | 'MediaViewer' | 'SitePreview' | 'ResumeViewer' | 'ContactForm' | 'GitHubActivity' | 'Gallery' | 'WebSources' | 'FitReport' | 'ShellRun'; props: object }
  | { effect: 'theme'; theme: { name: string } }
  | { effect: 'confetti' | 'chicken' | 'matrix' | 'konami' };

export type Ctx = {
  content: Content; host: string; ansi: boolean; width?: number;
  personal?: PersonalEntry[]; // server-side only
  unlocked?: boolean; // server-verified unlock cookie; gated entries require it
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
    description: 'Show images, figures, or video for a project (by project slug) or a single media id.',
    input: z.object({ project: z.string().regex(/^[a-z0-9-]{1,64}$/i).optional(), id: z.string().regex(/^[a-z0-9-]{1,64}$/i).optional() }),
    visibility: 'listed', tier: 'public', surfaces: ['chat', 'mcp'],
    async handler({ project, id }, ctx) {
      const items = id ? mediaFor(ctx, [id]) : project ? (findProject(ctx, project)?.media ?? []).map((m) => mediaFor(ctx, [m])[0]).filter(Boolean) : [];
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
    description: 'Keyword search over all public content (projects, bio). Use for specific questions about skills, tools, or details.',
    input: z.object({ query: z.string().min(2).max(200) }),
    visibility: 'listed', tier: 'public', surfaces: ['chat', 'cli', 'mcp'],
    cli: { aliases: ['search', 'grep'], args: ['query'], usage: 'search <words>' },
    async handler({ query }, ctx) {
      const q = new Set(words(query));
      const docs = [
        { slug: 'about', title: 'About William', text: ctx.content.site.bio + '\nAwards and honors: ' + (ctx.content.site.awards ?? []).join('; ') },
        ...ctx.content.projects.map((p) => ({ slug: p.slug, title: p.title, text: [p.summary, p.role ?? '', p.stack.join(' '), plain(p.body)].join('\n') })),
      ];
      const scored = docs
        .map((d) => {
          const lines = d.text.split('\n').filter((l) => words(l).some((w) => q.has(w)));
          const score = words(d.text + ' ' + d.title).filter((w) => q.has(w)).length;
          return { ...d, score, lines };
        })
        .filter((d) => d.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
      if (!scored.length) return { text: `No matches for "${query}".` };
      return { text: scored.map((d) => `[${d.slug}] ${d.title}\n${d.lines.slice(0, 4).map((l) => '  ' + l.trim()).join('\n')}`).join('\n\n') };
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
