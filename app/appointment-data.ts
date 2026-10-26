import { CLINIC_TZ } from "./display.ts";

export const HOUR_HEIGHT = 64;
const calendarFormatters = new Map<string, Intl.DateTimeFormat>();
export type CalendarView = "Day" | "Week" | "Month" | "Locations" | "Capacity";
export type Appointment = {
  id: string;
  lead_id: string | null;
  full_name: string;
  start_utc: string;
  end_utc: string | null;
  duration_minutes: number | null;
  practitioner_id: string;
  practitioner_name: string;
  location: string;
  case_title: string;
  type: string;
  state: string;
  source: string;
  lead_source: string | null;
  needs_staff_review: boolean;
  stride_appointment_id: number | null;
  tag: BookingTag;
  booked_by: BookedBy;
  booked_at: string | null;
  call_log_id: number | null;
  call_offset_seconds: number | null;
  // Calendar fields (backend 2026-10-26). Optional so an older backend still renders.
  approval?: Approval;
  stride_status?: string | null;
  visit_type?: string;
  visit_kind?: VisitKind;
  patient_name?: string;
  clinician?: { id: string; name: string; role: string | null };
  location_id?: number | null;
};
// waiting: we booked it, Stride's export has not shown it yet (front desk has to approve it).
export type Approval = "waiting" | "in_stride" | "not_in_stride";
export type VisitKind = "first_visit" | "follow_up" | "other";
export const VISIT_KINDS: { value: VisitKind; label: string }[] = [
  { value: "first_visit", label: "First visit" },
  { value: "follow_up", label: "Follow-up" },
  { value: "other", label: "Other" },
];
// Cached open Stride times for one clinician on one calendar-local day ("YYYY-MM-DDTHH:MM").
export type OpenSlotDay = {
  date: string;
  practitioner_id: string;
  practitioner_name: string;
  slots: { start_local: string; end_local: string }[];
};
// Who a booking belongs to. Elliot: our voice agent booked it on a call. Sheet lead: one
// of our leads, booked another way (front desk, text link, staff). Stride only: a Stride
// patient who never was our lead (never on the board).
export type BookingTag = "elliot" | "sheet_lead" | "stride_only";
export type BookedBy = "voice_agent" | "staff" | "stride" | "booking_service";
export type StatusBucket = "booked" | "completed" | "cancelled" | "no_show";
export const BOOKING_TAGS: { value: BookingTag; label: string; hint: string }[] = [
  { value: "elliot", label: "Elliot", hint: "booked by Elliot on a call" },
  { value: "sheet_lead", label: "Sheet lead", hint: "our lead, booked another way" },
  { value: "stride_only", label: "Stride only", hint: "never in our Sheet" },
];
export const STATUS_BUCKETS: { value: StatusBucket; label: string }[] = [
  { value: "booked", label: "Booked" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled / late" },
  { value: "no_show", label: "No show" },
];
export function tagLabel(tag: BookingTag | null | undefined) {
  return BOOKING_TAGS.find((t) => t.value === tag)?.label ?? "Sheet lead";
}
// Same buckets as the backend's appointment_views.status_bucket.
export function statusBucket(state: string): StatusBucket | "other" {
  if (["booking", "scheduled", "unknown"].includes(state)) return "booked";
  if (state === "completed") return "completed";
  if (state === "cancelled" || state === "late_cancel") return "cancelled";
  if (state === "no_show") return "no_show";
  return "other";
}
export function stateLabel(state: string) {
  return (
    {
      booking: "Booking",
      scheduled: "Booked",
      unknown: "Booked",
      completed: "Completed",
      cancelled: "Cancelled",
      late_cancel: "Late cancel",
      no_show: "No show",
      rescheduled: "Rescheduled",
    }[state] ?? state.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}
// "Booked Oct 14, 11:42 AM by Elliot on a call" and friends.
export function bookedByLabel(by: BookedBy) {
  return {
    voice_agent: "by Elliot on a call",
    staff: "by staff from the calendar",
    stride: "in Stride (front desk or text link)",
    booking_service: "through our booking service",
  }[by];
}
export function callMoment(seconds: number | null) {
  if (seconds === null || seconds === undefined) return "";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
export type AppointmentFilters = {
  location?: string;
  caseTitle?: string;
  practitioner?: string;
  // Several practitioners (checkboxes); empty or missing = everyone.
  practitioners?: string[];
  status?: StatusBucket | "all";
  tag?: BookingTag | "all";
};
export function filterAppointments(items: Appointment[], f: AppointmentFilters) {
  return items.filter(
    (a) =>
      (!f.location || f.location === "All Locations" || a.location === f.location) &&
      (!f.caseTitle || f.caseTitle === "all" || a.case_title === f.caseTitle) &&
      (!f.practitioner || f.practitioner === "all" || a.practitioner_id === f.practitioner) &&
      (!f.practitioners?.length || f.practitioners.includes(a.practitioner_id)) &&
      (!f.status || f.status === "all" || statusBucket(a.state) === f.status) &&
      (!f.tag || f.tag === "all" || a.tag === f.tag),
  );
}
const countBy = (items: Appointment[], key: (a: Appointment) => string) => {
  const counts = new Map<string, number>();
  items.forEach((a) => counts.set(key(a), (counts.get(key(a)) ?? 0) + 1));
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
};
// The counts the calendar summary line and the analytics section show.
export function appointmentSummary(items: Appointment[]) {
  const status = { booked: 0, completed: 0, cancelled: 0, no_show: 0, other: 0 };
  items.forEach((a) => {
    status[statusBucket(a.state)] += 1;
  });
  const tags = Object.fromEntries(BOOKING_TAGS.map((t) => [t.value, 0])) as Record<BookingTag, number>;
  items.forEach((a) => {
    if (a.tag in tags) tags[a.tag] += 1;
  });
  return {
    total: items.length,
    status,
    tags,
    byLocation: countBy(items, (a) => a.location),
    byPractitioner: countBy(items, (a) => a.practitioner_name),
    byCase: countBy(items, (a) => a.case_title),
  };
}
export type Practitioner = { id: string; name: string; location: string };
export type CalendarData = {
  appointments: Appointment[];
  practitioners: Practitioner[];
  timezone: string;
  business_hours: Record<string, { open: string; close: string } | null>;
  booking_enabled: boolean;
  stride_import_enabled: boolean;
  last_import_at: string | null;
  truncated: boolean;
  generated_at: string;
  open_slots?: OpenSlotDay[];
};

export function calendarWallTime(value: string, timezone = CLINIC_TZ) {
  if (!value || Number.isNaN(Date.parse(value))) return "";
  let formatter = calendarFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    calendarFormatters.set(timezone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(value)).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function calendarDay(
  value = new Date().toISOString(),
  timezone = CLINIC_TZ,
) {
  return calendarWallTime(value, timezone).slice(0, 10);
}
export function shiftCalendarDay(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isCalendarDay(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(day.valueOf()) &&
    day.getUTCFullYear() > 0 &&
    day.toISOString().slice(0, 10) === value
  );
}
export function calendarDays(day: string, view: CalendarView) {
  if (view !== "Week" && view !== "Month") return [day];
  const anchor = view === "Month" ? `${day.slice(0, 7)}-01` : day;
  const weekday = new Date(`${anchor}T12:00:00Z`).getUTCDay();
  const start = shiftCalendarDay(anchor, -((weekday + 6) % 7));
  return Array.from({ length: view === "Month" ? 42 : 7 }, (_, i) =>
    shiftCalendarDay(start, i),
  );
}
export function moveCalendarDate(
  day: string,
  view: CalendarView,
  direction: number,
) {
  if (view !== "Month")
    return shiftCalendarDay(day, direction * (view === "Week" ? 7 : 1));
  const date = new Date(`${day.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + direction);
  return date.toISOString().slice(0, 10);
}
export function appointmentMinutes(item: Appointment, timezone = CLINIC_TZ) {
  const wall = calendarWallTime(item.start_utc, timezone);
  return Number(wall.slice(11, 13)) * 60 + Number(wall.slice(14, 16));
}
export function occupiesTime(item: Pick<Appointment, "state">) {
  return !/cancel|no[ _-]?show|removed|failed/i.test(item.state);
}
export function workingHours(
  day: string,
  hours: CalendarData["business_hours"],
) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
  const span = hours[String(weekday)];
  if (!span) return 0;
  const minutes = (clock: string) =>
    Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
  return Math.max(0, minutes(span.close) - minutes(span.open)) / 60;
}
// Imported schedules can overlap. Split simultaneous events into lanes instead of hiding one.
export function layoutAppointments(items: Appointment[]) {
  const sorted = [...items].sort(
    (a, b) => Date.parse(a.start_utc) - Date.parse(b.start_utc),
  );
  const result: { item: Appointment; lane: number; lanes: number }[] = [];
  let cluster: typeof result = [],
    ends: number[] = [],
    clusterEnd = 0;
  function finish() {
    cluster.forEach((entry) => {
      entry.lanes = ends.length;
      result.push(entry);
    });
    cluster = [];
    ends = [];
    clusterEnd = 0;
  }
  for (const item of sorted) {
    const start = Date.parse(item.start_utc);
    const end = item.end_utc
      ? Date.parse(item.end_utc)
      : start + (item.duration_minutes ?? 30) * 60_000;
    if (start >= clusterEnd) finish();
    let lane = ends.findIndex((endTime) => endTime <= start);
    if (lane === -1) lane = ends.length;
    ends[lane] = Math.max(start + 60_000, end);
    clusterEnd = Math.max(clusterEnd, ends[lane]);
    cluster.push({ item, lane, lanes: 1 });
  }
  finish();
  return result;
}

// Minutes after midnight of `day` for a calendar-local "YYYY-MM-DDTHH:MM", clamped to the day.
function localMinutes(value: string, day: string) {
  const date = value.slice(0, 10);
  if (date < day) return 0;
  if (date > day) return 24 * 60;
  return Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));
}
// Open time for the given clinicians on one day: the union of their cached open slots as
// [start, end) minutes, merged where they touch or overlap. Nothing else counts as open.
export function openIntervals(
  openSlots: OpenSlotDay[] | undefined,
  day: string,
  practitionerIds: string[],
) {
  const spans = (openSlots ?? [])
    .filter((d) => d.date === day && practitionerIds.includes(d.practitioner_id))
    .flatMap((d) =>
      d.slots.map((s) => [
        localMinutes(s.start_local, day),
        localMinutes(s.end_local, day),
      ]),
    )
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [start, end] of spans) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
// What a calendar block shows top-right for Stride's status. Our own visit Stride has not
// shown yet has no Stride status (it carries the WAITING tag instead).
export function visitMark(item: Pick<Appointment, "stride_status" | "state">) {
  const status = item.stride_status ?? "";
  const marks: Record<string, { mark: string; label: string }> = {
    confirmed: { mark: "✓", label: "Confirmed" },
    unmarked: { mark: "○", label: "Unmarked" },
    checked_in: { mark: "●", label: "Checked in" },
    no_show: { mark: "No show", label: "No show" },
    cancelled: { mark: "", label: "Cancelled" },
    late_cancel: { mark: "", label: "Late cancel" },
  };
  return {
    ...(marks[status] ?? { mark: "", label: status ? stateLabel(status) : "" }),
    status,
    struck: statusBucket(item.state) === "cancelled",
  };
}
// Calendar-local minutes now, or null when `day` is not today in the calendar timezone.
export function nowMinutes(day: string, timezone = CLINIC_TZ, now = new Date()) {
  const wall = calendarWallTime(now.toISOString(), timezone);
  if (wall.slice(0, 10) !== day) return null;
  return Number(wall.slice(11, 13)) * 60 + Number(wall.slice(14, 16));
}
