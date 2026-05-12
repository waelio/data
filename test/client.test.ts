import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WaelioCollection } from '../src/client.ts';
import createServer from '../src/server.ts';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import Database from '../src/Database.ts';

function tmpFile() {
  return path.join(
    os.tmpdir(),
    `waelio-data-client-test-${crypto.randomBytes(6).toString('hex')}.json`,
  );
}

describe('WaelioCollection Client', () => {
  let server: any;
  let port: number;
  let token: string;
  let dbPath: string;

  before(async () => {
    dbPath = tmpFile();
    token = crypto.randomBytes(16).toString('hex');
    const db = new Database({ filePath: dbPath });
    const result = createServer({ db, token, port: 0, cors: '*' });
    server = result.server;
    await new Promise((resolve) => server.once('listening', resolve));
    port = server.address().port;
  });

  after(() => {
    server.close();
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    } catch (_) {}
  });

  it('inserts and retrieves data locally', async () => {
    const col = new WaelioCollection('testcol', {
      dbUrl: `http://127.0.0.1:${port}`,
      dbToken: token,
    });

    const inserted = await col.insert('item1', { name: 'Meteor!' });
    assert.deepEqual(inserted, { name: 'Meteor!' });

    const retrieved = await col.get('item1');
    assert.deepEqual(retrieved, { name: 'Meteor!' });
  });

  it('broadcasts to messaging app if provided', async () => {
    let createdPayload: any = null;
    
    // Mock Feathers App
    const mockApp = {
      service: (name: string) => ({
        on: (event: string, cb: any) => {},
        create: async (payload: any) => {
          createdPayload = payload;
          return payload;
        }
      })
    };

    const col = new WaelioCollection('messages', {
      dbUrl: `http://127.0.0.1:${port}`,
      dbToken: token,
      messagingApp: mockApp
    });

    await col.insert('msg1', { text: 'Hello far away' });
    
    assert.ok(createdPayload, 'Should have called create on the messaging app');
    assert.equal(createdPayload.text, 'Hello far away');
    assert.equal(createdPayload.id, 'msg1');
  });
});
