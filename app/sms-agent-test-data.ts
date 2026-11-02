// SMS agent test tab: pure logic (no React, no browser globals) so it can be unit tested with
// node --test. The page is app/sms-agent-test.tsx; the backend is
// routes/sms_agent_test.py (docs/SMS_AGENT.md, "Test chat tab").
//
// Chats live only in this browser (owner, 2026-11-02): the only time a chat leaves the browser is the
// reply call, which sends that chat's setup and history to the stateless sandbox endpoint.

export const OPTIONS_URL = '/api/dashboard/sms-agent-test/options';
export const REPLY_URL = '/api/dashboard/sms-agent-test/reply';
// Versioned so a later change to the stored shape can start clean instead of crashing on old data.
export const STORAGE_KEY = 'rpt-sms-agent-test-chats-v1';
export const MAX_CHATS = 50;
// Fallbacks for the backend's limits (routes/sms_agent_test.py MAX_TURNS / MAX_TEXT_CHARS /
// MAX_CHAT_CHARS); /options sends the real ones, these only apply when it could not be loaded.
export const MAX_MESSAGE_LENGTH = 1600; // ten SMS segments; a patient's text is never longer
export const DEFAULT_MAX_TURNS = 60;
export const DEFAULT_MAX_CHAT_CHARS = 40_000;
// Warn this many texts before the limit: about four exchanges, enough to finish a booking or move on.
const TURNS_WARNING = 10;
// A new timestamp line when the chat was quiet this long, like a phone's Messages app.
const TIME_GAP_MS = 15 * 60 * 1000;

export type Who = 'existing' | 'new';
export type FrontDesk = 'auto' | 'open' | 'closed';
// Which review is open on the made-up lead (routes/sms_agent_test.py OpenReview): 'auto' = from the
// status (Needs attention = a full review), 'front_desk' = only Elliot's own front-desk card (booking by
// text goes on), 'full' = a review that stops booking. Same mapping as a live lead.
export type OpenReview = 'auto' | 'none' | 'front_desk' | 'full';
// A Booked lead's visit; at = clinic wall time YYYY-MM-DDTHH:MM, '' = not set (no visit details).
export type BookedVisit = { at: string; therapist: string; clinic: string };

export type Setup = {
  who: Who;
  status: string;
  clinic: string;
  service: string;
  referral_word: string;
  first_name: string;
  last_name: string;
  date_of_birth: string; // YYYY-MM-DD or ''
  front_desk: FrontDesk;
  clock: string | null; // clinic wall time YYYY-MM-DDTHH:MM, null = now
  model: string; // '' = the server's default model
  open_review: OpenReview;
  booked_visit: BookedVisit; // sent only for a Booked existing lead with a day and time
};

export type Choice = { value: string; label: string };
export type Options = {
  clinics: Choice[]; services: Choice[]; models: Choice[]; statuses: Choice[]; defaultModel: string;
  maxTurns: number; maxTextChars: number; maxChatChars: number;
};

export type MessageRole = 'patient' | 'elliot' | 'note';
export type Message = { id: string; role: MessageRole; text: string; at: number; meta?: string };
export type ActionLog = { id: string; kind: string; summary: string; result_code: string; reason?: string; at: number };
export type Chat = { id: string; title: string; setup: Setup; messages: Message[]; actions: ActionLog[]; created: number; updated: number };

// reason: a hand-off's reason (insurance, different_case, ...) when the backend gives one.
export type ReplyAction = { kind: string; summary: string; result_code: string; reason?: string };
export type Reply = { texts: string[]; actions: ReplyAction[]; model: string; ms: number | null };
// What the backend validates (routes/sms_agent_test.py SandboxSetupIn): status must be a real lead status
// or absent (the backend then uses in_progress), and the birthday a date or null, never ''.
export type WireSetup = Omit<Setup, 'status' | 'date_of_birth' | 'booked_visit'> & { status?: string; date_of_birth: string | null; booked_visit: BookedVisit | null };
// prior_actions: what Elliot did on the earlier replies (oldest first). The sandbox writes nothing, so
// without them a case change on turn 1 was forgotten and "book me" on turn 2 booked where live refuses.
// reason goes back as it came (only when set): the codes alone cannot tell a repeat of the same hand-off
// from a new one (x-02, 2026-11-02).
export type PriorAction = { kind: string; result_code: string; reason?: string };
export type ReplyRequest = { setup: WireSetup; history: { role: 'patient' | 'elliot'; text: string }[]; message: string; prior_actions: PriorAction[] };

