'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

/**
 * A local, secure, reactive JSON file database.
 *
 * Events emitted:
 *   'change'  – emitted on any write (set/delete/clear).
 *                Payload: { event, collection, key, value }
 *   'set'     – emitted when a key is written.
 *   'delete'  – emitted when a key is removed.
 *   'clear'   – emitted when a collection is cleared.
 */
class Database extends EventEmitter {
  /**
   * @param {object}  [options]
   * @param {string}  [options.filePath]   Path to the JSON storage file.
   * @param {string}  [options.encryptionKey] 32-byte hex key for AES-256 at-rest
   *                                          encryption.  When omitted the file
   *                                          is stored as plain JSON.
   */
  constructor(options = {}) {
    super();

    this._filePath = options.filePath
      ? path.resolve(options.filePath)
      : path.join(process.cwd(), 'db.json');

    this._encryptionKey = options.encryptionKey || null;
    if (this._encryptionKey && Buffer.from(this._encryptionKey, 'hex').length !== 32) {
      throw new Error('encryptionKey must be a 64-character hex string (32 bytes).');
    }

    this._data = Object.create(null);
    this._load();
  }

  // ── persistence helpers ───────────────────────────────────────────────────

  _nullProtoData(parsed) {
    const root = Object.create(null);
    for (const col of Object.keys(parsed)) {
      const sub = Object.create(null);
      Object.assign(sub, parsed[col]);
      root[col] = sub;
    }
    return root;
  }

  _load() {
    if (!fs.existsSync(this._filePath)) {
      this._data = Object.create(null);
      return;
    }
    const raw = fs.readFileSync(this._filePath, 'utf8');
    if (!raw.trim()) {
      this._data = Object.create(null);
      return;
    }
    const parsed = this._encryptionKey
      ? JSON.parse(this._decrypt(raw))
      : JSON.parse(raw);
    this._data = this._nullProtoData(parsed);
  }

  _save() {
    const json = JSON.stringify(this._data, null, 2);
    const content = this._encryptionKey ? this._encrypt(json) : json;
    fs.writeFileSync(this._filePath, content, 'utf8');
  }

  // ── encryption helpers (AES-256-CBC) ─────────────────────────────────────

  _encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      Buffer.from(this._encryptionKey, 'hex'),
      iv
    );
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  }

  _decrypt(text) {
    const [ivHex, dataHex] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      Buffer.from(this._encryptionKey, 'hex'),
      iv
    );
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }

  // ── collection helpers ────────────────────────────────────────────────────

  _validateName(name, label) {
    if (typeof name !== 'string' || name === '' || name === '__proto__' ||
        name === 'constructor' || name === 'prototype') {
      throw new TypeError(`Invalid ${label} name: ${JSON.stringify(name)}`);
    }
  }

  _ensureCollection(collection) {
    this._validateName(collection, 'collection');
    if (!Object.prototype.hasOwnProperty.call(this._data, collection)) {
      this._data[collection] = Object.create(null);
    }
  }

  // ── public API ────────────────────────────────────────────────────────────

  /**
   * Write a value.
   * @param {string} collection
   * @param {string} key
   * @param {*}      value
   */
  set(collection, key, value) {
    this._validateName(key, 'key');
    this._ensureCollection(collection);
    this._data[collection][key] = value;
    this._save();
    const payload = { event: 'set', collection, key, value };
    this.emit('set', payload);
    this.emit('change', payload);
  }

  /**
   * Read a value (returns undefined when not found).
   * @param {string} collection
   * @param {string} key
   * @returns {*}
   */
  get(collection, key) {
    this._validateName(collection, 'collection');
    this._validateName(key, 'key');
    const col = this._data[collection];
    if (!col) return undefined;
    return col[key];
  }

  /**
   * Check whether a key exists.
   * @param {string} collection
   * @param {string} key
   * @returns {boolean}
   */
  has(collection, key) {
    this._validateName(collection, 'collection');
    this._validateName(key, 'key');
    return !!(this._data[collection] && key in this._data[collection]);
  }

  /**
   * Delete a key.
   * @param {string} collection
   * @param {string} key
   * @returns {boolean} true when the key existed
   */
  delete(collection, key) {
    this._validateName(key, 'key');
    if (!this.has(collection, key)) return false;
    delete this._data[collection][key];
    this._save();
    const payload = { event: 'delete', collection, key };
    this.emit('delete', payload);
    this.emit('change', payload);
    return true;
  }

  /**
   * Return all entries in a collection as a plain object.
   * @param {string} collection
   * @returns {object}
   */
  getAll(collection) {
    this._validateName(collection, 'collection');
    return Object.assign({}, this._data[collection] || {});
  }

  /**
   * Remove every entry in a collection.
   * @param {string} collection
   */
  clear(collection) {
    this._validateName(collection, 'collection');
    this._data[collection] = Object.create(null);
    this._save();
    const payload = { event: 'clear', collection };
    this.emit('clear', payload);
    this.emit('change', payload);
  }

  /**
   * List all collection names.
   * @returns {string[]}
   */
  collections() {
    return Object.keys(this._data);
  }
}

module.exports = Database;
