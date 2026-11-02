'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { ModalShell } from './dashboard-controls';
import { dashboardGet } from './dashboard-client';
import type { Review, ReviewChoice, ReviewPreview } from './dashboard-data';
import { CLINIC_TZ, CLINIC_TZ_LABEL } from './display';
import { choiceLabel, choiceTone, closedReviewMessage, confirmLabel, RESOLVED_MESSAGE, resolveRefusal, reviewAge } from './review';

type ResolveAction = (path: string, method: string, body?: unknown, successMessage?: string, onError?: (message: string) => void) => Promise<Record<string, unknown> | null>;

function flaggedOn(value: string | null) {
  if (!value) return 'Date not recorded';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return 'Date not recorded';
  return `${parsed.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: CLINIC_TZ })} ${CLINIC_TZ_LABEL}`;
}

// What each choice will do (GET review/{id}), fetched when a card is shown so the choices can say it
// and the confirm pop-up opens with it. Kept 30 s; the pop-up still re-reads it on open, because the
// next step depends on the clock and on the lead's schedule right now.
const PREVIEW_TTL = 30000;
const previews = new Map<string, { at: number; request: Promise<ReviewPreview>; data?: ReviewPreview }>();
function loadPreview(leadId: string, fresh = false): Promise<ReviewPreview> {
  const cached = previews.get(leadId);
  if (!fresh && cached && Date.now() - cached.at < PREVIEW_TTL) return cached.request;
  const entry: { at: number; request: Promise<ReviewPreview>; data?: ReviewPreview } = { at: Date.now(), request: dashboardGet<ReviewPreview>(`/api/dashboard/review/${leadId}`) };
  previews.set(leadId, entry);
  entry.request.then((data) => { entry.data = data; }, () => { if (previews.get(leadId) === entry) previews.delete(leadId); });
  return entry.request;
}
// `live`: the answer came from the network while this component was shown (not the cache).
function usePreview(leadId: string | undefined, fresh = false) {
  const [state, setState] = useState<{ id: string; preview: ReviewPreview | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!leadId) return;
    let live = true;
    loadPreview(leadId, fresh)
      .then((data) => { if (live) setState({ id: leadId, preview: data, failed: false }); })
      .catch(() => { if (live) setState({ id: leadId, preview: null, failed: true }); });
    return () => { live = false; };
  }, [leadId, fresh]);
  const current = state && state.id === leadId ? state : null;
  const early = leadId ? previews.get(leadId)?.data ?? null : null;
  return { preview: current?.preview ?? early, failed: current?.failed ?? false, live: Boolean(current?.preview) };
}

const TONE_CLASS = { primary: 'is-primary', neutral: '', danger: 'is-danger' } as const;

