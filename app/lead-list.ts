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

// A board refresh re-reads each column as far as it was scrolled, in batches of LIST_BATCH (the
// backend's cap), so a column at 142 cards stays at 142 and one at 25 stays at 25 (tester, 2026-10-28:
// one shared count capped at 100 made columns jump).
export function refreshPlan(loaded: number) {
  const plan: Array<{ offset: number; limit: number }> = [];
  for (let offset = 0, want = Math.max(BOARD_BATCH, loaded); offset < want; offset += LIST_BATCH) {
    plan.push({ offset, limit: Math.min(LIST_BATCH, want - offset) });
  }
  return plan;
}

// Replace only the columns that were re-read; every other column keeps its cards.
export function replaceColumns<T>(current: Record<string, T>, found: Partial<Record<string, T>>) {
  const next = { ...current };
  for (const [stage, column] of Object.entries(found)) if (column) next[stage] = column;
  return next;
}

export function plural(count: number, word: string) {
  return `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;
}

// The list subtitle follows the current filters and search; the overall total is every row.
export function listSubtitle(total: number, overall: number, filtered: boolean) {
  return filtered ? `${plural(total, 'lead')} match · ${overall.toLocaleString('en-US')} in total` : `${plural(overall, 'lead')} in total`;
}

// Analytics: leads created per clinic day (backend counts over every lead), optionally one clinic.
export function createdByDay(rows: Array<{ day: string; location: string; count: number }>, location: string) {
  const days = new Map<string, number>();
  for (const row of rows) {
    if (location !== 'All Locations' && row.location !== location) continue;
    days.set(row.day, (days.get(row.day) ?? 0) + row.count);
  }
  return days;
}

// The list remembers search, filters, page and rows loaded for the browser tab, so opening a lead
// and pressing Back returns to the same place.
export const LIST_STATE_KEY = 'rpt-leads-list';
export type ListState = { search: string; filters: LeadFilters; page: number; size: number; loaded: number };
const STAGE_KEYS = ['new', 'cadence', 'attention', 'booked', 'closed'];
export function readListState(raw: string | null): ListState | null {
  try {
    const value = JSON.parse(raw ?? '') as Partial<ListState>;
    const filters = value.filters as Partial<LeadFilters> | undefined;
    if (!filters || !['all', 'sheet', 'stride'].includes(String(filters.source))) return null;
    return {
      search: typeof value.search === 'string' ? value.search : '',
      filters: {
        source: filters.source as LeadSource,
        stages: (Array.isArray(filters.stages) ? filters.stages : []).filter((stage) => STAGE_KEYS.includes(stage)) as LeadStage[],
        owner: typeof filters.owner === 'string' && filters.owner ? filters.owner : ALL_OWNERS,
      },
      page: Math.max(1, Math.floor(Number(value.page)) || 1),
      size: (PAGE_SIZES as readonly number[]).includes(Number(value.size)) ? Number(value.size) : PAGE_SIZES[0],
      loaded: Math.max(0, Math.floor(Number(value.loaded)) || 0),
    };
  } catch {
    return null;
  }
}
