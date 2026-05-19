// src/server.ts
import http from "http";
import crypto2 from "crypto";
import path3 from "path";

// src/Database.ts
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { EventEmitter } from "events";
var Database = class extends EventEmitter {
  _filePath;
  _encryptionKey;
  _data;
  constructor(options = {}) {
    super();
    this._filePath = options.filePath ? path.resolve(options.filePath) : path.join(process.cwd(), "db.json");
    this._encryptionKey = options.encryptionKey || null;
    if (this._encryptionKey && Buffer.from(this._encryptionKey, "hex").length !== 32) {
      throw new Error(
        "encryptionKey must be a 64-character hex string (32 bytes)."
      );
    }
    this._data = /* @__PURE__ */ Object.create(null);
    this._load();
  }
  // ── persistence helpers ───────────────────────────────────────────────────
  _nullProtoData(parsed) {
    const root = /* @__PURE__ */ Object.create(null);
    for (const col of Object.keys(parsed)) {
      const sub = /* @__PURE__ */ Object.create(null);
      Object.assign(sub, parsed[col]);
      root[col] = sub;
    }
    return root;
  }
  _load() {
    if (!fs.existsSync(this._filePath)) {
      this._data = /* @__PURE__ */ Object.create(null);
      return;
    }
    const raw = fs.readFileSync(this._filePath, "utf8");
    if (!raw.trim()) {
      this._data = /* @__PURE__ */ Object.create(null);
      return;
    }
    const parsed = this._encryptionKey ? JSON.parse(this._decrypt(raw)) : JSON.parse(raw);
    this._data = this._nullProtoData(parsed);
  }
  _save() {
    const json = JSON.stringify(this._data, null, 2);
    const content = this._encryptionKey ? this._encrypt(json) : json;
    fs.writeFileSync(this._filePath, content, "utf8");
  }
  // ── encryption helpers (AES-256-CBC) ─────────────────────────────────────
  _encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      "aes-256-cbc",
      Buffer.from(this._encryptionKey, "hex"),
      iv
    );
    const encrypted = Buffer.concat([
      cipher.update(text, "utf8"),
      cipher.final()
    ]);
    return iv.toString("hex") + ":" + encrypted.toString("hex");
  }
  _decrypt(text) {
    const [ivHex, dataHex] = text.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(this._encryptionKey, "hex"),
      iv
    );
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final()
    ]).toString("utf8");
  }
  // ── collection helpers ────────────────────────────────────────────────────
  _validateName(name, label) {
    if (typeof name !== "string" || name === "" || name === "__proto__" || name === "constructor" || name === "prototype") {
      throw new TypeError(`Invalid ${label} name: ${JSON.stringify(name)}`);
    }
  }
  _ensureCollection(collection) {
    this._validateName(collection, "collection");
    if (!Object.prototype.hasOwnProperty.call(this._data, collection)) {
      this._data[collection] = /* @__PURE__ */ Object.create(null);
    }
  }
  // ── public API ────────────────────────────────────────────────────────────
  set(collection, key, value) {
    this._validateName(key, "key");
    this._ensureCollection(collection);
    this._data[collection][key] = value;
    this._save();
    const payload = {
      event: "set",
      collection,
      key,
      value
    };
    this.emit("set", payload);
    this.emit("change", payload);
  }
  get(collection, key) {
    this._validateName(collection, "collection");
    this._validateName(key, "key");
    const col = this._data[collection];
    if (!col) return void 0;
    return col[key];
  }
  has(collection, key) {
    this._validateName(collection, "collection");
    this._validateName(key, "key");
    return !!(this._data[collection] && key in this._data[collection]);
  }
  delete(collection, key) {
    this._validateName(key, "key");
    if (!this.has(collection, key)) return false;
    delete this._data[collection][key];
    this._save();
    const payload = { event: "delete", collection, key };
    this.emit("delete", payload);
    this.emit("change", payload);
    return true;
  }
  getAll(collection) {
    this._validateName(collection, "collection");
    return Object.assign({}, this._data[collection] || {});
  }
  clear(collection) {
    this._validateName(collection, "collection");
    this._data[collection] = /* @__PURE__ */ Object.create(null);
    this._save();
    const payload = { event: "clear", collection };
    this.emit("clear", payload);
    this.emit("change", payload);
  }
  collections() {
    return Object.keys(this._data);
  }
};
var Database_default = Database;

