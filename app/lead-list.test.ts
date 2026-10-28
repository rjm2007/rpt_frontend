import assert from 'node:assert/strict';
import test from 'node:test';
import { activeFilterCount, ALL_OWNERS, leadBoardUrl, leadListUrl, NO_FILTERS, pageCount, pageRows, shouldLoadMore } from './lead-list.ts';

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
