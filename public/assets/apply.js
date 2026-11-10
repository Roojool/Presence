/**
 * Presence. — Fashion & Brand Modeling Application Script (Worker E)
 *
 * Implements:
 * - Safe config loading (defaults to unavailable; disables submit until valid config)
 * - Photo management with revocable objectURLs and full state reset on selection change
 * - Strict client-side file validation (JPEG/PNG/WebP, <= 5 MB each, 1 to 5 total)
 * - Snapshotting validated inputs and disabling all form/upload controls during transfer
 * - Direct upload streaming via imported upload() from /assets/upload-client.js
 * - Expired session recovery and preservation of completed uploads on transient failure
 * - Frozen payload retry on ambiguous finalization; strict ref & receiptStatus validation
 * - Plain progress and truthful receipt copy without technical jargon or invented claims
 */

import { upload } from '/assets/upload-client.js';

// Internal state machine
export const state = {
  config: {
    loaded: false,
    enabled: false,
    maxPhotos: 5,
    maxPhotoBytes: 5242880, // 5 MiB
  },
  photos: [], // Array of { id, file, uuid, ext, previewUrl, pathname, uploaded }
  session: null, // { sessionId, token, photoCount }
  isSubmitting: false,
  pendingSubmission: null, // Holds frozen payload during ambiguous finalization
};

/* --------------------------------------------------------------------------
   0. Utilities & UI Error Helpers
   -------------------------------------------------------------------------- */

export function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'uuid_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
}

export function sanitizeExtension(filename, mimeType) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
    return ext === 'jpeg' ? 'jpeg' : ext;
  }
  if (mimeType === 'image/jpeg') return 'jpeg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function getPresenceUI() {
  if (typeof window !== 'undefined' && window.PresenceUI) {
    return window.PresenceUI;
  }
  return {
    setFieldError(id, msg) {
      if (typeof document === 'undefined') return;
      const el = document.getElementById(id);
      if (!el) return;
      el.setAttribute('aria-invalid', 'true');
      const parent = el.closest('.field') || el.parentElement;
      if (parent) {
        parent.classList.add('has-error');
        const errEl = parent.querySelector('.field-error');
        if (errEl) errEl.textContent = msg;
      }
    },
    clearFieldError(id) {
      if (typeof document === 'undefined') return;
      const el = document.getElementById(id);
      if (!el) return;
      el.removeAttribute('aria-invalid');
      const parent = el.closest('.field') || el.parentElement;
      if (parent) {
        parent.classList.remove('has-error');
        const errEl = parent.querySelector('.field-error');
        if (errEl) errEl.textContent = '';
      }
    },
    clearAllErrors(root) {
      if (typeof document === 'undefined') return;
      const scope = root || document;
      scope.querySelectorAll('[aria-invalid="true"]').forEach((el) => {
        el.removeAttribute('aria-invalid');
      });
      scope.querySelectorAll('.has-error').forEach((el) => {
        el.classList.remove('has-error');
      });
      scope.querySelectorAll('.field-error').forEach((el) => {
        el.textContent = '';
      });
    },
  };
}

/* --------------------------------------------------------------------------
   1. Submit Button & Form Controls Locking
   -------------------------------------------------------------------------- */

export function syncSubmitButton(overrideText = null) {
  if (typeof document === 'undefined') return;
  const submitBtn = document.getElementById('apply-submit-btn');
  const btnText = document.getElementById('submit-btn-text');
  if (!submitBtn) return;

  // Guard submit independently: unlocking a request must NOT enable disabled service
  const isServiceReady = state.config.loaded && state.config.enabled;
  const canSubmit = isServiceReady && !state.isSubmitting;

  submitBtn.disabled = !canSubmit;
  if (!canSubmit) {
    submitBtn.setAttribute('aria-disabled', 'true');
  } else {
    submitBtn.removeAttribute('aria-disabled');
  }

  if (btnText) {
    if (overrideText) {
      btnText.textContent = overrideText;
    } else if (state.isSubmitting) {
      btnText.textContent = state.pendingSubmission ? 'Retrying submission...' : 'Submitting application...';
    } else if (!state.config.loaded) {
      btnText.textContent = 'Service unavailable';
    } else if (!state.config.enabled) {
      btnText.textContent = 'Applications unavailable';
    } else if (state.pendingSubmission) {
      btnText.textContent = 'Retry submission';
    } else {
      btnText.textContent = 'Submit application';
    }
  }
}

