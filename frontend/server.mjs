import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const PORT = Number(process.env.PORT || 4173);
const DIST_DIR = path.resolve(process.cwd(), 'dist');
const CANONICAL_SITE_URL = (process.env.CANONICAL_SITE_URL || process.env.VITE_SITE_URL || '').trim().replace(/\/+$/, '');
const RAILWAY_HOST_RE = /\.up\.railway\.app$/i;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function getHost(req) {
  const forwardedHost = req.headers['x-forwarded-host'];
  const rawHost = typeof forwardedHost === 'string'
    ? forwardedHost.split(',')[0].trim()
    : Array.isArray(forwardedHost)
      ? forwardedHost[0]
      : req.headers.host || '';
  return String(rawHost).split(':')[0].toLowerCase();
}

function isRailwayHost(host) {
  return !!host && RAILWAY_HOST_RE.test(host);
}

function buildCanonicalUrl(reqUrl) {
  if (!CANONICAL_SITE_URL) return null;
  try {
    const base = new URL(CANONICAL_SITE_URL);
    const url = new URL(reqUrl || '/', base);
    return url.toString();
  } catch {
    return null;
  }
}

function safeJoin(baseDir, requestPath) {
  let decoded = requestPath;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  const normalized = path.normalize(decoded).replace(/^([/\\])+/, '');
  const resolved = path.resolve(baseDir, normalized);
  const relative = path.relative(baseDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

async function resolveStaticFile(requestPath) {
  const cleanPath = requestPath === '/' ? '/index.html' : requestPath;
  const candidates = [
    safeJoin(DIST_DIR, cleanPath),
    safeJoin(DIST_DIR, `${cleanPath}.html`),
    safeJoin(DIST_DIR, path.posix.join(cleanPath, 'index.html')),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }

  const fallback = path.join(DIST_DIR, 'index.html');
  return (await fileExists(fallback)) ? fallback : null;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

const server = http.createServer(async (req, res) => {
  const method = String(req.method || 'GET').toUpperCase();
  const requestUrl = req.url || '/';
  const host = getHost(req);

  if (CANONICAL_SITE_URL && isRailwayHost(host)) {
    const target = buildCanonicalUrl(requestUrl);
    if (target) {
      res.statusCode = 308;
      res.setHeader('Location', target);
      res.setHeader('Cache-Control', 'no-store');
      res.end();
      return;
    }
  }

  if (method !== 'GET' && method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Allow', 'GET, HEAD');
    res.end('Method Not Allowed');
    return;
  }

  const pathname = new URL(requestUrl, 'http://localhost').pathname;
  const filePath = await resolveStaticFile(pathname);
  if (!filePath) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not Found');
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', contentType(filePath));
  res.setHeader('Cache-Control', path.extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable');

  if (method === 'HEAD') {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Frontend server running on http://0.0.0.0:${PORT}`);
  if (CANONICAL_SITE_URL) {
    console.log(`Canonical site URL: ${CANONICAL_SITE_URL}`);
  }
});
