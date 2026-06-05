// Petit serveur statique pour tester le proto en local : `node proto_serve.js` puis http://localhost:8777
const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname, port = process.env.PORT || 8777;
const types = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.css':'text/css', '.png':'image/png' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/proto_atreides.html';
  const fp = path.join(root, p);
  fs.readFile(fp, (e, data) => {
    if (e) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, {
      'Content-Type': types[path.extname(fp)] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',  // dev : toujours frais
    });
    res.end(data);
  });
}).listen(port, () => console.log('Proto Atréides : http://localhost:' + port));
