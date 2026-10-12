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
variables). `keep_vars: true` keeps dashboard values across deploys. None are needed for Phase 1.

| Name | Kind | Phase | Purpose |
|---|---|---|---|
| `PUBLIC_TURNSTILE_SITE_KEY` | build var | 2 | Turnstile widget on the chat |
| `TURNSTILE_SECRET_KEY` | secret | 2 | Verify Turnstile tokens |
| `OPENROUTER_API_KEY` | secret | 2 | LLM calls (set a credit limit on the key in OpenRouter) |
| `LLM_MODEL` | var | 2 | OpenRouter model id, swappable without code changes |
| `DAILY_LLM_BUDGET_USD` | var | 2 | Global daily spend cap (default 2) |
| `UNLOCK_SIGNING_SECRET` | secret | 2 | HMAC for `/unlock?code=` friend links (`openssl rand -hex 32`) |
| `SSH_CHAT_TOKEN` | secret | 3 | Server-to-server token the SSH app uses for `/api/chat` |