export const EMPTY_OPTIONS: Options = {
  clinics: [], services: [], models: [], statuses: [], defaultModel: '',
  maxTurns: DEFAULT_MAX_TURNS, maxTextChars: MAX_MESSAGE_LENGTH, maxChatChars: DEFAULT_MAX_CHAT_CHARS,
};

export const FRONT_DESK_LABELS: Record<FrontDesk, string> = { auto: 'Auto (by the clock)', open: 'Open', closed: 'Closed' };
export const OPEN_REVIEW_LABELS: Record<OpenReview, string> = {
  auto: 'From the status (Needs attention = full review)',
  none: 'None',
  front_desk: "Front desk only (Elliot's own card)",
  full: 'Full review (stops booking)',
};
const OPEN_REVIEW_SHORT: Record<OpenReview, string> = { auto: '', none: 'no review', front_desk: 'front desk card only', full: 'full review' };
export const EMPTY_VISIT: BookedVisit = { at: '', therapist: '', clinic: '' };

// --- options -------------------------------------------------------------------------------------

function text(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

export function statusLabel(value: string): string {
  const raw = value.trim();
  if (!raw) return '';
  return raw.replaceAll('_', ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}

// The backend may send plain strings or {value, label} / {name} objects; both become choices.
function choices(raw: unknown, label: (value: string) => string = (value) => value): Choice[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Choice[] = [];
  for (const item of raw) {
    let value = '';
    let shown = '';
    if (typeof item === 'string') value = item;
    else if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      value = text(record.value ?? record.id ?? record.name);
      shown = text(record.label ?? record.name);
    }
    value = value.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label: shown.trim() || label(value) });
  }
  return out;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

export function parseOptions(raw: unknown): Options {
  if (!raw || typeof raw !== 'object') return EMPTY_OPTIONS;
  const record = raw as Record<string, unknown>;
  const models = choices(record.models);
  const defaultModel = text(record.default_model).trim() || models[0]?.value || '';
  if (defaultModel && !models.some((model) => model.value === defaultModel)) models.unshift({ value: defaultModel, label: defaultModel });
  return {
    clinics: choices(record.clinics),
    services: choices(record.services),
    models,
    statuses: choices(record.statuses, statusLabel),
    defaultModel,
    maxTurns: positiveInt(record.max_turns, DEFAULT_MAX_TURNS),
    maxTextChars: positiveInt(record.max_text_chars, MAX_MESSAGE_LENGTH),
    maxChatChars: positiveInt(record.max_chat_chars, DEFAULT_MAX_CHAT_CHARS),
  };
}

// --- setup ---------------------------------------------------------------------------------------

export function defaultSetup(options: Options = EMPTY_OPTIONS): Setup {
  return {
    who: 'existing',
    status: options.statuses[0]?.value ?? '',
    clinic: options.clinics[0]?.value ?? '',
    service: options.services[0]?.value ?? '',
    referral_word: '',
    first_name: '',
    last_name: '',
    date_of_birth: '',
    front_desk: 'auto',
    clock: null,
    model: options.defaultModel,
    open_review: 'auto',
    booked_visit: { ...EMPTY_VISIT },
  };
}

