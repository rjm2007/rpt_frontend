import { NextRequest, NextResponse } from 'next/server';
import { getStaffUser } from '../../../session';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);
// Every backend route the browser may reach, listed explicitly. A path missing
// from here is rejected with "dashboard path not allowed", so this must be
// updated whenever a new dashboard endpoint is added.
const ALLOWED_PATH = /^(snapshot|lead-list|lead-board|stride-patients\/\d+|blocked-numbers(?:\/unblock)?|keap-sync|appointment-calendar|appointment-slots|appointment-approvals|appointments|leads(?:\/[0-9a-f-]+(?:\/(?:cadence|contact-rules|stage|sms|outreach-events\/\d+))?)?|review\/[0-9a-f-]+(?:\/resolve)?|cadence-versions(?:\/\d+(?:\/(?:activate|name|permanent))?)?|cadence-steps\/\d+|message-templates(?:\/\d+)?|assistant(?:\/stream)?)$/i;

async function proxy(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  if (!ALLOWED_METHODS.has(request.method)) {
    return NextResponse.json({ detail: 'method not allowed' }, { status: 405 });
  }

  // A valid signed session is required in every environment. The old build
  // allowed an unauthenticated local preview here; that is deliberately gone,
  // because this route reaches real patient data whatever NODE_ENV says.
  const user = await getStaffUser();
  if (!user) {
    return NextResponse.json({ detail: 'authentication required' }, { status: 401 });
  }

  const { path = [] } = await context.params;
  const relativePath = path.join('/');
  if (!ALLOWED_PATH.test(relativePath)) {
    return NextResponse.json({ detail: 'dashboard path not allowed' }, { status: 404 });
  }
  if ((relativePath === 'blocked-numbers' && request.method !== 'GET')
      || (relativePath === 'blocked-numbers/unblock' && request.method !== 'POST')) {
    return NextResponse.json({ detail: 'method not allowed' }, { status: 405 });
  }
  // The review preview is read-only; choices go to review/{id}/resolve (POST only).
  if ((/^review\/[0-9a-f-]+$/i.test(relativePath) && request.method !== 'GET')
      || (/^review\/[0-9a-f-]+\/resolve$/i.test(relativePath) && request.method !== 'POST')) {
    return NextResponse.json({ detail: 'method not allowed' }, { status: 405 });
  }
  // The paged Leads list / board and the Stride patient view are read-only.
  if (/^(lead-list|lead-board|stride-patients\/\d+)$/.test(relativePath) && request.method !== 'GET') {
    return NextResponse.json({ detail: 'method not allowed' }, { status: 405 });
  }
  if (relativePath === 'keap-sync' && request.method !== 'GET') {
    return NextResponse.json({ detail: 'method not allowed' }, { status: 405 });
  }
  if (relativePath === 'leads' && request.method !== 'POST') {
    return NextResponse.json({ detail: 'method not allowed' }, { status: 405 });
  }
  if (/^leads\/[0-9a-f-]+$/i.test(relativePath) && !['GET', 'DELETE'].includes(request.method)) {
    return NextResponse.json({ detail: 'method not allowed' }, { status: 405 });
  }

  const origin = process.env.DASHBOARD_API_ORIGIN?.replace(/\/$/, '');
  const token = process.env.DASHBOARD_API_TOKEN;
  if (!origin || !token) {
    return NextResponse.json({ detail: 'dashboard API is not configured' }, { status: 503 });
  }
  if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) {
    return NextResponse.json({ detail: 'dashboard API must use HTTPS' }, { status: 503 });
  }

  const length = Number(request.headers.get('content-length') ?? 0);
  // The assistant carries up to 20k characters of conversation; the backend caps it there too.
  if (length > (relativePath.startsWith('assistant') ? 64_000 : 20_000)) {
    return NextResponse.json({ detail: 'request too large' }, { status: 413 });
  }

  const requestBody = request.method === 'GET' ? undefined : await request.text();
  let response: Response;
  try {
    response = await fetch(`${origin}/api/v1/dashboard/${relativePath}${request.nextUrl.search}`, {
      method: request.method,
      cache: 'no-store',
      signal: AbortSignal.timeout(relativePath.startsWith('assistant') ? 90_000 : relativePath === 'appointments' ? 35_000 : 20_000),
      headers: {
        'Content-Type': 'application/json',
        'X-Dashboard-Token': token,
        'X-Dashboard-User-ID': user.employeeId,
        'X-Dashboard-User-Name': encodeURIComponent(user.displayName),
        'X-Dashboard-User-Role': user.role,
        'X-Trace-ID': crypto.randomUUID(),
      },
      body: requestBody,
    });
  } catch {
    // No upstream URL, headers, patient payload, or raw exception enters logs.
    console.warn('[dashboard proxy] backend connection unavailable');
    return NextResponse.json({ detail: 'The dashboard service is unavailable. Please try again.' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  return new NextResponse(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
