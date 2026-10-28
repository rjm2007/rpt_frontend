import assert from 'node:assert/strict';
import test from 'node:test';
import { activeFilterCount, ALL_OWNERS, createdByDay, leadBoardUrl, leadListUrl, listSubtitle, NO_FILTERS, pageCount, pageRows, plural, readListState, refreshPlan, replaceColumns, shouldLoadMore } from './lead-list.ts';

test('list URL carries filters, search and the batch offset', () => {
  const url = new URL(leadListUrl({ source: 'sheet', stages: ['new', 'booked'], owner: 'Ana' }, ' smith ', 'Dana Point', 500), 'http://x');
  assert.equal(url.pathname, '/api/dashboard/lead-list');
  assert.deepEqual(url.searchParams.getAll('stage'), ['new', 'booked']);
  assert.equal(url.searchParams.get('source'), 'sheet');
  assert.equal(url.searchParams.get('owner'), 'Ana');
  assert.equal(url.searchParams.get('location'), 'Dana Point');
  assert.equal(url.searchParams.get('q'), 'smith');
  assert.equal(url.searchParams.get('offset'), '500');
  assert.equal(url.searchParams.get('limit'), '500');
});

test('no filters sends no filter params', () => {
  const url = new URL(leadListUrl(NO_FILTERS, '', 'All Locations', 0), 'http://x');
  assert.deepEqual([...url.searchParams.keys()], ['offset', 'limit']);
  assert.equal(activeFilterCount(NO_FILTERS), 0);
  assert.equal(activeFilterCount({ source: 'stride', stages: ['new', 'closed'], owner: 'Ana' }), 3);
});

test('board URL asks one column for its next cards', () => {
  const url = new URL(leadBoardUrl(ALL_OWNERS, 'ann', 'All Locations', 'cadence', 25), 'http://x');
  assert.equal(url.pathname, '/api/dashboard/lead-board');
  assert.deepEqual(url.searchParams.getAll('stage'), ['cadence']);
  assert.equal(url.searchParams.get('offset'), '25');
  assert.equal(url.searchParams.get('limit'), '25');
  assert.equal(url.searchParams.get('owner'), null);
});

test('pages are over the loaded rows', () => {
  const rows = Array.from({ length: 60 }, (_, index) => index);
  assert.equal(pageCount(60, 25), 3);
  assert.equal(pageCount(0, 25), 1);
  assert.deepEqual(pageRows(rows, 3, 25), rows.slice(50));
});

test('a column loads more only near its bottom and while cards are left', () => {
  assert.equal(shouldLoadMore(500, 400, 1000, 25, 60), true);
  assert.equal(shouldLoadMore(100, 400, 1000, 25, 60), false);
  assert.equal(shouldLoadMore(600, 400, 1000, 60, 60), false);
});

test('a board refresh re-reads each column as far as it was scrolled, in batches of 500', () => {
  assert.deepEqual(refreshPlan(0), [{ offset: 0, limit: 25 }]);
  assert.deepEqual(refreshPlan(25), [{ offset: 0, limit: 25 }]);
  assert.deepEqual(refreshPlan(142), [{ offset: 0, limit: 142 }]);
  assert.deepEqual(refreshPlan(1210), [{ offset: 0, limit: 500 }, { offset: 500, limit: 500 }, { offset: 1000, limit: 210 }]);
});

test('refreshing one column leaves the other columns as they were', () => {
  const current = { new: { rows: [1, 2], total: 2 }, cadence: { rows: Array.from({ length: 142 }, (_, i) => i), total: 300 } };
  const next = replaceColumns(current, { new: { rows: [3], total: 1 } });
  assert.deepEqual(next.new, { rows: [3], total: 1 });
  assert.equal(next.cadence, current.cadence);
  assert.equal(next.cadence.rows.length, 142);
});

test('subtitle follows the filters, with plurals', () => {
  assert.equal(plural(1, 'lead'), '1 lead');
  assert.equal(plural(1240, 'lead'), '1,240 leads');
  assert.equal(listSubtitle(0, 1240, true), '0 leads match · 1,240 in total');
  assert.equal(listSubtitle(1, 1240, true), '1 lead match · 1,240 in total');
  assert.equal(listSubtitle(1240, 1240, false), '1,240 leads in total');
});

test('leads created per day come from the backend counts, per clinic', () => {
  const rows = [{ day: '2026-10-27', location: 'Dana Point', count: 3 }, { day: '2026-10-27', location: '', count: 2 }, { day: '2026-10-28', location: 'Dana Point', count: 400 }];
  assert.deepEqual([...createdByDay(rows, 'All Locations')], [['2026-10-27', 5], ['2026-10-28', 400]]);
  assert.deepEqual([...createdByDay(rows, 'Mission Viejo')], []);
});

test('saved list state is checked before use', () => {
  assert.equal(readListState(null), null);
  assert.equal(readListState('{bad'), null);
  assert.equal(readListState('{"filters":{"source":"x"}}'), null);
  assert.deepEqual(readListState('{"search":"ann","filters":{"source":"sheet","stages":["new","zzz"],"owner":""},"page":"3","size":50,"loaded":1000}'),
    { search: 'ann', filters: { source: 'sheet', stages: ['new'], owner: ALL_OWNERS }, page: 3, size: 50, loaded: 1000 });
  assert.equal(readListState('{"filters":{"source":"all"},"size":7}')?.size, 25);
});
