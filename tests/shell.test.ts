import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createShell, runReadonly, isCommandLine, looksLikeQuestion, looksLikeSentence } from '../shell/index.ts';
import { stripAnsi } from '../shell/ansi.ts';
import type { Host, IO } from '../shell/sh.ts';
import type { Content } from '../tools/registry.ts';

const content: Content = JSON.parse(readFileSync(new URL('../dist/api/content.json', import.meta.url), 'utf8'));

function harness() {
  const ui: unknown[] = [];
  const host: Host = { cols: () => 80, now: () => 1_760_000_000_000, ui: (u) => ui.push(u) };
  const sh = createShell(content, host);
  const run = async (line: string, tty = false) => {
    let out = '', err = '';
    const io: IO = { stdin: null, isTTY: tty, signal: new AbortController().signal, sh, out: (s) => (out += s), err: (s) => (err += s) };
    const code = await sh.exec(line, io);
    return { code, out: stripAnsi(out), err: stripAnsi(err) };
  };
  return { sh, run, ui };
}

test('starts in /home/william with content as files', async () => {
  const { run } = harness();
  assert.equal((await run('pwd')).out, '/home/william\n');
  const ls = (await run('ls')).out.split('\n');
  for (const f of ['README.md', 'resume.md', 'projects', 'skills.txt']) assert.ok(ls.includes(f), f);
  assert.match((await run('cat projects/qts/README.md')).out, /Quant Research Harness/);
});

test('pipes, redirects, variables, globs, && and ||', async () => {
  const { run } = harness();
  assert.equal((await run('echo hello | tr a-z A-Z')).out, 'HELLO\n');
  assert.equal((await run('X=world; echo "hi $X" \'$X\'')).out, 'hi world $X\n');
  assert.equal((await run('false && echo no || echo yes')).out, 'yes\n');
  assert.equal((await run('echo $(echo nested)')).out, 'nested\n');
  await run('cd ~ && echo one > a.txt && echo two >> a.txt');
  assert.equal((await run('cat a.txt | wc -l')).out.trim(), '2');
  assert.match((await run('ls ~william/projects/*/README.md')).out, /qts\/README\.md/);
  assert.equal((await run('cat nope 2>/dev/null; echo $?')).out, '1\n');
  assert.match((await run('grep -ril pytorch ~william/projects')).out, /broiler-behavior/);
});

test("William's files are read-only; guest home is writable", async () => {
  const { run, sh } = harness();
  assert.match((await run('touch /home/william/x')).err, /Permission denied/);
  assert.match((await run('rm -rf ' + '/')).err, /dangerous/);
  assert.match((await run('rm ~william/resume.md')).err, /Permission denied/);
  await run('mkdir -p ~/notes && echo hi > ~/notes/n.txt');
  assert.equal(sh.fs.readFile('/home/guest/notes/n.txt'), 'hi\n');
  const saved = sh.fs.exportGuest();
  const { sh: sh2 } = harness();
  sh2.fs.importGuest(saved);
  assert.equal(sh2.fs.readFile('/home/guest/notes/n.txt'), 'hi\n');
});

test('syntax errors and unknown commands behave like bash', async () => {
  const { run } = harness();
  assert.match((await run('echo "unterminated')).err, /unexpected EOF/);
  assert.equal((await run('frobnicate')).code, 127);
  assert.match((await run('ls | ')).err, /syntax error/);
});

test('aliases and scripts', async () => {
  const { run } = harness();
  await run("alias hi='echo hey'");
  assert.equal((await run('hi there')).out, 'hey there\n');
  await run('cd ~ && printf "echo arg=\\$1\\n" > s.sh && chmod +x s.sh');
  assert.equal((await run('./s.sh foo')).out, 'arg=foo\n');
});

test('portfolio commands render', async () => {
  const { run, ui } = harness();
  const r = await run('resume');
  assert.match(r.out, /EXPERIENCE/);
  assert.match(r.out, /Aderant/);
  assert.match((await run('skills pytorch')).out, /broiler-behavior/);
  assert.match((await run('timeline')).out, /2025/);
  await run('open broiler-behavior', true);
  assert.ok(ui.some((u) => (u as { component?: string }).component === 'ProjectCard'));
  assert.match((await run('curl wholden.com/projects')).out, /decktection/);
  assert.match((await run('curl example.com')).err, /Could not resolve host/);
});