// src/FileStore.ts
import fs2 from "fs";
import path2 from "path";
import { EventEmitter as EventEmitter2 } from "events";
var FileStore = class extends EventEmitter2 {
  _storageDir;
  constructor(options = {}) {
    super();
    this._storageDir = options.storageDir ? path2.resolve(options.storageDir) : path2.join(process.cwd(), "blobs");
    this._ensureDir();
  }
  _ensureDir() {
    if (!fs2.existsSync(this._storageDir)) {
      fs2.mkdirSync(this._storageDir, { recursive: true });
    }
  }
  _validateKey(key) {
    if (!key || typeof key !== "string" || key.includes("..") || key.startsWith("/")) {
      throw new Error(`Invalid file key: ${key}`);
    }
  }
  _getFilePath(key) {
    this._validateKey(key);
    return path2.join(this._storageDir, key);
  }
  saveFile(key, buffer) {
    const filePath = this._getFilePath(key);
    const dir = path2.dirname(filePath);
    if (!fs2.existsSync(dir)) {
      fs2.mkdirSync(dir, { recursive: true });
    }
    fs2.writeFileSync(filePath, buffer);
    this.emit("change", { event: "saveFile", key });
  }
  getFileStream(key) {
    const filePath = this._getFilePath(key);
    if (!fs2.existsSync(filePath)) {
      return null;
    }
    return fs2.createReadStream(filePath);
  }
  getFileSize(key) {
    const filePath = this._getFilePath(key);
    if (!fs2.existsSync(filePath)) {
      return null;
    }
    return fs2.statSync(filePath).size;
  }
  deleteFile(key) {
    const filePath = this._getFilePath(key);
    if (!fs2.existsSync(filePath)) {
      return false;
    }
    fs2.unlinkSync(filePath);
    this.emit("change", { event: "deleteFile", key });
    return true;
  }
  hasFile(key) {
    const filePath = this._getFilePath(key);
    return fs2.existsSync(filePath);
  }
};
var FileStore_default = FileStore;

