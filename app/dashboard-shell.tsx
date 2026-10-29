'use client';

import Link from 'next/link';
import { ModalShell, SelectMenu } from './dashboard-controls';
import { AppointmentsPage, BookingTagChip } from './appointments-page';
import { BOOKING_TAGS, STATUS_BUCKETS, appointmentSummary, bookedByLabel, calendarDay, callMoment, filterAppointments, stateLabel, statusBucket, type Appointment, type CalendarData } from './appointment-data';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { cadenceActionDescription, cadenceCallNames, cadenceStepName, cadenceRunSummary, isCadenceStep, reorderCadenceSteps, splitCadenceRuns, type CadenceEvent } from './cadence';
import { ActivityEntry, BookingCard, CadenceStep, CadenceVersion, emptySnapshot, Lead, LeadBoardPage, LeadDetail, LeadListPage, LeadStage, NumberBlock, Snapshot, StaffMember, StridePatientView } from './dashboard-data';
import { activeFilterCount, ALL_OWNERS, BOARD_BATCH, createdByDay, LIST_BATCH, LIST_STATE_KEY, leadBoardUrl, leadListUrl, listSubtitle, NO_FILTERS, PAGE_SIZES, pageCount, pageRows, readListState, refreshPlan, replaceColumns, shouldLoadMore, SOURCE_LABELS, type LeadFilters, type LeadSource, type ListState } from './lead-list';
import { AssistantDock, AssistantPage, ThemeToggle, setLeadDragData } from './assistant';
import { ActivityKind, BOOKED_LOCKED_HINT, canMoveOnBoard, clientErrorMessage, clinicDateTimeValue, clinicWallTimeToIso, CLINIC_TZ, CLINIC_TZ_LABEL, defaultAfterUnblock, displayEnum, formatPhone, leadSourceLabel, numberBlockMessage, operationalMessage, UNBLOCK_RESULT, type AfterUnblock, sourceLabel, statusTone, leadActivity, activitySource, timezoneLabel } from './display';
import type { StaffUser } from './session';
import { dashboardFetch } from './dashboard-client';
import { ResolveDialog, ReviewCard } from './review-panel';
import { filterReviews, groupCounts, inReviewQueue, REVIEW_GROUPS, reviewOf, stageAfter } from './review';
import type { ReviewChoice, ReviewGroup } from './dashboard-data';

const statusMeta: Record<LeadStage, { label: string }> = {
  new: { label: 'New' },
  cadence: { label: 'In Cadence' },
  attention: { label: 'Needs Attention' },
  booked: { label: 'Booked' },
  closed: { label: 'Closed' },
};

const locations = ['Dana Point', 'Laguna Niguel', 'Mission Viejo'];
type DashboardAction = (path: string, method: string, body?: unknown, successMessage?: string, onError?: (message: string) => void) => Promise<Record<string, unknown> | null>;

function actionFailureCopy(path: string) {
  if (/\/sms$/.test(path)) return 'Message was not sent. Review the phone number before trying again.';
  if (/cadence|outreach-events/.test(path)) return 'The outreach schedule could not be updated. Please try again.';
  if (/message-templates/.test(path)) return 'The message template could not be updated. Please try again.';
  if (/stage|contact-rules|review/.test(path)) return 'The lead status could not be updated. Please try again.';
  return 'The update could not be completed. Please try again.';
}

const nav = [
  ['/', 'home', 'Home'], ['/leads', 'leads', 'Leads'], ['/appointments', 'appointments', 'Appointments'],
  ['/review', 'review', 'Review Queue'], ['/analytics', 'analytics', 'Analytics'],
  ['/administration', 'administration', 'Administration'],
] as const;

// Inline so there is no icon dependency and both themes inherit currentColor.
const NAV_ICONS: Record<string, ReactNode> = {
  home: <path d="M3 10.2 12 3l9 7.2V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  leads: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 11.2a3 3 0 0 0 0-6" /><path d="M17.5 20a5.5 5.5 0 0 0-2.2-4.4" /></>,
  appointments: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="m9.5 15 1.8 1.8 3.5-3.6" /></>,
  review: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.2M12 16.3v.2" /></>,
  analytics: <><path d="M4 20V4" /><path d="M4 20h16" /><rect x="7.5" y="12" width="3" height="5" rx="1" /><rect x="13" y="8" width="3" height="9" rx="1" /></>,
  administration: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5" /></>,
};

function PauseIcon() {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
    <rect x="6" y="4.5" width="4" height="15" rx="1.2" /><rect x="14" y="4.5" width="4" height="15" rx="1.2" />
  </svg>;
}
function PlayIcon() {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
    <path d="M7.5 4.8v14.4a1 1 0 0 0 1.53.85l11.2-7.2a1 1 0 0 0 0-1.7L9.03 3.95A1 1 0 0 0 7.5 4.8z" />
  </svg>;
}
function EnvelopeIcon() {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" />
  </svg>;
}
function PhoneIcon({ size = 16 }: { size?: number }) {
  return <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5.3 3.3 7.6 3l1.2 3.4-1.5 1.2a11 11 0 0 0 5.1 5.1l1.2-1.5 3.4 1.2-.3 2.3a2.2 2.2 0 0 1-2.2 1.9C8.4 16.6 3.4 11.6 3.4 5.5a2.2 2.2 0 0 1 1.9-2.2Z" /></svg>;
}
function MessageIcon({ size = 16 }: { size?: number }) {
  return <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.2 4.2h13.6v9.4H8l-3.7 2.2v-2.2H3.2V4.2Z" /></svg>;
}
function MobileMenuIcon({ open }: { open: boolean }) {
  return <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">{open ? <path d="m6 6 12 12M18 6 6 18" /> : <path d="M5 7h14M5 12h14M5 17h14" />}</svg>;
}

function MapPinIcon() {
  return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 10c0 5.2-8 11-8 11S4 15.2 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" />
  </svg>;
}
function ArrowIcon({ direction }: { direction: 'up' | 'down' }) {
  return <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {direction === 'up' ? <path d="m5 11 5-5 5 5M10 6v9" /> : <path d="m5 9 5 5 5-5M10 14V5" />}
  </svg>;
}

function GripIcon() {
  return <svg viewBox="0 0 16 20" width="14" height="18" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="5" r="1.2" /><circle cx="11" cy="5" r="1.2" />
    <circle cx="5" cy="10" r="1.2" /><circle cx="11" cy="10" r="1.2" />
    <circle cx="5" cy="15" r="1.2" /><circle cx="11" cy="15" r="1.2" />
  </svg>;
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
    <path d="M9 4v16" />
    <path d={collapsed ? 'm13 9 3 3-3 3' : 'm16 9-3 3 3 3'} />
  </svg>;
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function NavIcon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {NAV_ICONS[name]}
    </svg>
  );
}


