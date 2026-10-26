# Appointment Calendar — Build Guide

A blueprint for recreating this dashboard's appointment calendar in another dashboard. It is written from the working implementation, so every formula, constant and pitfall below comes from code that ships here.

**Source files (this repo)**

| File | Role |
| --- | --- |
| `app/appointments-page.tsx` | The whole UI: toolbar (Filters, Legend), 5 views, visit card, editor modal |
| `app/appointment-data.ts` | Pure helpers: date math, record normalisation, conflict check |
| `app/display.ts` | Timezone helpers (`CLINIC_TZ`, `clinicDateTimeValue`, `clinicWallTimeToIso`) |
| `app/demo-data.ts` | Mock API: validation + conflict rules for `POST/PATCH appointments` |
| `app/globals.css` (from `/* Appointment calendar workspace */`) | All styling, dark mode, responsive rules |

**Stack:** Next.js (App Router), React 19, TypeScript, plain CSS. **No calendar library.** There is no FullCalendar or react-big-calendar; the grid is built from CSS grid and absolutely positioned blocks. Nothing here needs porting to another stack except the JSX.

---

## 1. What it does

- **Page modes:** `Calendar` | `List` (tabs).
- **Calendar views:** `Day`, `Week`, `Month`, `Locations`, `Capacity`.
- **Day / Locations:** one column per practitioner, time on the Y axis, bookings drawn as positioned blocks sized by duration.
- **Week:** 7 day columns (Mon–Sun), compact booking chips inside hour cells.
- **Month:** 6×7 grid, up to 3 chips per day plus a "+N more" link. Clicking a day or chip drills into Day view.
- **Capacity:** one progress bar per practitioner (booked hours / 8).
- **Filters:** case title and practitioner, plus a "Reset filters" link.
- **Navigation:** Today, previous and next. The step is 1 day, 7 days or 1 month depending on the view.
- **Occupancy bar:** `N appointments · X / Y slots booked · meter · Z% booked`.
- **Visit card (2026-10-26, view only):** clicking a visit (Day, Week, Month, List) opens a small card beside it (a bottom sheet under 700px): status line (orange "Waiting for approval in Stride", or Stride's status), patient "Last, First" with date of birth, phone and email from the linked lead, visit type, day and time, clinic and clinician with role, booked by (Elliot with a link to the call / Google Sheet / Stride front desk), "Open lead" when linked, and "To approve or cancel, use Stride." for waiting visits. No other actions. Closes with ×, Escape or a click outside; nothing opens on load.
- **Legend:** a top-bar pop-up with block colours, white/grey open time, the status marks and WAITING.
- **Click an empty slot:** opens the create modal pre-filled with that day, hour and practitioner.
- **Editor modal:** create or edit with lead, practitioner, case, datetime-local and duration (30 or 60 min). Server errors such as a conflict are shown inline.
- **Dark mode** and **responsive** layout.

---

## 2. Data model

```ts
export type DemoAppointment = {
  id: string; lead_id: string; full_name: string;
  start_utc: string;            // ISO instant, always UTC
  location: string;
  practitioner_id: string;
  duration_minutes: number;     // 30 | 60
  case_title: string;           // drives the colour "tone"
  state: string; type: string;
};

export const demoPractitioners = [
  { id: 'avery-collins', name: 'Avery Collins, PT', location: 'West Coast', color: 'blue' },
  { id: 'jordan-ellis',  name: 'Jordan Ellis, PT',  location: 'Central',    color: 'violet' },
  { id: 'morgan-reed',   name: 'Morgan Reed, PT',   location: 'East Coast', color: 'teal' },
] as const;
export const caseTitles = ['Knee', 'Shoulder', 'Hip', 'Lower back'] as const;
export const scheduleHours = Array.from({ length: 8 }, (_, i) => i + 9); // 9..16 = working day
```

**Adapting it:** rename "practitioner" to whatever the resource is in your product (room, agent, technician, court). Rename "case title" to your category field. Both are the two filter dimensions and the two things that drive columns and colours.

**Key design decision:** store **one UTC instant + a duration**. Never store a wall-clock string. Everything the user sees is derived through the clinic timezone (§3).

---

## 3. Timezone handling (do this first, it's where calendars break)

The calendar always renders in **one fixed timezone** (`CLINIC_TZ = 'America/Los_Angeles'`), not the browser's. Every view is labelled "Times shown in PT".

Two conversion functions are the entire timezone layer (`app/display.ts`):

```ts
// UTC instant -> "YYYY-MM-DDTHH:mm" wall time in the clinic TZ
export function clinicDateTimeValue(value: unknown): string
// "YYYY-MM-DDTHH:mm" wall time in the clinic TZ -> UTC ISO string (throws on DST gaps/ambiguity)
export function clinicWallTimeToIso(value: string, now = new Date()): string
```

- Built on one `Intl.DateTimeFormat({ timeZone, hourCycle: 'h23', ... }).formatToParts`.
- `clinicWallTimeToIso` iterates 3 passes to find the offset, then verifies the result maps back to the same wall time. It rejects nonexistent times (spring-forward gap) and ambiguous times (fall-back hour) with a readable error. It also rejects past times when `now` is real (`new Date(0)` is passed to disable that check when seeding or editing).
- Copy `display.ts`'s `zonedParts`, `sameWallTime`, `parseWallTime`, `clinicDateTimeValue` and `clinicWallTimeToIso` as-is and change `CLINIC_TZ`.

Date-only helpers in `appointment-data.ts` use **noon UTC** (`T12:00:00Z`) so day arithmetic never crosses a date boundary through DST or offset:

```ts
export function calendarDay(value: unknown = new Date().toISOString()) {
  return clinicDateTimeValue(value).slice(0, 10);          // 'YYYY-MM-DD' in clinic TZ
}
export function shiftCalendarDay(day: string, days: number) {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function appointmentMinutes(a: DemoAppointment) {   // minutes since local midnight
  const wall = clinicDateTimeValue(a.start_utc);
  return Number(wall.slice(11, 13)) * 60 + Number(wall.slice(14, 16));
}
export function appointmentConflicts(list: DemoAppointment[], c: DemoAppointment) {
  const start = Date.parse(c.start_utc), end = start + c.duration_minutes * 60_000;
  return list.some((i) => i.id !== c.id && i.practitioner_id === c.practitioner_id
    && Date.parse(i.start_utc) < end && Date.parse(i.start_utc) + i.duration_minutes * 60_000 > start);
}
export function appointmentFromRecord(record: Record<string, unknown>, index = 0): DemoAppointment
// normalises a raw API row: resolves practitioner (by id, else by location, else first),
// defaults duration to 60, case_title to caseTitles[index % n], state 'scheduled'
```

The page-level display helpers:

```ts
const dateLabel = (day, options = { weekday:'long', day:'numeric', month:'long', year:'numeric' }) =>
  new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', timeZone: CLINIC_TZ });
const timeRange = (a) => clock(a.start_utc) + ' – ' + clock(new Date(Date.parse(a.start_utc) + a.duration_minutes*60_000).toISOString());
```

Day strings (`'YYYY-MM-DD'`) are the calendar's navigation state. Pass `timeZone: 'UTC'` when formatting them because they were built at noon UTC.

---

## 4. Component structure (`AppointmentsPage`)

Props: `{ snapshot, loading, action }`. `snapshot.appointments` holds raw rows and `action(path, method, body, toastMessage)` is the mutation function that returns the saved record or `null` on failure.

### State

```ts
const [chosenDay, setChosenDay] = useState('');
const day = chosenDay || calendarDay(appointments[0]?.start_utc ?? new Date().toISOString()); // defaults to first booking's day
const [mode, setMode]       = useState<'Calendar'|'List'>('Calendar');
const [view, setView]       = useState<'Day'|'Week'|'Month'|'Locations'|'Capacity'>('Day');
const [caseTitle, setCaseTitle]       = useState('all');
const [practitioner, setPractitioner] = useState('all');
const [selectedId, setSelectedId]     = useState('');
const [detailsOpen, setDetailsOpen]   = useState(true);
const [draft, setDraft]               = useState<Draft | null>(null);   // non-null => editor modal open
```

`day` is derived rather than initialised, so the calendar opens on the first booking's day instead of an empty "today".

### Derived data (the core pipeline, in order)

```ts
const regionPractitioners = demoPractitioners.filter(p => !snapshot.leads.length || snapshot.leads.some(l => l.location === p.location)); // scope to user's region
const practitioners = regionPractitioners.filter(p => practitioner === 'all' || p.id === practitioner);
const matching = appointments.filter(a => (caseTitle==='all' || a.case_title===caseTitle) && practitioners.some(p => p.id===a.practitioner_id));

// Monday-start week
const weekday    = new Date(day + 'T12:00:00Z').getUTCDay();
const weekStart  = shiftCalendarDay(day, -((weekday + 6) % 7));
// Month grid, padded back to a Monday
const monthStart     = day.slice(0,7) + '-01';
const monthWeekday   = new Date(monthStart + 'T12:00:00Z').getUTCDay();
const monthGridStart = shiftCalendarDay(monthStart, -((monthWeekday + 6) % 7));

const periodDays = view==='Week'  ? 7 days from weekStart
                 : view==='Month' ? 42 days from monthGridStart, filtered to the current month
                 : [day];
const visible = matching.filter(a => periodDays.includes(calendarDay(a.start_utc)));

// Visible hour range grows if a booking is outside 9-17
const hourStart = Math.min(9,  ...visible.map(a => Math.floor(appointmentMinutes(a)/60)));
const hourEnd   = Math.max(17, ...visible.map(a => Math.ceil((appointmentMinutes(a)+a.duration_minutes)/60)));
const displayedHours = Array.from({ length: hourEnd - hourStart }, (_, i) => hourStart + i);

const selected = visible.find(a => a.id === selectedId) ?? visible[0];   // auto-select first

// Occupancy
const capacity      = practitioners.length * 8 * periodDays.length;     // 8 working hours / resource / day
const occupied      = visible.reduce((t, a) => t + a.duration_minutes/60, 0);
const bookedPercent = capacity ? Math.round(occupied / capacity * 100) : 0;
```

### Navigation

```ts
function changeDate(dir: number) {
  if (view === 'Month') { const d = new Date(monthStart+'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth()+dir); setChosenDay(d.toISOString().slice(0,10)); }
  else setChosenDay(shiftCalendarDay(day, dir * (view==='Week' ? 7 : 1)));
}
```

"Today" is `setChosenDay(calendarDay())`.

### Columns (Day / Week / Locations share one grid renderer)

```ts
const columns = view==='Week'
  ? periodDays.map(d => ({ key:d, day:d, title: dateLabel(d,{weekday:'short',day:'numeric'}), subtitle:'All selected practitioners',
        practitionerId: undefined, records: visible.filter(a => calendarDay(a.start_utc)===d) }))
  : practitioners.map(p => ({ key:p.id, day, title: view==='Locations' ? p.location : p.name,
        subtitle: view==='Locations' ? p.name : p.location+' · Demo practice', practitionerId: p.id,
        records: visible.filter(a => a.practitioner_id===p.id) }));
```

The `Locations` view reuses the Day grid and only swaps the heading text. The grid gets its width from a CSS variable: `style={{ '--columns': columns.length || 1 }}`.

### The time grid (Day / Locations / Week)

Layout is `[66px hour-label gutter] [columns…]`. Each column is `position: relative` and contains:

1. **One `.schedule-hour-cell` (56px high) per displayed hour.** It holds:
   - an **open-slot "+" button**, when no booking overlaps that hour, which calls `newAppointment(column.day, hour, column.practitionerId)`.
   - a muted **"Booked · filtered"** label when a booking is hidden by the current filters. This stops users double-booking behind a filter.
   - in **Week** only, the compact `AppointmentBlock`s that start in that hour.
2. **Absolutely positioned booking blocks** (Day / Locations only) laid over the cells:
   ```ts
   top:    (appointmentMinutes(a) - hourStart*60) / 60 * 56 + 3
   height: a.duration_minutes / 60 * 56 - 6
   ```
   `56` is the hour-cell height in px and must match the CSS. A 30-minute slot passes `compact`, which hides the case-title line.

Overlap test used for hours: `start < (hour+1)*60 && start + duration > hour*60`.

### Month view

- Weekday header Mon–Sun, then 42 cells from `monthGridStart`. Days outside the current month get `.outside` (40% opacity).
- Each cell shows the day number (click → `setChosenDay(day); setView('Day')`), up to 3 booking chips (click → drill to that day and select it) and `+N more` beyond 3.
- It uses `matching` (all of the month's data), not `visible`, so adjacent-month bookings appear in the padded cells.

### Capacity view

For each practitioner, sum hours of visible records and render `<meter min=0 max=8 value=hours>`, `"{h} / 8 hours booked"` and a percentage.

### List mode

A `<table>` of `visible`: Date & time, Lead (button selects the row), Case title, Practitioner, Location, Status. Shows an empty state when there are no rows.

### Booking block colour ("tone")

```ts
const tone = (a) => a.case_title==='Knee' ? 'blue' : a.case_title==='Hip' ? 'teal' : 'violet';
```

Each block is a `<button>` with `aria-pressed`, `aria-label` ("Name, Case, 9:00 AM – 10:00 AM PT") and `title`. Tone is set through CSS variables (§6).

### Selecting an item

`choose(item, anchor)` opens the visit card next to the clicked element (`VisitCard`, positioned beside it and kept on screen; CSS turns it into a bottom sheet on phones). Open slots follow the location filter (Locations view: each column's own clinic).

### Creating / editing

```ts
function newAppointment(slotDay = day, hour?, practitionerId = practitioners[0]?.id ?? demoPractitioners[0].id) {
  // if no hour given (header button), pick the first free 9-16 hour for that practitioner & day
  setDraft({ day: slotDay, hour: availableHour, practitioner_id: practitionerId,
             case_title: caseTitle==='all' ? 'Knee' : caseTitle, duration_minutes: 60 });
}
```

`draft` being non-null renders `<AppointmentEditor key={draft.id ?? 'new'} …/>`. "Edit appointment" sets `draft` to `{...selected, day, hour}`.

`onSave` calls `action('appointments' + (draft.id ? '/'+draft.id : ''), draft.id ? 'PATCH' : 'POST', payload, toast)`. On success it selects the saved row, jumps `chosenDay` to its day, resets both filters (so the new booking is visible), opens the details panel and closes the modal.

### Editor (`AppointmentEditor`)

Local state: `leadId, practitioner, caseTitle, duration, wallTime, saving, error`. The datetime-local field is the clinic wall time and is converted with `clinicWallTimeToIso(wallTime, new Date(0))` on submit. Errors from that function (DST issues) and from the server are shown in `<p class="field-error" role="alert">`. Submit is disabled while `saving`. Lead is a select on create and a read-only input on edit.

It relies on two shared components, `ModalShell` and `SelectMenu` (from `dashboard-controls`). Swap in your own modal and select.

---

## 5. Backend contract

The calendar only needs:

- `GET snapshot` → `{ appointments: Row[], leads: Lead[] }`. Each row needs `id, lead_id, full_name, start_utc, duration_minutes, case_title, practitioner_id | location`.
- `POST appointments` and `PATCH appointments/:id` with:
  ```json
  { "lead_id": "...", "practitioner_id": "...", "case_title": "Knee", "duration_minutes": 60, "start_utc": "2026-10-14T16:00:00.000Z" }
  ```
  returning the saved row (`201` create, `200` update).

**Server-side rules** (see `demo-data.ts` ~L138–164; re-implement on a real backend, since the client check is not enough):

| Rule | Status |
| --- | --- |
| PATCH on unknown id, or POST with an id | 404 |
| Editing under a different `lead_id` | 400 |
| Unknown lead / practitioner / case, duration not in {30, 60}, unparseable `start_utc` | 400 |
| Lead is blocked from contact | 400 |
| Start before 9:00 or end after 17:00 **in clinic TZ** (`appointmentMinutes`) | 400 |
| Same-practitioner overlap (`appointmentConflicts`) | **409**, with message shown in the editor |

On success the demo also marks the lead `booked` and refreshes the snapshot. Keep the call to `refreshSnapshot` so the grid re-renders from fresh data.

---

## 6. CSS (copy the block, then retheme)

Everything is scoped under `.appointments-workspace` and `.schedule-*` / `.appointment-*` / `.month-*` classes.

**Theme variables**

```css
.appointments-workspace { --calendar-accent: #087ff2; --calendar-line: var(--line); }
[data-theme="dark"] .appointments-workspace { --calendar-line: #263954; }
```

It depends on host tokens: `--line`, `--line-2`, `--paper`, `--surface`, `--ink`, `--ink-2`, `--muted`, `--soft-blue`, `--accent-ink`. Map these to your design tokens.

**Key layout rules**

- **Page layout:** `.schedule-layout { display:grid; grid-template-columns:minmax(0,1fr) }`. With the panel open (`.with-details`) it is `minmax(0,1fr) 300px`, widening to 340px at ≥1600px and narrowing to 270px at ≤1280px.
- **Grid sizing:**
  - `.schedule-grid { min-width: 660px }`
  - `.schedule-grid.week-grid { min-width: 1050px }`
  - header and body: `grid-template-columns: 66px minmax(0,1fr)`
  - `.schedule-column-headings, .schedule-columns { grid-template-columns: repeat(var(--columns), minmax(0,1fr)) }`
  - `.schedule-grid-scroll { overflow-x:auto }` gives horizontal scroll on small screens.
- **Row height contract:** `.schedule-hour-cell` and `.schedule-hour-labels time` are **56px**, and **100px** inside `.week-grid`. The JS positioning constant `56` must equal this value.
- **Booking blocks:** `.schedule-booking-position { position:absolute; left:3px; right:3px }`. A block has a 5px coloured left border and tone variables:
  ```css
  .schedule-booking        { --booking-edge:#168df6; --booking-fill:#e5f1ff; --booking-ink:#0a3a78; }
  .schedule-booking.violet { --booking-edge:#a656ed; --booking-fill:#f1e7fe; --booking-ink:#59218c; }
  .schedule-booking.teal   { --booking-edge:#12c99c; --booking-fill:#dcf7ef; --booking-ink:#075f50; }
  ```
  with dark-mode fill/ink overrides for each, and `.selected { outline:2px solid #349bff }`.
- **Open slot:** a dashed-border button with a "+" icon that highlights on hover.
- **Month:** `.month-weekdays, .month-grid { grid-template-columns: repeat(7,minmax(0,1fr)) }`, with `.month-day { min-height:94px }`.
- **Occupancy and capacity bars** use native `<meter>` with `-webkit-meter-bar` and `-webkit-meter-optimum-value` styling, because `meter` is accessible for free. Firefox needs `::-moz-meter-bar` if you want identical colours, which this repo does not add.

---

## 7. Accessibility checklist (already built in; keep it)

- Tabs use `role="tablist"` / `role="tab"` / `aria-selected`. The view switcher uses `aria-pressed`.
- Prev/next buttons have `aria-label`s ("Previous period", "Next period"); the "+" buttons are labelled with column, date and time.
- Booking blocks expose `aria-pressed` and a full-sentence `aria-label`.
- Loading state uses `role="status"`, editor errors use `role="alert"`, and meters have `aria-label`s.
- Scroll-into-view respects `prefers-reduced-motion`.

---

## 8. Porting checklist

1. **Copy** `display.ts` (TZ functions), `appointment-data.ts`, the CSS block, and `appointments-page.tsx`.
2. **Set `CLINIC_TZ`** to the target product's timezone, or make it a per-account setting. Keep the "Times shown in …" label in sync.
3. **Replace the resource list** (`demoPractitioners`) with data from the target API. Add `color`/tone mapping if you want colour per resource instead of per category.
4. **Replace `caseTitles` and `tone()`** with your category field and colour rule.
5. **Set the working hours.** `scheduleHours` (9–16), the `Math.min(9, …)` / `Math.max(17, …)` clamps, the `8`-hour capacity constant and the server's 9–17 check must all agree. Pull them from one config constant when porting.
6. **Keep the 56px constant in sync** between JS (`* 56`) and CSS (`height: 56px`). Better: expose `--hour-height` in CSS and read it from a shared constant.
7. **Wire `snapshot` and `action`** to your data layer (SWR/React Query/server actions). The page only needs "read all appointments" and "create/update, return the saved row".
8. **Enforce conflicts and hours on the server**, returning 409/400 with a human message the editor can display.
9. **Replace** `ModalShell`, `SelectMenu`, `Link` (View case) and the icons with your equivalents.
10. **Map CSS tokens** (§6) and confirm dark mode.
11. **Remove demo-only copy**: the "Demo schedule" tag, "Demo practice", "Illustrative bookings…" legend and "fictional lead" text.

---

## 9. Gotchas worth knowing

- **Never use browser-local dates** (`new Date().getDate()`, `toLocaleDateString()` without a timezone) for day bucketing. Always go through `calendarDay()` or `appointmentMinutes()`, or bookings land on the wrong day for users outside the clinic TZ.
- **Always anchor date-only math at `T12:00:00Z`.** Anchoring at midnight breaks on DST days.
- **Month navigation** uses `setUTCMonth`. From the 31st, it can overflow into the next month (Jan 31 → Mar 3). `changeDate` anchors on `monthStart` (the 1st) to avoid this. Keep that.
- **Week starts Monday** using `(weekday + 6) % 7`. For a Sunday start, use `weekday` directly and change the header labels.
- **Filtered bookings still block slots.** The "Booked · filtered" cell prevents opening the create modal on top of a hidden booking. The server conflict check is the real guard.
- **Hour range auto-expands**, so a booking outside 9–17 still renders, though the server rejects creating new ones there.
- **Overlapping bookings** for the same resource are prevented by the conflict rule, so the Day grid does not lay out side-by-side overlaps. If your product allows double-booking, you need a column-packing algorithm, which does not exist here.
- **Month view is not filtered by period** (it uses `matching`), but the occupancy bar uses `visible`, which is limited to the current month's days.
- **Past times:** the editor passes `new Date(0)` to `clinicWallTimeToIso`, so past datetimes are allowed in the UI. Pass the real `now` if you want to block them.
