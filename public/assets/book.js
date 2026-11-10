/**
 * Presence. — Booking Page Script (Worker D)
 * Contract: Polished dark floral booking page sharing site-header/site-footer
 * and site.css/site.js. Handles compact date strip, ONE selected day's slots
 * alongside the form, concurrency cancellation via AbortController, honest pricing,
 * accessible validation, waitlist handling, send locking, and native confirmation dialog.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* --------------------------------------------------------------------------
     1. Pure Extracted Logic (Exported for Isolated Behavioral Unit Tests)
     -------------------------------------------------------------------------- */

  function validateConfig(data) {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.today)) return false;
    const [y, m, d] = data.today.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false;
    if (typeof data.priceRupees !== 'number' || !Number.isFinite(data.priceRupees) || data.priceRupees < 0) return false;
    if (typeof data.maxDaysAhead !== 'number' || !Number.isInteger(data.maxDaysAhead) || data.maxDaysAhead < 1) return false;
    if (typeof data.timezone !== 'string' || !data.timezone.trim()) return false;
    if (!Array.isArray(data.practices) || data.practices.length === 0) return false;
    if (!data.practices.every(p => typeof p === 'string' && p.trim().length > 0)) return false;
    if (!Array.isArray(data.slots) || data.slots.length === 0) return false;
    if (!data.slots.every(s => s && typeof s === 'object' && typeof s.time === 'string' && /^\d{2}:\d{2}$/.test(s.time) && typeof s.name === 'string' && typeof s.note === 'string')) return false;

    if (!('payments' in data)) return false;
    if (data.payments !== null) {
      if (!data.payments || typeof data.payments !== 'object') return false;
      if (data.payments.provider !== 'razorpay') return false;
      if (typeof data.payments.keyId !== 'string' || !data.payments.keyId.trim()) return false;
      if (typeof data.payments.depositRupees !== 'number' || !Number.isFinite(data.payments.depositRupees) || data.payments.depositRupees <= 0) return false;
    }

    return true;
  }

  function computePricingCopy(cfg) {
    if (!cfg || !validateConfig(cfg)) {
      return {
        isReady: false,
        hasDeposit: false,
        heroPrice: 'Rate unavailable',
        heroDeposit: 'Terms unavailable',
        formPrice: '—',
        formDepositText: 'Pricing unavailable. Please retry connection.',
        formDepositBadge: 'Unavailable',
        formDepositBadgeClass: 'badge badge-bone',
        btnText: 'Schedule Unavailable',
        fineprint: 'Schedule unavailable. Please retry loading.',
        canSubmit: false,
      };
    }

    const price = cfg.priceRupees; // Preserves 0 if meaningful, does not fallback to 10000
    const formattedPrice = '₹' + price.toLocaleString('en-IN');
    const paymentsActive = Boolean(
      cfg.payments &&
      typeof cfg.payments.depositRupees === 'number' &&
      cfg.payments.depositRupees > 0
    );

    if (paymentsActive) {
      const deposit = cfg.payments.depositRupees;
      const formattedDeposit = '₹' + deposit.toLocaleString('en-IN');
      const balance = Math.max(0, price - deposit);
      const formattedBalance = '₹' + balance.toLocaleString('en-IN');

      return {
        isReady: true,
        hasDeposit: true,
        heroPrice: `${formattedPrice} / hour`,
        heroDeposit: `${formattedDeposit} deposit hold`,
        formPrice: formattedPrice,
        formDepositText: `${formattedDeposit} deposit required to hold · ${formattedBalance} remainder on the day`,
        formDepositBadge: 'Deposit Required',
        formDepositBadgeClass: 'badge badge-amber',
        btnText: `Place Hold (${formattedDeposit} Deposit)`,
        fineprint: `Deposit of ${formattedDeposit} secured via Razorpay to confirm hold. Balance of ${formattedBalance} settled on the day.`,
        canSubmit: true,
      };
    }

    return {
      isReady: true,
      hasDeposit: false,
      heroPrice: `${formattedPrice} / hour`,
      heroDeposit: 'No deposit required',
      formPrice: formattedPrice,
      formDepositText: 'No deposit required now · Full fee settled on the day',
      formDepositBadge: 'Standard Hold',
      formDepositBadgeClass: 'badge badge-sage',
      btnText: `Place Hold — ${formattedPrice} / hour`,
      fineprint: 'No payment now. Confirmation on WhatsApp within one business day. Settle in person.',
      canSubmit: true,
    };
  }

  function canSubmit({ hasValidConfig, config, isSubmitting }) {
    return Boolean(hasValidConfig && config && validateConfig(config) && !isSubmitting);
  }

  function parseISODate(isoStr) {
    if (!isoStr || !/^\d{4}-\d{2}-\d{2}$/.test(isoStr)) {
      return new Date();
    }
    const [y, m, d] = isoStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  function addDays(isoStr, n) {
    const dt = parseISODate(isoStr);
    dt.setUTCDate(dt.getUTCDate() + n);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatDayName(isoStr) {
    const dt = parseISODate(isoStr);
    return dt.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }).toUpperCase();
  }

  function formatDayNum(isoStr) {
    const dt = parseISODate(isoStr);
    return String(dt.getUTCDate());
  }

  function formatMonthShort(isoStr) {
    const dt = parseISODate(isoStr);
    return dt.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }).toUpperCase();
  }

  function formatFullDate(isoStr) {
    const dt = parseISODate(isoStr);
    return dt.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  function formatMonthYearHeader(isoStr) {
    const dt = parseISODate(isoStr);
    return dt.toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  function computeSelectionSummary({ hasValidConfig, config, selectedDate, selectedTime }) {
    if (!hasValidConfig || !config) {
      return 'Schedule unavailable. Please retry.';
    }
    if (!selectedDate) {
      return 'Select a date and hour to begin';
    }
    const dayLabel = formatFullDate(selectedDate);
    if (selectedTime) {
      const timeLabel = selectedTime === 'flexible' ? 'Flexible Time' : selectedTime;
      return `${dayLabel} · ${timeLabel}`;
    }
    return `${dayLabel} · Choose an hour`;
  }

  function calculatePillHorizontalScroll(pillLeft, pillWidth, areaWidth) {
    if (!Number.isFinite(pillLeft) || !Number.isFinite(pillWidth) || !Number.isFinite(areaWidth)) return 0;
    return Math.max(0, pillLeft - (areaWidth / 2) + (pillWidth / 2));
  }

  const BookingLogic = {
    validateConfig,
    computePricingCopy,
    computeSelectionSummary,
    calculatePillHorizontalScroll,
    canSubmit,
    parseISODate,
    addDays,
    formatDayName,
    formatDayNum,
    formatMonthShort,
    formatFullDate,
    formatMonthYearHeader,
  };

  // If running in a Node.js test environment without DOM, return the logic module immediately
  if (typeof document === 'undefined') {
    return BookingLogic;
  }

  /* --------------------------------------------------------------------------
     2. Browser DOM Runtime
     -------------------------------------------------------------------------- */

  // State
  let config = null;
  let hasValidConfig = false;
  let selectedDate = '';
  let selectedTime = '';
  let selectedDayData = null;
  let activeAbortController = null;
  let currentRequestId = 0;
  let isSubmitting = false;
  let lastFocusedElement = null;
  let initialHashHandled = false;

  // DOM Elements
  const form = document.getElementById('bookForm');
  const submitBtn = document.getElementById('submitBtn');
  const submitBtnText = document.getElementById('submitBtnText');
  const submitFineprint = document.getElementById('submitFineprint');
  const dateStrip = document.getElementById('dateStrip');
  const stripPrevBtn = document.getElementById('stripPrevBtn');
  const stripNextBtn = document.getElementById('stripNextBtn');
  const dateJumpInput = document.getElementById('dateJumpInput');
  const dateStripMonth = document.getElementById('dateStripMonth');
  const dateStripTzNote = document.getElementById('dateStripTzNote');
  const calendarAlert = document.getElementById('calendarAlert');
  const calendarRetryBtn = document.getElementById('calendarRetryBtn');

  const selectedDayTitle = document.getElementById('selectedDayTitle');
  const dayStatusBadge = document.getElementById('dayStatusBadge');
  const slotsBody = document.getElementById('slotsBody');
  const flexibleSlotCard = document.getElementById('flexibleSlotCard');
  const reserveFlexibleBtn = document.getElementById('reserveFlexibleBtn');
  const selectionSummary = document.getElementById('selectionSummary');

  const fName = document.getElementById('f-name');
  const fContact = document.getElementById('f-contact');
  const fDate = document.getElementById('f-date');
  const fTime = document.getElementById('f-time');
  const fPractice = document.getElementById('f-practice');
  const fReq = document.getElementById('f-req');
  const fLady = document.getElementById('f-lady');
  const fWebsite = document.getElementById('f-website');

  const heroPriceDisplay = document.getElementById('heroPriceDisplay');
  const heroDepositDisplay = document.getElementById('heroDepositDisplay');
  const formPriceTotal = document.getElementById('formPriceTotal');
  const formDepositText = document.getElementById('formDepositText');
  const formDepositBadge = document.getElementById('formDepositBadge');

  const confirmDialog = document.getElementById('confirmDialog');
  const dialogCloseBtn = document.getElementById('dialogCloseBtn');
  const mRef = document.getElementById('mRef');
  const mSum = document.getElementById('mSum');
  const dialogPaymentNotice = document.getElementById('dialogPaymentNotice');
  const dialogPaymentNoticeText = document.getElementById('dialogPaymentNoticeText');

  function notify(msg, type) {
    if (window.PresenceUI && typeof window.PresenceUI.toast === 'function') {
      window.PresenceUI.toast(msg, type || 'info');
      return;
    }
    let t = document.getElementById('presence-toast-container');
    if (!t) {
      t = document.createElement('div');
      t.id = 'presence-toast-container';
      document.body.appendChild(t);
    }
    const box = document.createElement('div');
    box.className = 'presence-toast notice-' + (type || 'info');
    box.textContent = msg;
    t.appendChild(box);
    setTimeout(() => {
      if (box.parentNode) box.parentNode.removeChild(box);
    }, 4000);
  }

  async function api(path, body, signal) {
    const opts = body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : { method: 'GET' };
    if (signal) opts.signal = signal;

    let res;
    try {
      res = await fetch(path, opts);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw Object.assign(new Error('Cannot reach the server — please verify your connection.'), { offline: true });
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw Object.assign(new Error(data.error || 'Something went wrong'), {
        field: data.field,
        status: res.status,
      });
    }
    return data;
  }

  /* --------------------------------------------------------------------------
     3. Config Loading & Error State Handling
     -------------------------------------------------------------------------- */
  async function loadConfig() {
    renderConfigLoading();

    try {
      const data = await api('/api/config');
      if (!validateConfig(data)) {
        throw new Error('Server returned an incomplete or invalid configuration.');
      }

      config = data;
      hasValidConfig = true;
      applyConfig();
      hideCalendarAlert();
    } catch (err) {
      console.warn('Configuration fetch failed:', err.message);
      config = null;
      hasValidConfig = false;
      applyConfigFailure(err.message);
      showCalendarAlert(
        'Schedule Unavailable',
        'Unable to retrieve live rates and calendar from the server. Please retry.'
      );
      checkInitialHash();
    }
  }

  function renderConfigLoading() {
    if (submitBtn) {
      submitBtn.disabled = true;
      if (submitBtnText) submitBtnText.textContent = 'Checking schedule…';
    }
    if (heroPriceDisplay) heroPriceDisplay.textContent = 'Loading rate…';
    if (heroDepositDisplay) heroDepositDisplay.textContent = 'Checking terms…';
    if (formPriceTotal) formPriceTotal.textContent = '—';
    if (formDepositText) formDepositText.textContent = 'Loading fee schedule…';
    if (formDepositBadge) {
      formDepositBadge.textContent = 'Checking…';
      formDepositBadge.className = 'badge badge-bone';
    }
    if (submitFineprint) {
      submitFineprint.textContent = 'Connecting to server… Fee schedule and terms will appear once verified.';
    }
    if (dateStrip) {
      dateStrip.innerHTML = '<div class="date-strip-placeholder">Loading available dates…</div>';
    }
    if (slotsBody) {
      slotsBody.innerHTML = `
        <div class="slots-loading">
          <div class="spinner" aria-hidden="true"></div>
          <p>Consulting the gentleman's journal…</p>
        </div>
      `;
    }
    if (flexibleSlotCard) flexibleSlotCard.style.display = 'none';
    if (selectionSummary) selectionSummary.textContent = 'Loading availability…';
  }

  function applyConfigFailure(errMsg) {
    const copy = computePricingCopy(null);

    if (heroPriceDisplay) heroPriceDisplay.textContent = copy.heroPrice;
    if (heroDepositDisplay) heroDepositDisplay.textContent = copy.heroDeposit;
    if (formPriceTotal) formPriceTotal.textContent = copy.formPrice;
    if (formDepositText) formDepositText.textContent = copy.formDepositText;
    if (formDepositBadge) {
      formDepositBadge.textContent = copy.formDepositBadge;
      formDepositBadge.className = copy.formDepositBadgeClass;
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      if (submitBtnText) submitBtnText.textContent = copy.btnText;
    }
    if (submitFineprint) submitFineprint.textContent = copy.fineprint;

    if (dateStrip) {
      dateStrip.innerHTML = `
        <div class="date-strip-placeholder">
          Calendar schedule unavailable.
          <button type="button" class="btn btn-sm btn-secondary" id="stripRetryBtn" style="margin-left:10px;">Retry</button>
        </div>
      `;
      const stripRetry = document.getElementById('stripRetryBtn');
      if (stripRetry) stripRetry.addEventListener('click', loadConfig);
    }

    if (slotsBody) {
      slotsBody.innerHTML = `
        <div class="closed-day-card">
          <div class="closed-day-icon" aria-hidden="true">⚠️</div>
          <h4 class="closed-day-title">Schedule Unavailable</h4>
          <p class="closed-day-desc">${escapeHtml(errMsg || 'Could not load rates and hours from the server.')}</p>
          <button type="button" class="btn btn-sm btn-secondary" id="slotsConfigRetryBtn">
            Retry Loading Schedule
          </button>
        </div>
      `;
      const slotsRetry = document.getElementById('slotsConfigRetryBtn');
      if (slotsRetry) slotsRetry.addEventListener('click', loadConfig);
    }

    if (flexibleSlotCard) flexibleSlotCard.style.display = 'none';
    updateSelectionSummary();
  }

  function applyConfig() {
    const copy = computePricingCopy(config);

    if (heroPriceDisplay) heroPriceDisplay.textContent = copy.heroPrice;
    if (heroDepositDisplay) heroDepositDisplay.textContent = copy.heroDeposit;
    if (formPriceTotal) formPriceTotal.textContent = copy.formPrice;
    if (formDepositText) formDepositText.textContent = copy.formDepositText;
    if (formDepositBadge) {
      formDepositBadge.textContent = copy.formDepositBadge;
      formDepositBadge.className = copy.formDepositBadgeClass;
    }
    if (submitBtn) {
      submitBtn.disabled = !copy.canSubmit;
      if (submitBtnText) submitBtnText.textContent = copy.btnText;
    }
    if (submitFineprint) submitFineprint.textContent = copy.fineprint;

    // Timezone label
    if (dateStripTzNote) {
      const tzName = config.timezone || 'Asia/Kolkata';
      dateStripTzNote.textContent = `Times in ${tzName.replace('_', ' ')}`;
    }

    if (fTime) {
      const currentValue = fTime.value;
      fTime.replaceChildren(new Option('Choose an hour', ''));
      config.slots.forEach(slot => fTime.add(new Option(slot.time, slot.time)));
      fTime.add(new Option('Flexible · to be arranged', 'flexible'));
      fTime.value = currentValue;
    }

    // Populate practices dropdown from verified config, preserving user selection if already typed/chosen
    if (fPractice) {
      const currentValue = fPractice.value;
      fPractice.innerHTML = '<option value="">Select a practice</option>';
      config.practices.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        if (p === currentValue) opt.selected = true;
        fPractice.appendChild(opt);
      });
    }

    // Date limits on inputs (strictly server timezone today)
    const today = config.today;
    const maxDays = config.maxDaysAhead;
    const maxDate = addDays(today, maxDays);

    if (fDate) {
      fDate.min = today;
      fDate.max = maxDate;
    }
    if (dateJumpInput) {
      dateJumpInput.min = today;
      dateJumpInput.max = maxDate;
    }

    // Selected date: preserve if valid upcoming date within range, otherwise default to server today
    if (!selectedDate || selectedDate < today || selectedDate > maxDate) {
      selectedDate = today;
    }
    if (fDate) fDate.value = selectedDate;
    if (dateJumpInput) dateJumpInput.value = selectedDate;

    // Build the date strip & load slots for selected date
    updateSelectionSummary();
    buildDateStrip();
    loadSlots(selectedDate);
  }

  function showCalendarAlert(title, message) {
    if (!calendarAlert) return;
    const titleEl = document.getElementById('calendarAlertTitle');
    const msgEl = document.getElementById('calendarAlertMsg');
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    calendarAlert.hidden = false;
  }

  function hideCalendarAlert() {
    if (calendarAlert) calendarAlert.hidden = true;
  }

  /* --------------------------------------------------------------------------
     4. Compact Date Strip Rendering & Navigation
     -------------------------------------------------------------------------- */
  function buildDateStrip() {
    if (!dateStrip || !hasValidConfig || !config) return;
    dateStrip.innerHTML = '';

    const today = config.today;
    const maxDays = config.maxDaysAhead;

    if (dateStripMonth) {
      dateStripMonth.textContent = formatMonthYearHeader(selectedDate || today);
    }

    for (let i = 0; i <= maxDays; i++) {
      const dateStr = addDays(today, i);
      const isToday = i === 0;
      const isTomorrow = i === 1;
      const isSelected = dateStr === selectedDate;

      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'date-pill' + (isSelected ? ' is-active' : '');
      pill.setAttribute('role', 'tab');
      pill.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      pill.setAttribute('aria-label', formatFullDate(dateStr));
      pill.dataset.date = dateStr;

      let tagHTML = '';
      if (isToday) tagHTML = '<span class="date-pill-tag">Today</span>';
      else if (isTomorrow) tagHTML = '<span class="date-pill-tag">Tomorrow</span>';

      pill.innerHTML = `
        ${tagHTML}
        <span class="date-pill-day">${formatDayName(dateStr)}</span>
        <span class="date-pill-num">${formatDayNum(dateStr)}</span>
        <span class="date-pill-month">${formatMonthShort(dateStr)}</span>
        <span class="date-pill-dot open" aria-hidden="true"></span>
      `;

      pill.addEventListener('click', () => {
        selectDate(dateStr, true);
      });

      dateStrip.appendChild(pill);
    }

    updateNavButtons();
    scrollPillIntoView(selectedDate);
  }

  function updateNavButtons() {
    if (!hasValidConfig || !config) {
      if (stripPrevBtn) stripPrevBtn.disabled = true;
      if (stripNextBtn) stripNextBtn.disabled = true;
      return;
    }

    const today = config.today;
    const maxDate = addDays(today, config.maxDaysAhead);

    if (stripPrevBtn) {
      stripPrevBtn.disabled = selectedDate <= today;
    }
    if (stripNextBtn) {
      stripNextBtn.disabled = selectedDate >= maxDate;
    }
  }

  function scrollPillIntoView(dateStr) {
    if (!dateStrip) return;
    const scrollArea = dateStrip.closest('.date-strip-scroll-area');
    const activePill = dateStrip.querySelector(`[data-date="${dateStr}"]`);
    if (!scrollArea || !activePill) return;

    const targetScrollLeft = calculatePillHorizontalScroll(
      activePill.offsetLeft,
      activePill.offsetWidth,
      scrollArea.clientWidth
    );

    const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof scrollArea.scrollTo === 'function') {
      scrollArea.scrollTo({
        left: targetScrollLeft,
        behavior: isReduced ? 'auto' : 'smooth',
      });
    } else {
      scrollArea.scrollLeft = targetScrollLeft;
    }
  }

  function checkInitialHash() {
    if (initialHashHandled) return;
    initialHashHandled = true;

    const hash = (window.location.hash || '').replace(/^#/, '');
    if (hash === 'book' || hash === 'week') {
      const targetEl = document.getElementById(hash);
      if (targetEl) {
        requestAnimationFrame(() => {
          setTimeout(() => {
            targetEl.scrollIntoView({
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
            });
          }, 40);
        });
      }
    }
  }

  function selectDate(dateStr, shouldScroll) {
    if (!hasValidConfig || !config) return;
    if (!dateStr || dateStr === selectedDate) {
      if (!selectedDayData && dateStr) loadSlots(dateStr);
      return;
    }

    selectedDate = dateStr;
    if (fDate) fDate.value = dateStr;
    if (dateJumpInput) dateJumpInput.value = dateStr;
    if (dateStripMonth) dateStripMonth.textContent = formatMonthYearHeader(dateStr);

    if (dateStrip) {
      dateStrip.querySelectorAll('.date-pill').forEach(pill => {
        const isMatch = pill.dataset.date === dateStr;
        pill.classList.toggle('is-active', isMatch);
        pill.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      });
    }

    updateNavButtons();
    if (shouldScroll) scrollPillIntoView(dateStr);

    if (window.PresenceUI) {
      window.PresenceUI.clearFieldError('f-date');
    } else {
      const p = fDate?.closest('.field');
      if (p) p.classList.remove('has-error');
    }

    updateSelectionSummary();
    loadSlots(dateStr);
  }

  /* --------------------------------------------------------------------------
     5. Slots Loading with Concurrency Control
     -------------------------------------------------------------------------- */
  async function loadSlots(dateStr) {
    if (!dateStr || !hasValidConfig) return;

    if (activeAbortController) {
      activeAbortController.abort();
    }
    activeAbortController = new AbortController();
    const requestId = ++currentRequestId;

    renderSlotsLoading(dateStr);

    try {
      const res = await api(`/api/slots?start=${encodeURIComponent(dateStr)}&days=1`, null, activeAbortController.signal);

      if (requestId !== currentRequestId) return; // Discard stale response

      const day = (res.days && res.days[0]) || null;
      selectedDayData = day;
      renderSlots(day, dateStr);
      syncTimeSelect(day);
      updateSelectionSummary();
      hideCalendarAlert();
      checkInitialHash();
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (requestId !== currentRequestId) return;

      console.error('Failed to load slots:', err);
      renderSlotsError(err, dateStr);
      updateSelectionSummary();
      checkInitialHash();
    }
  }

  function renderSlotsLoading(dateStr) {
    if (selectedDayTitle) selectedDayTitle.textContent = formatFullDate(dateStr);
    if (dayStatusBadge) {
      dayStatusBadge.textContent = 'Checking…';
      dayStatusBadge.className = 'tag badge-bone';
    }
    if (slotsBody) {
      slotsBody.innerHTML = `
        <div class="slots-loading">
          <div class="spinner" aria-hidden="true"></div>
          <p>Consulting the gentleman's journal for ${formatDayName(dateStr)}…</p>
        </div>
      `;
    }
  }

  function renderSlotsError(err, dateStr) {
    if (selectedDayTitle) selectedDayTitle.textContent = formatFullDate(dateStr);
    if (dayStatusBadge) {
      dayStatusBadge.textContent = 'Offline';
      dayStatusBadge.className = 'tag badge-amber';
    }
    if (slotsBody) {
      slotsBody.innerHTML = `
        <div class="closed-day-card">
          <div class="closed-day-icon" aria-hidden="true">⚠️</div>
          <h4 class="closed-day-title">Calendar Temporarily Resting</h4>
          <p class="closed-day-desc">${escapeHtml(err.message || 'Could not retrieve live availability. You may retry or select another day.')}</p>
          <button type="button" class="btn btn-sm btn-secondary" id="retrySlotFetchBtn">
            Retry This Day
          </button>
        </div>
      `;
      const retryBtn = document.getElementById('retrySlotFetchBtn');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => loadSlots(dateStr));
      }
    }
  }

  /* --------------------------------------------------------------------------
     6. Slots Rendering for ONE Selected Day
     -------------------------------------------------------------------------- */
  function renderSlots(day, dateStr) {
    if (!slotsBody) return;
    if (selectedDayTitle) selectedDayTitle.textContent = formatFullDate(dateStr);

    // If day is closed
    if (!day || day.closed) {
      const reason = (day && day.closedReason) ? day.closedReason : 'rest day';
      if (dayStatusBadge) {
        dayStatusBadge.textContent = 'Closed';
        dayStatusBadge.className = 'tag badge-bone';
      }

      slotsBody.innerHTML = `
        <div class="closed-day-card">
          <div class="closed-day-icon" aria-hidden="true">☕</div>
          <h4 class="closed-day-title">Closed · ${escapeHtml(reason)}</h4>
          <p class="closed-day-desc">
            ${reason.toLowerCase().includes('rest')
              ? 'Even a gentleman requires quiet stillness to remain attentive. Please choose an adjacent day from the date strip above.'
              : 'Bookings are not accepted for this date. Please choose another day from the strip above.'}
          </p>
        </div>
      `;

      if (flexibleSlotCard) flexibleSlotCard.style.display = 'none';
      return;
    }

    // Day is open
    if (dayStatusBadge) {
      dayStatusBadge.textContent = 'Open for Booking';
      dayStatusBadge.className = 'tag badge-sage';
    }
    if (flexibleSlotCard) flexibleSlotCard.style.display = 'flex';

    const slots = Array.isArray(day.slots) ? day.slots : (config ? config.slots : []);
    if (!slots.length) {
      slotsBody.innerHTML = `
        <div class="closed-day-card">
          <h4 class="closed-day-title">No Hours Listed</h4>
          <p class="closed-day-desc">No specific hours found for this day. You may select Flexible Time below.</p>
        </div>
      `;
      return;
    }

    let html = '';
    slots.forEach(s => {
      const isPast = s.status === 'past';
      const isHeld = s.status === 'held';
      const isOpen = s.status === 'open';
      const isSelected = selectedTime === s.time;

      let badgeHTML = '';
      let actionHTML = '';

      if (isPast) {
        badgeHTML = '<span class="tag badge-bone">Passed</span>';
        actionHTML = '<button type="button" class="btn btn-sm btn-ghost" disabled>Passed</button>';
      } else if (isHeld) {
        badgeHTML = '<span class="tag badge-amber">Held</span>';
        actionHTML = `
          <button type="button" class="btn btn-sm btn-ghost waitlist-toggle-btn" data-time="${escapeHtml(s.time)}">
            Join Waitlist
          </button>
        `;
      } else {
        badgeHTML = '<span class="tag badge-sage">Open</span>';
        actionHTML = `
          <button type="button" class="btn btn-sm btn-primary slot-reserve-btn" data-time="${escapeHtml(s.time)}" data-date="${escapeHtml(dateStr)}">
            Reserve
          </button>
        `;
      }

      let waitlistSection = '';
      if (isHeld) {
        waitlistSection = `
          <div class="slot-waitlist-wrap" id="wl-wrap-${s.time.replace(':', '-')}" hidden>
            <p class="waitlist-prompt">Taken by an earlier booking. Leave your details below — if it frees up, you will hear first.</p>
            <form class="waitlist-form" data-date="${escapeHtml(dateStr)}" data-time="${escapeHtml(s.time)}">
              <input type="text" name="name" class="input waitlist-input" placeholder="Your name" required maxlength="80" autocomplete="name" aria-label="Waitlist Name">
              <input type="tel" name="contact" class="input waitlist-input" placeholder="WhatsApp / Phone" required maxlength="30" autocomplete="tel" aria-label="Waitlist Phone">
              <button type="submit" class="btn btn-sm btn-secondary waitlist-btn">Submit</button>
              <div class="waitlist-status" role="status" aria-live="polite"></div>
            </form>
          </div>
        `;
      }

      html += `
        <div class="slot-row ${isPast ? 'is-past' : ''} ${isHeld ? 'is-held' : ''} ${isSelected ? 'is-selected' : ''}" data-slot-time="${escapeHtml(s.time)}">
          <div class="slot-row-main">
            <div class="slot-time-block">
              <span class="slot-time">${escapeHtml(s.time)}</span>
              <span class="slot-name">${escapeHtml(s.name || 'Accompaniment')}</span>
              <span class="slot-note">${escapeHtml(s.note || '')}</span>
            </div>
            <div class="slot-status-actions">
              ${badgeHTML}
              ${actionHTML}
            </div>
          </div>
          ${waitlistSection}
        </div>
      `;
    });

    slotsBody.innerHTML = html;

    // Bind Reserve buttons
    slotsBody.querySelectorAll('.slot-reserve-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const time = btn.dataset.time;
        const date = btn.dataset.date;
        selectSlotAndFocus(date, time);
      });
    });

    // Bind Waitlist toggle buttons
    slotsBody.querySelectorAll('.waitlist-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const time = btn.dataset.time;
        const wrap = document.getElementById(`wl-wrap-${time.replace(':', '-')}`);
        if (wrap) {
          const isHidden = wrap.hidden;
          wrap.hidden = !isHidden;
          btn.textContent = isHidden ? 'Hide Waitlist' : 'Join Waitlist';
          if (isHidden) {
            const firstInput = wrap.querySelector('input');
            if (firstInput) firstInput.focus({ preventScroll: true });
          }
        }
      });
    });

    // Bind Waitlist form submissions
    slotsBody.querySelectorAll('.waitlist-form').forEach(wlForm => {
      wlForm.addEventListener('submit', handleWaitlistSubmit);
    });
  }

  function selectSlotAndFocus(date, time) {
    if (!hasValidConfig) return;
    selectedTime = time;
    if (fTime) {
      fTime.value = time;
    }
    if (fDate) {
      fDate.value = date;
    }

    if (slotsBody) {
      slotsBody.querySelectorAll('.slot-row').forEach(row => {
        row.classList.toggle('is-selected', row.dataset.slotTime === time);
      });
    }

    if (window.PresenceUI) {
      window.PresenceUI.clearFieldError('f-time');
      window.PresenceUI.clearFieldError('f-date');
    } else {
      fTime?.closest('.field')?.classList.remove('has-error');
      fDate?.closest('.field')?.classList.remove('has-error');
    }

    updateSelectionSummary();
    notify(`${formatDayName(date)} at ${time} selected. Complete your details below.`, 'info');

    // Focus suitable field without scroll hijack
    const targetField = (!fName.value.trim()) ? fName : (!fContact.value.trim() ? fContact : fPractice);
    if (targetField && typeof targetField.focus === 'function') {
      targetField.focus({ preventScroll: true });
    }
  }

  function updateSelectionSummary() {
    if (!selectionSummary) return;
    selectionSummary.textContent = computeSelectionSummary({
      hasValidConfig,
      config,
      selectedDate,
      selectedTime,
    });
  }

  /* --------------------------------------------------------------------------
     7. Waitlist Submission (Strict form.elements.namedItem rule)
     -------------------------------------------------------------------------- */
  async function handleWaitlistSubmit(e) {
    e.preventDefault();
    if (!hasValidConfig || !config) {
      notify('Schedule is not loaded. Please retry connection.', 'error');
      return;
    }

    const formEl = e.currentTarget;

    // MANDATORY RULE: Use form.elements.namedItem not f.name which collides with native form.name
    const nameInput = formEl.elements.namedItem('name');
    const contactInput = formEl.elements.namedItem('contact');
    const statusEl = formEl.querySelector('.waitlist-status');
    const waitlistSubmitBtn = formEl.querySelector('button[type="submit"]');

    const name = nameInput ? nameInput.value.trim() : '';
    const contact = contactInput ? contactInput.value.trim() : '';
    const date = formEl.dataset.date;
    const time = formEl.dataset.time;

    if (name.length < 2) {
      if (statusEl) statusEl.textContent = 'Please enter your name.';
      nameInput?.focus();
      return;
    }
    const digits = contact.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) {
      if (statusEl) statusEl.textContent = 'Please enter a valid phone number.';
      contactInput?.focus();
      return;
    }

    if (waitlistSubmitBtn) waitlistSubmitBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Registering on waitlist…';

    try {
      await api('/api/waitlist', { name, contact, date, time });
      formEl.innerHTML = `
        <p class="slot-note" style="color:var(--sage);margin-top:6px;">
          ✓ On waitlist for ${escapeHtml(time)}. If it frees up, you will be contacted first on WhatsApp.
        </p>
      `;
      notify('Waitlist confirmed. The gentleman will alert you if this hour opens.', 'success');
    } catch (err) {
      if (statusEl) statusEl.textContent = err.message || 'Could not join waitlist.';
      if (waitlistSubmitBtn) waitlistSubmitBtn.disabled = false;
      notify(err.message || 'Waitlist error', 'error');
    }
  }

  /* --------------------------------------------------------------------------
     8. Synchronize Select Dropdown with Selected Day
     -------------------------------------------------------------------------- */
  function syncTimeSelect(day) {
    if (!fTime) return;

    const currentVal = fTime.value;
    Array.from(fTime.options).forEach(opt => {
      if (!opt.value) return;
      opt.disabled = false;
      opt.textContent = opt.textContent.replace(/ — (held|passed|closed)$/, '');

      if (!day || day.closed) {
        opt.disabled = true;
        opt.textContent += ' — closed';
        if (currentVal === opt.value) fTime.value = '';
        return;
      }

      if (opt.value === 'flexible') {
        opt.disabled = false;
        return;
      }

      const slot = day.slots?.find(s => s.time === opt.value);
      if (slot) {
        if (slot.status === 'held') {
          opt.disabled = true;
          opt.textContent += ' — held';
          if (currentVal === opt.value) fTime.value = '';
        } else if (slot.status === 'past') {
          opt.disabled = true;
          opt.textContent += ' — passed';
          if (currentVal === opt.value) fTime.value = '';
        }
      }
    });
  }

  /* --------------------------------------------------------------------------
     9. Razorpay Dynamic Script & Deposit Modal
     -------------------------------------------------------------------------- */
  function loadRazorpayScript() {
    return new Promise((resolve, reject) => {
      if (window.Razorpay) return resolve();
      const existing = document.querySelector('script[src*="razorpay.com"]');
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Could not load payment checkout.')));
        return;
      }
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load payment checkout window.'));
      document.head.appendChild(s);
    });
  }

  async function handleRazorpayPayment(booking, contact) {
    try {
      await loadRazorpayScript();
    } catch (err) {
      console.warn('Payment script load failed:', err);
      return 'skipped';
    }

    return new Promise(resolve => {
      const rz = new window.Razorpay({
        key: booking.payment.keyId,
        order_id: booking.payment.orderId,
        amount: booking.payment.amount,
        currency: booking.payment.currency || 'INR',
        name: 'Presence.',
        description: `Deposit Hold · ${booking.ref}`,
        prefill: {
          name: booking.name,
          contact: contact,
        },
        theme: { color: '#c9161d' },
        handler: async response => {
          try {
            await api(`/api/bookings/${encodeURIComponent(booking.ref)}/payment`, response);
            resolve('paid');
          } catch (e) {
            console.error('Payment verification failed:', e);
            resolve('unverified');
          }
        },
        modal: {
          ondismiss: () => resolve('skipped'),
        },
      });
      rz.open();
    });
  }

  /* --------------------------------------------------------------------------
     10. Form Validation & Submission
     -------------------------------------------------------------------------- */
  function setFieldError(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('aria-invalid', 'true');
    const fieldWrap = el.closest('.field') || el.closest('.checkbox-field');
    if (fieldWrap) {
      fieldWrap.classList.add('has-error');
      const errEl = fieldWrap.querySelector('.field-error');
      if (errEl) errEl.textContent = msg;
    }
  }

  function clearFieldError(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.removeAttribute('aria-invalid');
    const fieldWrap = el.closest('.field') || el.closest('.checkbox-field');
    if (fieldWrap) {
      fieldWrap.classList.remove('has-error');
      const errEl = fieldWrap.querySelector('.field-error');
      if (errEl) errEl.textContent = '';
    }
  }

  function clearAllErrors() {
    form.querySelectorAll('[aria-invalid="true"]').forEach(el => el.removeAttribute('aria-invalid'));
    form.querySelectorAll('.has-error').forEach(el => el.classList.remove('has-error'));
    form.querySelectorAll('.field-error').forEach(el => { el.textContent = ''; });
  }

  function validateForm() {
    clearAllErrors();
    let firstInvalid = null;

    // 1. Name
    const nameVal = fName.value.trim();
    if (nameVal.length < 2) {
      setFieldError('f-name', 'The gentleman needs a name to whisper politely (at least 2 characters).');
      if (!firstInvalid) firstInvalid = fName;
    }

    // 2. Contact
    const contactVal = fContact.value.trim();
    const digits = contactVal.replace(/\D/g, '');
    const validChars = /^[+\d\s()-]+$/.test(contactVal);
    if (digits.length < 7 || digits.length > 15 || !validChars) {
      setFieldError('f-contact', 'Please provide a valid WhatsApp or phone number (7–15 digits).');
      if (!firstInvalid) firstInvalid = fContact;
    }

    // 3. Date
    const dateVal = fDate.value;
    const today = config ? config.today : '';
    const maxDate = (config && today) ? addDays(today, Number(config.maxDaysAhead) || 14) : '';
    if (!dateVal) {
      setFieldError('f-date', 'Please choose a date from the calendar.');
      if (!firstInvalid) firstInvalid = fDate;
    } else if (today && dateVal < today) {
      setFieldError('f-date', 'That date has already happened. Please pick an upcoming day.');
      if (!firstInvalid) firstInvalid = fDate;
    } else if (maxDate && dateVal > maxDate) {
      setFieldError('f-date', `Bookings open ${config.maxDaysAhead} days ahead. Please select an earlier date.`);
      if (!firstInvalid) firstInvalid = fDate;
    }

    // 4. Time
    const timeVal = fTime.value;
    if (!timeVal) {
      setFieldError('f-time', 'An hour must be chosen before it can be held.');
      if (!firstInvalid) firstInvalid = fTime;
    } else {
      const selectedOption = fTime.options[fTime.selectedIndex];
      if (selectedOption && selectedOption.disabled) {
        setFieldError('f-time', 'That hour is unavailable. Please pick an open slot.');
        if (!firstInvalid) firstInvalid = fTime;
      }
    }

    // 5. Practice
    const practiceVal = fPractice.value;
    if (!practiceVal) {
      setFieldError('f-practice', 'Every hour requires a shape. Please select a practice.');
      if (!firstInvalid) firstInvalid = fPractice;
    }

    // 6. Lady confirmation
    if (!fLady.checked) {
      setFieldError('f-lady', 'The ladies-only clause is strictly observed and required.');
      if (!firstInvalid) firstInvalid = fLady;
    }

    if (firstInvalid) {
      firstInvalid.focus();
      notify('Please complete the highlighted details.', 'warn');
      return false;
    }
    return true;
  }

  async function handleFormSubmit(e) {
    e.preventDefault();

    // Guard submit handler independently even if button enabled programmatically
    if (!canSubmit({ hasValidConfig, config, isSubmitting })) {
      notify('Booking schedule is not available. Please retry loading.', 'error');
      return;
    }

    if (!validateForm()) return;

    // Honeypot spam check
    if (fWebsite && fWebsite.value) {
      console.warn('Bot detected by honeypot');
      return;
    }

    // Send Lock: Keep locked throughout entire flow including deposit modal
    isSubmitting = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
      if (submitBtnText) submitBtnText.textContent = 'Placing hold…';
    }

    const payload = {
      name: fName.value.trim(),
      contact: fContact.value.trim(),
      date: fDate.value,
      time: fTime.value,
      practice: fPractice.value,
      request: fReq.value.trim(),
      lady: fLady.checked,
      website: fWebsite ? fWebsite.value : '',
    };

    let booking = null;
    try {
      booking = await api('/api/bookings', payload);
    } catch (err) {
      isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.removeAttribute('aria-busy');
        if (submitBtnText) submitBtnText.textContent = computePricingCopy(config).btnText;
      }

      notify(err.message || 'Could not place hold.', 'error');

      if (err.field) {
        setFieldError(err.field, err.message);
        const badEl = document.getElementById(err.field);
        if (badEl) badEl.focus();
      }

      if (err.field === 'f-time' || err.field === 'f-date') {
        loadSlots(selectedDate);
      }
      return;
    }

    // If Razorpay deposit workflow is active:
    // Notice: Send lock remains true while the Razorpay window is open!
    let paidStatus = null;
    if (booking && booking.payment) {
      try {
        paidStatus = await handleRazorpayPayment(booking, payload.contact);
      } catch (e) {
        console.warn('Razorpay exception:', e);
        paidStatus = 'skipped';
      }
    }

    // Flow completed: unlock send lock
    isSubmitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.removeAttribute('aria-busy');
      if (submitBtnText) submitBtnText.textContent = computePricingCopy(config).btnText;
    }

    // Open Accessible Confirmation Dialog
    showConfirmationDialog(booking, paidStatus);

    // Reset form fields
    form.reset();
    fDate.value = selectedDate;
    if (fLady) fLady.checked = false;

    // Refresh slots so the newly booked slot shows as held
    loadSlots(selectedDate);
    notify('Hold placed — the kettle is on.', 'success');
  }

  /* --------------------------------------------------------------------------
     11. Confirmation Dialog (Accessible Modal with Focus Trap & Escape)
     -------------------------------------------------------------------------- */
  function showConfirmationDialog(booking, paidStatus) {
    if (!confirmDialog) return;

    lastFocusedElement = document.activeElement;

    if (mRef) mRef.textContent = booking.ref || 'PRS-••••••';

    if (mSum) {
      mSum.innerHTML = '';
      const rows = [
        ['Client', booking.name],
        ['Date', formatFullDate(booking.date)],
        ['Hour', booking.time === 'flexible' ? 'Flexible · To be arranged' : booking.time],
        ['Practice', booking.practice],
        ['Mission', booking.request ? (booking.request.length > 120 ? booking.request.slice(0, 120) + '…' : booking.request) : '— to be shared over tea'],
      ];

      rows.forEach(([k, v]) => {
        const row = document.createElement('div');
        row.className = 'dialog-row';
        row.innerHTML = `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`;
        mSum.appendChild(row);
      });
    }

    if (dialogPaymentNotice && dialogPaymentNoticeText) {
      if (paidStatus === 'paid') {
        dialogPaymentNotice.hidden = false;
        dialogPaymentNotice.className = 'dialog-deposit-status notice notice-success';
        dialogPaymentNoticeText.textContent = 'Deposit received; your hold is awaiting confirmation.';
      } else if (paidStatus === 'skipped') {
        dialogPaymentNotice.hidden = false;
        dialogPaymentNotice.className = 'dialog-deposit-status notice notice-warn';
        dialogPaymentNoticeText.textContent = 'Deposit checkout skipped. We will arrange deposit details on WhatsApp.';
      } else if (paidStatus === 'unverified') {
        dialogPaymentNotice.hidden = false;
        dialogPaymentNotice.className = 'dialog-deposit-status notice notice-warn';
        dialogPaymentNoticeText.textContent = 'Payment awaiting verification. We will verify your transaction shortly.';
      } else {
        dialogPaymentNotice.hidden = true;
      }
    }

    if (typeof confirmDialog.showModal === 'function') {
      confirmDialog.showModal();
    } else {
      confirmDialog.setAttribute('open', '');
    }

    if (dialogCloseBtn) {
      setTimeout(() => dialogCloseBtn.focus(), 50);
    }
  }

  function closeConfirmationDialog() {
    if (!confirmDialog) return;
    if (typeof confirmDialog.close === 'function') {
      confirmDialog.close();
    } else {
      confirmDialog.removeAttribute('open');
    }

    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
    }
  }

  /* --------------------------------------------------------------------------
     12. Event Listeners & Bootstrapping
     -------------------------------------------------------------------------- */
  function bindEvents() {
    // Strip prev/next day navigation
    if (stripPrevBtn) {
      stripPrevBtn.addEventListener('click', () => {
        if (!hasValidConfig || !config) return;
        const prev = addDays(selectedDate, -1);
        if (prev >= config.today) selectDate(prev, true);
      });
    }
    if (stripNextBtn) {
      stripNextBtn.addEventListener('click', () => {
        if (!hasValidConfig || !config) return;
        const max = addDays(config.today, config.maxDaysAhead);
        const next = addDays(selectedDate, 1);
        if (next <= max) selectDate(next, true);
      });
    }

    // Date picker shortcut input
    if (dateJumpInput) {
      dateJumpInput.addEventListener('change', () => {
        if (dateJumpInput.value && hasValidConfig) {
          selectDate(dateJumpInput.value, true);
        }
      });
    }

    // Flexible hour button
    if (reserveFlexibleBtn) {
      reserveFlexibleBtn.addEventListener('click', () => {
        if (!hasValidConfig) return;
        selectSlotAndFocus(selectedDate, 'flexible');
      });
    }

    // Form submission
    if (form) {
      form.addEventListener('submit', handleFormSubmit);
    }

    // Synchronize inputs on change
    if (fDate) {
      fDate.addEventListener('change', () => {
        if (fDate.value && hasValidConfig) selectDate(fDate.value, true);
      });
    }

    if (fTime) {
      fTime.addEventListener('change', () => {
        selectedTime = fTime.value;
        if (slotsBody) {
          slotsBody.querySelectorAll('.slot-row').forEach(row => {
            row.classList.toggle('is-selected', row.dataset.slotTime === selectedTime);
          });
        }
        updateSelectionSummary();
        clearFieldError('f-time');
      });
    }

    // Live validation cleanup on user input
    ['f-name', 'f-contact', 'f-practice', 'f-date'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => clearFieldError(id));
        el.addEventListener('change', () => clearFieldError(id));
      }
    });
    if (fLady) {
      fLady.addEventListener('change', () => clearFieldError('f-lady'));
    }

    // Confirmation dialog close handlers
    if (dialogCloseBtn) {
      dialogCloseBtn.addEventListener('click', closeConfirmationDialog);
    }
    if (confirmDialog) {
      confirmDialog.addEventListener('cancel', () => {
        closeConfirmationDialog();
      });
    }

    // Global calendar retry button
    if (calendarRetryBtn) {
      calendarRetryBtn.addEventListener('click', () => {
        loadConfig();
      });
    }

    // Escape key safety for dialog
    document.addEventListener('keydown', e => {
      if ((e.key === 'Escape' || e.key === 'Esc') && confirmDialog && confirmDialog.open) {
        e.preventDefault();
        closeConfirmationDialog();
      }
    });

    // Periodic availability check
    setInterval(() => {
      if (!document.hidden && !isSubmitting && hasValidConfig && selectedDate) {
        loadSlots(selectedDate);
      }
    }, 120000);
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function init() {
    bindEvents();
    loadConfig();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return BookingLogic;
});
