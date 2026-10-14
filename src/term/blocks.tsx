// The fixed UI component registry. Tools return { component, props }; only these render.
// Every prop is looked up against public content, so the model can't inject markup or URLs.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { Content, Media } from '../../tools/registry';

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

const REGISTRY: Record<string, (p: Props) => ReactElement | null> = { FitReport, WebSources, ProjectCard, MediaViewer, Gallery, SitePreview, ResumeViewer, ContactForm, GitHubActivity };

export function UiBlock({ content, ui }: { content: Content | null; ui: { component: string; props: Record<string, unknown> } }) {
  const C = REGISTRY[ui.component];
  if (!C || !content) return null;
  return <div className="cm-ui"><C content={content} props={ui.props ?? {}} /></div>;
}
