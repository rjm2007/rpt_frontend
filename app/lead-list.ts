// Leads page paging and filters (no React, unit tested in lead-list.test.ts).
//
// 2026-10-28: the snapshot stopped at the newest 250 leads, so older leads could not be listed,
// searched or seen on the board. The list now loads batches of 500 from `lead-list` (filters and
// search done by the backend across every lead) and pages over what is loaded; the board loads 25
// cards per column from `lead-board` and more as a column scrolls.
import type { LeadStage } from './dashboard-data';

export type LeadSource = 'all' | 'sheet' | 'stride';
export type LeadFilters = { source: LeadSource; stages: LeadStage[]; owner: string };

export const LIST_BATCH = 500;
export const BOARD_BATCH = 25;
export const PAGE_SIZES = [25, 50, 100] as const;
export const ALL_OWNERS = 'All Owners';
export const NO_FILTERS: LeadFilters = { source: 'all', stages: [], owner: ALL_OWNERS };
export const SOURCE_LABELS: Record<LeadSource, string> = { all: 'All', sheet: 'Google Sheet', stride: 'Stride' };

// Filters and search shared by the list and the board (the board has no source: leads only).
function baseParams(filters: Pick<LeadFilters, 'stages' | 'owner'>, query: string, location: string) {
  const params = new URLSearchParams();
  filters.stages.forEach((stage) => params.append('stage', stage));
  if (filters.owner && filters.owner !== ALL_OWNERS) params.set('owner', filters.owner);
  if (location && location !== 'All Locations') params.set('location', location);
  if (query.trim()) params.set('q', query.trim());
  return params;
}

export function leadListUrl(filters: LeadFilters, query: string, location: string, offset: number) {
  const params = baseParams(filters, query, location);
  if (filters.source !== 'all') params.set('source', filters.source);
  params.set('offset', String(offset));
  params.set('limit', String(LIST_BATCH));
  return `/api/dashboard/lead-list?${params}`;
}

// No stage: every column's first cards. One stage + offset: the next cards for that column.
export function leadBoardUrl(owner: string, query: string, location: string, stage?: LeadStage, offset = 0, limit = BOARD_BATCH) {
  const params = baseParams({ stages: stage ? [stage] : [], owner }, query, location);
  params.set('offset', String(offset));
  params.set('limit', String(limit));
  return `/api/dashboard/lead-board?${params}`;
}

export function activeFilterCount(filters: LeadFilters) {
  return (filters.source !== 'all' ? 1 : 0) + (filters.stages.length ? 1 : 0) + (filters.owner !== ALL_OWNERS ? 1 : 0);
}

export function pageCount(loaded: number, size: number) {
  return Math.max(1, Math.ceil(loaded / size));
}

export function pageRows<T>(rows: T[], page: number, size: number) {
  return rows.slice((page - 1) * size, page * size);
}

// A column asks for more when its scroll is within `margin` px of the bottom and cards are left.
export function shouldLoadMore(scrollTop: number, clientHeight: number, scrollHeight: number, loaded: number, total: number, margin = 120) {
  return loaded < total && scrollTop + clientHeight >= scrollHeight - margin;
}