export function setFormControlsDisabled(disabled) {
  if (typeof document === 'undefined') return;
  const form = document.getElementById('apply-form');
  if (!form) return;

  const inputs = form.querySelectorAll('input, textarea, button, select');
  inputs.forEach((input) => {
    if (input.id === 'a-website') return; // Honeypot remains visually hidden
    if (input.id === 'apply-submit-btn') return; // Managed by syncSubmitButton
    input.disabled = disabled;
    if (disabled) {
      input.setAttribute('aria-disabled', 'true');
    } else {
      input.removeAttribute('aria-disabled');
    }
  });

  const dropzone = document.getElementById('a-dropzone');
  if (dropzone) {
    if (disabled) {
      dropzone.setAttribute('tabindex', '-1');
      dropzone.setAttribute('aria-disabled', 'true');
      dropzone.classList.add('is-disabled');
    } else {
      dropzone.setAttribute('tabindex', '0');
      dropzone.removeAttribute('aria-disabled');
      dropzone.classList.remove('is-disabled');
    }
  }

  const removeButtons = document.querySelectorAll('.photo-thumb-remove-btn');
  removeButtons.forEach((btn) => {
    btn.disabled = disabled;
    if (disabled) btn.setAttribute('aria-disabled', 'true');
    else btn.removeAttribute('aria-disabled');
  });
}

export function showConfigUnavailable(message, showRetry = false) {
  if (typeof document === 'undefined') return;
  const banner = document.getElementById('apply-status-banner');
  if (!banner) return;

  banner.hidden = false;
  banner.className = 'apply-status-banner';
  banner.innerHTML = `
    <span>${message}</span>
    ${showRetry ? '<button type="button" class="btn-retry-config" id="btn-retry-config">Retry</button>' : ''}
  `;

  if (showRetry) {
    const retryBtn = document.getElementById('btn-retry-config');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        fetchAppConfig();
      });
    }
  }
}

export function hideConfigBanner() {
  if (typeof document === 'undefined') return;
  const banner = document.getElementById('apply-status-banner');
  if (banner) {
    banner.hidden = true;
    banner.innerHTML = '';
  }
}

/* --------------------------------------------------------------------------
   2. Dynamic Configuration (/api/config)
   -------------------------------------------------------------------------- */

export async function fetchAppConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) {
      throw new Error(`Config request failed (HTTP ${res.status})`);
    }

    const data = await res.json();
    if (!data || typeof data.applications !== 'object' || data.applications === null) {
      throw new Error('Config missing applications settings');
    }

    state.config.loaded = true;
    state.config.enabled = Boolean(data.applications.enabled);

    if (data.applications.maxPhotos) {
      state.config.maxPhotos = Number(data.applications.maxPhotos);
    }
    if (data.applications.maxPhotoBytes) {
      state.config.maxPhotoBytes = Number(data.applications.maxPhotoBytes);
    }

    if (!state.config.enabled) {
      showConfigUnavailable(
        'Applications are currently unavailable. Please check back later or connect with Rujul Talekar on <a href="https://www.linkedin.com/in/rujul-talekar/" target="_blank" rel="noopener noreferrer" style="color:var(--text-ivory);text-decoration:underline;">LinkedIn</a>.'
      );
    } else {
      hideConfigBanner();
    }
  } catch (_) {
    state.config.loaded = false;
    state.config.enabled = false;
    showConfigUnavailable(
      'Service temporarily unavailable. Please retry or connect with Rujul Talekar on <a href="https://www.linkedin.com/in/rujul-talekar/" target="_blank" rel="noopener noreferrer" style="color:var(--text-ivory);text-decoration:underline;">LinkedIn</a>.',
      true
    );
  } finally {
    syncSubmitButton();
  }
}

/* --------------------------------------------------------------------------
   3. Photo Selection & State Invalidation
   -------------------------------------------------------------------------- */

export function revokePhotoUrl(photo) {
  if (photo && photo.previewUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    try {
      URL.revokeObjectURL(photo.previewUrl);
    } catch (_) {}
  }
}

/**
 * When abandoning a session (e.g. adding/removing photos or session expiry):
 * Reset ALL remaining photos' uploaded flags and pathnames.
 * A new session will assign every path to the new prefix.
 */
