import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actionLabel, addPatientMessage, applyReply, chatRoom, continueChat, draftProblem, awaitingReply, chatPreview, chatTranscript, clockLabel, defaultSetup,
  defaultTitle, errorDetail, MAX_CHATS, newChat, normalizeClock, parseOptions, parseReply, parseStoredChats,
  renameChat, replyErrorMessage, replyRequestFor, requestSetup, resetChat, sameSenderAsPrevious, serializeChats,
  setupProblems, setupSummary, showTimeAbove, STORAGE_KEY, visitLabel, type Chat, type Setup,
} from './sms-agent-test-data.ts';

const OPTIONS = parseOptions({
  clinics: ['Laguna Niguel', 'Dana Point'],
  services: ['Physical Therapy', 'Pelvic Health'],
  models: ['gpt-5.5', 'gpt-5-mini'],
  default_model: 'gpt-5.5',
  statuses: ['in_cadence', 'booked', 'needs_attention'],
});

function existing(patch: Partial<Setup> = {}): Setup {
  return { ...defaultSetup(OPTIONS), first_name: 'Test', last_name: 'Person', date_of_birth: '1980-02-03', referral_word: 'knee', ...patch };
}

let counter = 0;
const ids = () => `id${counter += 1}`;

test('options accept plain strings or objects, drop blanks and duplicates, and keep the default model', () => {
  const options = parseOptions({ clinics: ['A', 'A', '', { value: 'B', label: 'Clinic B' }, { name: 'C' }], models: ['m1'], default_model: 'm2', statuses: ['needs_review'] });
  assert.deepEqual(options.clinics, [{ value: 'A', label: 'A' }, { value: 'B', label: 'Clinic B' }, { value: 'C', label: 'C' }]);
  assert.deepEqual(options.models.map((model) => model.value), ['m2', 'm1']);
  assert.equal(options.defaultModel, 'm2');
  assert.deepEqual(options.statuses, [{ value: 'needs_review', label: 'Needs review' }]);
  assert.deepEqual(parseOptions(null).clinics, []);
  assert.equal(parseOptions({ models: ['x'] }).defaultModel, 'x');
});

test('default setup starts on an existing lead with the first choices and the default model', () => {
  const setup = defaultSetup(OPTIONS);
  assert.equal(setup.who, 'existing');
  assert.equal(setup.clinic, 'Laguna Niguel');
  assert.equal(setup.service, 'Physical Therapy');
  assert.equal(setup.status, 'in_cadence');
  assert.equal(setup.model, 'gpt-5.5');
  assert.equal(setup.front_desk, 'auto');
  assert.equal(setup.clock, null);
});

test('setup problems: first name for an existing lead, a real birthday, a chosen clock', () => {
  assert.deepEqual(setupProblems(existing()), []);
  assert.match(setupProblems(existing({ first_name: ' ' }))[0], /first name/);
  assert.match(setupProblems(existing({ date_of_birth: '1980-02-30' }))[0], /real date/);
  assert.match(setupProblems(existing({ date_of_birth: '2999-01-01' }))[0], /future/);
  assert.match(setupProblems(existing({ clock: null }), 'chosen')[0], /day and time/);
  assert.deepEqual(setupProblems(existing({ clock: '2026-11-08T21:30' }), 'chosen'), []);
  // A new person needs no lead details at all.
  assert.deepEqual(setupProblems({ ...defaultSetup(OPTIONS), who: 'new' }), []);
});

test('clock is minutes only and must be a real wall time', () => {
  assert.equal(normalizeClock('2026-11-08T21:30:00'), '2026-11-08T21:30');
  assert.equal(normalizeClock('2026-11-08T24:00'), null);
  assert.equal(normalizeClock('2026-02-30T10:00'), null);
  assert.equal(normalizeClock(''), null);
  assert.equal(clockLabel(null), 'Clock: now');
  assert.equal(clockLabel('2026-11-08T21:05'), 'Clock: Sun, Nov 8, 2026, 9:05 PM PT');
  assert.equal(clockLabel('2026-11-09T00:15'), 'Clock: Mon, Nov 9, 2026, 12:15 AM PT');
});