test('aderant stays vague in the shell', async () => {
  const { run } = harness();
  const all = (await run('cat ~william/projects/aderant/README.md')).out;
  assert.doesNotMatch(all, /client|architecture/i);
});

test('read-only shell for the AI rejects writes and interactive programs', async () => {
  const w = await runReadonly(content, 'echo hi > /home/guest/x');
  assert.match(w.text, /Read-only file system/);
  assert.match((await runReadonly(content, 'nano x')).text, /not available/);
  assert.match((await runReadonly(content, 'ask hi')).text, /not available/);
  assert.match((await runReadonly(content, 'grep -i yolo ~william/skills.txt')).text, /YOLO/);
});

test('question detection', () => {
  const { sh } = harness();
  assert.equal(isCommandLine(sh, 'ls -la'), true);
  assert.equal(isCommandLine(sh, "what's his stack?"), false);
  assert.equal(looksLikeQuestion("what's his stack?"), true);
  assert.equal(looksLikeQuestion('hello'), true);
  assert.equal(looksLikeQuestion('lss'), false);
  for (const q of ['which projects show his pytorch experience?', 'find me his best project', 'open to remote work?', 'who is william?', 'man what does he do'])
    assert.equal(looksLikeSentence(q), true, q);
  for (const c of ['which ls', 'find . -name README.md', 'grep -ri pytorch ~william', 'open broiler-behavior', 'cat README.md | head', 'skills pytorch', 'echo hello world', 'man ls'])
    assert.equal(looksLikeSentence(c), false, c);
});

test('hostile commands terminate quickly with bounded output (run_shell DoS)', async () => {
  const t0 = Date.now();
  const p = await runReadonly(content, "printf '%%s' a");
  assert.equal(p.text, '%s');
  const big = await runReadonly(content, 'yes $(yes $(yes) | head -c 100000) | wc -c');
  assert.ok(Number(big.text.trim()) <= 300 * 1024, big.text);
  assert.match((await runReadonly(content, 'echo "$(seq 10000; seq 10000)" | wc -c')).text, /Argument list too long/);
  const nested = await runReadonly(content, 'yes $(yes $(yes))');
  assert.ok(nested.text.length <= 6100);
  const redos = await runReadonly(content, "echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa! | grep -E '(a+)+$'");
  assert.match(redos.text, /not allowed/);
  assert.match((await runReadonly(content, "ls '[z-a]'*; find . -name '[z-a]'")).text, /cannot access|^$/m);
  for (const cmd of ["yes $(seq 20000 | head -c 60000) | sed 's/./<180 &>/g' | wc -c", 'yes $(yes $(yes) | head -c 60000) | nl | wc -c', 'cat $(yes resume.md | head -5000) | wc -c']) {
    const n = Number((await runReadonly(content, cmd)).text.trim());
    assert.ok(n <= 300 * 1024, `${cmd} -> ${n}`);
  }
  for (const re of ['(a|aa)+$', 'a*a*a*a*a*b', 'x+'])
    assert.match((await runReadonly(content, `echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa! | grep -E '${re}'`)).text, /not allowed/);
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0}ms`);
});

test('the read-only shell makes no network calls and cannot emit escape codes', async () => {
  assert.match((await runReadonly(content, 'git log')).text, /not available/);
  assert.doesNotMatch((await runReadonly(content, "echo -e '\\e]8;;cmd:rm x\\e\\\\hi'")).text, /\x1b/);
});

test('guest files named like prototype keys are refused', async () => {
  const { run, sh } = harness();
  assert.match((await run('touch ~/__proto__')).err, /Permission denied/);
  sh.fs.importGuest(JSON.stringify({ d: { __proto__x: { f: 'ok' } } }));
  sh.fs.importGuest('{"d":{"__proto__":{"f":"bad"},"a.txt":{"f":"ok"}}}');
  assert.equal(sh.fs.readFile('/home/guest/a.txt'), 'ok');
  assert.equal(Object.getPrototypeOf((sh.fs.stat('/home/guest') as { children: object }).children), Object.prototype);
});