// The visit only counts on a Booked existing lead (the backend refuses it anywhere else).
export function visitApplies(setup: Setup): boolean {
  return setup.who === 'existing' && setup.status.trim() === 'booked';
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function realDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validDate(value: string): boolean {
  const match = DATE.exec(value);
  return Boolean(match && realDate(+match[1], +match[2], +match[3]));
}

// datetime-local inputs may add seconds (HH:MM:SS); the backend contract is minutes only.
export function normalizeClock(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  const short = raw.slice(0, 16);
  const match = CLOCK.exec(short);
  if (!match || !realDate(+match[1], +match[2], +match[3]) || +match[4] > 23 || +match[5] > 59) return null;
  return short;
}

// Returns the problems in plain words; empty when the chat can start.
export function setupProblems(setup: Setup, clockMode: 'now' | 'chosen' = setup.clock ? 'chosen' : 'now'): string[] {
  const problems: string[] = [];
  if (setup.who === 'existing') {
    if (!setup.first_name.trim()) problems.push('Enter a first name for the made-up lead.');
    if (setup.date_of_birth && !validDate(setup.date_of_birth)) problems.push('Birthday must be a real date.');
    if (setup.date_of_birth && validDate(setup.date_of_birth) && setup.date_of_birth > new Date().toISOString().slice(0, 10)) problems.push('Birthday cannot be in the future.');
  }
  if (visitApplies(setup) && (setup.booked_visit.therapist.trim() || setup.booked_visit.clinic.trim()) && !normalizeClock(setup.booked_visit.at)) problems.push('Pick the booked visit’s day and time, or clear its therapist and clinic.');
  if (clockMode === 'chosen' && !normalizeClock(setup.clock)) problems.push('Pick a day and time for the clock, or choose Now.');
  return problems;
}

// What the backend gets: a new person carries no lead details (the agent has to ask for them).
export function requestSetup(setup: Setup): WireSetup {
  const clock = normalizeClock(setup.clock);
  const { status: rawStatus, date_of_birth: rawBirthday, booked_visit: visit, ...rest } = setup;
  if (setup.who === 'new') {
    // A new person has no lead, so no review card to open.
    const open_review = setup.open_review === 'front_desk' || setup.open_review === 'full' ? 'auto' : setup.open_review;
    return { ...rest, open_review, clinic: '', service: '', referral_word: '', first_name: '', last_name: '', date_of_birth: null, clock, booked_visit: null };
  }
  const status = rawStatus.trim();
  const at = normalizeClock(visit.at);
  return {
    ...rest,
    booked_visit: visitApplies(setup) && at ? { at, therapist: visit.therapist.trim(), clinic: visit.clinic.trim() } : null,
    ...(status ? { status } : {}),
    referral_word: setup.referral_word.trim(),
    first_name: setup.first_name.trim(),
    last_name: setup.last_name.trim(),
    date_of_birth: validDate(rawBirthday) ? rawBirthday : null,
    clock,
  };
}

export function clockLabel(clock: string | null): string {
  const value = normalizeClock(clock);
  if (!value) return 'Clock: now';
  const [day, time] = value.split('T');
  const [year, month, date] = day.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, date)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const suffix = hour < 12 ? 'AM' : 'PM';
  return `Clock: ${weekday}, ${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix} PT`;
}

// One short line for the chat header and the copied transcript.
export function setupSummary(setup: Setup, options: Options = EMPTY_OPTIONS): string {
  const label = (list: Choice[], value: string) => list.find((item) => item.value === value)?.label ?? value;
  const parts: string[] = [];
  if (setup.who === 'new') parts.push('New person');
  else {
    parts.push(`Existing lead${setup.status ? ` (${label(options.statuses, setup.status) || statusLabel(setup.status)})` : ''}`);
    if (setup.clinic) parts.push(label(options.clinics, setup.clinic));
    if (setup.service) parts.push(`${label(options.services, setup.service)}${setup.referral_word.trim() ? `, ${setup.referral_word.trim()}` : ''}`);
    else if (setup.referral_word.trim()) parts.push(setup.referral_word.trim());
    const review = OPEN_REVIEW_SHORT[setup.open_review];
    if (review) parts.push(`Open review: ${review}`);
    const visit = visitLabel(setup);
    if (visit) parts.push(`Booked visit: ${visit}`);
  }
  parts.push(`Front desk: ${setup.front_desk === 'auto' ? 'auto' : setup.front_desk}`);
  parts.push(clockLabel(setup.clock));
  parts.push(`Model: ${setup.model || options.defaultModel || 'default'}`);
  return parts.join(' · ');
}

// "Tue Nov 3, 9:00 AM with Alan at Laguna Niguel"; '' when no visit applies.
export function visitLabel(setup: Setup): string {
  const at = normalizeClock(setup.booked_visit.at);
  if (!visitApplies(setup) || !at) return '';
  const words = [clockLabel(at).replace(/^Clock: /, '').replace(/, \d{4},/, ',').replace(/ PT$/, '')];
  if (setup.booked_visit.therapist.trim()) words.push(`with ${setup.booked_visit.therapist.trim()}`);
  const clinic = setup.booked_visit.clinic.trim() || setup.clinic;
  if (clinic) words.push(`at ${clinic}`);
  return words.join(' ');
}

export function defaultTitle(setup: Setup): string {
  if (setup.who === 'new') return 'New person';
  return `${setup.first_name.trim()} ${setup.last_name.trim()}`.trim() || 'Existing lead';
}