test('a new person sends no lead details; an existing lead sends trimmed ones', () => {
  const fresh = requestSetup({ ...existing(), who: 'new' });
  assert.equal(fresh.who, 'new');
  assert.equal(fresh.first_name, '');
  // The backend refuses '' for status and birthday (422): absent / null instead.
  assert.equal(fresh.date_of_birth, null);
  assert.equal('status' in fresh, false);
  assert.equal(fresh.clinic, '');
  assert.equal(fresh.model, 'gpt-5.5');
  const old = requestSetup(existing({ first_name: ' Test ', date_of_birth: 'nope', clock: '2026-11-08T09:00:00' }));
  assert.equal(old.first_name, 'Test');
  assert.equal(old.date_of_birth, null);
  assert.equal(old.status, 'in_cadence');
  assert.equal(old.clock, '2026-11-08T09:00');
  assert.equal(requestSetup(existing()).date_of_birth, '1980-02-03');
  assert.equal('status' in requestSetup(existing({ status: ' ' })), false);
});

test('summary line and default title describe the setup', () => {
  assert.equal(setupSummary(existing(), OPTIONS), 'Existing lead (In cadence) · Laguna Niguel · Physical Therapy, knee · Front desk: auto · Clock: now · Model: gpt-5.5');
  assert.equal(setupSummary({ ...existing(), who: 'new', front_desk: 'closed', model: '' }, OPTIONS), 'New person · Front desk: closed · Clock: now · Model: gpt-5.5');
  assert.equal(defaultTitle(existing()), 'Test Person');
  assert.equal(defaultTitle(existing({ first_name: '', last_name: '' })), 'Existing lead');
  assert.equal(defaultTitle({ ...existing(), who: 'new' }), 'New person');
});

test('the reply request carries the whole history before the last patient text, never notes', () => {
  let chat = newChat(existing(), 'c1', 1000);
  assert.equal(replyRequestFor(chat), null);
  chat = addPatientMessage(chat, 'hi', ids(), 1000);
  chat = applyReply(chat, { texts: ['Hi Test!', 'Want a time?'], actions: [], model: 'gpt-5.5', ms: 1234 }, ids, 2000);
  chat = addPatientMessage(chat, 'ok', ids(), 3000);
  chat = applyReply(chat, { texts: [], actions: [], model: '', ms: null }, ids, 4000);
  chat = addPatientMessage(chat, 'tomorrow morning?', ids(), 5000);
  const request = replyRequestFor(chat)!;
  assert.equal(request.message, 'tomorrow morning?');
  assert.deepEqual(request.history, [
    { role: 'patient', text: 'hi' }, { role: 'elliot', text: 'Hi Test!' }, { role: 'elliot', text: 'Want a time?' }, { role: 'patient', text: 'ok' },
  ]);
  assert.equal(request.setup.first_name, 'Test');
  assert.equal(awaitingReply(chat), true);
});

test('the reply request carries what Elliot did on earlier turns, oldest first, and a retry sends the same', () => {
  // Review 2026-11-02: a case change on turn 1 was forgotten, so "book me" on turn 2 booked in the test chat.
  let chat = addPatientMessage(newChat(existing(), 'c1', 0), 'it is my back now, not my knee', ids(), 0);
  assert.deepEqual(replyRequestFor(chat)!.prior_actions, []);
  chat = applyReply(chat, parseReply({ texts: ['Thanks, I will let the team know.'], actions: [{ kind: 'report', summary: 'Would report a case change', result_code: 'REPORTED_CASE_CHANGE' }] }), ids, 1);
  chat = addPatientMessage(chat, 'book me', ids(), 2);
  const expected = [{ kind: 'report', result_code: 'REPORTED_CASE_CHANGE' }];
  assert.deepEqual(replyRequestFor(chat)!.prior_actions, expected);
  assert.deepEqual(replyRequestFor(chat)!.prior_actions, expected);
  assert.deepEqual(replyRequestFor(continueChat(chat, 'c2', 3)), null);
});

