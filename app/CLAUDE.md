# app — pages, UI and client helpers

The dashboard is effectively a single-page app: `page.tsx` (`/`) and the catch-all `[...route]/page.tsx`
both check the session server-side, redirect to `/login` if missing, then render `DashboardShell`, which
picks the page from the URL on the client.

| File | Purpose |
| --- | --- |
| `dashboard-shell.tsx` (~1400 lines) | The whole UI. `DashboardShell` (layout, nav, data loading via `/api/dashboard/snapshot`, actions) and every page component: Home, Leads (list + Kanban board with drag-and-drop stage moves), Appointments, Review queue, Analytics, Administration (cadence studio, SMS templates), and the lead workspace (overview, SMS, calls, cadence runs with reschedule, appointments, activity). |
| `review.ts`, `review-panel.tsx` | Needs Review: group filter and wording (tested in `review.test.ts`); `ReviewCard` (reason, proof, choices) and `ResolveDialog` (confirm pop-up from `GET review/{id}`, optional note). A flagged lead shows Resolve review instead of Resume. Demo also has the Appointment (restart / text booking link) and Booking (front desk only) groups. 2026-10-25: restart-from-Day-0 choices on name / details / text / call / technical / other cards, a Details changed group (location, case, date of birth), and a refused choice (e.g. 10-minute restart cooldown) is shown in the pop-up (`resolveRefusal`). Needs the backend with migration 048 (the old free-text resolve returns 422). |
| `dashboard-data.ts` | TypeScript types for backend responses (`Lead`, `LeadDetail`, `Snapshot`, `CadenceVersion`, `ActivityEntry`, …) and `emptySnapshot`. Keep in sync with `routes/dashboard.py` in the backend. |
| `dashboard-client.ts` | `dashboardFetch()` wrapper for calls to the proxy (handles session expiry). |
| `display.ts` | Formatting: clinic timezone (America/Los_Angeles), enum labels, status tones, activity descriptions, operational error messages. |
| `cadence.ts` | Cadence helpers: split events into runs, step names, run summaries, call naming, step reordering. |
| `assistant.tsx` | Staff assistant UI (dock + full page), up to 3 leads per chat, streaming answers; chats kept in browser `localStorage`. |
| `session.ts` | Server-only auth: parses `DASHBOARD_USERS_JSON`, verifies passwords, signs/reads the session cookie, `getStaffUser()`. |
| `layout.tsx`, `globals.css` | Root layout (theme bootstrap from `localStorage`) and all styles. |
| `login/` | Login page and form (employee ID + password → `POST /api/auth/login`). |
| `[...route]/page.tsx` | Catch-all route that renders the shell for every dashboard URL. |
| `api/` | Server routes (see `api/CLAUDE.md`). |
| `*.test.ts` | Node test runner unit tests (`npm run test:*`). |

## URL → page

`/` home · `/leads` (list/board, `?stage=` filter) · `/leads/{id}` and its tabs (conversations/sms,
conversations/calls, cadence, appointments, activity) · `/appointments` · `/review` · `/analytics` ·
`/administration`, `/administration/cadence`, `/administration/templates` · `/assistant`

## Notes

- The board column comes from the backend's `lead.stage`; the frontend does not compute stages.
- Booked is final (owner, 2026-10-26): Booked cards never start a board move (`canMoveOnBoard` in `display.ts`, tooltip
  `BOOKED_LOCKED_HINT`; columns accept only a board drag); they can still be dragged to the Outreach Assistant dock; the backend refuses the move too (409), and `clientErrorMessage` shows that detail as is.
  The only way out is the visit cancelled in Stride (the lead comes back for review).
- Add new pages inside `DashboardShell`'s path routing, not as new Next.js route folders, unless they need
  server-side logic.
