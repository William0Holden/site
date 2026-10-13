// run_shell: the assistant runs one read-only command in a fresh sandboxed shell over the public
// content. Writes, programs, and the assistant itself are unavailable there (see Shell.readonly).
import { runReadonly } from '../shell/index.ts';
import type { Content } from '../tools/registry.ts';

export const RUN_SHELL_TOOL = {
  type: 'function' as const,
  function: {
    name: 'run_shell',
    description: "Run one read-only command in the visitor's terminal (a simulated Linux shell over this site's files) and show its output to the visitor as if they typed it. Good for: `skills <name>`, `timeline`, `projects <keyword>`, `grep -ril <term> ~william/projects`, `cat ~william/projects/<slug>/README.md`, `tree ~william`, `resume --short`, `open <slug>`, `gallery <slug>`. Pipes and globs work. No writes, no network.",
    parameters: { type: 'object', properties: { command: { type: 'string', description: 'The command line, e.g. "skills pytorch"' } }, required: ['command'] },
  },
};

export async function runShell(content: Content, command: string, signal?: AbortSignal): Promise<string> {
  let code = 0, text = '';
  try { ({ code, text } = await runReadonly(content, command, { cols: 80, signal })); } catch (e) { return `$ ${command}\n[error] ${(e as Error).message}`; }
  return `$ ${command}\n${text.slice(0, 3500)}${code ? `\n[exit ${code}]` : ''}`;
}
