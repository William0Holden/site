// Minimal, safe markdown → React (no innerHTML). Supports paragraphs, -/* and 1. lists, **bold**,
// *italic*, `code`, and [links](url) with http(s)/mailto/site-relative targets only.
import { Fragment, type ReactNode } from 'react';

const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/))/i;

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\s][^*]*)\*|(https?:\/\/[^\s)]+))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[2]) out.push(<strong key={k}>{m[2]}</strong>);
    else if (m[3]) out.push(<code key={k}>{m[3]}</code>);
    else if (m[4]) out.push(SAFE_URL.test(m[5]) ? <a key={k} href={m[5]} rel="noopener noreferrer" target={m[5].startsWith('/') ? undefined : '_blank'}>{m[4]}</a> : m[4]);
    else if (m[6]) out.push(<em key={k}>{m[6]}</em>);
    else if (m[7]) out.push(<a key={k} href={m[7]} rel="noopener noreferrer" target="_blank">{m[7]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split('\n').map((l) => l.replace(/^#{1,6}\s+/, ''));
        if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l) || !l.trim())) {
          const ordered = /^\s*\d+\./.test(lines[0]);
          const items = lines.filter((l) => l.trim()).map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ''), li)}</li>);
          return ordered ? <ol key={bi}>{items}</ol> : <ul key={bi}>{items}</ul>;
        }
        return <p key={bi}>{lines.map((l, li) => <Fragment key={li}>{li > 0 && <br />}{inline(l, li)}</Fragment>)}</p>;
      })}
    </>
  );
}
