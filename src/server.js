'use strict';

const http = require('http');
const crypto = require('crypto');
const Database = require('./Database');

/**
 * Start a local HTTP server that exposes a Database instance over a simple
 * REST-style JSON API secured with a bearer token.
 *
 * Routes
 * ──────
 *   GET    /collections           – list all collections
 *   GET    /:collection           – get all entries in a collection
 *   GET    /:collection/:key      – get a single entry
 *   POST   /:collection/:key      – create / update an entry  (body: JSON value)
 *   DELETE /:collection/:key      – delete an entry
 *   DELETE /:collection           – clear a collection
 *
 * Authentication
 * ──────────────
 *   Every request must include the header:
 *     Authorization: Bearer <token>
 *
 * Server-Sent Events (reactive)
 * ──────────────────────────────
 *   GET /events
 *     Streams database change events as SSE so that browser clients can react
 *     to data changes in real time without polling.
 *
 * @param {object}   [options]
 * @param {Database} [options.db]           Existing Database instance.
 * @param {string}   [options.token]        Bearer token to require.  When
 *                                           omitted a random token is generated
 *                                           and printed to stdout.
 * @param {number}   [options.port]         Port to listen on (default 3714).
 * @param {string}   [options.host]         Host to bind to (default '127.0.0.1').
 * @param {string|string[]} [options.cors]  Allowed origin(s) for CORS.
 *                                           Use '*' for any origin (dev only).
 * @param {object}   [options.dbOptions]    Options forwarded to new Database()
 *                                           when no db is provided.
 * @returns {{ server: http.Server, db: Database, token: string }}
 */
function createServer(options = {}) {
  const port = options.port || 3714;
  const host = options.host || '127.0.0.1';
  const corsOrigin = options.cors || null;

  // Token
  const token = options.token || crypto.randomBytes(32).toString('hex');
  if (!options.token) {
    console.log(`[waelio/data] Bearer token: ${token}`);
  }

  // Database
  const db = options.db || new Database(options.dbOptions || {});

  // SSE client registry
  const sseClients = new Set();

  // Forward every database change to SSE clients
  db.on('change', (payload) => {
    const msg = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(msg);
      } catch (_) {
        sseClients.delete(res);
      }
    }
  });

  // ── helpers ───────────────────────────────────────────────────────────────

  function setCorsHeaders(req, res) {
    const origin = getAllowedOrigin(req);
    if (!origin) return;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  }

  function getAllowedOrigin(req) {
    if (!corsOrigin) return null;
    if (corsOrigin === '*') return '*';
    const origin = req.headers['origin'] || '';
    if (Array.isArray(corsOrigin)) {
      return corsOrigin.includes(origin) ? origin : null;
    }
    return corsOrigin === origin ? origin : null;
  }

  function sendJSON(res, status, body) {
    const json = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json),
    });
    res.end(json);
  }

  function unauthorized(res) {
    sendJSON(res, 401, { error: 'Unauthorized' });
  }

  function authenticate(req, res) {
    const auth = req.headers['authorization'] || '';
    const match = auth.match(/^Bearer (.+)$/i);
    if (!match) return false;
    // Constant-time comparison to prevent timing attacks
    const provided = Buffer.from(match[1]);
    const expected = Buffer.from(token);
    if (provided.length !== expected.length) return false;
    return crypto.timingSafeEqual(provided, expected);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  // ── request handler ───────────────────────────────────────────────────────

  async function handler(req, res) {
    setCorsHeaders(req, res);

    // Preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (!authenticate(req, res)) {
      unauthorized(res);
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const parts = url.pathname.replace(/^\//, '').split('/').filter(Boolean);

    // ── GET /events – Server-Sent Events ─────────────────────────────────
    if (req.method === 'GET' && parts[0] === 'events') {
      const sseHeaders = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      };
      const sseOrigin = getAllowedOrigin(req);
      if (sseOrigin) {
        sseHeaders['Access-Control-Allow-Origin'] = sseOrigin;
      }
      res.writeHead(200, sseHeaders);
      res.write(': connected\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // ── GET /collections ──────────────────────────────────────────────────
    if (req.method === 'GET' && parts[0] === 'collections') {
      sendJSON(res, 200, db.collections());
      return;
    }

    if (parts.length === 0) {
      sendJSON(res, 200, { collections: db.collections() });
      return;
    }

    const [collection, key] = parts;

    // ── GET /:collection ──────────────────────────────────────────────────
    if (req.method === 'GET' && !key) {
      sendJSON(res, 200, db.getAll(collection));
      return;
    }

    // ── GET /:collection/:key ─────────────────────────────────────────────
    if (req.method === 'GET' && key) {
      if (!db.has(collection, key)) {
        sendJSON(res, 404, { error: 'Not found' });
        return;
      }
      sendJSON(res, 200, { value: db.get(collection, key) });
      return;
    }

    // ── POST /:collection/:key ────────────────────────────────────────────
    if (req.method === 'POST' && key) {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJSON(res, 400, { error: 'Invalid JSON body' });
        return;
      }
      db.set(collection, key, body);
      sendJSON(res, 200, { ok: true });
      return;
    }

    // ── DELETE /:collection/:key ──────────────────────────────────────────
    if (req.method === 'DELETE' && key) {
      const existed = db.delete(collection, key);
      sendJSON(res, existed ? 200 : 404, { ok: existed });
      return;
    }

    // ── DELETE /:collection ───────────────────────────────────────────────
    if (req.method === 'DELETE' && !key) {
      db.clear(collection);
      sendJSON(res, 200, { ok: true });
      return;
    }

    sendJSON(res, 405, { error: 'Method not allowed' });
  }

  const server = http.createServer((req, res) => {
    handler(req, res).catch((err) => {
      console.error('[waelio/data] Server error:', err);
      try {
        sendJSON(res, 500, { error: 'Internal server error' });
      } catch (_) {}
    });
  });

  server.listen(port, host, () => {
    console.log(`[waelio/data] Listening on http://${host}:${port}`);
  });

  return { server, db, token };
}

module.exports = createServer;

// Allow running directly: `node src/server.js`
if (require.main === module) {
  const token = process.env.DB_TOKEN;
  const port = parseInt(process.env.DB_PORT || '3714', 10);
  const host = process.env.DB_HOST || '127.0.0.1';
  const cors = process.env.DB_CORS || null;
  const filePath = process.env.DB_FILE || undefined;
  const encryptionKey = process.env.DB_ENCRYPTION_KEY || undefined;

  createServer({
    token,
    port,
    host,
    cors,
    dbOptions: { filePath, encryptionKey },
  });
}
