'use strict'

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'

import Database from '../src/Database.ts'
import createServer from '../src/server.ts'
import FileStore from '../src/FileStore.ts'

// ── helpers ───────────────────────────────────────────────────────────────

function tmpFile() {
  return path.join(
    os.tmpdir(),
    `waelio-data-test-${crypto.randomBytes(6).toString('hex')}.json`,
  )
}

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json
        try {
          json = JSON.parse(text)
        } catch {
          json = text
        }
        resolve({ status: res.statusCode, body: json, headers: res.headers })
      })
    })
    req.on('error', reject)
    if (body !== undefined) {
      if (Buffer.isBuffer(body)) {
        req.write(body)
      } else {
        const payload = JSON.stringify(body)
        req.write(payload)
      }
    }
    req.end()
  })
}

// ── Database unit tests ───────────────────────────────────────────────────

describe('Database', () => {
  let dbPath
  let db

  beforeEach(() => {
    dbPath = tmpFile()
    db = new Database({ filePath: dbPath })
  })

  after(() => {
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    } catch (_) { }
  })

  it('stores and retrieves a value', () => {
    db.set('users', 'alice', { name: 'Alice' })
    assert.deepEqual(db.get('users', 'alice'), { name: 'Alice' })
  })

  it('returns undefined for a missing key', () => {
    assert.equal(db.get('users', 'nobody'), undefined)
  })

  it('has() returns true for existing key', () => {
    db.set('users', 'bob', 42)
    assert.equal(db.has('users', 'bob'), true)
  })

  it('has() returns false for missing key', () => {
    assert.equal(db.has('users', 'ghost'), false)
  })

  it('delete() removes a key and returns true', () => {
    db.set('items', 'x', 1)
    assert.equal(db.delete('items', 'x'), true)
    assert.equal(db.has('items', 'x'), false)
  })

  it('delete() returns false for a non-existent key', () => {
    assert.equal(db.delete('items', 'nope'), false)
  })

  it('getAll() returns all entries in a collection', () => {
    db.set('cfg', 'a', 1)
    db.set('cfg', 'b', 2)
    assert.deepEqual(db.getAll('cfg'), { a: 1, b: 2 })
  })

  it('getAll() returns empty object for unknown collection', () => {
    assert.deepEqual(db.getAll('empty'), {})
  })

  it('clear() removes all keys in a collection', () => {
    db.set('logs', 'k1', 'v1')
    db.set('logs', 'k2', 'v2')
    db.clear('logs')
    assert.deepEqual(db.getAll('logs'), {})
  })

  it('collections() lists collection names', () => {
    db.set('col1', 'k', 1)
    db.set('col2', 'k', 2)
    const cols = db.collections()
    assert.ok(cols.includes('col1'))
    assert.ok(cols.includes('col2'))
  })

  it('persists data across instances', () => {
    db.set('persist', 'key', 'hello')
    const db2 = new Database({ filePath: dbPath })
    assert.equal(db2.get('persist', 'key'), 'hello')
  })

  it('emits "set" and "change" events on set()', (_, done) => {
    let changeCount = 0
    db.once('set', (p) => {
      assert.equal(p.event, 'set')
      assert.equal(p.collection, 'ev')
      assert.equal(p.key, 'k')
      assert.equal(p.value, 99)
    })
    db.once('change', () => {
      changeCount++
      if (changeCount === 1) done()
    })
    db.set('ev', 'k', 99)
  })

  it('emits "delete" and "change" events on delete()', (_, done) => {
    db.set('ev2', 'k', 1)
    db.once('delete', (p) => {
      assert.equal(p.event, 'delete')
      assert.equal(p.key, 'k')
    })
    db.once('change', () => done())
    db.delete('ev2', 'k')
  })

  it('emits "clear" and "change" events on clear()', (_, done) => {
    db.set('ev3', 'k', 1)
    db.once('clear', (p) => {
      assert.equal(p.event, 'clear')
      assert.equal(p.collection, 'ev3')
    })
    db.once('change', () => done())
    db.clear('ev3')
  })

  describe('encryption', () => {
    it('stores encrypted data and decrypts on read', () => {
      const key = crypto.randomBytes(32).toString('hex')
      const encPath = tmpFile()
      const encDb = new Database({ filePath: encPath, encryptionKey: key })
      encDb.set('secret', 'pw', 'hunter2')

      // The raw file must not contain the plaintext value
      const raw = fs.readFileSync(encPath, 'utf8')
      assert.ok(
        !raw.includes('hunter2'),
        'plaintext should not appear in encrypted file',
      )

      // A fresh instance must decrypt correctly
      const encDb2 = new Database({ filePath: encPath, encryptionKey: key })
      assert.equal(encDb2.get('secret', 'pw'), 'hunter2')

      fs.unlinkSync(encPath)
    })

    it('throws on invalid encryption key length', () => {
      assert.throws(
        () => new Database({ encryptionKey: 'tooshort' }),
        /32 bytes/,
      )
    })
  })
})

// ── Server integration tests ──────────────────────────────────────────────