// --- chats ---------------------------------------------------------------------------------------

export function newChat(setup: Setup, id: string, now: number): Chat {
  return { id, title: defaultTitle(setup), setup, messages: [], actions: [], created: now, updated: now };
}

export function resetChat(chat: Chat, now: number): Chat {
  return { ...chat, messages: [], actions: [], updated: now };
}

export function renameChat(chat: Chat, title: string, now: number): Chat {
  const clean = title.trim().slice(0, 60);
  return clean ? { ...chat, title: clean, updated: now } : chat;
}

// Same setup, empty texts: where a chat goes when it reaches the backend's limits.
export function continueChat(chat: Chat, id: string, now: number): Chat {
  const title = chat.title.endsWith(' (continued)') ? chat.title : `${chat.title.slice(0, 48)} (continued)`;
  return { ...newChat({ ...chat.setup }, id, now), title };
}

export type ChatRoom = { turnsLeft: number; charsLeft: number; near: boolean; full: boolean; warning: string };

// How much more the chat can take. The backend refuses (422) a reply request whose history plus new
// text is over max_turns texts or max_chat_chars characters, and Retry cannot fix that, so the page
// warns before the limit and stops sending at it instead of failing (or cutting the chat) silently.
export function chatRoom(chat: Chat, options: Options = EMPTY_OPTIONS): ChatRoom {
  const turns = historyBefore(chat);
  // A new text adds one turn and its characters; Elliot's answer adds more turns after it.
  const turnsLeft = Math.max(0, options.maxTurns - turns.length);
  const charsLeft = Math.max(0, options.maxChatChars - turns.reduce((sum, turn) => sum + turn.text.length, 0));
  const full = turnsLeft < 1 || charsLeft < 1;
  const near = !full && (turnsLeft <= TURNS_WARNING || charsLeft <= options.maxChatChars / 10);
  const warning = full
    ? 'This chat is at the test limit, so Elliot cannot take more texts here. Start a new chat with the same setup to keep testing.'
    : near
      ? `This chat is near the test limit (${turnsLeft} more text${turnsLeft === 1 ? '' : 's'} at most). Start a new chat with the same setup to keep going.`
      : '';
  return { turnsLeft, charsLeft, near, full, warning };
}

// Why this draft cannot be sent, in plain words; '' when it can. Nothing is ever cut to fit.
export function draftProblem(chat: Chat, draft: string, options: Options = EMPTY_OPTIONS): string {
  const body = draft.trim();
  if (body.length > options.maxTextChars) return `This text is ${body.length} characters; one text can be at most ${options.maxTextChars}. Shorten it to send.`;
  const room = chatRoom(chat, options);
  if (room.full) return room.warning;
  if (body.length > room.charsLeft) return 'This text would make the chat too long for Elliot. Shorten it, or start a new chat with the same setup.';
  return '';
}

export function addPatientMessage(chat: Chat, message: string, id: string, now: number): Chat {
  return { ...chat, messages: [...chat.messages, { id, role: 'patient', text: message, at: now }], updated: now };
}

// The history the agent gets: every patient and Elliot text before `uptoIndex` (notes are ours only).
export function historyBefore(chat: Chat, uptoIndex = chat.messages.length): ReplyRequest['history'] {
  return chat.messages.slice(0, uptoIndex)
    .filter((message): message is Message & { role: 'patient' | 'elliot' } => message.role === 'patient' || message.role === 'elliot')
    .map(({ role, text: body }) => ({ role, text: body }));
}

// The request for the chat's last patient text (just sent, or being retried).
export function replyRequestFor(chat: Chat): ReplyRequest | null {
  const index = lastPatientIndex(chat);
  if (index < 0) return null;
  // Every logged action came from an earlier reply (a failed reply logs none), so a retry sends the same list.
  const prior_actions = chat.actions.map(({ kind, result_code, reason }): PriorAction => ({ kind, result_code, ...(reason ? { reason } : {}) }));
  return { setup: requestSetup(chat.setup), history: historyBefore(chat, index), message: chat.messages[index].text, prior_actions };
}

function lastPatientIndex(chat: Chat) {
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) if (chat.messages[index].role === 'patient') return index;
  return -1;
}

// True when the last thing in the chat is a patient text nobody answered yet (an error or a refresh
// while waiting): the page offers Retry.
export function awaitingReply(chat: Chat): boolean {
  const last = chat.messages[chat.messages.length - 1];
  return last?.role === 'patient';
}