export function DashboardShell({ user, staff }: { user: StaffUser; staff: StaffMember[] }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [compactViewport, setCompactViewport] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [connection, setConnection] = useState<'loading' | 'live' | 'offline'>('loading');
  const [snapshotLoaded, setSnapshotLoaded] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [selectedLocation, setSelectedLocation] = useState('All Locations');
  const [globalQuery, setGlobalQuery] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const leadId = pathname.match(/^\/leads\/([0-9a-f-]+)/i)?.[1];

  useEffect(() => {
    const media = window.matchMedia('(max-width: 980px)');
    const update = () => setCompactViewport(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    function refresh() {
      dashboardFetch('/api/dashboard/snapshot', { signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<Snapshot> : Promise.reject())
        .then((data) => { setSnapshot(data); setSnapshotLoaded(true); setConnection('live'); })
        .catch((error) => { if (error?.name !== 'AbortError') setConnection('offline'); });
    }
    refresh();
    const interval = window.setInterval(() => { if (!document.hidden) refresh(); }, 20000);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { controller.abort(); window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [reloadKey]);

  useEffect(() => {
    if (!leadId) return;
    const requestedLeadId = leadId;
    const controller = new AbortController();
    function refresh() {
      dashboardFetch(`/api/dashboard/leads/${requestedLeadId}`, { signal: controller.signal })
        .then((response) => {
          if (response.status === 404) { router.replace('/leads'); throw new Error('lead not found'); }
          return response.ok ? response.json() as Promise<LeadDetail> : Promise.reject();
        })
        .then((data) => { setDetail(data); setDetailError(null); })
        .catch((error) => { if (error?.name !== 'AbortError' && error?.message !== 'lead not found') setDetailError(requestedLeadId); });
    }
    refresh();
    const interval = window.setInterval(() => { if (!document.hidden) refresh(); }, 20000);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { controller.abort(); window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [leadId, router, reloadKey]);

  function showNotice(message: string, tone: 'success' | 'error' = 'success') {
    setNotice({ message, tone });
    window.setTimeout(() => setNotice(null), 3000);
  }

  async function action(path: string, method: string, body?: unknown, successMessage = 'Saved successfully.', onError?: (message: string) => void) {
    const failureCopy = actionFailureCopy(path);
    try {
      const response = await dashboardFetch(`/api/dashboard/${path}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => ({})) as { detail?: string };
      if (!response.ok) {
        throw new Error(clientErrorMessage(data.detail, failureCopy));
      }
      showNotice(successMessage);
      setReloadKey((value) => value + 1);
      return data;
    } catch (error) {
      const message = clientErrorMessage(error instanceof Error ? error.message : '', failureCopy);
      showNotice(message, 'error');
      onError?.(message);
      return null;
    }
  }

  // The optimistic board update; the snapshot refetch that action() triggers brings the real state.
  function resolveLeadReview(id: string, choice: ReviewChoice) {
    setSnapshot((current) => {
      const was = current.leads.find((lead) => lead.id === id)?.stage ?? 'attention';
      const stage = stageAfter(choice, was);
      return {
        ...current,
        leads: current.leads.map((lead) => lead.id === id ? { ...lead, stage, needs_review: false, review_reason: null, review: null } : lead),
        // A booked lead's card closing leaves it in Booked: no column count changes.
        counts: was === stage ? current.counts : { ...current.counts, [was]: Math.max(0, current.counts[was] - 1), [stage]: current.counts[stage] + 1 },
        system: { ...current.system, review_queue: Math.max(0, (current.system.review_queue ?? 1) - 1) },
      };
    });
  }

  function publishTemplate(id: string, body: string, name: string) {
    setSnapshot((current) => ({
      ...current,
      templates: current.templates.map((template) => String(template.id) === id ? { ...template, body, key: name, name } : template),
    }));
  }

  const visibleSnapshot = useMemo(() => filterSnapshot(snapshot, selectedLocation), [snapshot, selectedLocation]);

  function searchDashboard(event: FormEvent) {
    event.preventDefault();
    const query = globalQuery.trim();
    if (query) router.push(`/leads?view=list&search=${encodeURIComponent(query)}`);
  }

  function toggleNavigation() {
    if (window.matchMedia('(max-width: 980px)').matches) setMobileMenuOpen((current) => !current);
    else setMenuOpen((current) => !current);
  }

  async function signOut() {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error();
      router.replace('/login');
      router.refresh();
    } catch { showNotice('Sign out failed. Try again.', 'error'); }
  }

  const visibleNav = user.role === 'super_admin' ? nav : nav.filter(([href]) => href !== '/administration');
  const activeLabel = pathname === '/assistant' ? 'Outreach Assistant' : visibleNav.find(([href]) => href === '/' ? pathname === '/' : pathname.startsWith(href))?.[2] ?? 'Lead Workspace';
  const navigationOpen = compactViewport ? mobileMenuOpen : menuOpen;
  const recordUnavailable = Boolean(leadId && detailError === leadId);
  const unavailable = connection === 'offline' || recordUnavailable;
  const canShowData = snapshotLoaded && (!leadId || detail?.lead.id === leadId);
  function retryConnection() {
    setConnection('loading');
    setDetailError(null);
    setReloadKey((value) => value + 1);
  }
  return (
    <div className={`app-shell ${menuOpen ? '' : 'is-collapsed'} ${mobileMenuOpen ? 'mobile-menu-open' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar">
        <div className="sidebar-header">
          <Link href="/" className="brand-mark" aria-label="Rausch Physical Therapy home"><span>R</span></Link>
          <button className="menu-button" type="button" onClick={toggleNavigation}
            aria-label={compactViewport ? (navigationOpen ? 'Close navigation' : 'Open navigation') : (navigationOpen ? 'Collapse navigation' : 'Expand navigation')} title={compactViewport ? (navigationOpen ? 'Close navigation' : 'Open navigation') : (navigationOpen ? 'Collapse navigation' : 'Expand navigation')} aria-expanded={navigationOpen}>
            <span className="desktop-toggle-icon"><SidebarToggleIcon collapsed={!menuOpen} /></span><span className="mobile-toggle-icon"><MobileMenuIcon open={mobileMenuOpen} /></span>
          </button>
        </div>
        <nav aria-label="Primary navigation">{visibleNav.map(([href, icon, label]) => { const active = href === '/' ? pathname === '/' : pathname.startsWith(href); return <Link className={active ? 'active' : ''} aria-label={label} title={label} aria-current={active ? 'page' : undefined} href={href} key={href} onClick={() => setMobileMenuOpen(false)}><b><NavIcon name={icon} /></b><span>{label}</span></Link>; })}</nav>
      </aside>
      {mobileMenuOpen && <button className="nav-scrim" type="button" aria-label="Close navigation menu" onClick={() => setMobileMenuOpen(false)} />}
      <div className="workspace">
        <header className="topbar">
          <Link href="/" className="client-logo" aria-label="Rausch Physical Therapy & Wellness home"><span className="sr-only">Rausch Physical Therapy & Wellness</span></Link>
          <div className="product-name">{activeLabel}</div>
          <div className="top-actions">
            <SelectMenu className="location-control" ariaLabel="Filter dashboard by location" value={selectedLocation} onChange={setSelectedLocation} icon={<MapPinIcon />} options={['All Locations', ...locations].map((location) => ({ value: location, label: location }))} />
            <form className="global-search" role="search" onSubmit={searchDashboard}><span aria-hidden="true">⌕</span><input aria-label="Search leads" value={globalQuery} onChange={(event) => setGlobalQuery(event.target.value)} placeholder="Search leads" /></form>
            <ThemeToggle /><span className={`connection ${unavailable ? 'offline' : connection}`} role="status"><i aria-hidden="true" />{unavailable ? 'Offline' : connection === 'live' ? 'Connected' : 'Connecting…'}</span><details className="account-menu"><summary className="avatar" title={user.displayName} aria-label={`Account menu for ${user.displayName}`}>{initials(user.displayName)}</summary><div><strong>{user.displayName}</strong><small>{user.role === 'super_admin' ? 'Administrator' : 'Team member'} · {user.employeeId}</small><button type="button" aria-label="Sign out" onClick={() => void signOut()}>Sign out</button></div></details>
          </div>
        </header>
        <main className="content" id="main-content">{unavailable && !canShowData ? <OfflineState onRetry={retryConnection} /> : <>{unavailable && <div className="connection-notice" role="alert"><p><strong>Updates paused.</strong> You’re viewing the last loaded data. Reconnect before making changes.</p><button className="secondary" type="button" onClick={retryConnection}>Retry connection</button></div>}{renderPage(pathname, search.get('view'), search.get('search'), search.get('stage'), search.get('chat'), visibleSnapshot, connection === 'loading', detail, router, action, resolveLeadReview, publishTemplate, user.role, staff, user.userId)}</>}</main>
      </div>
      {pathname !== '/assistant' && <AssistantDock leads={snapshot.leads} currentPath={pathname} currentLeadId={leadId} />}
      {notice && <div className={`toast ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.tone === 'error' ? '!' : '✓'} {notice.message}</div>}
    </div>
  );
}

function renderPage(path: string, view: string | null, query: string | null, stage: string | null, chatId: string | null, snapshot: Snapshot, loading: boolean, detail: LeadDetail | null, router: ReturnType<typeof useRouter>, action: DashboardAction, onReviewResolved: (id: string, choice: ReviewChoice) => void, onTemplatePublished: (id: string, body: string, name: string) => void, role: StaffUser['role'], staff: StaffMember[], userId = '') {
  const requestedLeadId = path.match(/^\/leads\/([0-9a-f-]+)/i)?.[1];
  // Narrowed to a non-null LeadDetail so the lead routes below typecheck; the
  // runtime behaviour is unchanged.
  const leadDetail = requestedLeadId && detail && String(detail.lead.id) === requestedLeadId ? detail : null;
  if (requestedLeadId && !leadDetail) return <SkeletonLeadDetail path={path} />;
  if (path === '/') return <HomePage snapshot={snapshot} loading={loading} />;
  if (path === '/leads' && loading && !snapshot.leads.length) return <><PageTitle title="Lead Pipeline" subtitle="Loading the latest pipeline…" /><SkeletonBoard /></>;
  if (path === '/leads') return <LeadsPage key={`${view}-${query}-${stage}`} snapshot={snapshot} staff={staff} mode={view === 'list' ? 'list' : 'board'} initialQuery={query ?? ''} initialStage={stage && Object.hasOwn(statusMeta, stage) ? stage as LeadStage : null} router={router} action={action} />;
  if (path === '/assistant') return <AssistantPage leads={snapshot.leads} initialChatId={chatId} />;
  if (path === '/appointments') return <AppointmentsPage userId={userId} snapshot={snapshot} location={snapshot.calendar_location ?? "All Locations"} />;
  if (path === '/review') return <ReviewPage snapshot={snapshot} action={action} onResolved={onReviewResolved} loading={loading} />;
  if (path === '/analytics') return <AnalyticsPage snapshot={snapshot} loading={loading} />;
  if (path.startsWith('/administration') && role !== 'super_admin') return <Empty title="Administrator access required" body="Team members can manage every lead, while organization-wide settings stay protected." />;
  if (path === '/administration') return <AdministrationPage snapshot={snapshot} action={action} />;
  if (path === '/administration/cadence') return <GlobalCadencePage snapshot={snapshot} action={action} loading={loading} />;
  if (path === '/administration/templates') return <TemplateStudio snapshot={snapshot} action={action} onPublished={onTemplatePublished} />;
  if (/^\/leads\/[0-9a-f-]+\/conversations\/sms$/i.test(path)) return <LeadFrame detail={leadDetail!} tab="conversations" action={action} role={role}><SmsPage detail={leadDetail!} action={action} /></LeadFrame>;
  if (/^\/leads\/[0-9a-f-]+\/conversations\/calls$/i.test(path)) return <LeadFrame detail={leadDetail!} tab="conversations" action={action} role={role}><CallsPage detail={leadDetail!} /></LeadFrame>;
  if (/^\/leads\/[0-9a-f-]+\/cadence$/i.test(path)) return <LeadFrame detail={leadDetail!} tab="cadence" action={action} role={role}><LeadCadencePage detail={leadDetail!} action={action} role={role} /></LeadFrame>;
  if (/^\/leads\/[0-9a-f-]+\/appointments$/i.test(path)) return <LeadFrame detail={leadDetail!} tab="appointments" action={action} role={role}><AppointmentsPage userId={userId} snapshot={snapshot} location="All Locations" leadId={leadDetail!.lead.id} initialDay={leadDetail!.booking?.start_utc ? calendarDay(leadDetail!.booking.start_utc) : leadDetail!.appointments[0]?.start_utc ? calendarDay(String(leadDetail!.appointments[0].start_utc)) : undefined} /></LeadFrame>;
  if (/^\/leads\/[0-9a-f-]+\/(?:activity|history)$/i.test(path)) return <LeadFrame detail={leadDetail!} tab="activity" action={action} role={role}><LeadActivityPage detail={leadDetail!} /></LeadFrame>;
  if (/^\/leads\/[0-9a-f-]+$/i.test(path)) return <LeadFrame detail={leadDetail!} tab="overview" action={action} role={role}><LeadOverview detail={leadDetail!} /></LeadFrame>;
  return <Empty title="Page not found" body="Return to the lead pipeline to continue." />;
}

function HomePage({ snapshot, loading }: { snapshot: Snapshot; loading: boolean }) {
  // Today's Work is a to-do list, so finished leads do not belong in it.
  const work = snapshot.leads.filter((lead) => lead.stage !== 'closed' && lead.stage !== 'booked').slice(0, 5);
  return <><PageTitle title="Outreach Operations" subtitle="Your team’s latest lead, outreach, and appointment overview." />
    {loading && !snapshot.leads.length ? <SkeletonTiles /> : <StatusTiles counts={snapshot.counts} loading={loading} />}
    <div className="home-work"><Panel title="Today’s Work">{loading && !snapshot.leads.length ? <SkeletonRows rows={5} /> : work.length ? <><DataTable heads={['Lead', 'Status', 'Next step', 'Due', 'Action']}>{work.map((lead) => <tr key={lead.id}><td><Link href={`/leads/${lead.id}`}>{lead.full_name}</Link></td><td><StatusBadge stage={lead.stage} paused={lead.cadence_state === 'paused'} /></td><td>{lead.next_step ?? '—'}</td><td>{time(lead.next_scheduled_for)}</td><td><Link className="text-action" href={`/leads/${lead.id}`}>Open →</Link></td></tr>)}</DataTable><div className="panel-action"><Link className="primary" href={`/leads/${work[0].id}`}>Start next task</Link></div></> : <Empty title="Today’s work is clear" body="There are no active leads waiting for outreach." />}</Panel>
    </div>
    <Panel title="Next Appointments">{loading && !snapshot.appointments.length ? <SkeletonRows rows={2} /> : snapshot.appointments.length ? <><div className="next-appointments"><DataTable heads={['Patient', 'When', 'Visit', 'Clinician', 'Tag']}>{snapshot.appointments.slice(0, 5).map((item) => <tr key={item.id}><td>{item.lead_id ? <Link href={`/leads/${item.lead_id}`}>{item.full_name}</Link> : item.full_name}</td><td>{visitWhen(item.start_utc)}</td><td>{item.type}{item.case_title && /pelvic/i.test(item.case_title) ? ' · Pelvic' : ''}</td><td>{item.practitioner_name}</td><td><BookingTagChip tag={item.tag} /></td></tr>)}</DataTable></div><div className="panel-action"><Link className="secondary" href="/appointments">Open calendar</Link></div></> : <Empty title="No upcoming appointments" body="Visits booked by Elliot, by staff or in Stride will appear here." />}</Panel></>;
}

function Skeleton({ w = '100%', h = 14 }: { w?: string; h?: number }) {
  return <span className="skeleton" style={{ width: w, height: h }} aria-hidden="true" />;
}

function SkeletonBoard() {
  // Mirrors the real board so the layout does not jump when data lands.
  return <section className="pipeline" aria-busy="true" aria-label="Loading leads">
    {(['new','cadence','attention','booked','closed'] as LeadStage[]).map((stage,column)=>
      <article className={`pipeline-column ${stage}`} key={stage}>
        <header><StatusGlyph stage={stage} /><h2>{statusMeta[stage].label}</h2><small>–</small></header>
        <div className="lead-stack">{Array.from({length: column===1?3:1}).map((_,row)=>
          <div className="lead-card skeleton-card" key={row}>
            <Skeleton w="62%" h={17} /><Skeleton w="45%" /><Skeleton w="52%" h={24} /><Skeleton w="80%" />
          </div>)}</div>
      </article>)}
  </section>;
}

function SkeletonTiles() {
  return <section className="status-tiles" aria-busy="true">{Array.from({length:5}).map((_,index)=>
    <div className="skeleton-tile" key={index}><span className="skeleton skeleton-circle" /><div><Skeleton w="72px" /><Skeleton w="40px" h={26} /></div></div>)}</section>;
}

function MessageBody({ body }: { body: string }) {
  // The stored body carries real newlines and a booking URL. Rendering it as
  // plain text collapsed the layout and left the link unclickable, so URLs are
  // split out here and the whitespace is preserved by CSS.
  const parts = body.split(/(https?:\/\/[^\s]+)/g);
  return <p className="message-body">{parts.map((part, index) =>
    /^https?:\/\//.test(part)
      ? <a key={index} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
      : <span key={index}>{part}</span>
  )}</p>;
}

function SkeletonLeadDetail({ path }: { path: string }) {
  // Mirrors LeadFrame: breadcrumb, header, tabs, then the two-column body, so
  // the page does not reflow when the record arrives.
  const route = path.endsWith('/cadence') ? 'cadence' : /\/(?:activity|history)$/.test(path) ? 'activity' : path.endsWith('/appointments') ? 'appointments' : path.includes('/conversations/calls') ? 'calls' : path.includes('/conversations/sms') ? 'sms' : 'overview';
  const panels: Record<string, { left: string; right: string; lower?: string }> = {
    overview: { left: 'Lead information', right: 'Next action', lower: 'Notes' },
    cadence: { left: 'Outreach schedule', right: 'Contact rules' },
    activity: { left: 'Activity history', right: 'Record controls' },
    appointments: { left: 'Appointment', right: 'Appointment preferences', lower: 'Booking history' },
    sms: { left: 'SMS conversation', right: 'Conversation context', lower: 'Safety' },
    calls: { left: 'Call sessions', right: 'Call transcript', lower: 'Call context' },
  };
  const layout = panels[route];
  return <div aria-busy="true" aria-label={`Loading lead ${route}`}>
    <div className="breadcrumbs"><Skeleton w="96px" /><Skeleton w="88px" /><Skeleton w="120px" /></div>
    <section className="lead-header">
      <span className="skeleton skeleton-avatar" />
      <div className="lead-identity"><Skeleton w="180px" h={26} /><Skeleton w="140px" /></div>
      <Skeleton w="104px" h={30} /><Skeleton w="126px" h={30} />
      <div className="record-actions"><Skeleton w="132px" h={40} /><Skeleton w="112px" h={40} /></div>
    </section>
    <nav className="record-tabs">{['Overview','Conversations','Cadence','Appointments','Activity'].map((tab)=>
      <span key={tab}><Skeleton w={`${tab.length * 8 + 12}px`} /></span>)}</nav>
    <div className={`${route === 'overview' ? 'stack' : 'two-col wide-left'} skeleton-lead-${route}`}>
      <div className="stack">
        <Panel title={layout.left}><SkeletonRows rows={route === 'overview' ? 3 : 5} /></Panel>
      </div>
      <div className="stack"><Panel title={layout.right}><SkeletonRows rows={3} /></Panel>{layout.lower && <Panel title={layout.lower}><SkeletonRows rows={2} /></Panel>}</div>
    </div>
  </div>;
}

function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return <div className="skeleton-rows" aria-busy="true">{Array.from({length: rows}).map((_,index)=>
    <div className="skeleton-row" key={index}>
      <Skeleton w="104px" h={26} />
      <div className="skeleton-row-text"><Skeleton w="38%" h={15} /><Skeleton w="58%" /></div>
      <Skeleton w="88px" />
    </div>)}</div>;
}

const BOARD_STAGES: LeadStage[] = ['new', 'cadence', 'attention', 'booked', 'closed'];
type BoardColumns = Record<LeadStage, { rows: Lead[]; total: number }>;

// The Leads page asks the backend for one batch at a time (lead-list.ts): search and filters cover
// every lead, not the newest 250 the snapshot carries.
function LeadsPage({ snapshot, staff, mode, initialQuery, initialStage, router, action }: { snapshot: Snapshot; staff: StaffMember[]; mode: 'board' | 'list'; initialQuery: string; initialStage: LeadStage | null; router: ReturnType<typeof useRouter>; action: DashboardAction }) {
  // Back from a lead returns to the same search, filters and page (a link with ?search / ?stage starts fresh).
  const [restored] = useState(() => {
    if (mode !== 'list' || initialQuery || initialStage) return null;
    try { return readListState(window.sessionStorage.getItem(LIST_STATE_KEY)); } catch { return null; }
  });
  const [query, setQuery] = useState(restored?.search ?? initialQuery);
  const [search, setSearch] = useState((restored?.search ?? initialQuery).trim());
  useEffect(() => { const timer = window.setTimeout(() => setSearch(query.trim()), 300); return () => window.clearTimeout(timer); }, [query]);
  const [filters, setFilters] = useState<LeadFilters>(restored?.filters ?? { ...NO_FILTERS, stages: initialStage ? [initialStage] : [] });
  const location = snapshot.calendar_location ?? 'All Locations';
  // Owners on any lead (the backend counts every lead; the loaded snapshot leads are only the newest).
  const owners = [ALL_OWNERS, ...Array.from(new Set([...staff.map((member) => member.display_name), ...(snapshot.owners ?? snapshot.leads.map((lead) => lead.owner || 'Unassigned'))]))];
  const views = <div className="segmented" aria-label="Lead view"><Link className={mode === 'list' ? 'selected' : ''} href="/leads?view=list"><span className="view-icon" aria-hidden="true">☷</span>List</Link><Link className={mode === 'board' ? 'selected' : ''} href="/leads"><span className="view-icon" aria-hidden="true">▦</span>Board</Link></div>;
  const searchBox = <label className="search-field"><span aria-hidden="true">⌕</span><input aria-label="Search leads by name, phone or email" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, phone, email" /></label>;
  if (mode === 'board') return <LeadBoard owner={filters.owner} owners={owners} onOwner={(owner) => setFilters((current) => ({ ...current, owner }))} search={search} location={location} stage={initialStage} refreshKey={snapshot.generated_at} views={views} searchBox={searchBox} router={router} action={action} />;
  return <LeadList filters={filters} onFilters={setFilters} owners={owners} search={search} location={location} restored={restored} tools={<>{views}{searchBox}</>} router={router} />;
}

function LeadList({ filters, onFilters, owners, search, location, restored, tools, router }: { filters: LeadFilters; onFilters: (filters: LeadFilters) => void; owners: string[]; search: string; location: string; restored: ListState | null; tools: ReactNode; router: ReturnType<typeof useRouter> }) {
  const key = leadListUrl(filters, search, location, 0);
  const [result, setResult] = useState<{ key: string; page: LeadListPage | null; error: boolean } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [size, setSize] = useState<number>(restored?.size ?? PAGE_SIZES[0]);
  const [pageState, setPage] = useState({ key, page: restored?.page ?? 1 });
  // Rows to load again when coming back (only for the restored filters).
  const [want] = useState({ key, loaded: restored?.loaded ?? 0 });
  const [panel, setPanel] = useState<LeadFilters | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [strideId, setStrideId] = useState<number | null>(null);
  // The panel closes without applying on Esc or a click outside it.
  useEffect(() => {
    if (!panel) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPanel(null); };
    const onPointer = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setPanel(null); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer); };
  }, [panel]);
  useEffect(() => {
    const controller = new AbortController();
    const batch = (offset: number) => dashboardFetch(leadListUrl(filters, search, location, offset), { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<LeadListPage> : Promise.reject());
    (async () => {
      const page = await batch(0);
      // Coming back to the remembered filters: load as many batches as before, so the page exists again.
      while (want.key === key && page.rows.length < Math.min(want.loaded, page.total)) {
        const next = await batch(page.rows.length);
        if (!next.rows.length) break;
        page.rows = [...page.rows, ...next.rows];
      }
      setResult({ key, page, error: false });
    })().catch((error) => { if (error?.name !== 'AbortError') setResult({ key, page: null, error: true }); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const data = result?.key === key ? result : null;
  const rows = data?.page?.rows ?? [];
  const total = data?.page?.total ?? 0;
  const sources = data?.page?.sources;
  // Changing filters or search starts again from page 1.
  const page = pageState.key === key ? Math.min(pageState.page, pageCount(rows.length, size)) : 1;
  const pages = pageCount(rows.length, size);
  useEffect(() => {
    try { window.sessionStorage.setItem(LIST_STATE_KEY, JSON.stringify({ search, filters, page: pageState.key === key ? pageState.page : 1, size, loaded: rows.length } satisfies ListState)); } catch { /* private window: nothing remembered */ }
  }, [search, filters, pageState, key, size, rows.length]);
  async function loadMore() {
    if (!data?.page || loadingMore || rows.length >= total) return;
    setLoadingMore(true);
    try {
      const response = await dashboardFetch(leadListUrl(filters, search, location, rows.length));
      if (!response.ok) throw new Error();
      const next = await response.json() as LeadListPage;
      setResult((current) => current?.key === key && current.page ? { ...current, page: { ...next, rows: [...current.page.rows, ...next.rows] } } : current);
    } catch { /* the button stays; staff can try again */ } finally { setLoadingMore(false); }
  }
  const active = activeFilterCount(filters);
  const chips: Array<[string, LeadFilters]> = [
    ...(filters.source !== 'all' ? [[`Source: ${SOURCE_LABELS[filters.source]}`, { ...filters, source: 'all' }] as [string, LeadFilters]] : []),
    ...(filters.stages.length ? [[`Stage: ${filters.stages.map((stage) => statusMeta[stage].label).join(', ')}`, { ...filters, stages: [] }] as [string, LeadFilters]] : []),
    ...(filters.owner !== ALL_OWNERS ? [[`Owner: ${filters.owner}`, { ...filters, owner: ALL_OWNERS }] as [string, LeadFilters]] : []),
  ];
  const filterButton = <div className="filter-menu" ref={menu}><button className="secondary filter-button" type="button" aria-expanded={Boolean(panel)} onClick={() => setPanel(panel ? null : filters)}>Filters{active > 0 && <b className="filter-count">{active}</b>}</button>{panel && <div className="filter-panel" role="dialog" aria-label="Lead filters"><fieldset><legend>Source</legend>{(['all', 'sheet', 'stride'] as LeadSource[]).map((source) => <label key={source}><input type="radio" name="lead-source" checked={panel.source === source} onChange={() => setPanel({ ...panel, source })} />{SOURCE_LABELS[source]}{sources && <small>{sources[source].toLocaleString()}</small>}</label>)}</fieldset><fieldset><legend>Stage</legend>{BOARD_STAGES.map((stage) => <label key={stage}><input type="checkbox" checked={panel.stages.includes(stage)} onChange={(event) => setPanel({ ...panel, stages: event.target.checked ? [...panel.stages, stage] : panel.stages.filter((item) => item !== stage) })} />{statusMeta[stage].label}</label>)}</fieldset><fieldset><legend>Owner</legend><SelectMenu className="filter-control" ariaLabel="Filter leads by owner" value={panel.owner} onChange={(owner) => setPanel({ ...panel, owner })} options={owners.map((item) => ({ value: item, label: item }))} /></fieldset><footer><button className="secondary" type="button" onClick={() => setPanel(NO_FILTERS)}>Reset</button><button className="primary" type="button" onClick={() => { onFilters(panel); setPanel(null); }}>Apply</button></footer></div>}</div>;
  const subtitle = data?.page ? listSubtitle(total, data.page.overall ?? total, Boolean(active || search)) : 'Loading leads…';
  return <><PageTitle title="Lead Pipeline" subtitle={subtitle} tools={<>{tools}{filterButton}</>} />
    {chips.length > 0 && <div className="filter-chips">{chips.map(([label, without]) => <button type="button" className="filter-chip" key={label} onClick={() => onFilters(without)} aria-label={`Remove filter ${label}`}>{label} <span aria-hidden="true">×</span></button>)}<button type="button" className="clear-filters" onClick={() => onFilters(NO_FILTERS)}>Clear all</button></div>}
    {!data ? <Panel><SkeletonRows rows={6} /></Panel> : data.error ? <Panel><Empty title="Leads could not be loaded" body="Check the connection, then try again." /></Panel> : !rows.length ? <Panel><Empty title="No matching leads" body="Try another filter, location, or search term." /></Panel> :
      <Panel><DataTable heads={['Name', 'Stage', 'Next step', 'Phone', 'Owner', 'Added']}>{pageRows(rows, page, size).map((row) => row.kind === 'stride'
        ? <tr key={row.id} className="row-clickable" onClick={() => setStrideId(row.stride_id)}><td><button type="button" className="row-name" onClick={(event) => { event.stopPropagation(); setStrideId(row.stride_id); }}>{row.full_name}</button><small>{leadSourceLabel(row.source)}</small></td><td>{row.stage ? <StatusBadge stage={row.stage} /> : <span className="status-pill plain">{row.stage_label}</span>}</td><td>{row.next_step}</td><td className="nowrap">{formatPhone(row.phone)}</td><td>—</td><td>{row.created_at ? date(row.created_at) : '—'}</td></tr>
        : <tr key={row.id} className={`row-clickable row-${row.stage} ${row.number_block ? 'row-blocked' : ''}`} onClick={() => router.push(`/leads/${row.id}`)}><td><Link className="row-name" href={`/leads/${row.id}`} onClick={(event) => event.stopPropagation()}>{row.full_name}</Link><small>{leadSourceLabel(row.source)}</small></td><td><span className="card-tags"><StatusBadge stage={row.stage} paused={row.cadence_state === 'paused'} />{row.number_block && <BlockedTag />}</span></td><td>{row.next_step ?? 'No planned action'}</td><td className="nowrap">{formatPhone(row.phone)}</td><td>{row.owner || 'Unassigned'}</td><td>{date(row.created_at)}</td></tr>)}</DataTable>
        <footer className="list-footer"><label>Rows per page <SelectMenu className="filter-control page-size" ariaLabel="Rows per page" value={String(size)} onChange={(value) => { setSize(Number(value)); setPage({ key, page: 1 }); }} options={PAGE_SIZES.map((item) => ({ value: String(item), label: String(item) }))} /></label><div className="list-pages"><button className="secondary" type="button" disabled={page <= 1} onClick={() => setPage({ key, page: page - 1 })}>Previous</button><span>Page {page} of {pages}</span><button className="secondary" type="button" disabled={page >= pages} onClick={() => setPage({ key, page: page + 1 })}>Next</button></div><div className="list-loaded">{rows.length >= total ? <span>All {total.toLocaleString()} loaded</span> : <><span>{rows.length.toLocaleString()} of {total.toLocaleString()} loaded</span><button className="secondary" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Loading…' : `Load ${LIST_BATCH} more`}</button></>}</div></footer></Panel>}
    {strideId !== null && <StridePatientDialog strideId={strideId} onClose={() => setStrideId(null)} />}</>;
}

// A Stride patient the front desk booked directly (no lead): view only, no calls, texts or moves.
function StridePatientDialog({ strideId, onClose }: { strideId: number; onClose: () => void }) {
  const [result, setResult] = useState<{ id: number; view: StridePatientView | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    dashboardFetch(`/api/dashboard/stride-patients/${strideId}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<StridePatientView> : Promise.reject())
      .then((view) => setResult({ id: strideId, view }))
      .catch((error) => { if (error?.name !== 'AbortError') setResult({ id: strideId, view: null }); });
    return () => controller.abort();
  }, [strideId]);
  const data = result?.id === strideId ? result : null;
  const patient = data?.view?.patient;
  return <ModalShell className="stride-dialog" labelId="stride-patient-title" onClose={onClose}><header><div><h2 id="stride-patient-title">{patient?.full_name ?? 'Stride patient'}</h2><p><span className="status-pill plain">Stride</span> View only: from the Stride export, not part of outreach.</p></div><button className="close-button" type="button" onClick={onClose} aria-label="Close Stride patient">×</button></header>
    <div className="stride-dialog-body">{!data ? <SkeletonRows rows={3} /> : !patient ? <Empty title="Patient could not be loaded" body="They may have been linked to a lead or removed in Stride." /> : <><dl className="stride-facts"><div><dt>Phone</dt><dd>{formatPhone(patient.phone)}</dd></div><div><dt>Date of birth</dt><dd>{patient.date_of_birth ?? '—'}</dd></div><div><dt>Clinic</dt><dd>{patient.clinic ?? '—'}</dd></div><div><dt>Stage</dt><dd>{patient.stage_label}</dd></div></dl>
      <h3>Visits</h3>{data.view!.visits.length ? <DataTable heads={['When', 'Visit', 'Status', 'Clinician', 'Location']}>{data.view!.visits.map((visit) => <tr key={visit.id}><td>{visit.start_utc ? visitWhen(visit.start_utc, true) : '—'}</td><td>{visit.type ?? '—'}</td><td>{displayEnum(visit.status)}</td><td>{visit.clinician ?? '—'}</td><td>{visit.location ?? '—'}</td></tr>)}</DataTable> : <p className="muted">No visits in Stride.</p>}</>}</div></ModalShell>;
}

// The board keeps its look; each column now has its own scroll, a real total, and loads 25 cards at a
// time (more when scrolled near the bottom). Google Sheet and other leads only: Stride patients are not leads.
function LeadBoard({ owner, owners, onOwner, search, location, stage, refreshKey, views, searchBox, router, action }: { owner: string; owners: string[]; onOwner: (owner: string) => void; search: string; location: string; stage: LeadStage | null; refreshKey?: string; views: ReactNode; searchBox: ReactNode; router: ReturnType<typeof useRouter>; action: DashboardAction }) {
  const key = leadBoardUrl(owner, search, location, stage ?? undefined);
  const [board, setBoard] = useState<{ key: string; columns: BoardColumns | null } | null>(null);
  const [loading, setLoading] = useState<Partial<Record<LeadStage, boolean>>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<LeadStage | null>(null);
  const [moving, setMoving] = useState(false);
  const columns = board?.key === key ? board.columns : null;
  const loaded = useRef<{ key: string; columns: BoardColumns | null } | null>(null);
  useEffect(() => { loaded.current = board; }, [board]);

  async function boardPage(url: string, signal?: AbortSignal) {
    const response = await dashboardFetch(url, { signal });
    if (!response.ok) throw new Error('board');
    return (await response.json() as LeadBoardPage).columns;
  }
  // First load: every column's first 25. Refresh: each named column again, as far as IT was scrolled
  // (refreshPlan), so no column changes length because of another one.
  async function fetchColumns(counts: Partial<Record<LeadStage, number>> | null, signal?: AbortSignal): Promise<Partial<BoardColumns>> {
    if (!counts) return boardPage(leadBoardUrl(owner, search, location, stage ?? undefined), signal);
    const found: Partial<BoardColumns> = {};
    await Promise.all(Object.entries(counts).map(async ([column, count]) => {
      const rows: Lead[] = [];
      let total = 0;
      for (const part of refreshPlan(count ?? 0)) {
        const next = (await boardPage(leadBoardUrl(owner, search, location, column as LeadStage, part.offset, part.limit), signal))[column as LeadStage];
        rows.push(...(next?.rows ?? []));
        total = next?.total ?? 0;
        if (!next || next.rows.length < part.limit) break;
      }
      found[column as LeadStage] = { rows, total };
    }));
    return found;
  }
  function merge(found: Partial<BoardColumns>) {
    setBoard((current) => {
      const base = current?.key === key && current.columns ? current.columns : Object.fromEntries(BOARD_STAGES.map((item) => [item, { rows: [], total: 0 }])) as unknown as BoardColumns;
      return { key, columns: replaceColumns(base, found) as BoardColumns };
    });
  }
  // How far each column was scrolled (cards loaded), for a refresh.
  function shownCounts(current: BoardColumns, only?: LeadStage[]) {
    return Object.fromEntries((only ?? (stage ? [stage] : BOARD_STAGES)).map((item) => [item, current[item].rows.length])) as Partial<Record<LeadStage, number>>;
  }
  useEffect(() => {
    const controller = new AbortController();
    fetchColumns(null, controller.signal).then(merge).catch((error) => { if (error?.name !== 'AbortError') setBoard({ key, columns: null }); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // The snapshot refreshes every 20 s; refresh the cards already shown with it so the board stays live.
  useEffect(() => {
    const current = loaded.current;
    if (!refreshKey || current?.key !== key || !current.columns) return;
    fetchColumns(shownCounts(current.columns)).then(merge).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  async function loadMore(column: LeadStage) {
    const current = columns?.[column];
    if (!current || loading[column] || current.rows.length >= current.total) return;
    setLoading((value) => ({ ...value, [column]: true }));
    try {
      const response = await dashboardFetch(leadBoardUrl(owner, search, location, column, current.rows.length));
      if (!response.ok) throw new Error();
      const next = (await response.json() as LeadBoardPage).columns[column];
      if (next) setBoard((value) => {
        if (value?.key !== key || !value.columns) return value;
        const seen = new Set(value.columns[column].rows.map((lead) => lead.id));
        return { key, columns: { ...value.columns, [column]: { rows: [...value.columns[column].rows, ...next.rows.filter((lead) => !seen.has(lead.id))], total: next.total } } };
      });
    } catch { /* scrolling again retries */ } finally { setLoading((value) => ({ ...value, [column]: false })); }
  }

  async function drop(target: LeadStage) {
    const id = dragging;
    setOver(null);
    setDragging(null);
    if (!id || moving || !columns) return;
    const lead = BOARD_STAGES.flatMap((item) => columns[item].rows).find((item) => item.id === id);
    if (!lead || lead.stage === target || !canMoveOnBoard(lead.stage)) return;
    // A flagged lead goes back into outreach only through a review choice (the backend refuses the
    // move too): open the lead, where Resolve review shows the reason and the choices.
    if (target === 'cadence' && lead.needs_review) { router.push(`/leads/${id}`); return; }
    // Restarting contacts a real patient from day zero, so it is confirmed first.
    if (target === 'new' && !window.confirm(
      `Restart outreach for ${lead.full_name}?

The remaining schedule is discarded and a new cadence begins from today. They will be called and texted again from the first step.`
    )) return;
    setMoving(true);
    try {
      await action(`leads/${id}/stage`, 'POST', { stage: target });
      // Reload both columns (and their totals) as far as they were scrolled.
      merge(await fetchColumns(shownCounts(columns, BOARD_STAGES.filter((item) => item === lead.stage || item === target))));
    } catch { /* action() already showed the error */ } finally { setMoving(false); }
  }
  return <><PageTitle title="Lead Pipeline" subtitle="Select a lead to open their workspace." tools={<>{views}<SelectMenu className="filter-control" ariaLabel="Filter leads by owner" value={owner} onChange={onOwner} options={owners.map((item) => ({ value: item, label: item }))} />{searchBox}</>} />
    {stage && <div className="active-filter">Showing {statusMeta[stage].label} leads <Link href="/leads">Clear filter</Link></div>}
    {board?.key === key && !columns ? <Panel><Empty title="Leads could not be loaded" body="Check the connection, then try again." /></Panel> : !columns ? <SkeletonBoard /> : !BOARD_STAGES.some((column) => columns[column].total) ? <Panel><Empty title="No matching leads" body="Try another owner, location, or search term." /></Panel> : <section className="pipeline paged">{BOARD_STAGES.map((column) => { const { rows, total } = columns[column]; return <article className={`pipeline-column ${column} ${over === column ? 'drop-target' : ''}`} key={column} onDragOver={(event) => { if (!dragging) return; event.preventDefault(); setOver(column); }} onDragLeave={() => setOver((current) => current === column ? null : current)} onDrop={(event) => { event.preventDefault(); void drop(column); }}><header><StatusGlyph stage={column} /><h2>{statusMeta[column].label}</h2><small>{total.toLocaleString()}</small></header><div className="lead-stack" onScroll={(event) => { const node = event.currentTarget; if (shouldLoadMore(node.scrollTop, node.clientHeight, node.scrollHeight, rows.length, total)) void loadMore(column); }}>{rows.map((lead) => <LeadCard lead={lead} key={lead.id} onOpen={() => router.push(`/leads/${lead.id}`)} dragging={dragging === lead.id} onDragStart={() => setDragging(lead.id)} onDragEnd={() => { setDragging(null); setOver(null); }} />)}{loading[column] && <>{[0, 1].map((item) => <div className="lead-card skeleton-card" key={`more-${item}`} aria-hidden="true"><Skeleton w="62%" h={17} /><Skeleton w="45%" /><Skeleton w="52%" h={24} /></div>)}<p className="column-note" role="status">Loading {BOARD_BATCH} more…</p></>}{!loading[column] && total > 0 && rows.length >= total && <p className="column-note">All {total.toLocaleString()} shown</p>}{over === column && dragging && <p className="drop-hint">{column === 'new' ? 'Drop to restart outreach from day zero' : `Move to ${statusMeta[column].label}`}</p>}</div><footer className="column-footer">Showing {rows.length.toLocaleString()} of {total.toLocaleString()}</footer></article>; })}</section>}</>;
}

function ReviewPage({ snapshot, action, onResolved, loading }: { snapshot: Snapshot; action: DashboardAction; onResolved: (id: string, choice: ReviewChoice) => void; loading: boolean }) {
  const flagged = snapshot.leads.filter(inReviewQueue);
  const [group, setGroup] = useState<ReviewGroup | 'all'>('all');
  const leads = filterReviews(flagged, group);
  const counts = groupCounts(flagged);
  const [selectedId, setSelectedId] = useState(leads[0]?.id ?? '');
  const [choosing, setChoosing] = useState<ReviewChoice | null>(null);
  const selected = leads.find((lead) => lead.id === selectedId) ?? leads[0];
  const review = selected ? reviewOf(selected) : null;
  function reviewNext() {
    if (!leads.length) return;
    const index = Math.max(0, leads.findIndex((lead) => lead.id === selected?.id));
    setSelectedId(leads[(index + 1) % leads.length].id);
  }
  const filter = <SelectMenu className="filter-control" ariaLabel="Filter reviews by reason" value={group} onChange={(value) => setGroup(value as ReviewGroup | 'all')} options={REVIEW_GROUPS.filter((item) => item.value === 'all' || counts[item.value]).map((item) => ({ value: item.value, label: `${item.label} (${counts[item.value] ?? 0})` }))} />;
  return <><PageTitle title="Review Queue" subtitle="Each lead here needs a staff decision. Read why, then choose what happens next." tools={<>{filter}<button className="primary" type="button" disabled={!leads.length} onClick={reviewNext}>Review next</button></>} />
    {loading && !snapshot.leads.length ? <Panel title="Loading review queue"><SkeletonRows rows={4} /></Panel> : !leads.length ? <Panel><Empty title="Review queue is clear" body={group === 'all' ? 'There are no unresolved outreach items for this location.' : 'No leads need review for this reason.'} /></Panel> : <div className="two-col review-layout"><Panel title={`${leads.length} ${leads.length === 1 ? 'item needs' : 'items need'} attention`}>{leads.map((lead) => { const item = reviewOf(lead); return <button type="button" className={`review-item ${selected?.id === lead.id ? 'selected' : ''}`} key={lead.id} onClick={() => setSelectedId(lead.id)}><StatusBadge stage="attention" /><strong>{lead.full_name}</strong><span>{item ? (item.group_label === item.title ? item.title : `${item.group_label}: ${item.title}`) : operationalMessage(lead.review_reason)}</span><small>{item?.flagged_at ? relative(item.flagged_at) : relative(lead.last_contacted_at)}</small></button>; })}</Panel>
      <Panel title={selected?.full_name ?? 'Review details'}>{selected && review && <><ReviewCard review={review} onChoose={setChoosing} /><p className="muted"><Link className="text-action" href={`/leads/${selected.id}`}>Open the lead →</Link></p></>}</Panel></div>}
    {selected && choosing && <ResolveDialog leadId={selected.id} choice={choosing} action={action} onClose={() => setChoosing(null)} onResolved={(choice) => { if (!review?.also?.length) onResolved(selected.id, choice); }} />}</>;
}

function leadMovementSeries(snapshot: Snapshot) {
  // Buckets leads by creation date over the trailing fortnight. Days with no
  // leads stay in the series as zero, so the shape of the chart is honest.
  const days = 14;
  const buckets = new Map<string, number>();
  const labels: string[] = [];
  const today = new Date();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - offset);
    const key = clinicDateKey(day);
    labels.push(key);
    buckets.set(key, 0);
  }
  // Backend counts over every lead (the loaded leads are only the newest 250).
  for (const [key, count] of createdByDay(snapshot.created_by_day ?? [], snapshot.calendar_location ?? 'All Locations')) {
    if (buckets.has(key)) buckets.set(key, count);
  }
  const points = labels.map((key) => ({
    label: new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: CLINIC_TZ }),
    value: buckets.get(key) ?? 0,
  }));
  return { points, max: Math.max(...points.map((point) => point.value), 0) };
}

function AnalyticsPage({ snapshot, loading }: { snapshot: Snapshot; loading: boolean }) {
  const total = Object.values(snapshot.counts).reduce((sum, value) => sum + value, 0);
  // Every figure below comes from the snapshot. Where the backend has no data
  // yet it sends null, and we show a dash rather than inventing a number.
  const m = snapshot.metrics;
  const pct = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${value}%`);
  const num = (value: number | null | undefined) => (value === null || value === undefined ? '—' : value.toLocaleString());
  const movement = leadMovementSeries(snapshot);
  if (loading && !snapshot.leads.length) return <div aria-busy="true" aria-label="Loading analytics"><PageTitle title="Analytics" subtitle="Loading pipeline movement and outreach outcomes…" /><SkeletonTiles /><div className="two-col"><Panel title="Leads created · last 14 days"><SkeletonRows rows={4} /></Panel><Panel title="Cadence outcomes"><SkeletonRows rows={4} /></Panel></div><Panel title="Operational indicators"><SkeletonRows rows={3} /></Panel></div>;
  return <><PageTitle title="Analytics" subtitle="A concise view of pipeline movement and outreach outcomes." tools={<button className="primary" type="button" onClick={() => exportLeadReport(snapshot)}>Export report</button>} /><StatusTiles counts={snapshot.counts} />
    <div className="two-col"><Panel title="Leads created · last 14 days">{movement.max === 0 ? <Empty title="No leads yet" body="Leads created in the last fourteen days will appear here." /> : <><div className="bar-chart" role="img" aria-label={`Leads created by day. Maximum ${movement.max}.`}>{movement.points.map((point)=><span className="bar" key={point.label} style={{height:`${Math.round(point.value / movement.max * 100)}%`}}><span className="sr-only">{point.label}: {point.value}</span></span>)}</div><div className="axis"><span>{movement.points[0]?.label}</span><span>{movement.points[movement.points.length-1]?.label}</span></div></>}</Panel><Panel title="Cadence outcomes"><Metric label="Calls reaching a person" value={pct(m?.calls_reached_rate)} width={`${m?.calls_reached_rate ?? 0}%`} /><Metric label="SMS confirmed delivered" value={pct(m?.messages_delivery_rate)} width={`${m?.messages_delivery_rate ?? 0}%`} /><Metric label="Booked" value={pct(m?.booked_rate)} width={`${m?.booked_rate ?? 0}%`} /><Metric label="Needs review" value={`${snapshot.counts.attention}`} width={`${m?.review_rate ?? 0}%`} tone="amber" /></Panel></div>
    <Panel title="Operational indicators"><div className="metric-grid"><Stat label="Total leads" value={String(total)} trend={`${snapshot.counts.closed} closed`} /><Stat label="SMS sent" value={num(m?.messages_sent)} trend={`${num(m?.messages_delivered)} confirmed delivered`} /><Stat label="SMS awaiting confirmation" value={num(m?.messages_pending)} trend={m?.messages_failed ? `${m.messages_failed} failed` : "none failed"} /><Stat label="Calls completed" value={num(m?.calls_completed)} trend={pct(m?.calls_completion_rate)} /><Stat label="Review rate" value={pct(m?.review_rate)} trend={`${snapshot.counts.attention} of ${total}`} /></div></Panel><AppointmentAnalytics /></>;
}

// Appointments by month, location, practitioner, case and tag. Reads the same calendar
// endpoint as the Appointments page, so both pages always count the same visits.
function AppointmentAnalytics() {
  const [month, setMonth] = useState(() => calendarDay().slice(0, 7));
  const [place, setPlace] = useState('all');
  const [caseTitle, setCaseTitle] = useState('all');
  const [practitioner, setPractitioner] = useState('all');
  const [result, setResult] = useState<{ month: string; data: CalendarData | null; error: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const [year, mon] = month.split('-').map(Number);
    const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
    dashboardFetch(`/api/dashboard/appointment-calendar?start=${month}-01&end=${month}-${String(last).padStart(2, '0')}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as CalendarData & { detail?: string };
        if (!response.ok) throw new Error(clientErrorMessage(body.detail, 'Appointments could not be loaded.'));
        setResult({ month, data: body, error: '' });
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) setResult({ month, data: null, error: error instanceof Error ? error.message : 'Appointments could not be loaded.' }); });
    return () => controller.abort();
  }, [month]);
  const data = result?.month === month ? result.data : null;
  const all = data?.appointments ?? [];
  const items = filterAppointments(all, { location: place === 'all' ? undefined : place, caseTitle, practitioner });
  const summary = appointmentSummary(items);
  const options = (values: string[], allLabel: string) => [{ value: 'all', label: allLabel }, ...[...new Set(values)].sort().map((v) => ({ value: v, label: v }))];
  const practitioners = [...new Map(all.map((a) => [a.practitioner_id, a.practitioner_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const monthLabel = new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const bars = (rows: { label: string; count: number; tone?: string; tag?: Appointment['tag'] }[]) => {
    const max = Math.max(1, ...rows.map((r) => r.count));
    return <div className="appt-bars">{rows.map((r) => <div className="appt-bar" key={r.label}><span>{r.tag ? <BookingTagChip tag={r.tag} /> : null}{r.label}</span><b>{r.count}</b><i aria-hidden="true"><em className={r.tone ?? ''} style={{ width: `${Math.round(r.count / max * 100)}%` }} /></i></div>)}</div>;
  };
  const tagHint = (tag: Appointment['tag']) => BOOKING_TAGS.find((t) => t.value === tag)?.hint ?? '';
  return <Panel title="Appointments">
    <div className="appointment-filters">
      <label className="sr-only" htmlFor="appointment-month">Month</label>
      <input id="appointment-month" type="month" value={month} max="2100-12" onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setMonth(e.target.value); }} />
      <SelectMenu ariaLabel="Filter appointment counts by location" value={place} onChange={setPlace} options={options(all.map((a) => a.location), 'All locations')} />
      <SelectMenu ariaLabel="Filter appointment counts by case" value={caseTitle} onChange={setCaseTitle} options={options(all.map((a) => a.case_title), 'All cases')} />
      <SelectMenu ariaLabel="Filter appointment counts by practitioner" value={practitioner} onChange={setPractitioner} options={[{ value: 'all', label: 'All practitioners' }, ...practitioners.map(([id, name]) => ({ value: id, label: name }))]} />
    </div>
    {result?.month === month && result.error ? <Alert tone="warning">{result.error}</Alert> : !data ? <SkeletonRows rows={3} /> : <>
      <div className="appointment-totals" role="group" aria-label={`Appointments in ${monthLabel}`}><div className="total"><b>{summary.total}</b><small>appointments</small></div>{STATUS_BUCKETS.map((b) => <div key={b.value}><b>{summary.status[b.value]}</b><small>{b.label.toLowerCase()}</small></div>)}</div>
      {data.truncated && <Alert tone="warning">This month has more than 2,000 appointments; the counts cover the first 2,000.</Alert>}
      {summary.total === 0 ? <Empty title={`No appointments in ${monthLabel}`} body="Choose another month or clear the filters." /> : <div className="appointment-breakdown">
        <section><h3>By location</h3>{bars(summary.byLocation)}</section>
        <section><h3>By practitioner</h3>{bars(summary.byPractitioner)}</section>
        <section><h3>By case and tag</h3>{bars([...summary.byCase, ...BOOKING_TAGS.map((t) => ({ label: tagHint(t.value), count: summary.tags[t.value], tone: t.value, tag: t.value }))])}</section>
      </div>}
    </>}
  </Panel>;
}

type KeapSync = {
  overall: 'ok' | 'attention' | 'problem' | 'not_started' | 'switched_off';
  headline: string;
  connection: { connected: boolean; account: string | null; reconnect_needed: boolean };
  counts: { synced: number; waiting: number; failed: number; needs_review: number; skipped: number };
  today: { people_synced: number; contacts_created: number; contacts_updated: number };
  problems: { reason: string; since: string }[];
  alerts: { level: string; title: string; detail: string }[];
};

// Read-only: shows how the Keap contact sync is doing. The dashboard never sends anything to Keap.
function KeapSyncPanel() {
  const [status, setStatus] = useState<KeapSync | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    dashboardFetch('/api/dashboard/keap-sync', { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<KeapSync>) : Promise.reject(new Error('keap status unavailable'))))
      .then((body) => setStatus(body))
      .catch((error) => { if (error?.name !== 'AbortError') setFailed(true); });
    return () => controller.abort();
  }, []);
  if (failed) return <Panel title="Keap contacts"><p className="muted">The Keap status could not be loaded right now.</p></Panel>;
  if (!status) return <Panel title="Keap contacts"><p className="muted">Loading Keap status…</p></Panel>;
  const tone = status.overall === 'problem' ? 'danger' : status.overall === 'attention' ? 'warning' : status.overall === 'ok' ? 'success' : 'info';
  return <Panel title="Keap contacts">
    <Alert tone={tone}>{status.headline}</Alert>
    <div className="metric-grid">
      <Stat label="In step with Keap" value={String(status.counts.synced)} />
      <Stat label="Waiting to send" value={String(status.counts.waiting)} />
      <Stat label="Need a decision" value={String(status.counts.needs_review)} />
      <Stat label="Could not be sent" value={String(status.counts.failed)} />
    </div>
    <p className="muted">Today: {status.today.contacts_created} contacts added, {status.today.contacts_updated} updated{status.connection.account ? ` in ${status.connection.account}` : ''}.</p>
    {status.alerts.map((alert) => <Alert key={alert.title} tone={alert.level === 'problem' ? 'danger' : 'warning'}><strong>{alert.title}</strong> {alert.detail}</Alert>)}
    {status.problems.length > 0 && <ul className="muted">{status.problems.map((problem, index) => <li key={`${problem.since}-${index}`}>{problem.reason}</li>)}</ul>}
  </Panel>;
}

function AdministrationPage({ snapshot, action }: { snapshot: Snapshot; action: DashboardAction }) {
  const cards = [
    ['/administration/cadence','CD','Global Cadence Studio','Edit the eight-step outreach sequence for future execution.'],
    ['/administration/templates','SM','SMS Template Studio','Manage reusable SMS templates and global cadence messages.'],
    ['/appointments','BK','Booking Configuration','Review appointment availability and booking safeguards.'],
    ['/review','RV','Review & Reconciliation','Resolve uncertain outreach results before trying again.'],
    ['/analytics','AU','Audit & Reporting','Monitor activity, delivery, and operational results.'],
  ];
  return <><PageTitle title="Administration" subtitle="Manage organization-wide outreach settings." /><div className="admin-grid">{cards.map(([href,icon,title,body]) => <Link className="admin-card" href={href} key={href}><b>{icon}</b><div><h2>{title}</h2><p>{body}</p></div><span>→</span></Link>)}</div><Alert>Configuration changes are authenticated and recorded in the audit log. DNC rules cannot be bypassed.</Alert><div className="metric-grid"><Stat label="Cadence steps" value={String(snapshot.cadence.length)} /><Stat label="SMS templates" value={String(snapshot.templates.length)} /><Stat label="Review queue" value={String(snapshot.system.review_queue ?? 0)} /><Stat label="Pending updates" value={String(snapshot.system.provider_queue ?? 0)} /></div><KeapSyncPanel /><BlockedNumbersPanel action={action} /></>;
}

type BlockedNumber = {
  phone: string;
  reason: string | null;
  source: string | null;
  blocked_at: string;
  leads: Array<{ id: string; full_name: string; status: string }>;
  open_lead_id: string | null;
};

// Every blocked number, including ones whose lead was deleted, so an admin can always release one.
// A number that still has an open lead is unblocked from that lead's page (continue or start over).
function BlockedNumbersPanel({ action }: { action: DashboardAction }) {
  const [numbers, setNumbers] = useState<BlockedNumber[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    dashboardFetch('/api/dashboard/blocked-numbers', { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<{ numbers: BlockedNumber[] }>) : Promise.reject(new Error('blocked numbers unavailable'))))
      .then((body) => { setNumbers(body.numbers ?? []); setFailed(false); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [reload]);
  async function unblock(phone: string) {
    setBusy(true);
    try {
      if (await action('blocked-numbers/unblock', 'POST', { phone }, 'Number unblocked')) {
        setConfirming(null);
        setReload((n) => n + 1);
      }
    } finally { setBusy(false); }
  }
  if (failed) return <Panel title="Blocked numbers"><p className="muted">The blocked numbers could not be loaded right now.</p></Panel>;
  if (!numbers) return <Panel title="Blocked numbers"><SkeletonRows rows={2} /></Panel>;
  return <Panel title="Blocked numbers">
    <p className="muted">Numbers that are never called or texted (the patient asked not to be contacted, or staff chose Do not contact). Unblocking does not call anyone; the next Start cadence on the number runs normally.</p>
    {numbers.length === 0 ? <Empty title="No blocked numbers" body="Numbers appear here when a patient asks not to be contacted." /> :
      <DataTable heads={['Number', 'Reason', 'Blocked', 'Lead', '']}>{numbers.map((item) => {
        const lead = item.leads[0];
        return <tr key={item.phone}>
          <td>{item.phone}</td>
          <td>{operationalMessage(item.reason)}</td>
          <td>{date(item.blocked_at)}</td>
          <td>{lead ? <Link href={`/leads/${lead.id}`}>{lead.full_name}</Link> : <span className="muted">Lead deleted</span>}</td>
          <td>{item.open_lead_id
            ? <Link className="text-action" href={`/leads/${item.open_lead_id}`}>Unblock on the lead page →</Link>
            : confirming === item.phone
              ? <span className="inline-actions"><button className="primary" type="button" disabled={busy} onClick={() => unblock(item.phone)}>Confirm unblock</button> <button className="secondary" type="button" disabled={busy} onClick={() => setConfirming(null)}>Cancel</button></span>
              : <button className="secondary" type="button" onClick={() => setConfirming(item.phone)}>Unblock</button>}</td>
        </tr>;
      })}</DataTable>}
  </Panel>;
}

function GlobalCadencePage({ snapshot, action, loading }: { snapshot: Snapshot; action: DashboardAction; loading: boolean }) {
  return <><PageTitle title="Global Cadence Studio" subtitle="Build, compare, and activate audited outreach versions." /><Alert>New leads start on the active version. Leads already in outreach stay on the version they started.</Alert>
    <CadenceStudio action={action} templates={snapshot.templates} loading={loading && !snapshot.cadence.length} />
  </>;
}

function CadenceStudio({ action, templates, loading = false }: { action: DashboardAction; templates: Array<Record<string, unknown>>; loading?: boolean }) {
  const [versions, setVersions] = useState<CadenceVersion[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [fetching, setFetching] = useState(true);
  const [creating, setCreating] = useState(false);
  const [activating, setActivating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [hardDeleting, setHardDeleting] = useState<number | null>(null);
  const [updatingStep, setUpdatingStep] = useState<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    dashboardFetch('/api/dashboard/cadence-versions', { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<{ versions: CadenceVersion[] }> : Promise.reject())
      .then((data) => {
        setVersions(data.versions);
        const scoped = data.versions;
        const preferred = scoped.filter((version) => version.status !== 'deleted');
        setSelectedId((current) => scoped.some((version) => version.id === current)
          ? current
          : (preferred.find((version) => version.status === 'draft') ?? preferred.find((version) => version.status === 'active') ?? preferred[0])?.id ?? null);
        setError('');
      })
      .catch((cause) => { if (cause?.name !== 'AbortError') setError('Cadence versions could not be loaded.'); })
      .finally(() => setFetching(false));
    return () => controller.abort();
  }, [refresh]);

  const scoped = versions.filter((version) => version.status !== 'deleted');
  const deleted = versions.filter((version) => version.status === 'deleted');
  const selectable = [...scoped, ...deleted];
  const selected = selectable.find((version) => version.id === selectedId) ?? scoped[0];
  const source = selected ?? versions.find((version) => version.status === 'active' && version.scope === 'global');

  async function cloneVersion(sourceVersion: CadenceVersion | undefined = source) {
    if (!sourceVersion || creating) return;
    setCreating(true);
    try {
      const created = await action('cadence-versions', 'POST', {
        source_version_id: sourceVersion.id,
      }) as unknown as CadenceVersion | null;
      if (created?.id) {
        setVersions((current) => [...current, created]);
        setSelectedId(created.id);
      }
    } finally {
      setCreating(false);
    }
  }

  async function saveName() {
    if (!selected || !renameValue.trim() || renaming) return;
    setRenaming(true);
    try {
      const renamed = await action(`cadence-versions/${selected.id}/name`, 'PATCH', { name: renameValue.trim() }) as unknown as CadenceVersion | null;
      if (renamed?.id) {
        setVersions((current) => current.map((version) => version.id === renamed.id ? renamed : version));
        setRenameValue('');
      }
    } finally {
      setRenaming(false);
    }
  }

  async function deleteVersion() {
    if (!selected || selected.status === 'active' || deleting) return;
    if (!window.confirm(`Delete ${selected.name}? It will remain available in Deleted versions for audit history.`)) return;
    setDeleting(true);
    try {
      const removed = await action(`cadence-versions/${selected.id}`, 'DELETE') as unknown as CadenceVersion | null;
      if (removed?.status === 'deleted') {
        setSelectedId(scoped.find((version) => version.id !== selected.id)?.id ?? null);
        setRefresh((value) => value + 1);
      }
    } finally {
      setDeleting(false);
    }
  }

  async function activatePreviousVersion() {
    if (!selected || selected.status !== 'archived' || activating) return;
    if (!window.confirm(`Activate ${selected.name}?\n\nNew leads will start on it. Leads already in outreach stay on the version they started with.`)) return;
    setActivating(true);
    try {
      if (await action(`cadence-versions/${selected.id}/activate`, 'POST')) {
        setRefresh((value) => value + 1);
      }
    } finally {
      setActivating(false);
    }
  }

  async function togglePublishedStep(step: CadenceStep, enabled: boolean) {
    if (!step.id || updatingStep !== null) return;
    setUpdatingStep(step.id);
    try {
      const updated = await action(`cadence-steps/${step.id}`, 'PATCH', { is_active: enabled });
      if (updated) {
        setVersions((current) => current.map((version) => version.id === selected.id
          ? { ...version, steps: version.steps.map((item) => item.id === step.id ? { ...item, is_active: enabled } : item) }
          : version));
      }
    } finally {
      setUpdatingStep(null);
    }
  }

  async function permanentlyDeleteVersion(version: CadenceVersion) {
    if (version.status !== 'deleted' || hardDeleting !== null) return;
    if (!window.confirm(`Permanently delete ${version.name}?\n\nThis removes its cadence steps and message copy and cannot be undone.`)) return;
    setHardDeleting(version.id);
    try {
      const removed = await action(`cadence-versions/${version.id}/permanent`, 'DELETE');
      if (removed?.status === 'permanently_deleted') {
        setVersions((current) => current.filter((item) => item.id !== version.id));
        if (selectedId === version.id) setSelectedId(scoped[0]?.id ?? null);
        setRefresh((value) => value + 1);
      }
    } finally {
      setHardDeleting(null);
    }
  }

  if (loading || fetching) return <Panel title="Loading cadence versions"><SkeletonRows rows={5} /></Panel>;
  if (error) return <Panel title="Cadence unavailable"><Alert tone="warning">{error}</Alert><button className="secondary" type="button" onClick={() => { setFetching(true); setRefresh((value) => value + 1); }}>Retry connection</button></Panel>;

  if (!selected) return <Panel><Empty title="No cadence configured" body="Create and seed an active global cadence before adding versions." /></Panel>;

  return <div className="cadence-version-layout"><section className="cadence-studio">
    <div className="version-tabs" role="group" aria-label="Global cadence versions">
      {scoped.map((version) => <button type="button" aria-pressed={version.id === selected.id} className={version.id === selected.id ? 'selected' : ''} onClick={() => setSelectedId(version.id)} key={version.id}><span>{version.name}</span><small>{cadenceStatusLabel(version.status)}</small></button>)}
      <button className="add-version" type="button" disabled={creating} onClick={() => cloneVersion()}>{creating ? 'Creating…' : '+ Add version'}</button>
    </div>
    <div className="version-toolbar"><div>{renameValue ? <label className="version-name-editor"><span className="sr-only">Version name</span><input autoFocus value={renameValue} maxLength={120} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveName(); if (event.key === 'Escape') setRenameValue(''); }} /></label> : <strong>{selected.name}</strong>}<small>{selected.status === 'deleted' ? 'This complete version is retained and can be reused as a new draft.' : 'Use the Status column to enable or disable steps. Create a draft for timing, channel, or wording changes.'}</small></div><div className="version-toolbar-actions">{renameValue ? <><button className="secondary" type="button" disabled={renaming || !renameValue.trim()} onClick={saveName}>{renaming ? 'Saving…' : 'Save name'}</button><button className="secondary" type="button" onClick={() => setRenameValue('')}>Cancel</button></> : <button className="secondary" type="button" onClick={() => setRenameValue(selected.name)}>Rename</button>}{selected.status === 'deleted' ? <button className="primary" type="button" disabled={creating} onClick={() => cloneVersion(selected)}>{creating ? 'Creating…' : 'Reuse as new draft'}</button> : <button className="danger-button" type="button" disabled={selected.status === 'active' || deleting} onClick={deleteVersion}>{deleting ? 'Deleting…' : 'Delete version'}</button>}</div></div>
    {selected.status === 'draft'
      ? <CadenceEditor key={`${selected.id}-${selected.name}`} version={selected} templates={templates} action={action} onChanged={() => setRefresh((value) => value + 1)} />
      : <div className="two-col wide-left"><Panel title={selected.name}><CadenceStepsTable steps={selected.steps} onToggle={selected.status === 'deleted' ? undefined : togglePublishedStep} updatingStep={updatingStep} /></Panel><div className="stack"><Panel title="Version details"><dl className="detail-list"><div><dt>Status</dt><dd><StatusText status={cadenceStatusLabel(selected.status)} /></dd></div><div><dt>Version</dt><dd>v{selected.version_number}</dd></div><div><dt>Scope</dt><dd>Global default</dd></div><div><dt>Steps</dt><dd>{selected.steps.length}</dd></div></dl><div className="version-detail-actions">{selected.status === 'archived' && <button className="primary full" type="button" disabled={activating} onClick={activatePreviousVersion}>{activating ? 'Activating…' : 'Activate this version'}</button>}<button className={selected.status === 'archived' ? 'secondary full' : 'primary full'} type="button" disabled={creating || activating} onClick={() => cloneVersion(selected)}>{creating ? 'Creating…' : selected.status === 'deleted' ? 'Reuse as new draft' : 'Create editable draft'}</button></div><p className="control-note">Status changes apply when this version starts or restarts. Current lead schedules stay unchanged. Create a draft for every other edit.</p></Panel><Panel title="Guardrails"><ul className="check-list"><li>✓ DNC enforced</li><li>✓ Call opt-out enforced</li><li>✓ Business-hour windows</li><li>✓ Audited changes</li></ul></Panel></div></div>}
  </section><aside className="deleted-versions"><header><div><h2>Deleted versions</h2><p>Review, reuse, or permanently remove</p></div><span>{deleted.length}</span></header>{deleted.length ? <div className="deleted-version-list">{deleted.map((version) => <article className={version.id === selected.id ? 'selected' : ''} key={version.id}><button type="button" className="deleted-version-select" aria-pressed={version.id === selected.id} onClick={() => { setSelectedId(version.id); setRenameValue(''); }}><strong>{version.name}</strong><small>Deleted {version.deleted_at ? date(version.deleted_at) : 'recently'}</small><span>v{version.version_number} · {version.steps.length} steps</span></button>{<button className="permanent-delete" type="button" disabled={hardDeleting !== null} onClick={() => permanentlyDeleteVersion(version)} aria-label={`Permanently delete ${version.name}`}>{hardDeleting === version.id ? 'Deleting…' : 'Permanently delete'}</button>}</article>)}</div> : <p className="deleted-empty">Deleted cadence versions will appear here.</p>}</aside></div>;
}

function cadenceStatusLabel(status: CadenceVersion['status']) {
  return status === 'draft' ? 'Draft' : status === 'archived' ? 'Previous' : humanize(status);
}

function CadenceStepsTable({ steps, onToggle, updatingStep }: { steps: CadenceStep[]; onToggle?: (step: CadenceStep, enabled: boolean) => Promise<void>; updatingStep?: number | null }) {
  return <DataTable heads={['Step','Day','Action','Channel','Status']}>{steps.map((step,index)=><tr key={step.id ?? index}><td><span className="step-number">{index+1}</span></td><td>Day {step.day_offset}</td><td><strong>{cadenceStepName(step)}</strong>{step.channel === 'sms' && <small className="step-copy">{step.sms_body}</small>}</td><td>{step.channel === 'call' ? 'Phone call' : 'Text message'}</td><td>{onToggle ? <label className="cadence-status-toggle"><input type="checkbox" checked={step.is_active} disabled={updatingStep !== null} onChange={(event) => void onToggle(step, event.target.checked)} /><span>{updatingStep === step.id ? 'Saving…' : step.is_active ? 'Active' : 'Disabled'}</span></label> : <StatusText status={step.is_active ? 'Active' : 'Disabled'} />}</td></tr>)}</DataTable>;
}

function CadenceEditor({ version, templates, action, onChanged }: { version: CadenceVersion; templates: Array<Record<string, unknown>>; action: DashboardAction; onChanged: (activated: boolean) => void }) {
  const [name, setName] = useState(version.name);
  const [steps, setSteps] = useState<CadenceStep[]>(() => version.steps.map((step) => ({ ...step, description: cadenceStepName(step) })));
  const [selectedStep, setSelectedStep] = useState(0);
  const [draggingStep, setDraggingStep] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const step = steps[selectedStep];
  const savedTemplates = templates.filter((template) => Boolean(template.deletable) && Boolean(template.is_active) && String(template.body ?? '').trim());
  const valid = Boolean(name.trim()) && steps.some((step) => step.is_active) && steps.every((step) => cadenceActionDescription(step.description) && step.description.length <= 300 && (step.channel !== 'sms' || step.sms_body?.trim()));
  function update(index: number, change: Partial<CadenceStep>) { setSteps((current) => current.map((step,position) => position === index ? { ...step, ...change, description: cadenceStepName({ ...step, ...change }) } : step)); }
  function reorder(from: number, to: number) {
    if (from === to || to < 0 || to >= steps.length) return;
    setSteps((current) => reorderCadenceSteps(current, from, to));
    setSelectedStep(to);
  }
  function move(index: number, offset: number) { reorder(index, index + offset); }
  function addStep() { setSteps((current) => [...current, { step_order: current.length, day_offset: current.at(-1)?.day_offset ?? 0, channel: 'call', description: cadenceStepName({ day_offset: current.at(-1)?.day_offset ?? 0, description: 'Scheduling call' }), is_active: true, sms_body: null }]); setSelectedStep(steps.length); }
  function deleteStep() { if (steps.length === 1) return; setSteps((current) => current.filter((_, position) => position !== selectedStep)); setSelectedStep((current) => Math.max(0, Math.min(current, steps.length - 2))); }
  async function save(activate: boolean) {
    if (!valid || saving) return;
    if (activate && !window.confirm('Activate this version?\n\nNew leads will start on it. Leads already in outreach stay on the version they started with.')) return;
    setSaving(true);
    try {
      const saved = await action(`cadence-versions/${version.id}`, 'PUT', { name: name.trim(), steps: steps.map((step) => ({ day_offset: step.day_offset, channel: step.channel, description: cadenceStepName(step), is_active: step.is_active, sms_body: step.channel === 'sms' ? step.sms_body : null })) });
      if (saved && (!activate || await action(`cadence-versions/${version.id}/activate`, 'POST'))) onChanged(activate);
    } finally { setSaving(false); }
  }
  return <Panel title="Draft cadence editor"><div className="cadence-editor">
    <label className="field-label">Version name<input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
    <div className="plan-builder"><aside className="plan-step-nav"><header><div><strong>Plan steps</strong><small>Drag to reorder or select a step to edit</small></div><span>{steps.length}</span></header><div>{steps.map((item,index)=><button
      type="button"
      draggable
      className={`${index===selectedStep?'selected ':''}${draggingStep===index?'is-dragging ':''}${dropTarget===index&&draggingStep!==index?'drop-target':''}`.trim()}
      aria-pressed={index===selectedStep}
      aria-label={`Step ${index + 1}: ${item.description}. Day ${item.day_offset}. Drag to reorder.`}
      onClick={()=>setSelectedStep(index)}
      onDragStart={(event)=>{event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(index));setDraggingStep(index);setDropTarget(index);}}
      onDragEnter={()=>setDropTarget(index)}
      onDragOver={(event)=>{event.preventDefault();event.dataTransfer.dropEffect='move';setDropTarget(index);}}
      onDrop={(event)=>{event.preventDefault();const from=Number(event.dataTransfer.getData('text/plain'));if(Number.isInteger(from))reorder(from,index);setDraggingStep(null);setDropTarget(null);}}
      onDragEnd={()=>{setDraggingStep(null);setDropTarget(null);}}
      key={item.id ?? index}
    ><span className="plan-step-number">{index+1}</span><div><strong>{item.description || `Step ${index+1}`}</strong><small>Day {item.day_offset} · {item.channel==='call'?'Phone call':'Text message'}{item.is_active?'':' · Disabled'}</small></div><span className="plan-drag-handle"><GripIcon /></span></button>)}</div><button className="secondary full" type="button" onClick={addStep}>+ Add step</button></aside>
      {step && <fieldset className="plan-step-detail"><legend className="sr-only">Edit step {selectedStep+1}</legend><header><div><span>Step {selectedStep+1}</span><h3>{step.description || 'Untitled step'}</h3></div><label className="enabled-check"><input type="checkbox" checked={step.is_active} onChange={(event)=>update(selectedStep,{is_active:event.target.checked})} />Enabled</label></header>
        <div className="step-fields"><label>Day<input type="number" min="0" max="365" value={step.day_offset} onChange={(event)=>update(selectedStep,{day_offset:Number(event.target.value)})} /></label><div className="step-select-field"><span>Channel</span><SelectMenu ariaLabel={`Channel for step ${selectedStep + 1}`} value={step.channel} onChange={(value)=>update(selectedStep,{channel:value as 'call'|'sms',sms_body:value==='sms'?(step.sms_body??''):null})} options={[{ value: 'call', label: 'Phone call' }, { value: 'sms', label: 'Text message' }]} /></div><label className="step-action">Action description<input value={cadenceActionDescription(step.description)} maxLength={290} onChange={(event)=>update(selectedStep,{description:event.target.value})} /></label>
          {step.channel==='sms'&&<div className="step-message"><div className="step-message-toolbar"><label htmlFor={`step-message-${version.id}-${selectedStep}`}>Text message</label>{savedTemplates.length ? <SelectMenu className="template-import" ariaLabel={`Import a saved template into step ${selectedStep + 1}`} value="" onChange={(value)=>{const template=savedTemplates.find((item)=>String(item.id)===value);if(template)update(selectedStep,{sms_body:String(template.body)});}} options={[{value:'',label:'Import saved template'},...savedTemplates.map((template)=>({value:String(template.id),label:smsTemplateName(template)}))]} /> : <small>No saved templates available</small>}</div><textarea id={`step-message-${version.id}-${selectedStep}`} value={step.sms_body??''} maxLength={1600} onChange={(event)=>update(selectedStep,{sms_body:event.target.value})} /></div>}
        </div><footer><div className="step-reorder"><button type="button" className="icon-button" disabled={selectedStep===0} onClick={()=>move(selectedStep,-1)}><ArrowIcon direction="up" />Move earlier</button><button type="button" className="icon-button" disabled={selectedStep===steps.length-1} onClick={()=>move(selectedStep,1)}><ArrowIcon direction="down" />Move later</button></div><button type="button" className="icon-button danger" disabled={steps.length===1} onClick={deleteStep}>Delete step</button></footer></fieldset>}
    </div><div className="editor-actions"><button className="secondary" type="button" disabled={!valid||saving} onClick={()=>save(false)}>{saving?'Saving…':'Save draft'}</button><button className="primary" type="button" disabled={!valid||saving} onClick={()=>save(true)}>{saving?'Saving…':'Activate version'}</button></div>
  </div></Panel>;
}

function TemplateStudio({ snapshot, action, onPublished }: { snapshot: Snapshot; action: DashboardAction; onPublished: (id: string, body: string, name: string) => void }) {
  const templates = snapshot.templates;
  const [selectedId, setSelectedId] = useState(String(snapshot.templates[0]?.id ?? ''));
  const [draftBodies, setDraftBodies] = useState<Record<string, string>>({});
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [publishing, setPublishing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Reusable copy and live cadence messages are different things: the first is
  // freely editable, the second belongs to a published version and changing it
  // here would alter what live leads receive with no new version to show for it.
  const reusable = templates.filter((item) => item.cadence_step_id == null && item.cadence_version_id == null);
  const cadenceMessages = templates.filter((item) => item.cadence_step_id != null);
  const cadenceVersionName = String(cadenceMessages[0]?.version_name ?? 'active cadence');
  const selected = templates.find((item) => String(item.id) === selectedId) ?? reusable[0] ?? templates[0];
  const locked = Boolean(selected && selected.cadence_step_id != null);
  const id = String(selected?.id ?? '');
  const original = String(selected?.body ?? '');
  const originalName = smsTemplateName(selected);
  const body = draftBodies[id] ?? original;
  const name = draftNames[id] ?? originalName;
  const dirty = !locked && (body !== original || name.trim() !== originalName);
  function discard() {
    setDraftBodies((current) => { const next = { ...current }; delete next[id]; return next; });
    setDraftNames((current) => { const next = { ...current }; delete next[id]; return next; });
  }
  async function publish() {
    if (!selected || !dirty || publishing || !name.trim() || !body.trim()) return;
    setPublishing(true);
    try {
      const updated = await action(`message-templates/${selected.id}`,'PATCH',{name:name.trim(),body});
      if (updated) {
        onPublished(id, body, name.trim());
        discard();
      }
    } finally { setPublishing(false); }
  }
  async function createTemplate(templateName: string, templateBody: string) {
    const created = await action('message-templates', 'POST', { name: templateName, body: templateBody });
    if (!created?.id) return false;
    setSelectedId(String(created.id));
    setAdding(false);
    return true;
  }
  async function deleteTemplate() {
    if (!selected || !Boolean(selected.deletable) || deleting) return;
    if (!window.confirm(`Permanently delete ${originalName}?\n\nThis saved template cannot be recovered.`)) return;
    setDeleting(true);
    try {
      const removed = await action(`message-templates/${selected.id}`, 'DELETE');
      if (removed?.status === 'permanently_deleted') setSelectedId(String(templates.find((item) => item.id !== selected.id)?.id ?? ''));
    } finally { setDeleting(false); }
  }
  return <><PageTitle title="SMS Template Studio" subtitle="Manage reusable message copy for patient outreach." tools={<><button className="secondary" type="button" disabled={!dirty || publishing} onClick={discard}>Discard changes</button><button className="primary" type="button" disabled={!dirty || publishing || !body.trim() || !name.trim()} onClick={publish}>{publishing ? 'Publishing…' : 'Publish changes'}</button></>} /><Alert>Reusable templates are your own copy, ready to import into a cadence draft. Cadence messages belong to the published cadence and are locked here — change them by creating a draft in Cadence Studio.</Alert>
    <div className="template-layout"><Panel title="Templates"><div className="template-list-actions"><p>{reusable.length} reusable · {cadenceMessages.length} cadence message{cadenceMessages.length === 1 ? '' : 's'}</p><button className="secondary" type="button" onClick={() => setAdding(true)}>+ Add template</button></div><p className="template-group-label">Reusable templates</p>{reusable.length ? reusable.map((item) => <button type="button" className={`template-item ${selected?.id === item.id ? 'selected' : ''}`} key={String(item.id)} onClick={() => setSelectedId(String(item.id))}><span><EnvelopeIcon /></span><div><strong>{smsTemplateName(item)}</strong><small>{item.cadence_step_id ? `Day ${String(item.day_offset ?? '')} · locked` : 'Reusable'}</small></div></button>) : <p className="control-note">No reusable templates yet.</p>}<p className="template-group-label">Cadence messages · {cadenceVersionName}</p>{cadenceMessages.map((item) => <button type="button" className={`template-item ${selected?.id === item.id ? 'selected' : ''}`} key={String(item.id)} onClick={() => setSelectedId(String(item.id))}><span><EnvelopeIcon /></span><div><strong>{smsTemplateName(item)}</strong><small>{item.cadence_step_id ? `Day ${String(item.day_offset ?? '')} · locked` : 'Reusable'}</small></div></button>)}</Panel><Panel title={selected ? name || 'Untitled template' : 'SMS template'}>{selected ? <>{locked && <Alert tone="warning">This message is part of {cadenceVersionName} and is locked. Create an editable draft in Cadence Studio to change it.</Alert>}<label className="field-label">Template name<input value={name} maxLength={120} readOnly={locked} onChange={(event)=>setDraftNames((current)=>({...current,[id]:event.target.value}))} /></label><label className="field-label template-body-field">Message body<textarea value={body} readOnly={locked} onChange={(event)=>setDraftBodies((current)=>({...current,[id]:event.target.value}))} maxLength={1600} /></label><div className="editor-footer"><StatusText status={locked ? 'Locked' : body.trim() && name.trim() ? 'Ready to publish' : 'Needs content'} /><span>{body.length} / 1600</span></div></> : <Empty title="Choose a template" body="Select a message from the template list." />}</Panel><div className="stack"><Panel title="Preview"><div className="phone-preview"><small>Template preview</small><p>{body.replace('{{first_name}}','Patient').replace('{{location}}','Preferred location')}</p></div></Panel><Panel title="Template settings"><dl className="detail-list"><div><dt>Channel</dt><dd>Text message</dd></div><div><dt>Type</dt><dd>{locked ? `Cadence message · ${cadenceVersionName}` : 'Reusable template'}</dd></div><div><dt>Editable</dt><dd><StatusText status={locked ? 'Locked' : 'Yes'} /></dd></div></dl>{selected && <><button className="danger-button full" type="button" disabled={!Boolean(selected.deletable) || deleting} onClick={deleteTemplate}>{deleting ? 'Deleting…' : 'Permanently delete'}</button>{!Boolean(selected.deletable) && <p className="control-note">Cadence messages stay protected here. Remove their step from a cadence draft instead.</p>}</>}</Panel></div></div>{adding && <NewTemplateDialog onClose={() => setAdding(false)} onCreate={createTemplate} />}</>;
}

function smsTemplateName(template: Record<string, unknown> | undefined) {
  if (!template) return '';
  const raw = String(template.name ?? template.key ?? 'SMS template');
  const generated = raw.match(/^step_(\d+)_[0-9a-f]{12}$/i);
  if (generated) return `Step ${generated[1]}`;
  return raw.replaceAll('_', ' ').replace(/^day\s*(\d+)\s+sms$/i, 'Day $1 SMS').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function NewTemplateDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, body: string) => Promise<boolean> }) {
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); if (!name.trim() || !body.trim() || saving) return; setSaving(true); if (!await onCreate(name.trim(), body.trim())) setSaving(false); }
  return <ModalShell className="template-dialog" labelId="new-template-title" onClose={onClose}><header><div><h2 id="new-template-title">Add SMS template</h2><p>Create reusable message copy for the outreach team.</p></div><button className="close-button" type="button" onClick={onClose} aria-label="Close template dialog">×</button></header><form onSubmit={submit}><label className="field-label">Template name<input autoFocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label><label className="field-label">Message body<textarea value={body} maxLength={1600} onChange={(event) => setBody(event.target.value)} /></label><footer><button className="secondary" type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={saving || !name.trim() || !body.trim()}>{saving ? 'Adding…' : 'Add template'}</button></footer></form></ModalShell>;
}

function LeadFrame({ detail, tab, action, role, children }: { detail: LeadDetail; tab: string; action: DashboardAction; role: StaffUser['role']; children: ReactNode }) {
  const lead = detail.lead;
  const id = String(lead.id);
  const stage = String(lead.stage ?? 'cadence') as LeadStage;
  const phone = String(lead.phone_e164 ?? lead.phone ?? 'No phone recorded');
  const numberBlock = (lead.number_block ?? null) as NumberBlock | null;
  const [unblocking, setUnblocking] = useState(false);
  // Count only the current cadence run: a restarted lead keeps its earlier
  // events, and including them read as "12 of 16" on an eight-step cadence.
  const currentRun = splitCadenceRuns(detail.events).at(-1) ?? [];
  const currentSummary = cadenceRunSummary(currentRun);
  const progress = currentSummary.attempted;
  const total = currentSummary.expectedSteps ?? currentRun.filter(isCadenceStep).length;
  const [busy,setBusy] = useState(false);
  const cadencePaused = lead.cadence_state === 'paused';
  const cadenceOver = stage === 'closed' || stage === 'booked';
  // 2026-10-21: Resume on a flagged lead left the review open, so nothing went out. While a review is
  // open the only way forward is a choice (the backend refuses Resume too).
  const review = reviewOf({ needs_review: Boolean(lead.needs_review), review_reason: (lead.review_reason as string | null) ?? null, review: (lead.review ?? null) as Lead['review'] });
  const [reviewOpen, setReviewOpen] = useState(false);
  const [choosing, setChoosing] = useState<ReviewChoice | null>(null);
  const textsOff = Boolean(lead.texts_off);
  async function toggleCadence(){ setBusy(true); try { await action(`leads/${id}/cadence`,'POST',{action: cadencePaused ? 'resume':'pause'}); } finally {setBusy(false);} }
  const router = useRouter();
  const [deleting,setDeleting] = useState(false);
  async function removeLead(){
    // Names what actually goes, because it is not recoverable from here: the
    // cadence, calls, texts and history all follow the lead out.
    if (!window.confirm(`Delete ${lead.full_name}?

This removes the lead and everything attached to it - cadence schedule, calls, texts, appointments and history. It cannot be undone.`)) return;
    setDeleting(true);
    if (await action(`leads/${id}`,'DELETE')) router.push('/leads');
    else setDeleting(false);
  }
  return <><div className="breadcrumbs"><Link href="/leads">Lead Pipeline</Link><span>/</span><span>{String(lead.display_id)}</span><span>/</span><strong>{lead.full_name}</strong></div><section className="lead-header"><div className="lead-avatar">{initials(lead.full_name)}</div><div className="lead-identity"><h1>{lead.full_name}</h1><span><PhoneIcon />{phone}</span></div><StatusBadge stage={stage} paused={cadencePaused} />{numberBlock && <BlockedTag />}{total > 0 && !cadenceOver && <span className="version">{String(lead.cadence_version_name ?? detail.cadence_version?.name ?? 'Cadence')} · {progress} of {total}</span>}<span className="location"><MapPinIcon />{String(lead.location ?? 'Not assigned')}</span>{textsOff && <span className="status-pill texts-off" title={String(lead.sms_disabled_reason ?? '')}>Calls only (texts off)</span>}<div className="record-actions">{review ? <button className="primary icon-label" type="button" onClick={() => setReviewOpen(true)}>Resolve review</button> : !cadenceOver && <button className="secondary icon-label" type="button" disabled={busy} onClick={toggleCadence} title={cadencePaused ? 'Resume cadence' : 'Pause cadence'}>{cadencePaused ? <PlayIcon /> : <PauseIcon />}{cadencePaused ? 'Resume cadence':'Pause cadence'}</button>}<Link className="primary icon-label" href={`/leads/${id}/conversations/sms`}><EnvelopeIcon />Send SMS</Link>{role === 'super_admin' && <button className="danger-button icon-label" type="button" disabled={busy || deleting} onClick={removeLead} title="Delete lead" aria-label="Delete lead"><TrashIcon />{deleting ? 'Deleting…' : 'Delete lead'}</button>}</div></section><nav className="record-tabs">{[['overview','Overview',`/leads/${id}`],['conversations','Conversations',`/leads/${id}/conversations/sms`],['cadence','Cadence',`/leads/${id}/cadence`],['appointments','Appointments',`/leads/${id}/appointments`],['activity','Activity',`/leads/${id}/activity`]].map(([key,label,href])=><Link className={tab===key?'active':''} aria-current={tab === key ? 'page' : undefined} href={href} key={key}>{label}</Link>)}</nav>{numberBlock && <Alert tone="danger"><strong>This number is blocked.</strong> No calls or texts will go out to it. {numberBlockMessage(numberBlock)}{role === 'super_admin' && <> <button className="link-button" type="button" onClick={() => setUnblocking(true)}>Unblock number</button></>}</Alert>}{lead.status_reason === 'replaced by a newer referral on this number' && <Alert tone="info"><strong>Closed: a newer Sheet row with the same phone number took over.</strong> Only one lead per phone number is called and texted; this lead keeps its history.</Alert>}{lead.status_reason === 'replaced: another lead with this phone was restarted' && <Alert tone="info"><strong>Closed: another row with this phone number was restarted.</strong> Only one lead per phone number is called and texted; this lead keeps its history.</Alert>}{review && <Alert tone="warning"><strong>Needs review: {review.title}.</strong> {review.reason} <button className="link-button" type="button" onClick={() => setReviewOpen(true)}>Resolve review</button></Alert>}{children}{unblocking && <UnblockDialog detail={detail} action={action} onClose={() => setUnblocking(false)} />}{review && reviewOpen && !choosing && <ModalShell className="review-dialog" labelId="review-title" onClose={() => setReviewOpen(false)}><header><div><h2 id="review-title">Resolve review</h2><p>{lead.full_name}: choose what happens next.</p></div><button className="close-button" type="button" onClick={() => setReviewOpen(false)} aria-label="Close review">×</button></header><div className="review-dialog-body"><ReviewCard review={review} onChoose={setChoosing} /></div></ModalShell>}{choosing && <ResolveDialog leadId={id} choice={choosing} action={action} onClose={() => { setChoosing(null); setReviewOpen(false); }} />}</>;
}

function LeadOverview({ detail }: { detail: LeadDetail }) {
  const lead=detail.lead;
  const stage = String(lead.stage ?? 'cadence') as LeadStage;
  // A finished lead has an outcome, not a pending action, and no schedule to open.
  const cadenceOver = stage === 'closed' || stage === 'booked';
  const pendingResult = !cadenceOver && detail.events.some((event) => event.status === 'attempted' || event.status === 'in_flight');
  // A paused lead has no planned step (pausing skips them), so it used to read
  // "Cadence complete" while it was really stopped for review, e.g. after a failed SMS.
  const paused = !cadenceOver && !pendingResult && lead.cadence_state === 'paused';
  const needsReview = stage === 'attention';
  const nextAction = paused
    ? (needsReview ? 'Paused, needs attention' : 'Cadence paused')
    : String(lead.next_step ?? (pendingResult ? 'Awaiting outreach result' : detail.events.length ? 'Cadence complete' : 'No cadence scheduled'));
  const nextCopy = cadenceOver ? 'Automated outreach has ended for this lead.'
    : pendingResult ? 'An outreach step is waiting for confirmation.'
    : paused ? (needsReview ? 'No calls or texts go out until someone resolves the review. Use Resolve review at the top and pick what happens next.' : 'No calls or texts go out until the cadence is resumed.')
    : lead.next_event_id ? 'Continue the scheduled outreach cadence.' : 'No planned outreach event remains.';
  const booking = detail.booking ?? null;
  // A booked lead's outcome IS its booking, so the booking card replaces the outcome box.
  const outcomePanel = !(booking && stage === 'booked');
  return <div className="stack">{booking && <Panel title="Appointment"><BookingCardView booking={booking} leadId={lead.id} booked={stage === 'booked'} /></Panel>}<Panel title="Lead information"><dl className="info-grid"><div><dt>Lead ID</dt><dd>{String(lead.display_id)}</dd></div><div><dt>Source</dt><dd>{sourceLabel(lead.source ?? lead.source_system)}</dd></div><div><dt>Owner</dt><dd>{String(lead.owner ?? 'Unassigned')}</dd></div><div><dt>Created</dt><dd>{date(String(lead.created_at ?? ''))}</dd></div>{Boolean(lead.date_of_birth) && <div><dt>Date of birth</dt><dd>{String(lead.date_of_birth)}</dd></div>}{Boolean(lead.referred_by) && <div><dt>Referred by</dt><dd>{String(lead.referred_by)}</dd></div>}{Boolean(lead.lead_type) && <div><dt>Lead type</dt><dd>{String(lead.lead_type)}</dd></div>}<div><dt>Preferred location</dt><dd>{String(lead.location ?? 'Not assigned')}</dd></div><div><dt>Time zone</dt><dd>{timezoneLabel(lead.timezone)}</dd></div></dl></Panel>{outcomePanel && <Panel title={cadenceOver ? "Outcome" : "Next action"}><div className="next-action"><span className="status-icon"><PhoneIcon size={20} /></span><div><strong>{nextAction}</strong><p>{nextCopy}</p></div><Link className="secondary" href={`/leads/${lead.id}/cadence`}>View schedule</Link></div></Panel>}<Panel title="Notes">{lead.review ? <p><strong>Why this lead needs attention:</strong> {String((lead.review as { reason?: string }).reason ?? '')}</p> : stage === 'attention' && Boolean(lead.review_reason) ? <p><strong>Why this lead needs attention:</strong> {operationalMessage(lead.review_reason)}</p> : <p className="muted">No additional lead notes have been recorded.</p>}{Boolean(lead.texts_off) && <p><strong>Calls only (texts off):</strong> staff turned texts off for this lead{lead.sms_disabled_reason ? ` (${String(lead.sms_disabled_reason)})` : ''}.</p>}</Panel></div>;
}

function BookingCardView({ booking, leadId, booked }: { booking: BookingCard; leadId: string; booked: boolean }) {
  const bucket = statusBucket(booking.state);
  const off = bucket === 'cancelled' || bucket === 'no_show';
  const start = new Date(booking.start_utc);
  const part = (options: Intl.DateTimeFormatOptions) => start.toLocaleDateString('en-US', { ...options, timeZone: CLINIC_TZ });
  const clockOf = (value: string) => new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: CLINIC_TZ });
  const range = `${clockOf(booking.start_utc)}${booking.end_utc ? ` – ${clockOf(booking.end_utc)}` : ''} ${CLINIC_TZ_LABEL}`;
  const minutes = booking.duration_minutes ? ` (${Math.round(booking.duration_minutes)} min)` : '';
  const bookedWhen = booking.booked_at ? new Date(booking.booked_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: CLINIC_TZ }) : '';
  const day = calendarDay(booking.start_utc);
  return <div className={`booking-card ${off ? 'is-off' : ''}`}>
    <div className="booking-date" aria-hidden="true"><small>{part({ month: 'short' }).toUpperCase()}</small><strong>{part({ day: 'numeric' })}</strong><span>{part({ weekday: 'short' })}</span></div>
    <div>
      <h3>{booking.type}<span className={`booking-state ${bucket}`}>{stateLabel(booking.state)}</span><BookingTagChip tag={booking.tag} /></h3>
      <p className="booking-when">{part({ weekday: 'long', month: 'long', day: 'numeric' })} · {range}{minutes}</p>
      {off && <p className="booking-off">{stateLabel(booking.state)} in Stride · call the patient to rebook</p>}
      {booking.dob_check && <p className="booking-off">Check date of birth: the Sheet has {booking.dob_check.on_file}, the patient said {booking.dob_check.said} on the call. The visit was booked with the patient&rsquo;s date; correct the Sheet if it is wrong.</p>}
      <dl className="booking-facts"><dt>Case</dt><dd>{booking.case_title}</dd><dt>Clinician</dt><dd>{booking.practitioner_name}</dd><dt>Location</dt><dd>{booking.location}</dd><dt>Booked</dt><dd>{[bookedWhen, bookedByLabel(booking.booked_by)].filter(Boolean).join(' ')}</dd></dl>
      {booking.quote && <blockquote className="booking-quote">“{booking.quote}”<small>From the booking call{booking.call_offset_seconds !== null ? `, ${callMoment(booking.call_offset_seconds)}` : ''}</small></blockquote>}
      <div className="booking-actions">{booking.call_log_id !== null && <Link className="secondary" href={`/leads/${leadId}/conversations/calls?call=${booking.call_log_id}`}>View call transcript</Link>}<Link className="secondary" href={`/appointments?date=${day}`}>Open in calendar</Link></div>
      {booked && bucket === 'booked' && <p className="muted booking-note">Outreach has stopped because the lead is booked. To change it, cancel the visit in Stride; the lead comes back for review by itself.</p>}
    </div>
  </div>;
}