describe('createServer', () => {
  let server
  let db
  let token
  let port

  before(async () => {
    const dbPath = tmpFile()
    token = crypto.randomBytes(16).toString('hex')
    db = new Database({ filePath: dbPath })
    const result = createServer({ db, token, port: 0, cors: '*' })
    server = result.server
    // Wait for the server to start and discover the actual port
    await new Promise((resolve) => server.once('listening', resolve))
    port = server.address().port
  })

  after(() => {
    server.close()
  })

  function req(method, urlPath, body, auth = token) {
    const options = {
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: {
        Authorization: `Bearer ${auth}`,
        'Content-Type': 'application/json',
      },
    }
    return httpRequest(options, body)
  }

  it('rejects requests without a token (401)', async () => {
    const r = await req('GET', '/users', undefined, 'bad-token')
    assert.equal(r.status, 401)
  })

  it('GET / returns collections list', async () => {
    const r = await req('GET', '/')
    assert.equal(r.status, 200)
    assert.ok(Array.isArray(r.body.collections))
  })

  it('GET /collections returns collections array', async () => {
    const r = await req('GET', '/collections')
    assert.equal(r.status, 200)
    assert.ok(Array.isArray(r.body))
  })

  it('POST /:collection/:key stores a value', async () => {
    const r = await req('POST', '/users/alice', { name: 'Alice', age: 30 })
    assert.equal(r.status, 200)
    assert.equal(r.body.ok, true)
  })

  it('GET /:collection/:key retrieves the stored value', async () => {
    await req('POST', '/users/alice', { name: 'Alice' })
    const r = await req('GET', '/users/alice')
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.value, { name: 'Alice' })
  })

  it('GET /:collection/:key returns 404 for missing key', async () => {
    const r = await req('GET', '/users/nobody')
    assert.equal(r.status, 404)
  })

  it('GET /:collection returns all entries', async () => {
    await req('POST', '/products/p1', { title: 'Widget' })
    await req('POST', '/products/p2', { title: 'Gadget' })
    const r = await req('GET', '/products')
    assert.equal(r.status, 200)
    assert.ok(r.body.p1)
    assert.ok(r.body.p2)
  })

  it('DELETE /:collection/:key removes a key', async () => {
    await req('POST', '/tmp/k', 'value')
    const r = await req('DELETE', '/tmp/k')
    assert.equal(r.status, 200)
    assert.equal(r.body.ok, true)
    const r2 = await req('GET', '/tmp/k')
    assert.equal(r2.status, 404)
  })

  it('DELETE /:collection/:key returns 404 when key is missing', async () => {
    const r = await req('DELETE', '/tmp/nonexistent')
    assert.equal(r.status, 404)
  })

  it('DELETE /:collection clears the collection', async () => {
    await req('POST', '/logs/a', 1)
    await req('POST', '/logs/b', 2)
    const r = await req('DELETE', '/logs')
    assert.equal(r.status, 200)
    const r2 = await req('GET', '/logs')
    assert.deepEqual(r2.body, {})
  })

  it('POST returns 400 on invalid JSON body', async () => {
    const options = {
      hostname: '127.0.0.1',
      port,
      path: '/test/key',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
    const r = await httpRequest(options, undefined)
    // sending no body at all → empty string → invalid JSON
    assert.equal(r.status, 400)
    assert.equal(r.body.error, 'Invalid JSON body')
  })

  it('OPTIONS preflight returns 204 with CORS headers', async () => {
    const options = {
      hostname: '127.0.0.1',
      port,
      path: '/users',
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
      },
    }
    const r = await httpRequest(options)
    assert.equal(r.status, 204)
  })

  // ── Files E2E tests ────────────────────────────────────────────────────────

  it('POST /files/:key stores a binary file', async () => {
    const r = await req('POST', '/files/test-audio.mp3', Buffer.from('fake-mp3-data'))
    assert.equal(r.status, 200)
    assert.equal(r.body.ok, true)
    assert.equal(r.body.key, 'test-audio.mp3')
  })

  it('GET /files/:key retrieves a binary file', async () => {
    await req('POST', '/files/test-audio.mp3', Buffer.from('fake-mp3-data'))
    const r = await req('GET', '/files/test-audio.mp3')
    assert.equal(r.status, 200)
    assert.equal(r.body, 'fake-mp3-data')
    assert.equal(r.headers['content-type'], 'audio/mpeg')
  })

  it('DELETE /files/:key removes a file', async () => {
    await req('POST', '/files/delete-me.txt', Buffer.from('hello'))
    const r = await req('DELETE', '/files/delete-me.txt')
    assert.equal(r.status, 200)
    assert.equal(r.body.ok, true)

    const r2 = await req('GET', '/files/delete-me.txt')
    assert.equal(r2.status, 404)
  })

  it('POST /files/:key rejects directory traversal (..)', async () => {
    const r = await req('POST', '/files/../etc/passwd', Buffer.from('hack'))
    assert.equal(r.status, 400)
  })

  it('POST /files/:key rejects directory traversal (leading slash)', async () => {
    // Note: URL path resolves leading slashes sometimes, but let's test if it handles %2F or similar if we directly send
    // or just '/files//etc/passwd' which translates to '' as parts[0] is 'files' and parts[1] is 'etc' etc.
    // If the path contains '..', our logic catches it.
    const r = await req('POST', '/files/..%2F..%2Fetc%2Fpasswd', Buffer.from('hack'))
    // Actually the HTTP router parts are decoded by some frameworks, but here we don't decode
    assert.equal(r.status, 400)
  })

})
