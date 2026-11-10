const { AwsClient } = require('aws4fetch');

/**
 * Validates raw bytes against known image magic headers:
 * - JPEG: FF D8 FF
 * - PNG:  89 50 4E 47 0D 0A 1A 0A
 * - WebP: RIFF (bytes 0-3) and WEBP (bytes 8-11)
 */
function detectImageType(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 12) {
    return null;
  }
  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WebP
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && // RIFF
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50  // WEBP
  ) {
    return 'image/webp';
  }
  return null;
}

const MIME_TO_EXTENSIONS = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
};

function isValidExtensionForMime(ext, mimeType) {
  const allowed = MIME_TO_EXTENSIONS[mimeType] || [];
  return allowed.includes(String(ext).toLowerCase());
}

/**
 * Ensures pathname strictly matches applications/:sessionId/:uuid.:ext
 * Disallows directory traversal, arbitrary paths, and foreign sessions.
 */
function parseAndValidatePathname(pathname, expectedSessionId) {
  if (typeof pathname !== 'string') return null;
  const trimmed = pathname.trim().replace(/^\/+/, '');
  // Match applications/SESSION_ID/UUID.EXT
  // UUID format: standard 8-4-4-4-12 hex or alphanumeric identifier
  const match = /^applications\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\.(jpg|jpeg|png|webp)$/i.exec(trimmed);
  if (!match) return null;
  const [, sessId, uuid, ext] = match;
  if (expectedSessionId && sessId !== expectedSessionId) return null;
  // Ensure uuid is not a path traversal component
  if (uuid === '.' || uuid === '..' || uuid.includes('/')) return null;
  return {
    pathname: `applications/${sessId}/${uuid}.${ext.toLowerCase()}`,
    sessionId: sessId,
    uuid,
    ext: ext.toLowerCase(),
  };
}

class DisabledStorage {
  constructor(reason = 'R2 storage credentials not configured') {
    this.enabled = false;
    this.reason = reason;
  }
  async put() { throw new Error(this.reason); }
  async get() { throw new Error(this.reason); }
  async head() { throw new Error(this.reason); }
  async delete() { throw new Error(this.reason); }
  async list() { return []; }
}

class MemoryStorage {
  constructor() {
    this.enabled = true;
    this.files = new Map();
  }

  async put(pathname, data, contentType = 'application/octet-stream') {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.files.set(pathname, {
      data: buf,
      contentType,
      contentLength: buf.length,
      updatedAt: Date.now(),
    });
    return { pathname };
  }

  async get(pathname) {
    const file = this.files.get(pathname);
    if (!file) return null;
    return {
      contentType: file.contentType,
      contentLength: file.contentLength,
      data: file.data,
    };
  }

  async head(pathname) {
    const file = this.files.get(pathname);
    if (!file) return null;
    return {
      contentType: file.contentType,
      contentLength: file.contentLength,
    };
  }

  async delete(pathname) {
    this.files.delete(pathname);
    return true;
  }

  async list(prefix = '') {
    const keys = [];
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) keys.push(key);
    }
    return keys;
  }
}

class R2Storage {
  constructor({ accountId, accessKeyId, secretAccessKey, bucket }) {
    this.accountId = accountId;
    this.bucket = bucket;
    this.enabled = Boolean(accountId && accessKeyId && secretAccessKey && bucket);
    if (this.enabled) {
      this.client = new AwsClient({
        accessKeyId,
        secretAccessKey,
        service: 's3',
        region: 'auto',
        retries: 0,
      });
    }
  }

  endpoint(pathname = '') {
    const cleanPath = pathname.replace(/^\/+/, '');
    return `https://${this.accountId}.r2.cloudflarestorage.com/${this.bucket}/${cleanPath}`;
  }

