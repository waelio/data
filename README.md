# @waelio/data

A **local, secure, reactive** JSON database with a built-in HTTP server so your website can read and write data safely from the same machine.

## Features

| Feature               | Details                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Secure**            | Every HTTP request requires a bearer token. Optional AES-256-CBC at-rest encryption for the JSON file.                                                                                      |
| **Reactive**          | `Database` extends `EventEmitter` — subscribe to `set`, `delete`, `clear`, and `change` events. Connected browser clients receive live updates over **Server-Sent Events** (`GET /events`). |
| **Local**             | Binds to `127.0.0.1` by default so the server is never exposed to external networks.                                                                                                        |
| **Zero dependencies** | Uses only Node.js built-in modules (`http`, `fs`, `crypto`, `events`).                                                                                                                      |

## Quick start

```js
const { createServer } = require('@waelio/data')

const { server, db, token } = createServer({
  port: 3714, // default
  cors: 'http://localhost:5173', // your website's origin
  dbOptions: {
    filePath: './db.json',
    // encryptionKey: '<64-char hex string>',   // optional AES-256 at-rest encryption
  },
})

// The generated bearer token is printed to stdout on first run.
// Pass it in the Authorization header of every request.
```

Start the server from the command line using environment variables:

```sh
DB_PORT=3714 \
DB_CORS=http://localhost:5173 \
DB_FILE=./db.json \
DB_TOKEN=mysecrettoken \
node src/server.js
```

## HTTP API

All requests require:

```
Authorization: Bearer <token>
```

| Method   | Path                | Description                          |
| -------- | ------------------- | ------------------------------------ |
| `GET`    | `/collections`      | List all collection names            |
| `GET`    | `/:collection`      | Return all entries in a collection   |
| `GET`    | `/:collection/:key` | Return a single entry                |
| `POST`   | `/:collection/:key` | Create / update an entry (JSON body) |
| `DELETE` | `/:collection/:key` | Delete an entry                      |
| `DELETE` | `/:collection`      | Clear all entries in a collection    |
| `GET`    | `/events`           | SSE stream of database change events |

### Example (browser)

```js
const BASE = 'http://127.0.0.1:3714'
const TOKEN = 'mysecrettoken'
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
}

// Write
await fetch(`${BASE}/users/alice`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ name: 'Alice' }),
})

// Read
const { value } = await fetch(`${BASE}/users/alice`, { headers }).then((r) =>
  r.json(),
)

// React to changes in real time (proxy the /events endpoint through your own
// server so the bearer token stays server-side and never leaks to the browser)
const es = new EventSource('/api/db-events') // your backend proxies this
es.onmessage = ({ data }) => console.log('DB changed:', JSON.parse(data))
```

## Programmatic API

### `new Database(options?)`

| Option          | Type     | Default     | Description                                                                |
| --------------- | -------- | ----------- | -------------------------------------------------------------------------- |
| `filePath`      | `string` | `./db.json` | Path to the JSON storage file                                              |
| `encryptionKey` | `string` | —           | 64-char hex string (32 bytes). When set the file is AES-256-CBC encrypted. |

#### Methods

```js
db.set(collection, key, value) // Write a value
db.get(collection, key) // Read a value (undefined if missing)
db.has(collection, key) // Boolean existence check
db.delete(collection, key) // Remove a key → returns boolean
db.getAll(collection) // All entries as a plain object
db.clear(collection) // Remove all entries in a collection
db.collections() // List of collection names
```

#### Events

```js
db.on('change', ({ event, collection, key, value }) => {
  /* any mutation */
})
db.on('set', ({ event, collection, key, value }) => {
  /* key written  */
})
db.on('delete', ({ event, collection, key }) => {
  /* key deleted  */
})
db.on('clear', ({ event, collection }) => {
  /* col cleared  */
})
```

### `createServer(options?)`

Returns `{ server, db, token }`.

| Option      | Type                 | Default       | Description                                            |
| ----------- | -------------------- | ------------- | ------------------------------------------------------ |
| `port`      | `number`             | `3714`        | Port to listen on                                      |
| `host`      | `string`             | `'127.0.0.1'` | Bind address                                           |
| `token`     | `string`             | random        | Bearer token. Printed to stdout when auto-generated.   |
| `cors`      | `string \| string[]` | —             | Allowed CORS origin(s). Use `'*'` in development only. |
| `db`        | `Database`           | new instance  | Provide your own Database instance                     |
| `dbOptions` | `object`             | `{}`          | Forwarded to `new Database()` when no `db` is given    |

## Running tests

```sh
npm test
```
