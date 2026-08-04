// Phase 1 – Minimaler, versionierter, rein statischer Entwicklungsserver.
//
// Eigenschaften (lokaler Datenschutzmodus):
//  - bindet ausschließlich an localhost (127.0.0.1), nie an 0.0.0.0,
//  - liefert nur lokale statische Dateien aus dem Projektordner,
//  - nur GET/HEAD (keine Uploads, keine Persistenz, keine Request-Bodies),
//  - kein CORS, keine externen Verbindungen, keine Frameworks,
//  - protokolliert nur Methode/Pfad/Status (Asset-Namen), keine Dienstplandaten.
//
// Nutzung:  npm start   (=> node scripts/dev-server.mjs)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const HOST = '127.0.0.1';
const DEFAULT_PORT = 8080;

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8'
});

function reply(res, status, body, headers = {}) {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}

/**
 * Creates the static HTTP server. `root` is the directory that is served; it
 * defaults to the project root. The handler never leaves `root` (path-traversal
 * protection) and performs no network or persistence side effects.
 */
export function createStaticServer({ root = PROJECT_ROOT, log = () => {} } = {}) {
  const rootDir = resolve(root);
  return createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      log(`${req.method} ${req.url} -> 405`);
      return reply(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return reply(res, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    if (pathname === '/') pathname = '/index.html';

    const target = normalize(join(rootDir, pathname));
    if (target !== rootDir && !target.startsWith(rootDir + sep)) {
      log(`GET ${pathname} -> 403 (outside root)`);
      return reply(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    try {
      const info = await stat(target);
      if (info.isDirectory()) {
        log(`GET ${pathname} -> 403 (directory)`);
        return reply(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      const type = MIME_TYPES[extname(target).toLowerCase()] || 'application/octet-stream';
      const data = await readFile(target);
      res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Content-Length': data.length });
      res.end(req.method === 'HEAD' ? undefined : data);
      log(`GET ${pathname} -> 200 (${type})`);
    } catch {
      log(`GET ${pathname} -> 404`);
      reply(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const server = createStaticServer({ log: message => console.log(message) });
  server.listen(port, HOST, () => {
    console.log(`Dienstplananalyse (lokal, statisch) laeuft auf http://127.0.0.1:${port}`);
    console.log('Nur localhost. Keine externen Verbindungen. Keine Persistenz importierter Daten.');
  });
}
