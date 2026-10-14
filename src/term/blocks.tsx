// The fixed UI component registry. Tools return { component, props }; only these render.
// Every prop is looked up against public content, so the model can't inject markup or URLs.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { composeOnePager, onePagerHtml, onePagerMarkdown, type Content, type Media, type Project } from '../../tools/registry';
import { githubUrl, MAX_READ_LINES, type RepoMeta, type Source } from '../../tools/code';
import { skillUses, timelineItems } from '../../shell/portfolio';

type Props = { content: Content; props: Record<string, unknown> };

// Lets a block run a shell command (e.g. a project card's gallery button).
export const RunContext = createContext<(cmd: string) => void>(() => {});

// Full-screen viewer: arrows / swipe to move, Esc or tap outside to close. Keys are captured so the
// terminal underneath doesn't see them while it is open.
function Lightbox({ items, start, onClose }: { items: Media[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const box = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const go = useCallback((d: number) => setI((x) => (x + d + items.length) % items.length), [items.length]);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const key = (e: KeyboardEvent) => {
      const el = box.current;
      e.stopPropagation();
      if (!el) return;
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      // Keep focus inside the dialog.
      if (e.key === 'Tab') {
        const f = [...el.querySelectorAll<HTMLElement>('button, video[controls]')];
        const at = f.indexOf(document.activeElement as HTMLElement);
        if (f.length) { e.preventDefault(); f[(at + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); }
        return;
      }
      if (!el.contains(e.target as Node)) { e.preventDefault(); el.focus(); return; }
      // A focused video keeps its own keys (space, seeking).
      if ((e.target as HTMLElement).tagName === 'VIDEO') return;
      if (e.key === 'ArrowRight' || e.key === 'l') go(1);
      else if (e.key === 'ArrowLeft' || e.key === 'h') go(-1);
    };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); prev?.focus(); };
  }, [go, onClose]);
  const m = items[i];
  return createPortal(
    <div ref={box} className="lb" role="dialog" aria-modal="true" aria-label={m.title} tabIndex={-1}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onTouchStart={(e) => {
        // One-finger swipes only, and not on the video (its scrubber drags too).
        const t = e.touches[0];
        touch.current = e.touches.length === 1 && (e.target as HTMLElement).tagName !== 'VIDEO' ? { x: t.clientX, y: t.clientY } : null;
      }}
      onTouchMove={(e) => { if (e.touches.length > 1) touch.current = null; }}
      onTouchEnd={(e) => {
        const t0 = touch.current; touch.current = null;
        if (!t0) return;
        const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
      }}>
      <div className="lb-bar">
        <span>{i + 1} / {items.length}</span>
        <button type="button" className="lb-btn" onClick={onClose} aria-label="Close">esc ✕</button>
      </div>
      <figure key={m.id} className="lb-fig" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {m.type === 'video'
          ? <video src={m.url} poster={m.poster} controls autoPlay muted loop playsInline aria-label={m.alt} />
          : <img src={m.url} alt={m.alt} />}
        <figcaption><strong>{m.title}.</strong> {m.caption}</figcaption>
      </figure>
      {items.length > 1 && <>
        <button type="button" className="lb-btn lb-prev" onClick={() => go(-1)} aria-label="Previous">‹</button>
        <button type="button" className="lb-btn lb-next" onClick={() => go(1)} aria-label="Next">›</button>
      </>}
    </div>,
    document.body,
  );
}

