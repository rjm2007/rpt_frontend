# Connected appointment calendar

The global Appointments page and each lead's Appointments tab implement the local `calendar.md`
guide with real backend data. The calendar uses the clinic timezone returned by the API, UTC
appointment instants and their actual durations. It provides Day, Week, Month, Locations, Capacity,
list mode, filters, a Legend pop-up, date navigation and a view-only visit card (click a visit; a bottom sheet on phones). Imports that overlap are drawn in lanes.
Practitioners and case labels come from connected records/configuration, rather than demo lists.

## Data and booking flow

The authenticated frontend proxy permits these companion backend endpoints:

| Endpoint | Contract |
| --- | --- |
| `GET appointment-calendar?start=YYYY-MM-DD&end=YYYY-MM-DD` | Appointments, practitioners, timezone, business hours, booking gate, last import; optional `lead_id` limits records to one lead. Maximum 63 days and 2,000 records, with explicit truncation reporting. |
| `GET appointment-slots?lead_id=UUID&start=YYYY-MM-DD&days=7` | Available slots for the lead's configured case/location; optional `practitioner_id` is a Stride user ID. Cache freshness is reported. |
| `POST appointments` | `{ "lead_id": "UUID", "slot_id": 123 }`; returns the confirmed booking ID/day or an inline error. |

Stride's imported schedule overrides app booking rows, including cancellations, moves and deletes.
Confirmed record IDs remain stable across import, and clinic names use configured Stride location IDs.
Matched Stride patients carry their existing lead ID and source, including Google Sheets. No matching
or patient creation happens merely by opening the calendar. Appointments without a linked lead remain
inspectable. Names, locations, case and practitioner fields are scoped to authenticated practice staff;
raw import data, phone, email and DOB are excluded from calendar responses.

New bookings use the existing backend slot engine. It checks contact/review restrictions and the
practice booking gate, holds the exact slot, rechecks Stride, and queues the existing `lead_booked`
Google Sheets outbox event after confirmation. The Sheet worker and n8n perform writeback. The browser
never accesses Google Sheets credentials or provider tokens. It refreshes the calendar every 20 seconds
while visible, and immediately after a successful booking. Errors preserve the last loaded period.

## Differences from the demo guide

- Availability is selected from actual configured Stride slots; free grid space is not advertised as
  guaranteed availability. Duration, practitioner, location and case follow that slot configuration.
- Existing bookings are edited/cancelled in Stride and reflected after import. No undocumented
  rescheduling/cancellation API or local-only edit is presented as a successful provider change.
- Capacity uses configured business hours and ignores cancellations/no-shows. It is a schedule measure,
  not a guarantee of available slots. A lead-scoped calendar identifies its limited record set.
- The global calendar opens on Today; a View case link carries the selected appointment date into
  the lead calendar even when the appointment exists only in the Stride import mirror.
- No fixed sample clinicians, case categories, eight-hour assumptions or demo appointments are shipped.

Release the updated frontend and backend together. This change needs no new migration or dependency;
the existing Stride import/booking migrations and background workers must already be configured. The
current workstation preserves its environment and provider settings. Real booking and Sheet writeback
were not exercised during implementation; verification used an isolated synthetic booking flow and a
read-only configured-database calendar check.

The current frontend also includes a read-only Keap contact-sync status panel in Administration.
Its `GET keap-sync` proxy path requires the companion backend's
[Keap sync PR #13](https://github.com/rjm2007/aws_deployed_raush_pt_stride_keap/pull/13).
The panel reports an unavailable status when that backend endpoint has not been released.

## Validation

Run `npm run test:calendar`, the existing frontend test scripts, `npm run lint`, `npm run typecheck`,
`npm run build` and `npm run build:vercel`. Calendar regression tests cover clinic dates/DST, month/week
navigation, actual working hours, missed appointments and overlapping imports. Companion backend
tests cover authentication, practice boundaries, status codes, duration, deduplication, exact-slot
booking, uncertain outcomes and practitioner-specific availability. Desktop/mobile visual evidence
and the fidelity ledger are kept in the workspace's `output/appointment-calendar` directory.