function SmsPage({ detail, action }: { detail: LeadDetail; action: DashboardAction }) {
  const [message,setMessage]=useState(''); const [sending,setSending]=useState(false);
  async function submit(event:FormEvent){event.preventDefault();if(!message.trim())return;setSending(true);try{await action(`leads/${detail.lead.id}/sms`,'POST',{body:message,idempotency_key:crypto.randomUUID()});setMessage('');}finally{setSending(false)}}
  return <><ConversationTabs id={String(detail.lead.id)} active="sms" /><div className="conversation-layout"><Panel title="SMS conversation">{detail.messages.length ? <div className="messages">{detail.messages.map((item)=><div className={`message ${item.direction}`} key={String(item.id)}><small>{item.direction === 'outbound' ? 'Practice Team':String(detail.lead.full_name)} · {time(String(item.occurred_at))}</small><MessageBody body={String(item.body)} /><span>{item.failure_reason ? operationalMessage(item.failure_reason, 'message') : displayEnum(item.delivery_status)}</span></div>)}</div> : <Empty title="No messages yet" body="Messages sent to or received from this lead will appear here." />}<form className="composer" onSubmit={submit}><textarea aria-label="SMS message" value={message} onChange={(event)=>setMessage(event.target.value)} maxLength={1600} placeholder="Write a patient-safe message…" /><div><span>{message.length}/1600</span><button className="primary" type="submit" disabled={sending || !message.trim()}>{sending?'Sending…':'Send SMS'}</button></div></form></Panel><div className="stack"><Panel title="Conversation context"><dl className="detail-list"><div><dt>Status</dt><dd><StatusBadge stage={String(detail.lead.stage ?? 'cadence') as LeadStage} paused={detail.lead.cadence_state === 'paused'} /></dd></div><div><dt>Next step</dt><dd>{String(detail.lead.next_step ?? 'No planned event')}</dd></div><div><dt>Consent</dt><dd><StatusText status="Contact permitted" /></dd></div><div><dt>Last activity</dt><dd>{relative(String(detail.lead.last_contacted_at ?? ''))}</dd></div></dl></Panel><Panel title="Safety"><p className="muted">This conversation belongs only to {String(detail.lead.full_name)}. DNC and SMS opt-out rules are checked again by the server before sending.</p></Panel></div></div></>;
}

