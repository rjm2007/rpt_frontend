import type { Appointment, BookingTag } from './appointment-data';

export type LeadStage = 'new' | 'cadence' | 'attention' | 'booked' | 'closed';

export type Lead = {
  id: string;
  display_id: string;
  full_name: string;
  phone: string | null;
  email?: string | null;
  source: string;
  status: string;
  stage: LeadStage;
  cadence_state: string;
  needs_review: boolean;
  review_reason: string | null;
  next_event_id: number | null;
  next_event_status?: string | null;
  next_step: string | null;
  next_channel: string | null;
  next_scheduled_for: string | null;
  created_at: string;
  last_contacted_at: string | null;
  location?: string;
  cadence_progress?: number;
  cadence_total?: number;
  cadence_version_name?: string | null;
  owner?: string;
  owner_user_id?: string | null;
  date_of_birth?: string;
  referred_by?: string;
  lead_type?: 'Physical Therapy' | 'Wellness';
  is_test?: boolean;
  number_block?: NumberBlock | null;
  // Only for booked leads: when and how they were booked (board card).
  booking?: BoardBooking | null;
  // The open review (needs_review), with the choices staff can make. Null when nothing is open.
  review?: Review | null;
  // Staff chose "Continue with calls only": no text goes to this lead.
  texts_off?: boolean;
  // Set by the paged lead-list / lead-board endpoints.
  kind?: 'lead';
};

// A Stride patient with no linked lead (front desk booked them directly): view only, never on the board.
export type StrideRow = {
  kind: 'stride';
  id: string;
  stride_id: number;
  full_name: string;
  phone: string | null;
  email: string | null;
  source: 'stride';
  date_of_birth: string | null;
  created_at: string | null;
  // 'booked' with a visit still on the books, else null and a plain label.
  stage: 'booked' | null;
  stage_label: string;
  next_step: string;
  owner: null;
};

export type LeadListRow = Lead | StrideRow;

// GET lead-list: one batch (newest first) matching the filters, the real total, counts per source.
export type LeadListPage = {
  rows: LeadListRow[];
  total: number;
  sources: Record<'all' | 'sheet' | 'stride', number>;
  offset: number;
  limit: number;
};

// GET lead-board: per column the next cards and the column's real total.
export type LeadBoardPage = {
  columns: Partial<Record<LeadStage, { rows: Lead[]; total: number }>>;
  offset: number;
  limit: number;
};

// GET stride-patients/{id}: the read-only Stride patient view.
export type StridePatientView = {
  patient: StrideRow & { clinic: string | null };
  visits: Array<{ id: number; start_utc: string | null; type: string | null; status: string; clinician: string | null; location: string | null }>;
};

// Demo also has 'appointment' (Stride cancel / no-show) and 'booking' (agent could not confirm).
// 'details': location, case or date of birth changed in the Sheet (2026-10-25).
export type ReviewGroup = 'name' | 'details' | 'phone' | 'text' | 'call' | 'technical' | 'blocked' | 'appointment' | 'booking' | 'other';

export type ReviewChoice =
  | 'use_new_name' | 'keep_old_name' | 'different_person' | 'calls_only' | 'retry_texts'
  | 'number_ok' | 'wrong_number' | 'continue' | 'close_phone_changed' | 'front_desk'
  | 'restart_cadence' | 'send_booking_link'
  // 2026-10-25: restart from Day 0 on the review card; "value" = location / case / date of birth.
  | 'use_new_name_restart' | 'keep_old_name_restart'
  | 'use_new_value' | 'keep_old_value' | 'use_new_value_restart' | 'keep_old_value_restart';

// One flag as the backend describes it (services/lead_review.py `describe`).
export type Review = {
  id: number | null;
  code: string;
  group: ReviewGroup;
  group_label: string;
  title: string;
  reason: string;
  proof: Array<{ label: string; value: string }>;
  flagged_at: string | null;
  source: string | null;
  source_label: string;
  landline: boolean;
  transcript_url: string | null;
  options: Array<{ choice: ReviewChoice; label: string }>;
  open_count?: number;
  also?: Array<{ title: string; flagged_at: string | null }>;
};

