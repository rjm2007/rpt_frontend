import assert from 'node:assert/strict';
import test from 'node:test';
import { errorMessage, formatBirthDate, formatPhone, formProblem, isoBirthDate, readPhone, requestBody, type DemoForm } from './try-data.ts';

const FORM: DemoForm = { firstName: ' Jane ', lastName: 'Smith', countryCode: '+1', phone: '(949) 555-0123', birthDate: '01/16/1990', caseType: 'Physical Therapy', consent: true };
const TODAY = new Date(Date.UTC(2026, 10, 7));

test('phone is formatted per country while typing', () => {
  assert.equal(formatPhone('9495550123', '+1'), '(949) 555-0123');
  assert.equal(formatPhone('949555', '+1'), '(949) 555');
  assert.equal(formatPhone('94', '+1'), '94');
  assert.equal(formatPhone('9876543210', '+91'), '98765 43210');
  assert.equal(formatPhone('98765432109999', '+91'), '98765 43210');
});

test('a pasted full number switches the country and drops the code', () => {
  // The 10 Nov bug: "+91 96545 40686" became "91965 45406".
  assert.deepEqual(readPhone('+91 96545 40686', '+91'), { countryCode: '+91', phone: '96545 40686' });
  assert.deepEqual(readPhone('+91 96545 40686', '+1'), { countryCode: '+91', phone: '96545 40686' });
  assert.deepEqual(readPhone('+1 (949) 555-0123', '+91'), { countryCode: '+1', phone: '(949) 555-0123' });
  assert.deepEqual(readPhone('19495550123', '+1'), { countryCode: '+1', phone: '(949) 555-0123' });
  assert.deepEqual(readPhone('096545 40686', '+91'), { countryCode: '+91', phone: '96545 40686' });
  // Typing stays as it was: a national number that starts with 91, and an 11th digit ignored.
  assert.deepEqual(readPhone('9196545406', '+91'), { countryCode: '+91', phone: '91965 45406' });
  assert.deepEqual(readPhone('(949) 555-01234', '+1'), { countryCode: '+1', phone: '(949) 555-0123' });
});

test('birth date gets slashes while typing', () => {
  assert.equal(formatBirthDate('01161990'), '01/16/1990');
  assert.equal(formatBirthDate('0116'), '01/16');
  assert.equal(formatBirthDate('01/1'), '01/1');
});

test('birth date must be real and at least a year back', () => {
  assert.equal(isoBirthDate('01/16/1990', TODAY), '1990-01-16');
  assert.equal(isoBirthDate('02/30/1990', TODAY), null);
  assert.equal(isoBirthDate('13/01/1990', TODAY), null);
  assert.equal(isoBirthDate('11/07/2026', TODAY), null);
  assert.equal(isoBirthDate('01/01/1890', TODAY), null);
  assert.equal(isoBirthDate('1/16/1990', TODAY), null);
});

test('the first problem is shown, none for a good form', () => {
  assert.equal(formProblem(FORM), null);
  assert.match(formProblem({ ...FORM, lastName: ' ' }) ?? '', /name/);
  assert.match(formProblem({ ...FORM, phone: '555-0123' }) ?? '', /mobile/);
  assert.match(formProblem({ ...FORM, birthDate: '01/16' }) ?? '', /birth/);
  assert.match(formProblem({ ...FORM, consent: false }) ?? '', /agree/);
});

test('the request carries digits, the code and an ISO birth date', () => {
  assert.deepEqual(requestBody({ ...FORM, countryCode: '+91', phone: '98765 43210' }, 'key-00000001'), {
    idempotency_key: 'key-00000001', first_name: 'Jane', last_name: 'Smith', country_code: '+91',
    phone: '9876543210', date_of_birth: '1990-01-16', case_type: 'Physical Therapy', contact_consent: true,
  });
});

test('server refusals become plain words', () => {
  assert.match(errorMessage(429), /few minutes/);
  assert.match(errorMessage(422), /check your details/);
  assert.match(errorMessage(503), /try again/);
});