  async put(pathname, data, contentType = 'application/octet-stream') {
    if (!this.enabled) throw new Error('R2 storage is not configured');
    const url = this.endpoint(pathname);
    const res = await this.client.fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body: data,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`R2 put failed (${res.status}): ${errText}`);
    }
    return { pathname };
  }

  async get(pathname) {
    if (!this.enabled) throw new Error('R2 storage is not configured');
    const url = this.endpoint(pathname);
    const res = await this.client.fetch(url, { method: 'GET' });
    if (res.status === 404) return null;
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`R2 get failed (${res.status}): ${errText}`);
    }
    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const contentLength = Number(res.headers.get('content-length') || 0);
    const arrayBuffer = await res.arrayBuffer();
    return {
      contentType,
      contentLength,
      data: Buffer.from(arrayBuffer),
    };
  }

  async head(pathname) {
    if (!this.enabled) throw new Error('R2 storage is not configured');
    const url = this.endpoint(pathname);
    const res = await this.client.fetch(url, { method: 'HEAD' });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return {
      contentType: res.headers.get('content-type') || 'application/octet-stream',
      contentLength: Number(res.headers.get('content-length') || 0),
    };
  }

  async delete(pathname) {
    if (!this.enabled) throw new Error('R2 storage is not configured');
    const url = this.endpoint(pathname);
    const res = await this.client.fetch(url, { method: 'DELETE' });
    if (res.status === 404 || res.status === 204 || res.ok) {
      return true;
    }
    const errText = await res.text().catch(() => '');
    throw new Error(`R2 delete failed (${res.status}): ${errText}`);
  }

  async list(prefix = '') {
    if (!this.enabled) return [];
    const url = `https://${this.accountId}.r2.cloudflarestorage.com/${this.bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}`;
    const res = await this.client.fetch(url, { method: 'GET' });
    if (!res.ok) return [];
    const xml = await res.text();
    const keys = [];
    const keyRegex = /<Key>(.*?)<\/Key>/g;
    let match;
    while ((match = keyRegex.exec(xml)) !== null) {
      keys.push(match[1]);
    }
    return keys;
  }
}

/**
 * Cloudflare Worker native R2 bucket binding adapter (if binding provided)
 */
class R2BindingStorage {
  constructor(binding) {
    this.binding = binding;
    this.enabled = Boolean(binding && typeof binding.put === 'function');
  }

  async put(pathname, data, contentType = 'application/octet-stream') {
    if (!this.enabled) throw new Error('R2 binding is not available');
    const cleanPath = pathname.replace(/^\/+/, '');
    await this.binding.put(cleanPath, data, {
      httpMetadata: { contentType },
    });
    return { pathname: cleanPath };
  }

  async get(pathname) {
    if (!this.enabled) throw new Error('R2 binding is not available');
    const cleanPath = pathname.replace(/^\/+/, '');
    const obj = await this.binding.get(cleanPath);
    if (!obj) return null;
    const arrayBuffer = await obj.arrayBuffer();
    return {
      contentType: obj.httpMetadata?.contentType || 'application/octet-stream',
      contentLength: obj.size,
      data: Buffer.from(arrayBuffer),
    };
  }

  async head(pathname) {
    if (!this.enabled) throw new Error('R2 binding is not available');
    const cleanPath = pathname.replace(/^\/+/, '');
    const obj = await this.binding.head(cleanPath);
    if (!obj) return null;
    return {
      contentType: obj.httpMetadata?.contentType || 'application/octet-stream',
      contentLength: obj.size,
    };
  }

  async delete(pathname) {
    if (!this.enabled) throw new Error('R2 binding is not available');
    const cleanPath = pathname.replace(/^\/+/, '');
    await this.binding.delete(cleanPath);
    return true;
  }

  async list(prefix = '') {
    if (!this.enabled) return [];
    const res = await this.binding.list({ prefix });
    return (res.objects || []).map(o => o.key);
  }
}

function createStorage(config = {}) {
  if (config.storage) return config.storage;
  if (config.binding && typeof config.binding.put === 'function') {
    return new R2BindingStorage(config.binding);
  }
  const accountId = config.accountId || process.env.R2_ACCOUNT_ID;
  const accessKeyId = config.accessKeyId || process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = config.secretAccessKey || process.env.R2_SECRET_ACCESS_KEY;
  const bucket = config.bucket || process.env.R2_BUCKET;

  if (accountId && accessKeyId && secretAccessKey && bucket) {
    return new R2Storage({ accountId, accessKeyId, secretAccessKey, bucket });
  }
  return new DisabledStorage();
}

module.exports = {
  detectImageType,
  isValidExtensionForMime,
  parseAndValidatePathname,
  createStorage,
  DisabledStorage,
  MemoryStorage,
  R2Storage,
  R2BindingStorage,
  MAX_PHOTO_BYTES: 5242880, // 5 MiB
  MAX_PHOTOS_PER_SESSION: 5,
};
