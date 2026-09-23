const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/client.js': ['client.js', 'text/javascript; charset=utf-8'], '/client.css': ['client.css', 'text/css; charset=utf-8'] };
const port = Number(process.env.PRODUCTION_LAB_PREVIEW_PORT || 4189);
http.createServer((req, res) => {
  const item = files[new URL(req.url, 'http://127.0.0.1').pathname];
  if (!item || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': item[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  if (req.method === 'HEAD') res.end(); else fs.createReadStream(path.join(__dirname, 'dist', item[0])).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`New-module-only preview http://127.0.0.1:${port}`));
