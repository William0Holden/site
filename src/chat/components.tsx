// The fixed UI component registry. Tools return { component, props }; only these render.
// Every prop is looked up against public content, so the model can't inject markup or URLs.
import type { ReactElement } from 'react';
import type { Content, Media } from '../../tools/registry';

type Props = { content: Content; props: Record<string, unknown> };

function MediaItem({ m }: { m: Media }) {
  return (
    <figure className="cm-figure">
      {m.type === 'video' ? (
        <video src={m.url} poster={m.poster} controls muted loop playsInline preload="metadata" aria-label={m.alt} />
      ) : (
        <a href={m.url} target="_blank" rel="noopener"><img src={m.url} alt={m.alt} loading="lazy" /></a>
      )}
      <figcaption><strong>{m.title}.</strong> {m.caption}</figcaption>
    </figure>
  );
}

function ProjectCard({ content, props }: Props) {
  const p = content.projects.find((x) => x.slug === props.slug);
  if (!p) return null;
  const thumb = p.media.map((id) => content.media.find((m) => m.id === id)).find((m) => m?.type === 'image');
  return (
    <a className="cm-card" href={`/p/${p.slug}`}>
      {thumb && <img src={thumb.url} alt="" loading="lazy" />}
      <span className="cm-eyebrow">{p.kind.replace('-', ' ')} · {p.period}</span>
      <strong>{p.title}</strong>
      <span className="cm-muted">{p.summary}</span>
      <span className="cm-chips">{p.stack.slice(0, 6).map((s) => <span key={s}>{s}</span>)}</span>
    </a>
  );
}

function MediaViewer({ content, props }: Props) {
  const m = content.media.find((x) => x.id === props.id);
  return m ? <MediaItem m={m} /> : null;
}

function Gallery({ content, props }: Props) {
  const ids = Array.isArray(props.ids) ? (props.ids as string[]) : [];
  const items = ids.map((id) => content.media.find((m) => m.id === id)).filter((m): m is Media => Boolean(m));
  return <div className="cm-gallery">{items.map((m) => <MediaItem key={m.id} m={m} />)}</div>;
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
      <p><a href="/resume.pdf" target="_blank" rel="noopener">Open the PDF</a> · <a href="/resume">Read it as a web page</a></p>
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

const REGISTRY: Record<string, (p: Props) => ReactElement | null> = { WebSources, ProjectCard, MediaViewer, Gallery, SitePreview, ResumeViewer, ContactForm, GitHubActivity };

export function UiBlock({ content, ui }: { content: Content | null; ui: { component: string; props: Record<string, unknown> } }) {
  const C = REGISTRY[ui.component];
  if (!C || !content) return null;
  return <div className="cm-ui"><C content={content} props={ui.props ?? {}} /></div>;
}