test('a hand-off reason from the reply goes back with prior_actions and survives a reload', () => {
  // x-02, 2026-11-02: the codes alone could not tell a repeat of the same hand-off from a new one.
  let chat = addPatientMessage(newChat(existing(), 'c1', 0), 'does my insurance cover it?', ids(), 0);
  chat = applyReply(chat, parseReply({ texts: ['The front desk will reach out.'], actions: [
    { kind: 'hand_off', summary: 'Would open a Needs Review card: insurance or costs', result_code: 'HANDED_OFF', reason: ' insurance ' },
    { kind: 'find_times', summary: 'Looked for Tue', result_code: 'OPENINGS', reason: null },
  ] }), ids, 1);
  chat = addPatientMessage(chat, 'can I talk to a person?', ids(), 2);
  const expected = [{ kind: 'hand_off', result_code: 'HANDED_OFF', reason: 'insurance' }, { kind: 'find_times', result_code: 'OPENINGS' }];
  assert.deepEqual(replyRequestFor(chat)!.prior_actions, expected);
  const reloaded = parseStoredChats(serializeChats([chat]))[0];
  assert.deepEqual(replyRequestFor(reloaded)!.prior_actions, expected);
});

test('a reply becomes one bubble per text, timing on the last one, and actions are logged', () => {
  let chat = addPatientMessage(newChat(existing(), 'c1', 0), 'book me', ids(), 0);
  chat = applyReply(chat, parseReply({ texts: ['One', ' ', 'Two'], actions: [{ kind: 'find_times', summary: 'Looked for Tue', result_code: 'OPENINGS' }, 'junk'], model: 'gpt-5.5', ms: 2500 }), ids, 10);
  const elliot = chat.messages.filter((message) => message.role === 'elliot');
  assert.deepEqual(elliot.map((message) => message.text), ['One', 'Two']);
  assert.equal(elliot[0].meta, undefined);
  assert.equal(elliot[1].meta, 'gpt-5.5 · 2.5 s');
  assert.equal(chat.actions.length, 1);
  assert.equal(chat.actions[0].result_code, 'OPENINGS');
  assert.equal(awaitingReply(chat), false);
});

test('no texts in a reply leaves a note, not an Elliot bubble', () => {
  const chat = applyReply(addPatientMessage(newChat(existing(), 'c1', 0), 'thanks', ids(), 0), parseReply({ texts: [], actions: [] }), ids, 1);
  assert.equal(chat.messages[1].role, 'note');
  assert.equal(awaitingReply(chat), false);
  assert.equal(chatPreview(chat), 'You: thanks');
});

test('reset keeps the setup and title; rename trims and ignores blanks', () => {
  let chat = applyReply(addPatientMessage(newChat(existing(), 'c1', 0), 'hi', ids(), 0), parseReply({ texts: ['Hello'], actions: [{ kind: 'book', summary: 'x' }] }), ids, 1);
  chat = resetChat(chat, 5);
  assert.deepEqual(chat.messages, []);
  assert.deepEqual(chat.actions, []);
  assert.equal(chat.setup.first_name, 'Test');
  assert.equal(renameChat(chat, '  Insurance case  ', 6).title, 'Insurance case');
  assert.equal(renameChat(chat, '   ', 6).title, chat.title);
});

test('timestamps show first and after a 15 minute gap; same sender in a row groups', () => {
  const messages = [
    { id: '1', role: 'patient' as const, text: 'a', at: 0 },
    { id: '2', role: 'patient' as const, text: 'b', at: 60_000 },
    { id: '3', role: 'elliot' as const, text: 'c', at: 70_000 },
    { id: '4', role: 'elliot' as const, text: 'd', at: 70_000 + 16 * 60_000 },
  ];
  assert.deepEqual(messages.map((_, index) => showTimeAbove(messages, index)), [true, false, false, true]);
  assert.deepEqual(messages.map((_, index) => sameSenderAsPrevious(messages, index)), [false, true, false, false]);
});

