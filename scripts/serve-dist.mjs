import {createReadStream, existsSync, realpathSync, statSync} from 'node:fs';
import {createServer} from 'node:http';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_PORT = 41731;
const DEFAULT_IDLE_MS = 10 * 60 * 1000;
const HOST = '127.0.0.1';
const HEALTH_PATH = '/__portal_lab_health';
const KEEPALIVE_PATH = '/__portal_lab_keepalive';

const mimeTypes = new Map([
  ['.avif', 'image/avif'],
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function readArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function readPositiveInteger(name, fallback) {
  const parsed = Number.parseInt(readArgument(name, String(fallback)), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const port = readPositiveInteger('--port', DEFAULT_PORT);
const idleMilliseconds = readPositiveInteger('--idle-ms', DEFAULT_IDLE_MS);
const requestedDistRoot = path.resolve(readArgument('--root', path.join(process.cwd(), 'dist')));
const requestedIndexPath = path.join(requestedDistRoot, 'index.html');

if (!existsSync(requestedIndexPath)) {
  console.error(`Portal Field Laboratory build not found at ${requestedIndexPath}`);
  process.exit(1);
}

const distRoot = realpathSync(requestedDistRoot);
const indexPath = path.join(distRoot, 'index.html');

let lastActivity = Date.now();
let stopping = false;

function sendText(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

function resolveRequestPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relativePath = decoded.replace(/^[/\\]+/, '').split('/').join(path.sep);
  const candidate = path.resolve(distRoot, relativePath);
  if (!isInsideDist(candidate)) {
    return null;
  }
  return candidate;
}

function isInsideDist(candidate) {
  const relativePath = path.relative(distRoot, candidate);
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== '..' &&
      !path.isAbsolute(relativePath))
  );
}

function serveFile(request, response, filePath) {
  const stats = statSync(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const isEntryDocument = filePath === indexPath;

  const hasContentHash = /-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(path.basename(filePath));
  response.writeHead(200, {
    'Cache-Control':
      !isEntryDocument && hasContentHash
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    'Content-Length': stats.size,
    'Content-Type': mimeTypes.get(extension) ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  const stream = createReadStream(filePath);
  stream.on('error', () => {
    if (!response.headersSent) {
      sendText(response, 500, 'Unable to read the requested file.');
    } else {
      response.destroy();
    }
  });
  stream.pipe(response);
}

const server = createServer((request, response) => {
  lastActivity = Date.now();

  let requestUrl;
  try {
    requestUrl = new URL(request.url ?? '/', `http://${HOST}:${port}`);
  } catch {
    sendText(response, 400, 'Invalid request URL.');
    return;
  }
  if (requestUrl.pathname === HEALTH_PATH) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendText(response, 405, 'Method not allowed.', {Allow: 'GET, HEAD'});
      return;
    }

    const body = JSON.stringify({app: 'portal-field-laboratory', status: 'ok'});
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Portal-Lab-Server': '1',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
    return;
  }

  if (requestUrl.pathname === KEEPALIVE_PATH) {
    if (request.method !== 'POST') {
      sendText(response, 405, 'Method not allowed.', {Allow: 'POST'});
      return;
    }
    response.writeHead(204, {'Cache-Control': 'no-store'});
    response.end();
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendText(response, 405, 'Method not allowed.', {Allow: 'GET, HEAD'});
    return;
  }

  let filePath = resolveRequestPath(requestUrl.pathname);
  if (!filePath) {
    sendText(response, 400, 'Invalid path.');
    return;
  }

  try {
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      const acceptsHtml = (request.headers.accept ?? '').includes('text/html');
      const isExtensionless = path.extname(filePath) === '';
      if (acceptsHtml || isExtensionless) {
        filePath = indexPath;
      } else {
        sendText(response, 404, 'Not found.');
        return;
      }
    }

    const realFilePath = realpathSync(filePath);
    if (!isInsideDist(realFilePath)) {
      sendText(response, 403, 'Access denied.');
      return;
    }

    serveFile(request, response, realFilePath);
  } catch {
    sendText(response, 500, 'Unable to serve the requested file.');
  }
});

function stopServer() {
  if (stopping) {
    return;
  }
  stopping = true;

  server.close(() => process.exit(0));
  server.closeIdleConnections?.();

  const forceCloseTimer = setTimeout(() => {
    server.closeAllConnections?.();
    process.exit(0);
  }, 1000);
  forceCloseTimer.unref();
}

const idleTimer = setInterval(() => {
  if (Date.now() - lastActivity >= idleMilliseconds) {
    stopServer();
  }
}, Math.min(15_000, idleMilliseconds));
idleTimer.unref();

server.on('clientError', (_error, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

server.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});

server.listen(port, HOST, () => {
  console.log(`Portal Field Laboratory ready at http://${HOST}:${port}/`);
});

process.on('SIGINT', stopServer);
process.on('SIGTERM', stopServer);
