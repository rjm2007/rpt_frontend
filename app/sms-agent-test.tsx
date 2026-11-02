'use client';

// Administration -> SMS agent test (/administration/sms-agent-test): chat with Elliot by text as a
// made-up patient. Sandbox only: the backend runs the same agent but sends nothing and saves nothing.
// Chats stay in this browser (localStorage); logic lives in sms-agent-test-data.ts (unit tested).

import { FormEvent, KeyboardEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { dashboardFetch } from './dashboard-client';
import styles from './sms-agent-test.module.css';
import {
  actionLabel, addPatientMessage, applyReply, awaitingReply, chatPreview, chatRoom, chatTranscript, continueChat, defaultSetup,
  draftProblem, EMPTY_OPTIONS, errorDetail, FRONT_DESK_LABELS, newChat, OPEN_REVIEW_LABELS, visitApplies, normalizeClock, OPTIONS_URL, parseOptions, parseReply,
  parseStoredChats, renameChat, REPLY_URL, replyErrorMessage, replyRequestFor, resetChat, sameSenderAsPrevious,
  serializeChats, setupProblems, setupSummary, showTimeAbove, sortChats, STORAGE_KEY,
  type BookedVisit, type Chat, type Choice, type Options, type OpenReview, type Setup,
} from './sms-agent-test-data';

// The model can take 10-30 s with tool rounds; past this the page stops waiting and offers Retry.
const REPLY_TIMEOUT_MS = 90_000;

// Stamps are taken outside any component so render stays pure (same as assistant.tsx's touch()).
function now() { return Date.now(); }

function makeId() {
  try { return crypto.randomUUID(); } catch { return `${now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
}

function loadChats(): Chat[] {
  try { return parseStoredChats(localStorage.getItem(STORAGE_KEY)); } catch { return []; }
}
function saveChats(chats: Chat[]) {
  try { localStorage.setItem(STORAGE_KEY, serializeChats(chats)); } catch { /* storage full or blocked: the chat still works for this visit */ }
}

function timeOf(at: number) { return new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
function dayTimeOf(at: number) {
  const date = new Date(at);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay ? `Today ${timeOf(at)}` : `${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${timeOf(at)}`;
}
function listTime(at: number) {
  const date = new Date(at);
  return date.toDateString() === new Date().toDateString() ? timeOf(at) : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function PageHeading({ title, subtitle, tools }: { title: string; subtitle: string; tools?: ReactNode }) {
  return <header className="page-heading"><div><h1>{title}</h1><p>{subtitle}</p></div>{tools && <div className="page-tools">{tools}</div>}</header>;
}
function Note({ children, tone = 'info', action }: { children: ReactNode; tone?: 'info' | 'warning' | 'danger'; action?: ReactNode }) {
  return <div className={`alert ${tone}`} role={tone === 'danger' ? 'alert' : undefined}><b aria-hidden="true">{tone === 'info' ? 'i' : '!'}</b><div className={styles.noteBody}><span>{children}</span>{action}</div></div>;
}

function Icon({ name }: { name: 'plus' | 'send' | 'back' | 'trash' | 'edit' }) {
  const path = name === 'plus' ? <path d="M12 5v14M5 12h14" />
    : name === 'send' ? <path d="M12 19V5M5 12l7-7 7 7" />
    : name === 'back' ? <path d="m15 5-7 7 7 7" />
    : name === 'trash' ? <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>
    : <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13 7 4 4" /></>;
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>;
}

// A <select> when the backend gave choices, a text box when it did not (options failed to load).
function ChoiceField({ label, value, choices, onChange, allowBlank = false }: { label: string; value: string; choices: Choice[]; onChange: (value: string) => void; allowBlank?: boolean }) {
  const list = value && !choices.some((choice) => choice.value === value) ? [{ value, label: value }, ...choices] : choices;
  return <label>{label}{choices.length
    ? <select value={value} onChange={(event) => onChange(event.target.value)}>{allowBlank && <option value="">Not set</option>}{list.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select>
    : <input value={value} onChange={(event) => onChange(event.target.value)} />}</label>;
}

function SetupForm({ initial, options, onStart, onCancel }: { initial: Setup; options: Options; onStart: (setup: Setup) => void; onCancel?: () => void }) {
  const [setup, setSetup] = useState<Setup>(initial);
  const [clockMode, setClockMode] = useState<'now' | 'chosen'>(initial.clock ? 'chosen' : 'now');
  const [tried, setTried] = useState(false);
  const patch = (next: Partial<Setup>) => setSetup((current) => ({ ...current, ...next }));
  const patchVisit = (next: Partial<BookedVisit>) => setSetup((current) => ({ ...current, booked_visit: { ...current.booked_visit, ...next } }));
  const problems = setupProblems(setup, clockMode);
  // The choices may arrive after the form opened: fill only what is still blank, keep what was typed.
  useEffect(() => {
    setSetup((current) => ({ // eslint-disable-line react-hooks/set-state-in-effect
      ...current,
      status: current.status || options.statuses[0]?.value || '',
      clinic: current.clinic || options.clinics[0]?.value || '',
      service: current.service || options.services[0]?.value || '',
      model: current.model || options.defaultModel,
    }));
  }, [options]);
  function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (problems.length) return;
    onStart({ ...setup, clock: clockMode === 'now' ? null : normalizeClock(setup.clock) });
  }
  return <form className={styles.setup} onSubmit={submit} noValidate>
    <h2>New test chat</h2>
    <p className={styles.muted}>Made-up details only. Nothing is texted, booked or saved; chats stay in this browser.</p>
    <fieldset className={styles.segment}>
      <legend>Who is texting</legend>
      {(['existing', 'new'] as const).map((who) => <label key={who} className={setup.who === who ? styles.segmentOn : ''}><input type="radio" name="who" checked={setup.who === who} onChange={() => patch({ who })} />{who === 'existing' ? 'Existing lead' : 'New person'}</label>)}
    </fieldset>
    {setup.who === 'new'
      ? <p className={styles.muted}>Someone not in our system (phase 2): Elliot has to ask for their name, birthday, clinic and service.</p>
      : <div className="form-grid">
        <ChoiceField label="Status" value={setup.status} choices={options.statuses} onChange={(status) => patch({ status })} />
        <ChoiceField label="Clinic" value={setup.clinic} choices={options.clinics} onChange={(clinic) => patch({ clinic })} />
        <ChoiceField label="Service" value={setup.service} choices={options.services} onChange={(service) => patch({ service })} />
        <label>Referral word<input value={setup.referral_word} placeholder="e.g. knee" maxLength={40} onChange={(event) => patch({ referral_word: event.target.value })} /></label>
        <label>First name<input value={setup.first_name} maxLength={40} autoComplete="off" onChange={(event) => patch({ first_name: event.target.value })} /></label>
        <label>Last name<input value={setup.last_name} maxLength={40} autoComplete="off" onChange={(event) => patch({ last_name: event.target.value })} /></label>
        <label>Birthday<input type="date" value={setup.date_of_birth} onChange={(event) => patch({ date_of_birth: event.target.value })} /></label>
        <label>Open review<select value={setup.open_review} onChange={(event) => patch({ open_review: event.target.value as OpenReview })}>{(['auto', 'none', 'front_desk', 'full'] as const).map((value) => <option key={value} value={value}>{OPEN_REVIEW_LABELS[value]}</option>)}</select></label>
        {visitApplies(setup) && <>
          <label>Booked visit day and time (clinic, Pacific)<input type="datetime-local" value={setup.booked_visit.at} onChange={(event) => patchVisit({ at: event.target.value })} /></label>
          <label>Booked visit therapist<input value={setup.booked_visit.therapist} placeholder="e.g. Alan" maxLength={60} autoComplete="off" onChange={(event) => patchVisit({ therapist: event.target.value })} /></label>
          <ChoiceField label="Booked visit clinic" value={setup.booked_visit.clinic} choices={options.clinics} allowBlank onChange={(clinic) => patchVisit({ clinic })} />
        </>}
      </div>}
    <div className="form-grid">
      <label>Front desk<select value={setup.front_desk} onChange={(event) => patch({ front_desk: event.target.value as Setup['front_desk'] })}>{(['auto', 'open', 'closed'] as const).map((value) => <option key={value} value={value}>{FRONT_DESK_LABELS[value]}</option>)}</select></label>
      <ChoiceField label="Model" value={setup.model} choices={options.models} onChange={(model) => patch({ model })} />
      <label>Clock<select value={clockMode} onChange={(event) => setClockMode(event.target.value as 'now' | 'chosen')}><option value="now">Now</option><option value="chosen">A chosen day and time</option></select></label>
      {clockMode === 'chosen' && <label>Day and time (clinic, Pacific)<input type="datetime-local" value={setup.clock ?? ''} onChange={(event) => patch({ clock: event.target.value || null })} /></label>}
    </div>
    {tried && problems.length > 0 && <ul className={styles.problems} role="alert">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
    <div className={styles.setupButtons}>
      {onCancel && <button type="button" className="secondary" onClick={onCancel}>Cancel</button>}
      <button type="submit" className="primary">Start chat</button>
    </div>
  </form>;
}

type Failure = { chatId: string; message: string };

export function SmsAgentTestPage() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState('');
  const [creating, setCreating] = useState<Setup | null>(null);
  const [options, setOptions] = useState<Options>(EMPTY_OPTIONS);
  const [optionsError, setOptionsError] = useState('');
  const [optionsKey, setOptionsKey] = useState(0);
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [failure, setFailure] = useState<Failure | null>(null);
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('chat');
  const [copied, setCopied] = useState('');
  const [formKey, setFormKey] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    // localStorage exists only in the browser: read it after hydration.
    const stored = loadChats();
    setChats(stored); // eslint-disable-line react-hooks/set-state-in-effect
    setActiveId(stored[0]?.id ?? '');
    setLoaded(true);
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { if (loaded) saveChats(chats); }, [chats, loaded]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const response = await dashboardFetch(OPTIONS_URL);
        const body: unknown = await response.json().catch(() => null);
        if (!live) return;
        if (!response.ok) { setOptionsError(replyErrorMessage(response.status, errorDetail(body))); return; }
        setOptions(parseOptions(body));
        setOptionsError('');
      } catch {
        if (live) setOptionsError(replyErrorMessage(null));
      }
    })();
    return () => { live = false; };
  }, [optionsKey]);

  const active = chats.find((chat) => chat.id === activeId) ?? null;
  const busy = Boolean(active && pending.has(active.id));
  const activeFailure = active && failure?.chatId === active.id ? failure.message : '';
  // The backend's limits (/options): warn before them, and never send (or cut) what it would refuse.
  const room = active ? chatRoom(active, options) : null;
  const sendProblem = active && draft.trim() ? draftProblem(active, draft, options) : '';

  // A new chat with nothing stored yet opens the setup form straight away.
  useEffect(() => { if (loaded && !chats.length && !creating) setCreating(defaultSetup(options)); }, [loaded, chats.length, creating, options]); // eslint-disable-line react-hooks/set-state-in-effect

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [active?.messages.length, busy, activeFailure]);

  const updateChat = useCallback((id: string, change: (chat: Chat) => Chat) => {
    setChats((current) => current.map((chat) => chat.id === id ? change(chat) : chat));
  }, []);

  async function requestReply(chat: Chat) {
    const request = replyRequestFor(chat);
    if (!request) return;
    setFailure((current) => current?.chatId === chat.id ? null : current);
    setPending((current) => new Set(current).add(chat.id));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REPLY_TIMEOUT_MS);
    try {
      const response = await dashboardFetch(REPLY_URL, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw Object.assign(new Error(replyErrorMessage(response.status, errorDetail(body))), { shown: true });
      const reply = parseReply(body);
      // The chat may have been reset or deleted while Elliot was typing: only apply to the same text.
      updateChat(chat.id, (current) => awaitingReply(current) && current.messages[current.messages.length - 1].id === chat.messages[chat.messages.length - 1].id
        ? applyReply(current, reply, makeId, now()) : current);
    } catch (error) {
      const message = (error as { shown?: boolean }).shown ? (error as Error).message
        : (error as Error).name === 'AbortError' ? replyErrorMessage(504) : replyErrorMessage(null);
      if (mounted.current) setFailure({ chatId: chat.id, message });
    } finally {
      clearTimeout(timer);
      if (mounted.current) setPending((current) => { const next = new Set(current); next.delete(chat.id); return next; });
    }
  }

  function send(event?: FormEvent) {
    event?.preventDefault();
    const body = draft.trim();
    if (!active || !body || busy || draftProblem(active, body, options)) return;
    const next = addPatientMessage(active, body, makeId(), now());
    setChats((current) => current.map((chat) => chat.id === next.id ? next : chat));
    setDraft('');
    void requestReply(next);
  }
  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
  }
  function retry() { if (active && !busy) void requestReply(active); }

  // A new chat starts from the open chat's setup: testing one change at a time is the usual case.
  function startNew() { setCreating(active ? { ...active.setup } : defaultSetup(options)); setFormKey((key) => key + 1); setMobileView('chat'); }
  function create(setup: Setup) {
    const chat = newChat(setup, makeId(), now());
    setChats((current) => [chat, ...current]);
    setActiveId(chat.id);
    setCreating(null);
    setDraft('');
    setTimeout(() => input.current?.focus(), 0);
  }
  // At the limit: same setup, empty texts, and the unsent draft carried over so nothing is lost.
  function continueFrom(chat: Chat) {
    const next = continueChat(chat, makeId(), now());
    setChats((current) => [next, ...current]);
    setActiveId(next.id);
    setCreating(null);
    setMobileView('chat');
    setTimeout(() => input.current?.focus(), 0);
  }
  function open(id: string) { setActiveId(id); setCreating(null); setDraft(''); setMobileView('chat'); }
  function remove(chat: Chat) {
    if (chat.messages.length && !window.confirm(`Delete "${chat.title}"? This cannot be undone.`)) return;
    const rest = chats.filter((item) => item.id !== chat.id);
    setChats(rest);
    if (chat.id === activeId) { setActiveId(sortChats(rest)[0]?.id ?? ''); setDraft(''); }
    if (failure?.chatId === chat.id) setFailure(null);
  }
  function reset() {
    if (!active || busy) return;
    if (active.messages.length && !window.confirm('Clear this chat\'s texts? The setup stays.')) return;
    updateChat(active.id, (chat) => resetChat(chat, now()));
    setFailure(null);
  }
  function saveRename(event?: FormEvent) {
    event?.preventDefault();
    if (!renaming) return;
    updateChat(renaming.id, (chat) => renameChat(chat, renaming.title, now()));
    setRenaming(null);
  }
  async function copy() {
    if (!active) return;
    const transcript = chatTranscript(active, options, Intl.DateTimeFormat().resolvedOptions().timeZone);
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied('Copied');
    } catch {
      // Clipboard blocked (no HTTPS, permissions): fall back to a hidden text box.
      const area = document.createElement('textarea');
      area.value = transcript; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.appendChild(area); area.select();
      const ok = document.execCommand('copy');
      area.remove();
      setCopied(ok ? 'Copied' : 'Copy failed');
    }
    setTimeout(() => { if (mounted.current) setCopied(''); }, 2000);
  }

  const ordered = sortChats(chats);
  const showSetup = creating !== null;
  const setupForm = creating && <SetupForm key={formKey} initial={creating} options={options} onStart={create} onCancel={chats.length ? () => setCreating(null) : undefined} />;

  return <div className={styles.page}>
    <PageHeading title="SMS agent test" subtitle="Chat with Elliot by text as a test patient. Nothing is sent or saved." />
    {optionsError && <Note tone="warning" action={<button type="button" className="secondary" onClick={() => setOptionsKey((key) => key + 1)}>Retry</button>}>Chat choices could not be loaded: {optionsError}</Note>}
    <div className={`${styles.layout} ${mobileView === 'list' ? styles.showList : styles.showChat}`}>
      <aside className={styles.list} aria-label="Test chats">
        <div className={styles.listHead}>
          <h2>Chats</h2>
          <button type="button" className="primary" onClick={startNew}><Icon name="plus" />New chat</button>
        </div>
        {!ordered.length && <p className={styles.muted}>No chats yet.</p>}
        <ul>
          {ordered.map((chat) => <li key={chat.id} className={chat.id === activeId && !showSetup ? styles.selected : ''}>
            {renaming?.id === chat.id
              ? <form className={styles.rename} onSubmit={saveRename}>
                <label className="sr-only" htmlFor={`rename-${chat.id}`}>Chat name</label>
                <input id={`rename-${chat.id}`} autoFocus value={renaming.title} maxLength={60} onChange={(event) => setRenaming({ id: chat.id, title: event.target.value })} onBlur={() => saveRename()} onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null); }} />
              </form>
              : <button type="button" className={styles.chatButton} aria-current={chat.id === activeId && !showSetup ? 'true' : undefined} onClick={() => open(chat.id)}>
                <span className={styles.avatar} aria-hidden="true">{chat.setup.who === 'new' ? '?' : (chat.title.trim()[0] ?? 'E').toUpperCase()}</span>
                <span className={styles.chatText}><strong>{chat.title}</strong><small>{pending.has(chat.id) ? 'Elliot is typing…' : chatPreview(chat)}</small></span>
                <time>{listTime(chat.updated)}</time>
              </button>}
            <span className={styles.rowTools}>
              <button type="button" title="Rename" aria-label={`Rename ${chat.title}`} onClick={() => setRenaming({ id: chat.id, title: chat.title })}><Icon name="edit" /></button>
              <button type="button" title="Delete" aria-label={`Delete ${chat.title}`} onClick={() => remove(chat)}><Icon name="trash" /></button>
            </span>
          </li>)}
        </ul>
        <p className={styles.foot}>Chats are kept only in this browser.</p>
      </aside>

      <section className={styles.phone} aria-label="Chat">
        {showSetup
          ? <><div className={styles.phoneHead}><button type="button" className={styles.back} onClick={() => setMobileView('list')}><Icon name="back" />Chats</button></div>
            <div className={styles.setupScroll}>{setupForm}</div></>
          : !active
            ? <div className={styles.empty}><p>Pick a chat or start a new one.</p><button type="button" className="primary" onClick={startNew}>New chat</button></div>
            : <>
              <div className={styles.phoneHead}>
                <button type="button" className={styles.back} onClick={() => setMobileView('list')}><Icon name="back" />Chats</button>
                <div className={styles.contact}><span className={styles.avatar} aria-hidden="true">E</span><div><strong>Elliot · Rausch PT</strong><small title={setupSummary(active.setup, options)}>{active.title}: {setupSummary(active.setup, options)}</small></div></div>
                <div className={styles.headTools}>
                  <button type="button" className="secondary" onClick={() => void copy()}>{copied || 'Copy chat'}</button>
                  <button type="button" className="secondary" disabled={busy || !active.messages.length} onClick={reset}>Reset chat</button>
                </div>
              </div>
              <div className={styles.messages} ref={scroller} aria-live="polite">
                {!active.messages.length && <p className={styles.hint}>Text Elliot as {active.setup.who === 'new' ? 'someone new' : active.setup.first_name || 'the patient'}. Try “Hi, can I book for next week?”</p>}
                {active.messages.map((message, index) => <div key={message.id} className={styles.row}>
                  {showTimeAbove(active.messages, index) && <p className={styles.stamp}>{dayTimeOf(message.at)}</p>}
                  {message.role === 'note'
                    ? <p className={styles.quiet}>{message.text}{message.meta && <span> · {message.meta}</span>}</p>
                    : <div className={`${styles.bubble} ${message.role === 'patient' ? styles.mine : styles.theirs} ${sameSenderAsPrevious(active.messages, index) ? styles.joined : ''}`} title={timeOf(message.at)}>
                      {message.text}
                    </div>}
                  {message.role !== 'note' && message.meta && <p className={styles.meta}>{timeOf(message.at)} · {message.meta}</p>}
                </div>)}
                {busy && <div className={`${styles.bubble} ${styles.theirs} ${styles.typing}`} aria-label="Elliot is typing"><i /><i /><i /></div>}
                {!busy && activeFailure && <div className={styles.failure} role="alert"><span>{activeFailure}</span><button type="button" className="secondary" onClick={retry}>Retry</button></div>}
                {!busy && !activeFailure && awaitingReply(active) && <div className={styles.failure}><span>This text has no reply yet.</span><button type="button" className="secondary" onClick={retry}>Get reply</button></div>}
              </div>
              {room?.warning && <Note tone={room.full ? 'danger' : 'warning'} action={<button type="button" className="secondary" disabled={busy} onClick={() => continueFrom(active)}>Start a new chat with the same setup</button>}>{room.warning}</Note>}
              {sendProblem && !room?.full && <p className={styles.problems} role="alert">{sendProblem}</p>}
              <form className={styles.composer} onSubmit={send}>
                <label className="sr-only" htmlFor="sms-test-input">Text message</label>
                {/* No maxLength: a pasted long text would be cut without a word; draftProblem says why it cannot go instead. */}
                <textarea id="sms-test-input" ref={input} rows={1} value={draft} placeholder={room?.full ? 'This chat is full' : 'Text message'} disabled={room?.full} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKey} />
                <button type="submit" className={styles.send} aria-label="Send" disabled={busy || !draft.trim() || Boolean(sendProblem)}><Icon name="send" /></button>
              </form>
            </>}
      </section>

      <details className={styles.actions} open>
        <summary>What Elliot did{active && active.actions.length > 0 ? ` (${active.actions.length})` : ''}</summary>
        <p className={styles.muted}>Pretend only: nothing is booked, changed or sent.</p>
        {!active || showSetup || !active.actions.length
          ? <p className={styles.muted}>Nothing yet. Times Elliot looks up, bookings, hand-offs and statuses show here.</p>
          : <ol>{[...active.actions].reverse().map((action) => <li key={action.id}>
            <strong>{actionLabel(action.kind)}{action.result_code && <code>{action.result_code}</code>}</strong>
            {action.summary && <span>{action.summary}</span>}
            <small>{timeOf(action.at)}</small>
          </li>)}</ol>}
      </details>
    </div>
  </div>;
}
