// William's content as a Linux filesystem, plus the portfolio commands (resume, skills, timeline,
// open, fit, ask, ...). Everything here is derived from the public content export.
import { c, cmdLink, link, mdToAnsi, pad, visibleLength, wrap } from './ansi.ts';
import { dir, file, type DirNode, type Node } from './vfs.ts';
import { getopt } from './coreutils.ts';
import type { Command, IO } from './sh.ts';
import { byName, resolvePath, type Content, type Experience, type Project } from '../tools/registry.ts';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ext = (url: string) => url.match(/\.[a-z0-9]+$/i)?.[0] ?? '';
const MIME: Record<string, string> = {
  '.png': 'PNG image data', '.jpg': 'JPEG image data, JFIF standard 1.01', '.jpeg': 'JPEG image data',
  '.mp4': 'ISO Media, MP4 v2 [ISO 14496-14]', '.pdf': 'PDF document, version 1.7',
};
const email = (ct: Content) => ct.site.links.find((l) => l.url.startsWith('mailto:'))?.url.slice(7) ?? '';
const plainMd = (md: string) => md.replace(/<!--[\s\S]*?-->/g, '').trim();

export function projectReadme(p: Project): string {
  const links = p.links.map((l) => `- ${l.label}: ${l.url}`).join('\n');
  return `# ${p.title}\n\n${p.period}${p.role ? ` · ${p.role}` : ''}\n\n${p.summary}\n\n${plainMd(p.body)}\n\n## Stack\n\n${p.stack.join(', ')}\n${links ? `\n## Links\n\n${links}\n` : ''}`;
}