export function invalidateSession() {
  state.session = null;
  state.pendingSubmission = null;
  for (const p of state.photos) {
    p.uploaded = false;
    p.pathname = null;
  }
}

export function clearAllPhotos() {
  state.photos.forEach(revokePhotoUrl);
  state.photos = [];
  invalidateSession();
  renderPhotoPreviews();
}

export function validateFile(file) {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const allowedExts = ['jpg', 'jpeg', 'png', 'webp'];

  const mimeValid = allowedMimes.includes(file.type);
  const extValid = allowedExts.includes(ext);

  if (!mimeValid && !extValid) {
    return {
      valid: false,
      error: `"${file.name}" is not a supported format. Please upload JPEG, PNG, or WebP images.`,
    };
  }

  if (file.size > state.config.maxPhotoBytes) {
    const maxMb = (state.config.maxPhotoBytes / 1048576).toFixed(0);
    return {
      valid: false,
      error: `"${file.name}" (${formatBytes(file.size)}) exceeds the maximum allowed size of ${maxMb} MB.`,
    };
  }

  return { valid: true };
}

export function handleFilesAdded(fileList) {
  if (state.isSubmitting || state.pendingSubmission) return;

  const ui = getPresenceUI();
  ui.clearFieldError('a-photos');

  if (!fileList || fileList.length === 0) return;

  const currentCount = state.photos.length;
  const newFiles = Array.from(fileList);

  if (currentCount + newFiles.length > state.config.maxPhotos) {
    ui.setFieldError(
      'a-photos',
      `You may select at most ${state.config.maxPhotos} photos (currently have ${currentCount}).`
    );
    return;
  }

  for (const file of newFiles) {
    const check = validateFile(file);
    if (!check.valid) {
      ui.setFieldError('a-photos', check.error);
      return;
    }
  }

  // Adding photos invalidates previous session and resets all remaining upload flags
  invalidateSession();

  for (const file of newFiles) {
    const uuid = generateUUID();
    const ext = sanitizeExtension(file.name, file.type);
    const previewUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? URL.createObjectURL(file)
      : '';

    state.photos.push({
      id: 'photo_' + uuid,
      file,
      uuid,
      ext,
      previewUrl,
      pathname: null,
      uploaded: false,
    });
  }

  renderPhotoPreviews();
}

export function removePhoto(id) {
  if (state.isSubmitting || state.pendingSubmission) return;

  const ui = getPresenceUI();
  ui.clearFieldError('a-photos');

  const idx = state.photos.findIndex((p) => p.id === id);
  if (idx !== -1) {
    const [removed] = state.photos.splice(idx, 1);
    revokePhotoUrl(removed);

    // Removing photos invalidates previous session and resets all remaining upload flags
    invalidateSession();
    renderPhotoPreviews();
  }
}

export function renderPhotoPreviews() {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('photo-previews');
  if (!container) return;

  container.innerHTML = '';

  state.photos.forEach((photo, index) => {
    const card = document.createElement('div');
    card.className = 'photo-thumb-card';
    card.id = photo.id;

    if (photo.previewUrl) {
      const img = document.createElement('img');
      img.src = photo.previewUrl;
      img.alt = `Photo ${index + 1} of ${state.photos.length}: ${photo.file.name}`;
      card.appendChild(img);
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'photo-thumb-remove-btn';
    removeBtn.setAttribute(
      'aria-label',
      `Remove photo ${index + 1}: ${photo.file.name}`
    );
    removeBtn.innerHTML = '&times;';
    removeBtn.disabled = state.isSubmitting || Boolean(state.pendingSubmission);
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removePhoto(photo.id);
    });
    card.appendChild(removeBtn);

    const meta = document.createElement('span');
    meta.className = 'photo-thumb-meta';
    meta.textContent = `${photo.file.name} (${formatBytes(photo.file.size)})`;
    card.appendChild(meta);

    container.appendChild(card);
  });
}

/* --------------------------------------------------------------------------
   4. Field Validation
   -------------------------------------------------------------------------- */