function CallsPage({ detail }: { detail: LeadDetail }) {
  const searchParams = useSearchParams();
  const requestedCall = searchParams.get('call');
  const [selectedId, setSelectedId] = useState(String(detail.calls[0]?.id ?? ''));
  const names = useMemo(() => cadenceCallNames(detail.events, detail.calls), [detail.events, detail.calls]);
  const selected = detail.calls.find((call) => String(call.id) === (requestedCall ?? selectedId)) ?? detail.calls[0];
  const callTitle = (call: Record<string, unknown>) => names.get(String(call.id)) ?? `Call on ${date(String(call.dialed_at))}`;
  const selectedTitle = selected ? callTitle(selected) : 'Call transcript';
  const turns=String(selected?.transcript_text ?? '').split('\n').filter(Boolean);
  function selectCall(call: Record<string, unknown>) {
    const id = String(call.id);
    setSelectedId(id);
    const next = new URLSearchParams(searchParams.toString());
    next.set('call', id);
    window.history.replaceState(null, '', `?${next.toString()}`);
  }
  return <><ConversationTabs id={String(detail.lead.id)} active="calls" /><div className="call-layout"><Panel title="Call sessions">{detail.calls.length ? detail.calls.map((call)=><button type="button" className={`call-session ${selected?.id===call.id?'selected':''}`} onClick={()=>selectCall(call)} key={String(call.id)}><span><PhoneIcon size={18} /></span><div><strong>{callTitle(call)}</strong><small>{date(String(call.dialed_at))} · {duration(Number(call.duration_seconds))} · {displayEnum(call.answer_state ?? 'pending')}</small></div></button>) : <Empty title="No call sessions" body="Completed and attempted calls will appear here." />}</Panel><Panel title={selected ? `${selectedTitle} transcript` : selectedTitle}><div className="transcript">{turns.length ? turns.map((turn,index)=>{const [speaker,...words]=turn.split(':');return <div key={index}><b>{initials(speaker)}</b><p><strong>{speaker}</strong>{words.join(':')}</p></div>}) : <Empty title="No text transcript" body={selected ? 'This call did not produce transcript text.' : 'Choose a call session to view its transcript.'} />}</div>{Boolean(selected?.summary_text) && <Alert><strong>AI call summary</strong><br />{String(selected.summary_text)}</Alert>}</Panel><Panel title="Call context">{selected ? <><dl className="detail-list"><div><dt>Call result</dt><dd><StatusText status={String(selected.ended_reason ?? selected.answer_state ?? 'Pending')} /></dd></div><div><dt>Record</dt><dd>{selectedTitle}</dd></div><div><dt>Duration</dt><dd>{duration(Number(selected.duration_seconds ?? 0))}</dd></div><div><dt>Next action</dt><dd>{String(detail.lead.next_step ?? 'No planned event')}</dd></div></dl><Alert>Text transcript only. No audio recording is stored or exposed.</Alert></> : <Empty title="No call selected" body="Call details will appear after a call session is available." />}</Panel></div></>;
}

