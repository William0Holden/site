# wholden.com

Personal site for William O. Holden. Full spec and current status: `docs/HANDOFF.md`. Read its
"Status and decisions" section before doing anything.

## Hard rules
- Never invent facts about William. Only state what's in `content/` or the handoff's seed and
  approved additions. Unknowns become `TODO(william):` placeholders.
- Aderant work is confidential: say only what `content/projects/aderant.md` says.
- No phone number, home address, homelab hostnames/domains/IPs anywhere. No secrets in the repo.
- Never write "built with Claude Code / Cursor" on the site.
- Privacy tiers are enforced in Worker code, not prompts. `content/personal/` never reaches the
  static build, `dist/api/content.json`, or the system prompt.
- Never render model-generated HTML; tools return typed props for a fixed component registry.
- Respect `prefers-reduced-motion`; no horizontal scroll at 375px; non-AI pages work without JS.

## Commands
- `npm run dev`: Astro dev server (no Worker).
- `npm run build`: static build to `dist/` plus `dist/api/content.json`.
- `npm run preview`: `wrangler dev` with the Worker + assets (test curl: `curl localhost:8787`).
- `npm run check`: Astro/TS check. Worker typecheck: `npx tsc -p worker`.

## Layout
`content/` (markdown + media.json) → `src/` (Astro pages) and `scripts/export-content.mjs`
(JSON for Worker/SSH/MCP). `worker/` routes curl, `/api/*`, `/mcp`, then static assets.
Deploys: Cloudflare Workers Builds from `main`. Fetch and rebase before pushing.
