import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calendarDay,
  calendarDays,
  isCalendarDay,
  moveCalendarDate,
  occupiesTime,
  layoutAppointments,
  appointmentSummary,
  bookedByLabel,
  callMoment,
  filterAppointments,
  stateLabel,
  statusBucket,
  tagLabel,
  workingHours,
  nowMinutes,
  openIntervals,
  periodLabels,
  bookedBySource,
  visitMark,
  visitStatus,
  type Appointment,
  type OpenSlotDay,
} from "./appointment-data.ts";

const appointment = (id: string, start: string, end: string) =>
  ({
    id,
    start_utc: start,
    end_utc: end,
    duration_minutes: 60,
    state: "scheduled",
  }) as Appointment;

test("calendar dates use clinic timezone across DST rather than the browser timezone", () => {
  assert.equal(calendarDay("2026-10-14T01:00:00Z"), "2026-10-13");
  assert.equal(calendarDay("2026-11-01T08:30:00Z"), "2026-11-01");
  assert.equal(calendarDay("2026-11-01T09:30:00Z"), "2026-11-01");
  assert.equal(
    calendarDay("2026-10-14T01:00:00Z", "Asia/Calcutta"),
    "2026-10-14",
  );
});
test("weeks start Monday and months include six padded weeks without month-end overflow", () => {
  assert.equal(isCalendarDay("2026-10-13"), true);
  assert.equal(isCalendarDay("2026-02-31"), false);
  assert.equal(isCalendarDay("0000-01-01"), false);
  assert.equal(calendarDays("2026-10-18", "Week")[0], "2026-10-12");
  assert.equal(calendarDays("2026-10-18", "Month").length, 42);
  assert.equal(moveCalendarDate("2026-01-31", "Month", 1), "2026-02-01");
});
test("cancelled and missed appointments do not inflate occupancy", () => {
  for (const state of ["cancelled", "late_cancel", "no_show", "failed"])
    assert.equal(occupiesTime({ state } as Appointment), false);
  assert.equal(occupiesTime({ state: "scheduled" } as Appointment), true);
  const hours = { "1": { open: "08:30", close: "16:30" }, "7": null };
  assert.equal(workingHours("2026-10-12", hours), 8);
  assert.equal(workingHours("2026-10-18", hours), 0);
});
test("overlapping imported appointments get lanes and adjacent bookings regain full width", () => {
  const items = [
    appointment("a", "2026-10-13T16:00Z", "2026-10-13T17:00Z"),
    appointment("b", "2026-10-13T16:30Z", "2026-10-13T17:30Z"),
    appointment("c", "2026-10-13T17:30Z", "2026-10-13T18:30Z"),
  ];
  assert.deepEqual(
    layoutAppointments(items).map((e) => [e.item.id, e.lane, e.lanes]),
    [
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 1],
    ],
  );
});

const booking = (over: Partial<Appointment>) =>
  ({
    id: Math.random().toString(),
    start_utc: "2026-10-27T16:00:00Z",
    end_utc: null,
    duration_minutes: 60,
    state: "scheduled",
    location: "Laguna Niguel",
    case_title: "Physical Therapy",
    practitioner_id: "5980",
    practitioner_name: "Joe Smith",
    tag: "elliot",
    ...over,
  }) as Appointment;

