// Builds the code index the assistant's code tools read: source and docs from William's public
// repos, written to content/code/<repo>.json. Run by hand (`npm run index-code`) and commit the
// output, so builds never depend on GitHub and every indexed line has been reviewed in a diff.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, lstatSync, realpathSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, relative } from 'node:path';

export const REPOS = [
  { repo: 'William0Holden/chicken_action_recognition', project: 'broiler-behavior', team: false },
  { repo: 'William0Holden/cinema-ebooking', project: 'cinema-ebooking', team: false },
  { repo: 'William0Holden/llm-translation-eval', project: 'mt-evaluation', team: false },
  { repo: 'William0Holden/quant-research-harness', project: 'qts', team: false },
  { repo: 'William0Holden/bitebutler', project: 'bitebutler', team: false },
  { repo: 'William0Holden/homelab', project: 'homelab', team: false },
  { repo: 'DeckTection/DeckTection', project: 'decktection', team: true },
  { repo: 'alexander-darwiche/CS8000-MLSys', project: 'whisper-optimization', team: true },
];

const EXT = new Set(['.py', '.ts', '.tsx', '.js', '.jsx', '.java', '.c', '.cc', '.cpp', '.h', '.hpp', '.sql', '.md', '.sh', '.yml', '.yaml', '.toml', '.ipynb', '.html', '.css', '.r', '.R']);
const SKIP_DIR = /(^|\/)(\.git|node_modules|venv|\.venv|env|__pycache__|dist|build|\.next|data|datasets?|weights|checkpoints|runs|outputs?|logs|migrations|static|vendor|third_party|whisper-main|site-packages)(\/|$)/i;
const SKIP_FILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.env.*|.*secret.*|.*credential.*|.*\.min\.(js|css))$/i;
const MAX_FILE = 60 * 1024;
const MAX_REPO = 1.5 * 1024 * 1024;

// A file is dropped whole if it looks like it holds a secret or homelab network details.
const PRIVATE = [
  /\b(?:10|127|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}(?:\.\d{1,3})?\b/,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
  /webbywonkywoo/i,
  /\b[\w.-]+\.(?:lan|local|internal|home\.arpa)\b/i,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
  /\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/,
];

// Notebooks: keep code and markdown cells only (outputs can be huge or contain data).
function notebookText(raw) {
  try {
    const nb = JSON.parse(raw);
    return (nb.cells ?? []).map((c) => {
      const src = Array.isArray(c.source) ? c.source.join('') : String(c.source ?? '');
      return c.cell_type === 'markdown' ? src.split('\n').map((l) => `# ${l}`).join('\n') : src;
    }).join('\n\n# ----\n\n');
  } catch { return null; }
}

function walk(dir, root, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name), rel = relative(root, p);
    // Never follow symlinks: a link in someone's repo could point at files on this machine.
    const st = lstatSync(p);
    if (st.isSymbolicLink() || !realpathSync(p).startsWith(root + '/')) continue;
    if (st.isDirectory()) { if (!SKIP_DIR.test(rel + '/')) walk(p, root, out); continue; }
    if (!EXT.has(extname(name)) || SKIP_FILE.test(rel) || SKIP_DIR.test(rel)) continue;
    if (st.size > (extname(name) === '.ipynb' ? 4 * MAX_FILE : MAX_FILE)) continue;
    out.push(rel);
  }
}

const outDir = new URL('../content/code/', import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const report = [];
for (const r of REPOS) {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'idx-')));
  try {
    execFileSync('git', ['clone', '--quiet', '--depth', '1', '--filter=blob:limit=300k', `https://github.com/${r.repo}.git`, tmp], { stdio: 'ignore' });
    const sha = execFileSync('git', ['-C', tmp, 'rev-parse', 'HEAD']).toString().trim();
    const branch = execFileSync('git', ['-C', tmp, 'rev-parse', '--abbrev-ref', 'HEAD']).toString().trim();
    const paths = [];
    walk(tmp, tmp, paths);
    paths.sort((a, b) => (a.toLowerCase().includes('readme') ? -1 : 0) - (b.toLowerCase().includes('readme') ? -1 : 0) || a.localeCompare(b));
    const files = [], dropped = [];
    let total = 0;
    for (const path of paths) {
      let text = readFileSync(join(tmp, path), 'utf8');
      if (path.endsWith('.ipynb')) { text = notebookText(text); if (text === null) continue; }
      if (text.includes('\u0000')) continue;
      const hit = PRIVATE.find((re) => re.test(text));
      if (hit) { dropped.push(`${path} (${hit.source.slice(0, 24)})`); continue; }
      if (total + text.length > MAX_REPO) { dropped.push(`${path} (repo size cap)`); continue; }
      total += text.length;
      files.push({ path, text: text.replace(/\r/g, '') });
    }
    const name = r.repo.split('/')[1];
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify({ ...r, name, branch, sha, files }) + '\n');
    report.push(`${r.repo}: ${files.length} files, ${(total / 1024).toFixed(0)} KB; dropped ${dropped.length}${dropped.length ? ': ' + dropped.slice(0, 12).join(', ') : ''}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
console.log(report.join('\n'));