function MediaGrid({ items, single }: { items: Media[]; single?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const close = useCallback(() => setOpen(null), []);
  return (
    <>
      <div className={single ? 'cm-gallery cm-single' : 'cm-gallery'}>
        {items.map((m, k) => (
          <figure key={m.id} className="cm-figure" style={{ '--i': k } as CSSProperties}>
            {m.type === 'video'
              ? <video src={m.url} poster={m.poster} controls muted loop playsInline preload="metadata" aria-label={m.alt} />
              : <button type="button" className="cm-zoom" onClick={(e) => { e.stopPropagation(); setOpen(k); }} aria-label={`View ${m.title} full screen`}><img src={m.url} alt={m.alt} loading="lazy" /></button>}
            <figcaption><strong>{m.title}.</strong> {m.caption}</figcaption>
          </figure>
        ))}
      </div>
      {open !== null && <Lightbox items={items} start={open} onClose={close} />}
    </>
  );
}


// ---- shared bits ----
const delay = (k: number) => ({ '--i': k } as CSSProperties);
const mediaOf = (content: Content, p: Project) => p.media.map((id) => content.media.find((m) => m.id === id)).filter((m): m is Media => Boolean(m));
// The image that best represents a project: its first still, or a video's poster.
function coverOf(content: Content, p: Project): string | undefined {
  const ms = mediaOf(content, p);
  return ms.find((m) => m.type === 'image')?.url ?? ms.find((m) => m.poster)?.poster;
}

// A project's cover: its own figure when it has one, otherwise a typographic plate built from its title.
function Cover({ content, p }: { content: Content; p: Project }) {
  const src = coverOf(content, p);
  // Charts and diagrams (PNG) are shown whole; photos fill the frame.
  if (src) return <span className="cv cv-img"><img src={src} alt="" loading="lazy" className={/\.png$/i.test(src) ? 'cv-fit' : undefined} /></span>;
  const stack = p.stack.slice(0, 6);
  return (
    <span className="cv cv-type" aria-hidden="true">
      <span className="cv-cmd"><span className="cv-dim">$</span> tree ~/projects/{p.slug}</span>
      <span className="cv-tree">
        {stack.map((x, i) => <span key={x}><span className="cv-dim">{i === stack.length - 1 ? '└── ' : '├── '}</span>{x}</span>)}
      </span>
    </span>
  );
}

function ProfileHeader({ content }: Props) {
  const s = content.site;
  const run = useContext(RunContext);
  return (
    <div className="pf">
      <img className="pf-photo" src="/media/headshot-480.jpg" alt={`Photo of ${s.name}`} width={480} height={480} />
      <div className="pf-body">
        <span className="pf-name">{s.name}</span>
        <span className="pf-role">{s.role} · {s.location}</span>
        <span className="cm-muted">{s.tagline}</span>
        <span className="pf-links">
          {s.links.map((l) => (
            <a key={l.url} className="cm-btn" href={l.url} target={l.url.startsWith('mailto:') ? undefined : '_blank'} rel="noopener">
              {l.label}{l.url.startsWith('mailto:') ? `: ${l.url.slice(7)}` : ' ↗'}
            </a>
          ))}
          <a className="cm-btn" href="/resume.pdf" target="_blank" rel="noopener">Resume PDF ↗</a>
          <button type="button" className="cm-btn" onClick={() => run('projects')}>Projects</button>
        </span>
      </div>
    </div>
  );
}

function ProjectGrid({ content, props }: Props) {
  const run = useContext(RunContext);
  const slugs = Array.isArray(props.slugs) ? (props.slugs as unknown[]).map(String) : content.projects.map((p) => p.slug);
  const list = slugs.map((sl) => content.projects.find((p) => p.slug === sl)).filter((p): p is Project => Boolean(p)).slice(0, 24);
  return (
    <div className="pg">
      {list.map((p, k) => (
        <button type="button" key={p.slug} className="pg-card" style={delay(k)} onClick={() => run(`open ${p.slug}`)} aria-label={`Open ${p.title}`}>
          <Cover content={content} p={p} />
          <span className="pg-meta"><span>{p.kind.replace('-', ' ')}</span><span>{p.period}</span></span>
          <strong className="pg-title">{p.title}</strong>
          <span className="pg-sum">{p.summary}</span>
          <span className="pg-stack">{p.stack.slice(0, 4).join(' · ')}</span>
        </button>
      ))}
    </div>
  );
}

const TL_KIND: Record<string, string> = { work: 'work', edu: 'education', project: 'project', lab: 'homelab', pub: 'publication' };
function Timeline({ content }: Props) {
  const run = useContext(RunContext);
  const items = timelineItems(content);
  let year = '';
  return (
    <ol className="tl">
      {items.map((it, k) => {
        const y = it.start.slice(0, 4);
        const head = y !== year ? (year = y) : null;
        const p = it.slug ? content.projects.find((x) => x.slug === it.slug) : undefined;
        const img = p ? coverOf(content, p) : undefined;
        const body = (
          <>
            <span className="tl-text">
              <span className="tl-kind">{TL_KIND[it.kind] ?? it.kind}</span>
              <span className="tl-label">{it.label}</span>
              <span className="cm-muted">{it.detail}</span>
            </span>
            {img && <img className="tl-img" src={img} alt="" loading="lazy" />}
          </>
        );
        return (
          <li key={k} className={`tl-item tl-${it.kind}`} style={delay(k)}>
            {head && <span className="tl-year">{head}</span>}
            {p ? <button type="button" className="tl-card" onClick={() => run(`open ${p.slug}`)}>{body}</button> : <span className="tl-card">{body}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function SkillMap({ content, props }: Props) {
  const run = useContext(RunContext);
  const want = typeof props.area === 'string' ? props.area.toLowerCase() : '';
  const areas = (content.site.skills ?? []).filter((a) => !want || a.area.toLowerCase().startsWith(want));
  return (
    <div className="sk">
      {areas.map((a, k) => (
        <section key={a.area} className="sk-area" style={delay(k)}>
          <span className="cm-eyebrow">{a.area}</span>
          <span className="sk-chips">
            {a.items.map((it) => {
              const n = skillUses(content, it).length;
              return (
                <button type="button" key={it} className={n ? 'sk-chip sk-used' : 'sk-chip'} onClick={() => run(`skills ${it}`)}
                  title={n ? `${n} public project${n > 1 ? 's' : ''}` : 'on the resume'}>
                  {it}{n > 0 && <span className="sk-n">{n}</span>}
                </button>
              );
            })}
          </span>
        </section>
      ))}
      <span className="cm-muted sk-key">numbers = public projects that use it · click a skill for those projects</span>
    </div>
  );
}


// ---- code, sources, messages, one-pager ----
let repoIndex: Promise<RepoMeta[]> | null = null;
const repos = () => (repoIndex ??= fetch('/api/code/index.json').then((r) => (r.ok ? r.json() : [])).catch(() => []));
const useRepos = () => {
  const [list, setList] = useState<RepoMeta[] | null>(null);
  useEffect(() => { let live = true; repos().then((l) => live && setList(l)); return () => { live = false; }; }, []);
  return list;
};

const COMMENT = /^\s*(#|\/\/|--|\/\*|\*|<!--)/;
const KEYWORDS = /\b(def|class|return|import|from|as|if|elif|else|for|while|in|with|try|except|finally|raise|yield|lambda|async|await|function|const|let|var|export|default|new|interface|type|public|private|static|void|self|this|None|True|False|null|true|false)\b/g;
function CodeLine({ text }: { text: string }) {
  if (COMMENT.test(text)) return <span className="code-c">{text}</span>;
  const parts: (string | ReactElement)[] = [];
  let last = 0, k = 0;
  for (const m of text.matchAll(KEYWORDS)) { parts.push(text.slice(last, m.index), <b key={k++}>{m[0]}</b>); last = m.index! + m[0].length; }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function CodeBlock({ props }: Props) {
  const list = useRepos();
  const [text, setText] = useState<string | null>(null);
  const meta = list?.find((r) => r.name === props.repo);
  const path = String(props.path ?? '');
  const ok = Boolean(meta?.paths.includes(path));
  const start = Math.max(1, Number(props.start) || 1);
  const end = Math.min(start + MAX_READ_LINES - 1, Math.max(start, Number(props.end) || start + 40));
  useEffect(() => {
    if (!meta || !ok) return;
    let live = true;
    fetch(`/api/code/${encodeURIComponent(meta.name)}/${path.split('/').map(encodeURIComponent).join('/')}.txt`).then((r) => (r.ok ? r.text() : '')).then((t) => live && setText(t));
    return () => { live = false; };
  }, [meta, ok, path]);
  if (list && !ok) return null;
  const lines = text?.split('\n').slice(start - 1, end) ?? [];
  const w = String(end).length;
  return (
    <figure className="code">
      <figcaption className="code-bar">
        <span className="code-path">{meta?.team && <span className="code-team">team repo</span>}{props.repo as string}/{path} <span className="cm-muted">L{start}–{Math.min(end, start + lines.length - 1 || end)}</span></span>
        {meta && <a href={githubUrl(meta, path, start, end)} target="_blank" rel="noopener">GitHub ↗</a>}
      </figcaption>
      <pre className="code-body">{text === null ? <span className="cm-muted">loading…</span> : lines.map((l, i) => (
        <span key={i} className="code-row"><span className="code-n" aria-hidden="true">{String(start + i).padStart(w)}</span><CodeLine text={l} />{'\n'}</span>
      ))}</pre>
    </figure>
  );
}

function Sources({ content, props }: Props) {
  const run = useContext(RunContext);
  const list = useRepos();
  const refs = (Array.isArray(props.refs) ? props.refs : []) as Source[];
  const seen = new Set<string>();
  const items = refs.map((r, k) => {
    const key = JSON.stringify(r);
    if (seen.has(key)) return null;
    seen.add(key);
    if (r.kind === 'project') {
      const p = content.projects.find((x) => x.slug === r.slug);
      return p ? <li key={k}><button type="button" className="cm-linkbtn" onClick={() => run(`open ${p.slug}`)}>{p.title}</button> <span className="cm-muted">project write-up</span></li> : null;
    }
    if (r.kind === 'site') return <li key={k}><button type="button" className="cm-linkbtn" onClick={() => run('resume')}>resume</button> <span className="cm-muted">{r.label.replace(/^resume: /, '')}</span></li>;
    if (r.kind === 'repo') {
      const meta = list?.find((x) => x.name === r.repo);
      if (!meta || !meta.paths.includes(r.path)) return null;
      return <li key={k}><a href={githubUrl(meta, r.path, r.start, r.end)} target="_blank" rel="noopener">{r.repo}/{r.path}</a> <span className="cm-muted">L{r.start}–{r.end}</span></li>;
    }
    return null;
  }).filter(Boolean);
  if (!items.length) return null;
  return <div className="cm-sources src"><span className="cm-eyebrow">Sources</span><ul>{items}</ul></div>;
}

const MESSAGE_ERRORS: Record<string, string> = {
  name_required: 'Add your name.', email_invalid: 'That email address doesn’t look right.', note_too_short: 'Write a little more (10+ characters).',
  rate_messages: 'Message limit reached for today. Email him directly instead.', verification_required: 'Ask the assistant a question first (that verifies the browser), then send.',
  not_configured: 'Messages are offline right now. Email him directly instead.', send_failed: 'Sending failed. Try again, or email him directly.',
};
function MessageForm({ content, props }: Props) {
  const [f, setF] = useState({ name: String(props.name ?? '').slice(0, 80), email: String(props.email ?? '').slice(0, 120), note: String(props.note ?? '').slice(0, 2000), website: '' });
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [err, setErr] = useState('');
  const mail = content.site.links.find((l) => l.url.startsWith('mailto:'))?.url.slice(7);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('sending'); setErr('');
    try {
      const r = await fetch('/api/message', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f), credentials: 'same-origin' });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) setState('sent');
      else { setState('error'); setErr(MESSAGE_ERRORS[d.error] ?? 'Something went wrong.'); }
    } catch { setState('error'); setErr(MESSAGE_ERRORS.send_failed); }
  };
  if (state === 'sent') return <div className="msg msg-sent"><strong>✓ Sent.</strong> <span className="cm-muted">William will reply to {f.email}.</span></div>;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="msg" onSubmit={send} data-nofocus>
      <span className="cm-eyebrow">Message to William</span>
      <label>name<input value={f.name} onChange={set('name')} maxLength={80} required autoComplete="name" /></label>
      <label>email<input type="email" value={f.email} onChange={set('email')} maxLength={120} required autoComplete="email" /></label>
      <label>message<textarea value={f.note} onChange={set('note')} maxLength={2000} rows={5} required minLength={10} /></label>
      <input className="msg-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={set('website')} />
      <span className="msg-actions">
        <button type="submit" className="cm-btn" disabled={state === 'sending'}>{state === 'sending' ? 'sending…' : 'Send'}</button>
        {mail && <span className="cm-muted">or email <a href={`mailto:${mail}`}>{mail}</a></span>}
      </span>
      {err && <span className="msg-err" role="alert">{err}</span>}
    </form>
  );
}

function OnePager({ content, props }: Props) {
  const o = composeOnePager(content, {
    role: String(props.role ?? ''),
    requirements: (Array.isArray(props.requirements) ? props.requirements : []).map(String).slice(0, 10),
    projects: (Array.isArray(props.projects) ? props.projects : []).map(String).slice(0, 4),
  });
  const file = `William-Holden${o.role ? '-' + o.role.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') : ''}`.slice(0, 80);
  const download = () => {
    const url = URL.createObjectURL(new Blob([onePagerMarkdown(o)], { type: 'text/markdown' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${file}.md` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const print = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(onePagerHtml(o));
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  };
  return (
    <div className="op">
      <div className="op-bar">
        <span className="cm-eyebrow">One-pager{o.role ? ` · ${o.role}` : ''}</span>
        <span className="op-actions"><button type="button" className="cm-btn" onClick={print}>Save as PDF</button><button type="button" className="cm-btn" onClick={download}>Download .md</button></span>
      </div>
      <article className="op-page">
        <h3>{o.name}</h3>
        <p className="op-m">{o.headline} · {o.contact.join(' · ')}</p>
        {o.role && <p className="op-role">Relevant experience for: {o.role}</p>}
        <h4>Experience</h4>
        {o.experience.map((e) => <p key={e.org}><b>{e.title}</b>, {e.org} <span className="op-m">{e.period}</span><br />{e.summary}</p>)}
        <h4>Selected projects</h4>
        {o.projects.map((p) => <div key={p.slug}><p><b>{p.title}</b> <span className="op-m">{p.period}</span><br />{p.summary}</p>{p.bullets.length > 0 && <ul>{p.bullets.map((b) => <li key={b}>{b}</li>)}</ul>}</div>)}
        <h4>Skills</h4><p>{o.skills.join(', ')}</p>
        <h4>Education</h4><ul>{o.education.map((e) => <li key={e}>{e}</li>)}</ul>
      </article>
    </div>
  );
}

function ProjectCard({ content, props }: Props) {
  const run = useContext(RunContext);
  const p = content.projects.find((x) => x.slug === props.slug);
  if (!p) return null;
  const media = p.media.map((id) => content.media.find((m) => m.id === id)).filter((m): m is Media => Boolean(m));
  const thumbs = media.filter((m) => m.type === 'image').slice(0, 3);
  return (
    <div className="cm-card">
      {thumbs.length > 0 && (
        <button type="button" className="cm-thumbs" data-n={thumbs.length} onClick={() => run(`gallery ${p.slug}`)} aria-label={`Show all ${media.length} figures for ${p.title}`}>
          {thumbs.map((m, k) => <img key={m.id} src={m.url} alt="" loading="lazy" style={{ '--i': k } as CSSProperties} />)}
          {media.length > thumbs.length && <span className="cm-more">+{media.length - thumbs.length}</span>}
        </button>
      )}
      <span className="cm-eyebrow">{p.kind.replace('-', ' ')} · {p.period}</span>
      <strong>{p.title}</strong>
      <span className="cm-muted">{p.summary}</span>
      <span className="cm-chips">{p.stack.slice(0, 8).map((s) => <button type="button" key={s} onClick={() => run(`skills ${s}`)}>{s}</button>)}</span>
      {p.links.length > 0 && <span className="cm-links">{p.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener">{l.label} ↗</a>)}</span>}
    </div>
  );
}

function MediaViewer({ content, props }: Props) {
  const m = content.media.find((x) => x.id === props.id);
  return m ? <MediaGrid items={[m]} single /> : null;
}

function Gallery({ content, props }: Props) {
  const ids = Array.isArray(props.ids) ? (props.ids as string[]) : [];
  const items = ids.map((id) => content.media.find((m) => m.id === id)).filter((m): m is Media => Boolean(m));
  return <MediaGrid items={items} />;
}

function SitePreview({ content, props }: Props) {
  const p = content.projects.find((x) => x.liveUrl === props.url);
  if (!p?.liveUrl) return null;
  return (
    <div className="cm-site">
      <iframe src={p.liveUrl} title={`Live preview of ${p.title}`} loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups" referrerPolicy="no-referrer" />
      <a href={p.liveUrl} target="_blank" rel="noopener">Open {new URL(p.liveUrl).host} ↗</a>
    </div>
  );
}

function ResumeViewer() {
  return (
    <div className="cm-resume">
      <object data="/resume.pdf" type="application/pdf" aria-label="Resume PDF"><p>PDF preview unavailable.</p></object>
      <p><a href="/resume.pdf" target="_blank" rel="noopener">Open the PDF ↗</a> · <a href="/resume.pdf" download="William-Holden-Resume.pdf">Download</a></p>
    </div>
  );
}

function ContactForm({ content }: Props) {
  return (
    <div className="cm-contact">
      {content.site.links.map((l) => (
        <a key={l.url} className="cm-btn" href={l.url} target={l.url.startsWith('mailto:') ? undefined : '_blank'} rel="noopener">
          {l.label}{l.url.startsWith('mailto:') ? `: ${l.url.slice(7)}` : ''}
        </a>
      ))}
    </div>
  );
}

type GhItem = { repo: string; type: string; date: string; commits: number };
function GitHubActivity({ props }: Props) {
  const items = (Array.isArray(props.items) ? props.items : []) as GhItem[];
  return (
    <ul className="cm-gh">
      {items.slice(0, 8).map((i, k) => (
        <li key={k}>
          <span className="cm-muted">{String(i.date)}</span> {String(i.type)}{' '}
          <a href={`https://github.com/${encodeURI(String(i.repo))}`} target="_blank" rel="noopener">{String(i.repo)}</a>
          {i.commits > 0 && <span className="cm-muted"> ({Number(i.commits)} commits)</span>}
        </li>
      ))}
    </ul>
  );
}

function WebSources({ props }: Props) {
  const list = (Array.isArray(props.sources) ? props.sources : []) as { url?: unknown; title?: unknown }[];
  const safe = list
    .map((s) => { try { const u = new URL(String(s.url)); return /^https?:$/.test(u.protocol) ? { url: u.href, title: String(s.title ?? u.hostname), host: u.hostname } : null; } catch { return null; } })
    .filter((s): s is { url: string; title: string; host: string } => Boolean(s))
    .slice(0, 5);
  if (!safe.length) return null;
  return (
    <div className="cm-sources">
      <span className="cm-eyebrow">From the web</span>
      <ul>{safe.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer nofollow">{s.title}</a> <span className="cm-muted">{s.host}</span></li>)}</ul>
    </div>
  );
}

type FitRow = { requirement?: unknown; strength?: unknown; evidence?: { slug?: unknown; why?: unknown }[] };
function FitReport({ content, props }: Props) {
  const run = useContext(RunContext);
  const rows = (Array.isArray(props.rows) ? props.rows : []) as FitRow[];
  const mark: Record<string, string> = { strong: '●', partial: '◐', none: '○' };
  return (
    <div className="cm-fit-wrap"><table className="cm-fit">
      <thead><tr><th>requirement</th><th>match</th><th>evidence</th></tr></thead>
      <tbody>
        {rows.slice(0, 12).map((r, i) => {
          const strength = ['strong', 'partial', 'none'].includes(String(r.strength)) ? String(r.strength) : 'none';
          const ev = (Array.isArray(r.evidence) ? r.evidence : []).map((e) => ({ p: content.projects.find((x) => x.slug === e.slug), why: String(e.why ?? '').slice(0, 140) })).filter((e) => e.p).slice(0, 3);
          return (
            <tr key={i} className={`fit-${strength}`}>
              <td>{String(r.requirement ?? '').slice(0, 120)}</td>
              <td><span aria-hidden="true">{mark[strength]}</span> {strength === 'none' ? 'not shown' : strength}</td>
              <td>{ev.length ? ev.map((e, k) => <span key={k}><button type="button" className="cm-linkbtn" onClick={() => run(`open ${e.p!.slug}`)}>{e.p!.slug}</button>{e.why && <span className="cm-muted"> {e.why}</span>}{k < ev.length - 1 && '; '}</span>) : <span className="cm-muted">—</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table></div>
  );
}

const REGISTRY: Record<string, (p: Props) => ReactElement | null> = { CodeBlock, Sources, MessageForm, OnePager, ProfileHeader, ProjectGrid, Timeline, SkillMap, FitReport, WebSources, ProjectCard, MediaViewer, Gallery, SitePreview, ResumeViewer, ContactForm, GitHubActivity };

export function UiBlock({ content, ui }: { content: Content | null; ui: { component: string; props: Record<string, unknown> } }) {
  const C = REGISTRY[ui.component];
  if (!C || !content) return null;
  return <div className="cm-ui"><C content={content} props={ui.props ?? {}} /></div>;
}
