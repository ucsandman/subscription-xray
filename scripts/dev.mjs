// The one command. `npm start` -> serves the app, waits until it answers, opens
// the browser, streams a log, and dies cleanly on Ctrl+C. No second terminal, no
// install step (this project has zero dependencies on purpose).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

const ROOT = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const PORT = Number(process.env.PORT || 5173);   // user env always wins
const HOST = process.env.HOST || '127.0.0.1';    // local-only by default
const OPEN = process.env.OPEN !== '0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

// Same policy the deployed site sends (see vercel.json), so what you test
// locally is what ships. connect-src 'none' is the load-bearing one: it makes
// "your statement never leaves the browser" a rule the browser enforces, not a
// promise in the copy.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

const server = createServer(async (req, res) => {
  const started = Date.now();
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');

  // Contain the served path to ROOT: a request for /../../.env must not escape.
  const target = normalize(join(ROOT, rel));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    log(req, 403, started);
    return;
  }

  try {
    const info = await stat(target);
    if (info.isDirectory()) throw new Error('directory');
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target)] || 'application/octet-stream',
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    });
    res.end(body);
    log(req, 200, started);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    log(req, 404, started);
  }
});

function log(req, status, started) {
  const mark = status >= 400 ? '!' : '·';
  console.log(`[app] ${mark} ${status} ${req.method} ${req.url} ${Date.now() - started}ms`);
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[app] port ${PORT} is already in use. Free it, or run: PORT=5174 npm start`);
  } else {
    console.error('[app] server error:', err.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, async () => {
  const url = `http://${HOST}:${PORT}/`;
  const healthy = await waitForHealth(url);
  if (!healthy) {
    console.error('[app] server did not answer its own health check.');
    process.exit(1);
  }
  console.log(`[app] ready on ${url}`);
  console.log('[app] Ctrl+C to stop.');
  if (OPEN) openBrowser(url);
});

/** Do not claim "ready" until the page actually answers. */
async function waitForHealth(url) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) return true;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

function openBrowser(url) {
  // argv arrays only — never a shell string.
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
  child.on('error', () => console.log(`[app] could not open a browser. Visit ${url}`));
  child.unref();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\n[app] shutting down.');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
