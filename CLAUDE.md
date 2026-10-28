@AGENTS.md

# RPT staff dashboard (frontend)

Next.js 16 / React 19 / TypeScript staff CRM for the Rausch PT outreach system. It holds no patient data and
no provider credentials: every data call goes through a same-origin proxy to the backend in
`../aws_deployed_raush_pt_stride_keap` (`/api/v1/dashboard/*`).

Deployed on Vercel at `rpt-frontend-gamma.vercel.app` (repo `rjm2007/rpt_frontend`, backend `https://demo.aibolt.ai`) (`vercel.json` runs `npm run build:vercel`, the native
Next build). `npm run build` produces a Vinext/Vite bundle for Cloudflare Workers / OpenAI Sites instead.

Moving (branch `feature/own-postgres`, see `../DB-Move-Runbook.md`): `Dockerfile` (native Next build,
`output: 'standalone'`) runs on the demo EC2 as service `dashboard` at `https://demo.aibolt.ai/` (Caddy: `/api/v1/*`, `/health`, `/ready` → backend, `/mock-stride*` → Mock Stride, the rest here), env in
`dashboard.env` there; it calls the backend at `http://api:8000` inside Docker (`app/dashboard-origin.ts`, same as
production). Vercel stays for a week after the move, then is retired.

## Folder map

| Path | Contents | Has CLAUDE.md |
| --- | --- | --- |
| `app/` | All pages, UI, client helpers, unit tests | yes |
| `app/api/` | Server routes: login, logout, dashboard proxy | yes |
| `public/` | `favicon.svg`, `rausch-logo.webp` | |
| `scripts/start-local.ps1` | Windows-only launcher that also starts the backend API (legacy; on macOS run `npm run dev` with the backend already running) | |
| `AUDIT.md` | Frontend audit notes | |
| `.openai/hosting.json`, `vite.config.ts`, `next.config.ts` | Build/hosting config for the two targets | |

## Commands

```bash
npm ci
npm run dev            # vinext dev server, backend must be running
npm run lint
npm run typecheck
npm run test:display && npm run test:cadence && npm run test:auth && npm run test:dashboard && npm run test:leads
npm run build:vercel   # what Vercel builds
```

## Environment (server-only; never prefix with NEXT_PUBLIC_)

| Variable | Purpose |
| --- | --- |
| `DASHBOARD_API_ORIGIN` | Backend base URL (`https://demo.aibolt.ai` on Vercel; must be HTTPS, except `http://api:8000` inside the server's Docker network) |
| `DASHBOARD_API_TOKEN` | Shared server-to-server token; must equal the backend's `DASHBOARD_API_TOKEN` |
| `DASHBOARD_USERS_JSON` | Staff roster: id, display name, password (≥12 chars), role; exactly one `super_admin` |
| `DASHBOARD_SESSION_SECRET` | ≥32 chars; signs the 12-hour `rpt_staff_session` cookie |

## Rules

- Backend and frontend share a contract (identity headers, response shapes in `app/dashboard-data.ts`,
  allowed proxy paths). Change both sides together and deploy them together.
- A new backend dashboard endpoint must be added to `ALLOWED_PATH` in
  `app/api/dashboard/[[...path]]/route.ts`.
- Roles are enforced by the backend; the UI only hides controls. Never rely on the UI for permissions.
