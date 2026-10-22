// Every dashboard request uses the same expired-session behavior, including editors.
export async function dashboardFetch(url: string, options?: RequestInit): Promise<Response> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  if (response.status === 401) {
    window.location.assign('/login');
    throw new Error('Your session has expired. Sign in again.');
  }
  return response;
}

export class DashboardHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`dashboard request failed (${status})`);
    this.status = status;
  }
}

// A plain GET through the proxy (the review pop-up's preview: never cached, it depends on the clock).
export async function dashboardGet<T>(url: string): Promise<T> {
  const response = await dashboardFetch(url);
  if (!response.ok) throw new DashboardHttpError(response.status);
  return response.json() as Promise<T>;
}