function CadenceChannelIcon({ channel }: { channel: string }) {
  return <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {channel === 'call'
      ? <path d="M5.3 3.3 7.6 3l1.2 3.4-1.5 1.2a11 11 0 0 0 5.1 5.1l1.2-1.5 3.4 1.2-.3 2.3a2.2 2.2 0 0 1-2.2 1.9C8.4 16.6 3.4 11.6 3.4 5.5a2.2 2.2 0 0 1 1.9-2.2Z" />
      : <path d="M3.2 4.2h13.6v9.4H8l-3.7 2.2v-2.2H3.2V4.2Z" />}
  </svg>;
}

type RunEvent = CadenceEvent;

function runRan(run: RunEvent[]) {
  return run.filter((event) => event.executed_at).map((event) => String(event.executed_at)).sort();
}

function runDuration(from: string, to: string) {
  const seconds = Math.round((new Date(to).valueOf() - new Date(from).valueOf()) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return seconds + 's';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + ' min ' + (seconds % 60) + 's';
  return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
}

function smsBlocked(event: RunEvent) {
  return event.delivery_status === 'undelivered' || event.delivery_status === 'failed'
    || event.status === 'failed';
}

// A collapsed card still has to say what the run achieved.
function runTallies(run: RunEvent[]) {
  const texts = run.filter((event) => event.channel === 'sms' && event.executed_at);
  return {
    calls: run.filter((event) => event.channel === 'call' && event.executed_at).length,
    textsSent: texts.filter((event) => !smsBlocked(event)).length,
    textsBlocked: texts.filter((event) => smsBlocked(event)).length,
    cancelled: run.filter((event) => isCadenceStep(event) && event.status === 'skipped').length,
    planned: run.filter((event) => isCadenceStep(event) && event.status === 'planned').length,
    ran: run.filter((event) => isCadenceStep(event) && event.executed_at).length,
  };
}

function stepResult(event: RunEvent, restarted = true): { tone: string; label: string } {
  const status = String(event.status);
  if (status === 'skipped') return { tone: 'idle', label: restarted ? 'Cancelled by restart' : 'Not needed · outreach ended' };
  if (status === 'planned') return { tone: 'idle', label: 'Upcoming' };
  if (status === 'attempted' || status === 'in_flight') return { tone: 'warn', label: 'Awaiting result' };
  if (event.channel === 'sms') {
    if (!smsBlocked(event)) return { tone: 'ok', label: 'Delivered' };
    return { tone: 'stop', label: 'Not delivered' };
  }
  const outcome = String(event.outcome ?? '');
  if (!outcome) return { tone: 'warn', label: 'No outcome recorded' };
  if (outcome === 'booking_link') return { tone: 'ok', label: 'Booking link requested' };
  if (outcome === 'manual') return { tone: 'warn', label: 'Answered · no outcome recorded' };
  return { tone: outcome === 'booked' ? 'ok' : 'plain', label: humanize(outcome) };
}

function CadenceRunCard({ run, index, total, pauses, leadId, callIdsByEvent, onReschedule }: {
  run: RunEvent[];
  index: number;
  total: number;
  pauses: Array<{ paused: string; resumed: string | null }>;
  leadId: string;
  callIdsByEvent: Map<string, string[]>;
  onReschedule?: (event: RunEvent) => void;
}) {
  const isCurrent = index === total - 1;
  const tally = runTallies(run);
  const summary = cadenceRunSummary(run);
  const ran = runRan(run);
  const span = ran.length ? date(ran[0]) + ' → ' + time(ran[ran.length - 1]) : 'Not started';
  const length = ran.length > 1 ? ' · ' + runDuration(ran[0], ran[ran.length - 1]) : '';

  // Cancelled steps collapse into one row: seven near-identical rows say the
  // same nothing seven times and bury the steps that did run.
  const shown = run.filter((event) => event.status !== 'skipped');
  const cancelled = run.filter((event) => isCadenceStep(event) && event.status === 'skipped');
  const badge = isCurrent && summary.inProgress ? `Current · ${summary.label.toLowerCase()}` : summary.label;

  // A pause belongs to the run it interrupted. Shown before the first step that
  // ran after the resume, otherwise four steps sharing one timestamp read as a
  // fault rather than as the backlog clearing.
  const runStart = String(run[0].created_at ?? '');
  const seen = new Set<string>();
  function pauseBefore(event: RunEvent) {
    const at = String(event.executed_at ?? '');
    if (!at) return null;
    const match = pauses.find((pause) => pause.resumed !== null
      && pause.paused >= runStart && pause.resumed <= at
      && !seen.has(pause.paused));
    if (!match) return null;
    seen.add(match.paused);
    return match;
  }

  return <details className={'cadence-run' + (isCurrent && summary.inProgress ? ' current' : '')} open={isCurrent}>
    <summary>
      <span className="run-chevron" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
             strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
      </span>
      <span className="run-id">
        <span className="run-title">Outreach {index + 1}
          <span className={'run-badge ' + summary.tone}>{badge}</span>
        </span>
        <span className="run-when">{span}{length}</span>
      </span>
      <span className="run-tallies">
        {tally.calls > 0 && <span className="run-tally"><i className="dot ok" />{tally.calls} call{tally.calls === 1 ? '' : 's'}</span>}
        {tally.textsSent > 0 && <span className="run-tally"><i className="dot ok" />{tally.textsSent} text{tally.textsSent === 1 ? '' : 's'}</span>}
        {tally.textsBlocked > 0 && <span className="run-tally"><i className="dot stop" />{tally.textsBlocked} blocked</span>}
        {tally.cancelled > 0 && <span className="run-tally"><i className="dot idle" />{tally.cancelled} {isCurrent ? 'not needed' : 'cancelled'}</span>}
        {tally.planned > 0 && <span className="run-tally"><i className="dot idle" />{tally.planned} to go</span>}
      </span>
    </summary>

    <div className="run-steps">
      {shown.map((event, position) => {
        const result = stepResult(event, !isCurrent);
        const pause = pauseBefore(event);
        const callIds = callIdsByEvent.get(String(event.id)) ?? [];
        return <div key={String(event.id)}>
          {pause && <p className="run-interrupt">Paused {time(pause.paused)} → resumed {time(pause.resumed)} · overdue steps then ran together</p>}
          <div className={'run-step ' + result.tone}>
            <span className="run-step-n">{event.day_offset === null || event.day_offset === undefined ? '•' : position + 1}</span>
            <span className="run-step-day">{event.day_offset === null || event.day_offset === undefined ? 'Callback' : `Day ${String(event.day_offset)}`}</span>
            <span className="run-step-what">
              <span className="run-step-chan"><CadenceChannelIcon channel={String(event.channel)} />{event.channel === 'call' ? 'Call' : 'Text'}</span>
              <span className={'run-step-result ' + result.tone}>{result.label}</span>
            </span>
            <span className="run-step-time">{event.executed_at ? stamp(String(event.executed_at)) : 'due ' + stamp(String(event.scheduled_for))}</span>
            <span className="run-step-actions">
              {callIds.map((callId, callIndex) => <Link className="text-action" href={`/leads/${leadId}/conversations/calls?call=${encodeURIComponent(callId)}`} key={callId}>{callIds.length > 1 ? `Transcript ${callIndex + 1}` : 'View transcript'}</Link>)}
              {onReschedule && event.status === 'planned'
                && <button className="text-action" type="button" onClick={() => onReschedule(event)}>Reschedule</button>}
            </span>
          </div>
        </div>;
      })}
      {cancelled.length > 0 && <div className="run-step idle">
        <span className="run-step-n">{shown.length + 1}{cancelled.length > 1 ? '–' + (shown.length + cancelled.length) : ''}</span>
        <span className="run-step-day">{cancelled.length} step{cancelled.length === 1 ? '' : 's'}</span>
        <span className="run-step-what"><span className="run-step-result idle">{isCurrent ? 'Not needed · outreach ended' : 'Cancelled by restart'}</span></span>
        <span className="run-step-time">—</span>
      </div>}
    </div>
  </details>;
}

function LeadCadencePage({ detail, action, role }: { detail: LeadDetail; action: DashboardAction; role: StaffUser['role'] }) {
  const [unblocking, setUnblocking] = useState(false);
  const runs = splitCadenceRuns(detail.events);
  const current = runs[runs.length - 1] ?? [];
  const currentSummary = cadenceRunSummary(current);
  const currentTotal = currentSummary.expectedSteps ?? current.filter(isCadenceStep).length;
  const [rescheduling, setRescheduling] = useState<RunEvent | null>(null);
  const callIdsByEvent = useMemo(() => {
    const grouped = new Map<string, string[]>();
    const calls = [...detail.calls].sort((a, b) => String(a.dialed_at ?? '').localeCompare(String(b.dialed_at ?? '')));
    for (const call of calls) {
      if (call.outreach_event_id === null || call.outreach_event_id === undefined) continue;
      const eventId = String(call.outreach_event_id);
      grouped.set(eventId, [...(grouped.get(eventId) ?? []), String(call.id)]);
    }
    return grouped;
  }, [detail.calls]);

  // Pause and resume arrive as separate audit rows; pair them so a card can show
  // one interruption rather than two unexplained entries.
  const pauses: Array<{ paused: string; resumed: string | null }> = [];
  for (const entry of (detail.cadence_actions ?? [])) {
    const at = String(entry.created_at ?? '');
    if (entry.action === 'cadence.pause') pauses.push({ paused: at, resumed: null });
    else if (pauses.length && pauses[pauses.length - 1].resumed === null) pauses[pauses.length - 1].resumed = at;
  }

  return <><div className="two-col wide-left cadence-page">
    <Panel title={`${String(detail.lead.full_name)}’s outreach`}>
      <p className="panel-subtitle">
        {runs.length > 1
          ? `${runs.length} outreach runs · ${detail.cadence_version?.name ?? 'active cadence'}`
          : `${detail.cadence_version?.name ?? 'Active cadence'} · ${currentSummary.attempted} of ${currentTotal} steps`}
      </p>
      {runs.length === 0
        ? <Empty title="No outreach scheduled" body="This lead has no cadence steps yet." />
        : <div className="cadence-runs">
            {runs.map((run, index) => <div key={String(run[0].created_at ?? index)}>
              {index > 0 && <p className="run-connector">
                Restarted by staff · moved back to New at {date(String(run[0].created_at ?? ''))}
              </p>}
              <CadenceRunCard
                run={run}
                index={index}
                total={runs.length}
                pauses={pauses}
                leadId={String(detail.lead.id)}
                callIdsByEvent={callIdsByEvent}
                onReschedule={index === runs.length - 1 ? setRescheduling : undefined}
              />
            </div>)}
          </div>}
    </Panel>
    <div className="stack"><ContactRulesPanel detail={detail} action={action} role={role} onUnblock={() => setUnblocking(true)} /></div>
  </div>{rescheduling && <RescheduleDialog event={rescheduling} leadId={String(detail.lead.id)} action={action} onClose={() => setRescheduling(null)} />}{unblocking && <UnblockDialog detail={detail} action={action} onClose={() => setUnblocking(false)} />}</>;
}

// The switch reports the number: ON whenever calls and texts to it are blocked,
// whether the Sheet, a call or this switch did it. Anyone can block; only an
// admin can unblock, and only through the dialog that decides what happens next.
function ContactRulesPanel({ detail, action, role, onUnblock }: { detail: LeadDetail; action: DashboardAction; role: StaffUser['role']; onUnblock: () => void }) {
  const block = (detail.lead.number_block ?? null) as NumberBlock | null;
  const blocked = Boolean(block) || String(detail.lead.status) === 'do_not_contact';
  const canChange = !blocked || role === 'super_admin';
  return <Panel title="Contact rules"><Toggle label="Do not contact" enabled={blocked} onChange={canChange ? async (next) => {
    if (next) return action(`leads/${detail.lead.id}/contact-rules`, 'POST', { do_not_contact: true }, 'Do not contact is on. No calls or texts will go to this number.');
    onUnblock();
  } : undefined} /><p className="muted">{blocked
    ? (role === 'super_admin' ? 'Turning it off unblocks the number and asks what outreach should do next.' : 'Only an admin can unblock this number.')
    : 'Blocks calls and texts to this number for every lead on it, cancels the remaining schedule, and updates the Google Sheet.'}</p></Panel>;
}

function UnblockDialog({ detail, action, onClose }: { detail: LeadDetail; action: DashboardAction; onClose: () => void }) {
  const block = (detail.lead.number_block ?? null) as NumberBlock | null;
  const [choice, setChoice] = useState<AfterUnblock>(() => defaultAfterUnblock(block?.blocked_at));
  const [saving, setSaving] = useState(false);
  const options: Array<[AfterUnblock, string, string]> = [
    ['continue', 'Continue the remaining steps', 'Picks up at the next step, keeping the same gaps between steps. Best when the block was a mistake or short.'],
    ['restart', 'Start over from Day 0', 'Builds a fresh schedule. Best when weeks have passed.'],
  ];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const result = await action(`leads/${detail.lead.id}/contact-rules`, 'POST', { do_not_contact: false, after_unblock: choice }, UNBLOCK_RESULT[choice]);
    setSaving(false);
    if (result) onClose();
  }
  return <ModalShell className="unblock-dialog" labelId="unblock-title" onClose={onClose}><header><div><h2 id="unblock-title">Unblock this number?</h2><p>{block ? numberBlockMessage(block) : 'This lead is marked Do not contact.'} Calls and texts to this number will be allowed again, during business hours only, and the Google Sheet is updated to match.</p></div><button className="close-button" type="button" onClick={onClose} aria-label="Close unblock dialog">×</button></header><form onSubmit={submit}><fieldset className="choice-list"><legend>What should outreach do next?</legend>{options.map(([value, label, hint]) => <label key={value} className={choice === value ? 'selected' : ''}><input type="radio" name="after-unblock" value={value} checked={choice === value} onChange={() => setChoice(value)} /><span><strong>{label}</strong><small>{hint}</small></span></label>)}</fieldset><footer><button className="secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary" type="submit" disabled={saving}>{saving ? 'Unblocking…' : 'Unblock number'}</button></footer></form></ModalShell>;
}

