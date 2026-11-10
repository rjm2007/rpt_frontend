'use client';

import { FormEvent, useState } from 'react';
import styles from './try.module.css';
import {
  CASES,
  COUNTRIES,
  type CountryCode,
  type DemoForm,
  errorMessage,
  formatBirthDate,
  formatPhone,
  formProblem,
  readPhone,
  requestBody,
} from './try-data';

const EMPTY: DemoForm = {
  firstName: '', lastName: '', countryCode: '+1', phone: '', birthDate: '', caseType: 'Physical Therapy', consent: true,
};
const newKey = () => `try-${crypto.randomUUID()}`;

export function TryForm() {
  const [form, setForm] = useState<DemoForm>(EMPTY);
  // One key per filled-in form: a double tap or a retry after a timeout makes one lead.
  const [key, setKey] = useState(newKey);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [doneName, setDoneName] = useState<string | null>(null);

  const country = COUNTRIES.find((item) => item.code === form.countryCode) ?? COUNTRIES[0];
  const set = (patch: Partial<DemoForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setError('');
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = formProblem(form);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/try', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody(form, key)),
      });
      if (!response.ok) {
        setError(errorMessage(response.status));
        return;
      }
      const result = await response.json().catch(() => ({})) as { first_name?: string };
      setDoneName(result.first_name || form.firstName.trim());
    } catch {
      setError(errorMessage(0));
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setForm(EMPTY);
    setKey(newKey());
    setDoneName(null);
    setError('');
  }

  return (
    <main className={styles.page}>
      <div className={styles.screen}>
        <header className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">R</span>
          <span className={styles.brandName}>Rausch Physical Therapy</span>
        </header>

        {doneName === null ? (
          <form className={styles.body} onSubmit={submit} noValidate>
            <div className={styles.intro}>
              <h1>Request your first visit</h1>
              <p>We&apos;ll call you within a minute to find a time that works, and text you if we miss you.</p>
            </div>

            <div className={styles.fields}>
              <div className={styles.pair}>
                <label className={styles.field}>
                  <span>First name</span>
                  <input className={styles.input} value={form.firstName} onChange={(e) => set({ firstName: e.target.value })}
                    placeholder="Jane" autoComplete="given-name" autoCapitalize="words" maxLength={100} required />
                </label>
                <label className={styles.field}>
                  <span>Last name</span>
                  <input className={styles.input} value={form.lastName} onChange={(e) => set({ lastName: e.target.value })}
                    placeholder="Smith" autoComplete="family-name" autoCapitalize="words" maxLength={100} required />
                </label>
              </div>

              <div className={styles.field}>
                <span id="try-phone-label">Mobile number</span>
                <div className={styles.phone}>
                  <label className={styles.country}>
                    <span className={styles.srOnly}>Country code</span>
                    <select value={form.countryCode} aria-describedby="try-phone-label"
                      onChange={(e) => {
                        const code = e.target.value as CountryCode;
                        set({ countryCode: code, phone: formatPhone(form.phone, code) });
                      }}>
                      {COUNTRIES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
                    </select>
                  </label>
                  <input className={styles.phoneInput} type="tel" inputMode="tel" autoComplete="tel-national"
                    aria-labelledby="try-phone-label" placeholder={country.placeholder} value={form.phone}
                    onChange={(e) => set(readPhone(e.target.value, form.countryCode))} required />
                </div>
              </div>

              <label className={styles.field}>
                <span>Date of birth</span>
                <input className={styles.input} inputMode="numeric" autoComplete="bday" placeholder="MM / DD / YYYY"
                  value={form.birthDate} onChange={(e) => set({ birthDate: formatBirthDate(e.target.value) })} required />
              </label>

              <fieldset className={styles.choice}>
                <legend>What&apos;s the visit for?</legend>
                <div className={styles.options}>
                  {CASES.map((item) => (
                    <label key={item.value} className={styles.option}>
                      <input type="radio" name="case" value={item.value} checked={form.caseType === item.value}
                        onChange={() => set({ caseType: item.value })} />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className={styles.consent}>
                <input type="checkbox" checked={form.consent} onChange={(e) => set({ consent: e.target.checked })} />
                <span>I agree to receive calls and texts about my visit. Reply STOP to opt out.</span>
              </label>
            </div>

            <div className={styles.footer}>
              <p className={styles.error} role="alert" aria-live="polite">{error}</p>
              <button className={styles.primary} type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Continue'}
              </button>
              <p className={styles.note}>Demo · Powered by Stride AI</p>
            </div>
          </form>
        ) : (
          <section className={styles.body} aria-live="polite">
            <div className={styles.done}>
              <span className={styles.check} aria-hidden="true">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              </span>
              <div className={styles.doneText}>
                <h1>Thanks, {doneName}</h1>
                <p>Elliot, our scheduling assistant, will call you in about a minute to book your first visit. Missed it? We&apos;ll text you.</p>
              </div>
              <ul className={styles.steps}>
                <li>
                  <span className={styles.tile} aria-hidden="true">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z" /><path d="M8.5 11h.01M12 11h.01M15.5 11h.01" /></svg>
                  </span>
                  Text
                </li>
                <li>
                  <span className={styles.tile} aria-hidden="true">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>
                  </span>
                  Call
                </li>
                <li>
                  <span className={`${styles.tile} ${styles.tileBooked}`} aria-hidden="true">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16.5" rx="2.5" /><path d="M16 2.5v4M8 2.5v4M3 10h18M9 15.5l2 2 4-4" /></svg>
                  </span>
                  Booked
                </li>
              </ul>
            </div>
            <div className={styles.footer}>
              <button className={styles.secondary} type="button" onClick={startOver}>Submit another</button>
              <p className={styles.note}>Demo · Powered by Stride AI</p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
