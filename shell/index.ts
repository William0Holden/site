// Assemble a shell over William's content. The browser passes a full host; the Worker passes a
// minimal one and `readonly: true` for the AI's run_shell tool.
import { coreutils } from './coreutils.ts';
import { buildTree, portfolioCommands } from './portfolio.ts';
import { Shell, type Command, type Host, type IO } from './sh.ts';
import { VFS } from './vfs.ts';
import { stripAnsi } from './ansi.ts';
import type { Content } from '../tools/registry.ts';

export function createShell(content: Content, host: Host, opts: { readonly?: boolean } = {}): Shell {
  const commands: Record<string, Command> = { ...coreutils, ...portfolioCommands(content) };
  const names = Object.keys(commands).filter((n) => /^[a-z][a-z0-9-]*$/.test(n)).sort();
  const fs = new VFS(buildTree(content, names, host.now()));
  return new Shell(fs, commands, host, { user: 'guest', home: '/home/guest', cwd: '/home/william', readonly: opts.readonly });
}

// Words that start a command line rather than a sentence.
export function isCommandLine(sh: Shell, line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  const first = t.split(/[\s|;&<>]/)[0];
  if (!first) return true;
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) return true;
  if (/^[./~$!(`'"\\]/.test(first)) return true;
  return Boolean(sh.commands[first] || sh.aliases[first]);
}

const GREETING = /^(hi|hello|hey|yo|sup|hiya|howdy|thanks|thank you|ty|hola|morning|evening)[!.?]*$/i;

// Plain English that happens to start with a command name ("which projects use pytorch?",
// "find me his best project"): a question mark or a sentence about William, with no flags or
// shell syntax, goes to the assistant instead of the command.
const ABOUT = /\b(he|his|him|william|does|did|has|have|you|your|tell|about|what|how|why|projects?|experience|work(ed)?)\b/i;
export function looksLikeSentence(line: string): boolean {
  const t = line.trim();
  if (/[|<>;&$`=\\/~*]/.test(t) || /(^|\s)-/.test(t) || /^[.'"]/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 3) return false;
  return /\?$/.test(t) || (words.length >= 4 && ABOUT.test(words.slice(1).join(' ')));
}

// True when a line that isn't a command reads like a question or request for the assistant.
export function looksLikeQuestion(line: string): boolean {
  const t = line.trim();
  return /\s/.test(t) || /\?$/.test(t) || GREETING.test(t);
}

// Run one command line in a fresh read-only shell and return plain text (for the AI tool).
export async function runReadonly(content: Content, line: string, opts: { cols?: number; signal?: AbortSignal; now?: number } = {}): Promise<{ code: number; text: string }> {
  let buf = '';
  const cap = 6000;
  const host: Host = { cols: () => opts.cols ?? 80, now: () => opts.now ?? Date.now() };
  const sh = createShell(content, host, { readonly: true });
  const io: IO = {
    stdin: '', isTTY: false, signal: opts.signal ?? new AbortController().signal, sh,
    out: (s) => { if (buf.length < cap) buf += s.slice(0, cap - buf.length); },
    err: (s) => { if (buf.length < cap) buf += s.slice(0, cap - buf.length); },
  };
  let code: number;
  try { code = await sh.exec(line, io); } catch (e) { buf += `\nbash: ${(e as Error).message}\n`; code = 1; }
  const text = stripAnsi(buf);
  return { code, text: text.length >= cap ? text.slice(0, cap) + '\n[output truncated]' : text };
}

export { Shell, type Host, type IO } from './sh.ts';
export { MOTD, SUGGESTED_QUESTIONS } from './portfolio.ts';