export function validateApplicationForm() {
  const ui = getPresenceUI();
  if (typeof document === 'undefined') return true;
  const form = document.getElementById('apply-form');
  ui.clearAllErrors(form);

  const nameEl = document.getElementById('a-name');
  const emailEl = document.getElementById('a-email');
  const phoneEl = document.getElementById('a-phone');
  const cityEl = document.getElementById('a-city');
  const ageEl = document.getElementById('a-age');
  const expEl = document.getElementById('a-experience');
  const portEl = document.getElementById('a-portfolio');
  const socEl = document.getElementById('a-social');
  const consentEl = document.getElementById('a-consent');

  const invalidElements = [];

  const nameVal = (nameEl?.value || '').trim();
  if (nameVal.length < 2) {
    ui.setFieldError('a-name', 'Please share your full name (minimum 2 characters).');
    if (nameEl) invalidElements.push(nameEl);
  }

  const emailVal = (emailEl?.value || '').trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(emailVal)) {
    ui.setFieldError('a-email', 'Please enter a valid email address.');
    if (emailEl) invalidElements.push(emailEl);
  }

  const phoneVal = (phoneEl?.value || '').trim();
  const digits = phoneVal.replace(/\D/g, '');
  const phoneRegex = /^[+\d\s()-]+$/;
  if (digits.length < 7 || digits.length > 15 || !phoneRegex.test(phoneVal)) {
    ui.setFieldError('a-phone', 'Please enter a valid phone number (7 to 15 digits).');
    if (phoneEl) invalidElements.push(phoneEl);
  }

  const cityVal = (cityEl?.value || '').trim();
  if (cityVal.length < 2) {
    ui.setFieldError('a-city', 'Please share your base city.');
    if (cityEl) invalidElements.push(cityEl);
  }

  const ageVal = parseInt(ageEl?.value, 10);
  if (isNaN(ageVal) || ageVal < 18 || ageVal > 120) {
    ui.setFieldError('a-age', 'Applicants must be 18 or older.');
    if (ageEl) invalidElements.push(ageEl);
  }

  const expVal = (expEl?.value || '').trim();
  if (expVal.length < 10) {
    ui.setFieldError('a-experience', 'Please share a brief statement or experience (at least 10 characters).');
    if (expEl) invalidElements.push(expEl);
  }

  const portVal = (portEl?.value || '').trim();
  if (portVal && !/^https:\/\/[^\s$.?#].[^\s]*$/i.test(portVal)) {
    ui.setFieldError('a-portfolio', 'Portfolio must start with https://');
    if (portEl) invalidElements.push(portEl);
  }

  const socVal = (socEl?.value || '').trim();
  if (!/^@?[a-zA-Z0-9._]{1,30}$/.test(socVal)) {
    ui.setFieldError('a-social', 'Please enter a valid Instagram username.');
    if (socEl) invalidElements.push(socEl);
  }

  if (!consentEl || !consentEl.checked) {
    ui.setFieldError('a-consent', 'Consent is required for application review.');
    if (consentEl) invalidElements.push(consentEl);
  }

  if (invalidElements.length > 0) {
    const firstBad = invalidElements[0];
    if (typeof firstBad.focus === 'function') {
      firstBad.focus();
    }
    return false;
  }

  return true;
}

/* --------------------------------------------------------------------------
   5. Progress & Feedback Elements
   -------------------------------------------------------------------------- */

export function updateProgress(percent, labelText) {
  if (typeof document === 'undefined') return;
  const wrap = document.getElementById('apply-progress-wrap');
  const label = document.getElementById('apply-progress-label');
  const fill = document.getElementById('apply-progress-fill');
  const pct = document.getElementById('apply-progress-percent');

  if (wrap) wrap.hidden = false;
  if (label) label.textContent = labelText;
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  if (pct) pct.textContent = `${clamped}%`;
  if (fill) fill.style.width = `${clamped}%`;
}

export function hideProgress() {
  if (typeof document === 'undefined') return;
  const wrap = document.getElementById('apply-progress-wrap');
  if (wrap) wrap.hidden = true;
}

export function showFormAlert(message, type = 'error') {
  if (typeof document === 'undefined') return;
  const alertEl = document.getElementById('apply-form-alert');
  if (!alertEl) return;
  alertEl.hidden = false;
  alertEl.className = `notice notice-${type} apply-form-alert`;
  alertEl.textContent = message;
}

export function hideFormAlert() {
  if (typeof document === 'undefined') return;
  const alertEl = document.getElementById('apply-form-alert');
  if (alertEl) {
    alertEl.hidden = true;
    alertEl.textContent = '';
  }
}

