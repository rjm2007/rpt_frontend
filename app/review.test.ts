import assert from 'node:assert/strict';
import test from 'node:test';
import { CLOSED_REVIEW_FALLBACK, closedReviewMessage, filterReviews, groupCounts, RESOLVED_MESSAGE, resolveRefusal, REVIEW_GROUPS, reviewOf, stageAfter } from './review.ts';
import type { Review } from './dashboard-data.ts';

const textReview: Review = {
  id: 1, code: 'sms_failed', group: 'text', group_label: 'Text failed', title: 'Text not delivered',
  reason: "The Day 0 text was not delivered: this number can't receive texts (likely a landline).",
  proof: [], flagged_at: '2026-10-21T16:00:00Z', source: 'text', source_label: 'Text message',
  landline: true, transcript_url: null,
  options: [{ choice: 'calls_only', label: 'Continue with calls only' }, { choice: 'front_desk', label: 'Front desk will handle' }],
};

test('a flagged lead without a review record still gets Continue / Front desk', () => {
  const review = reviewOf({ needs_review: true, review_reason: 'old words', review: null });
  assert.equal(review?.group, 'other');
  assert.deepEqual(review?.options.map((o) => o.choice), ['continue', 'front_desk']);
  assert.equal(reviewOf({ needs_review: false, review_reason: null, review: null }), null);
});

test('the review tab filters and counts by reason group', () => {
  const leads = [
    { needs_review: true, review_reason: null, review: textReview },
    { needs_review: true, review_reason: 'x', review: null },
  ];
  assert.equal(filterReviews(leads, 'text').length, 1);
  assert.equal(filterReviews(leads, 'all').length, 2);
  assert.deepEqual(groupCounts(leads), { all: 2, text: 1, other: 1 });
});

test('closing choices move the card to Closed, the rest back into cadence', () => {
  assert.equal(stageAfter('front_desk'), 'closed');
  assert.equal(stageAfter('wrong_number'), 'closed');
  assert.equal(stageAfter('calls_only'), 'cadence');
  assert.match(RESOLVED_MESSAGE.calls_only, /Texts are off/);
});

test('demo: appointment choices restart from Day 0 or text the link (which ends outreach)', () => {
  assert.equal(stageAfter('restart_cadence'), 'new');
  assert.equal(stageAfter('send_booking_link'), 'closed');
  assert.match(RESOLVED_MESSAGE.restart_cadence, /Day 0/);
  const booking: Review = { ...textReview, code: 'booking_unclear', group: 'booking', group_label: 'Booking', options: [{ choice: 'front_desk', label: 'Front desk will handle' }] };
  assert.deepEqual(groupCounts([{ needs_review: true, review_reason: null, review: booking }]), { all: 1, booking: 1 });
});

test('a review closed after the page loaded says why, or a plain fallback', () => {
  const replaced = 'This lead was closed: a newer Sheet row uses the same phone number. Its history is kept.';
  assert.equal(closedReviewMessage({ review: null, closed: { reason: 'replaced', message: replaced } }), replaced);
  assert.equal(closedReviewMessage({ review: null, closed: { reason: 'resolved', message: 'This review was already resolved by Emma: Continue.' } }),
    'This review was already resolved by Emma: Continue.');
  // An older backend sends no `closed`.
  assert.equal(closedReviewMessage({ review: null }), CLOSED_REVIEW_FALLBACK);
  assert.equal(closedReviewMessage({ review: textReview, closed: null }), null);
  assert.equal(closedReviewMessage(null), null);
});

test('2026-10-25: every restart choice moves the card to New and says Day 0', () => {
  for (const choice of ['restart_cadence', 'use_new_name_restart', 'keep_old_name_restart', 'use_new_value_restart', 'keep_old_value_restart'] as const) {
    assert.equal(stageAfter(choice), 'new');
    assert.match(RESOLVED_MESSAGE[choice], /Day 0/);
  }
  assert.equal(stageAfter('use_new_value'), 'cadence');
  assert.equal(stageAfter('keep_old_value'), 'cadence');
});

test('2026-10-25: location / case / date of birth reviews have their own filter group', () => {
  assert.ok(REVIEW_GROUPS.some((group) => group.value === 'details' && group.label === 'Details changed'));
  const details: Review = { ...textReview, code: 'location_changed', group: 'details', group_label: 'Details changed' };
  assert.deepEqual(groupCounts([{ needs_review: true, review_reason: null, review: details }]), { all: 1, details: 1 });
  assert.equal(filterReviews([{ needs_review: true, review_reason: null, review: details }], 'details').length, 1);
});

test('a refused choice is said in the pop-up', () => {
  assert.equal(resolveRefusal('The cadence was already restarted in the last 10 minutes. Try the restart again later.'),
    'Not saved: The cadence was already restarted in the last 10 minutes. Try the restart again later.');
  assert.equal(resolveRefusal(''), 'Not saved. Close this and try again.');
});
