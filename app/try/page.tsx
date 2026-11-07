import type { Metadata, Viewport } from 'next';
import { TryForm } from './try-form';

// Public demo form (conference demo 2026-11-07): no staff session. The lead it starts runs like a
// Sheet lead; staff follow it on the dashboard.
export const metadata: Metadata = {
  title: 'Request your first visit · Rausch Physical Therapy',
  description: 'Share a few details and we will text and call you to book your first visit.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
};

export default function TryPage() {
  return <TryForm />;
}