test('copied transcript has the setup on top, every text, then what Elliot did', () => {
  let chat = addPatientMessage(newChat(existing(), 'c1', Date.UTC(2026, 10, 2, 17, 5)), 'hi', ids(), Date.UTC(2026, 10, 2, 17, 5));
  chat = applyReply(chat, parseReply({ texts: ['Hi Test'], actions: [{ kind: 'hand_off', summary: 'Would open a Needs Review card: insurance', result_code: 'HANDED_OFF' }] }), ids, Date.UTC(2026, 10, 2, 17, 6));
  const transcript = chatTranscript(chat, OPTIONS, 'America/Los_Angeles');
  const lines = transcript.split('\n');
  assert.equal(lines[0], 'SMS agent test: Test Person');
  assert.match(lines[1], /^Setup: Existing lead \(In cadence\) · Laguna Niguel/);
  assert.equal(lines[2], 'Made-up lead: Test Person, born 1980-02-03');
  assert.ok(lines.includes('[9:05 AM] Patient: hi'));
  assert.ok(lines.includes('[9:06 AM] Elliot: Hi Test'));
  assert.ok(lines.includes('- Hand-off to front desk: Would open a Needs Review card: insurance (HANDED_OFF)'));
});

test('stored chats: versioned key, bad data dropped, newest first, capped', () => {
  assert.match(STORAGE_KEY, /v1$/);
  assert.deepEqual(parseStoredChats(null), []);
  assert.deepEqual(parseStoredChats('{not json'), []);
  assert.deepEqual(parseStoredChats('{"a":1}'), []);
  const good = applyReply(addPatientMessage(newChat(existing({ clock: '2026-11-08T09:00' }), 'c1', 5), 'hi', ids(), 5), parseReply({ texts: ['Hello'], actions: [{ kind: 'report', summary: 'Would report declined', result_code: 'OK' }] }), ids, 6);
  const older: Chat = { ...newChat({ ...existing(), who: 'new' }, 'c0', 1), updated: 1 };
  const raw = JSON.stringify([older, { id: '', setup: {} }, 7, { id: 'x' }, { ...good, messages: [...good.messages, { role: 'robot', text: 'x' }] }]);
  const chats = parseStoredChats(raw);
  assert.deepEqual(chats.map((chat) => chat.id), ['c1', 'c0']);
  assert.deepEqual(chats[0], good);
  assert.equal(chats[1].setup.who, 'new');
  const many = Array.from({ length: MAX_CHATS + 5 }, (_, index) => ({ ...newChat(existing(), `k${index}`, index) }));
  const kept = parseStoredChats(serializeChats(many));
  assert.equal(kept.length, MAX_CHATS);
  assert.equal(kept[0].id, `k${MAX_CHATS + 4}`);
});

test('errors read FastAPI details and say what to do', () => {
  assert.equal(errorDetail({ detail: 'bad clinic' }), 'bad clinic');
  assert.equal(errorDetail({ detail: [{ msg: 'field required' }, { msg: 'too long' }] }), 'field required; too long');
  assert.equal(errorDetail('x'), '');
  assert.match(replyErrorMessage(404), /turned off/);
  assert.match(replyErrorMessage(429), /Wait a moment/);
  assert.equal(replyErrorMessage(422, 'bad clinic'), 'The server refused this chat: bad clinic');
  assert.match(replyErrorMessage(500, 'Traceback secret'), /could not answer/);
  assert.match(replyErrorMessage(null), /connection/);
});

test('action labels cover the contract kinds and fall back to words', () => {
  assert.equal(actionLabel('find_times'), 'Looked for times');
  assert.equal(actionLabel('emergency'), 'Emergency');
  assert.equal(actionLabel('something_new'), 'Something new');
});

