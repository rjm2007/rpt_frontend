# app/api — server routes

These run on the server (Vercel). They are the only code that sees secrets.

| Route | Purpose |
| --- | --- |
| `auth/login/route.ts` | `POST` employee ID + password → verifies against `DASHBOARD_USERS_JSON`, sets the HttpOnly signed `rpt_staff_session` cookie (12 h). |
| `auth/logout/route.ts` | Clears the session cookie. |
| `try/route.ts` | Public demo form (`/try`, 2026-11-07): no session; forwards only the form's fields to the backend `POST /api/v1/demo-form/leads` with `X-Dashboard-Token`; 2 KB limit, 20 s timeout; returns only `first_name` or a bare status (the page picks the words). |
| `dashboard/[[...path]]/route.ts` | Proxy to the backend `/api/v1/dashboard/*`. Requires a valid session, checks the path against `ALLOWED_PATH` and the method, then adds `X-Dashboard-Token`, `X-Dashboard-User-ID`, `X-Dashboard-User-Name` (URL-encoded), `X-Dashboard-User-Role` and `X-Trace-ID`. Size limits: 20 KB (64 KB for the assistant); timeouts 20 s (90 s for the assistant). Streams the response back. `lead-list`, `lead-board` and `stride-patients/{id}` are GET only. |

## Rules

- When the backend adds or renames a dashboard endpoint, update `ALLOWED_PATH` (and the per-path method
  checks) here or the browser gets "dashboard path not allowed".
- Never log request bodies, upstream URLs or patient data; errors are returned as generic messages.
- The identity headers must match `require_dashboard_auth` in the backend's `security.py`.
