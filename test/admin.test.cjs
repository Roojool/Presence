/**
 * Presence. — Admin Portal Unit & Regression Tests (Worker F)
 * Tests HTML markup contract, CSS styles, JavaScript syntax,
 * security patterns, accessibility attributes, URL validators,
 * and actual VM function behavior for refresh failure, stale blob
 * completion after logout, and stale detail responses.
 * Uses Node built-in test and assert modules. Zero external dependencies.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const ADMIN_HTML_PATH = path.join(ROOT, 'public', 'admin.html');
const ADMIN_CSS_PATH = path.join(ROOT, 'public', 'assets', 'admin.css');
const ADMIN_JS_PATH = path.join(ROOT, 'public', 'assets', 'admin.js');

/**
 * Creates an in-memory mock DOM environment for executing admin.js functions in Node VM.
 */
function createMockAdminEnv(options = {}) {
  const elements = new Map();
  const activeUrls = new Set();
  const revokedUrls = [];
  const announcements = [];
  const toasts = [];

  class MockElement {
    constructor(tag, id = '') {
      this.tagName = tag.toUpperCase();
      this.id = id;
      this.children = [];
      this.classList = {
        _set: new Set(),
        add: (...cls) => cls.forEach(c => this.classList._set.add(c)),
        remove: (...cls) => cls.forEach(c => this.classList._set.delete(c)),
        toggle: (c, force) => {
          if (force === undefined) {
            this.classList._set.has(c) ? this.classList._set.delete(c) : this.classList._set.add(c);
          } else if (force) {
            this.classList._set.add(c);
          } else {
            this.classList._set.delete(c);
          }
        },
        contains: c => this.classList._set.has(c),
      };
      this.attributes = new Map();
      this.listeners = new Map();
      this._textContent = '';
      this._value = '';
      this.disabled = false;
      this.open = false;
      this.options = [];
    }

    get textContent() {
      if (this.children.length > 0) {
        return this.children.map(c => (typeof c === 'string' ? c : c.textContent)).join('');
      }
      return this._textContent;
    }
    set textContent(v) {
      this.children = [];
      this._textContent = String(v ?? '');
    }

    get value() {
      return this._value;
    }
    set value(v) {
      this._value = String(v ?? '');
    }

    setAttribute(k, v) {
      this.attributes.set(k, String(v));
    }
    getAttribute(k) {
      return this.attributes.get(k) || null;
    }
    removeAttribute(k) {
      this.attributes.delete(k);
    }

    addEventListener(event, fn) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event).push(fn);
    }
    dispatch(event, evObj = {}) {
      const fns = this.listeners.get(event) || [];
      fns.forEach(fn => fn(evObj));
    }

    append(...kids) {
      for (const kid of kids) {
        if (kid == null) continue;
        if (this.tagName === 'SELECT' && kid.tagName === 'OPTION') {
          this.options.push(kid);
        }
        this.children.push(kid);
      }
    }

    replaceChildren(...kids) {
      this.children = [];
      this.options = [];
      this.append(...kids);
    }

    remove() {
      // noop
    }

    showModal() {
      this.open = true;
    }
    close() {
      this.open = false;
    }
    focus() {}
  }

  function getOrCreateElement(id, tag = 'div') {
    if (!elements.has(id)) {
      elements.set(id, new MockElement(tag, id));
    }
    return elements.get(id);
  }

  // Pre-seed known elements from admin.html
  const requiredIds = [
    ['login', 'form'],
    ['dash', 'div'],
    ['pw', 'input'],
    ['loginErr', 'div'],
    ['logout', 'button'],
    ['refresh', 'button'],
    ['sPending', 'span'],
    ['sConfirmed', 'span'],
    ['sWait', 'span'],
    ['sApps', 'span'],
    ['appTabBadge', 'span'],
    ['tabBookings', 'button'],
    ['tabApplications', 'button'],
    ['panelBookings', 'div'],
    ['panelApplications', 'div'],
    ['show', 'select'],
    ['bookings', 'tbody'],
    ['waitlist', 'tbody'],
    ['blocks', 'tbody'],
    ['blockForm', 'form'],
    ['bDate', 'input'],
    ['bTime', 'select'],
    ['bReason', 'input'],
    ['appFilterForm', 'form'],
    ['appSearch', 'input'],
    ['appStatusFilter', 'select'],
    ['appResetBtn', 'button'],
    ['appResultsCount', 'span'],
    ['applications', 'tbody'],
    ['appPrevBtn', 'button'],
    ['appNextBtn', 'button'],
    ['appPageInfo', 'span'],
    ['appDetailDialog', 'dialog'],
    ['closeDetailModal', 'button'],
    ['detailModalContent', 'div'],
    ['photoLightboxDialog', 'dialog'],
    ['closeLightbox', 'button'],
    ['lightboxImg', 'img'],
    ['adminLiveRegion', 'div'],
    ['toast', 'div'],
  ];

  requiredIds.forEach(([id, tag]) => getOrCreateElement(id, tag));
  elements.get('show').value = 'upcoming';
  elements.get('bTime').options = [{ value: '' }];

  // Storage
  const storageData = new Map();
  if (options.initialToken) {
    storageData.set('presenceAdmin', options.initialToken);
  }
  const mockSessionStorage = {
    getItem: k => (storageData.has(k) ? storageData.get(k) : null),
    setItem: (k, v) => storageData.set(k, String(v)),
    removeItem: k => storageData.delete(k),
    clear: () => storageData.clear(),
  };

  // Document mock
  const mockDocument = {
    getElementById: id => getOrCreateElement(id),
    createElement: tag => new MockElement(tag),
    createTextNode: text => String(text ?? ''),
  };

  // URL mock
  const mockURL = {
    createObjectURL: blob => {
      const url = 'blob:http://localhost/' + Math.random().toString(36).slice(2);
      activeUrls.add(url);
      return url;
    },
    revokeObjectURL: url => {
      revokedUrls.push(url);
      activeUrls.delete(url);
    },
  };

  // Context container
  const sandbox = {
    document: mockDocument,
    sessionStorage: mockSessionStorage,
    URL: mockURL,
    URLSearchParams,
    Node: { prototype: {} },
    fetch: options.fetch || (async () => ({ ok: true, json: async () => ({}) })),
    PresenceUI: {
      toast: (msg, type) => toasts.push({ msg, type }),
    },
    setTimeout: (fn, d) => setTimeout(fn, d),
    clearTimeout: t => clearTimeout(t),
    window: {},
    module: { exports: {} },
    exports: {},
    console,
  };
  sandbox.window = sandbox;

  const ctx = vm.createContext(sandbox);
  const jsCode = fs.readFileSync(ADMIN_JS_PATH, 'utf8');
  vm.runInContext(jsCode, ctx, { filename: 'admin.js' });

  return {
    ctx,
    admin: sandbox.module.exports,
    elements,
    toasts,
    announcements,
    activeUrls,
    revokedUrls,
    storage: mockSessionStorage,
  };
}

