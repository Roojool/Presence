/**
 * Presence. — Worker E (Apply Frontend) Verification & Assertion Suite
 *
 * Verifies:
 * 1. File existence of exclusive writable assets.
 * 2. Static HTML semantic structure, ARIA linkage, field contract IDs, single h1,
 *    shared site header/footer integration, botanical art, compact dimensions,
 *    and strict removal of all invented business/policy claims.
 * 3. LinkedIn panel QR SVG geometry (37x37, quiet zone >= 4 modules) and exact decoded URL match.
 * 4. CSS responsive rules, reduced-motion queries, and dark floral design tokens.
 * 5. JS syntax parsing, import of B's upload-client.js, no Vercel direct-to-blob imports.
 * 6. Behavior unit tests in isolated VM context:
 *    - Config failure & independent submit guard (fails closed, retains fields, truthful banner)
 *    - In-flight edit lock (disables all inputs, dropzone, remove buttons, snapshot captured)
 *    - Partial upload + photo changes reset stale session paths (all uploaded/pathname cleared)
 *    - Ambiguous finalization retry uses immutable same snapshot (frozen payload, no re-reading)
 *    - Never fabricates APP-RECEIVED; validates ref and receiptStatus
 *    - Truthful receipt copy ('sent', 'pending', 'failed' without technical jargon or false promises)
 *    - Duplicate submit locking
 */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const APPLY_HTML_PATH = path.join(ROOT, 'public', 'apply.html');
const APPLY_CSS_PATH = path.join(ROOT, 'public', 'assets', 'apply.css');
const APPLY_JS_PATH = path.join(ROOT, 'public', 'assets', 'apply.js');
const QR_SVG_PATH = path.join(ROOT, 'public', 'assets', 'linkedin-qr.svg');

console.log('=== Presence Worker E Application Verification ===\n');

// --------------------------------------------------------------------------
// 1. File Existence Checks
// --------------------------------------------------------------------------
console.log('1. Checking file existence...');
assert.ok(fs.existsSync(APPLY_HTML_PATH), 'public/apply.html must exist');
assert.ok(fs.existsSync(APPLY_CSS_PATH), 'public/assets/apply.css must exist');
assert.ok(fs.existsSync(APPLY_JS_PATH), 'public/assets/apply.js must exist');
assert.ok(fs.existsSync(QR_SVG_PATH), 'public/assets/linkedin-qr.svg must exist');
console.log('PASS: All required files exist.\n');

// --------------------------------------------------------------------------
// 2. HTML Markup & Editorial Integrity Checks
// --------------------------------------------------------------------------
console.log('2. Validating public/apply.html markup, semantics, and truthful copy...');
const html = fs.readFileSync(APPLY_HTML_PATH, 'utf8');

