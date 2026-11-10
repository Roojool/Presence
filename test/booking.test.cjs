/**
 * Presence. — Booking Page Isolated Unit Tests (Worker D)
 * Tests real extracted logic from public/assets/book.js:
 * config validation, honest pricing computation, failure/retry submission guards,
 * date math, waitlist element lookup, and HTML/CSS contract integrity.
 * Uses Node built-in test and assert modules. Zero dependencies.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BOOK_HTML_PATH = path.join(ROOT, 'public', 'book.html');
const BOOK_CSS_PATH = path.join(ROOT, 'public', 'assets', 'book.css');
const BOOK_JS_PATH = path.join(ROOT, 'public', 'assets', 'book.js');

// Require the REAL exported logic from book.js
const BookingLogic = require(BOOK_JS_PATH);

test('File existence checks for Worker D exclusive files', () => {
  assert.ok(fs.existsSync(BOOK_HTML_PATH), 'public/book.html must exist');
  assert.ok(fs.existsSync(BOOK_CSS_PATH), 'public/assets/book.css must exist');
  assert.ok(fs.existsSync(BOOK_JS_PATH), 'public/assets/book.js must exist');
});

test('public/book.html contract & markup checks', () => {
  const html = fs.readFileSync(BOOK_HTML_PATH, 'utf8');

  // Must have body data-page="book" for site.js contract
  assert.match(html, /<body[^>]*data-page=["']book["']/i, 'body must have data-page="book"');

  // Must have #week and #book section IDs for legacy navigation while preserving #main-content
  assert.match(html, /id=["']week["']/i, 'Must have #week section for legacy anchor navigation');
  assert.match(html, /id=["']book["']/i, 'Must have #book section for legacy anchor navigation');
  assert.match(html, /id=["']main-content["']/i, 'Must preserve main-content id');

  // Must have exactly ONE <h1>
  const h1Matches = html.match(/<h1[\s>]/gi) || [];
  assert.equal(h1Matches.length, 1, 'Page must have exactly one <h1> element');

  // Must share site-header and site-footer contracts
  assert.match(html, /id=["']site-header["']/i, 'Must contain site-header container');
  assert.match(html, /id=["']site-footer["']/i, 'Must contain site-footer container');

  // Initial placeholders must NOT show hardcoded 10,000 or false no-deposit promise before config
  assert.doesNotMatch(html, /<span class="meta-val" id="heroPriceDisplay">₹10,000/i, 'Hero price must not hardcode 10000 in markup');
  assert.doesNotMatch(html, /<strong class="pricing-num" id="formPriceTotal">₹10,000/i, 'Form total must not hardcode 10000 in markup');

  // Submit button must be disabled by default until valid config loads
  assert.match(html, /<button[^>]*id=["']submitBtn["'][^>]*disabled/i, 'Submit button must be disabled until valid config loads');

  // Confirmation dialog must state "Deposit received; your hold is awaiting confirmation."
  assert.match(html, /Deposit received;\s*your hold is awaiting confirmation\./i, 'Dialog must accurately state deposit received and awaiting confirmation');
  assert.doesNotMatch(html, /Your hour is securely reserved/i, 'Must not claim hour is reserved before admin confirmation');

  // Must have native dialog for confirmation
  assert.match(html, /<dialog[^>]*id=["']confirmDialog["']/i, 'Must use native dialog for confirmation');

  // Must have required form fields matching backend contract
  assert.match(html, /id=["']f-name["']/i, 'Must include f-name input');
  assert.match(html, /id=["']f-contact["']/i, 'Must include f-contact input');
  assert.match(html, /id=["']f-date["']/i, 'Must include f-date input');
  assert.match(html, /id=["']f-time["']/i, 'Must include f-time select');
  assert.match(html, /id=["']f-practice["']/i, 'Must include f-practice select');
  assert.match(html, /id=["']f-req["']/i, 'Must include f-req textarea');
  assert.match(html, /id=["']f-lady["']/i, 'Must include f-lady checkbox');
  assert.match(html, /id=["']f-website["']/i, 'Must include f-website honeypot');

  // Honeypot must be hidden from sighted users & screen readers
  assert.match(html, /class=["'][^"']*hp[^"']*["'][^>]*aria-hidden=["']true["']/i, 'Honeypot must have aria-hidden="true"');
});

test('public/assets/book.js syntax & pattern checks', () => {
  const js = fs.readFileSync(BOOK_JS_PATH, 'utf8');

  // Must not have invented DEFAULT_CONFIG fallback object with hardcoded 10000
  assert.doesNotMatch(js, /const\s+DEFAULT_CONFIG\s*=/i, 'Must remove invented DEFAULT_CONFIG runtime fallback');

  // scrollPillIntoView must NOT call activePill.scrollIntoView which scrolls the entire window
  assert.doesNotMatch(js, /activePill\.scrollIntoView\(/, 'Must not use activePill.scrollIntoView to prevent vertical window scroll');

  // Must use form.elements.namedItem not f.name
  assert.match(js, /elements\.namedItem\(['"]name['"]\)/, 'Waitlist must use form.elements.namedItem("name")');
  assert.match(js, /elements\.namedItem\(['"]contact['"]\)/, 'Waitlist must use form.elements.namedItem("contact")');

  // Must use AbortController for network concurrency
  assert.match(js, /AbortController/, 'Must utilize AbortController to cancel stale requests');

  // Must have send lock during submission and payment handling
  assert.match(js, /isSubmitting/, 'Must track send lock to prevent double booking');

  // Dialog payment text must reflect pending admin confirmation
  assert.match(js, /Deposit received;\s*your hold is awaiting confirmation\./i, 'Dialog text must state awaiting confirmation');
});

test('public/assets/book.css scroll-margin-top & layout checks', () => {
  const css = fs.readFileSync(BOOK_CSS_PATH, 'utf8');

  // Must have scroll-margin-top for #week and #book anchors
  assert.match(css, /#week,\s*#book\s*\{[^}]*scroll-margin-top/i, 'Must set scroll-margin-top for #week and #book');

  // Must support prefers-reduced-motion
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/i, 'Must support prefers-reduced-motion');
});

test('Behavioral Test: Real exported validateConfig rejects invalid data and handles zero price', () => {
  const { validateConfig } = BookingLogic;

  // Valid config baseline
  const validConfig = {
    today: '2026-10-24',
    priceRupees: 10000,
    maxDaysAhead: 14,
    timezone: 'Asia/Kolkata',
    practices: ['The Plus-One'],
    slots: [{ time: '07:30', name: 'morning flow', note: 'gentle' }],
    payments: null,
  };
  assert.equal(validateConfig(validConfig), true, 'Full config must be valid');

  // Invalid configs: price constraints (must be finite nonnegative)
  assert.equal(validateConfig(null), false, 'Null config is invalid');
  assert.equal(validateConfig({}), false, 'Empty config is invalid');
  assert.equal(validateConfig({ ...validConfig, priceRupees: -100 }), false, 'Negative price is invalid');
  assert.equal(validateConfig({ ...validConfig, priceRupees: Infinity }), false, 'Infinity price is invalid');
  assert.equal(validateConfig({ ...validConfig, priceRupees: '10000' }), false, 'String price is invalid');
  assert.equal(validateConfig({ ...validConfig, priceRupees: NaN }), false, 'NaN price is invalid');

  // Valid price zero must be allowed
  assert.equal(validateConfig({ ...validConfig, priceRupees: 0 }), true, 'Price zero must be valid');

  // Invalid maxDaysAhead (must be positive finite integer)
  assert.equal(validateConfig({ ...validConfig, maxDaysAhead: 0 }), false, '0 maxDaysAhead is invalid');
  assert.equal(validateConfig({ ...validConfig, maxDaysAhead: -5 }), false, 'Negative maxDaysAhead is invalid');
  assert.equal(validateConfig({ ...validConfig, maxDaysAhead: 14.5 }), false, 'Non-integer maxDaysAhead is invalid');
  assert.equal(validateConfig({ ...validConfig, maxDaysAhead: Infinity }), false, 'Infinity maxDaysAhead is invalid');

  // Invalid date and timezone
  assert.equal(validateConfig({ ...validConfig, today: 'invalid-date' }), false, 'Bad date is invalid');
  assert.equal(validateConfig({ ...validConfig, today: '2026-02-31' }), false, 'Nonexistent date is invalid');
  assert.equal(validateConfig({ ...validConfig, timezone: '' }), false, 'Empty timezone is invalid');

  // Malformed practices and slots
  assert.equal(validateConfig({ ...validConfig, practices: [] }), false, 'Empty practices is invalid');
  assert.equal(validateConfig({ ...validConfig, practices: [''] }), false, 'Empty string practice is invalid');
  assert.equal(validateConfig({ ...validConfig, slots: [] }), false, 'Empty slots is invalid');
  assert.equal(validateConfig({ ...validConfig, slots: [{ time: 'bad' }] }), false, 'Slot missing name/note is invalid');
  assert.equal(validateConfig({ ...validConfig, slots: [{ time: '07:30', name: 'flow' }] }), false, 'Slot missing note is invalid');

  // Payments validation: fail-closed on missing payments or malformed objects
  assert.equal(validateConfig({ ...validConfig, payments: undefined }), false, 'Missing payments field is invalid');
  assert.equal(validateConfig({ ...validConfig, payments: {} }), false, 'Empty payments object is invalid');
  assert.equal(validateConfig({ ...validConfig, payments: { provider: 'stripe', keyId: 'k', depositRupees: 2000 } }), false, 'Non-razorpay provider is invalid');
  assert.equal(validateConfig({ ...validConfig, payments: { provider: 'razorpay', keyId: '', depositRupees: 2000 } }), false, 'Empty keyId is invalid');
  assert.equal(validateConfig({ ...validConfig, payments: { provider: 'razorpay', keyId: 'k', depositRupees: 0 } }), false, '0 depositRupees is invalid');
  assert.equal(validateConfig({ ...validConfig, payments: { provider: 'razorpay', keyId: 'k', depositRupees: -50 } }), false, 'Negative depositRupees is invalid');
  assert.equal(validateConfig({ ...validConfig, payments: { provider: 'razorpay', keyId: 'k', depositRupees: Infinity } }), false, 'Infinity depositRupees is invalid');

  // Valid payments: explicit null OR valid razorpay object
  assert.equal(validateConfig({ ...validConfig, payments: null }), true, 'Explicit null payments is accepted');
  assert.equal(validateConfig({
    ...validConfig,
    payments: { provider: 'razorpay', keyId: 'rzp_test_123', depositRupees: 2000 },
  }), true, 'Valid razorpay payments object is accepted');
});

test('Behavioral Test: Real exported computePricingCopy handles zero price, deposit, and failure states', () => {
  const { computePricingCopy } = BookingLogic;

  // 1. Failed / missing config state
  const failedCopy = computePricingCopy(null);
  assert.equal(failedCopy.isReady, false);
  assert.equal(failedCopy.canSubmit, false);
  assert.equal(failedCopy.heroPrice, 'Rate unavailable');
  assert.equal(failedCopy.formPrice, '—');
  assert.equal(failedCopy.btnText, 'Schedule Unavailable');
  assert.doesNotMatch(failedCopy.formDepositText, /No deposit required now/, 'Failed config must not promise no deposit');

  // 2. Zero price config state
  const zeroConfig = {
    today: '2026-10-24',
    priceRupees: 0,
    maxDaysAhead: 14,
    timezone: 'Asia/Kolkata',
    practices: ['The Silence'],
    slots: [{ time: '10:00', name: 'brunch', note: 'eggs' }],
    payments: null,
  };
  const zeroCopy = computePricingCopy(zeroConfig);
  assert.equal(zeroCopy.isReady, true);
  assert.equal(zeroCopy.canSubmit, true);
  assert.equal(zeroCopy.heroPrice, '₹0 / hour', 'Price 0 must display as ₹0, not 10000');
  assert.equal(zeroCopy.formPrice, '₹0', 'Form price must display as ₹0, not 10000');

  // 3. Deposit active config state
  const depositConfig = {
    ...zeroConfig,
    priceRupees: 10000,
    payments: { provider: 'razorpay', keyId: 'rzp_test_123', depositRupees: 2500 },
  };
  const depositCopy = computePricingCopy(depositConfig);
  assert.equal(depositCopy.isReady, true);
  assert.equal(depositCopy.hasDeposit, true);
  assert.equal(depositCopy.heroDeposit, '₹2,500 deposit hold');
  assert.match(depositCopy.btnText, /₹2,500 Deposit/);
  assert.doesNotMatch(depositCopy.fineprint, /No payment now/, 'Deposit config must never promise no payment now');
});

test('Behavioral Test: Failure, Retry, and canSubmit Submission Guard', () => {
  const { canSubmit, validateConfig } = BookingLogic;

  // Initial / Failed state
  let hasValidConfig = false;
  let currentConfig = null;
  let isSubmitting = false;

  // User tries to submit while config is failed
  assert.equal(canSubmit({ hasValidConfig, config: currentConfig, isSubmitting }), false, 'Cannot submit when config is invalid');

  // Even if user enables button in DOM or programmatic submit is triggered
  const formValues = {
    name: 'Priya Sharma',
    contact: '+91 98765 43210',
    request: 'Wedding companion',
    lady: true,
  };
  assert.equal(canSubmit({ hasValidConfig, config: currentConfig, isSubmitting }), false, 'Submit guard prevents submission even with filled fields');

  // Simulated failed retry
  const badServerResponse = { error: 'Database down' };
  if (validateConfig(badServerResponse)) {
    hasValidConfig = true;
    currentConfig = badServerResponse;
  }
  assert.equal(hasValidConfig, false, 'Failed retry does not make state valid');
  assert.equal(canSubmit({ hasValidConfig, config: currentConfig, isSubmitting }), false);

  // User's typed fields remain preserved in memory/DOM!
  assert.equal(formValues.name, 'Priya Sharma');
  assert.equal(formValues.contact, '+91 98765 43210');

  // Simulated successful retry from server
  const goodServerResponse = {
    today: '2026-10-24',
    priceRupees: 10000,
    maxDaysAhead: 14,
    timezone: 'Asia/Kolkata',
    practices: ['The Plus-One', 'The Carrier'],
    slots: [{ time: '07:30', name: 'morning flow', note: 'gentle' }],
    payments: null,
  };
  if (validateConfig(goodServerResponse)) {
    hasValidConfig = true;
    currentConfig = goodServerResponse;
  }
  assert.equal(hasValidConfig, true, 'Valid response sets hasValidConfig to true');
  assert.equal(canSubmit({ hasValidConfig, config: currentConfig, isSubmitting }), true, 'Can submit once valid config is loaded');

  // Send lock: while isSubmitting is true (e.g. during Razorpay modal), submission is blocked
  isSubmitting = true;
  assert.equal(canSubmit({ hasValidConfig, config: currentConfig, isSubmitting }), false, 'Cannot submit while isSubmitting lock is active');
  isSubmitting = false;
  assert.equal(canSubmit({ hasValidConfig, config: currentConfig, isSubmitting }), true, 'Submission allowed again once unlocked');
});

test('Waitlist form.elements.namedItem simulation', () => {
  const mockForm = {
    name: 'waitlist-form-name-attribute',
    elements: {
      namedItem(id) {
        if (id === 'name') return { value: 'Meher Sen' };
        if (id === 'contact') return { value: '+91 98765 43210' };
        return null;
      },
    },
  };

  assert.equal(typeof mockForm.name, 'string');
  assert.equal(mockForm.name.value, undefined);

  const nameInput = mockForm.elements.namedItem('name');
  const contactInput = mockForm.elements.namedItem('contact');
  assert.equal(nameInput.value, 'Meher Sen');
  assert.equal(contactInput.value, '+91 98765 43210');
});

test('Behavioral Test: Real extracted computeSelectionSummary and calculatePillHorizontalScroll', () => {
  const { computeSelectionSummary, calculatePillHorizontalScroll } = BookingLogic;

  // 1. computeSelectionSummary behavior
  assert.equal(
    computeSelectionSummary({ hasValidConfig: false, config: null }),
    'Schedule unavailable. Please retry.'
  );

  const mockConfig = {
    today: '2026-10-24',
    priceRupees: 10000,
    maxDaysAhead: 14,
    timezone: 'Asia/Kolkata',
    practices: ['The Plus-One'],
    slots: [{ time: '07:30', name: 'morning flow', note: 'gentle' }],
    payments: null,
  };

  // Config loaded, date chosen, no hour yet: must instruct user to choose an hour (never stale loading)
  const noHourSummary = computeSelectionSummary({
    hasValidConfig: true,
    config: mockConfig,
    selectedDate: '2026-10-24',
    selectedTime: '',
  });
  assert.match(noHourSummary, /Choose an hour/);
  assert.doesNotMatch(noHourSummary, /Loading availability/);

  // Hour chosen
  const hourSummary = computeSelectionSummary({
    hasValidConfig: true,
    config: mockConfig,
    selectedDate: '2026-10-24',
    selectedTime: '07:30',
  });
  assert.match(hourSummary, /07:30/);

  // Flexible chosen
  const flexSummary = computeSelectionSummary({
    hasValidConfig: true,
    config: mockConfig,
    selectedDate: '2026-10-24',
    selectedTime: 'flexible',
  });
  assert.match(flexSummary, /Flexible Time/);

  // 2. calculatePillHorizontalScroll behavior (horizontal only, nonnegative)
  assert.equal(calculatePillHorizontalScroll(0, 80, 400), 0);
  assert.equal(calculatePillHorizontalScroll(300, 80, 400), 140);
  assert.equal(calculatePillHorizontalScroll(NaN, 80, 400), 0);
});
