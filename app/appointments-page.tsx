"use client";

import Link from "next/link";
import {
  CSSProperties,
  FormEvent,
  ReactNode,
  RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { ModalShell, SelectMenu } from "./dashboard-controls";
import { dashboardFetch } from "./dashboard-client";
import { clientErrorMessage, CLINIC_TZ, timezoneLabel } from "./display";
import type { Lead, Snapshot } from "./dashboard-data";
import {
  Appointment,
  CalendarData,
  CalendarView,
  HOUR_HEIGHT,
  calendarWallTime,
  calendarDay,
  calendarDays,
  isCalendarDay,
  layoutAppointments,
  moveCalendarDate,
  occupiesTime,
  workingHours,
  BOOKING_TAGS,
  STATUS_BUCKETS,
  appointmentSummary,
  bookedBySource,
  filterAppointments,
  stateLabel,
  tagLabel,
  VISIT_KINDS,
  nowMinutes,
  openIntervals,
  periodLabels,
  visitMark,
  visitStatus,
  type BookingTag,
  type StatusBucket,
} from "./appointment-data";

type Action = (
  path: string,
  method: string,
  body?: unknown,
  message?: string,
  onError?: (message: string) => void,
) => Promise<Record<string, unknown> | null>;
const views: CalendarView[] = ["Day", "Week", "Month", "Locations", "Capacity"];
const dateLabel = (
  day: string,
  options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  },
) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    ...options,
    timeZone: "UTC",
  });
const clock = (iso: string, timezone: string) =>
  new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
const timeRange = (a: Appointment, timezone: string) =>
  `${clock(a.start_utc, timezone)}${a.end_utc ? ` – ${clock(a.end_utc, timezone)}` : ""}`;
const calendarZoneLabel = (timezone: string) =>
  ["America/Los_Angeles", "US/Pacific"].includes(timezone)
    ? "PT"
    : timezoneLabel(timezone);
const hoursLabel = (value: number) =>
  Number(value.toFixed(1)).toLocaleString("en-US");
const tone = (caseTitle: string) =>
  /hip/i.test(caseTitle)
    ? "teal"
    : /knee/i.test(caseTitle)
      ? "blue"
      : ["blue", "violet", "teal"][
          Array.from(caseTitle).reduce((sum, c) => sum + c.charCodeAt(0), 0) % 3
        ];

function CalendarSymbol({ kind = "calendar" }: { kind?: "calendar" | "list" }) {
  const paths = {
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </>
    ),
    list: (
      <>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <path d="M3 6h.1M3 12h.1M3 18h.1" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="19"
      height="19"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[kind]}
    </svg>
  );
}
function Arrow({ next = false }: { next?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={next ? "m7 4 6 6-6 6" : "m13 4-6 6 6 6"} />
    </svg>
  );
}
function State({ item }: { item: Appointment }) {
  return (
    <span
      className={`appointment-state ${occupiesTime(item) ? "active" : "inactive"} ${item.needs_staff_review || item.state === "unknown" ? "review" : ""}`}
    >
      {item.needs_staff_review ? "Needs review" : stateLabel(item.state)}
    </span>
  );
}
export function BookingTagChip({ tag }: { tag: BookingTag }) {
  return <span className={`booking-tag ${tag}`}>{tagLabel(tag)}</span>;
}
function Skeleton({ w = "100%", h = 14 }: { w?: string; h?: number }) {
  return (
    <span
      className="skeleton"
      style={{ width: w, height: h }}
      aria-hidden="true"
    />
  );
}

