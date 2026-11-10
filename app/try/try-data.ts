// Public demo form (/try, conference demo 2026-11-07): typing helpers and the request body.
// Plain functions so they can be unit tested (try-data.test.ts) without a browser.

export type CountryCode = '+1' | '+91';

export const COUNTRIES: { code: CountryCode; label: string; placeholder: string }[] = [
  { code: '+1', label: '🇺🇸 +1', placeholder: '(949) 555-0123' },
  { code: '+91', label: '🇮🇳 +91', placeholder: '98765 43210' },
];

// value = the booking engine's case type name (backend checks it against case_types).
export const CASES = [
  { value: 'Physical Therapy', label: 'Physical therapy' },
  { value: 'Physical Therapy - Pelvic', label: 'Pelvic health' },
] as const;

export type CaseType = (typeof CASES)[number]['value'];

export type DemoForm = {
  firstName: string;
  lastName: string;
  countryCode: CountryCode;
  phone: string;
  birthDate: string; // as typed: MM/DD/YYYY
  caseType: CaseType;
  consent: boolean;
};

const digitsOf = (value: string) => value.replace(/\D/g, '');

/**
 * What lands in the number box, as country + formatted number. A pasted full number
 * ("+91 96545 40686", "+1 949 555 0123", "09654540686") switches the country and drops the code,
 * instead of keeping the first 10 digits (which kept the 91 and lost the last two digits).
 */
export function readPhone(value: string, code: CountryCode): { countryCode: CountryCode; phone: string } {
  const digits = digitsOf(value);
  let country = code;
  let national = digits;
  if (digits.length === 12 && digits.startsWith('91')) [country, national] = ['+91', digits.slice(2)];
  else if (digits.length === 11 && digits.startsWith('1')) [country, national] = ['+1', digits.slice(1)];
  else if (digits.length === 11 && digits.startsWith('0')) national = digits.slice(1);
  return { countryCode: country, phone: formatPhone(national, country) };
}

/** The number as the visitor types it: (949) 555-0123 for the US, 98765 43210 for India. */
export function formatPhone(value: string, code: CountryCode): string {
  const digits = digitsOf(value).slice(0, 10);
  if (code === '+91') return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
  if (digits.length > 6) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length > 3) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return digits;
}

/** Slashes added while typing: 01161990 -> 01/16/1990. */
export function formatBirthDate(value: string): string {
  const digits = digitsOf(value).slice(0, 8);
  if (digits.length > 4) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return digits;
}

/** MM/DD/YYYY -> YYYY-MM-DD, or null when it is not a real birth date at least a year back. */
export function isoBirthDate(value: string, today: Date = new Date()): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, mm, dd, yyyy] = match;
  const month = Number(mm), day = Number(dd), year = Number(yyyy);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  // The booking engine refuses a birthday less than a year back; nobody is over 120.
  const yearAgo = Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), Math.min(today.getUTCDate(), 28));
  if (date.getTime() > yearAgo || year < today.getUTCFullYear() - 120) return null;
  return `${yyyy}-${mm}-${dd}`;
}

/** The first problem to show, or null when the form can be sent. */
export function formProblem(form: DemoForm): string | null {
  if (!form.firstName.trim() || !form.lastName.trim()) return 'Please enter your first and last name.';
  if (digitsOf(form.phone).length !== 10) return 'Please enter a 10-digit mobile number.';
  if (!isoBirthDate(form.birthDate)) return 'Please enter your date of birth as MM / DD / YYYY.';
  if (!form.consent) return 'Please agree to calls and texts so we can reach you.';
  return null;
}

/** The body for POST /api/try (forwarded to the backend's demo-form route). */
export function requestBody(form: DemoForm, idempotencyKey: string) {
  return {
    idempotency_key: idempotencyKey,
    first_name: form.firstName.trim(),
    last_name: form.lastName.trim(),
    country_code: form.countryCode,
    phone: digitsOf(form.phone),
    date_of_birth: isoBirthDate(form.birthDate),
    case_type: form.caseType,
    contact_consent: form.consent,
  };
}

/** What to tell the visitor when the server says no. */
export function errorMessage(status: number): string {
  if (status === 422) return 'Please check your details and try again.';
  if (status === 429) return 'Lots of people are trying this right now. Please try again in a few minutes.';
  return 'Something went wrong on our side. Please try again.';
}