test("Stride states fall into the four buckets staff count", () => {
  assert.equal(statusBucket("scheduled"), "booked");
  assert.equal(statusBucket("unknown"), "booked");
  assert.equal(statusBucket("completed"), "completed");
  assert.equal(statusBucket("late_cancel"), "cancelled");
  assert.equal(statusBucket("cancelled"), "cancelled");
  assert.equal(statusBucket("no_show"), "no_show");
  assert.equal(statusBucket("rescheduled"), "other");
  assert.equal(stateLabel("scheduled"), "Booked");
  assert.equal(stateLabel("late_cancel"), "Late cancel");
  assert.equal(stateLabel("checked out"), "Checked out");
});
test("tags, who booked and the call moment read in plain words", () => {
  assert.equal(tagLabel("elliot"), "Elliot");
  assert.equal(tagLabel("stride_only"), "Stride only");
  assert.equal(bookedByLabel("voice_agent"), "by Elliot on a call");
  assert.equal(bookedByLabel("stride"), "in Stride (front desk or text link)");
  assert.equal(callMoment(84), "1:24");
  assert.equal(callMoment(5), "0:05");
  assert.equal(callMoment(null), "");
});
test("filters combine and the summary counts what the filters show", () => {
  const items = [
    booking({ tag: "elliot" }),
    booking({ tag: "elliot", state: "late_cancel" }),
    booking({ tag: "sheet_lead", location: "Dana Point", practitioner_id: "5981", practitioner_name: "Thao Nguyen" }),
    booking({ tag: "stride_only", state: "completed", case_title: "Physical Therapy - Pelvic" }),
    booking({ tag: "stride_only", state: "no_show" }),
  ];
  assert.equal(filterAppointments(items, { tag: "elliot" }).length, 2);
  assert.equal(filterAppointments(items, { status: "cancelled" }).length, 1);
  assert.equal(filterAppointments(items, { location: "Laguna Niguel", tag: "stride_only" }).length, 2);
  assert.equal(filterAppointments(items, { location: "All Locations", status: "all", tag: "all" }).length, 5);
  assert.equal(filterAppointments(items, { practitioner: "5981" }).length, 1);
  assert.equal(filterAppointments(items, { practitioners: ["5981"] }).length, 1);
  assert.equal(filterAppointments(items, { practitioners: ["5980", "5981"] }).length, 5);
  assert.equal(filterAppointments(items, { practitioners: [] }).length, 5);
  const summary = appointmentSummary(items);
  assert.equal(summary.total, 5);
  assert.deepEqual(summary.status, { booked: 2, completed: 1, cancelled: 1, no_show: 1, other: 0 });
  assert.deepEqual(summary.tags, { elliot: 2, sheet_lead: 1, stride_only: 2 });
  assert.deepEqual(summary.byLocation[0], { label: "Laguna Niguel", count: 4 });
  assert.deepEqual(summary.byPractitioner.map((r) => r.label), ["Joe Smith", "Thao Nguyen"]);
  assert.equal(summary.byCase.length, 2);
});