test('limits come from /options, with the backend defaults when missing or bad', () => {
  const options = parseOptions({ max_turns: 20, max_text_chars: 300, max_chat_chars: 5000 });
  assert.deepEqual([options.maxTurns, options.maxTextChars, options.maxChatChars], [20, 300, 5000]);
  const fallback = parseOptions({ max_turns: 0, max_text_chars: '1600', max_chat_chars: 2.5 });
  assert.deepEqual([fallback.maxTurns, fallback.maxTextChars, fallback.maxChatChars], [60, 1600, 40000]);
  assert.deepEqual([OPTIONS.maxTurns, OPTIONS.maxTextChars, OPTIONS.maxChatChars], [60, 1600, 40000]);
});

function chatWithTurns(turns: number, body = 'ok') {
  let chat = newChat(existing(), 'c-limit', 1);
  for (let index = 0; index < turns; index += 1) {
    chat = index % 2 === 0
      ? addPatientMessage(chat, body, ids(), 2)
      : applyReply(chat, { texts: [body], actions: [], model: '', ms: null }, ids, 3);
  }
  return chat;
}

test('the chat warns before max_turns and stops at it, where the backend would refuse with 422', () => {
  const options = parseOptions({ max_turns: 20 });
  assert.equal(chatRoom(chatWithTurns(8), options).warning, '');
  const near = chatRoom(chatWithTurns(10), options);
  assert.equal(near.near, true);
  assert.equal(near.full, false);
  assert.match(near.warning, /near the test limit \(10 more texts/);
  assert.equal(draftProblem(chatWithTurns(10), 'hi', options), '');
  // 19 turns: the request would be 19 history + 1 new = 20, still allowed.
  assert.equal(chatRoom(chatWithTurns(19), options).full, false);
  assert.equal(chatRoom(chatWithTurns(19), options).turnsLeft, 1);
  const full = chatRoom(chatWithTurns(20), options);
  assert.equal(full.full, true);
  assert.match(full.warning, /Start a new chat with the same setup/);
  assert.match(draftProblem(chatWithTurns(20), 'hi', options), /test limit/);
  // Notes are ours only and do not count.
  const quiet = applyReply(chatWithTurns(19), { texts: [], actions: [], model: '', ms: null }, ids, 4);
  assert.equal(chatRoom(quiet, options).turnsLeft, 1);
});

test('the backend 60 turn default applies when /options gave nothing', () => {
  assert.equal(chatRoom(chatWithTurns(59)).full, false);
  assert.equal(chatRoom(chatWithTurns(60)).full, true);
  assert.equal(chatRoom(chatWithTurns(50)).near, true);
});

test('long texts and long chats are refused in words, never cut to fit', () => {
  const options = parseOptions({ max_text_chars: 10, max_chat_chars: 30 });
  const chat = chatWithTurns(2, 'x'.repeat(10));
  assert.match(draftProblem(chat, 'y'.repeat(11), options), /11 characters; one text can be at most 10/);
  assert.equal(draftProblem(chat, 'y'.repeat(10), options), '');
  const longer = chatWithTurns(3, 'x'.repeat(10));
  assert.equal(chatRoom(longer, options).charsLeft, 0);
  assert.equal(chatRoom(longer, options).full, true);
  const almost = chatWithTurns(2, 'x'.repeat(12));
  assert.match(draftProblem(almost, 'y'.repeat(7), options), /too long for Elliot/);
  assert.equal(draftProblem(almost, 'y'.repeat(6), options), '');
});

test('continuing a chat keeps the setup, starts empty and marks the title once', () => {
  const chat = { ...chatWithTurns(4), title: 'Knee test' };
  const next = continueChat(chat, 'c-next', 99);
  assert.deepEqual(next.setup, chat.setup);
  assert.notEqual(next.setup, chat.setup);
  assert.deepEqual([next.id, next.messages, next.actions, next.created], ['c-next', [], [], 99]);
  assert.equal(next.title, 'Knee test (continued)');
  assert.equal(continueChat(next, 'c-3', 100).title, 'Knee test (continued)');
  assert.ok(continueChat({ ...chat, title: 'x'.repeat(60) }, 'c-4', 1).title.length <= 60);
});

// --- booked visit and open review (2026-11-02 eval: bk-02, ls-01) ------------------------------------

const VISIT = { at: '2026-11-03T09:00', therapist: ' Alan ', clinic: '' };

test('a booked visit is sent only for a Booked existing lead with a day and time', () => {
  const booked = requestSetup(existing({ status: 'booked', booked_visit: VISIT }));
  assert.deepEqual(booked.booked_visit, { at: '2026-11-03T09:00', therapist: 'Alan', clinic: '' });
  assert.equal(requestSetup(existing({ booked_visit: VISIT })).booked_visit, null);
  assert.equal(requestSetup(existing({ status: 'booked', booked_visit: { ...VISIT, at: '' } })).booked_visit, null);
  assert.equal(requestSetup({ ...existing({ status: 'booked', booked_visit: VISIT }), who: 'new' }).booked_visit, null);
  assert.equal(requestSetup(existing()).booked_visit, null);
});

test('open review goes to the backend; a new person never carries a card', () => {
  assert.equal(defaultSetup(OPTIONS).open_review, 'auto');
  assert.equal(requestSetup(existing({ open_review: 'front_desk' })).open_review, 'front_desk');
  assert.equal(requestSetup(existing({ open_review: 'full' })).open_review, 'full');
  assert.equal(requestSetup({ ...existing({ open_review: 'front_desk' }), who: 'new' }).open_review, 'auto');
  assert.equal(requestSetup({ ...existing({ open_review: 'none' }), who: 'new' }).open_review, 'none');
});

test('a booked visit with a therapist but no day and time is a problem', () => {
  assert.deepEqual(setupProblems(existing({ status: 'booked', booked_visit: { at: '', therapist: 'Alan', clinic: '' } })), ['Pick the booked visit’s day and time, or clear its therapist and clinic.']);
  assert.deepEqual(setupProblems(existing({ status: 'booked' })), []);
  // Not a Booked lead: the visit is ignored, so no problem.
  assert.deepEqual(setupProblems(existing({ booked_visit: { at: '', therapist: 'Alan', clinic: '' } })), []);
});

test('summary names the open review and the booked visit', () => {
  const setup = existing({ status: 'booked', open_review: 'front_desk', booked_visit: VISIT });
  assert.equal(visitLabel(setup), 'Tue, Nov 3, 9:00 AM with Alan at Laguna Niguel');
  assert.equal(visitLabel({ ...setup, booked_visit: { ...VISIT, therapist: '', clinic: 'Dana Point' } }), 'Tue, Nov 3, 9:00 AM at Dana Point');
  assert.equal(visitLabel(existing({ booked_visit: VISIT })), '');
  assert.equal(setupSummary(setup, OPTIONS), 'Existing lead (Booked) · Laguna Niguel · Physical Therapy, knee · Open review: front desk card only · Booked visit: Tue, Nov 3, 9:00 AM with Alan at Laguna Niguel · Front desk: auto · Clock: now · Model: gpt-5.5');
  assert.match(setupSummary(existing({ open_review: 'full' }), OPTIONS), / · Open review: full review · /);
});

test('stored chats from before the new fields open with auto review and no visit; new ones round-trip', () => {
  const oldSetup: Partial<Setup> = existing();
  delete oldSetup.open_review;
  delete oldSetup.booked_visit;
  const old = parseStoredChats(JSON.stringify([{ ...newChat(existing(), 'o1', 1), setup: oldSetup }]));
  assert.equal(old[0].setup.open_review, 'auto');
  assert.deepEqual(old[0].setup.booked_visit, { at: '', therapist: '', clinic: '' });
  const chat = newChat(existing({ status: 'booked', open_review: 'full', booked_visit: { at: '2026-11-03T09:00', therapist: 'Alan', clinic: 'Dana Point' } }), 'n1', 2);
  assert.deepEqual(parseStoredChats(serializeChats([chat]))[0].setup, chat.setup);
  const weird = parseStoredChats(JSON.stringify([{ ...chat, setup: { ...chat.setup, open_review: 'maybe', booked_visit: 'x' } }]));
  assert.equal(weird[0].setup.open_review, 'auto');
  assert.equal(weird[0].setup.booked_visit.at, '');
});