// Same shape as the real calendar, so nothing jumps when the data lands.
function CalendarSkeleton({
  mode,
  view,
}: {
  mode: string;
  view: CalendarView;
}) {
  if (mode === "List")
    return (
      <div className="calendar-skeleton-list" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i}>
            <Skeleton w="70%" />
            <Skeleton w="80%" />
            <Skeleton w="60%" />
            <Skeleton w="65%" />
            <Skeleton w="55%" />
            <Skeleton w="50%" h={20} />
          </div>
        ))}
      </div>
    );
  if (view === "Month")
    return (
      <div className="calendar-skeleton-month" aria-busy="true">
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i}>
            <Skeleton w="22px" h={12} />
            {i % 4 === 1 && <Skeleton w="85%" h={16} />}
          </div>
        ))}
      </div>
    );
  const columns = view === "Week" ? 7 : 3;
  const hours = 8;
  return (
    <div className="schedule-grid-scroll" aria-busy="true">
      <div
        className={`schedule-grid ${view === "Week" ? "week-grid" : ""}`}
        style={
          {
            "--columns": columns,
            "--hour-height": `${HOUR_HEIGHT}px`,
          } as CSSProperties
        }
      >
        <div className="schedule-grid-header">
          <div />
          <div className="schedule-column-headings">
            {Array.from({ length: columns }).map((_, c) => (
              <div key={c} className="calendar-skeleton-heading">
                <Skeleton w="45%" h={15} />
                <Skeleton w="70%" h={11} />
              </div>
            ))}
          </div>
        </div>
        <div className="schedule-grid-body">
          <div className="schedule-hour-labels">
            {Array.from({ length: hours }).map((_, h) => (
              <time key={h}>
                <Skeleton w="34px" h={11} />
              </time>
            ))}
          </div>
          <div className="schedule-columns">
            {Array.from({ length: columns }).map((_, c) => (
              <div className="schedule-column" key={c}>
                {Array.from({ length: hours }).map((_, h) => (
                  <div className="schedule-hour-cell" key={h} />
                ))}
                {[(c * 3 + 1) % hours, (c * 5 + 4) % hours].map((h, i) => (
                  <span
                    key={i}
                    className="skeleton calendar-skeleton-block"
                    style={{ top: h * HOUR_HEIGHT + 4 }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Who the visit belongs to, in the calendar's short words (backend `source`, else the tag).
const sourceLabel2 = (a: Appointment) =>
  ({ elliot: "Elliot", sheet: "Sheet", stride: "Stride" })[a.source] ??
  { elliot: "Elliot", sheet_lead: "Sheet", stride_only: "Stride" }[a.tag] ??
  "Sheet";
// Block colour by visit kind: first visit blue, follow-up teal, anything else violet.
const kindTone = { first_visit: "", follow_up: "teal", other: "violet" };
function BookingBlock({
  item,
  selected,
  timezone,
  compact,
  tiny,
  onChoose,
}: {
  item: Appointment;
  selected: boolean;
  timezone: string;
  compact?: boolean;
  // A very narrow lane: WAITING becomes an orange "W" badge.
  tiny?: boolean;
  onChoose: (a: Appointment, anchor: HTMLElement) => void;
}) {
  const mark = visitMark(item);
  const waiting = item.approval === "waiting";
  const name = item.patient_name || item.full_name;
  const visit = item.visit_type || item.type;
  const source = sourceLabel2(item);
  const said = waiting ? "Waiting for approval in Stride" : mark.label;
  return (
    <button
      type="button"
      className={`schedule-booking ${kindTone[item.visit_kind ?? "other"] ?? ""} ${waiting ? "waiting" : ""} ${mark.status === "no_show" ? "no-show" : ""} ${selected ? "selected" : ""} ${compact ? "compact" : ""} ${tiny ? "tiny" : ""} ${mark.struck ? "inactive" : ""}`}
      aria-haspopup="dialog"
      aria-expanded={selected}
      aria-label={[
        name,
        visit,
        timeRange(item, timezone),
        said,
        `${source} booking`,
      ]
        .filter(Boolean)
        .join(", ")}
      title={[
        name,
        timeRange(item, timezone),
        visit,
        item.practitioner_name,
        said,
        source,
      ]
        .filter(Boolean)
        .join(" · ")}
      onClick={(e) => onChoose(item, e.currentTarget)}
    >
      <span className="booking-head">
        <strong>{name}</strong>
        {(waiting || mark.mark) && (
          <span className="schedule-booking-mark" aria-hidden="true">
            {waiting &&
              (tiny ? (
                <em title="Waiting for approval in Stride">W</em>
              ) : (
                <em>WAITING</em>
              ))}
            {mark.mark && <i className={mark.status}>{mark.mark}</i>}
          </span>
        )}
      </span>
      <small className="booking-source">{source}</small>
      {!compact && (
        <span className="booking-time">
          {timeRange(item, timezone)} · {visit}
        </span>
      )}
    </button>
  );
}

// Close a popover on Escape (focus back to its opener) or a press outside it and its opener.
function useDismiss(
  open: boolean,
  box: RefObject<HTMLElement | null>,
  opener: HTMLElement | null,
  onClose: () => void,
) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close.current();
      opener?.focus();
    };
    const press = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!box.current?.contains(target) && !opener?.contains(target))
        close.current();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", press);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", press);
    };
  }, [open, box, opener]);
}

const birthday = (value: string | undefined) =>
  value && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? dateLabel(value.slice(0, 10), {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";

// View only: what the visit is and who booked it. Approving, cancelling or moving a visit
// happens in Stride. A popover next to the block; a bottom sheet on phones (CSS).
function VisitCard({
  item,
  anchor,
  lead,
  timezone,
  onClose,
}: {
  item: Appointment;
  anchor: HTMLElement;
  lead?: Lead;
  timezone: string;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useDismiss(true, box, anchor, onClose);
  useLayoutEffect(() => {
    box.current?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    // Beside the block (right, else left), kept inside the window below the top bar.
    function place() {
      const card = box.current;
      if (!card) return;
      if (!anchor.isConnected) return onClose();
      if (window.matchMedia("(max-width: 700px)").matches) {
        card.style.left = card.style.top = "";
        return;
      }
      const r = anchor.getBoundingClientRect();
      const gap = 8;
      const roof =
        (document.querySelector(".topbar")?.getBoundingClientRect().bottom ??
          0) + gap;
      const { offsetWidth: w, offsetHeight: h } = card;
      let left = r.right + gap;
      if (left + w > window.innerWidth - gap) left = r.left - gap - w;
      if (left < gap) left = Math.max(gap, window.innerWidth - w - gap);
      const top = Math.max(roof, Math.min(r.top, window.innerHeight - h - gap));
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, onClose]);
  const status = visitStatus(item);
  const by = bookedBySource(item);
  const name = item.patient_name || item.full_name;
  const role = item.clinician?.role;
  const born = birthday(lead?.date_of_birth);
  const contact = [lead?.phone, lead?.email].filter(Boolean).join(" · ");
  const rows: [string, ReactNode][] = [
    ["Visit", item.visit_type || item.type],
    [
      "When",
      [
        dateLabel(calendarDay(item.start_utc, timezone), {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
        `${timeRange(item, timezone)} ${calendarZoneLabel(timezone)}`,
        item.duration_minutes ? `${item.duration_minutes} min` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    ],
    [
      "Where",
      [item.location, [item.practitioner_name, role].filter(Boolean).join(", ")]
        .filter(Boolean)
        .join(" · "),
    ],
    [
      "Booked by",
      <>
        {by.label}
        {by.source === "elliot" &&
          item.lead_id &&
          item.call_log_id !== null && (
            <>
              {" · "}
              <Link
                href={`/leads/${item.lead_id}/conversations/calls?call=${item.call_log_id}`}
              >
                Open the call
              </Link>
            </>
          )}
      </>,
    ],
  ];
  return (
    <div
      className="visit-card"
      ref={box}
      role="dialog"
      aria-labelledby="visit-card-name"
      tabIndex={-1}
    >
      <header>
        <p className={`visit-card-status ${status.tone}`}>{status.label}</p>
        <button
          className="visit-card-close"
          type="button"
          aria-label="Close"
          onClick={() => {
            onClose();
            anchor.focus();
          }}
        >
          ×
        </button>
      </header>
      <h3 id="visit-card-name">{name}</h3>
      {born && <p className="visit-card-sub">Born {born}</p>}
      {contact && <p className="visit-card-sub">{contact}</p>}
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {item.approval === "waiting" && (
        <p className="visit-card-note">To approve or cancel, use Stride.</p>
      )}
      {item.lead_id && (
        <Link
          className="secondary visit-card-lead"
          href={`/leads/${item.lead_id}`}
        >
          Open lead
        </Link>
      )}
    </div>
  );
}

// What the calendar's colours and marks mean.
function CalendarLegend({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [opener, setOpener] = useState<HTMLButtonElement | null>(null);
  useDismiss(open, box, opener, () => onOpenChange(false));
  return (
    <div className="calendar-legend-wrap">
      <button
        ref={setOpener}
        className={`secondary schedule-filters-button ${open ? "selected" : ""}`}
        type="button"
        aria-expanded={open}
        aria-controls="calendar-legend"
        onClick={() => onOpenChange(!open)}
      >
        Legend
      </button>
      {open && (
        <div
          className="calendar-legend"
          id="calendar-legend"
          ref={box}
          role="group"
          aria-label="Legend"
        >
          <ul>
            {VISIT_KINDS.map((k) => (
              <li key={k.value}>
                <i className={`legend-block ${k.value}`} aria-hidden="true" />
                {k.label}
              </li>
            ))}
            <li>
              <i className="legend-area open" aria-hidden="true" />
              White: open in Stride
            </li>
            <li>
              <i className="legend-area closed" aria-hidden="true" />
              Grey: not open
            </li>
          </ul>
          <ul>
            <li>
              <b className="legend-mark ok" aria-hidden="true">
                ✓
              </b>
              Confirmed
            </li>
            <li>
              <b className="legend-mark" aria-hidden="true">
                ○
              </b>
              Not marked yet
            </li>
            <li>
              <b className="legend-mark ok" aria-hidden="true">
                ●
              </b>
              Checked in
            </li>
            <li>
              <b className="legend-mark off" aria-hidden="true">
                No show
              </b>
              Did not come
            </li>
            <li>
              <b className="legend-mark faded" aria-hidden="true">
                Name
              </b>
              Faded: cancelled or late cancel
            </li>
            <li>
              <em className="legend-waiting" aria-hidden="true">
                WAITING
              </em>
              Waiting for approval in Stride
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

export function AppointmentsPage({
  snapshot,
  location,
  action,
  initialLeadId,
  leadId,
  initialDay,
  userId = "",
}: {
  snapshot: Snapshot;
  location: string;
  action: Action;
  initialLeadId: string | null;
  leadId?: string;
  initialDay?: string;
  userId?: string;
}) {
  const search = useSearchParams();
  const [chosenDay, setChosenDay] = useState("");
  const [view, setView] = useState<CalendarView>("Day");
  const [mode, setMode] = useState("Calendar");
  const [caseTitle, setCaseTitle] = useState("all");
  // Practitioner ids ticked in the filters panel; none ticked = everyone.
  const [picked, setPicked] = useState<string[]>([]);
  // The calendar's own location filter starts from the top-bar location and can differ.
  const [calendarLocation, setCalendarLocation] = useState("");
  const [status, setStatus] = useState<StatusBucket | "all">("all");
  const [tag, setTag] = useState<BookingTag | "all">("all");
  // The visit card: which visit, and the block (or list button) it sits next to.
  const [card, setCard] = useState<{ id: string; anchor: HTMLElement } | null>(
    null,
  );
  const [legendOpen, setLegendOpen] = useState(false);
  const [loaded, setLoaded] = useState<{
    key: string;
    data: CalendarData;
  } | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState<{
    day: string;
    practitioner?: string;
  } | null>(null);
  // The filters panel remembers open/closed per staff member in this browser.
  const panelKey = `rpt-calendar-filters:${userId}`;
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    // localStorage exists only in the browser: read it after hydration.
    try {
      setFiltersOpen(localStorage.getItem(panelKey) === "open"); // eslint-disable-line react-hooks/set-state-in-effect
    } catch {
      /* storage unavailable */
    }
  }, [panelKey]);
  function toggleFilters() {
    const next = !filtersOpen;
    setFiltersOpen(next);
    try {
      localStorage.setItem(panelKey, next ? "open" : "closed");
    } catch {
      /* storage unavailable */
    }
  }
  const timezone = loaded?.data.timezone ?? CLINIC_TZ;
  const linkedDay = search.get("date");
  const day =
    chosenDay ||
    (isCalendarDay(linkedDay) ? linkedDay : initialDay) ||
    calendarDay(undefined, timezone);
  const days = calendarDays(day, view);
  const key = `${days[0]}:${days[days.length - 1]}:${leadId ?? ""}`;
  const data = loaded?.key === key ? loaded.data : null;
  const error = failure?.key === key ? failure.message : "";
  const loading = !data && !error;

  useEffect(() => {
    const controller = new AbortController();
    const [start, end, lead] = key.split(":");
    async function refresh() {
      try {
        const response = await dashboardFetch(
          `/api/dashboard/appointment-calendar?start=${start}&end=${end}${lead ? `&lead_id=${lead}` : ""}`,
          { signal: controller.signal },
        );
        const result = (await response.json()) as CalendarData & {
          detail?: string;
        };
        if (!response.ok)
          throw new Error(
            clientErrorMessage(
              result.detail,
              "The calendar could not be loaded. Please try again.",
            ),
          );
        if (!controller.signal.aborted) {
          setLoaded({ key, data: result });
          setFailure(null);
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setFailure({
            key,
            message:
              e instanceof Error
                ? e.message
                : "The calendar could not be loaded.",
          });
      }
    }
    void refresh();
    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 20_000);
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [key, reload]);

  const place = calendarLocation || location;
  const appointments = filterAppointments(data?.appointments ?? [], {
    location: place,
  });
  const timing = new Map(
    appointments.map((a) => {
      const wall = calendarWallTime(a.start_utc, timezone);
      return [
        a.id,
        {
          day: wall.slice(0, 10),
          minutes: Number(wall.slice(11, 13)) * 60 + Number(wall.slice(14, 16)),
        },
      ] as const;
    }),
  );
  const dayOf = (a: Appointment) => timing.get(a.id)!.day;
  const minutesOf = (a: Appointment) => timing.get(a.id)!.minutes;
  const resources = (data?.practitioners ?? []).filter(
    (p) => place === "All Locations" || p.location === place,
  );
  const locationOptions = [
    ...new Set([
      ...(data?.practitioners ?? []).map((p) => p.location),
      ...(data?.appointments ?? []).map((a) => a.location),
      ...(location !== "All Locations" ? [location] : []),
    ]),
  ].sort();
  const practitioners = resources.filter(
    (p) => !picked.length || picked.includes(p.id),
  );
  const cases = [...new Set(appointments.map((a) => a.case_title))].sort();
  const matching = filterAppointments(appointments, {
    caseTitle,
    practitioners: picked,
    status,
    tag,
  });
  const periodDays =
    view === "Month"
      ? days.filter((d) => d.slice(0, 7) === day.slice(0, 7))
      : days;
  const visible = matching.filter((a) => periodDays.includes(dayOf(a)));
  const summary = appointmentSummary(visible);
  const filtered =
    caseTitle !== "all" ||
    picked.length > 0 ||
    status !== "all" ||
    tag !== "all" ||
    Boolean(calendarLocation && calendarLocation !== location);
  // Never opened by itself: only a click on a visit opens its card.
  const selected = card ? visible.find((a) => a.id === card.id) : undefined;
  const closeCard = () => setCard(null);
  // Only this clinic's open time under a location filter (Locations view: each column's own).
  const openPlace = place === "All Locations" ? undefined : place;
  const practitionerIds = [...new Set(practitioners.map((p) => p.id))];
  const capacity = data
    ? practitionerIds.length *
      periodDays.reduce(
        (sum, d) => sum + workingHours(d, data.business_hours),
        0,
      )
    : 0;
  const occupied = visible
    .filter(occupiesTime)
    .reduce((sum, a) => sum + (a.duration_minutes ?? 0) / 60, 0);
  const percent = capacity ? Math.round((occupied / capacity) * 100) : 0;
  const practitionerOptions = [
    ...new Map(resources.map((p) => [p.id, p])).values(),
  ];
  const dayResources =
    view === "Locations"
      ? practitioners
      : [
          ...new Map(
            practitioners.map((p) => [
              p.id,
              {
                ...p,
                location: [
                  ...new Set(
                    practitioners
                      .filter((r) => r.id === p.id)
                      .map((r) => r.location),
                  ),
                ].join(" · "),
              },
            ]),
          ).values(),
        ];
  // A clinician's role (credentials): the practitioner list's, else their visits'.
  const roles = new Map([
    ...(data?.appointments ?? [])
      .filter((a) => a.clinician?.role)
      .map((a) => [a.practitioner_id, a.clinician!.role!] as const),
    ...(data?.practitioners ?? [])
      .filter((p) => p.role)
      .map((p) => [p.id, p.role!] as const),
  ]);
  const columns =
    view === "Week"
      ? days.map((d) => ({
          key: d,
          day: d,
          title: dateLabel(d, { weekday: "short", day: "numeric" }),
          subtitle:
            practitionerIds.length === 1
              ? practitioners[0].name
              : "All selected practitioners",
          practitioner: undefined,
          records: matching.filter((a) => dayOf(a) === d),
          // White = open in Stride for any practitioner shown, grey = not open.
          open: openIntervals(data?.open_slots, d, practitionerIds, openPlace),
        }))
      : dayResources.map((p) => ({
          key: `${p.id}:${p.location}`,
          day,
          title: view === "Locations" ? p.location : p.name,
          subtitle: (view === "Locations"
            ? [p.name, roles.get(p.id)]
            : [roles.get(p.id), p.location]
          )
            .filter(Boolean)
            .join(" · "),
          practitioner: p.id,
          records: visible.filter(
            (a) =>
              a.practitioner_id === p.id &&
              (view !== "Locations" || a.location === p.location),
          ),
          open: openIntervals(
            data?.open_slots,
            day,
            [p.id],
            view === "Locations" ? p.location : openPlace,
          ),
        }));
  // Rows from 9 AM to 5 PM at least, stretched to every visit and open slot shown.
  const opens = columns.flatMap((c) => c.open);
  const hourStart = Math.min(
    9,
    ...visible.map((a) => Math.floor(minutesOf(a) / 60)),
    ...opens.map(([start]) => Math.floor(start / 60)),
  );
  const hourEnd = Math.min(
    24,
    Math.max(
      17,
      ...visible.map((a) =>
        Math.ceil((minutesOf(a) + (a.duration_minutes ?? 30)) / 60),
      ),
      ...opens.map(([, end]) => Math.ceil(end / 60)),
    ),
  );
  const hours = Array.from(
    { length: hourEnd - hourStart },
    (_, i) => i + hourStart,
  );
  const halfHours = hours.flatMap((h) => [h * 60, h * 60 + 30]);
  const toY = (minutes: number) =>
    ((minutes - hourStart * 60) / 60) * HOUR_HEIGHT;

  function choose(a: Appointment, anchor: HTMLElement) {
    setCard({ id: a.id, anchor });
  }
  const periodLabel = periodLabels(view, day, days);
  // The now line's dot: once per day, on that day's first column.
  const firstColumnOfDay = new Set(
    columns
      .filter((c, i) => columns.findIndex((o) => o.day === c.day) === i)
      .map((c) => c.key),
  );

  return (
    <div className="appointments-workspace">
      <div className="page-heading">
        <div>
          {leadId ? (
            <h2 className="calendar-context-heading">Appointments</h2>
          ) : (
            <h1>Appointments</h1>
          )}
          <p>Your clinic schedule, connected to Stride.</p>
        </div>
        <div className="page-tools">
          <button
            className="primary"
            type="button"
            onClick={() => setDraft({ day })}
          >
            <span aria-hidden="true">＋</span>New appointment
          </button>
          <div
            className="calendar-mode"
            role="group"
            aria-label="Appointment display"
          >
            {["Calendar", "List"].map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                className={mode === m ? "selected" : ""}
                onClick={() => setMode(m)}
              >
                <CalendarSymbol kind={m === "List" ? "list" : "calendar"} />
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>
      <section
        className="calendar-workspace"
        aria-label="Appointment calendar"
        aria-busy={loading}
      >
        <div className="schedule-toolbar">
          <div className="schedule-date-nav">
            <button
              className="calendar-icon-button"
              type="button"
              aria-label="Previous period"
              onClick={() => setChosenDay(moveCalendarDate(day, view, -1))}
            >
              <Arrow />
            </button>
            <button
              className="calendar-icon-button"
              type="button"
              aria-label="Next period"
              onClick={() => setChosenDay(moveCalendarDate(day, view, 1))}
            >
              <Arrow next />
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => setChosenDay(calendarDay(undefined, timezone))}
            >
              Today
            </button>
            <h2 aria-label={periodLabel.long}>
              <span className="period-long">{periodLabel.long}</span>
              <span className="period-short" aria-hidden="true">
                {periodLabel.short}
              </span>
            </h2>
            <span className="schedule-zone">{calendarZoneLabel(timezone)}</span>
          </div>
          <div
            className="schedule-view-switch"
            role="group"
            aria-label="Calendar view"
          >
            {views.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                className={view === v ? "selected" : ""}
                onClick={() => setView(v)}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="schedule-tools">
            <button
              className={`secondary schedule-filters-button ${filtersOpen ? "selected" : ""}`}
              type="button"
              aria-expanded={filtersOpen}
              aria-controls="calendar-filters"
              onClick={toggleFilters}
            >
              Filters
              {filtered && (
                <>
                  <span aria-hidden="true"> •</span>
                  <span className="sr-only"> (filters on)</span>
                </>
              )}
            </button>
            <CalendarLegend open={legendOpen} onOpenChange={setLegendOpen} />
          </div>
        </div>
        {error && (
          <div className="calendar-notice" role="alert">
            <span>
              {error}
              {data ? " Showing the last loaded schedule." : ""}
            </span>
            <button
              className="secondary"
              type="button"
              onClick={() => setReload((n) => n + 1)}
            >
              Retry
            </button>
          </div>
        )}
        {data?.truncated && (
          <p className="calendar-notice" role="status">
            This period contains more than 2,000 appointments. Choose a shorter
            period to see every record.
          </p>
        )}
        <div className={`schedule-layout ${filtersOpen ? "with-filters" : ""}`}>
          {filtersOpen && (
            <aside
              className="calendar-filters"
              id="calendar-filters"
              aria-label="Calendar filters"
            >
              {!leadId && (
                <label>
                  Location
                  <SelectMenu
                    ariaLabel="Filter appointments by location"
                    value={place}
                    onChange={setCalendarLocation}
                    options={[
                      { value: "All Locations", label: "All locations" },
                      ...locationOptions.map((l) => ({ value: l, label: l })),
                    ]}
                  />
                </label>
              )}
              <label>
                Case
                <SelectMenu
                  ariaLabel="Filter appointments by case"
                  value={caseTitle}
                  onChange={setCaseTitle}
                  options={[
                    { value: "all", label: "All cases" },
                    ...cases.map((c) => ({ value: c, label: c })),
                  ]}
                />
              </label>
              <fieldset className="calendar-filter-people">
                <legend>Practitioners</legend>
                {practitionerOptions.map((p) => (
                  <label key={p.id}>
                    <input
                      type="checkbox"
                      checked={picked.includes(p.id)}
                      onChange={(e) =>
                        setPicked((now) =>
                          e.target.checked
                            ? [...now, p.id]
                            : now.filter((id) => id !== p.id),
                        )
                      }
                    />
                    {p.name}
                  </label>
                ))}
                {!practitionerOptions.length && (
                  <small>None in this location</small>
                )}
                {!picked.length && practitionerOptions.length > 0 && (
                  <small>None ticked: everyone shows</small>
                )}
              </fieldset>
              <label>
                Status
                <SelectMenu
                  ariaLabel="Filter appointments by status"
                  value={status}
                  onChange={(v) => setStatus(v as StatusBucket | "all")}
                  options={[
                    { value: "all", label: "All statuses" },
                    ...STATUS_BUCKETS.map((b) => ({
                      value: b.value,
                      label: b.label,
                    })),
                  ]}
                />
              </label>
              {!leadId && (
                <label>
                  Booked by
                  <SelectMenu
                    ariaLabel="Filter appointments by who booked them"
                    value={tag}
                    onChange={(v) => setTag(v as BookingTag | "all")}
                    options={[
                      { value: "all", label: "Everyone" },
                      ...BOOKING_TAGS.map((t) => ({
                        value: t.value,
                        label: t.label,
                      })),
                    ]}
                  />
                </label>
              )}
              {filtered && (
                <button
                  className="link-button"
                  type="button"
                  onClick={() => {
                    setCaseTitle("all");
                    setPicked([]);
                    setStatus("all");
                    setTag("all");
                    setCalendarLocation("");
                  }}
                >
                  Reset filters
                </button>
              )}
            </aside>
          )}
          <div className="schedule-main">
            {loading && !data ? (
              <div className="schedule-occupancy" aria-hidden="true">
                <Skeleton w="140px" />
                <Skeleton h={8} />
                <Skeleton w="70px" />
              </div>
            ) : (
              <div className="schedule-occupancy">
                <span>
                  {leadId ? (
                    "Showing only this lead’s appointments"
                  ) : (
                    <>
                      {hoursLabel(occupied)} / {hoursLabel(capacity)} hours
                      booked
                    </>
                  )}
                </span>
                {!leadId && (
                  <meter
                    min="0"
                    max={capacity || 1}
                    value={Math.min(occupied, capacity)}
                    aria-label="Booked hours in the selected period"
                  />
                )}
                {!leadId && (
                  <span>
                    {capacity ? `${percent}% booked` : "Capacity unavailable"}
                  </span>
                )}
              </div>
            )}
            {loading && !data && (
              <div className="calendar-summary" aria-hidden="true">
                <Skeleton w="110px" h={16} />
                <Skeleton w="70px" />
                <Skeleton w="90px" />
                <Skeleton w="120px" />
                <Skeleton w="80px" />
              </div>
            )}
            {data && (
              <div
                className="calendar-summary"
                role="status"
                aria-label="Appointments the filters show"
              >
                <span className="lead-count">
                  <b>{summary.total}</b>{" "}
                  {summary.total === 1 ? "appointment" : "appointments"}
                </span>
                {STATUS_BUCKETS.map((b) => (
                  <span key={b.value}>
                    <b>{summary.status[b.value]}</b> {b.label.toLowerCase()}
                  </span>
                ))}
                {!leadId && (
                  <span className="by-tag">
                    By tag:
                    {BOOKING_TAGS.map((t) => (
                      <span key={t.value}>
                        <BookingTagChip tag={t.value} />{" "}
                        <b>{summary.tags[t.value]}</b>
                      </span>
                    ))}
                  </span>
                )}
              </div>
            )}
            {loading && !data ? (
              <div role="status" aria-label="Loading your schedule">
                <CalendarSkeleton mode={mode} view={view} />
              </div>
            ) : !data ? (
              <div className="calendar-empty">
                <h3>Schedule unavailable</h3>
                <p>Retry the connection to load appointments.</p>
              </div>
            ) : mode === "List" ? (
              <div className="schedule-list-scroll">
                <table className="schedule-list">
                  <thead>
                    <tr>
                      {[
                        "Date & time",
                        "Patient",
                        "Case",
                        "Practitioner",
                        "Location",
                        "Status",
                        "Booked by",
                      ].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((a) => (
                      <tr
                        key={a.id}
                        className={a.id === selected?.id ? "selected" : ""}
                      >
                        <td>
                          {dateLabel(dayOf(a), {
                            month: "short",
                            day: "numeric",
                          })}
                          <small>{timeRange(a, timezone)}</small>
                        </td>
                        <td>
                          <button
                            className="link-button"
                            type="button"
                            aria-haspopup="dialog"
                            onClick={(e) => choose(a, e.currentTarget)}
                          >
                            {a.full_name}
                          </button>
                        </td>
                        <td>{a.case_title}</td>
                        <td>{a.practitioner_name}</td>
                        <td>{a.location}</td>
                        <td>
                          <State item={a} />
                        </td>
                        <td>
                          <BookingTagChip tag={a.tag} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!visible.length && (
                  <div className="calendar-empty">
                    <h3>No appointments in this period</h3>
                    <p>Choose another date or reset your filters.</p>
                  </div>
                )}
              </div>
            ) : view === "Month" ? (
              <div className="month-scroll">
                <div className="month-weekdays">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                    (d) => (
                      <strong key={d}>{d}</strong>
                    ),
                  )}
                </div>
                <div className="month-grid">
                  {days.map((d) => {
                    const records = matching.filter((a) => dayOf(a) === d);
                    return (
                      <div
                        className={`month-day ${d.slice(0, 7) !== day.slice(0, 7) ? "outside" : ""} ${d === calendarDay(undefined, timezone) ? "today" : ""}`}
                        key={d}
                      >
                        <button
                          type="button"
                          className="month-day-number"
                          aria-label={`View ${dateLabel(d)}`}
                          onClick={() => {
                            setChosenDay(d);
                            setView("Day");
                          }}
                        >
                          {Number(d.slice(-2))}
                        </button>
                        {records.slice(0, 3).map((a) => (
                          <button
                            key={a.id}
                            type="button"
                            className={`month-booking ${tone(a.case_title)} ${a.id === selected?.id ? "selected" : ""}`}
                            aria-haspopup="dialog"
                            onClick={(e) => choose(a, e.currentTarget)}
                            title={`${a.full_name} · ${timeRange(a, timezone)} · ${stateLabel(a.state)} · ${tagLabel(a.tag)}`}
                          >
                            <time>{clock(a.start_utc, timezone)}</time>
                            <span>{a.full_name}</span>
                            <BookingTagChip tag={a.tag} />
                          </button>
                        ))}
                        {records.length > 3 && (
                          <button
                            className="month-more"
                            type="button"
                            onClick={() => {
                              setChosenDay(d);
                              setView("Day");
                            }}
                          >
                            +{records.length - 3} more
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : view === "Capacity" ? (
              <div className="capacity-view">
                <p>
                  Booked time against the clinic’s configured working hours.
                  Open calendar space does not guarantee Stride availability.
                </p>
                {practitionerOptions
                  .filter((p) => !picked.length || picked.includes(p.id))
                  .map((p) => {
                    const records = visible.filter(
                      (a) => a.practitioner_id === p.id && occupiesTime(a),
                    );
                    const booked = records.reduce(
                      (sum, a) => sum + (a.duration_minutes ?? 0) / 60,
                      0,
                    );
                    const total = periodDays.reduce(
                      (sum, d) => sum + workingHours(d, data.business_hours),
                      0,
                    );
                    return (
                      <div className="capacity-row" key={p.id}>
                        <div>
                          <strong>{p.name}</strong>
                          <small>
                            {[
                              ...new Set(
                                resources
                                  .filter((r) => r.id === p.id)
                                  .map((r) => r.location),
                              ),
                            ].join(" · ")}
                          </small>
                        </div>
                        <meter
                          min="0"
                          max={total || 1}
                          value={Math.min(booked, total)}
                          aria-label={`${p.name} booked hours`}
                        />
                        <span>
                          {hoursLabel(booked)} / {hoursLabel(total)} hours
                          booked
                        </span>
                        <b>
                          {total
                            ? `${Math.round((booked / total) * 100)}%`
                            : "—"}
                        </b>
                      </div>
                    );
                  })}
                {!practitionerOptions.length && (
                  <div className="calendar-empty">
                    <h3>No practitioners in this location</h3>
                    <p>
                      Practitioners appear from the connected schedule and
                      booking configuration.
                    </p>
                  </div>
                )}
              </div>
            ) : !columns.length ? (
              <div className="calendar-empty">
                <CalendarSymbol />
                <h3>No schedule for this location</h3>
                <p>
                  Choose All Locations or another day to see connected
                  appointments.
                </p>
              </div>
            ) : (
              <div className="schedule-grid-scroll">
                <div
                  className={`schedule-grid ${view === "Week" ? "week-grid" : ""}`}
                  style={
                    {
                      "--columns": columns.length,
                      "--hour-height": `${HOUR_HEIGHT}px`,
                      minWidth:
                        66 + columns.length * (view === "Week" ? 135 : 190),
                    } as CSSProperties
                  }
                >
                  <div className="schedule-grid-header">
                    <div />
                    <div className="schedule-column-headings">
                      {columns.map((c) => (
                        <div key={c.key}>
                          <strong>{c.title}</strong>
                          <small>{c.subtitle}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="schedule-grid-body">
                    <div className="schedule-hour-labels">
                      {hours.map((h) => (
                        <time key={h}>
                          {h === 0
                            ? "12 AM"
                            : h < 12
                              ? `${h} AM`
                              : h === 12
                                ? "12 PM"
                                : `${h - 12} PM`}
                        </time>
                      ))}
                    </div>
                    <div className="schedule-columns">
                      {columns.map((c) => (
                        <div className="schedule-column" key={c.key}>
                          {c.open.map(([start, end]) => (
                            <span
                              className="schedule-open"
                              key={start}
                              aria-hidden="true"
                              style={{
                                top: toY(Math.max(start, hourStart * 60)),
                                height:
                                  toY(Math.min(end, hourEnd * 60)) -
                                  toY(Math.max(start, hourStart * 60)),
                              }}
                            />
                          ))}
                          {halfHours.map((m) => {
                            const overlaps = (a: Appointment) =>
                              minutesOf(a) < m + 30 &&
                              minutesOf(a) + (a.duration_minutes ?? 30) > m;
                            const occupied = appointments.some(
                              (a) =>
                                dayOf(a) === c.day &&
                                (c.practitioner
                                  ? a.practitioner_id === c.practitioner
                                  : practitionerIds.includes(
                                      a.practitioner_id,
                                    )) &&
                                occupiesTime(a) &&
                                overlaps(a),
                            );
                            return (
                              <div
                                className={`schedule-hour-cell half ${m % 60 ? "" : "hour"}`}
                                key={m}
                              >
                                {!occupied && data.booking_enabled && (
                                  <button
                                    className="schedule-open-slot"
                                    type="button"
                                    tabIndex={-1}
                                    aria-label={`Find availability for ${c.title} on ${dateLabel(c.day)}`}
                                    onClick={() =>
                                      setDraft({
                                        day: c.day,
                                        practitioner: c.practitioner,
                                      })
                                    }
                                  >
                                    ＋
                                  </button>
                                )}
                                {occupied && !c.records.some(overlaps) && (
                                  <small className="schedule-filtered">
                                    Booked · filtered
                                  </small>
                                )}
                              </div>
                            );
                          })}
                          {(() => {
                            const now = nowMinutes(c.day, timezone);
                            return now !== null &&
                              now >= hourStart * 60 &&
                              now <= hourEnd * 60 ? (
                              <span
                                className={`schedule-now ${firstColumnOfDay.has(c.key) ? "with-dot" : ""}`}
                                style={{ top: toY(now) }}
                                aria-hidden="true"
                              />
                            ) : null;
                          })()}
                          {layoutAppointments(c.records).map(
                            ({ item: a, lane, lanes }) => (
                              <div
                                className="schedule-booking-position"
                                key={a.id}
                                style={{
                                  top: toY(minutesOf(a)) + 1,
                                  height: Math.max(
                                    28,
                                    ((a.duration_minutes ?? 30) / 60) *
                                      HOUR_HEIGHT -
                                      2,
                                  ),
                                  left: `calc(${(lane / lanes) * 100}% + 3px)`,
                                  width: `calc(${100 / lanes}% - 6px)`,
                                }}
                              >
                                <BookingBlock
                                  item={a}
                                  selected={a.id === selected?.id}
                                  timezone={timezone}
                                  compact={
                                    view === "Week" ||
                                    (a.duration_minutes ?? 30) < 50
                                  }
                                  tiny={lanes > (view === "Week" ? 1 : 2)}
                                  onChoose={choose}
                                />
                              </div>
                            ),
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
      <footer className="calendar-source">
        <span>Appointments from Stride · Linked to Google Sheets leads</span>
        <span>
          {data?.last_import_at
            ? `Last Stride import ${clock(data.last_import_at, timezone)} ${calendarZoneLabel(timezone)}`
            : "No Stride import recorded"}
          {loading && data ? " · Refreshing…" : ""}
        </span>
      </footer>
      {selected && card && (
        <VisitCard
          key={selected.id}
          item={selected}
          anchor={card.anchor}
          lead={snapshot.leads.find((l) => l.id === selected.lead_id)}
          timezone={timezone}
          onClose={closeCard}
        />
      )}
      {draft && (
        <AppointmentEditor
          draft={draft}
          leads={snapshot.leads}
          initialLeadId={initialLeadId ?? search.get("lead")}
          bookingEnabled={data?.booking_enabled ?? false}
          action={action}
          onClose={() => setDraft(null)}
          onSaved={(d) => {
            setChosenDay(d);
            setCaseTitle("all");
            setPicked([]);
            setStatus("all");
            setTag("all");
            setReload((n) => n + 1);
            setDraft(null);
          }}
        />
      )}
    </div>
  );
}

type Slot = {
  id: number;
  start_utc: string;
  end_utc: string;
  display_name: string;
  stride_user_id: number;
};
type SlotResponse = {
  slots: Slot[];
  location: string;
  case_title: string;
  timezone: string;
  duration_minutes: number;
  cache_fresh: boolean;
};
function AppointmentEditor({
  draft,
  leads,
  initialLeadId,
  bookingEnabled,
  action,
  onClose,
  onSaved,
}: {
  draft: { day: string; practitioner?: string };
  leads: Snapshot["leads"];
  initialLeadId: string | null;
  bookingEnabled: boolean;
  action: Action;
  onClose: () => void;
  onSaved: (day: string, id?: string) => void;
}) {
  const eligible = leads.filter(
    (l) =>
      !l.number_block &&
      !l.needs_review &&
      !["booked", "do_not_contact"].includes(l.status),
  );
  const [leadId, setLeadId] = useState(
    eligible.some((l) => l.id === initialLeadId) ? initialLeadId! : "",
  );
  const [start, setStart] = useState(draft.day);
  const [loadedSlots, setLoadedSlots] = useState<{
    key: string;
    data: SlotResponse;
  } | null>(null);
  const [slotId, setSlotId] = useState("");
  const chosenPractitioner = draft.practitioner;
  const queryKey = `${leadId}:${start}:${chosenPractitioner ?? ""}`;
  const slots = loadedSlots?.key === queryKey ? loadedSlots.data : null;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const loading =
    bookingEnabled && Boolean(leadId && start) && !slots && !error;
  const changeLead = (id: string) => {
    setLeadId(id);
    setSlotId("");
    setError("");
  };
  const changeStart = (day: string) => {
    setStart(day);
    setSlotId("");
    setError("");
  };
  const canClose = () => {
    if (!saving) onClose();
  };
  useEffect(() => {
    if (!leadId || !bookingEnabled || !start) return;
    const controller = new AbortController();
    dashboardFetch(
      `/api/dashboard/appointment-slots?lead_id=${encodeURIComponent(leadId)}&start=${start}&days=7${chosenPractitioner && /^\d+$/.test(chosenPractitioner) ? `&practitioner_id=${chosenPractitioner}` : ""}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const result = (await response.json()) as SlotResponse & {
          detail?: string;
        };
        if (!response.ok)
          throw new Error(
            clientErrorMessage(
              result.detail,
              "Availability could not be loaded for this lead.",
            ),
          );
        return result;
      })
      .then((result) => {
        if (!controller.signal.aborted)
          setLoadedSlots({ key: queryKey, data: result });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "Availability could not be loaded.",
          );
      });
    return () => controller.abort();
  }, [leadId, start, bookingEnabled, chosenPractitioner, queryKey]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const saved = await action(
      "appointments",
      "POST",
      { lead_id: leadId, slot_id: Number(slotId) },
      "Appointment confirmed in Stride.",
      setError,
    );
    setSaving(false);
    if (saved)
      onSaved(
        String(saved.start_day ?? start),
        saved.id ? String(saved.id) : undefined,
      );
  }
  const filteredSlots = (slots?.slots ?? []).filter(
    (s) =>
      !draft.practitioner || String(s.stride_user_id) === draft.practitioner,
  );
  return (
    <ModalShell
      className="appointment-editor"
      labelId="appointment-editor-title"
      onClose={canClose}
    >
      <header>
        <div>
          <h2 id="appointment-editor-title">New appointment</h2>
          <p>Choose a lead and an available Stride appointment.</p>
        </div>
        <button
          className="close-button"
          type="button"
          disabled={saving}
          aria-label="Close new appointment"
          onClick={canClose}
        >
          ×
        </button>
      </header>
      <form onSubmit={submit}>
        {!bookingEnabled && (
          <p className="calendar-notice" role="status">
            New bookings are switched off for this practice. Existing
            appointments remain available in the calendar.
          </p>
        )}
        <fieldset disabled={saving || !bookingEnabled}>
          <label className="field-label">
            Lead
            <SelectMenu
              ariaLabel="Lead to book"
              value={leadId}
              onChange={changeLead}
              options={[
                { value: "", label: "Choose a lead" },
                ...eligible.map((l) => ({
                  value: l.id,
                  label: `${l.full_name} · ${l.location ?? "No location"}`,
                })),
              ]}
            />
          </label>
          <label className="field-label">
            Search from
            <input
              type="date"
              value={start}
              required
              onChange={(e) => changeStart(e.target.value)}
            />
          </label>
          {slots && (
            <div className="booking-context">
              <strong>{slots.case_title}</strong>
              <span>
                {slots.location} · {slots.duration_minutes} minutes ·{" "}
                {calendarZoneLabel(slots.timezone)}
              </span>
            </div>
          )}
          {loading ? (
            <p role="status" className="appointment-note">
              Checking availability…
            </p>
          ) : (
            slots && (
              <fieldset className="appointment-slot-picker">
                <legend>Available appointments</legend>
                {filteredSlots.length ? (
                  filteredSlots.map((s) => (
                    <label
                      className={slotId === String(s.id) ? "selected" : ""}
                      key={s.id}
                    >
                      <input
                        type="radio"
                        name="slot"
                        value={s.id}
                        checked={slotId === String(s.id)}
                        onChange={() => setSlotId(String(s.id))}
                        required
                      />
                      <span>
                        <strong>
                          {dateLabel(calendarDay(s.start_utc, slots.timezone), {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}{" "}
                          · {clock(s.start_utc, slots.timezone)}
                        </strong>
                        <small>{s.display_name}</small>
                      </span>
                    </label>
                  ))
                ) : (
                  <p>
                    No available appointments in the next seven days. Choose
                    another date.
                  </p>
                )}
              </fieldset>
            )
          )}
        </fieldset>
        {slots && !slots.cache_fresh && (
          <p className="appointment-note">
            Availability was last updated earlier. Stride will recheck your
            selected time before booking.
          </p>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button
            className="secondary"
            type="button"
            disabled={saving}
            onClick={canClose}
          >
            Cancel
          </button>
          <button
            className="primary"
            type="submit"
            disabled={saving || loading || !slotId || !bookingEnabled}
          >
            {saving ? "Confirming in Stride…" : "Book appointment"}
          </button>
        </footer>
      </form>
    </ModalShell>
  );
}