/* --------------------------------------------------------------------------
   6. Session & Upload Pipeline
   -------------------------------------------------------------------------- */

export async function ensureSession() {
  // If valid active session exists with matching photoCount, keep it
  if (state.session && state.session.photoCount === state.photos.length) {
    return state.session;
  }

  updateProgress(10, 'Submitting application');

  const honeypot = typeof document !== 'undefined' ? document.getElementById('a-website') : null;
  const honeypotVal = honeypot ? honeypot.value : '';

  const res = await fetch('/api/applications/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      photoCount: state.photos.length,
      website: honeypotVal,
    }),
  });

  if (!res.ok) {
    let errData = {};
    try {
      errData = await res.json();
    } catch (_) {}

    if (res.status === 503) {
      throw new Error(
        'Applications are currently unavailable. Please retry shortly.'
      );
    }
    if (res.status === 429) {
      throw new Error('Too many attempts. Please wait a few moments before trying again.');
    }
    throw new Error(errData.error || `Unable to establish session (HTTP ${res.status}).`);
  }

  const data = await res.json();
  if (!data.sessionId || !data.token) {
    throw new Error('Invalid session response from server.');
  }

  state.session = {
    sessionId: data.sessionId,
    token: data.token,
    photoCount: state.photos.length,
  };

  // Assign every path to the new session prefix
  state.photos.forEach((photo) => {
    photo.pathname = `applications/${state.session.sessionId}/${photo.uuid}.${photo.ext}`;
  });

  return state.session;
}

export async function uploadPendingPhotos(session) {
  const total = state.photos.length;

  for (let i = 0; i < total; i++) {
    const photo = state.photos[i];

    // Preserve completed uploads for unchanged selection; skip already uploaded
    if (photo.uploaded && photo.pathname) {
      continue;
    }

    const startPct = 15 + (i / total) * 65;
    const endPct = 15 + ((i + 1) / total) * 65;

    updateProgress(startPct, `Uploading photos (${i + 1} of ${total})`);

    try {
      const result = await upload(photo.pathname, photo.file, {
        access: 'private',
        handleUploadUrl: '/api/applications/upload',
        clientPayload: JSON.stringify({
          sessionId: session.sessionId,
          token: session.token,
        }),
        onUploadProgress: ({ percentage }) => {
          const filePct = percentage || 0;
          const current = startPct + (filePct / 100) * (endPct - startPct);
          updateProgress(current, `Uploading photos (${i + 1} of ${total})`);
        },
      });

      photo.uploaded = true;
      if (result && result.pathname) {
        photo.pathname = result.pathname;
      }
    } catch (err) {
      // Check for expired session: 401 or session expired error
      if (err.status === 401 || (err.message && err.message.toLowerCase().includes('session'))) {
        invalidateSession();
        throw new Error('Upload session expired. Re-establishing session and retrying...');
      }
      // For general upload failure, preserve completed uploads for unchanged selection
      throw err;
    }
  }
}

/* --------------------------------------------------------------------------
   7. Final Application Submission & Frozen Retry
   -------------------------------------------------------------------------- */