function resumeMd(ct: Content): string {
  const s = ct.site;
  const exp = (s.experience ?? []).map((e) => {
    const proj = e.project ? ct.projects.find((p) => p.slug === e.project) : undefined;
    return `### ${e.title}, ${e.org}\n${[e.period, e.place].filter(Boolean).join(' · ')}\n\n${e.summary ?? proj?.summary ?? ''}`;
  }).join('\n\n');
  const projects = ct.projects.filter((p) => p.kind !== 'professional' && p.kind !== 'research').map((p) => `- **${p.title}** (${p.period}): ${p.summary}`).join('\n');
  const edu = (s.education ?? []).map((e) => `- ${e.degree}, ${e.school}, ${e.date}${e.detail ? ` (${e.detail})` : ''}`).join('\n');
  const pubs = (s.publications ?? []).map((p) => `- ${p.cite}${p.doi ? ` https://doi.org/${p.doi}` : ''}`).join('\n');
  const skills = (s.skills ?? []).map((k) => `- **${k.area}:** ${k.items.join(', ')}`).join('\n');
  return `# ${s.name}\n\n${s.role} · ${s.location} · ${email(ct)}\n\n${plainMd(s.bio)}\n\n## Experience\n\n${exp}\n\n## Projects\n\n${projects}\n\n## Publications\n\n${pubs}\n\n## Education\n\n${edu}\n\n## Awards\n\n${(s.awards ?? []).map((a) => `- ${a}`).join('\n')}\n\n## Skills\n\n${skills}\n`;
}

const bibtex = (ct: Content) => (ct.site.publications ?? []).map((p) => {
  const m = p.cite.match(/^(.*?)\s"(.+?)\."\s(.+?)\s(\d+)\s\((\d{4})\),\s(\d+)/);
  if (!m) return `% ${p.cite}`;
  return `@article{holden${m[5]},\n  author  = {${m[1].replace(/\.,? $/, '.').replace(/, ([A-Z])/g, ' and $1')}},\n  title   = {${m[2]}},\n  journal = {${m[3]}},\n  volume  = {${m[4]}},\n  pages   = {${m[6]}},\n  year    = {${m[5]}},\n  doi     = {${p.doi ?? ''}}\n}`;
}).join('\n\n') + '\n';

// Sample questions on the welcome screen. Clicking one asks the assistant, so the terminal allows
// exactly these strings as links even though `ask` isn't a read-only command.
export const SUGGESTED_QUESTIONS = ['ask what was his thesis about?', 'ask what does he build at work?'];
const chip = (cmd: string) => cmdLink(c(`[ ${cmd} ]`, 'bold'), cmd);
export const MOTD = [
  "hello, i'm william. AI engineer in Atlanta.",
  '',
  'this is a terminal with an AI assistant built in.',
  '',
  `  ${chip('resume')}  ${chip('projects')}  ${chip('contact')}`,
  '',
  '  or ask the AI anything, in plain English:',
  ...SUGGESTED_QUESTIONS.map((q) => `  › ${cmdLink(q.slice(4), q)}`),
  '',
  c('  click anything underlined, or type below.', 'gray'),
  c(`  it's a real shell, too: ${cmdLink('help')}, ls, man, boot.`, 'gray'),
  '',
].join('\n');

// Build the read-only base filesystem from the content export.
export function buildTree(ct: Content, commandNames: string[], now: number): DirNode {
  const t = ct.builtAt ?? now;
  const W = 'william', R = 'root';
  const f = (data: Node extends never ? never : string | (() => string), extra = {}) => file(W, data, extra, t);
  const mediaFile = (id: string) => {
    const m = ct.media.find((x) => x.id === id);
    if (!m?.url) return null;
    return [`${m.id}${ext(m.url)}`, file(W, `[binary ${m.type}: ${m.title}]`, { media: m.id, mime: MIME[ext(m.url).toLowerCase()] ?? 'data', size: m.bytes ?? 1 }, t)] as const;
  };

  const projects: Record<string, Node> = {};
  for (const p of ct.projects) {
    const kids: Record<string, Node> = { 'README.md': f(projectReadme(p)), 'stack.txt': f(p.stack.join('\n') + '\n') };
    if (p.links.length) kids['links.txt'] = f(p.links.map((l) => `${l.label}\t${l.url}`).join('\n') + '\n');
    const media = p.media.map(mediaFile).filter((x): x is NonNullable<typeof x> => Boolean(x));
    if (media.length) kids.media = dir(W, Object.fromEntries(media), t);
    projects[p.slug] = dir(W, kids, t);
  }
  const experience: Record<string, Node> = {};
  (ct.site.experience ?? []).forEach((e, i) => {
    const proj = e.project ? ct.projects.find((p) => p.slug === e.project) : undefined;
    const body = `# ${e.title}\n\n${e.org}${e.place ? ` · ${e.place}` : ''}\n${e.period}\n\n${e.summary ?? proj?.summary ?? ''}\n${proj ? `\nMore: ~/projects/${proj.slug}/README.md\n` : ''}`;
    experience[`${String(i + 1).padStart(2, '0')}-${slugify(e.org).split('-').slice(0, 3).join('-')}.md`] = f(body);
  });
  const skills = (ct.site.skills ?? []).map((k) => `${k.area}:\n${k.items.map((x) => `  ${x}`).join('\n')}`).join('\n\n') + '\n';
  const contact = ct.site.links.map((l) => `${l.label.padEnd(9)}${l.url.replace('mailto:', '')}`).join('\n') + '\n';
  const headshot = mediaFile('headshot');
  const resumePdf = ct.media.find((m) => m.id === 'resume-pdf');

  const home: Record<string, Node> = {
    'README.md': f(`# ${ct.site.name}\n\n${ct.site.role} · ${ct.site.location}\n\n${plainMd(ct.site.bio)}\n\nLook around: ls, cd projects, cat resume.md, tree, grep -ri pytorch .\nOr just ask a question in plain English.\n`),
    'resume.md': f(resumeMd(ct)),
    'contact.txt': f(contact),
    'awards.txt': f((ct.site.awards ?? []).join('\n') + '\n'),
    'skills.txt': f(skills),
    projects: dir(W, projects, t),
    experience: dir(W, experience, t),
    publications: dir(W, { 'holden2026-compag.bib': f(bibtex(ct)) }, t),
    '.plan': f(`${ct.site.role} at Aderant. ${ct.projects.find((p) => p.slug === 'aderant')?.summary ?? ''}\nReach me: ${email(ct)}\n`),
    '.bashrc': f(`# ~/.bashrc for william\nalias ll='ls -alF'\nalias gs='git status'\nalias hire='sudo hire-me'\n`),
  };
  if (headshot) home[headshot[0]] = headshot[1];
  if (resumePdf) home['resume.pdf'] = file(W, '[binary pdf]', { media: 'resume-pdf', mime: MIME['.pdf'], size: resumePdf.bytes ?? 1 }, t);

  const bins = Object.fromEntries(commandNames.map((n) => [n, file(R, '\x7fELF', { exec: true, mime: 'ELF 64-bit LSB pie executable, x86-64, dynamically linked, stripped', size: 14328 + n.length * 1024 }, t)]));
  const etc = {
    hostname: file(R, 'wholden\n', {}, t),
    motd: file(R, MOTD, {}, t),
    issue: file(R, 'wholdenOS 1.0 \\n \\l\n', {}, t),
    'os-release': file(R, 'PRETTY_NAME="wholdenOS 1.0 (Browser)"\nNAME="wholdenOS"\nVERSION_ID="1.0"\nID=wholden\nID_LIKE=debian\nHOME_URL="https://wholden.com/"\n', {}, t),
    passwd: file(R, 'root:x:0:0:root:/root:/bin/bash\nwilliam:x:1000:1000:William O. Holden:/home/william:/bin/bash\nguest:x:1001:1001:Visitor:/home/guest:/bin/bash\n', {}, t),
    shells: file(R, '/bin/sh\n/bin/bash\n', {}, t),
  };
  const proc = {
    version: file(R, 'Linux version 6.8.0-wholden (gcc 13.2.0) #1 SMP PREEMPT_DYNAMIC\n', {}, t),
    cpuinfo: file(R, 'processor\t: 0\nvendor_id\t: GenuineIntel\nmodel name\t: Your browser, doing its best\ncpu MHz\t\t: 3000.000\ncores\t\t: 1\n', {}, t),
    meminfo: file(R, 'MemTotal:        4021320 kB\nMemFree:         2401104 kB\nMemAvailable:    3009276 kB\n', {}, t),
    uptime: file(R, () => `${((Date.now() - t) / 1000).toFixed(2)} 0.00\n`, {}, t),
  };
  return dir(R, {
    bin: dir(R, bins, t),
    etc: dir(R, etc, t),
    home: dir(R, {
      william: dir(W, home, t),
      guest: dir('guest', {
        '.bashrc': file('guest', "# ~/.bashrc: runs when your session starts. Edit it with: nano ~/.bashrc\nalias ll='ls -alF'\nalias la='ls -A'\n", {}, t),
        'README.txt': file('guest', "This is your home directory. Anything you create here is saved in your browser.\nWilliam's files are in /home/william (read-only).\n", {}, t),
      }, t),
    }, t),
    proc: dir(R, proc, t),
    root: dir(R, {}, t),
    tmp: dir(R, {}, t),
    usr: dir(R, { bin: dir(R, bins, t), share: dir(R, { doc: dir(R, { wholden: dir(R, { 'LICENSE': file(R, 'Content © William O. Holden. All rights reserved.\n', {}, t) }, t) }, t) }, t) }, t),
    var: dir(R, { log: dir(R, { 'hire-requests.log': file(R, '', {}, t) }, t) }, t),
    dev: dir(R, { null: file(R, '', {}, t) }, t),
  }, t);
}

// ---------- rendering helpers ----------
const W = (io: IO) => Math.max(40, Math.min(92, io.sh.host.cols()));
const rule = (io: IO, title: string) => `${c(title.toUpperCase(), 'bold', 'cyan')} ${c('─'.repeat(Math.max(0, W(io) - title.length - 1)), 'gray')}`;
const projLink = (io: IO, p: Project, label = p.slug) => (io.isTTY ? cmdLink(c(label, 'cyan'), `open ${p.slug}`) : label);

function findProject(ct: Content, q: string): Project | undefined {
  const s = q.toLowerCase().replace(/\/$/, '').split('/').pop()!;
  return ct.projects.find((p) => p.slug === s) ?? ct.projects.find((p) => p.title.toLowerCase().includes(s));
}

export function skillUses(ct: Content, skill: string): Project[] {
  const k = skill.toLowerCase().replace(/\s+/g, ' ');
  const alias: Record<string, string[]> = { yolo: ['yolov11-pose', 'yolo'], 'llm orchestration': ['llms', 'llm'], rag: ['rag', 'retrieval'], 'agentic workflows': ['agentic'], javascript: ['javascript', 'node.js', 'react'], typescript: ['typescript'], docker: ['docker'], aws: ['aws'] };
  const keys = alias[k] ?? [k];
  return ct.projects.filter((p) => {
    const hay = [...p.stack.map((x) => x.toLowerCase()), p.summary.toLowerCase(), p.body.toLowerCase()];
    return keys.some((key) => hay.some((h) => h === key || (key.length > 2 && new RegExp(`(^|[^a-z])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(h))));
  });
}

export type TimelineItem = { start: string; end?: string; label: string; detail: string; kind: string; slug?: string };
export function timelineItems(ct: Content): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const e of ct.site.experience ?? []) if (e.start) items.push({ start: e.start, end: e.end, label: `${e.title}, ${e.org}`, detail: e.period, kind: 'work', slug: e.project });
  for (const e of ct.site.education ?? []) {
    const y = e.date.match(/\d{4}/)?.[0];
    if (y) items.push({ start: y + (/dec/i.test(e.date) ? '-12' : ''), label: `${e.degree}, ${e.school}`, detail: e.date, kind: 'edu' });
  }
  for (const p of ct.projects) {
    if (p.kind === 'professional' || p.kind === 'research') continue;
    const y = p.period.match(/\d{4}/)?.[0];
    if (!y) continue;
    const season = /spring|feb|jan|mar/i.test(p.period) ? '-03' : /fall|sep|oct|nov/i.test(p.period) ? '-09' : /jun|jul|aug|summer/i.test(p.period) ? '-06' : '';
    items.push({ start: y + season, label: p.title, detail: p.period, kind: p.kind === 'homelab' ? 'lab' : 'project', slug: p.slug });
  }
  for (const pub of ct.site.publications ?? []) { const y = pub.cite.match(/\((\d{4})\)/)?.[1]; if (y) items.push({ start: y, label: 'Publication: Computers and Electronics in Agriculture', detail: y, kind: 'pub', slug: pub.project }); }
  return items.sort((a, b) => b.start.localeCompare(a.start));
}

// ---------- commands ----------
export function portfolioCommands(ct: Content): Record<string, Command> {
  const show = (io: IO, ui: Parameters<NonNullable<IO['sh']['host']['ui']>>[0]) => { if (io.isTTY) io.sh.host.ui?.(ui); };
  const viaTool = async (name: string, input: object, io: IO) => {
    const t = byName(name)!;
    const out = await t.handler(input, { content: ct, host: 'wholden.com', ansi: true, width: W(io) });
    return out;
  };

  const cmds: Record<string, Command> = {
    resume: {
      readonly: true, help: "William's experience, education, and skills",
      man: 'resume [--pdf] [--short] [--md]\n\n  --pdf    show the one-page PDF\n  --short  experience only\n  --md     print the raw markdown (same as cat ~william/resume.md)',
      run: (args, io) => {
        const { f } = getopt(args, '', { pdf: 'p', short: 's', md: 'm' });
        if (f.has('m')) { io.out(resumeMd(ct)); return 0; }
        if (f.has('p')) { io.out(`${c('resume.pdf', 'magenta')} ${c('(one page, phone number removed)', 'gray')}\n`); show(io, { component: 'ResumeViewer', props: {} }); return 0; }
        const s = ct.site, w = W(io), out: string[] = [];
        show(io, { component: 'ProfileHeader', props: {} });
        // In the browser the profile header above already shows the name.
        if (!io.isTTY) out.push('', wrap(`${c(s.name, 'bold')} ${c('· ' + s.role, 'yellow')} ${c('· ' + s.location, 'gray')}`, w), '');
        else out.push('');
        out.push(rule(io, 'experience'));
        for (const e of s.experience ?? []) {
          const proj = e.project ? ct.projects.find((p) => p.slug === e.project) : undefined;
          out.push('', wrap(`${c(e.title, 'bold')} ${c('@', 'gray')} ${e.org}`, w));
          const when = [e.period, e.place].filter(Boolean).join(' · ');
          if (when) out.push(wrap(c(when, 'gray'), w));
          const text = e.summary ?? proj?.summary;
          if (text) out.push(wrap(text, w, '  '));
          if (proj && io.isTTY) out.push('  ' + c('→ ', 'gray') + cmdLink(c(`open ${proj.slug}`, 'cyan'), `open ${proj.slug}`));
        }
        if (!f.has('s')) {
          out.push('', rule(io, 'education'));
          for (const e of s.education ?? []) out.push(wrap(`${c(e.degree, 'bold')}, ${e.school} ${c(e.date, 'gray')}`, w) + (e.detail ? '\n' + c(wrap(e.detail, w, '  '), 'gray') : ''));
          out.push('', rule(io, 'publication'));
          for (const p of s.publications ?? []) out.push(wrap(p.cite, w, '  ') + (p.doi ? '\n  ' + link(c(`doi:${p.doi}`, 'underline'), `https://doi.org/${p.doi}`) : ''));
          out.push('', rule(io, 'awards'));
          for (const a of s.awards ?? []) out.push(`  ${c('★', 'yellow')} ` + wrap(a, w, '    ').slice(4));
          out.push('', rule(io, 'skills'));
          const aw = Math.max(...(s.skills ?? []).map((k) => k.area.length));
          for (const k of s.skills ?? []) {
            const body = wrap(k.items.join(', '), w - aw - 4).split('\n');
            body.forEach((l, i) => out.push(`  ${i === 0 ? c(pad(k.area, aw), 'bold') : ' '.repeat(aw)}  ${l}`));
          }
          out.push('', rule(io, 'projects'));
          for (const p of ct.projects.filter((x) => x.kind !== 'professional' && x.kind !== 'research')) {
            out.push(w < 64 ? `  ${projLink(io, p)}\n    ${p.title} ${c(p.period, 'gray')}` : `  ${pad(projLink(io, p), 22)} ${p.title} ${c(p.period, 'gray')}`);
          }
        }
        out.push('', c(`more: ${io.isTTY ? cmdLink('resume --pdf') + ' · ' + cmdLink('timeline') + ' · ' + cmdLink('skills') + ' · ' + cmdLink('contact') : 'resume --pdf · timeline · skills · contact'}`, 'gray'), '');
        io.out(out.join('\n') + '\n');
        return 0;
      },
    },

    projects: {
      readonly: true, help: 'list projects (optionally filter by keyword)',
      man: 'projects [KEYWORD]\n\n  projects            everything\n  projects pytorch    projects that mention pytorch',
      run: (args, io) => {
        const q = args.join(' ').toLowerCase();
        const list = ct.projects.filter((p) => !q || [p.title, p.summary, p.role ?? '', p.stack.join(' '), p.kind, p.body].join(' ').toLowerCase().includes(q));
        if (!list.length) { io.err(`projects: nothing matches "${q}"\n`); return 1; }
        if (io.isTTY) {
          show(io, { component: 'ProjectGrid', props: { slugs: list.map((p) => p.slug) } });
          io.out(c(`${list.length} project${list.length > 1 ? 's' : ''} · click one, or open <name> · files live in ~william/projects/\n`, 'gray'));
          return 0;
        }
        const sw = Math.max(...list.map((p) => p.slug.length));
        const rows = list.map((p) => `  ${pad(projLink(io, p), sw)}  ${p.title} ${c(`(${p.period})`, 'gray')}\n  ${' '.repeat(sw)}  ${c(p.stack.slice(0, 5).join(' · '), 'gray')}`);
        io.out(`\n${rows.join('\n')}\n\n${c(`open <name> for details · ${list.length} project${list.length > 1 ? 's' : ''} · files live in ~william/projects/`, 'gray')}\n`);
        return 0;
      },
    },

    open: {
      readonly: true, help: 'open a project, image, video, PDF, or link',
      man: 'open <project | file | url>\n\n  open broiler-behavior\n  open ~william/projects/broiler-behavior/media/confusion-matrix.png\n  open resume.pdf',
      run: (args, io) => {
        const target = args[0];
        if (!target) { io.err('usage: open <project | file | url>\n'); return 1; }
        if (/^https?:\/\//.test(target)) { io.out(link(c(target, 'underline'), target) + '\n'); return 0; }
        const abs = io.sh.resolve(target);
        const n = io.sh.fs.stat(abs);
        if (n?.kind === 'file' && n.media) {
          const m = ct.media.find((x) => x.id === n.media)!;
          if (m.type === 'pdf') { show(io, { component: 'ResumeViewer', props: {} }); io.out(c(`${m.title}\n`, 'gray')); return 0; }
          show(io, { component: 'MediaViewer', props: { id: m.id } });
          if (!io.isTTY) io.out(`${m.title}: ${m.caption}\n`);
          return 0;
        }
        if (n?.kind === 'dir') {
          const ids = Object.values(n.children).filter((k): k is Node & { media: string } => k.kind === 'file' && Boolean(k.media)).map((k) => k.media);
          if (ids.length) { show(io, { component: 'Gallery', props: { ids } }); return 0; }
        }
        if (n?.kind === 'file' && !/\/projects\/[^/]+$/.test(abs)) return io.sh.commands.cat.run([target], io);
        const p = findProject(ct, target);
        if (!p) { io.err(`open: ${target}: no such project or file. try: ${cmdLink('projects')}\n`); return 1; }
        const w = W(io);
        // On a terminal the card below shows the stack and links; pipes and the AI get them as text.
        const meta = io.isTTY ? '' : `\n${c('stack:', 'gray')} ${p.stack.join(', ')}\n${p.links.map((l) => `${c(l.label + ':', 'gray')} ${link(c(l.url, 'underline'), l.url)}`).join('\n')}${p.links.length ? '\n' : ''}`;
        io.out(`\n${c(p.title, 'bold')} ${c(p.period, 'gray')}\n${p.role ? c(wrap(p.role, w), 'yellow') + '\n' : ''}\n${wrap(mdToAnsi(plainMd(p.body)), w)}\n${meta}`);
        show(io, { component: 'ProjectCard', props: { slug: p.slug } });
        if (p.media.length && io.isTTY) {
          io.out(`${c(`${p.media.length} media file${p.media.length > 1 ? 's' : ''}:`, 'gray')} ${cmdLink(c(`gallery ${p.slug}`, 'cyan'), `gallery ${p.slug}`)}\n`);
        }
        return 0;
      },
    },

    gallery: {
      readonly: true, help: "show a project's figures and video",
      run: (args, io) => {
        const p = args[0] ? findProject(ct, args[0]) : undefined;
        const withMedia = ct.projects.filter((x) => x.media.length).map((x) => x.slug);
        if (!p || !p.media.length) { io.err(`usage: gallery <${withMedia.join('|')}>\n`); return 1; }
        io.out(c(`${p.title}: ${p.media.length} items\n`, 'gray'));
        show(io, { component: 'Gallery', props: { ids: p.media } });
        if (!io.isTTY) for (const id of p.media) { const m = ct.media.find((x) => x.id === id); if (m) io.out(`${m.id}\t${m.title}\n`); }
        return 0;
      },
    },

    play: {
      readonly: true, help: 'play a video',
      run: (args, io) => {
        const vids = ct.media.filter((m) => m.type === 'video');
        const v = args[0] ? vids.find((m) => args[0].includes(m.id)) : vids[0];
        if (!v) { io.err(`play: no such video. available: ${vids.map((m) => m.id).join(', ')}\n`); return 1; }
        io.out(c(`▶ ${v.title}\n`, 'gray'));
        show(io, { component: 'MediaViewer', props: { id: v.id } });
        return 0;
      },
    },

    skills: {
      readonly: true, help: 'skills by area, with the projects that use them',
      man: 'skills [AREA | SKILL]\n\n  skills           all areas\n  skills pytorch   which projects use PyTorch',
      run: (args, io) => {
        const q = args.join(' ').toLowerCase();
        const areas = ct.site.skills ?? [];
        const area = areas.find((a) => a.area.toLowerCase().startsWith(q) && q);
        if (q && !area) {
          const uses = skillUses(ct, q);
          const listed = areas.find((a) => a.items.some((i) => i.toLowerCase() === q));
          if (!uses.length && !listed) { io.err(`skills: nothing on "${q}". try: ${cmdLink('skills')}, or ask: ask "does he know ${q}?"\n`); return 1; }
          io.out(`\n${c(q, 'bold')}${listed ? c(`  (${listed.area})`, 'gray') : ''}\n`);
          for (const p of uses) io.out(`  ${c('├─', 'gray')} ${projLink(io, p)} ${c(p.title, 'gray')}\n`);
          if (!uses.length) io.out(c('  listed on the resume; no public project shows it yet\n', 'gray'));
          io.out('\n');
          if (uses.length) show(io, { component: 'ProjectGrid', props: { slugs: uses.map((p) => p.slug) } });
          return 0;
        }
        if (io.isTTY) { show(io, { component: 'SkillMap', props: { area: area?.area ?? '' } }); return 0; }
        const out: string[] = [''];
        for (const a of area ? [area] : areas) {
          out.push(c(a.area, 'bold', 'cyan'));
          a.items.forEach((it, i) => {
            const uses = skillUses(ct, it);
            const last = i === a.items.length - 1;
            const bar = uses.length ? ' ' + c('■'.repeat(Math.min(uses.length, 6)), 'green') : '';
            const used = uses.length ? c(` ${uses.map((p) => p.slug).join(', ')}`, 'gray') : '';
            out.push(`  ${c(last ? '└─' : '├─', 'gray')} ${io.isTTY ? cmdLink(it, `skills ${it}`) : it}${bar}${visibleLength(it + used) < W(io) - 10 ? used : ''}`);
          });
          out.push('');
        }
        out.push(c('■ = public projects using it · skills <name> for details', 'gray'), '');
        io.out(out.join('\n') + '\n');
        return 0;
      },
    },

    timeline: {
      readonly: true, help: 'work, school, research, and projects on one timeline',
      run: (_a, io) => {
        if (io.isTTY) { show(io, { component: 'Timeline', props: {} }); return 0; }
        const items = timelineItems(ct);
        const glyph: Record<string, string> = { work: c('●', 'yellow'), edu: c('◆', 'cyan'), project: c('○', 'green'), lab: c('▣', 'magenta'), pub: c('★', 'red') };
        let year = '';
        const out: string[] = [''];
        for (const it of items) {
          const y = it.start.slice(0, 4);
          if (y !== year) { out.push(`${c(y, 'bold')}`); year = y; }
          const label = it.slug && io.isTTY ? cmdLink(it.label, `open ${it.slug}`) : it.label;
          out.push(`  ${c('│', 'gray')}`, `  ${glyph[it.kind] ?? '•'} ${label} ${c(it.detail, 'gray')}`);
        }
        out.push('', `${glyph.work} work  ${glyph.edu} education  ${glyph.pub} publication  ${glyph.project} project  ${glyph.lab} homelab`, '');
        io.out(out.join('\n') + '\n');
        return 0;
      },
    },

    contact: {
      readonly: true, help: 'how to reach William',
      run: (_a, io) => {
        if (io.isTTY) { show(io, { component: 'ProfileHeader', props: {} }); return 0; }
        const rows = ct.site.links.map((l) => `  ${c(l.label.padEnd(9), 'gray')}${link(c(l.url.replace('mailto:', ''), 'underline'), l.url)}`);
        io.out(`\n${rows.join('\n')}\n\n`);
        return 0;
      },
    },

    whois: {
      readonly: true, hidden: true,
      run: async (args, io) => {
        if (args[0] && !/william|wholden|holden/i.test(args[0])) { io.err(`whois: no match for "${args[0]}"\n`); return 1; }
        show(io, { component: 'ProfileHeader', props: {} });
        io.out((await viaTool('about', {}, io)).text);
        return 0;
      },
    },

    finger: {
      readonly: true, help: 'user information lookup',
      run: (args, io) => {
        const u = (args[0] ?? 'william').replace(/@.*/, '');
        if (u === 'guest') { io.out(`Login: guest\t\t\tName: Visitor\nDirectory: /home/guest\t\tShell: /bin/bash\nNo Plan.\n`); return 0; }
        if (u !== 'william') { io.err(`finger: ${u}: no such user.\n`); return 1; }
        io.out(`Login: william\t\t\tName: ${ct.site.name}\nDirectory: /home/william\t\tShell: /bin/bash\nOffice: ${ct.site.location}\nMail: ${email(ct)}\nPlan:\n${io.sh.fs.readFile('/home/william/.plan')}`);
        return 0;
      },
    },

    neofetch: {
      readonly: true, help: 'system information, with a logo',
      run: (_a, io) => {
        const s = ct.site;
        const logo = [
          ' ██╗    ██╗', ' ██║    ██║', ' ██║ █╗ ██║', ' ██║███╗██║', ' ╚███╔███╔╝', '  ╚══╝╚══╝ ',
        ];
        const up = Math.floor((io.sh.host.now() - io.sh.started) / 60000);
        const info = [
          `${c(io.sh.env.USER, 'bold', 'cyan')}@${c('wholden', 'bold', 'cyan')}`, '-'.repeat(io.sh.env.USER.length + 8),
          `${c('OS', 'bold', 'cyan')}: wholdenOS 1.0 (browser)`, `${c('Kernel', 'bold', 'cyan')}: 6.8.0-wholden`, `${c('Uptime', 'bold', 'cyan')}: ${up} min`,
          `${c('Shell', 'bold', 'cyan')}: bash 5.2 (TypeScript edition)`, `${c('Owner', 'bold', 'cyan')}: ${s.name}`, `${c('Role', 'bold', 'cyan')}: ${s.role}, ${s.location}`,
          `${c('Projects', 'bold', 'cyan')}: ${ct.projects.length}`, `${c('Stack', 'bold', 'cyan')}: ${(s.skills ?? []).flatMap((k) => k.items).slice(0, 5).join(', ')}`,
          `${c('Contact', 'bold', 'cyan')}: ${email(ct)}`, '', ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'].map((k) => c('███', k as 'red')).join(''),
        ];
        const narrow = io.sh.host.cols() < 80;
        if (narrow) { io.out('\n' + logo.map((l) => c(l, 'cyan')).join('\n') + '\n\n' + info.join('\n') + '\n\n'); return 0; }
        const rows = Math.max(logo.length, info.length);
        const out: string[] = [''];
        for (let i = 0; i < rows; i++) out.push(c(pad(logo[i] ?? '', 16), 'cyan') + (info[i] ?? ''));
        io.out(out.join('\n') + '\n\n');
        return 0;
      },
    },

    git: {
      readonly: true, help: 'git (log shows real GitHub activity)',
      run: async (args, io) => {
        const sub = args[0];
        const here = io.sh.cwd.match(/^\/home\/william\/projects\/([^/]+)/)?.[1];
        const proj = here ? ct.projects.find((p) => p.slug === here) : undefined;
        const repo = proj?.links.find((l) => /github\.com/.test(l.url))?.url;
        if (!sub) { io.out('usage: git [--version] [--help] <command> [<args>]\n\ncommon: status, log, remote -v, clone <url>\n'); return 1; }
        if (sub === '--version') { io.out('git version 2.43.0\n'); return 0; }
        if (sub === 'log') {
          if (io.sh.readonly) { io.err('git log: not available here (the assistant has a github_activity tool)\n'); return 1; }
          const out = await viaTool('github_activity', {}, io);
          io.out(out.text); if (out.ui) io.sh.host.ui?.(out.ui); return 0;
        }
        if (sub === 'remote') {
          if (!repo) { io.err(here ? `fatal: no public remote for ${here}\n` : 'fatal: not a git repository (or any of the parent directories): .git\n'); return 128; }
          io.out(`origin\t${repo}.git (fetch)\norigin\t${repo}.git (push)\n`); return 0;
        }
        if (sub === 'status') {
          if (!here) { io.err('fatal: not a git repository (or any of the parent directories): .git\n'); return 128; }
          io.out(`On branch main\nYour branch is up to date with 'origin/main'.\n\nnothing to commit, working tree clean\n`); return 0;
        }
        if (sub === 'clone') {
          io.err(`Cloning into '${(args[1] ?? '').split('/').pop()?.replace(/\.git$/, '') || 'repo'}'...\nfatal: unable to access '${args[1] ?? ''}': this sandbox has no network.\nhint: run it on your own machine: git clone ${args[1] ?? repo ?? 'https://github.com/William0Holden'}\n`);
          return 128;
        }
        if (sub === 'blame') { io.out(`^${'c0ffee1'} (William O. Holden 2026-10-13) everything\n`); return 0; }
        if (sub === 'push' || sub === 'commit') { io.err('error: permission denied (this is William\'s repo. nice try though.)\n'); return 1; }
        io.err(`git: '${sub}' is not a git command here. See 'git --help'.\n`);
        return 1;
      },
    },

    curl: {
      readonly: true, help: 'fetch wholden.com pages as text (the same output as curl from your own shell)',
      run: async (args, io) => {
        const urlArg = args.filter((a) => !a.startsWith('-'))[0];
        if (!urlArg) { io.err("curl: try 'curl wholden.com'\n"); return 2; }
        let u: URL;
        try { u = new URL(/^https?:\/\//.test(urlArg) ? urlArg : 'http://' + urlArg); } catch { io.err(`curl: (3) URL rejected: Malformed input to a URL function\n`); return 3; }
        if (!/^(www\.)?wholden\.com$|^localhost$/.test(u.hostname)) { io.err(`curl: (6) Could not resolve host: ${u.hostname}\n${c('(this sandbox can only reach wholden.com)', 'gray')}\n`); return 6; }
        const hit = resolvePath(u.pathname);
        if (!hit) { io.out(`\n  no page at ${u.pathname}. try: curl wholden.com/help\n\n`); return 22; }
        const out = await hit.tool.handler(hit.input, { content: ct, host: 'wholden.com', ansi: io.isTTY, width: W(io) });
        io.out(out.text + '\n');
        return 0;
      },
    },
    wget: { readonly: true, hidden: true, run: (args, io) => { io.err(`--${new Date(io.sh.host.now()).toISOString().slice(0, 19).replace('T', ' ')}--  ${args[0] ?? ''}\nResolving ${args[0] ?? 'host'}... failed: this sandbox has no network. try: curl wholden.com\n`); return 4; } },

    ping: {
      readonly: true, hidden: true,
      run: async (args, io) => {
        const host = args.filter((a) => !a.startsWith('-'))[0];
        if (!host) { io.err('ping: usage error: Destination address required\n'); return 1; }
        if (!/wholden\.com$|^localhost$|^127\.0\.0\.1$/.test(host)) { io.err(`ping: ${host}: Temporary failure in name resolution\n`); return 2; }
        io.out(`PING ${host} (127.0.0.1) 56(84) bytes of data.\n`);
        for (let i = 1; i <= 4; i++) {
          if (io.signal.aborted) break;
          await new Promise((r) => setTimeout(r, io.isTTY ? 400 : 0));
          io.out(`64 bytes from ${host} (127.0.0.1): icmp_seq=${i} ttl=64 time=0.0${(i * 37) % 90} ms\n`);
        }
        io.out(`\n--- ${host} ping statistics ---\n4 packets transmitted, 4 received, 0% packet loss\n`);
        return 0;
      },
    },
    ssh: { readonly: true, hidden: true, run: (args, io) => { io.err(`ssh: connect to host ${(args.find((a) => !a.startsWith('-')) ?? 'localhost').replace(/.*@/, '')} port 22: Connection refused\n${c("(you're already in. this is the terminal.)", 'gray')}\n`); return 255; } },

    sudo: {
      readonly: true, help: 'execute a command as another user',
      run: async (args, io) => {
        const line = args.join(' ');
        if (/^(hire[- ]?me|hire william|hire)$/i.test(line)) {
          const out = await viaTool('sudo_hire_me', {}, io);
          io.out(out.text);
          if (out.ui) io.sh.host.ui?.(out.ui);
          return 0;
        }
        if (!line) { io.err('usage: sudo command\n'); return 1; }
        io.err(`[sudo] password for ${io.sh.env.USER}: \n${io.sh.env.USER} is not in the sudoers file.  This incident will be reported.\n${c('(psst: try sudo hire-me)', 'gray')}\n`);
        return 1;
      },
    },
    su: { readonly: true, hidden: true, run: (_a, io) => { io.err('Password: \nsu: Authentication failure\n'); return 1; } },
    passwd: { readonly: true, hidden: true, run: (_a, io) => { io.err('passwd: Authentication token manipulation error\npasswd: password unchanged\n'); return 1; } },
    shutdown: { readonly: true, hidden: true, run: (_a, io) => { io.err('Failed to set wall message, ignoring: Permission denied\nCall to PowerOff failed: Access denied\n'); return 1; } },
    reboot: { readonly: true, hidden: true, run: (_a, io) => { io.err('Call to Reboot failed: Access denied\n'); return 1; } },
    apt: {
      readonly: true, hidden: true,
      run: (_a, io) => { io.err('E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?\n'); return 100; },
    },
    python3: { readonly: true, hidden: true, run: (_a, io) => { io.err(`Python 3.12.3\n${c('no interpreter in this shell. type', 'gray')} ${cmdLink('boot')} ${c('for a real Linux machine running in your browser.', 'gray')}\n`); return 127; } },
    node: { readonly: true, hidden: true, run: (_a, io) => { io.err(`node: v22.0.0 is not installed here. try ${cmdLink('boot')} for a real Linux.\n`); return 127; } },
    emacs: { readonly: true, hidden: true, run: (_a, io) => { io.err(`emacs: command not found. ${c('(this is a vim/nano household)', 'gray')}\n`); return 127; } },

    cowsay: {
      readonly: true, help: 'a talking cow',
      run: (args, io) => {
        const msg = (args.join(' ') || io.stdin?.trim() || 'moo. hire william.').replace(/\s+/g, ' ');
        const wrapped = wrap(msg, 40).split('\n');
        const w = Math.max(...wrapped.map((l) => l.length));
        const body = wrapped.length === 1 ? [`< ${wrapped[0]} >`] : wrapped.map((l, i) => `${i === 0 ? '/' : i === wrapped.length - 1 ? '\\' : '|'} ${l.padEnd(w)} ${i === 0 ? '\\' : i === wrapped.length - 1 ? '/' : '|'}`);
        io.out([' ' + '_'.repeat(w + 2), ...body, ' ' + '-'.repeat(w + 2), '        \\   ^__^', '         \\  (oo)\\_______', '            (__)\\       )\\/\\', '                ||----w |', '                ||     ||', ''].join('\n'));
        return 0;
      },
    },
    fortune: {
      readonly: true, help: 'print a random adage',
      run: (_a, io) => {
        const f = [
          'There are only two hard things in Computer Science: cache invalidation and naming things. -- Phil Karlton',
          'Premature optimization is the root of all evil. -- Donald Knuth',
          'Talk is cheap. Show me the code. -- Linus Torvalds',
          'Any sufficiently advanced technology is indistinguishable from magic. -- Arthur C. Clarke',
          "It's not a bug, it's a feature request with bad timing.",
          'The best way to predict the future is to invent it. -- Alan Kay',
          'In theory, there is no difference between theory and practice. In practice, there is.',
          'Simplicity is prerequisite for reliability. -- Edsger W. Dijkstra',
        ];
        io.out(f[Math.floor(Math.random() * f.length)] + '\n');
        return 0;
      },
    },
    chicken: {
      readonly: true, hidden: true,
      run: async (_a, io) => { const out = await viaTool('chicken_mode', {}, io); io.out(out.text); if (out.ui) io.sh.host.ui?.(out.ui); return 0; },
    },
    cmatrix: { readonly: true, hidden: true, run: (_a, io) => { io.sh.host.ui?.({ effect: 'matrix' }); return 0; } },
    theme: {
      readonly: true, help: 'switch between dark (default) and light',
      run: (args, io) => {
        const names = ['default', 'light'];
        const n = args[0];
        if (!n || !names.includes(n)) { io.out(`usage: theme <${names.join('|')}>\n`); return n ? 1 : 0; }
        io.sh.host.ui?.({ effect: 'theme', theme: { name: n } });
        io.out(c(`theme: ${n}\n`, 'gray'));
        return 0;
      },
    },

    ask: {
      help: 'ask the AI assistant about William (or just type a question)',
      man: 'ask <question>\n\n  ask "what did he build with pytorch?"\n  ask what is his strongest project | tee answer.txt\n\nThe assistant knows only what is on this site (and can search the web for general topics).\nIt can run read-only commands in this shell and show media inline.',
      run: async (args, io) => {
        if (args[0] === '--reset') { io.sh.host.resetChat?.(); io.out(c('conversation cleared.\n', 'gray')); return 0; }
        const q = (args.join(' ') || io.stdin || '').trim();
        if (!q) { io.err('usage: ask <question>   (ask --reset starts a new conversation)\n'); return 1; }
        if (!io.sh.host.ask) { io.err('ask: the assistant is not available here\n'); return 1; }
        return io.sh.host.ask(q, io);
      },
    },
    chat: {
      help: 'talk to the AI assistant until you type exit',
      run: async (_a, io) => {
        if (!io.sh.host.ask || !io.sh.host.readLine) { io.err('chat: not available here\n'); return 1; }
        io.out(c("chat mode: ask anything about William. 'exit' or Ctrl-D to return to the shell.\n", 'gray'));
        for (;;) {
          const q = await io.sh.host.readLine('ask> ', io.signal);
          if (q === null || /^(exit|quit|q)$/i.test(q.trim())) break;
          if (q.trim()) await io.sh.host.ask(q.trim(), io);
        }
        return 0;
      },
    },
    fit: {
      help: 'paste a job description; see how William matches it',
      man: 'fit [FILE]\n\n  fit                 paste the job description, then press Ctrl-D\n  fit job.txt         read it from a file (try: nano job.txt)\n  pbpaste | fit       (on your machine; here: cat job.txt | fit)\n\nThe assistant extracts the requirements and maps each one to evidence on this site.',
      run: async (args, io) => {
        if (!io.sh.host.ask) { io.err('fit: the assistant is not available here\n'); return 1; }
        let jd = io.stdin ?? '';
        if (args[0]) { try { jd = io.sh.fs.readFile(io.sh.resolve(args[0])); } catch (e) { io.err(`fit: ${args[0]}: ${(e as Error).message}\n`); return 1; } }
        if (!jd.trim() && io.sh.host.readLine) {
          io.out(c('Paste the job description, then press Ctrl-D (or Ctrl-Enter).\n', 'gray'));
          jd = (await io.sh.host.readLine('', io.signal, { multiline: true })) ?? '';
        }
        jd = jd.trim();
        if (jd.length < 40) { io.err('fit: that looks too short to be a job description\n'); return 1; }
        return io.sh.host.ask(jd, io, { kind: 'fit' });
      },
    },

    boot: {
      help: 'boot a real Linux machine in your browser (v86 emulator)',
      run: async (_a, io) => {
        if (!io.sh.host.program) { io.err('boot: not available here\n'); return 1; }
        io.out(c('Booting a real x86 Linux (Buildroot 6.8) inside your browser. Type exit or press Ctrl-] to come back.\n', 'gray'));
        return (await io.sh.host.program({ program: 'boot' }, io.signal)).code;
      },
    },
    top: { readonly: true, help: 'display processes', run: async (_a, io) => (io.sh.host.program && io.isTTY ? (await io.sh.host.program({ program: 'top' }, io.signal)).code : (io.sh.commands.ps.run(['aux'], io), 0)) },
    sl: { readonly: true, hidden: true, run: async (_a, io) => (io.sh.host.program && io.isTTY ? (await io.sh.host.program({ program: 'sl' }, io.signal)).code : 0) },

    less: {
      readonly: true, help: 'page through text (q to quit, / to search)',
      run: async (args, io) => {
        let text = io.stdin ?? '';
        if (args[0]) { try { text = io.sh.fs.readFile(io.sh.resolve(args[0])); } catch (e) { io.err(`less: ${args[0]}: ${(e as Error).message}\n`); return 1; } }
        if (!io.isTTY || !io.sh.host.program) { io.out(text); return 0; }
        return (await io.sh.host.program({ program: 'less', text: /\.md$/.test(args[0] ?? '') ? mdToAnsi(text) : text, title: args[0] ?? '(stdin)' }, io.signal)).code;
      },
    },
    nano: {
      help: 'edit a file (saved files in ~ persist in your browser)',
      run: async (args, io) => editor(args, io, 'nano'),
    },
    vim: { help: 'edit a file, vim style (:w, :q, :wq, i, Esc)', run: async (args, io) => editor(args, io, 'vim') },

    man: {
      readonly: true, help: 'an interface to the manual',
      run: async (args, io) => {
        const name = args[0];
        if (!name) { io.err('What manual page do you want?\nFor example, try \'man resume\'.\n'); return 1; }
        let page: string;
        if (name === 'william' || name === 'wholden') page = `WILLIAM(7)\t\tVisitor's Manual\t\tWILLIAM(7)\n\nNAME\n       william - ${ct.site.role}, ${ct.site.location}\n\nDESCRIPTION\n${wrap(plainMd(ct.site.bio), 72, '       ')}\n\nSEE ALSO\n       resume(1), projects(1), skills(1), timeline(1), contact(1), ask(1)\n`;
        else {
          const cmd = io.sh.commands[name];
          if (!cmd) { io.err(`No manual entry for ${name}\n`); return 16; }
          const up = name.toUpperCase();
          page = `${up}(1)\t\t\tUser Commands\t\t\t${up}(1)\n\nNAME\n       ${name} - ${cmd.help ?? 'a command'}\n\nSYNOPSIS\n${(cmd.man ?? `${name} [OPTION]... [ARG]...`).split('\n').map((l) => '       ' + l).join('\n')}\n\nwholdenOS 1.0\t\t\t2026\t\t\t${up}(1)\n`;
        }
        if (!io.isTTY || !io.sh.host.program) { io.out(page); return 0; }
        return (await io.sh.host.program({ program: 'less', text: page.replace(/^(NAME|SYNOPSIS|DESCRIPTION|SEE ALSO)$/gm, (m) => c(m, 'bold')), title: `man ${name}` }, io.signal)).code;
      },
    },

    help: {
      readonly: true, help: 'list commands',
      run: (_a, io) => {
        const group = (title: string, names: string[]) => {
          const rows = names.filter((n) => io.sh.commands[n]).map((n) => `  ${pad(io.isTTY ? cmdLink(c(n, 'cyan'), n === 'open' ? 'open broiler-behavior' : n === 'skills' ? 'skills' : n) : n, 10)} ${io.sh.commands[n].help ?? ''}`);
          return `${c(title, 'bold')}\n${rows.join('\n')}`;
        };
        io.out(['',
          group('about william', ['resume', 'projects', 'open', 'skills', 'timeline', 'gallery', 'contact', 'neofetch']),
          group('ai', ['ask', 'chat', 'fit']),
          group('shell', ['ls', 'cd', 'cat', 'less', 'grep', 'find', 'tree', 'nano', 'vim', 'man', 'history', 'top', 'curl', 'git']),
          group('extras', ['boot', 'theme', 'cowsay', 'fortune']),
          '',
          c('Pipes, redirects, globs, $VARS, aliases, and tab completion work. Ctrl-R searches history.', 'gray'),
          c('Or skip the commands and type a question in plain English.', 'gray'),
          '',
        ].join('\n') + '\n');
        return 0;
      },
    },
  };
  cmds['apt-get'] = { ...cmds.apt, hidden: true };
  cmds.pip = { ...cmds.apt, hidden: true, run: (_a, io) => { io.err('error: externally-managed-environment\n\n× This environment is externally managed (by William).\n'); return 1; } };
  cmds.npm = { ...cmds.apt, hidden: true, run: (_a, io) => { io.err('npm ERR! code EACCES\nnpm ERR! syscall mkdir\nnpm ERR! path /usr/lib/node_modules\n'); return 243; } };
  cmds.python = { ...cmds.python3 };
  cmds.vi = { ...cmds.vim, hidden: true };
  cmds.htop = { ...cmds.top, hidden: true };
  cmds['xdg-open'] = { ...cmds.open, hidden: true };
  cmds.cv = { ...cmds.resume, hidden: true };
  cmds.hire = { ...cmds.sudo, hidden: true, run: (_a, io) => cmds.sudo.run(['hire-me'], io) };
  cmds.mail = { readonly: true, hidden: true, run: (_a, io) => cmds.contact.run([], io) };
  return cmds;
}

async function editor(args: string[], io: IO, mode: 'nano' | 'vim'): Promise<number> {
  const sh = io.sh;
  if (!io.isTTY || !sh.host.program) { io.err(`${mode}: needs a terminal\n`); return 1; }
  const name = args[0];
  const abs = name ? sh.resolve(name) : '';
  let text = '';
  if (abs) {
    const n = sh.fs.stat(abs);
    if (n?.kind === 'dir') { io.err(`${mode}: ${name}: Is a directory\n`); return 1; }
    if (n?.kind === 'file') { if (n.media) { io.err(`${mode}: ${name}: binary file\n`); return 1; } text = sh.fs.readFile(abs); }
  }
  // Each save (^O, :w) writes straight to the VFS; the return value is an error message or null.
  const write = (t: string): string | null => {
    if (!abs) return 'No file name';
    try { sh.fs.writeFile(abs, t); sh.host.persist?.(); return null; } catch (e) { return `${(e as Error).message}${sh.fs.isWritable(abs) ? '' : " (William's files are read-only; save under ~ instead)"}`; }
  };
  const res = await sh.host.program({ program: 'editor', path: abs, text, mode, readonly: Boolean(abs) && !sh.fs.isWritable(abs), write }, io.signal);
  return res.code;
}

export type { Experience };
