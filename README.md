# Gittensor Miner Dashboard

A real-time monitoring and decision tool for miners on **Bittensor Subnet 74 (SN74)** — the subnet that rewards merged GitHub PRs in whitelisted open-source repositories.

The dashboard polls GitHub for issues and PRs across all 200+ SN74 whitelisted repos (plus any custom repos you add), caches them locally in SQLite, and surfaces the data through Browse, Issues, Pulls, My PRs, and Repositories views. It also integrates Anthropic and OpenAI models for AI-driven issue validation, prompt generation, and SN74 score prediction.

## Stack

- Next.js 14 (App Router) + TypeScript + Primer React
- SQLite (`better-sqlite3`) for caching issues / PRs / linked-issue map
- TanStack Query for client-side polling
- Octokit for GitHub REST
- Anthropic + OpenAI SDKs for AI validation
- GitHub OAuth + admin-approval gating

## Features

- **Browse** — three-pane explorer: repo list, issues/PR table, content viewer
- **Repositories** — full SN74 catalog with weights, bands, and per-repo stats
- **Issues / Pulls** — global aggregated feeds with state, author, and tracked-only filters
- **My PRs** — your authored PRs enriched with SN74 whitelist status and weights
- **Manage Repositories** — track custom repos alongside the SN74 whitelist
- **AI Validation** — deterministic SN74 rule checks + Claude / GPT verdict and prompt generation
- **Predict Score** — predicted SN74 reward formula with per-issue worst/best range
- **Notifications** — toasts and sticky badges for new issues across tracked repos

See `/docs` in the running app for the full feature reference.

## Setup

```bash
npm install
cp .env.local.example .env.local   # then fill in the values below
npm run dev                        # starts on http://localhost:12074
```

### Required environment variables (`.env.local`)

| Var | Purpose |
| --- | --- |
| `GITHUB_USERNAME` | Your GitHub login (used as the default miner identity) |
| `GITHUB_PATS` | Comma-separated GitHub PATs — rotated automatically to spread rate limits |
| `ANTHROPIC_API_KEY` | For Claude-based AI validation |
| `OPENAI_API_KEY` | For GPT-based AI validation (optional) |
| `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth app client ID (for sign-in) |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth app client secret |
| `ADMIN_GITHUB_LOGINS` | Comma-separated GitHub logins granted admin |
| `SESSION_SECRET` | Cookie-signing secret — auto-generated and persisted on first run if missing |
| `PORT` | HTTP port (default `12074`) |

## Production

`ecosystem.config.js` is a pm2 config:

```bash
npm run build
pm2 start ecosystem.config.js
pm2 save
```

## License

MIT