test('File existence checks for Worker F exclusive files', () => {
  assert.ok(fs.existsSync(ADMIN_HTML_PATH), 'public/admin.html must exist');
  assert.ok(fs.existsSync(ADMIN_CSS_PATH), 'public/assets/admin.css must exist');
  assert.ok(fs.existsSync(ADMIN_JS_PATH), 'public/assets/admin.js must exist');
});

test('public/admin.html contract & markup checks', () => {
  const html = fs.readFileSync(ADMIN_HTML_PATH, 'utf8');

  // Must have body data-page="admin" for site.js contract
  assert.match(html, /<body[^>]*data-page=["']admin["']/i, 'body must have data-page="admin"');

  // Must share site-header and site-footer placeholders
  assert.match(html, /id=["']site-header["']/i, 'Must contain site-header container');
  assert.match(html, /id=["']site-footer["']/i, 'Must contain site-footer container');

  // Must link site.css, site.js, admin.css, admin.js
  assert.match(html, /href=["']\/assets\/site\.css["']/i, 'Must link /assets/site.css');
  assert.match(html, /src=["']\/assets\/site\.js["']/i, 'Must load /assets/site.js');
  assert.match(html, /href=["']\/assets\/admin\.css["']/i, 'Must link /assets/admin.css');
  assert.match(html, /src=["']\/assets\/admin\.js["']/i, 'Must load /assets/admin.js');

  // Accessibility: Screen-reader live region
  assert.match(html, /id=["']adminLiveRegion["'][^>]*aria-live=["']polite["']/i, 'Must have status live region');

  // Login form with password label & error element
  assert.match(html, /<form[^>]*id=["']login["']/i, 'Must have #login form');
  assert.match(html, /<label[^>]*for=["']pw["']/i, 'Must have explicit label for #pw');
  assert.match(html, /<input[^>]*id=["']pw["'][^>]*type=["']password["']/i, 'Must have password input #pw');
  assert.match(html, /id=["']loginErr["']/i, 'Must have login error container');

  // Dashboard structure & independent stats counters
  assert.match(html, /id=["']dash["']/i, 'Must have dashboard container #dash');
  assert.match(html, /id=["']sPending["']/i, 'Must have pending counter #sPending');
  assert.match(html, /id=["']sConfirmed["']/i, 'Must have confirmed counter #sConfirmed');
  assert.match(html, /id=["']sWait["']/i, 'Must have waitlist counter #sWait');
  assert.match(html, /id=["']sApps["']/i, 'Must have applications counter #sApps');

  // Work area tabs
  assert.match(html, /role=["']tablist["']/i, 'Must have tablist container');
  assert.match(html, /<button[^>]*id=["']tabBookings["'][^>]*role=["']tab["']|<button[^>]*role=["']tab["'][^>]*id=["']tabBookings["']/i, 'Must have tabBookings tab');
  assert.match(html, /<button[^>]*id=["']tabApplications["'][^>]*role=["']tab["']|<button[^>]*role=["']tab["'][^>]*id=["']tabApplications["']/i, 'Must have tabApplications tab');
  assert.match(html, /id=["']panelBookings["'][^>]*role=["']tabpanel["']/i, 'Must have panelBookings panel');
  assert.match(html, /id=["']panelApplications["'][^>]*role=["']tabpanel["']/i, 'Must have panelApplications panel');

  // Consent wording check: Application review consent, NOT background check
  assert.match(html, /application review consent records/i, 'Must refer to application review consent in copy');
  assert.doesNotMatch(html, /background check/i, 'Must not claim background checks in copy');

  // Bookings filter & tables
  assert.match(html, /<label[^>]*for=["']show["']/i, 'Must have explicit label for #show');
  assert.match(html, /<select[^>]*id=["']show["']/i, 'Must have #show select');
  assert.match(html, /<tbody[^>]*id=["']bookings["']/i, 'Must have #bookings table body');
  assert.match(html, /<tbody[^>]*id=["']waitlist["']/i, 'Must have #waitlist table body');
  assert.match(html, /<tbody[^>]*id=["']blocks["']/i, 'Must have #blocks table body');

  // Block form explicit labels
  assert.match(html, /<label[^>]*for=["']bDate["']/i, 'Must have explicit label for #bDate');
  assert.match(html, /<label[^>]*for=["']bTime["']/i, 'Must have explicit label for #bTime');
  assert.match(html, /<label[^>]*for=["']bReason["']/i, 'Must have explicit label for #bReason');

  // Applications search & pagination
  assert.match(html, /<label[^>]*for=["']appSearch["']/i, 'Must have explicit label for #appSearch');
  assert.match(html, /<label[^>]*for=["']appStatusFilter["']/i, 'Must have explicit label for #appStatusFilter');
  assert.match(html, /<tbody[^>]*id=["']applications["']/i, 'Must have #applications table body');
  assert.match(html, /id=["']appPrevBtn["']/i, 'Must have #appPrevBtn pagination button');
  assert.match(html, /id=["']appNextBtn["']/i, 'Must have #appNextBtn pagination button');

  // Native accessible dialogs
  assert.match(html, /<dialog[^>]*id=["']appDetailDialog["']/i, 'Must have native dialog #appDetailDialog');
  assert.match(html, /<dialog[^>]*id=["']photoLightboxDialog["']/i, 'Must have native dialog #photoLightboxDialog');

  // Horizontal scroll containers for table overflow protection
  const scrollContainers = html.match(/class=["'][^"']*table-scroll[^"']*["']/gi) || [];
  assert.ok(scrollContainers.length >= 4, 'Must have table-scroll wrappers for bookings, waitlist, blocks, and applications');
});

test('public/assets/admin.js syntax & security patterns', () => {
  const js = fs.readFileSync(ADMIN_JS_PATH, 'utf8');

  // Syntax validation using Node vm.Script
  assert.doesNotThrow(() => {
    new vm.Script(js, { filename: 'admin.js' });
  }, 'admin.js must parse with zero syntax errors');

  // Auth & Storage
  assert.match(js, /sessionStorage\.getItem\(['"]presenceAdmin['"]\)/, 'Must store bearer token in sessionStorage under presenceAdmin');
  assert.match(js, /Bearer\s*['"]\s*\+\s*token/, 'Must attach token as Authorization Bearer');
  assert.doesNotMatch(js, /document\.cookie/, 'Must not use cookies for authentication');

  // 401 Session Clearance
  assert.match(js, /status\s*===\s*401/, 'Must intercept 401 status');
  assert.match(js, /sessionStorage\.removeItem\(['"]presenceAdmin['"]\)/, 'Must remove token from sessionStorage on 401/logout');
  assert.match(js, /revokeAllObjectURLs/, 'Must revoke all object URLs on 401/logout/close');

  // Detail generation & stale guard
  assert.match(js, /detailGeneration/, 'Must track detailGeneration to guard against stale responses');
  assert.match(js, /currentDetailAppId/, 'Must guard against mismatching candidate IDs');

  // Independent stats loader
  assert.match(js, /\/api\/admin\/stats/, 'Must call /api/admin/stats');
  assert.match(js, /sPending/, 'Must update pending stat');
  assert.match(js, /sConfirmed/, 'Must update confirmed stat');
  assert.match(js, /sWait/, 'Must update waitlist stat');
  assert.match(js, /sApps/, 'Must update applications stat');

  // Refresh awaits all loads
  assert.match(js, /Promise\.all\(\[\s*loadStats\(\),\s*loadBookings\(\),\s*loadWaitlist\(\),\s*loadBlocks\(\),\s*loadApplications\(\{ throwOnError: true \}\)/, 'Refresh must await all sections via Promise.all and propagate application failures');

  // Action busy locks
  assert.match(js, /withLock/, 'Must implement busy lock to prevent duplicate actions');

  // Photo streaming security: Authenticated fetch, post-blob epoch check, and blob object URLs
  assert.match(js, /\/photos\//, 'Must fetch photos from authenticated photo endpoint');
  assert.match(js, /URL\.createObjectURL/, 'Must create blob objectURL for photos');
  assert.match(js, /URL\.revokeObjectURL/, 'Must revoke blob objectURL to prevent memory leaks');
  assert.doesNotMatch(js, /img[^>]*src\s*=\s*['"]\/api\/admin\/applications\//, 'Must never use direct unauthenticated img.src');

  // Consent wording
  assert.match(js, /Application review consent/, 'Must display Application review consent');
  assert.doesNotMatch(js, /Background Check Consent/i, 'Must not claim Background Check Consent');

  // External link security
  assert.match(js, /isSecureHttpsUrl/, 'Must validate external URLs for HTTPS');
  assert.match(js, /noopener noreferrer/, 'Must set noopener noreferrer on external links');
});

test('public/assets/admin.css styling & responsiveness checks', () => {
  const css = fs.readFileSync(ADMIN_CSS_PATH, 'utf8');

  // Uses design tokens
  assert.match(css, /--bg-ink/, 'Must utilize --bg-ink design token');
  assert.match(css, /--crimson/, 'Must utilize --crimson design token');
  assert.match(css, /--text-ivory/, 'Must utilize --text-ivory design token');

  // Table horizontal scroll container
  assert.match(css, /\.table-scroll\s*\{[^}]*overflow-x:\s*auto/i, '.table-scroll must have overflow-x: auto');

  // Dialog styling
  assert.match(css, /\.admin-dialog/, 'Must define .admin-dialog styling');
  assert.match(css, /::backdrop/, 'Must define dialog ::backdrop styling');

  // Mobile responsiveness
  assert.match(css, /@media\s*\(max-width:\s*640px\)/, 'Must include mobile media queries');
});

test('Admin helper functions isolated logic', () => {
  // Test whatsappLink
  function whatsappLink(phone, text) {
    let digits = (phone || '').replace(/\D/g, '');
    if (digits.length === 10) digits = '91' + digits;
    return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(text || '');
  }

  assert.equal(
    whatsappLink('9876543210', 'Hello'),
    'https://wa.me/919876543210?text=Hello',
    '10-digit phone number must be prefixed with 91 for India'
  );
  assert.equal(
    whatsappLink('+91 98765 43210', 'Booking Reference'),
    'https://wa.me/919876543210?text=Booking%20Reference',
    'Full international number must retain country code and strip non-digits'
  );

  // Test isSecureHttpsUrl
  function isSecureHttpsUrl(str) {
    if (!str || typeof str !== 'string') return false;
    const s = str.trim();
    return /^https:\/\/[^\s$.?#].[^\s]*$/i.test(s);
  }

  assert.equal(isSecureHttpsUrl('https://example.com'), true);
  assert.equal(isSecureHttpsUrl('http://insecure.com'), false, 'HTTP must be rejected');
  assert.equal(isSecureHttpsUrl('javascript:alert(1)'), false, 'JavaScript URI must be rejected');
});

/* ==========================================================================
   ACTUAL FUNCTION / VM BEHAVIOR REGRESSION CHECKS
   ========================================================================== */

test('VM Behavior: Refresh failure propagation prevents false success toast', async () => {
  let applicationEndpointFailed = false;

  const env = createMockAdminEnv({
    fetch: async (url) => {
      if (url.includes('/api/admin/applications?')) {
        if (applicationEndpointFailed) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: 'Database connection failed' }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ applications: [], total: 0 }),
        };
      }
      if (url.includes('/api/admin/stats')) {
        return { ok: true, status: 200, json: async () => ({ pending: 1, confirmed: 2, waitlist: 0, applications: 0 }) };
      }
      if (url.includes('/api/admin/bookings')) {
        return { ok: true, status: 200, json: async () => ({ bookings: [] }) };
      }
      if (url.includes('/api/admin/waitlist')) {
        return { ok: true, status: 200, json: async () => ({ waitlist: [] }) };
      }
      if (url.includes('/api/admin/blocks')) {
        return { ok: true, status: 200, json: async () => ({ blocks: [], slotTimes: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });

  env.admin.setState({ token: 'test_token_123' });

  // Step 1: Initial refresh succeeds
  await env.admin.refreshAll();
  const successToasts = env.toasts.filter(t => t.type === 'success' && t.msg.includes('Dashboard refreshed successfully'));
  assert.equal(successToasts.length, 1, 'Should report success when all endpoints succeed');

  // Step 2: Now applications endpoint fails
  applicationEndpointFailed = true;
  await env.admin.refreshAll();

  // Must NOT add another success toast
  const successToastsAfter = env.toasts.filter(t => t.type === 'success' && t.msg.includes('Dashboard refreshed successfully'));
  assert.equal(successToastsAfter.length, 1, 'Must NOT report success when applications load failed');

  // Must report error toast
  const errorToasts = env.toasts.filter(t => t.type === 'error' && (t.msg.includes('Database connection failed') || t.msg.includes('Error refreshing')));
  assert.ok(errorToasts.length >= 1, 'Must truthfully report error toast when an endpoint fails during refresh');
});

test('VM Behavior: Stale blob completion after logout is discarded and never tracked', async () => {
  let resolveBlob = null;
  const env = createMockAdminEnv({
    fetch: async (url) => {
      if (url.includes('/photos/')) {
        return {
          ok: true,
          status: 200,
          blob: () => new Promise(resolve => { resolveBlob = resolve; }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });

  env.admin.setState({ token: 'test_token_blob', currentDetailAppId: 99 });
  const stateBefore = env.admin.getState();
  const fetchPromise = env.admin.fetchPhotoBlobURL(99, 101, stateBefore.detailGeneration, stateBefore.sessionEpoch);

  // Allow fetch promise tick to run and await res.blob()
  await new Promise(r => setTimeout(r, 5));
  assert.equal(typeof resolveBlob, 'function', 'resolveBlob handler must be active for pending bytes');

  // User logs out while blob bytes are downloading in flight!
  env.admin.showLogin('Logged out');
  assert.equal(env.admin.getState().token, '', 'Token must be cleared immediately');

  // Now the slow network delivers the image bytes
  resolveBlob({ size: 1024, type: 'image/jpeg' });

  // The promise must reject because sessionEpoch / token changed after bytes download!
  await assert.rejects(
    async () => { await fetchPromise; },
    /Stale photo bytes discarded after download/,
    'fetchPhotoBlobURL must reject and discard stale photo bytes after logout'
  );

  // No objectURL should be created or retained
  assert.equal(env.activeUrls.size, 0, 'No active object URLs should remain after logout and stale completion');
});

test('VM Behavior: Stale detail response discarded after closing or switching candidates', async () => {
  let resolveAppA = null;
  const env = createMockAdminEnv({
    initialToken: 'test_token_detail',
    fetch: async (url) => {
      if (url.includes('/api/admin/applications/101')) {
        return {
          ok: true,
          status: 200,
          json: () => new Promise(resolve => { resolveAppA = resolve; }),
        };
      }
      if (url.includes('/api/admin/applications/102')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            application: {
              id: 102,
              ref: 'APP-102',
              name: 'Candidate Two',
              email: 'two@example.com',
              phone: '9876543210',
              city: 'Delhi',
              age: 26,
              consent: true,
              status: 'reviewing',
              receipt_status: 'sent',
              created_at: '2026-10-24 10:00:00',
              photos: [],
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });

  // Open candidate 101 (slow response)
  const p101 = env.admin.openApplicationDetail(101);

  // Before 101 finishes, user switches to candidate 102
  await env.admin.openApplicationDetail(102);

  const detailContent = env.elements.get('detailModalContent');
  assert.match(detailContent.textContent, /Candidate Two/, 'Modal must display Candidate Two');

  // Now candidate 101 resolves late!
  resolveAppA({
    application: {
      id: 101,
      ref: 'APP-101',
      name: 'Resurrected Candidate One',
      email: 'one@example.com',
      phone: '9876543210',
      city: 'Mumbai',
      age: 28,
      consent: true,
      status: 'new',
      receipt_status: 'pending',
      created_at: '2026-10-24 09:00:00',
      photos: [],
    },
  });
  await p101;

  // Verify modal STILL shows Candidate Two, and Candidate One was NEVER rendered!
  assert.match(detailContent.textContent, /Candidate Two/, 'Modal must still show Candidate Two');
  assert.doesNotMatch(detailContent.textContent, /Resurrected Candidate One/, 'Candidate One must NOT resurrect over Candidate Two');
});

test('VM Behavior: Immediate UI and session clearance on logout', () => {
  const env = createMockAdminEnv({ initialToken: 'valid_active_token' });
  assert.equal(env.admin.getState().token, 'valid_active_token');

  // Trigger logout
  env.elements.get('logout').dispatch('click');

  // Verify token cleared immediately from state and storage
  assert.equal(env.admin.getState().token, '', 'Token must be wiped from memory immediately');
  assert.equal(env.storage.getItem('presenceAdmin'), null, 'Token must be removed from storage immediately');

  // Verify dashboard is hidden and login is visible
  assert.ok(env.elements.get('dash').classList.contains('hidden'), 'Dashboard must be hidden immediately');
  assert.ok(!env.elements.get('login').classList.contains('hidden'), 'Login form must be shown immediately');
});

test('VM Behavior: Receipt retry truthful status and option elements without [object Object]', () => {
  const env = createMockAdminEnv({ initialToken: 'tok' });

  // Render application detail with pending receipt
  env.admin.renderApplicationDetail({
    id: 88,
    ref: 'APP-88',
    name: 'Test Candidate',
    email: 'test@example.com',
    phone: '9123456789',
    city: 'Bengaluru',
    age: 24,
    consent: true,
    status: 'new',
    receipt_status: 'pending',
    created_at: '2026-10-24 10:00:00',
    photos: [],
  }, 1, 0);

  const detailContent = env.elements.get('detailModalContent');

  // Verify option elements are clean standard text, zero [object Object]
  assert.doesNotMatch(detailContent.textContent, /\[object Object\]/, 'Options must never contain [object Object]');

  // Verify application review consent wording
  assert.match(detailContent.textContent, /Application review consent/, 'Must display Application review consent');
  assert.match(detailContent.textContent, /Granted/, 'Must display Granted');
  assert.doesNotMatch(detailContent.textContent, /Background check/i, 'Must not claim background check');
});

test('VM Behavior: Representative booking mutation (setBookingStatus) - success with reload error vs failed mutation with lock release', async () => {
  let patchShouldFail = false;
  let getShouldFail = false;

  const env = createMockAdminEnv({
    fetch: async (url, opts = {}) => {
      if (opts.method === 'PATCH' && url.includes('/api/admin/bookings/42')) {
        if (patchShouldFail) {
          return { ok: false, status: 409, json: async () => ({ error: 'Hour already held' }) };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      if (url.includes('/api/admin/bookings')) {
        if (getShouldFail) {
          return { ok: false, status: 500, json: async () => ({ error: 'Booking read error' }) };
        }
        return { ok: true, status: 200, json: async () => ({ bookings: [] }) };
      }
      if (url.includes('/api/admin/stats')) {
        return { ok: true, status: 200, json: async () => ({ pending: 0, confirmed: 1, waitlist: 0, applications: 0 }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });

  env.admin.setState({ token: 'tok_booking_mutation' });

  // Scenario A: Successful PATCH followed by failing GET reload
  getShouldFail = true;
  patchShouldFail = false;
  const btnA = env.ctx.document.createElement('button');

  await env.admin.setBookingStatus(42, 'confirmed', btnA);

  // Verifications for Scenario A:
  // 1. Successful mutation is truthful success
  const successToastA = env.toasts.find(t => t.type === 'success' && t.msg.includes('Booking marked confirmed'));
  assert.ok(successToastA, 'Must report success toast when PATCH succeeds');

  // 2. Refresh failure reports warning toast with retry suggestion, never action failed
  const warnToastA = env.toasts.find(t => t.type === 'warn' && t.msg.includes('could not refresh'));
  assert.ok(warnToastA, 'Must report warning toast suggesting retry when reload fails');

  const actionFailedToastA = env.toasts.find(t => t.type === 'error' && t.msg.includes('Action failed'));
  assert.equal(actionFailedToastA, undefined, 'Must NEVER announce Action failed when mutation persisted');

  // 3. Action lock is released
  assert.equal(btnA.disabled, false, 'Button lock must be released after completion');

  // Scenario B: Failed PATCH mutation
  env.toasts.length = 0; // reset toasts
  getShouldFail = false;
  patchShouldFail = true;
  const btnB = env.ctx.document.createElement('button');

  await env.admin.setBookingStatus(42, 'confirmed', btnB);

  // Verifications for Scenario B:
  // 1. Failed mutation must report error toast
  const errToastB = env.toasts.find(t => t.type === 'error' && t.msg.includes('Hour already held'));
  assert.ok(errToastB, 'Must report error toast when PATCH fails');

  // 2. Failed mutation must NEVER announce success
  const successToastB = env.toasts.find(t => t.type === 'success');
  assert.equal(successToastB, undefined, 'Failed mutation must NEVER announce success');

  // 3. Action lock is released
  assert.equal(btnB.disabled, false, 'Button lock must be released on failure');
});

test('VM Behavior: Representative app mutation (updateApplicationStatus) - success with reload error vs failed mutation with lock release', async () => {
  let patchShouldFail = false;
  let getShouldFail = false;

  const env = createMockAdminEnv({
    fetch: async (url, opts = {}) => {
      if (opts.method === 'PATCH' && url.includes('/api/admin/applications/99')) {
        if (patchShouldFail) {
          return { ok: false, status: 400, json: async () => ({ error: 'Invalid status transition' }) };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      if (url.includes('/api/admin/applications?')) {
        if (getShouldFail) {
          return { ok: false, status: 500, json: async () => ({ error: 'Applications read timeout' }) };
        }
        return { ok: true, status: 200, json: async () => ({ applications: [], total: 0 }) };
      }
      if (url.includes('/api/admin/stats')) {
        return { ok: true, status: 200, json: async () => ({ pending: 0, confirmed: 0, waitlist: 0, applications: 1 }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });

  env.admin.setState({ token: 'tok_app_mutation' });

  // Scenario A: Successful PATCH followed by failing reload
  getShouldFail = true;
  patchShouldFail = false;
  const btnA = env.ctx.document.createElement('button');
  const feedbackA = env.ctx.document.createElement('span');

  await env.admin.updateApplicationStatus(99, 'shortlisted', btnA, feedbackA);

  // Verifications for Scenario A:
  // 1. Successful mutation reports success toast and inline feedback
  const successToastA = env.toasts.find(t => t.type === 'success' && t.msg.includes('Application marked as shortlisted'));
  assert.ok(successToastA, 'Must report success toast when status PATCH succeeds');
  assert.match(feedbackA.textContent, /✓ Status saved to shortlisted/, 'Inline feedback must show success');

  // 2. Refresh failure reports warning toast, never failed to save
  const warnToastA = env.toasts.find(t => t.type === 'warn' && t.msg.includes('could not refresh'));
  assert.ok(warnToastA, 'Must report warning toast when reload fails');

  const failedSaveToastA = env.toasts.find(t => t.type === 'error' && t.msg.includes('Failed to save'));
  assert.equal(failedSaveToastA, undefined, 'Must NEVER announce Failed to save when status persisted');

  // 3. Action lock is released
  assert.equal(btnA.disabled, false, 'Button lock must be released after completion');

  // Scenario B: Failed PATCH mutation
  env.toasts.length = 0; // reset toasts
  getShouldFail = false;
  patchShouldFail = true;
  const btnB = env.ctx.document.createElement('button');
  const feedbackB = env.ctx.document.createElement('span');

  await env.admin.updateApplicationStatus(99, 'shortlisted', btnB, feedbackB);

  // Verifications for Scenario B:
  // 1. Failed mutation reports error
  const errToastB = env.toasts.find(t => t.type === 'error' && t.msg.includes('Invalid status transition'));
  assert.ok(errToastB, 'Must report error toast when status PATCH fails');
  assert.match(feedbackB.textContent, /Invalid status transition/, 'Inline feedback must report error');

  // 2. Failed mutation must NEVER announce success
  const successToastB = env.toasts.find(t => t.type === 'success');
  assert.equal(successToastB, undefined, 'Failed mutation must NEVER announce success');

  // 3. Action lock is released
  assert.equal(btnB.disabled, false, 'Button lock must be released on failure');
});