export async function submitApplication() {
  hideFormAlert();

  // Guard against duplicate submit
  if (state.isSubmitting) return;

  // If retrying an ambiguous finalization, use the EXACT frozen payload
  if (state.pendingSubmission) {
    state.isSubmitting = true;
    syncSubmitButton();
    setFormControlsDisabled(true);
    updateProgress(85, 'Submitting application');
    await executeFinalize(state.pendingSubmission);
    return;
  }

  // Pre-session validation of all fields and files
  if (!validateApplicationForm()) {
    return;
  }

  // Snapshot validated fields and photos BEFORE awaiting async operations
  const snapshot = typeof document !== 'undefined'
    ? {
        name: (document.getElementById('a-name')?.value || '').trim(),
        email: (document.getElementById('a-email')?.value || '').trim(),
        phone: (document.getElementById('a-phone')?.value || '').trim(),
        city: (document.getElementById('a-city')?.value || '').trim(),
        age: parseInt(document.getElementById('a-age')?.value, 10),
        experience: (document.getElementById('a-experience')?.value || '').trim(),
        portfolio: (document.getElementById('a-portfolio')?.value || '').trim() || undefined,
        social: (document.getElementById('a-social')?.value || '').trim() || undefined,
      }
    : {};

  state.isSubmitting = true;
  syncSubmitButton();
  setFormControlsDisabled(true);

  try {
    let session = await ensureSession();

    // Upload pending photos with retry resilience
    let uploadAttempts = 0;
    while (uploadAttempts < 2) {
      try {
        await uploadPendingPhotos(session);
        break;
      } catch (uploadErr) {
        if (uploadErr.message && uploadErr.message.includes('expired')) {
          uploadAttempts++;
          session = await ensureSession();
          continue;
        }
        throw uploadErr;
      }
    }

    // Freeze final payload into pendingSubmission before final network call
    state.pendingSubmission = {
      sessionId: session.sessionId,
      token: session.token,
      name: snapshot.name,
      email: snapshot.email,
      phone: snapshot.phone,
      city: snapshot.city,
      age: snapshot.age,
      experience: snapshot.experience,
      consent: true,
      photos: state.photos.map((p) => ({ pathname: p.pathname })),
      ...(snapshot.portfolio ? { portfolio: snapshot.portfolio } : {}),
      ...(snapshot.social ? { social: snapshot.social } : {}),
    };

    updateProgress(90, 'Submitting application');
    await executeFinalize(state.pendingSubmission);
  } catch (err) {
    state.isSubmitting = false;
    hideProgress();
    setFormControlsDisabled(false);
    syncSubmitButton();
    showFormAlert(err.message || 'Submission could not be completed. Please retry.');
  }
}

export async function executeFinalize(payload) {
  let res;
  try {
    res = await fetch('/api/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (_) {
    // Ambiguous network failure: retain pendingSubmission, hold editing frozen, allow retry
    state.isSubmitting = false;
    hideProgress();
    setFormControlsDisabled(true);
    syncSubmitButton('Retry submission');
    showFormAlert(
      'Network connection interrupted during submission. Your details are preserved. Click "Retry submission" to complete confirmation.',
      'warn'
    );
    return;
  }

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    // Unparseable response: ambiguous response, retain pendingSubmission, hold editing frozen
    state.isSubmitting = false;
    hideProgress();
    setFormControlsDisabled(true);
    syncSubmitButton('Retry submission');
    showFormAlert(
      'Received an unreadable confirmation response. Your application data is preserved; click "Retry submission" to verify.',
      'warn'
    );
    return;
  }

  // Definite 400 client validation errors from server: unlock editing safely
  if (res.status === 400) {
    state.pendingSubmission = null;
    state.isSubmitting = false;
    hideProgress();
    setFormControlsDisabled(false);
    syncSubmitButton('Submit application');

    if (data && data.field) {
      const ui = getPresenceUI();
      ui.setFieldError(data.field, data.error || 'Please correct this field.');
      const badEl = document.getElementById(data.field);
      if (badEl && typeof badEl.focus === 'function') badEl.focus();
    } else {
      showFormAlert(data?.error || 'Submission rejected. Please review your fields and try again.');
    }
    return;
  }

  // 401 Session expired recovery
  if (res.status === 401) {
    invalidateSession();
    state.isSubmitting = false;
    hideProgress();
    setFormControlsDisabled(false);
    syncSubmitButton('Submit application');
    showFormAlert('Your upload session has expired. Please click "Submit application" to restart a fresh session.');
    return;
  }

  if (!res.ok) {
    // Other ambiguous 5xx or server errors: retain pendingSubmission, hold editing frozen
    state.isSubmitting = false;
    hideProgress();
    setFormControlsDisabled(true);
    syncSubmitButton('Retry submission');
    showFormAlert(
      data?.error || `Server returned error (${res.status}). Your submission is preserved; please retry.`,
      'warn'
    );
    return;
  }

  // Validate reference and receipt status before treating as success!
  // Never fabricate APP-RECEIVED or default receipt status
  const ref = typeof data?.ref === 'string' ? data.ref.trim() : '';
  const receiptStatus = typeof data?.receiptStatus === 'string' ? data.receiptStatus.trim().toLowerCase() : '';
  const validStatus = ['sent', 'pending', 'failed'].includes(receiptStatus);

  if (!ref || !validStatus) {
    // Invalid success response: retain pendingSubmission, hold editing frozen
    state.isSubmitting = false;
    hideProgress();
    setFormControlsDisabled(true);
    syncSubmitButton('Retry submission');
    showFormAlert(
      'Server returned an incomplete receipt. Your application data is preserved; please click "Retry submission".',
      'warn'
    );
    return;
  }

  // Confirmed valid success!
  state.pendingSubmission = null;
  state.isSubmitting = false;
  handleSubmissionSuccess(ref, receiptStatus);
}