function RescheduleDialog({ event, leadId, action, onClose }: { event: RunEvent; leadId: string; action: DashboardAction; onClose: () => void }) {
  const [value, setValue] = useState(() => clinicDateTimeValue(event.scheduled_for));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    try {
      const scheduledFor = clinicWallTimeToIso(value);
      setError(''); setSaving(true);
      const result = await action(`leads/${leadId}/outreach-events/${event.id}`, 'PATCH', { scheduled_for: scheduledFor });
      if (result) onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Choose a valid date and time.'); }
    finally { setSaving(false); }
  }
  return <ModalShell className="reschedule-dialog" labelId="reschedule-title" onClose={onClose}><header><div><h2 id="reschedule-title">Reschedule outreach step</h2><p>Choose when this step should run in Pacific Time.</p></div><button className="close-button" type="button" onClick={onClose} aria-label="Close reschedule dialog">×</button></header><form onSubmit={submit}><label className="field-label">Date and time ({CLINIC_TZ_LABEL})<input type="datetime-local" value={value} onChange={(changeEvent) => setValue(changeEvent.target.value)} required /></label>{error && <p className="field-error" role="alert">{error}</p>}<footer><button className="secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary" type="submit" disabled={saving || !value}>{saving ? 'Saving…' : 'Save time'}</button></footer></form></ModalShell>;
}


