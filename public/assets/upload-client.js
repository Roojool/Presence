/**
 * Presence — Direct Single Photo Upload Client
 *
 * Implements direct XHR streaming upload to the same-origin backend
 * endpoint (POST /api/applications/upload) with real-time progress callbacks.
 *
 * @param {string} pathname - Server-authorized path: applications/SESSION_ID/UUID.ext
 * @param {Blob|File} file - Raw binary image file (<= 5MiB)
 * @param {object} options
 * @param {object|string} options.clientPayload - JSON object or string with { sessionId, token }
 * @param {function} [options.onUploadProgress] - Callback ({ loaded, total, percentage })
 * @param {AbortSignal} [options.signal] - Optional abort signal
 * @returns {Promise<{ pathname: string }>}
 */
export function upload(pathname, file, options = {}) {
  return new Promise((resolve, reject) => {
    if (!pathname || typeof pathname !== 'string') {
      return reject(new TypeError('A valid destination pathname is required'));
    }
    if (!file) {
      return reject(new TypeError('A file or Blob is required for upload'));
    }

    let payload = options.clientPayload;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch (err) {
        return reject(new Error('Invalid clientPayload JSON: ' + err.message));
      }
    }

    const sessionId = payload?.sessionId;
    const token = payload?.token;

    if (!sessionId || !token) {
      return reject(new Error('clientPayload must include both sessionId and token'));
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/applications/upload', true);

    const contentType = file.type || 'application/octet-stream';
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('X-Upload-Session', sessionId);
    xhr.setRequestHeader('X-Upload-Pathname', pathname);

    if (options.signal) {
      if (options.signal.aborted) {
        return reject(new DOMException('Upload aborted', 'AbortError'));
      }
      options.signal.addEventListener('abort', () => {
        xhr.abort();
        reject(new DOMException('Upload aborted', 'AbortError'));
      });
    }

    if (xhr.upload && typeof options.onUploadProgress === 'function') {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentage = Math.round((e.loaded / e.total) * 100);
          options.onUploadProgress({
            loaded: e.loaded,
            total: e.total,
            percentage,
          });
        }
      });
    }

    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch (_) {
        data = {};
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({
          pathname: data.pathname || pathname,
          ...data,
        });
      } else {
        const errorMsg = data.error || `Upload failed with HTTP ${xhr.status}`;
        const err = new Error(errorMsg);
        err.status = xhr.status;
        err.field = data.field;
        reject(err);
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error during photo upload. Please check connection.'));
    };

    xhr.ontimeout = () => {
      reject(new Error('Photo upload timed out. Please try again.'));
    };

    xhr.send(file);
  });
}
