// Aperçu local strict : aucun fichier de compte, score, configuration ou secret servi.
// Les gardes sont retirées en mémoire UNIQUEMENT de la réponse HTML locale.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'../jeux');
const files = new Map([
    ['/jeux/dernier_rempart.html',['dernier_rempart.html','text/html; charset=utf-8']],
    ['/jeux/dernier_rempart_engine.js',['dernier_rempart_engine.js','text/javascript; charset=utf-8']],
    ['/jeux/dernier_rempart_view.js',['dernier_rempart_view.js','text/javascript; charset=utf-8']],
    ['/jeux/dernier_rempart.js',['dernier_rempart.js','text/javascript; charset=utf-8']],
    ['/jeux/img/rempart_arrakis.webp',['img/rempart_arrakis.webp','image/webp']],
]);
http.createServer((req,res)=>{
    if(req.method!=='GET'){res.writeHead(405);res.end();return;}
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    if(pathname==='/'){res.writeHead(302,{Location:'/jeux/dernier_rempart.html'});res.end();return;}
    const file=files.get(pathname);
    if(!file){res.writeHead(404);res.end('Not found');return;}
    try{
        let content=fs.readFileSync(path.join(root,file[0]));
        if(file[0].endsWith('.html'))content=content.toString('utf8').replace('<script src="../auth-guard.js"></script>','<!-- Garde conservée dans le fichier livré ; aperçu local uniquement. -->');
        res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(content);
    }catch(_){res.writeHead(500);res.end('Preview asset unavailable');}
}).listen(8768,'127.0.0.1',()=>console.log('Dernier Rempart : http://127.0.0.1:8768/jeux/dernier_rempart.html'));