function LeadActivityPage({ detail }: { detail: LeadDetail }) {
  const [query,setQuery] = useState('');
  const entries = leadActivity(detail.activity ?? [], query);
  return <div className="activity-layout"><Panel><header className="activity-panel-header"><div><h2>Activity</h2><p>Everything that happened to this lead, newest first, with who or what did it.</p></div><label className="activity-search"><span aria-hidden="true">⌕</span><input aria-label="Search activity" placeholder="Search activity" value={query} onChange={(event) => setQuery(event.target.value)} /></label></header>{entries.length ? <ActivityTimeline entries={entries} /> : <Empty title={query.trim() ? 'No matching activity' : 'No activity yet'} body={query.trim() ? 'Try searching for a different name or change.' : 'Everything that happens to this lead will appear here.'} />}</Panel><aside className="stack activity-aside"><Panel title="Record details"><dl className="detail-list"><div><dt>Current owner</dt><dd>{String(detail.lead.owner ?? 'Unassigned')}</dd></div><div><dt>Created</dt><dd>{date(String(detail.lead.created_at ?? ''))}</dd></div><div><dt>Source</dt><dd>{sourceLabel(detail.lead.source ?? detail.lead.source_system)}</dd></div><div><dt>Last updated</dt><dd>{relative(String(detail.lead.updated_at ?? ''))}</dd></div></dl></Panel><Panel title="About this timeline"><p className="muted">Everything that happened to this lead, newest first: changes by your team, Google Sheet commands (done or refused, with the reason), calls and texts, bookings, reviews and system events. Each line says who or what made it and when.</p></Panel></aside></div>;
}

