# Gittensor Hub

A real-time monitoring and decision tool for miners on **Bittensor Subnet 74 (SN74)** — the subnet that rewards merged GitHub PRs in whitelisted open-source repositories.

The dashboard polls GitHub for issues and PRs across all 200+ SN74 whitelisted repos (plus any custom repos you add), caches them locally in SQLite, and surfaces the data through Browse, Issues, Pulls, My PRs, and Repositories views.

## Stack

- Next.js 14 (App Router) + TypeScript + Primer React
- SQLite (`better-sqlite3`) for caching issues / PRs / linked-issue map
- TanStack Query for client-side polling
- Octokit for GitHub REST
- GitHub OAuth + admin-approval gating

## Features

- **Browse** — three-pane explorer: repo list, issues/PR table, content viewer
- **Repositories** — full SN74 catalog with weights, bands, and per-repo stats
- **Issues / Pulls** — global aggregated feeds with state, author, and tracked-only filters
- **My PRs** — your authored PRs enriched with SN74 whitelist status and weights
- **Manage Repositories** — track custom repos alongside the SN74 whitelist
- **Predict Score** — predicted SN74 reward formula per issue
- **Notifications** — toasts and sticky badges for new issues across tracked repos

See `/docs` in the running app for the full feature reference.

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/) (`npm i -g pnpm`)
- A GitHub account (you'll register an OAuth App and a Personal Access Token below)

## Quick start

```bash
git clone https://github.com/MkDev11/gittensor-hub.git
cd gittensor-hub
pnpm install
cp .env.local.example .env.local   # then fill in the values below
pnpm dev                           # starts on http://localhost:12074
```

## GitHub setup

The dashboard needs two GitHub credentials before sign-in works.

### 1. OAuth App (for sign-in)

1. Go to <https://github.com/settings/developers> → **New OAuth App**.
2. Fill in:
   - **Application name** — anything (e.g. `Gittensor Hub`)
   - **Homepage URL** — `http://localhost:12074` for dev, or your public URL in prod
   - **Authorization callback URL** — `<homepage>/api/auth/github/callback`
3. Generate a client secret.
4. Copy the **Client ID** and **Client Secret** into `.env.local` as `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`.

### 2. Personal Access Tokens (for polling GitHub data)

1. Go to <https://github.com/settings/tokens> → **Generate new token (classic)** or **Fine-grained**.
2. Scopes: `public_repo` and `read:user` are sufficient for read-only polling of public repos.
3. (Optional) Create 2–4 tokens — the poller rotates between them to spread the GitHub rate limit.
4. Paste them comma-separated into `.env.local` as `GITHUB_PATS`.

## Environment variables (`.env.local`)

| Var | Purpose |
| --- | --- |
| `GITHUB_USERNAME` | Your GitHub login (used as the default miner identity) |
| `GITHUB_PATS` | Comma-separated GitHub PATs — rotated automatically to spread rate limits |
| `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth app client ID (for sign-in) |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth app client secret |
| `ADMIN_GITHUB_LOGINS` | Comma-separated GitHub logins granted admin |
| `SESSION_SECRET` | Cookie-signing secret — auto-generated and persisted on first run if missing |
| `PORT` | HTTP port (default `12074`) |

## Production

`ecosystem.config.js` is a [pm2](https://pm2.keymetrics.io/) config:

```bash
pnpm build
pm2 start ecosystem.config.js
pm2 save                          # persist for `pm2 resurrect` on reboot
pm2 logs gittensor-miner-dashboard
```

The app serves over plain HTTP by default. If you put nginx/Caddy with TLS in front, the auth cookies automatically switch to `Secure` (the server reads `x-forwarded-proto`).

## License

MIT
