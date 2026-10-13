# wholden.com

William O. Holden's personal site: a static Astro site served by a Cloudflare Worker, with
terminal access (`curl wholden.com`), and later an AI chat, SSH app, and MCP server.
See `docs/HANDOFF.md` for the full plan.

## Develop

```sh
npm install
npm run dev       # site only
npm run build && npm run preview   # site + Worker (curl localhost:8787)
```

Edit content in `content/` (projects are markdown with front matter; see `src/content.config.ts`).

## Deploy

Cloudflare Workers Builds deploys `main` automatically (production branch `main`, deploy command
`npx wrangler deploy`; `wrangler.jsonc` runs `npm run build` first). Other branches get preview URLs.

## Environment variables and secrets

Runtime secrets live in Cloudflare → Worker → Settings → Variables and Secrets (not Build
variables). `keep_vars: true` keeps dashboard values across deploys. Locally they live in
`~/.config/wholden/secrets.env` (written by `scripts/store-secret.sh NAME`) and `.dev.vars`.

| Name | Kind | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | secret | LLM calls (set a credit limit on the key in OpenRouter) |
| `SESSION_SIGNING_SECRET` | secret | HMAC for the chat session cookie and visitor ids (`openssl rand -hex 32`) |
| `UNLOCK_SIGNING_SECRET` | secret | HMAC for `/unlock?code=` friend links; `scripts/unlock-link.sh` prints the link |
| `TURNSTILE_SECRET_KEY` | secret | Verify Turnstile tokens (chat skips Turnstile while unset) |
| `TURNSTILE_SITE_KEY` | var | Public Turnstile site key, served by `/api/chat/status` |
| `LLM_MODEL` / `LLM_FALLBACK_MODEL` | var | OpenRouter model ids (default `anthropic/claude-haiku-5.5`, fallback `qwen/qwen3.7-flash`) |
| `DAILY_LLM_BUDGET_USD` | var | Global daily spend cap (default 2; `0` disables chat) |

Chat limits (per visitor/conversation) are constants in `worker/config.ts`. Check a model with
`set -a; . ~/.config/wholden/secrets.env; set +a; node scripts/eval-tools.ts [model]`.

