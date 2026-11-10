import { NextRequest, NextResponse } from 'next/server';
import { backendOrigin } from '../../dashboard-origin';

// Public demo form (/try, conference demo 2026-11-07). No staff session: anyone with the link may
// send it. Only the form's own fields are forwarded, to the backend's demo-form route, which is off
// unless DEMO_FORM_ENABLED, checks the service token and caps leads per hour.
const FIELDS = ['idempotency_key', 'first_name', 'last_name', 'country_code', 'phone', 'date_of_birth', 'case_type', 'contact_consent'] as const;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest) {
  if (Number(request.headers.get('content-length') ?? 0) > 2_000) {
    return NextResponse.json({ detail: 'request too large' }, { status: 413, headers: NO_STORE });
  }
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ detail: 'invalid request' }, { status: 400, headers: NO_STORE });
  }

  const token = process.env.DASHBOARD_API_TOKEN;
  const origin = backendOrigin(process.env.DASHBOARD_API_ORIGIN, process.env.NODE_ENV);
  if (!origin || !token) {
    return NextResponse.json({ detail: 'demo form is not configured' }, { status: 503, headers: NO_STORE });
  }

  let response: Response;
  try {
    response = await fetch(`${origin}/api/v1/demo-form/leads`, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': token, 'X-Trace-ID': crypto.randomUUID() },
      body: JSON.stringify(Object.fromEntries(FIELDS.map((field) => [field, body[field]]))),
    });
  } catch {
    // No upstream URL, patient details or raw exception enters logs.
    console.warn('[demo form] backend connection unavailable');
    return NextResponse.json({ detail: 'unavailable' }, { status: 503, headers: NO_STORE });
  }
  if (!response.ok) {
    // The visitor sees plain words picked from the status (try-data.ts errorMessage), never backend detail.
    return NextResponse.json({ detail: 'refused' }, { status: response.status, headers: NO_STORE });
  }
  const created = await response.json().catch(() => ({})) as { first_name?: unknown };
  return NextResponse.json({ ok: true, first_name: typeof created.first_name === 'string' ? created.first_name : '' }, {
    status: 201,
    headers: NO_STORE,
  });
}