function ConversationTabs({ id, active }: { id:string; active:'sms'|'calls' }) { return <nav className="conversation-tabs" aria-label="Conversations"><Link className={active==='sms'?'active':''} aria-current={active === 'sms' ? 'page' : undefined} href={`/leads/${id}/conversations/sms`}><MessageIcon />SMS</Link><Link className={active==='calls'?'active':''} aria-current={active === 'calls' ? 'page' : undefined} href={`/leads/${id}/conversations/calls`}><PhoneIcon />Call transcripts</Link></nav>; }
// A flagged lead shows why it was flagged: its next step is on hold until staff
// act, so the reason is what the card has to say.
function LeadCard({ lead, onOpen, dragging = false, onDragStart, onDragEnd }: { lead: Lead; onOpen:()=>void; dragging?: boolean; onDragStart?: ()=>void; onDragEnd?: ()=>void }) { const meta=statusMeta[lead.stage]; const movable = canMoveOnBoard(lead.stage); return <button className={`lead-card ${dragging ? 'is-dragging' : ''} ${lead.number_block ? 'is-blocked' : ''}`} type="button" draggable title={movable ? undefined : BOOKED_LOCKED_HINT} onDragStart={(event) => { setLeadDragData(event, lead.id); if (movable) onDragStart?.(); }} onDragEnd={movable ? onDragEnd : undefined} onClick={onOpen}><strong>{lead.full_name}</strong><span className="location"><MapPinIcon />{lead.location ?? 'Not assigned'}</span><span className="card-tags"><StatusBadge stage={lead.stage} paused={lead.cadence_state === 'paused'} />{lead.number_block && <BlockedTag />}</span>{lead.stage==='cadence'&&lead.cadence_state!=='paused'&&<span className="version">{lead.cadence_version_name ?? 'Cadence'} · {lead.cadence_progress ?? 0} of {lead.cadence_total ?? 0}</span>}{lead.stage === 'attention' && (lead.review || lead.review_reason) ? <span className="next attention-reason">Reason: {lead.review ? lead.review.title : operationalMessage(lead.review_reason)}</span> : lead.stage === 'booked' && lead.booking ? <span className="next booked-on">{statusBucket(lead.booking.state) === 'booked' ? 'Booked' : stateLabel(lead.booking.state)}: {visitWhen(lead.booking.start_utc, true)}<BookingTagChip tag={lead.booking.tag} /></span> : <span className="next">{lead.stage === 'closed' || lead.stage === 'booked' ? 'Outcome' : 'Next'}: {lead.next_step ?? 'No planned action'}</span>}<span className="sr-only">{meta.label}{movable ? '' : `. ${BOOKED_LOCKED_HINT}`}</span></button>; }
function StatusTiles({ counts, loading = false }: { counts: Record<LeadStage,number>; loading?: boolean }) { return <section className="status-tiles" aria-busy={loading}>{(['new','cadence','attention','booked','closed'] as LeadStage[]).map((stage)=><Link className={stage} href={`/leads?stage=${stage}`} key={stage}>{stage !== 'new' && <StatusGlyph stage={stage} size="large" />}<div><small>{statusMeta[stage].label}</small><strong>{loading ? "—" : counts[stage]}</strong></div></Link>)}</section>; }
// Blocked leads stay in Closed (nothing for staff to fix), but read as blocked
// at a glance rather than as one more closed lead.
function BlockedTag() { return <span className="status-pill blocked"><i aria-hidden="true">⊘</i>Number blocked</span>; }
function StatusBadge({ stage, paused = false }: { stage: LeadStage; paused?: boolean }) {
  if (paused) return <span className="status-pill paused"><PauseIcon />Paused</span>;
  return <span className={`status-pill ${stage}`}><StatusGlyph stage={stage} size="compact" />{statusMeta[stage].label}</span>;
}
function StatusGlyph({ stage, size = 'normal' }: { stage: LeadStage; size?: 'compact' | 'normal' | 'large' }) { return <span className={`status-glyph ${stage} ${size}`} aria-hidden="true"><i /></span>; }
function StatusText({ status }: { status:string }) { const tone = statusTone(status); return <span className={`status-text ${tone}`}><i aria-hidden="true" />{displayEnum(status)}</span>; }
function PageTitle({ title, subtitle, tools }: { title:string; subtitle:string; tools?:ReactNode }) { return <header className="page-heading"><div><h1>{title}</h1><p>{subtitle}</p></div>{tools&&<div className="page-tools">{tools}</div>}</header>; }
function Panel({ title, children }: { title?:string; children:ReactNode }) { return <section className="panel">{title&&<h2>{title}</h2>}{children}</section>; }
function DataTable({ heads, children }: { heads:string[]; children:ReactNode }) { return <div className="table-scroll"><table><thead><tr>{heads.map((head,index)=><th key={`${head}-${index}`}>{head}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
function Alert({ children, tone='info' }: { children:ReactNode; tone?:'info'|'warning'|'success'|'danger' }) { return <div className={`alert ${tone}`} role={tone==='danger'?'alert':undefined}><b aria-hidden="true">{tone==='warning'||tone==='danger'?'!':tone==='success'?'✓':'i'}</b><div>{children}</div></div>; }
function Empty({ title, body }: { title:string; body:string }) { return <div className="empty"><h2>{title}</h2><p>{body}</p></div>; }
function OfflineState({ onRetry }: { onRetry: () => void }) { return <><PageTitle title="Dashboard unavailable" subtitle="The latest data could not be loaded." /><Panel><div className="offline-state"><h2>Connection lost</h2><p>Check the service connection, then try again. No changes were made.</p><button className="primary" type="button" onClick={onRetry}>Retry connection</button></div></Panel></>; }
function Stat({ label,value,trend }: { label:string; value:string; trend?:string }) { return <div className="stat"><small>{label}</small><strong>{value}</strong>{trend&&<span>{trend}</span>}</div>; }
function Metric({ label,value,width,tone }: { label:string; value:string; width:string; tone?:string }) { return <div className={`metric ${tone??''}`}><div><span>{label}</span><strong>{value}</strong></div><i><b style={{width}} /></i></div>; }
function Toggle({ label, enabled, onChange }: {
  label: string;
  enabled: boolean;
  // A switch with no onChange used to flip local state and nothing else, so the
  // dashboard reported contact as blocked while the worker kept calling. It now
  // renders read-only unless it is given somewhere to save.
  onChange?: (next: boolean) => Promise<unknown>;
}) {
  const [saving, setSaving] = useState(false);

  async function toggle() {
    if (!onChange || saving) return;
    setSaving(true);
    await onChange(!enabled);
    setSaving(false);
  }

  return <div className="toggle-row">
    <span>{label}</span>
    <button className={enabled ? 'on' : ''} type="button" disabled={!onChange || saving}
      aria-label={`Turn ${label} ${enabled ? 'off' : 'on'}`} aria-pressed={enabled} onClick={toggle}><i /></button>
    <b>{saving ? '…' : enabled ? 'ON' : 'OFF'}</b>
  </div>;
}
function ActivityIcon({ kind }: { kind: ActivityKind }) {
  const paths: Record<ActivityKind, ReactNode> = {
    appointment: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4m-7 8 2 2 4-4" /></>,
    link: <><path d="M10 13.5 14 9.5a3 3 0 1 1 4.2 4.2l-3 3a3 3 0 0 1-4.2 0" /><path d="m14 10.5-4 4a3 3 0 1 1-4.2-4.2l3-3a3 3 0 0 1 4.2 0" /></>,
    handoff: <><circle cx="8" cy="8" r="3" /><path d="M2.5 20a5.5 5.5 0 0 1 11 0m1-8h7m-3-3 3 3-3 3" /></>,
    call: <path d="M6 3.5 9 3l1.5 4-2 1.5a12 12 0 0 0 5 5l1.5-2 4 1.5-.5 3A2.5 2.5 0 0 1 16 18C9 18 4 13 4 6a2.5 2.5 0 0 1 2-2.5Z" />,
    message: <path d="M3 5h18v12H9l-5 3v-3H3Z" />,
    created: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0m3-10v6m-3-3h6" /></>,
    closed: <><circle cx="12" cy="12" r="9" /><path d="m6 6 12 12" /></>,
    history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  };
  return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}
function activityIconKind(entry: ActivityEntry): ActivityKind {
  if (entry.category === 'appointments') return 'appointment';
  if (entry.category === 'messages') return 'message';
  if (entry.category === 'calls') return 'call';
  if (entry.action === 'lead.created') return 'created';
  return 'history';
}
function activityDayLabel(value: string) {
  const key = clinicDateKey(value);
  if (key === clinicDateKey(new Date())) return 'Today';
  if (key === clinicDateKey(new Date(Date.now() - 86_400_000))) return 'Yesterday';
  return new Date(value).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: CLINIC_TZ });
}
function activityTime(value: string) {
  return new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: CLINIC_TZ });
}
function activityDetails(details: Record<string, unknown>) {
  return Object.entries(details).filter(([key, value]) => key !== 'lead_id' && key !== 'request_id' && value !== null && ['string','number','boolean'].includes(typeof value));
}
function ActivityTimeline({ entries }: { entries: ActivityEntry[] }) {
  if (!entries.length) return <Empty title="No activity yet" body="Recorded activity for this lead will appear here." />;
  const groups = new Map<string, ActivityEntry[]>();
  entries.forEach((entry) => { const key = activityDayLabel(entry.occurred_at); groups.set(key, [...(groups.get(key) ?? []), entry]); });
  return <div className="activity-timeline">{Array.from(groups).map(([day, items]) => <section key={day}><h3>{day}</h3><div>{items.map((entry) => {
    const details = activityDetails(entry.details);
    return <article key={entry.id}><span className={`activity-node activity-${entry.category}`}><ActivityIcon kind={activityIconKind(entry)} /></span><div className="activity-card"><header><div><strong>{entry.title}</strong><span>{activityTime(entry.occurred_at)}</span></div><p><i>{initials(entry.actor_name)}</i><b>{entry.actor_name}</b><small>{activitySource(entry)}</small></p></header>{details.length > 0 && <details><summary>View change</summary><dl>{details.map(([key, value]) => <div key={key}><dt>{displayEnum(key)}</dt><dd>{displayEnum(value)}</dd></div>)}</dl></details>}</div></article>;
  })}</div></section>)}</div>;
}
function initials(name:string){return name.split(/\s+/).map((part)=>part[0]).join('').slice(0,2).toUpperCase();}
function humanize(value:string){return displayEnum(value);}
// Every time in this app is a clinic time. Rendering in the viewer's own zone
// made a 9:00 AM Pacific callback read as 9:30 PM to staff in India, so the
// practice timezone is pinned here and shown alongside the value.
function time(value:string|null|undefined){if(!value)return'—';const parsed=new Date(value);return Number.isNaN(parsed.valueOf())?'—':`${parsed.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:CLINIC_TZ})} ${CLINIC_TZ_LABEL}`;}
function date(value:string){const parsed=new Date(value);return Number.isNaN(parsed.valueOf())?'—':`${parsed.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:CLINIC_TZ})} ${CLINIC_TZ_LABEL}`;}
function clinicDateKey(value:Date|string){const parsed=typeof value==='string'?new Date(value):value;return Number.isNaN(parsed.valueOf())?'':parsed.toLocaleDateString('en-CA',{timeZone:CLINIC_TZ});}
// A step due on another day must say which day; time alone read as "today".
function stamp(value:string|null|undefined){return !value?'—':isToday(value)?time(value):date(value);}
function isToday(value:string){const key=clinicDateKey(value);return key!==''&&key===clinicDateKey(new Date());}

// "Tue 27 · 9:00 AM PT": the day matters for visits, unlike outreach steps due today.
function visitWhen(value:string,withMonth=false){const parsed=new Date(value);if(Number.isNaN(parsed.valueOf()))return'—';const part=(o:Intl.DateTimeFormatOptions)=>parsed.toLocaleDateString('en-US',{...o,timeZone:CLINIC_TZ});const day=withMonth?`${part({month:'short'})} ${part({day:'numeric'})}`:`${part({weekday:'short'})} ${part({day:'numeric'})}`;return `${day} · ${parsed.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:CLINIC_TZ})} ${CLINIC_TZ_LABEL}`;}
function relative(value:string|null|undefined){return value?date(value):'Not contacted';}
function duration(seconds:number){return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}


function exportLeadReport(snapshot: Snapshot) {
  const rows = [['Lead', 'Status', 'Owner', 'Location', 'Source'], ...snapshot.leads.map((lead) => [lead.full_name, statusMeta[lead.stage].label, lead.owner || 'Unassigned', lead.location ?? '', sourceLabel(lead.source)])];
  const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"','""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'outreach-lead-report.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function filterSnapshot(snapshot: Snapshot, location: string): Snapshot {
  if (location === 'All Locations') return { ...snapshot, calendar_location: location };
  const leads = snapshot.leads.filter((lead) => lead.location === location);
  // Real per-clinic totals from the backend; the loaded leads are only the newest ones.
  const counts = { new: 0, cadence: 0, attention: 0, booked: 0, closed: 0, ...snapshot.counts_by_location?.[location] } satisfies Record<LeadStage, number>;
  return {
    ...snapshot,
    calendar_location: location,
    leads,
    counts,
    appointments: snapshot.appointments.filter((appointment) => String(appointment.location ?? '') === location),
    system: { ...snapshot.system, review_queue: counts.attention },
  };
}

