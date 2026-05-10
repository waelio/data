const http = require('http');
const server = http.createServer((req, res) => res.end('ok'));
server.listen('/tmp/test.sock', () => {
  console.log('Listening on socket');
  server.close();
});