// src/server.ts
function createServer(options = {}) {
  const port = options.port ?? 3714;
  const host = options.host || "127.0.0.1";
  const corsOrigin = options.cors || null;
  const token = options.token || crypto2.randomBytes(32).toString("hex");
  if (!options.token) {
    console.log(`[@waelio/data] Bearer token: ${token}`);
  }
  const db = options.db || new Database_default(options.dbOptions || {});
  const fileStore = options.fileStore || new FileStore_default(options.fileStoreOptions || {});
  const sseClients = /* @__PURE__ */ new Set();
  const broadcastEvent = (payload) => {
    const msg = `data: ${JSON.stringify(payload)}

`;
    for (const res of sseClients) {
      try {
        res.write(msg);
      } catch (_) {
        sseClients.delete(res);
      }
    }
  };
  db.on("change", broadcastEvent);
  fileStore.on("change", broadcastEvent);
  function setCorsHeaders(req, res) {
    const origin = getAllowedOrigin(req);
    if (!origin) return;
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  }
  function getAllowedOrigin(req) {
    if (!corsOrigin) return null;
    if (corsOrigin === "*") return "*";
    const origin = req.headers.origin || "";
    if (Array.isArray(corsOrigin)) {
      return corsOrigin.includes(origin) ? origin : null;
    }
    return corsOrigin === origin ? origin : null;
  }
  function sendJSON(res, status, body) {
    const json = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(json)
    });
    res.end(json);
  }
  function unauthorized(res) {
    sendJSON(res, 401, { error: "Unauthorized" });
  }
  function authenticate(req, res) {
    const auth = req.headers.authorization || "";
    const match = auth.match(/^Bearer (.+)$/i);
    if (!match) return false;
    const provided = Buffer.from(match[1]);
    const expected = Buffer.from(token);
    if (provided.length !== expected.length) return false;
    return crypto2.timingSafeEqual(provided, expected);
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }
  function getContentType(ext) {
    const types = {
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".json": "application/json",
      ".txt": "text/plain",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg"
    };
    return types[ext.toLowerCase()] || "application/octet-stream";
  }
  async function handler(req, res) {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (!authenticate(req, res)) {
      unauthorized(res);
      return;
    }
    const rawPathname = (req.url || "/").split("?")[0];
    let pathname = rawPathname;
    try {
      pathname = decodeURIComponent(rawPathname);
    } catch {
      pathname = rawPathname;
    }
    const parts = pathname.replace(/^\//, "").split("/").filter(Boolean);
    if (req.method === "GET" && parts[0] === "events") {
      const sseHeaders = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      };
      const sseOrigin = getAllowedOrigin(req);
      if (sseOrigin) {
        sseHeaders["Access-Control-Allow-Origin"] = sseOrigin;
      }
      res.writeHead(200, sseHeaders);
      res.write(": connected\n\n");
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }
    if (parts[0] === "files") {
      const fileKey = parts.slice(1).join("/");
      if (!fileKey) {
        sendJSON(res, 400, { error: "Missing file key" });
        return;
      }
      if (fileKey.includes("..") || fileKey.startsWith("/")) {
        sendJSON(res, 400, {
          error: "Invalid file key: Directory traversal not allowed"
        });
        return;
      }
      if (req.method === "GET") {
        const stream = fileStore.getFileStream(fileKey);
        if (!stream) {
          sendJSON(res, 404, { error: "File not found" });
          return;
        }
        const ext = path3.extname(fileKey);
        const size = fileStore.getFileSize(fileKey);
        res.writeHead(200, {
          "Content-Type": getContentType(ext),
          "Content-Length": size || 0
        });
        stream.pipe(res);
        return;
      }
      if (req.method === "POST" || req.method === "PUT") {
        try {
          const buffer = await readBody(req);
          fileStore.saveFile(fileKey, buffer);
          sendJSON(res, 200, { ok: true, key: fileKey, size: buffer.length });
        } catch (e) {
          sendJSON(res, 500, { error: "Failed to save file" });
        }
        return;
      }
      if (req.method === "DELETE") {
        const existed = fileStore.deleteFile(fileKey);
        sendJSON(res, existed ? 200 : 404, { ok: existed });
        return;
      }
    }
    if (req.method === "GET" && parts[0] === "collections") {
      sendJSON(res, 200, db.collections());
      return;
    }
    if (parts.length === 0) {
      sendJSON(res, 200, { collections: db.collections() });
      return;
    }
    const [collection, key] = parts;
    if (req.method === "GET" && !key) {
      sendJSON(res, 200, db.getAll(collection));
      return;
    }
    if (req.method === "GET" && key) {
      if (!db.has(collection, key)) {
        sendJSON(res, 404, { error: "Not found" });
        return;
      }
      sendJSON(res, 200, { value: db.get(collection, key) });
      return;
    }
    if (req.method === "POST" && key) {
      let body;
      try {
        const rawBody = (await readBody(req)).toString("utf8");
        body = JSON.parse(rawBody);
      } catch {
        sendJSON(res, 400, { error: "Invalid JSON body" });
        return;
      }
      db.set(collection, key, body);
      sendJSON(res, 200, { ok: true });
      return;
    }
    if (req.method === "DELETE" && key) {
      const existed = db.delete(collection, key);
      sendJSON(res, existed ? 200 : 404, { ok: existed });
      return;
    }
    if (req.method === "DELETE" && !key) {
      db.clear(collection);
      sendJSON(res, 200, { ok: true });
      return;
    }
    sendJSON(res, 405, { error: "Method not allowed" });
  }
  const server = http.createServer((req, res) => {
    handler(req, res).catch((err) => {
      console.error("[@waelio/data] Server error:", err);
      try {
        sendJSON(res, 500, { error: "Internal server error" });
      } catch (_) {
      }
    });
  });
  server.listen(port, host, () => {
    console.log(`[@waelio/data] Listening on http://${host}:${port}`);
  });
  return { server, db, fileStore, token };
}
var server_default = createServer;
if (typeof process !== "undefined" && process.argv[1] && process.argv[1].endsWith("server.ts")) {
  const token = process.env.DB_TOKEN;
  const port = parseInt(process.env.DB_PORT || "3714", 10);
  const host = process.env.DB_HOST || "127.0.0.1";
  const cors = process.env.DB_CORS || void 0;
  const filePath = process.env.DB_FILE || void 0;
  const encryptionKey = process.env.DB_ENCRYPTION_KEY || void 0;
  const storageDir = process.env.DB_BLOBS_DIR || void 0;
  createServer({
    token,
    port,
    host,
    cors,
    dbOptions: { filePath, encryptionKey },
    fileStoreOptions: { storageDir }
  });
}

export {
  Database_default,
  FileStore_default,
  createServer,
  server_default
};