// GET /review/{lead_id}: what each choice will do, for the confirm pop-up.
export type ReviewPreview = {
  lead_id: string;
  full_name: string;
  review: Review | null;
  options: Array<{ choice: ReviewChoice; label: string; effect: string; next_step: string; confirm: string }>;
  // Set when the lead has no open review any more: why (newer Sheet row on the number, resolved by someone, closed).
  closed?: { reason: 'replaced' | 'resolved' | 'closed'; message: string } | null;
};

export type BoardBooking = {
  start_utc: string;
  state: string;
  tag: BookingTag;
  type: string;
  practitioner_name: string;
};

// The lead page booking card: the next visit still on the books, else the latest one.
// quote = what the patient said just before Elliot confirmed (Elliot bookings only).
export type BookingCard = Appointment & {
  quote: string | null;
  // The patient confirmed a different birthday on the booking call than the Sheet has.
  dob_check?: { on_file: string; said: string } | null;
};

// Set when the lead's phone is on the do-not-contact list. Calls and texts to
// it never go out, whatever stage the lead is in.
export type NumberBlock = {
  reason: string | null;
  source: string | null;
  blocked_at: string;
};

export type CadenceStep = {
  id?: number;
  step_order: number;
  day_offset: number;
  channel: 'call' | 'sms';
  key?: string;
  description: string;
  is_active: boolean;
  sms_body: string | null;
};

export type CadenceVersion = {
  id: number;
  practice_id: number;
  lead_id: string | null;
  scope: 'global' | 'lead';
  version_number: number;
  name: string;
  status: 'draft' | 'active' | 'archived' | 'deleted';
  source_version_id: number | null;
  activated_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  steps: CadenceStep[];
};

export type LeadCreateInput = {
  idempotency_key: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  date_of_birth: string;
  referred_by: string | null;
  lead_type: 'Physical Therapy' | 'Wellness';
  location: string;
  contact_consent: true;
};

export type Metrics = {
  total_leads: number;
  messages_sent: number;
  messages_delivered: number;
  messages_failed: number;
  messages_pending: number;
  messages_delivery_rate: number | null;
  calls_completed: number;
  calls_completion_rate: number | null;
  calls_reached_rate: number | null;
  voice_minutes: number;
  voice_seconds: number;
  voice_cost: number;
  calls_logged: number;
  stride_appointments: number;
  keap_handoffs: number;
  review_rate: number | null;
  booked_rate: number | null;
};

export type Snapshot = {
  calendar_location?: string;
  // Real totals over every lead (the leads list below is only the newest 250 plus open reviews).
  counts: Record<LeadStage, number>;
  counts_by_location?: Record<string, Record<LeadStage, number>>;
  leads: Lead[];
  // Next visits still on the books, ours and Stride's, soonest first.
  appointments: Appointment[];
  cadence: Array<Record<string, unknown>>;
  templates: Array<Record<string, unknown>>;
  providers: Array<Record<string, unknown>>;
  system: Record<string, number>;
  metrics?: Metrics;
  generated_at?: string;
};

export type LeadDetail = {
  lead: Record<string, unknown> & { id: string; full_name: string; display_id: string };
  events: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  calls: Array<Record<string, unknown>>;
  appointments: Array<Record<string, unknown>>;
  booking?: BookingCard | null;
  history: Array<Record<string, unknown>>;
  activity: ActivityEntry[];
  cadence_actions?: Array<Record<string, unknown>>;
  cadence_version?: CadenceVersion | null;
};

export type ActivityEntry = {
  id: string;
  action: string;
  occurred_at: string;
  actor_type: 'employee' | 'automation';
  actor_name: string;
  category: 'employee' | 'calls' | 'messages' | 'appointments' | 'cadence' | 'review';
  title: string;
  details: Record<string, unknown>;
};

export type StaffMember = {
  user_id: string;
  employee_id: string;
  display_name: string;
  role: 'super_admin' | 'employee';
};

export const emptySnapshot: Snapshot = {
  counts: { new: 0, cadence: 0, attention: 0, booked: 0, closed: 0 },
  leads: [],
  appointments: [],
  cadence: [],
  templates: [],
  providers: [],
  system: { provider_queue: 0, handoff_queue: 0, unknown_events: 0, review_queue: 0 },
};
