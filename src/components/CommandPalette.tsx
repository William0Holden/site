import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './CommandPalette.css';
import { fuzzyScore } from './fuzzy';

type Content = import('../../tools/registry').Content;
type Registry = typeof import('../../tools/registry');

type Item =
  | { id: string; kind: 'page' | 'project'; label: string; hint: string; href: string }
  | { id: string; kind: 'command'; label: string; hint: string; cmd: string };

const PAGES: [string, string][] = [
  ['/', 'Chat (home)'], ['/projects', 'Work'], ['/resume', 'Resume'], ['/resume#contact', 'Contact'], ['/terminal', 'Terminal'],
];

let registryP: Promise<Registry> | null = null;
let contentP: Promise<Content> | null = null;
const loadRegistry = () => (registryP ??= import('../../tools/registry'));
const loadContent = (): Promise<Content> =>
  (contentP ??= fetch('/api/content.json').then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }).catch((e) => { contentP = null; throw e; }));

export default function CommandPalette() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [items, setItems] = useState<Item[]>(() => PAGES.map(([href, label]) => ({ id: `page:${href}`, kind: 'page', label, hint: href, href })));
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [output, setOutput] = useState<{ cmd: string; text: string } | null>(null);
  const [status, setStatus] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const isMac = useMemo(() => typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent), [mounted]);
  const touch = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches, [mounted]);

  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    try {
      const [reg, content] = await Promise.all([loadRegistry(), loadContent()]);
      setRegistry(reg);
      const projects: Item[] = content.projects.map((p) => ({ id: `project:${p.slug}`, kind: 'project', label: p.title, hint: p.kind.replace('-', ' '), href: `/p/${p.slug}` }));
      const commands: Item[] = reg.tools
        .filter((t) => t.visibility === 'listed' && t.surfaces.includes('cli') && !(t.cli?.args?.length))
        .map((t) => { const cmd = t.cli?.aliases?.[0] ?? t.name; return { id: `cmd:${t.name}`, kind: 'command', label: cmd, hint: t.description, cmd }; });
      setItems([...PAGES.map(([href, label]): Item => ({ id: `page:${href}`, kind: 'page', label, hint: href, href })), ...projects, ...commands]);
      setStatus('');
    } catch {
      setStatus('Could not load projects and commands. Pages are still available.');
    }
  }, []);

  const show = useCallback(() => {
    opener.current = document.activeElement as HTMLElement | null;
    setOpen(true);
    void load();
  }, [load]);

  const close = useCallback(() => {
    setOpen(false); setQuery(''); setOutput(null); setActive(0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open ? close() : show();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, show, close]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); input.current?.focus(); }
    if (!open && d.open) { d.close(); opener.current?.focus?.(); }
  }, [open]);

  const results = useMemo(() => {
    const q0 = query.trim().toLowerCase();
    const scored = items.map((it) => ({ it, s: Math.max(fuzzyScore(query, it.label), q0 && it.hint.toLowerCase().includes(q0) ? 1 : -1) }))
      .filter((x) => x.s >= 0);
    if (query.trim()) scored.sort((a, b) => b.s - a.s);
    const list = scored.map((x) => x.it).slice(0, 30);
    // A typed command line that the registry understands ("show decktection") runs as-is.
    const q = query.trim();
    if (q && registry) {
      const hit = registry.resolveCommand(q);
      if (hit && 'tool' in hit && hit.tool.visibility === 'listed' && !list.some((i) => i.kind === 'command' && i.cmd === q))
        list.unshift({ id: 'cmd:typed', kind: 'command', label: q, hint: `Run: ${hit.tool.description}`, cmd: q });
    }
    return list;
  }, [items, query, registry]);

  useEffect(() => setActive(0), [query]);

  const run = async (item: Item) => {
    if (item.kind !== 'command') { close(); location.href = item.href; return; }
    try {
      const [reg, content] = await Promise.all([loadRegistry(), loadContent()]);
      const hit = reg.resolveCommand(item.cmd);
      if (!hit) return;
      if ('error' in hit) { setOutput({ cmd: item.cmd, text: hit.error }); return; }
      const out = await hit.tool.handler(hit.input, { content, host: location.host || 'wholden.com', ansi: false, width: window.innerWidth < 500 ? 40 : 72 });
      setOutput({ cmd: item.cmd, text: out.text.replace(/^\n+|\n+$/g, '') });
    } catch {
      setOutput({ cmd: item.cmd, text: 'Could not load content. Try refreshing.' });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (output) {
      if (e.key === 'Escape' || (e.key === 'Backspace' && document.activeElement !== input.current)) {
        e.preventDefault(); setOutput(null); input.current?.focus();
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(Math.max(0, results.length - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = results[active]; if (it) void run(it); }
    else if (e.key === 'Tab') {
      // Focus trap: only the input and the close button are tabbable.
      const nodes = dialog.current?.querySelectorAll<HTMLElement>('input, button:not([tabindex="-1"])');
      if (!nodes?.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  useEffect(() => {
    document.getElementById(`cp-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!mounted) return null;
  const activeId = results[active] ? `cp-opt-${active}` : undefined;

  return (
    <>
      <button type="button" className="cp-hint" onClick={show} aria-haspopup="dialog" aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}>
        <span aria-hidden="true">{touch ? 'Search' : isMac ? '⌘K' : 'Ctrl K'}</span>
        <span className="cp-sr">Open command palette</span>
      </button>
      <dialog
        ref={dialog}
        className="cp"
        aria-label="Command palette"
        onCancel={(e) => { e.preventDefault(); if (output) { setOutput(null); input.current?.focus(); } else close(); }}
        onClick={(e) => { if (e.target === dialog.current) close(); }}
        onKeyDown={onKeyDown}
      >
        <div className="cp-panel">
          <div className="cp-top">
            <input
              ref={input}
              className="cp-input"
              type="text"
              role="combobox"
              aria-expanded={!output}
              aria-controls="cp-list"
              aria-activedescendant={output ? undefined : activeId}
              aria-autocomplete="list"
              aria-label="Search pages, projects, and commands"
              placeholder="Search or type a command…"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setOutput(null); }}
            />
            <button type="button" className="cp-close" onClick={close}>Esc<span className="cp-sr"> close</span></button>
          </div>
          {output ? (
            <div className="cp-output" role="region" aria-label={`Output of ${output.cmd}`} aria-live="polite">
              <p className="cp-out-head"><span className="mono">$ {output.cmd}</span> <button type="button" className="cp-back" onClick={() => { setOutput(null); input.current?.focus(); }}>Back</button></p>
              <pre>{output.text}</pre>
            </div>
          ) : (
            <ul id="cp-list" className="cp-list" role="listbox" aria-label="Results">
              {results.map((it, i) => (
                <li
                  key={it.id}
                  id={`cp-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className="cp-opt"
                  onMouseMove={() => setActive(i)}
                  onClick={() => void run(it)}
                >
                  <span className={`cp-kind cp-${it.kind}`}>{it.kind === 'command' ? 'run' : it.kind}</span>
                  <span className="cp-label">{it.label}</span>
                  <span className="cp-desc">{it.hint}</span>
                </li>
              ))}
              {results.length === 0 && <li className="cp-empty" role="presentation">No matches. Try “help”.</li>}
            </ul>
          )}
          <p className="cp-foot" aria-live="polite">{status || '↑↓ to move · Enter to open or run · Esc to close'}</p>
        </div>
      </dialog>
    </>
  );
}