const openDay = (id: string, date: string, slots: [string, string][]): OpenSlotDay => ({
  date,
  practitioner_id: id,
  practitioner_name: `P${id}`,
  slots: slots.map(([start, end]) => ({ start_local: `${date}T${start}`, end_local: end.includes("T") ? end : `${date}T${end}` })),
});
test("open time is the union of a column's cached open slots, nothing estimated", () => {
  const slots = [
    // Same start, two visit lengths; a touching slot; a gap; a slot past midnight.
    openDay("5980", "2026-10-27", [["09:00", "09:30"], ["09:00", "10:00"], ["10:00", "11:00"], ["13:00", "14:00"], ["23:30", "2026-10-28T00:00"]]),
    openDay("5981", "2026-10-27", [["13:30", "15:00"]]),
    openDay("5981", "2026-10-28", [["08:00", "09:00"]]),
  ];
  assert.deepEqual(openIntervals(slots, "2026-10-27", ["5980"]), [[540, 660], [780, 840], [1410, 1440]]);
  // Week column: every practitioner shown counts.
  assert.deepEqual(openIntervals(slots, "2026-10-27", ["5980", "5981"]), [[540, 660], [780, 900], [1410, 1440]]);
  assert.deepEqual(openIntervals(slots, "2026-10-28", ["5980"]), []);
  assert.deepEqual(openIntervals(undefined, "2026-10-27", ["5980"]), []);
  assert.deepEqual(openIntervals(slots, "2026-10-27", []), []);
});
test("a block's status mark follows Stride's status; cancelled ones are struck", () => {
  assert.deepEqual(
    ["confirmed", "unmarked", "checked_in", "no_show"].map((s) => visitMark({ stride_status: s, state: "scheduled" }).mark),
    ["✓", "○", "●", "No show"],
  );
  assert.equal(visitMark({ stride_status: "cancelled", state: "cancelled" }).struck, true);
  assert.equal(visitMark({ stride_status: "late_cancel", state: "late_cancel" }).struck, true);
  assert.equal(visitMark({ stride_status: "no_show", state: "no_show" }).struck, false);
  // Ours, not in Stride yet: no Stride mark (the block says WAITING instead).
  assert.deepEqual(visitMark({ stride_status: null, state: "scheduled" }), { mark: "", label: "", status: "", struck: false });
  assert.equal(visitMark({ stride_status: "rescheduled", state: "scheduled" }).label, "Rescheduled");
});
test("the now line sits on today only, in the calendar timezone", () => {
  const now = new Date("2026-10-27T17:45:00Z"); // 10:45 AM Pacific
  assert.equal(nowMinutes("2026-10-27", "America/Los_Angeles", now), 645);
  assert.equal(nowMinutes("2026-10-28", "America/Los_Angeles", now), null);
  assert.equal(nowMinutes("2026-10-27", "America/New_York", now), 825);
});
test("visits at the same time sit side by side", () => {
  const items = [
    appointment("a", "2026-10-13T16:00Z", "2026-10-13T16:30Z"),
    appointment("b", "2026-10-13T16:00Z", "2026-10-13T17:00Z"),
    appointment("c", "2026-10-13T16:00Z", "2026-10-13T16:30Z"),
  ];
  assert.deepEqual(
    layoutAppointments(items).map((e) => [e.item.id, e.lane, e.lanes]),
    [["a", 0, 3], ["b", 1, 3], ["c", 2, 3]],
  );
});
test("with a location only that clinic's open slots count; without one every clinic's", () => {
  const at = (location: string, start: string, end: string): OpenSlotDay => ({
    date: "2026-10-27", practitioner_id: "5980", practitioner_name: "Alice Ames", location,
    slots: [{ start_local: `2026-10-27T${start}`, end_local: `2026-10-27T${end}` }],
  });
  const slots = [at("Laguna Niguel", "09:00", "10:00"), at("Dana Point", "09:00", "10:00"), at("Dana Point", "14:00", "15:00")];
  assert.deepEqual(openIntervals(slots, "2026-10-27", ["5980"]), [[540, 600], [840, 900]]);
  assert.deepEqual(openIntervals(slots, "2026-10-27", ["5980"], "Laguna Niguel"), [[540, 600]]);
  assert.deepEqual(openIntervals(slots, "2026-10-27", ["5980"], "San Clemente"), []);
  // An older backend sends no location: its slots still count.
  const old = [{ ...at("x", "11:00", "12:00"), location: undefined }];
  assert.deepEqual(openIntervals(old, "2026-10-27", ["5980"], "Laguna Niguel"), [[660, 720]]);
});
test("the visit card's status line: waiting first, then Stride's own words", () => {
  assert.deepEqual(visitStatus({ approval: "waiting", stride_status: null, state: "scheduled" }),
    { label: "Waiting for approval in Stride", tone: "waiting" });
  assert.deepEqual(
    ["confirmed", "unmarked", "checked_in", "cancelled", "late_cancel", "no_show"].map(
      (s) => visitStatus({ approval: "in_stride", stride_status: s, state: "scheduled" }).label),
    ["Confirmed", "Not marked yet", "Checked in", "Cancelled", "Late cancel", "No show"],
  );
  assert.equal(visitStatus({ approval: "in_stride", stride_status: "no_show", state: "no_show" }).tone, "off");
  assert.equal(visitStatus({ approval: "in_stride", stride_status: "confirmed", state: "scheduled" }).tone, "ok");
  // A word Stride adds later is shown, never hidden.
  assert.equal(visitStatus({ approval: "in_stride", stride_status: "rescheduled", state: "rescheduled" }).label, "Rescheduled");
});
test("booked by: Elliot, Google Sheet or Stride front desk", () => {
  assert.deepEqual(bookedBySource({ source: "elliot", tag: "elliot" }), { source: "elliot", label: "Elliot" });
  assert.equal(bookedBySource({ source: "sheet", tag: "sheet_lead" }).label, "Google Sheet");
  assert.equal(bookedBySource({ source: "stride", tag: "stride_only" }).label, "Stride front desk");
  // Older backend: source was "Stride" / "Booking service"; the tag decides.
  assert.equal(bookedBySource({ source: "Booking service", tag: "elliot" }).label, "Elliot");
});
test("the heading has a short form for a tight top bar", () => {
  assert.deepEqual(periodLabels("Day", "2026-10-27", ["2026-10-27"]),
    { long: "Tuesday, October 27, 2026", short: "Tue, Oct 27" });
  const week = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];
  assert.deepEqual(periodLabels("Week", "2026-10-27", week), { long: "Oct 26 – Nov 1, 2026", short: "Oct 26 – Nov 1" });
  assert.deepEqual(periodLabels("Month", "2026-10-27", week), { long: "October 2026", short: "Oct 2026" });
});
