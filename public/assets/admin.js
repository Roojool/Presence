/**
 * Presence. — Admin Portal Client Script (Worker F)
 * Plain JS, zero dependencies, responsive dark administration.
 * Maintains authentication, bookings, waitlist, blocks, stats,
 * and fashion & brand candidate recruit applications with private photo streaming.
 */

(function () {
  'use strict';

  // State & Epochs
  let token = sessionStorage.getItem('presenceAdmin') || '';
  let sessionEpoch = 0;
  let detailGeneration = 0;
  let currentDetailAppId = null;
  let searchEpoch = 0;
  const activeObjectURLs = new Set();
  const inFlightActions = new Set();

  let currentTab = 'bookings';
  let appSearchQuery = '';
  let appStatusFilter = '';
  let appOffset = 0;
  const appLimit = 50;
  let appTotal = 0;
  let detailTriggerEl = null;
  let lightboxTriggerEl = null;

  // DOM Elements
  const $ = id => document.getElementById(id);
  const loginForm = $('login');
  const loginView = $('login');
  const dashView = $('dash');
  const pwInput = $('pw');
  const loginErr = $('loginErr');
  const logoutBtn = $('logout');
  const refreshBtn = $('refresh');

  const sPending = $('sPending');
  const sConfirmed = $('sConfirmed');
  const sWait = $('sWait');
  const sApps = $('sApps');
  const appTabBadge = $('appTabBadge');

  const tabBookings = $('tabBookings');
  const tabApplications = $('tabApplications');
  const panelBookings = $('panelBookings');
  const panelApplications = $('panelApplications');

  const showFilter = $('show');
  const bookingsBody = $('bookings');
  const waitlistBody = $('waitlist');
  const blocksBody = $('blocks');
  const blockForm = $('blockForm');
  const bDate = $('bDate');
  const bTime = $('bTime');
  const bReason = $('bReason');

  const appFilterForm = $('appFilterForm');
  const appSearch = $('appSearch');
  const appStatusSelect = $('appStatusFilter');
  const appResetBtn = $('appResetBtn');
  const appResultsCount = $('appResultsCount');
  const appsBody = $('applications');
  const appPrevBtn = $('appPrevBtn');
  const appNextBtn = $('appNextBtn');
  const appPageInfo = $('appPageInfo');

  const appDetailDialog = $('appDetailDialog');
  const closeDetailBtn = $('closeDetailModal');
  const detailModalContent = $('detailModalContent');

  const photoLightboxDialog = $('photoLightboxDialog');
  const closeLightboxBtn = $('closeLightbox');
  const lightboxImg = $('lightboxImg');

  const liveRegion = $('adminLiveRegion');

  // Helper: Live Region Announcement
  function announce(msg) {
    if (liveRegion) liveRegion.textContent = msg;
  }

  // Helper: Toast Notifications
  function toast(msg, type) {
    if (!type) type = 'info';
    if (window.PresenceUI && typeof window.PresenceUI.toast === 'function') {
      window.PresenceUI.toast(msg, type, 4000);
      return;
    }
    const t = $('toast');
    if (t) {
      t.textContent = msg;
      t.className = 'toast show ' + type;
      clearTimeout(t._timer);
      t._timer = setTimeout(() => {
        t.className = 'toast';
      }, 3500);
    }
  }

  // Helper: Safe Text Creation
  function el(tag, props = {}, ...children) {
    const elem = document.createElement(tag);
    for (const [key, val] of Object.entries(props)) {
      if (key === 'class' || key === 'className') elem.className = val;
      else if (key.startsWith('on') && typeof val === 'function') {
        elem.addEventListener(key.slice(2).toLowerCase(), val);
      } else if (key === 'textContent') {
        elem.textContent = val;
      } else if (val != null) {
        elem.setAttribute(key, String(val));
      }
    }
    for (const child of children) {
      if (child == null) continue;
      if (typeof child === 'string' || typeof child === 'number') {
        elem.append(document.createTextNode(String(child)));
      } else {
        elem.append(child);
      }
    }
    return elem;
  }

  // Validation & Formatting Helpers
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function prettyDate(iso) {
    if (!iso || typeof iso !== 'string') return '—';
    const parts = iso.split('-').map(Number);
    if (parts.length < 3 || isNaN(parts[0])) return iso;
    const dt = new Date(parts[0], parts[1] - 1, parts[2]);
    return WD[dt.getDay()] + ' ' + parts[2] + ' ' + dt.toLocaleString('en-GB', { month: 'short' }) + ' ' + parts[0];
  }

  function prettyDateTime(val) {
    if (!val) return '—';
    try {
      const dt = new Date(val);
      if (isNaN(dt.getTime())) return String(val);
      return dt.toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch (_) {
      return String(val);
    }
  }

  function whatsappLink(phone, text) {
    let digits = (phone || '').replace(/\D/g, '');
    if (digits.length === 10) digits = '91' + digits;
    return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(text || '');
  }

  function isSecureHttpsUrl(str) {
    if (!str || typeof str !== 'string') return false;
    const s = str.trim();
    return /^https:\/\/[^\s$.?#].[^\s]*$/i.test(s);
  }

  // ObjectURL Memory & Privacy Lifecycle
  function trackObjectURL(url) {
    activeObjectURLs.add(url);
    return url;
  }

  function revokeAllObjectURLs() {
    activeObjectURLs.forEach(url => {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
    });
    activeObjectURLs.clear();
  }

  // Action Busy Lock Guard
  async function withLock(actionKey, buttonEl, taskFn) {
    if (inFlightActions.has(actionKey)) return;
    inFlightActions.add(actionKey);
    if (buttonEl) {
      buttonEl.disabled = true;
      buttonEl.setAttribute('aria-busy', 'true');
    }
    try {
      await taskFn();
    } finally {
      inFlightActions.delete(actionKey);
      if (buttonEl) {
        buttonEl.disabled = false;
        buttonEl.removeAttribute('aria-busy');
      }
    }
  }

  // Authenticated API Fetcher
  async function api(path, opts = {}) {
    const epochSnapshot = sessionEpoch;
    const headers = {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    };
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }

    const res = await fetch(path, {
      ...opts,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    if (res.status === 401 && path !== '/api/admin/login') {
      showLogin('Your session has expired. Please log in again.');
      throw new Error('Please log in again');
    }

    const data = await res.json().catch(() => ({}));

    // Discard stale responses if session epoch changed (logout or session reset)
    if (epochSnapshot !== sessionEpoch && path !== '/api/admin/login') {
      throw new Error('Stale response discarded');
    }

    if (!res.ok) {
      throw new Error(data.error || 'Request failed (' + res.status + ')');
    }

    return data;
  }

  // Authenticated Photo Streaming Fetcher with Double-Epoch and Generation Guard
  async function fetchPhotoBlobURL(appId, photoId, detailGen, expectedEpoch) {
    const targetEpoch = expectedEpoch !== undefined ? expectedEpoch : sessionEpoch;
    const targetGen = detailGen !== undefined ? detailGen : detailGeneration;

    if (targetEpoch !== sessionEpoch || !token) {
      throw new Error('Stale photo request discarded');
    }
    if (detailGen !== undefined && targetGen !== detailGeneration) {
      throw new Error('Stale detail request discarded');
    }
    if (currentDetailAppId !== null && currentDetailAppId !== appId) {
      throw new Error('Stale detail request discarded');
    }

    const res = await fetch(`/api/admin/applications/${appId}/photos/${photoId}`, {
      headers: {
        Authorization: 'Bearer ' + token,
      },
    });

    if (res.status === 401) {
      showLogin('Your session has expired. Please log in again.');
      throw new Error('Please log in again');
    }

    if (targetEpoch !== sessionEpoch || !token) {
      throw new Error('Stale photo request discarded');
    }
    if (detailGen !== undefined && targetGen !== detailGeneration) {
      throw new Error('Stale detail request discarded');
    }
    if (currentDetailAppId !== null && currentDetailAppId !== appId) {
      throw new Error('Stale detail request discarded');
    }

    if (!res.ok) {
      throw new Error('Failed to load candidate photo');
    }

    const blob = await res.blob();

    // Recheck epoch/token after bytes load and before creating/tracking objectURL
    if (targetEpoch !== sessionEpoch || !token) {
      throw new Error('Stale photo bytes discarded after download');
    }
    if (detailGen !== undefined && targetGen !== detailGeneration) {
      throw new Error('Stale photo bytes discarded after download');
    }
    if (currentDetailAppId !== null && currentDetailAppId !== appId) {
      throw new Error('Stale photo bytes discarded after download');
    }

    const objectUrl = URL.createObjectURL(blob);
    return trackObjectURL(objectUrl);
  }

  // Session & Authentication Handling
  function clearPrivateData() {
    detailGeneration++;
    currentDetailAppId = null;

    if (bookingsBody) bookingsBody.replaceChildren();
    if (waitlistBody) waitlistBody.replaceChildren();
    if (blocksBody) blocksBody.replaceChildren();
    if (appsBody) appsBody.replaceChildren();

    if (sPending) sPending.textContent = '–';
    if (sConfirmed) sConfirmed.textContent = '–';
    if (sWait) sWait.textContent = '–';
    if (sApps) sApps.textContent = '–';
    if (appTabBadge) appTabBadge.textContent = '0';

    if (appDetailDialog && appDetailDialog.open) {
      appDetailDialog.close();
    }
    if (photoLightboxDialog && photoLightboxDialog.open) {
      photoLightboxDialog.close();
    }
    if (detailModalContent) detailModalContent.replaceChildren();
    if (lightboxImg) lightboxImg.src = '';

    if (appSearch) appSearch.value = '';
    if (appStatusSelect) appStatusSelect.value = '';
    appSearchQuery = '';
    appStatusFilter = '';
    appOffset = 0;
    appTotal = 0;
  }

  function showLogin(reason) {
    sessionEpoch++;
    detailGeneration++;
    currentDetailAppId = null;
    token = '';
    sessionStorage.removeItem('presenceAdmin');
    revokeAllObjectURLs();
    clearPrivateData();

    if (dashView) dashView.classList.add('hidden');
    if (loginView) loginView.classList.remove('hidden');

    if (loginErr) {
      loginErr.textContent = reason || '';
    }
    if (reason) {
      announce(reason);
    }
    if (pwInput) {
      pwInput.value = '';
      setTimeout(() => pwInput.focus(), 50);
    }
  }

  function showDash() {
    if (loginView) loginView.classList.add('hidden');
    if (dashView) dashView.classList.remove('hidden');
    if (loginErr) loginErr.textContent = '';
    setTab('bookings');
    refreshAll();
  }

  // Tab Navigation Handling
  function setTab(tab) {
    currentTab = tab;
    const isBookings = tab === 'bookings';

    if (tabBookings) {
      tabBookings.classList.toggle('is-active', isBookings);
      tabBookings.setAttribute('aria-selected', String(isBookings));
    }
    if (tabApplications) {
      tabApplications.classList.toggle('is-active', !isBookings);
      tabApplications.setAttribute('aria-selected', String(!isBookings));
    }

    if (panelBookings) {
      panelBookings.classList.toggle('hidden', !isBookings);
    }
    if (panelApplications) {
      panelApplications.classList.toggle('hidden', isBookings);
    }
  }

  if (tabBookings) {
    tabBookings.addEventListener('click', () => setTab('bookings'));
  }
  if (tabApplications) {
    tabApplications.addEventListener('click', () => {
      setTab('applications');
      if (!appsBody.children.length) {
        loadApplications().catch(err => toast(err.message, 'error'));
      }
    });
  }

  // Refresh All Data (Fix: Propagated failure, reports success ONLY when all succeed for current session)
  async function refreshAll() {
    const epochSnapshot = sessionEpoch;
    await withLock('refresh_all', refreshBtn, async () => {
      announce('Refreshing dashboard data...');
      try {
        await Promise.all([
          loadStats(),
          loadBookings(),
          loadWaitlist(),
          loadBlocks(),
          loadApplications({ throwOnError: true }),
        ]);
        if (epochSnapshot !== sessionEpoch || !token) return;
        toast('Dashboard refreshed successfully', 'success');
        announce('Dashboard refreshed successfully');
      } catch (err) {
        if (epochSnapshot !== sessionEpoch || !token) return;
        toast(err.message || 'Error refreshing dashboard', 'error');
        announce('Refresh error: ' + (err.message || 'failed'));
      }
    });
  }

  // Independent Counters Loader (GET /api/admin/stats)
  async function loadStats() {
    const epochSnapshot = sessionEpoch;
    const stats = await api('/api/admin/stats');
    if (epochSnapshot !== sessionEpoch || !token) return;

    const pending = typeof stats.pending === 'number' ? stats.pending : 0;
    const confirmed = typeof stats.confirmed === 'number' ? stats.confirmed : 0;
    const waitlist = typeof stats.waitlist === 'number' ? stats.waitlist : 0;
    const applications = typeof stats.applications === 'number' ? stats.applications : 0;

    if (sPending) sPending.textContent = pending;
    if (sConfirmed) sConfirmed.textContent = confirmed;
    if (sWait) sWait.textContent = waitlist;
    if (sApps) sApps.textContent = applications;
    if (appTabBadge) appTabBadge.textContent = applications;
  }

  // Existing Bookings Section
  async function loadBookings() {
    const epochSnapshot = sessionEpoch;
    const showVal = showFilter ? showFilter.value : 'upcoming';

    if (bookingsBody) {
      bookingsBody.replaceChildren(
        el('tr', {}, el('td', { class: 'table-loading', colspan: '5' }, 'Loading bookings...'))
      );
    }

    const { bookings } = await api('/api/admin/bookings?show=' + encodeURIComponent(showVal));
    if (epochSnapshot !== sessionEpoch || !token) return;

    bookingsBody.replaceChildren();
    if (!bookings || !bookings.length) {
      bookingsBody.append(
        el('tr', {}, el('td', { class: 'table-empty', colspan: '5' }, 'No bookings yet. They will appear here the moment someone books.'))
      );
      return;
    }

    for (const b of bookings) {
      const msg = `Hi ${b.name}! This is Presence. Your hour on ${prettyDate(b.date)} at ${b.time} (${b.practice}) is confirmed. Reference ${b.ref}.`;
      const waUrl = whatsappLink(b.contact, msg);

      const tr = el('tr', { id: 'booking-row-' + b.id });

      // When Column
      const whenTd = el('td', { class: 'td-when' },
        el('strong', { textContent: prettyDate(b.date) }),
        el('br'),
        document.createTextNode(b.time || ''),
        el('br'),
        el('span', { class: 'text-muted', style: 'font-size:0.8rem', textContent: b.ref || '' })
      );

      // Who Column
      const whoTd = el('td', { class: 'td-who' },
        el('span', { style: 'font-weight:600', textContent: b.name || '' }),
        el('br'),
        el('a', {
          href: waUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          class: 'wa-link',
          textContent: (b.contact || '') + ' (WhatsApp ↗)',
        })
      );

      // Practice / Request Column
      const practiceTd = el('td', {},
        el('div', { style: 'font-weight:600', textContent: b.practice || '—' }),
        el('div', { class: 'td-req', textContent: b.request || '—' })
      );

      // Status Column
      const statusTag = el('span', { class: 'tag tag-' + b.status, textContent: b.status });
      const statusTd = el('td', {}, statusTag);
      if (b.payment_status && b.payment_status !== 'none') {
        const payTag = el('span', {
          class: 'tag ' + (b.payment_status === 'paid' ? 'tag-paid' : 'tag-awaiting'),
          textContent: b.payment_status === 'paid' ? 'deposit paid' : 'not paid',
        });
        statusTd.append(el('div', { style: 'margin-top:6px' }, payTag));
      }

      // Actions Column
      const actionsDiv = el('div', { class: 'action-row' });

      if (b.status !== 'confirmed') {
        const confirmBtn = el('button', {
          type: 'button',
          class: 'btn btn-sm btn-ok',
          textContent: 'Confirm',
          onclick: () => setBookingStatus(b.id, 'confirmed', confirmBtn),
        });
        actionsDiv.append(confirmBtn);
      }

      if (b.status !== 'cancelled') {
        const cancelBtn = el('button', {
          type: 'button',
          class: 'btn btn-sm btn-ghost',
          textContent: 'Cancel',
          onclick: () => setBookingStatus(b.id, 'cancelled', cancelBtn),
        });
        actionsDiv.append(cancelBtn);
      }

      if (b.status === 'cancelled') {
        const deleteBtn = el('button', {
          type: 'button',
          class: 'btn btn-sm btn-ghost',
          style: 'color:var(--crimson-bright)',
          textContent: 'Delete',
          onclick: () => deleteBooking(b.id, deleteBtn),
        });
        actionsDiv.append(deleteBtn);
      }

      const actionsTd = el('td', { class: 'td-actions' }, actionsDiv);

      tr.append(whenTd, whoTd, practiceTd, statusTd, actionsTd);
      bookingsBody.append(tr);
    }
  }

  async function setBookingStatus(bookingId, status, buttonEl) {
    await withLock('booking_status_' + bookingId, buttonEl, async () => {
      try {
        await api('/api/admin/bookings/' + bookingId, {
          method: 'PATCH',
          body: { status },
        });
      } catch (err) {
        toast(err.message, 'error');
        announce('Action failed: ' + err.message);
        return;
      }

      toast('Booking marked ' + status, 'success');
      announce('Booking marked ' + status);

      try {
        await Promise.all([loadBookings(), loadStats()]);
      } catch (err) {
        toast('Booking marked ' + status + ', but could not refresh. Retry refresh from dashboard.', 'warn');
        announce('Booking marked ' + status + ', but could not refresh.');
      }
    });
  }

  async function deleteBooking(bookingId, buttonEl) {
    if (!window.confirm('Delete this cancelled booking forever?')) return;
    await withLock('delete_booking_' + bookingId, buttonEl, async () => {
      try {
        await api('/api/admin/bookings/' + bookingId, { method: 'DELETE' });
      } catch (err) {
        toast(err.message, 'error');
        announce('Delete failed: ' + err.message);
        return;
      }

      toast('Booking deleted forever', 'info');
      announce('Booking deleted');

      try {
        await Promise.all([loadBookings(), loadStats()]);
      } catch (err) {
        toast('Booking deleted, but could not refresh. Retry refresh from dashboard.', 'warn');
        announce('Booking deleted, but could not refresh.');
      }
    });
  }

  // Waitlist Section
  async function loadWaitlist() {
    const epochSnapshot = sessionEpoch;
    if (waitlistBody) {
      waitlistBody.replaceChildren(
        el('tr', {}, el('td', { class: 'table-loading', colspan: '4' }, 'Loading waitlist...'))
      );
    }

    const { waitlist } = await api('/api/admin/waitlist');
    if (epochSnapshot !== sessionEpoch || !token) return;

    waitlistBody.replaceChildren();
    if (!waitlist || !waitlist.length) {
      waitlistBody.append(
        el('tr', {}, el('td', { class: 'table-empty', colspan: '4' }, 'Nobody on the waitlist.'))
      );
      return;
    }

    for (const w of waitlist) {
      const msg = `Hi ${w.name}! This is Presence. Good news — ${prettyDate(w.date)} at ${w.time} has opened up. Want it?`;
      const waUrl = whatsappLink(w.contact, msg);

      const tr = el('tr', { id: 'waitlist-row-' + w.id });

      const wantsTd = el('td', { class: 'td-when' },
        el('strong', { textContent: prettyDate(w.date) }),
        document.createTextNode(' · ' + (w.time || ''))
      );

      const whoTd = el('td', { class: 'td-who' },
        el('span', { style: 'font-weight:600', textContent: w.name || '' }),
        el('br'),
        el('a', {
          href: waUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          class: 'wa-link',
          textContent: (w.contact || '') + ' (WhatsApp ↗)',
        })
      );

      const addedTd = el('td', { class: 'text-muted', style: 'font-size:0.85rem', textContent: prettyDateTime(w.created_at) });

      const removeBtn = el('button', {
        type: 'button',
        class: 'btn btn-sm btn-ghost',
        textContent: 'Remove',
        onclick: () => removeWaitlist(w.id, removeBtn),
      });
      const actionsTd = el('td', { class: 'td-actions' }, removeBtn);

      tr.append(wantsTd, whoTd, addedTd, actionsTd);
      waitlistBody.append(tr);
    }
  }

  async function removeWaitlist(waitlistId, buttonEl) {
    await withLock('waitlist_remove_' + waitlistId, buttonEl, async () => {
      try {
        await api('/api/admin/waitlist/' + waitlistId, { method: 'DELETE' });
      } catch (err) {
        toast(err.message, 'error');
        announce('Remove failed: ' + err.message);
        return;
      }

      toast('Waitlist entry removed', 'info');
      announce('Waitlist entry removed');

      try {
        await Promise.all([loadWaitlist(), loadStats()]);
      } catch (err) {
        toast('Waitlist entry removed, but could not refresh. Retry refresh from dashboard.', 'warn');
        announce('Waitlist entry removed, but could not refresh.');
      }
    });
  }

  // Blocks Section
  async function loadBlocks() {
    const epochSnapshot = sessionEpoch;
    if (blocksBody) {
      blocksBody.replaceChildren(
        el('tr', {}, el('td', { class: 'table-loading', colspan: '3' }, 'Loading calendar blocks...'))
      );
    }

    const { blocks, slotTimes } = await api('/api/admin/blocks');
    if (epochSnapshot !== sessionEpoch || !token) return;

    if (bTime && bTime.options.length === 1 && Array.isArray(slotTimes)) {
      for (const t of slotTimes) {
        bTime.append(el('option', { value: t, textContent: 'Only ' + t }));
      }
    }

    blocksBody.replaceChildren();
    if (!blocks || !blocks.length) {
      blocksBody.append(
        el('tr', {}, el('td', { class: 'table-empty', colspan: '3' }, 'Nothing blocked.'))
      );
      return;
    }

    for (const b of blocks) {
      const tr = el('tr', { id: 'block-row-' + b.id });

      const whenTd = el('td', { class: 'td-when' },
        el('strong', { textContent: prettyDate(b.date) }),
        document.createTextNode(' · ' + (b.time ? b.time : 'whole day'))
      );

      const reasonTd = el('td', { class: 'text-muted', textContent: b.reason ? b.reason : '—' });

      const unblockBtn = el('button', {
        type: 'button',
        class: 'btn btn-sm btn-ghost',
        textContent: 'Unblock',
        onclick: () => deleteBlock(b.id, unblockBtn),
      });
      const actionsTd = el('td', { class: 'td-actions text-right' }, unblockBtn);

      tr.append(whenTd, reasonTd, actionsTd);
      blocksBody.append(tr);
    }
  }

  async function deleteBlock(blockId, buttonEl) {
    await withLock('delete_block_' + blockId, buttonEl, async () => {
      try {
        await api('/api/admin/blocks/' + blockId, { method: 'DELETE' });
      } catch (err) {
        toast(err.message, 'error');
        announce('Unblock failed: ' + err.message);
        return;
      }

      toast('Date unblocked', 'info');
      announce('Date unblocked');

      try {
        await loadBlocks();
      } catch (err) {
        toast('Date unblocked, but could not refresh. Retry refresh from dashboard.', 'warn');
        announce('Date unblocked, but could not refresh.');
      }
    });
  }

  // Applications Work Area (Search, Filter, Server Pagination, with Propagated Failure)
  async function loadApplications(opts = {}) {
    const { throwOnError = false } = opts;
    const epochSnapshot = sessionEpoch;
    const currentSearchEpoch = ++searchEpoch;

    if (appsBody) {
      appsBody.replaceChildren(
        el('tr', {}, el('td', { class: 'table-loading', colspan: '7' }, 'Loading applications...'))
      );
    }
    if (appResultsCount) {
      appResultsCount.textContent = 'Searching candidates...';
    }

    const params = new URLSearchParams({
      search: appSearchQuery,
      status: appStatusFilter,
      limit: String(appLimit),
      offset: String(appOffset),
    });

    try {
      const data = await api('/api/admin/applications?' + params.toString());
      if (epochSnapshot !== sessionEpoch || currentSearchEpoch !== searchEpoch || !token) return;

      const applications = data.applications || [];
      appTotal = typeof data.total === 'number' ? data.total : applications.length;

      // Update Pagination UI
      updatePaginationControls();

      appsBody.replaceChildren();
      if (!applications.length) {
        appsBody.append(
          el('tr', {}, el('td', { class: 'table-empty', colspan: '7' }, 'No candidate applications found matching criteria.'))
        );
        return;
      }

      for (const app of applications) {
        const tr = el('tr', { id: 'app-row-' + app.id });

        // Ref Column
        const refTd = el('td', { class: 'td-when' },
          el('strong', { textContent: app.ref || '—' }),
          el('br'),
          el('span', { class: 'text-muted', style: 'font-size:0.75rem', textContent: '#' + app.id })
        );

        // Candidate Column
        const candidateTd = el('td', { class: 'td-who' },
          el('span', { style: 'font-weight:600', textContent: app.name || 'Anonymous' }),
          el('br'),
          el('span', { class: 'text-muted', style: 'font-size:0.8rem', textContent: `${app.age ? app.age + ' yrs' : '—'} · ${app.city || '—'}` })
        );

        // Contact Column
        const appMsg = `Hi ${app.name}! This is Presence regarding your model inquiry ${app.ref}.`;
        const waUrl = whatsappLink(app.phone, appMsg);

        const contactTd = el('td', {},
          el('span', { style: 'font-size:0.85rem', textContent: app.email || '—' }),
          el('br'),
          el('a', {
            href: waUrl,
            target: '_blank',
            rel: 'noopener noreferrer',
            class: 'wa-link',
            textContent: (app.phone || '—') + ' (WhatsApp ↗)',
          })
        );

        // Status Column
        const statusTd = el('td', {},
          el('span', { class: 'tag tag-' + (app.status || 'new'), textContent: app.status || 'new' })
        );

        // Receipt Column
        const receiptTd = el('td', {},
          el('span', {
            class: 'tag tag-receipt-' + (app.receipt_status || 'pending'),
            textContent: 'WhatsApp',
          })
        );

        // Submitted Column
        const submittedTd = el('td', {
          class: 'text-muted',
          style: 'font-size:0.82rem',
          textContent: prettyDateTime(app.created_at),
        });

        // Actions Column
        const reviewBtn = el('button', {
          type: 'button',
          class: 'btn btn-sm btn-secondary',
          textContent: 'Review Profile ↗',
          onclick: () => openApplicationDetail(app.id, reviewBtn),
        });
        const actionsTd = el('td', { class: 'td-actions' }, reviewBtn);

        tr.append(refTd, candidateTd, contactTd, statusTd, receiptTd, submittedTd, actionsTd);
        appsBody.append(tr);
      }
    } catch (err) {
      if (epochSnapshot !== sessionEpoch || currentSearchEpoch !== searchEpoch) return;
      if (appsBody) {
        appsBody.replaceChildren(
          el('tr', {}, el('td', { class: 'table-empty', colspan: '7' }, 'Failed to load applications: ' + err.message))
        );
      }
      if (appResultsCount) appResultsCount.textContent = 'Error loading applications';
      if (throwOnError) throw err;
    }
  }

  function updatePaginationControls() {
    if (!appResultsCount || !appPageInfo || !appPrevBtn || !appNextBtn) return;

    if (appTotal === 0) {
      appResultsCount.textContent = '0 candidates';
      appPageInfo.textContent = 'Page 1 of 1';
      appPrevBtn.disabled = true;
      appNextBtn.disabled = true;
      return;
    }

    const startIdx = appOffset + 1;
    const endIdx = Math.min(appOffset + appLimit, appTotal);
    appResultsCount.textContent = `Showing ${startIdx}–${endIdx} of ${appTotal} candidates`;

    const currentPage = Math.floor(appOffset / appLimit) + 1;
    const totalPages = Math.ceil(appTotal / appLimit) || 1;
    appPageInfo.textContent = `Page ${currentPage} of ${totalPages}`;

    appPrevBtn.disabled = appOffset <= 0;
    appNextBtn.disabled = appOffset + appLimit >= appTotal;
  }

  // Application Detail Modal Logic with Strict Generation & ID Guard
  async function openApplicationDetail(appId, triggeringEl) {
    const myDetailGen = ++detailGeneration;
    currentDetailAppId = appId;
    const myEpoch = sessionEpoch;
    detailTriggerEl = triggeringEl;
    revokeAllObjectURLs();

    if (detailModalContent) {
      detailModalContent.replaceChildren(
        el('div', { style: 'text-align:center;padding:40px;', class: 'text-muted' }, 'Loading full candidate profile...')
      );
    }

    if (appDetailDialog && typeof appDetailDialog.showModal === 'function') {
      if (!appDetailDialog.open) appDetailDialog.showModal();
    }

    try {
      const data = await api('/api/admin/applications/' + appId);
      if (myDetailGen !== detailGeneration || currentDetailAppId !== appId || myEpoch !== sessionEpoch || !token) {
        return; // Discard stale detail response
      }
      const app = data.application;
      if (!app) throw new Error('Application details not found');

      renderApplicationDetail(app, myDetailGen, myEpoch);
    } catch (err) {
      if (myDetailGen !== detailGeneration || currentDetailAppId !== appId || myEpoch !== sessionEpoch || !token) {
        return;
      }
      if (detailModalContent) {
        detailModalContent.replaceChildren(
          el('div', { class: 'field-error', style: 'padding:24px;text-align:center;' }, err.message || 'Error loading profile')
        );
      }
    }
  }

  function renderApplicationDetail(app, myDetailGen, myEpoch) {
    if (!detailModalContent) return;
    detailModalContent.replaceChildren();

    const grid = el('div', { class: 'detail-grid' });

    // Left Column: Profile Information
    const leftCol = el('div', { class: 'detail-left-col' });

    leftCol.append(el('h4', { class: 'detail-section-title', textContent: 'Applicant Overview' }));

    const kvList = el('div', { class: 'detail-kv-list' });

    // Name & Ref
    kvList.append(
      el('div', { class: 'detail-kv-item' },
        el('span', { class: 'detail-k', textContent: 'Full Name' }),
        el('span', { class: 'detail-v', style: 'font-size:1.15rem;font-weight:700', textContent: app.name || '—' })
      ),
      el('div', { class: 'detail-kv-item' },
        el('span', { class: 'detail-k', textContent: 'Application Ref' }),
        el('span', { class: 'detail-v', textContent: app.ref || '—' })
      ),
      el('div', { class: 'detail-kv-item' },
        el('span', { class: 'detail-k', textContent: 'Email Address' }),
        el('span', { class: 'detail-v' },
          el('a', {
            href: 'mailto:' + (app.email || ''),
            textContent: app.email || '—',
          })
        )
      )
    );

    // Phone & WhatsApp
    const waMsg = `Hi ${app.name}! This is Presence regarding your fashion & brand modeling application ${app.ref}.`;
    const waUrl = whatsappLink(app.phone, waMsg);

    kvList.append(
      el('div', { class: 'detail-kv-item' },
        el('span', { class: 'detail-k', textContent: 'Phone' }),
        el('span', { class: 'detail-v' },
          document.createTextNode((app.phone || '—') + ' · '),
          el('a', {
            href: waUrl,
            target: '_blank',
            rel: 'noopener noreferrer',
            textContent: 'WhatsApp Chat ↗',
          })
        )
      ),
      el('div', { class: 'detail-kv-item' },
        el('span', { class: 'detail-k', textContent: 'Base City' }),
        el('span', { class: 'detail-v', textContent: app.city || '—' })
      ),
      el('div', { class: 'detail-kv-item' },
        el('span', { class: 'detail-k', textContent: 'Age' }),
        el('span', { class: 'detail-v', textContent: app.age ? app.age + ' years old' : '—' })
      )
    );

    // Portfolio Link (Validated HTTPS and textContent)
    const portfolioContainer = el('div', { class: 'detail-kv-item' },
      el('span', { class: 'detail-k', textContent: 'Portfolio / Website' })
    );
    if (isSecureHttpsUrl(app.portfolio)) {
      portfolioContainer.append(
        el('span', { class: 'detail-v' },
          el('a', {
            href: app.portfolio.trim(),
            target: '_blank',
            rel: 'noopener noreferrer',
            textContent: app.portfolio.trim(),
          })
        )
      );
    } else {
      portfolioContainer.append(
        el('span', { class: 'detail-v text-muted', textContent: app.portfolio ? '(Invalid non-HTTPS URL) ' + app.portfolio : 'None provided' })
      );
    }
    kvList.append(portfolioContainer);

    // Social Handle / Link
    const socialContainer = el('div', { class: 'detail-kv-item' },
      el('span', { class: 'detail-k', textContent: 'Social / Instagram' })
    );
    if (isSecureHttpsUrl(app.social)) {
      socialContainer.append(
        el('span', { class: 'detail-v' },
          el('a', {
            href: app.social.trim(),
            target: '_blank',
            rel: 'noopener noreferrer',
            textContent: app.social.trim(),
          })
        )
      );
    } else {
      socialContainer.append(
        el('span', { class: 'detail-v', textContent: app.social || '—' })
      );
    }
    kvList.append(socialContainer);

    // Application Review Consent (Fix 4: No invented HR / background checks)
    const consentText = app.consent
      ? 'Granted (' + prettyDateTime(app.created_at) + ')'
      : 'Not granted';

    kvList.append(
      el('div', { class: 'detail-kv-item' },
        el('span', { class: 'detail-k', textContent: 'Application review consent' }),
        el('span', {
          class: 'detail-v',
          style: app.consent ? 'color:var(--sage)' : 'color:var(--crimson-bright)',
          textContent: consentText,
        })
      ),
      el('div', { class: 'detail-kv-item' },
        el('span', { class: 'detail-k', textContent: 'Submitted Timestamp' }),
        el('span', { class: 'detail-v text-muted', textContent: prettyDateTime(app.created_at) })
      )
    );

    // Background & Experience
    kvList.append(
      el('div', { class: 'detail-kv-item', style: 'margin-top:10px' },
        el('span', { class: 'detail-k', textContent: 'Background & Personal Statement' }),
        el('div', { class: 'detail-experience', textContent: app.experience || '—' })
      )
    );

    leftCol.append(kvList);

    // Right Column: Management Actions Box
    const rightCol = el('div', { class: 'detail-right-col' });
    const actionsBox = el('div', { class: 'detail-actions-box' });

    actionsBox.append(el('h4', { class: 'detail-section-title', textContent: 'Review & Disposition' }));

    // Status Selector & Update Button (Fix 5: standard option children, set select.value cleanly)
    const statusBlock = el('div', { class: 'action-block' });
    const statusSelect = el('select', { id: 'detailStatusSelect', class: 'select' },
      el('option', { value: 'new', textContent: 'New' }),
      el('option', { value: 'reviewing', textContent: 'Reviewing' }),
      el('option', { value: 'shortlisted', textContent: 'Shortlisted' }),
      el('option', { value: 'rejected', textContent: 'Rejected' })
    );
    statusSelect.value = app.status || 'new';

    const statusFeedback = el('span', { id: 'detailStatusFeedback', class: 'status-feedback' });
    const saveStatusBtn = el('button', {
      type: 'button',
      class: 'btn btn-primary btn-sm',
      textContent: 'Save Status',
      onclick: () => updateApplicationStatus(app.id, statusSelect.value, saveStatusBtn, statusFeedback),
    });

    statusBlock.append(
      el('label', { for: 'detailStatusSelect', textContent: 'Application Status' }),
      statusSelect,
      saveStatusBtn,
      statusFeedback
    );
    actionsBox.append(statusBlock);

    // Receipt Delivery Retry (Fix 5: truthful sent/pending handling, disable already-sent)
    const receiptBlock = el('div', { class: 'action-block' });
    receiptBlock.hidden = true;
    const currentReceiptStatus = (typeof app.receipt_status === 'string' && app.receipt_status)
      ? app.receipt_status
      : 'pending';

    const receiptBadge = el('span', {
      class: 'tag tag-receipt-' + currentReceiptStatus,
      textContent: 'Receipt: ' + currentReceiptStatus,
    });
    const receiptFeedback = el('span', { id: 'detailReceiptFeedback', class: 'receipt-feedback' });

    const isAlreadySent = currentReceiptStatus === 'sent';
    const retryReceiptBtn = el('button', {
      type: 'button',
      class: 'btn btn-secondary btn-sm',
      textContent: isAlreadySent ? 'Receipt Already Sent' : 'Resend Receipt Email',
      onclick: () => retryReceiptEmail(app.id, retryReceiptBtn, receiptBadge, receiptFeedback),
    });
    if (isAlreadySent) {
      retryReceiptBtn.disabled = true;
    }

    receiptBlock.append(
      el('label', { textContent: 'Acknowledgment Email Delivery' }),
      receiptBadge,
      retryReceiptBtn,
      receiptFeedback
    );
    actionsBox.append(receiptBlock);

    rightCol.append(actionsBox);
    grid.append(leftCol, rightCol);
    detailModalContent.append(grid);

    // Photos Section (Authenticated fetch & blob display with strict generation guard)
    const photosSection = el('div', { class: 'detail-photos-section' });
    const photos = app.photos || [];
    photosSection.append(
      el('h4', { class: 'detail-section-title', textContent: `Candidate Photos (${photos.length})` })
    );

    if (!photos.length) {
      photosSection.append(
        el('p', { class: 'text-muted', style: 'font-style:italic;', textContent: 'No photos attached to this application.' })
      );
    } else {
      const photosGrid = el('div', { class: 'detail-photos-grid' });
      photosSection.append(photosGrid);

      photos.forEach((photo, idx) => {
        const thumbBtn = el('button', {
          type: 'button',
          class: 'photo-thumb-btn',
          'aria-label': `View candidate photo ${idx + 1} enlarged`,
        });
        const placeholder = el('div', { class: 'photo-thumb-loading', textContent: 'Loading photo...' });
        thumbBtn.append(placeholder);
        photosGrid.append(thumbBtn);

        fetchPhotoBlobURL(app.id, photo.id, myDetailGen, myEpoch)
          .then(blobUrl => {
            if (!blobUrl) return;
            // Guard: check if detail changed, closed, or logged out before painting
            if (myDetailGen !== detailGeneration || currentDetailAppId !== app.id || myEpoch !== sessionEpoch || !token) {
              try { URL.revokeObjectURL(blobUrl); } catch (_) {}
              activeObjectURLs.delete(blobUrl);
              return;
            }
            placeholder.remove();
            const img = el('img', {
              src: blobUrl,
              alt: `Candidate photo ${idx + 1} for ${app.name || 'applicant'}`,
            });
            thumbBtn.append(img);
            thumbBtn.addEventListener('click', () => {
              openLightbox(blobUrl, `Candidate photo ${idx + 1}`, thumbBtn);
            });
          })
          .catch(err => {
            if (myDetailGen !== detailGeneration || currentDetailAppId !== app.id || myEpoch !== sessionEpoch || !token) {
              return;
            }
            placeholder.textContent = 'Failed to load photo';
            placeholder.style.color = 'var(--crimson-bright)';
          });
      });
    }

    detailModalContent.append(photosSection);
  }

  async function updateApplicationStatus(appId, newStatus, buttonEl, feedbackEl) {
    await withLock('app_status_' + appId, buttonEl, async () => {
      if (feedbackEl) {
        feedbackEl.className = 'status-feedback';
        feedbackEl.textContent = 'Saving status...';
      }
      try {
        await api('/api/admin/applications/' + appId, {
          method: 'PATCH',
          body: { status: newStatus },
        });
      } catch (err) {
        if (feedbackEl) {
          feedbackEl.className = 'status-feedback is-error';
          feedbackEl.textContent = err.message || 'Failed to save';
        }
        toast(err.message, 'error');
        announce('Failed to save status: ' + err.message);
        return;
      }

      if (feedbackEl) {
        feedbackEl.className = 'status-feedback';
        feedbackEl.textContent = '✓ Status saved to ' + newStatus;
      }
      toast('Application marked as ' + newStatus, 'success');
      announce('Application status saved: ' + newStatus);

      try {
        await Promise.all([
          loadApplications({ throwOnError: true }),
          loadStats(),
        ]);
      } catch (err) {
        toast('Status saved to ' + newStatus + ', but could not refresh. Retry refresh from dashboard.', 'warn');
        announce('Status saved, but could not refresh.');
      }
    });
  }

  async function retryReceiptEmail(appId, buttonEl, badgeEl, feedbackEl) {
    await withLock('receipt_retry_' + appId, buttonEl, async () => {
      if (feedbackEl) {
        feedbackEl.className = 'receipt-feedback';
        feedbackEl.textContent = 'Sending acknowledgment email...';
      }
      let data;
      try {
        data = await api('/api/admin/applications/' + appId + '/receipt', {
          method: 'POST',
        });
      } catch (err) {
        if (feedbackEl) {
          feedbackEl.className = 'receipt-feedback is-error';
          feedbackEl.textContent = err.message || 'Retry failed';
        }
        toast(err.message, 'error');
        announce('Receipt retry error: ' + err.message);
        return;
      }

      const returnedStatus = (data && typeof data.receiptStatus === 'string') ? data.receiptStatus : '';
      const newStatus = returnedStatus === 'sent' ? 'sent' : (returnedStatus || (data && data.ok ? 'pending' : 'failed'));

      if (badgeEl) {
        badgeEl.className = 'tag tag-receipt-' + newStatus;
        badgeEl.textContent = 'Receipt: ' + newStatus;
      }
      if (feedbackEl) {
        if (newStatus === 'sent') {
          feedbackEl.className = 'receipt-feedback';
          feedbackEl.textContent = '✓ Receipt sent successfully';
        } else if (newStatus === 'pending') {
          feedbackEl.className = 'receipt-feedback';
          feedbackEl.textContent = 'Receipt delivery pending';
        } else {
          feedbackEl.className = 'receipt-feedback is-error';
          feedbackEl.textContent = 'Receipt delivery status: ' + newStatus;
        }
      }

      if (newStatus === 'sent') {
        if (buttonEl) {
          buttonEl.disabled = true;
          buttonEl.textContent = 'Receipt Already Sent';
        }
        toast('Receipt email dispatched', 'success');
      } else {
        toast('Receipt status: ' + newStatus, 'warn');
      }
      announce('Receipt retry completed: ' + newStatus);

      try {
        await loadApplications({ throwOnError: true });
      } catch (err) {
        toast('Receipt retry completed, but could not refresh. Retry refresh from dashboard.', 'warn');
        announce('Receipt retry completed, but could not refresh.');
      }
    });
  }

  // Lightbox Modal Logic
  function openLightbox(imageUrl, imageAlt, triggeringEl) {
    lightboxTriggerEl = triggeringEl;
    if (lightboxImg) {
      lightboxImg.src = imageUrl;
      lightboxImg.alt = imageAlt || 'Enlarged photo';
    }
    if (photoLightboxDialog && typeof photoLightboxDialog.showModal === 'function') {
      photoLightboxDialog.showModal();
    }
  }

  function closeLightbox() {
    if (photoLightboxDialog && photoLightboxDialog.open) {
      photoLightboxDialog.close();
    }
    if (lightboxImg) lightboxImg.src = '';
    if (lightboxTriggerEl && typeof lightboxTriggerEl.focus === 'function') {
      lightboxTriggerEl.focus();
      lightboxTriggerEl = null;
    }
  }

  if (closeLightboxBtn) closeLightboxBtn.addEventListener('click', closeLightbox);
  if (photoLightboxDialog) {
    photoLightboxDialog.addEventListener('cancel', e => {
      e.preventDefault();
      closeLightbox();
    });
    photoLightboxDialog.addEventListener('click', e => {
      if (e.target === photoLightboxDialog) closeLightbox();
    });
  }

  // Close Application Detail Dialog (Fix 2: clears current id/increments generation and content)
  function closeApplicationDetail() {
    detailGeneration++;
    currentDetailAppId = null;
    revokeAllObjectURLs();
    if (detailModalContent) {
      detailModalContent.replaceChildren();
    }
    if (appDetailDialog && appDetailDialog.open) {
      appDetailDialog.close();
    }
    if (detailTriggerEl && typeof detailTriggerEl.focus === 'function') {
      detailTriggerEl.focus();
      detailTriggerEl = null;
    }
  }

  if (closeDetailBtn) closeDetailBtn.addEventListener('click', closeApplicationDetail);
  if (appDetailDialog) {
    appDetailDialog.addEventListener('cancel', e => {
      e.preventDefault();
      closeApplicationDetail();
    });
    appDetailDialog.addEventListener('click', e => {
      if (e.target === appDetailDialog) closeApplicationDetail();
    });
  }

  // Applications Filter & Search Event Listeners (All caught safely)
  if (appFilterForm) {
    appFilterForm.addEventListener('submit', e => {
      e.preventDefault();
      appSearchQuery = (appSearch ? appSearch.value : '').trim();
      appStatusFilter = (appStatusSelect ? appStatusSelect.value : '').trim();
      appOffset = 0;
      loadApplications().catch(err => toast(err.message, 'error'));
    });
  }

  if (appResetBtn) {
    appResetBtn.addEventListener('click', () => {
      if (appSearch) appSearch.value = '';
      if (appStatusSelect) appStatusSelect.value = '';
      appSearchQuery = '';
      appStatusFilter = '';
      appOffset = 0;
      loadApplications().catch(err => toast(err.message, 'error'));
    });
  }

  if (appPrevBtn) {
    appPrevBtn.addEventListener('click', () => {
      if (appOffset > 0) {
        appOffset = Math.max(0, appOffset - appLimit);
        loadApplications().catch(err => toast(err.message, 'error'));
      }
    });
  }

  if (appNextBtn) {
    appNextBtn.addEventListener('click', () => {
      if (appOffset + appLimit < appTotal) {
        appOffset += appLimit;
        loadApplications().catch(err => toast(err.message, 'error'));
      }
    });
  }

  // Booking Show Filter Event Listener (Caught safely)
  if (showFilter) {
    showFilter.addEventListener('change', () => {
      loadBookings().catch(err => toast(err.message, 'error'));
    });
  }

  // Block Time Form Submission
  if (blockForm) {
    blockForm.addEventListener('submit', async e => {
      e.preventDefault();
      const submitBtn = $('blockSubmitBtn');
      await withLock('add_block', submitBtn, async () => {
        try {
          await api('/api/admin/blocks', {
            method: 'POST',
            body: {
              date: bDate.value,
              time: bTime.value || null,
              reason: bReason.value || '',
            },
          });
        } catch (err) {
          toast(err.message, 'error');
          announce('Block creation failed: ' + err.message);
          return;
        }

        blockForm.reset();
        toast('Calendar block created', 'success');
        announce('Calendar block created');

        try {
          await loadBlocks();
        } catch (err) {
          toast('Calendar block created, but could not refresh. Retry refresh from dashboard.', 'warn');
          announce('Calendar block created, but could not refresh.');
        }
      });
    });
  }

  // Login Form Submission
  if (loginForm) {
    loginForm.addEventListener('submit', async e => {
      e.preventDefault();
      if (loginErr) loginErr.textContent = '';
      const loginBtn = $('loginBtn');

      await withLock('admin_login', loginBtn, async () => {
        try {
          const res = await api('/api/admin/login', {
            method: 'POST',
            body: { password: pwInput.value },
          });
          token = res.token;
          sessionStorage.setItem('presenceAdmin', token);
          pwInput.value = '';
          showDash();
        } catch (err) {
          if (loginErr) loginErr.textContent = err.message;
          announce('Login error: ' + err.message);
        }
      });
    });
  }

  // Logout Button Action (Fix 3: Immediate UI/token wipe, best-effort server invalidation, truthful error)
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      const oldToken = token;
      // 1. Instantly clear private state and return to login screen
      showLogin('You have been logged out.');

      // 2. Best-effort server invalidation in background with captured token
      if (oldToken) {
        fetch('/api/admin/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + oldToken,
          },
        }).catch(err => {
          toast('Server session note: ' + (err.message || 'network notice'), 'warn');
        });
      }
    });
  }

  // Refresh Button Action
  if (refreshBtn) {
    refreshBtn.addEventListener('click', refreshAll);
  }

  // Initial State Check
  if (token) {
    showDash();
  } else {
    showLogin();
  }

  // Export internals for testability in Node / VM environments
  const __admin = {
    api,
    loadStats,
    loadBookings,
    loadWaitlist,
    loadBlocks,
    loadApplications,
    refreshAll,
    fetchPhotoBlobURL,
    openApplicationDetail,
    closeApplicationDetail,
    renderApplicationDetail,
    updateApplicationStatus,
    retryReceiptEmail,
    setBookingStatus,
    deleteBooking,
    removeWaitlist,
    deleteBlock,
    showLogin,
    showDash,
    whatsappLink,
    isSecureHttpsUrl,
    prettyDate,
    prettyDateTime,
    getState: () => ({
      token,
      sessionEpoch,
      detailGeneration,
      currentDetailAppId,
      activeObjectURLs,
    }),
    setState: (newState) => {
      if (newState.token !== undefined) token = newState.token;
      if (newState.sessionEpoch !== undefined) sessionEpoch = newState.sessionEpoch;
      if (newState.detailGeneration !== undefined) detailGeneration = newState.detailGeneration;
      if (newState.currentDetailAppId !== undefined) currentDetailAppId = newState.currentDetailAppId;
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = __admin;
  } else if (typeof window !== 'undefined') {
    window.__admin = __admin;
  }
})();