// What was flagged, why, the proof, then one row per choice with what it will do.
// `leadId` (optional) lets the card load each choice's effect ahead of the confirm pop-up.
export function ReviewCard({ review, onChoose, busy = false, compact = false, leadId, canUnblock = false, unblockHref }: { review: Review; onChoose?: (choice: ReviewChoice) => void; busy?: boolean; compact?: boolean; leadId?: string; canUnblock?: boolean; unblockHref?: string }) {
  const { preview } = usePreview(onChoose && !compact ? leadId : undefined);
  const effects = new Map((preview?.review?.id === review.id ? preview?.options ?? [] : []).map((item) => [item.choice, item.effect]));
  const age = reviewAge(review.flagged_at);
  const labelId = `review-options-${review.id ?? review.code}`;
  return <div className="review-card">
    <header className="review-card-head">
      <div className="review-card-tags"><span className="status-pill review-group">{review.group_label}</span>{review.landline && <span className="status-pill plain">Landline</span>}<small title={flaggedOn(review.flagged_at)}>{age ? `Flagged ${age === 'just now' ? 'just now' : `${age} ago`}` : 'Flagged'} · {flaggedOn(review.flagged_at)}</small></div>
      <h3>{review.title}</h3>
    </header>
    <section className="review-section" aria-label="What happened">
      <h4>What happened</h4>
      <p className="review-reason">{review.reason}</p>
    </section>
    <section className="review-section" aria-label="Evidence">
      <h4>Evidence</h4>
      <dl className="review-proof">
        {review.proof.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
        <div><dt>Source</dt><dd>{review.source_label}</dd></div>
      </dl>
      {review.transcript_url && <Link className="secondary review-transcript" href={review.transcript_url}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" /></svg>Read the call transcript</Link>}
    </section>
    {review.group === 'blocked' && <p className="review-note">{!canUnblock ? 'Ask an admin to unblock this number on the lead’s page.'
      : unblockHref ? <>Unblock the number on the lead’s page (continue or start over). <Link className="text-action" href={unblockHref}>Open lead to unblock →</Link></>
      : 'Use Unblock number in the red banner on this page (continue or start over).'}</p>}
    {Boolean(review.also?.length) && <p className="review-note">{review.also!.length} more open on this lead: {review.also!.map((item) => item.title).join(', ')}. They are resolved one at a time, oldest first; the lead stays paused until the last one.</p>}
    {onChoose && !compact && <div className="review-options" role="group" aria-labelledby={labelId}>
      <h4 id={labelId}>What do you want to do?</h4>
      {review.options.map((option, index) => {
        const tone = choiceTone(option.choice, index);
        const effect = effects.get(option.choice);
        return <button key={option.choice} type="button" className={`review-choice ${TONE_CLASS[tone]}`} disabled={busy} onClick={() => onChoose(option.choice)}>
          <strong>{choiceLabel(option.label)}</strong>
          <span>{effect ? `${effect}.` : RESOLVED_MESSAGE[option.choice]}</span>
        </button>;
      })}</div>}
  </div>;
}

// The confirm pop-up: what the choice does and the next step, from the backend, plus an optional note.
export function ResolveDialog({ leadId, choice, action, onClose, onResolved }: { leadId: string; choice: ReviewChoice; action: ResolveAction; onClose: () => void; onResolved?: (choice: ReviewChoice) => void }) {
  // Shows the prefetched preview at once, then the fresh one (never older than this pop-up).
  const loaded = usePreview(leadId, true);
  const preview = loaded.preview;
  const failed = loaded.failed;
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  // A refused choice (e.g. restarted less than 10 minutes ago) is said here, not only in a toast.
  const [refused, setRefused] = useState('');
  const option = preview?.options.find((item) => item.choice === choice);
  const tone = choiceTone(choice, preview?.review?.options.findIndex((item) => item.choice === choice) ?? 1);
  // The review closed after this page loaded: say why, and reload the page on close so the stale
  // Resolve review button and Paused badge go away.
  const closedMessage = loaded.live ? closedReviewMessage(preview) : null;
  const close = closedMessage ? () => window.location.reload() : onClose;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setRefused('');
    // With another review still open the lead stays paused; say so instead of "Outreach continues".
    const more = option?.next_step.includes('next open review');
    const result = await action(`review/${leadId}/resolve`, 'POST', { choice, note: note.trim() || undefined }, more ? 'Saved. The next open review for this lead is shown now.' : option?.done || RESOLVED_MESSAGE[choice], setRefused);
    setSaving(false);
    previews.delete(leadId);
    if (result) { onResolved?.(choice); onClose(); }
  }
  if (closedMessage) return <ModalShell className="resolve-dialog" labelId="resolve-title" onClose={close}>
    <header><div><h2 id="resolve-title">Review already closed</h2><p>{preview?.full_name}</p></div><button className="close-button" type="button" onClick={close} aria-label="Close">×</button></header>
    <div className="review-dialog-body"><p className="field-error" role="alert">{closedMessage}</p>
      <footer><button className="primary" type="button" onClick={close}>Refresh page</button></footer></div>
  </ModalShell>;
  return <ModalShell className="resolve-dialog" labelId="resolve-title" onClose={onClose}>
    <header><div><h2 id="resolve-title">{option ? choiceLabel(option.label) : 'Resolve review'}</h2><p>{preview ? preview.full_name : 'Loading…'}</p></div><button className="close-button" type="button" onClick={onClose} aria-label="Close">×</button></header>
    <form onSubmit={submit}>
      {failed ? <p className="field-error" role="alert">The review could not be loaded. Close this and try again.</p>
        : !preview ? <p className="muted">Checking what this will do…</p>
        : !option ? (loaded.live ? <p className="field-error" role="alert">This choice is no longer available for this review. Close this and pick again.</p> : <p className="muted">Checking what this will do…</p>)
        : <div className={`resolve-summary ${tone === 'danger' ? 'is-danger' : ''}`}><p><strong>{option.effect}.</strong></p><p>{option.next_step}</p></div>}
      {refused && <p className="field-error" role="alert">{resolveRefusal(refused)}</p>}
      <label className="field-label">Note (optional)<textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Called the patient, the number is a landline" /></label>
      <footer><button className="secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className={tone === 'danger' ? 'danger-button' : 'primary'} type="submit" disabled={saving || !option || !loaded.live}>{saving ? 'Saving…' : confirmLabel(choice)}</button></footer>
    </form>
  </ModalShell>;
}