export function parseReply(raw: unknown): Reply {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const texts = Array.isArray(record.texts) ? record.texts.map(text).map((item) => item.trim()).filter(Boolean) : [];
  const actions = Array.isArray(record.actions) ? record.actions.filter((item) => item && typeof item === 'object').map((item) => {
    const action = item as Record<string, unknown>;
    const reason = text(action.reason).trim();
    return { kind: text(action.kind).trim() || 'action', summary: text(action.summary).trim(), result_code: text(action.result_code).trim(), ...(reason ? { reason } : {}) };
  }) : [];
  const ms = typeof record.ms === 'number' && Number.isFinite(record.ms) ? record.ms : null;
  return { texts, actions, model: text(record.model).trim(), ms };
}

export function replyMeta(reply: Reply): string {
  const parts = [reply.model, reply.ms === null ? '' : `${(reply.ms / 1000).toFixed(1)} s`].filter(Boolean);
  return parts.join(' · ');
}

// Several texts in one reply become separate bubbles; no texts = Elliot stays quiet (a note says so).
export function applyReply(chat: Chat, reply: Reply, newId: () => string, now: number): Chat {
  const meta = replyMeta(reply);
  const bubbles: Message[] = reply.texts.length
    ? reply.texts.map((body, index) => ({ id: newId(), role: 'elliot' as const, text: body, at: now, ...(index === reply.texts.length - 1 && meta ? { meta } : {}) }))
    : [{ id: newId(), role: 'note', text: 'Elliot would not reply to this text.', at: now, ...(meta ? { meta } : {}) }];
  const actions: ActionLog[] = reply.actions.map((action) => ({ id: newId(), ...action, at: now }));
  return { ...chat, messages: [...chat.messages, ...bubbles], actions: [...chat.actions, ...actions], updated: now };
}

export function chatPreview(chat: Chat): string {
  const last = [...chat.messages].reverse().find((message) => message.role !== 'note');
  if (!last) return 'No messages yet';
  const body = last.text.replace(/\s+/g, ' ').trim();
  return `${last.role === 'patient' ? 'You: ' : ''}${body.length > 60 ? `${body.slice(0, 57)}…` : body}`;
}

// Timestamp line above a message: the first one, and after a quiet gap.
export function showTimeAbove(messages: Message[], index: number): boolean {
  if (index === 0) return true;
  return messages[index].at - messages[index - 1].at >= TIME_GAP_MS;
}

// Bubbles from the same sender in a row sit closer together, like a phone.
export function sameSenderAsPrevious(messages: Message[], index: number): boolean {
  return index > 0 && messages[index - 1].role === messages[index].role && !showTimeAbove(messages, index);
}

export const ACTION_LABELS: Record<string, string> = {
  find_times: 'Looked for times',
  list_therapists: 'Listed therapists',
  confirm_visit: 'Read back the visit',
  book: 'Booking',
  report: 'Status',
  hand_off: 'Hand-off to front desk',
  emergency: 'Emergency',
  fixed_text: 'Fixed text',
};

export function actionLabel(kind: string): string {
  return ACTION_LABELS[kind] ?? statusLabel(kind);
}

function clock12(at: number, timeZone?: string) {
  return new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) });
}

// Plain text for an email: the setup on top, then every text, then what Elliot did.
export function chatTranscript(chat: Chat, options: Options = EMPTY_OPTIONS, timeZone?: string): string {
  const lines = [`SMS agent test: ${chat.title}`, `Setup: ${setupSummary(chat.setup, options)}`];
  if (chat.setup.who === 'existing') {
    const name = `${chat.setup.first_name} ${chat.setup.last_name}`.trim();
    if (name) lines.push(`Made-up lead: ${name}${chat.setup.date_of_birth ? `, born ${chat.setup.date_of_birth}` : ''}`);
  }
  lines.push('');
  if (!chat.messages.length) lines.push('(no messages)');
  for (const message of chat.messages) {
    const who = message.role === 'patient' ? 'Patient' : message.role === 'elliot' ? 'Elliot' : 'Note';
    lines.push(`[${clock12(message.at, timeZone)}] ${who}: ${message.text}`);
  }
  if (chat.actions.length) {
    lines.push('', 'What Elliot did (pretend, nothing saved):');
    for (const action of chat.actions) lines.push(`- ${actionLabel(action.kind)}: ${action.summary || action.kind}${action.result_code ? ` (${action.result_code})` : ''}`);
  }
  return lines.join('\n');
}