export function handleSubmissionSuccess(ref, receiptStatus) {
  hideProgress();
  hideFormAlert();

  if (typeof document === 'undefined') return;

  const formCard = document.getElementById('apply-form');
  const successCard = document.getElementById('apply-success-card');
  const refValEl = document.getElementById('success-ref-val');
  const receiptEl = document.getElementById('success-receipt-note');

  if (refValEl) {
    refValEl.textContent = ref;
  }

  if (receiptEl) {
    receiptEl.className = `receipt-note status-${receiptStatus}`;

    receiptEl.textContent = 'Your application is saved. Our team will contact you on WhatsApp using the number you provided.';
  }

  clearAllPhotos();

  if (formCard) {
    formCard.reset();
    formCard.hidden = true;
  }

  if (successCard) {
    successCard.hidden = false;
    successCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const focusTarget = successCard.querySelector('h2, button, a');
    if (focusTarget && typeof focusTarget.focus === 'function') {
      focusTarget.focus();
    }
  }

  setFormControlsDisabled(false);
  syncSubmitButton();
}

export function resetApplicationForm() {
  if (typeof document === 'undefined') return;
  const formCard = document.getElementById('apply-form');
  const successCard = document.getElementById('apply-success-card');

  clearAllPhotos();
  if (formCard) {
    formCard.reset();
    formCard.hidden = false;
  }
  if (successCard) {
    successCard.hidden = true;
  }

  hideFormAlert();
  hideProgress();
  setFormControlsDisabled(false);
  syncSubmitButton();

  const firstInput = document.getElementById('a-name');
  if (firstInput) firstInput.focus();
}

/* --------------------------------------------------------------------------
   8. Event Listeners & Bootstrapping
   -------------------------------------------------------------------------- */

export function initApplyPage() {
  if (typeof document === 'undefined') return;

  fetchAppConfig();

  [['a-name', 'preview-name', 'Your name'], ['a-city', 'preview-city', 'Your city'], ['a-social', 'preview-social', 'Your username']].forEach(([inputId, previewId, fallback]) => {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!input || !preview) return;
    const update = () => { preview.textContent = input.value.trim() || fallback; };
    input.addEventListener('input', update);
    input.form?.addEventListener('reset', () => setTimeout(update, 0));
    update();
  });

  const form = document.getElementById('apply-form');
  const dropzone = document.getElementById('a-dropzone');
  const fileInput = document.getElementById('a-photos');
  const resetBtn = document.getElementById('apply-reset-btn');

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submitApplication();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', resetApplicationForm);
  }

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => {
      if (state.isSubmitting || state.pendingSubmission) return;
      fileInput.click();
    });

    dropzone.addEventListener('keydown', (e) => {
      if (state.isSubmitting || state.pendingSubmission) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });

    ['dragenter', 'dragover'].forEach((eventName) => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (state.isSubmitting || state.pendingSubmission) return;
        dropzone.classList.add('is-dragover');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('is-dragover');
      });
    });

    dropzone.addEventListener('drop', (e) => {
      if (state.isSubmitting || state.pendingSubmission) return;
      const dt = e.dataTransfer;
      if (dt && dt.files) {
        handleFilesAdded(dt.files);
      }
    });

    fileInput.addEventListener('change', () => {
      if (state.isSubmitting || state.pendingSubmission) return;
      if (fileInput.files) {
        handleFilesAdded(fileInput.files);
        fileInput.value = '';
      }
    });
  }

  const fieldIds = [
    'a-name',
    'a-email',
    'a-phone',
    'a-city',
    'a-age',
    'a-experience',
    'a-portfolio',
    'a-social',
    'a-consent',
  ];

  const ui = getPresenceUI();
  fieldIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const evt = el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(evt, () => {
      ui.clearFieldError(id);
      hideFormAlert();
    });
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApplyPage);
  } else {
    initApplyPage();
  }
}