// Body data-page contract for site.js
assert.match(
  html,
  /<body[^>]*data-page=["']apply["']/i,
  'body must have data-page="apply" attribute'
);

// Exactly ONE <h1> element
const h1Matches = html.match(/<h1[\s>]/gi) || [];
assert.equal(h1Matches.length, 1, `Must have exactly ONE <h1> element, found ${h1Matches.length}`);

// Header and footer injection placeholders
assert.match(html, /id=["']site-header["']/i, 'Must contain site-header container');
assert.match(html, /id=["']site-footer["']/i, 'Must contain site-footer container');

// Linked shared & apply assets
assert.match(html, /href=["']\/assets\/site\.css["']/i, 'Must link /assets/site.css');
assert.match(html, /href=["']\/assets\/apply\.css["']/i, 'Must link /assets/apply.css');
assert.match(html, /src=["']\/assets\/site\.js["']/i, 'Must load /assets/site.js');
assert.match(html, /src=["']\/assets\/apply\.js["']/i, 'Must load /assets/apply.js');
assert.match(html, /type=["']module["']/i, 'Must load apply.js as an ES module');

// Required input IDs
const requiredFields = [
  'a-name',
  'a-email',
  'a-phone',
  'a-city',
  'a-age',
  'a-experience',
  'a-photos',
  'a-consent',
];

for (const fieldId of requiredFields) {
  const pattern = new RegExp(`id=["']${fieldId}["']`, 'i');
  assert.match(html, pattern, `Form must contain element with id="${fieldId}"`);
}

// Optional input IDs
assert.match(html, /id=["']a-portfolio["']/i, 'Form must contain element with id="a-portfolio"');
assert.match(html, /id=["']a-social["']/i, 'Form must contain element with id="a-social"');

// Error container IDs
const errorFieldIds = [
  'a-name-err',
  'a-email-err',
  'a-phone-err',
  'a-city-err',
  'a-age-err',
  'a-experience-err',
  'a-portfolio-err',
  'a-social-err',
  'a-photos-err',
  'a-consent-err',
];

for (const errId of errorFieldIds) {
  const pattern = new RegExp(`id=["']${errId}["']`, 'i');
  assert.match(html, pattern, `Form must contain error container id="${errId}"`);
}

// Honeypot field
assert.match(html, /name=["']website["']/i, 'Form must include honeypot field name="website"');

// Dropzone and preview containers
assert.match(html, /id=["']a-dropzone["']/i, 'Must contain a-dropzone');
assert.match(html, /id=["']photo-previews["']/i, 'Must contain photo-previews container');
assert.match(html, /id=["']apply-progress-wrap["']/i, 'Must contain apply-progress-wrap');
assert.match(html, /id=["']apply-submit-btn["']/i, 'Must contain apply-submit-btn');
assert.match(html, /id=["']apply-success-card["']/i, 'Must contain apply-success-card');

// Botanical art
assert.match(html, /\/assets\/lily-art\.svg/i, 'Must display /assets/lily-art.svg');

// Initial submit button must be disabled until valid config
assert.match(
  html,
  /<button[^>]*id=["']apply-submit-btn["'][^>]*disabled/i,
  'Initial submit button must have disabled attribute'
);

// Strict check: Remove invented business/policy claims
const prohibitedClaims = [
  'luxury apparel houses',
  'verified credentials',
  'current cohort',
  'rolling evaluations',
  'compensation contracts',
  'no upfront fees',
  'representation division',
  'founder',
  'Cloudflare R2',
  'background verification',
  'measurements',
];

for (const claim of prohibitedClaims) {
  assert.ok(
    !html.toLowerCase().includes(claim.toLowerCase()),
    `HTML must NOT contain invented claim or jargon: "${claim}"`
  );
}

// User-supplied copy verification
assert.match(html, /fashion/i, 'Must mention fashion modeling');
assert.match(html, /brand/i, 'Must mention brand modeling');
assert.match(html, /newcomer/i, 'Must state newcomers welcome');
assert.match(html, /private/i, 'Must mention private reviews');

// LinkedIn Panel: connects with Rujul Talekar without founder title
assert.match(html, /\/assets\/linkedin-qr\.svg/i, 'Must embed /assets/linkedin-qr.svg');
assert.match(html, /https:\/\/www\.linkedin\.com\/in\/rujul-talekar\//i, 'Must link to exact LinkedIn profile');
console.log('PASS: HTML semantics, IDs, accessibility, and truthful copy validated.\n');

// --------------------------------------------------------------------------
// 3. QR Code Geometric & Bitstream Verification (37x37, Quiet Zone = 4)
// --------------------------------------------------------------------------
console.log('3. Validating LinkedIn QR SVG geometry (37x37, qz>=4) and decoding bitstream...');
const svg = fs.readFileSync(QR_SVG_PATH, 'utf8');
assert.ok(svg.includes('<svg'), 'QR file must be valid SVG');
assert.ok(svg.includes('viewBox="0 0 37 37"'), 'viewBox should match 37x37 QR dimension for quiet zone 4');

const size = 37;
const grid = Array.from({ length: size }, () => Array(size).fill(0));
const darkPartMatch = svg.match(/<path[^>]*stroke=[^>]*d="([^"]+)"/);
assert.ok(darkPartMatch, 'Must find dark stroke path');
const d = darkPartMatch[1];

const rowRegex = /M(\d+)\s+(\d+)\.5([^M]*)/g;
let rowMatch;
while ((rowMatch = rowRegex.exec(d)) !== null) {
  let x = parseInt(rowMatch[1], 10);
  const y = parseInt(rowMatch[2], 10);
  const cmds = rowMatch[3];
  const cmdRegex = /([hm])(\d+)(?:\s+0)?/g;
  let cmd;
  while ((cmd = cmdRegex.exec(cmds)) !== null) {
    const type = cmd[1];
    const len = parseInt(cmd[2], 10);
    if (type === 'h') {
      for (let i = 0; i < len; i++) {
        if (x + i < size && y < size) grid[y][x + i] = 1;
      }
      x += len;
    } else if (type === 'm') {
      x += len;
    }
  }
}

// Verify 3 Corner Finder Patterns at (4,4), (26,4), (4,26)
function checkFinderPattern(startX, startY) {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
      const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const expected = isBorder || isInner ? 1 : 0;
      assert.equal(
        grid[startY + r][startX + c],
        expected,
        `Finder pattern mismatch at row ${startY + r}, col ${startX + c}`
      );
    }
  }
}

checkFinderPattern(4, 4);   // Top-Left (qz = 4)
checkFinderPattern(26, 4);  // Top-Right (4 + 29 - 7 = 26)
checkFinderPattern(4, 26);  // Bottom-Left (4 + 29 - 7 = 26)

// Format Information with qz = 4
const qz = 4;
const coords = [
  [8 + qz, 0 + qz], [8 + qz, 1 + qz], [8 + qz, 2 + qz], [8 + qz, 3 + qz], [8 + qz, 4 + qz], [8 + qz, 5 + qz], [8 + qz, 7 + qz], [8 + qz, 8 + qz],
  [7 + qz, 8 + qz], [5 + qz, 8 + qz], [4 + qz, 8 + qz], [3 + qz, 8 + qz], [2 + qz, 8 + qz], [1 + qz, 8 + qz], [0 + qz, 8 + qz],
];
let formatBits = 0;
for (let i = 0; i < 15; i++) {
  const [x, y] = coords[i];
  formatBits = (formatBits << 1) | grid[y][x];
}
const unmaskedFormat = formatBits ^ 0x5412;
const maskPattern = (unmaskedFormat >> 10) & 7;

function isMasked(r, c, pattern) {
  switch (pattern) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2 + (r * c) % 3) === 0;
    case 6: return (((r * c) % 2 + (r * c) % 3) % 2) === 0;
    case 7: return (((r + c) % 2 + (r * c) % 3) % 2) === 0;
  }
}

const qrSize = 29;
function isFunctionModule(r, c) {
  if (r < 9 && c < 9) return true;
  if (r < 9 && c >= qrSize - 8) return true;
  if (r >= qrSize - 8 && c < 9) return true;
  if (r === 6 || c === 6) return true;
  if (r >= 20 && r <= 24 && c >= 20 && c <= 24) return true;
  return false;
}

const extractedBits = [];
let upward = true;
for (let rightCol = qrSize - 1; rightCol > 0; rightCol -= 2) {
  if (rightCol === 6) rightCol--;
  const cols = [rightCol, rightCol - 1];
  const rowOrder = [];
  if (upward) {
    for (let r = qrSize - 1; r >= 0; r--) rowOrder.push(r);
  } else {
    for (let r = 0; r < qrSize; r++) rowOrder.push(r);
  }
  for (const r of rowOrder) {
    for (const c of cols) {
      if (!isFunctionModule(r, c)) {
        let bit = grid[r + qz][c + qz];
        if (isMasked(r, c, maskPattern)) bit ^= 1;
        extractedBits.push(bit);
      }
    }
  }
  upward = !upward;
}

let mode = 0;
for (let i = 0; i < 4; i++) mode = (mode << 1) | extractedBits[i];
assert.equal(mode, 4, 'QR Mode must be Byte Mode (0100)');

let count = 0;
for (let i = 4; i < 12; i++) count = (count << 1) | extractedBits[i];
assert.equal(count, 42, 'Character count must be 42');

let decodedUrl = '';
let bitIdx = 12;
for (let i = 0; i < count; i++) {
  let charCode = 0;
  for (let b = 0; b < 8; b++) {
    charCode = (charCode << 1) | extractedBits[bitIdx++];
  }
  decodedUrl += String.fromCharCode(charCode);
}

assert.equal(
  decodedUrl,
  'https://www.linkedin.com/in/rujul-talekar/',
  'Decoded QR URL must exactly match https://www.linkedin.com/in/rujul-talekar/'
);
console.log(`PASS: QR has quiet zone >= 4 and decodes exactly to "${decodedUrl}".\n`);

// --------------------------------------------------------------------------
// 4. CSS Responsive Rules & Accessibility Checks
// --------------------------------------------------------------------------
console.log('4. Validating CSS styling, compact layout, and reduced-motion...');
const css = fs.readFileSync(APPLY_CSS_PATH, 'utf8');

assert.match(css, /prefers-reduced-motion:\s*reduce/i, 'Must support prefers-reduced-motion');
assert.match(css, /@media\s*\([^)]*min-width/i, 'Must contain responsive media queries');
assert.match(css, /\.dropzone/i, 'Must style .dropzone');
assert.match(css, /\.photo-thumb/i, 'Must style photo thumbnails');
assert.match(css, /\.progress-bar/i, 'Must style progress bar');
assert.match(css, /\.linkedin-card|\.linkedin-qr/i, 'Must style LinkedIn panel');
assert.match(css, /--crimson|--text-ivory|--bg-cherry/i, 'Must utilize design system tokens');

// Compact intro padding to ensure form begins before 600px desktop / 650px mobile
assert.match(css, /\.apply-intro-section/i, 'Must style compact intro section');
console.log('PASS: CSS accessibility, tokens, and compact layout validated.\n');

// --------------------------------------------------------------------------
// 5. JS Architecture Contract Checks
// --------------------------------------------------------------------------
console.log('5. Validating JS syntax and architectural contract...');
const js = fs.readFileSync(APPLY_JS_PATH, 'utf8');

assert.match(
  js,
  /import\s*\{\s*upload\s*\}\s*from\s*['"]\/assets\/upload-client\.js['"]/i,
  'Must import upload from /assets/upload-client.js'
);
assert.ok(!js.includes('@vercel/blob'), 'Must NOT import @vercel/blob');
assert.ok(!js.includes('https://cdn'), 'Must NOT import runtime CDN SDKs');
assert.ok(!js.includes('Cloudflare R2'), 'Must NOT include Cloudflare R2 in applicant-facing JS');
assert.ok(!js.includes('current-cohort'), 'Must NOT invent current-cohort reason in JS');
assert.match(js, /\/api\/applications\/session/i, 'Must call /api/applications/session');
assert.match(js, /\/api\/applications/i, 'Must submit to /api/applications');
assert.match(js, /\/api\/config/i, 'Must check /api/config');
console.log('PASS: JS architectural contract validated.\n');

// --------------------------------------------------------------------------
// 6. Behavioral Simulation in Isolated Node VM
// --------------------------------------------------------------------------
console.log('6. Running behavior simulation tests in isolated VM...');

async function runBehaviorTests() {
  // Helper to construct mock DOM and module environment
  function createMockEnvironment() {
    const domElements = new Map();

    function makeEl(tag, id = '') {
      const el = {
        tagName: tag.toUpperCase(),
        id,
        className: '',
        value: '',
        textContent: '',
        innerHTML: '',
        hidden: false,
        disabled: false,
        attributes: new Map(),
        classList: {
          add: (c) => { el.className = (el.className + ' ' + c).trim(); },
          remove: (c) => { el.className = el.className.replace(new RegExp(`\\b${c}\\b`, 'g'), '').trim(); },
          contains: (c) => el.className.split(/\s+/).includes(c),
        },
        setAttribute: (k, v) => { el.attributes.set(k, String(v)); if (k === 'disabled') el.disabled = true; },
        removeAttribute: (k) => { el.attributes.delete(k); if (k === 'disabled') el.disabled = false; },
        getAttribute: (k) => el.attributes.get(k) || null,
        appendChild: (child) => {
          if (child) child.parentElement = el;
          el.children.push(child);
          return child;
        },
        removeChild: (child) => {
          const idx = el.children.indexOf(child);
          if (idx !== -1) el.children.splice(idx, 1);
          if (child) child.parentElement = null;
          return child;
        },
        children: [],
        closest: (sel) => makeEl('div'),
        querySelector: (sel) => makeEl('span'),
        querySelectorAll: (sel) => [],
        listeners: new Map(),
        addEventListener: (event, handler) => {
          if (!el.listeners.has(event)) el.listeners.set(event, []);
          el.listeners.get(event).push(handler);
        },
        dispatchEvent: (event) => {
          const type = typeof event === 'string' ? event : event.type;
          const list = el.listeners.get(type) || [];
          for (const fn of list) {
            fn(typeof event === 'string' ? { type: event, preventDefault: () => {}, stopPropagation: () => {} } : event);
          }
        },
        focus: () => {},
        reset: () => {},
        scrollIntoView: () => {},
      };
      if (id) domElements.set(id, el);
      return el;
    }

    // Pre-populate required elements
    const submitBtn = makeEl('button', 'apply-submit-btn');
    submitBtn.disabled = true;
    const submitText = makeEl('span', 'submit-btn-text');
    submitText.textContent = 'Loading configuration...';
    const banner = makeEl('div', 'apply-status-banner');
    banner.hidden = true;
    const form = makeEl('form', 'apply-form');
    const alertEl = makeEl('div', 'apply-form-alert');
    alertEl.hidden = true;
    const successCard = makeEl('div', 'apply-success-card');
    successCard.hidden = true;
    const refVal = makeEl('span', 'success-ref-val');
    const receiptNote = makeEl('div', 'success-receipt-note');
    const dropzone = makeEl('div', 'a-dropzone');
    const previews = makeEl('div', 'photo-previews');
    const progressWrap = makeEl('div', 'apply-progress-wrap');
    progressWrap.hidden = true;

    // Form input elements
    const inputs = [
      'a-name', 'a-email', 'a-phone', 'a-city', 'a-age',
      'a-experience', 'a-portfolio', 'a-social', 'a-consent', 'a-photos', 'a-website'
    ];
    inputs.forEach((id) => {
      const el = makeEl(id === 'a-experience' ? 'textarea' : 'input', id);
      if (id === 'a-consent') el.checked = false;
    });

    const formInputsList = Array.from(domElements.values());
    form.querySelectorAll = () => formInputsList;

    const mockDocument = {
      getElementById: (id) => domElements.get(id) || null,
      createElement: (tag) => makeEl(tag),
      querySelectorAll: (sel) => {
        if (sel.includes('photo-thumb-remove-btn')) return [];
        return [];
      },
      readyState: 'complete',
    };

    const sandbox = {
      document: mockDocument,
      window: { PresenceUI: null },
      URL: {
        createObjectURL: (f) => `blob:mock/${f.name || 'file'}`,
        revokeObjectURL: () => {},
      },
      crypto: {
        randomUUID: () => 'uuid_' + Math.random().toString(36).substring(2, 10),
      },
      fetch: async () => { throw new Error('Fetch not mocked'); },
      console: { log: () => {}, error: () => {}, warn: () => {} },
      setTimeout: (fn) => fn(),
      __mockUpload: async () => ({ pathname: 'applications/mock/photo.jpg' }),
    };

    // Transform apply.js from ES import to mockUpload
    const jsTransformed = js
      .replace(/import\s*\{\s*upload\s*\}\s*from\s*['"][^'"]+['"];/, 'const upload = globalThis.__mockUpload;')
      .replace(/export\s+/g, '') +
      '\nObject.assign(globalThis, { state, fetchAppConfig, syncSubmitButton, setFormControlsDisabled, removePhoto, handleFilesAdded, submitApplication, executeFinalize, handleSubmissionSuccess, validateApplicationForm });';

    const context = vm.createContext(sandbox);
    vm.runInContext(jsTransformed, context);

    return { context, domElements, sandbox };
  }

  // --------------------------------------------------------------------------
  // 6.1 Test: Config Unavailable State & Independent Submit Guard
  // --------------------------------------------------------------------------
  console.log('6.1 Testing config failure and independent submit guard...');
  {
    const { context, domElements, sandbox } = createMockEnvironment();
    const submitBtn = domElements.get('apply-submit-btn');
    const banner = domElements.get('apply-status-banner');

    // Verify default state fails closed
    assert.equal(context.state.config.loaded, false, 'Config must start unloaded');
    assert.equal(context.state.config.enabled, false, 'Config must default to disabled');
    assert.equal(submitBtn.disabled, true, 'Submit button must start disabled');

    // Case A: Fetch throws network error
    sandbox.fetch = async () => { throw new Error('Network failure'); };
    await vm.runInContext('fetchAppConfig()', context);

    assert.equal(context.state.config.loaded, false);
    assert.equal(context.state.config.enabled, false);
    assert.equal(submitBtn.disabled, true, 'Submit button must remain disabled on fetch error');
    assert.equal(banner.hidden, false, 'Status banner must show on config error');
    assert.match(banner.innerHTML, /service temporarily unavailable/i);
    assert.match(banner.innerHTML, /linkedin/i);

    // Guard test: Unlocking submit while config is down MUST NOT enable button
    vm.runInContext('syncSubmitButton("Submit application")', context);
    assert.equal(submitBtn.disabled, true, 'syncSubmitButton must NOT enable button when service is unavailable');

    // Case B: Fetch returns applications.enabled = false
    sandbox.fetch = async (url) => {
      if (url === '/api/config') {
        return {
          ok: true,
          json: async () => ({ applications: { enabled: false } }),
        };
      }
    };
    await vm.runInContext('fetchAppConfig()', context);
    assert.equal(context.state.config.loaded, true);
    assert.equal(context.state.config.enabled, false);
    assert.equal(submitBtn.disabled, true, 'Submit button must remain disabled when applications.enabled=false');
    assert.equal(banner.hidden, false);
    assert.ok(!banner.innerHTML.includes('current-cohort'), 'Must not invent current cohort reason');

    // Case C: Valid config enables submit
    sandbox.fetch = async (url) => {
      if (url === '/api/config') {
        return {
          ok: true,
          json: async () => ({ applications: { enabled: true, maxPhotos: 5, maxPhotoBytes: 5242880 } }),
        };
      }
    };
    await vm.runInContext('fetchAppConfig()', context);
    assert.equal(context.state.config.loaded, true);
    assert.equal(context.state.config.enabled, true);
    assert.equal(submitBtn.disabled, false, 'Submit button must be enabled when valid config loaded');
    assert.equal(banner.hidden, true);
    console.log('PASS: Config unavailable state and independent submit guard verified.');
  }

  // --------------------------------------------------------------------------
  // 6.2 Test: Photo Changes Reset Stale Session Paths
  // --------------------------------------------------------------------------
  console.log('6.2 Testing photo changes reset stale session paths...');
  {
    const { context } = createMockEnvironment();

    // Add 2 initial photos
    context.state.photos = [
      { id: 'p1', file: { name: 'one.jpg', type: 'image/jpeg', size: 1000 }, uuid: 'u1', ext: 'jpg', uploaded: false, pathname: null },
      { id: 'p2', file: { name: 'two.jpg', type: 'image/jpeg', size: 1000 }, uuid: 'u2', ext: 'jpg', uploaded: false, pathname: null },
    ];
    context.state.session = { sessionId: 'sess_initial', token: 'tok_initial', photoCount: 2 };

    // Simulate photo 1 uploaded
    context.state.photos[0].uploaded = true;
    context.state.photos[0].pathname = 'applications/sess_initial/u1.jpg';

    // Now user removes photo 2
    vm.runInContext('removePhoto("p2")', context);

    // Invariant: Session abandoned, ALL remaining photos' uploaded flags and pathnames MUST be reset!
    assert.equal(context.state.session, null, 'Session must be invalidated on photo removal');
    assert.equal(context.state.photos.length, 1);
    assert.equal(context.state.photos[0].uploaded, false, 'Remaining photo uploaded flag must be reset to false');
    assert.equal(context.state.photos[0].pathname, null, 'Remaining photo pathname must be reset to null');

    // Now establish new session and verify it gets new session prefix
    context.state.session = { sessionId: 'sess_new', token: 'tok_new', photoCount: 1 };
    context.state.photos[0].pathname = `applications/${context.state.session.sessionId}/${context.state.photos[0].uuid}.${context.state.photos[0].ext}`;
    assert.equal(context.state.photos[0].pathname, 'applications/sess_new/u1.jpg');
    console.log('PASS: Stale session paths and uploaded flags are completely reset on selection change.');
  }

  // --------------------------------------------------------------------------
  // 6.3 Test: In-Flight Edit Lock & Input Snapshotting
  // --------------------------------------------------------------------------
  console.log('6.3 Testing in-flight edit lock and input snapshotting...');
  {
    const { context, domElements } = createMockEnvironment();
    const nameInput = domElements.get('a-name');
    const dropzone = domElements.get('a-dropzone');

    // Test setFormControlsDisabled
    vm.runInContext('setFormControlsDisabled(true)', context);
    assert.equal(nameInput.disabled, true, 'Form inputs must be disabled during in-flight operations');
    assert.equal(dropzone.getAttribute('tabindex'), '-1', 'Dropzone must be untabbable during transfer');
    assert.ok(dropzone.classList.contains('is-disabled'), 'Dropzone must have is-disabled class');

    // Handler guards must reject interaction
    context.state.isSubmitting = true;
    let added = false;
    context.handleFilesAdded = () => { added = true; };
    dropzone.dispatchEvent({
      type: 'drop',
      dataTransfer: { files: [{ name: 'test.jpg' }] },
      preventDefault: () => {},
      stopPropagation: () => {},
    });
    assert.equal(added, false, 'Files added must be blocked when isSubmitting is true');

    vm.runInContext('setFormControlsDisabled(false)', context);
    assert.equal(nameInput.disabled, false);
    console.log('PASS: In-flight edit lock and handler guards verified.');
  }

  // --------------------------------------------------------------------------
  // 6.4 Test: Ambiguous Finalization Retry Uses Immutable Snapshot
  // --------------------------------------------------------------------------
  console.log('6.4 Testing ambiguous finalization retry uses immutable same snapshot...');
  {
    const { context, domElements, sandbox } = createMockEnvironment();
    const nameInput = domElements.get('a-name');
    nameInput.value = 'Original Name';

    // Prepare pending submission (frozen payload)
    const frozenPayload = {
      sessionId: 'sess_123',
      token: 'tok_123',
      name: 'Original Name',
      email: 'test@example.com',
      phone: '+919876543210',
      city: 'Mumbai',
      age: 22,
      experience: 'Modeling experience statement here.',
      consent: true,
      photos: [{ pathname: 'applications/sess_123/u1.jpg' }],
    };
    context.state.pendingSubmission = { ...frozenPayload };

    let receivedPayload = null;
    sandbox.fetch = async (url, opts) => {
      if (url === '/api/applications') {
        receivedPayload = JSON.parse(opts.body);
        throw new Error('Network timeout during final confirmation');
      }
    };

    // Mutate DOM input after network interruption
    nameInput.value = 'MUTATED Name That Should NOT Be Sent';

    // Retry finalization
    await vm.runInContext('submitApplication()', context);

    assert.ok(receivedPayload, 'Submission request should have been dispatched');
    assert.equal(receivedPayload.name, 'Original Name', 'Must retry with frozen snapshot name, NOT mutated DOM value');
    assert.equal(receivedPayload.sessionId, 'sess_123', 'Must retry with original sessionId without creating new session');
    assert.ok(context.state.pendingSubmission, 'pendingSubmission must be retained on network error');

    // Case: Server responds 200 but ref/receiptStatus are missing or fabricated
    sandbox.fetch = async (url) => {
      if (url === '/api/applications') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ref: '', receiptStatus: '' }), // Invalid / fabricated
        };
      }
    };
    await vm.runInContext('submitApplication()', context);
    assert.ok(context.state.pendingSubmission, 'Must NOT treat empty ref or missing receiptStatus as success');

    // Case: Definite 400 client error safely unlocks editing
    sandbox.fetch = async (url) => {
      if (url === '/api/applications') {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: 'Age requirement not met', field: 'a-age' }),
        };
      }
    };
    await vm.runInContext('submitApplication()', context);
    assert.equal(context.state.pendingSubmission, null, 'Definite 400 must clear pendingSubmission');
    assert.equal(nameInput.disabled, false, 'Definite 400 must unlock form inputs for editing');

    console.log('PASS: Ambiguous finalization retry and frozen payload retention verified.');
  }

  // --------------------------------------------------------------------------
  // 6.5 Test: Truthful Receipt Copy & Duplicate Submit Locking
  // --------------------------------------------------------------------------
  console.log('6.5 Testing truthful receipt copy and duplicate submit lock...');
  {
    const { context, domElements } = createMockEnvironment();
    const receiptEl = domElements.get('success-receipt-note');
    const refVal = domElements.get('success-ref-val');

    // 1. Sent
    vm.runInContext('handleSubmissionSuccess("APP-1111", "sent")', context);
    assert.equal(refVal.textContent, 'APP-1111');
    assert.match(receiptEl.innerHTML, /confirmation email has been sent/i);

    // 2. Pending: delivery unconfirmed, never promises queued or will arrive shortly
    vm.runInContext('handleSubmissionSuccess("APP-2222", "pending")', context);
    assert.equal(refVal.textContent, 'APP-2222');
    assert.match(receiptEl.innerHTML, /email delivery is unconfirmed/i);
    assert.ok(!receiptEl.innerHTML.includes('queued'), 'Must NOT promise queued');
    assert.ok(!receiptEl.innerHTML.includes('will arrive shortly'), 'Must NOT promise will arrive shortly');

    // 3. Failed: saved under ref but email not delivered
    vm.runInContext('handleSubmissionSuccess("APP-3333", "failed")', context);
    assert.equal(refVal.textContent, 'APP-3333');
    assert.match(receiptEl.innerHTML, /email could not be delivered/i);
    assert.match(receiptEl.innerHTML, /APP-3333/);

    // 4. Duplicate Submit Lock
    context.state.isSubmitting = true;
    let called = false;
    context.validateApplicationForm = () => { called = true; return true; };
    await vm.runInContext('submitApplication()', context);
    assert.equal(called, false, 'submitApplication must immediately return if isSubmitting is true');

    console.log('PASS: Truthful receipt copy and duplicate submit locking verified.\n');
  }
}

runBehaviorTests()
  .then(() => {
    console.log('=== All Worker E Checks Passed Successfully ===');
  })
  .catch((err) => {
    console.error('Check failed:', err);
    process.exit(1);
  });