// --- errors --------------------------------------------------------------------------------------

// FastAPI sends {detail: "..."} or {detail: [{msg: ...}]}.
export function errorDetail(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const detail = (body as Record<string, unknown>).detail;
  if (typeof detail === 'string') return detail.trim();
  if (Array.isArray(detail)) return detail.map((item) => text((item as Record<string, unknown>)?.msg)).filter(Boolean).join('; ');
  return '';
}

export function replyErrorMessage(status: number | null, detail = ''): string {
  if (status === null) return 'No answer from the server. Check the connection, then Retry.';
  if (status === 404) return 'The SMS agent test is turned off on the server.';
  if (status === 403) return detail || 'You do not have access to the SMS agent test.';
  if (status === 429) return 'Too many test messages in the last minute. Wait a moment, then Retry.';
  if (status === 422 || status === 400) return detail ? `The server refused this chat: ${detail}` : 'The server refused this chat setup.';
  if (status === 504 || status === 408) return 'Elliot took too long to answer. Retry.';
  return detail && status < 500 ? detail : 'Elliot could not answer just now. Retry.';
}

// --- storage -------------------------------------------------------------------------------------

function parseSetup(raw: unknown): Setup | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const base = defaultSetup();
  const who: Who = record.who === 'new' ? 'new' : 'existing';
  const frontDesk = record.front_desk === 'open' || record.front_desk === 'closed' ? record.front_desk : 'auto';
  // Chats saved before these fields existed open with no visit and the old (auto) review.
  const openReview: OpenReview = record.open_review === 'none' || record.open_review === 'front_desk' || record.open_review === 'full' ? record.open_review : 'auto';
  const visit = record.booked_visit && typeof record.booked_visit === 'object' ? record.booked_visit as Record<string, unknown> : {};
  return {
    ...base,
    who,
    status: text(record.status),
    clinic: text(record.clinic),
    service: text(record.service),
    referral_word: text(record.referral_word),
    first_name: text(record.first_name),
    last_name: text(record.last_name),
    date_of_birth: text(record.date_of_birth),
    front_desk: frontDesk,
    clock: normalizeClock(text(record.clock)),
    model: text(record.model),
    open_review: openReview,
    booked_visit: { at: normalizeClock(text(visit.at)) ?? '', therapist: text(visit.therapist), clinic: text(visit.clinic) },
  };
}

function parseMessage(raw: unknown): Message | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const role = record.role;
  if (role !== 'patient' && role !== 'elliot' && role !== 'note') return null;
  const body = text(record.text);
  if (!body) return null;
  const at = typeof record.at === 'number' ? record.at : 0;
  return { id: text(record.id) || `m${at}`, role, text: body, at, ...(text(record.meta) ? { meta: text(record.meta) } : {}) };
}

function parseAction(raw: unknown): ActionLog | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const kind = text(record.kind);
  if (!kind) return null;
  const at = typeof record.at === 'number' ? record.at : 0;
  const reason = text(record.reason);
  return { id: text(record.id) || `a${at}`, kind, summary: text(record.summary), result_code: text(record.result_code), ...(reason ? { reason } : {}), at };
}

// Anything unreadable is dropped rather than breaking the page.
export function parseStoredChats(raw: string | null): Chat[] {
  if (!raw) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(data)) return [];
  const chats: Chat[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const setup = parseSetup(record.setup);
    const id = text(record.id);
    if (!setup || !id) continue;
    const messages = Array.isArray(record.messages) ? record.messages.map(parseMessage).filter((message): message is Message => message !== null) : [];
    const actions = Array.isArray(record.actions) ? record.actions.map(parseAction).filter((action): action is ActionLog => action !== null) : [];
    const updated = typeof record.updated === 'number' ? record.updated : 0;
    chats.push({ id, title: text(record.title) || defaultTitle(setup), setup, messages, actions, created: typeof record.created === 'number' ? record.created : updated, updated });
  }
  return sortChats(chats).slice(0, MAX_CHATS);
}

export function serializeChats(chats: Chat[]): string {
  return JSON.stringify(sortChats(chats).slice(0, MAX_CHATS));
}

export function sortChats(chats: Chat[]): Chat[] {
  return [...chats].sort((a, b) => b.updated - a.updated);
}
