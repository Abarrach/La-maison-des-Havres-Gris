#!/usr/bin/env node
'use strict';
/**
 * recepteur_snapshot.cjs — Fait récupérer les fichiers bruts de gaming.tools par un NAVIGATEUR.
 *
 * Node est bloqué par Cloudflare sur cdn-hosted.gaming.tools (403), un navigateur passe.
 * Mais une page de gaming.tools ne peut pas écrire sur le disque, et un appel d'une page
 * publique vers 127.0.0.1 est bloqué par Chrome (accès au réseau local). On inverse donc :
 * ce récepteur SERT une page locale ; depuis cette page, le navigateur lit le CDN (il
 * répond « Access-Control-Allow-Origin: * ») et dépose le résultat ici, en même origine.
 *
 *   1. node tools/recepteur_snapshot.cjs <dossier>          (écoute sur 127.0.0.1:8790)
 *   2. ouvrir http://127.0.0.1:8790/ dans un navigateur et cliquer « Récupérer »
 *      (liste des objets ; ajouter des identifiants pour le détail d'objets nouveaux)
 *   3. node tools/build_stuff_snapshot.js --from=<dossier>
 *
 * N'écoute que sur 127.0.0.1, n'écrit que dans <dossier>, refuse tout chemin hors de lui.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(process.argv[2] || 'gt_raw');
const PORT = 8790;
const CDN = 'https://cdn-hosted.gaming.tools/dune/data/fr';

const PAGE = `<!doctype html><meta charset="utf-8"><title>Récepteur gaming.tools</title>
<body style="font:14px sans-serif;background:#14100a;color:#f5deb3;padding:20px">
<h2 style="color:#cda434">Récepteur gaming.tools → ${DIR.replace(/\\/g, '/')}</h2>
<p>Identifiants d'objets dont récupérer le DÉTAIL (grades), séparés par des espaces :</p>
<input id="ids" style="width:100%;padding:6px" placeholder="sardaukarsword_1 b1c4_taligaripistol">
<p><button id="go" style="padding:8px 16px">Récupérer</button></p><pre id="log"></pre>
<script>
const log = t => document.getElementById('log').textContent += t + '\\n';
async function prendre(src, nom) {
  const r = await fetch(${JSON.stringify(CDN)} + '/' + src);
  const t = await r.text();
  if (!r.ok) return log(src + ' : HTTP ' + r.status);
  const p = await fetch('/?nom=' + encodeURIComponent(nom), { method: 'POST', body: t });
  log(src + ' : ' + t.length + ' octets → ' + (p.ok ? 'déposé' : 'refusé ' + p.status));
}
document.getElementById('go').onclick = async () => {
  await prendre('items.d.json', 'items.d.json');
  for (const id of document.getElementById('ids').value.split(/\\s+/).filter(Boolean)) {
    await prendre('items/' + id + '.d.json', 'items/' + id + '.d.json');
  }
  log('Terminé. Lancer : node tools/build_stuff_snapshot.js --from=<dossier>');
};
</script>`;

http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }
  const nom = new URL(req.url, 'http://x').searchParams.get('nom') || '';
  const cible = path.resolve(DIR, nom);
  if (req.method !== 'POST' || !/^[a-z0-9_\-/.]+\.json$/i.test(nom) || !cible.startsWith(DIR + path.sep)) {
    res.writeHead(400);
    return res.end('refusé');
  }
  const morceaux = [];
  req.on('data', c => morceaux.push(c));
  req.on('end', () => {
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    fs.writeFileSync(cible, Buffer.concat(morceaux));
    console.log(`reçu ${nom} (${Buffer.concat(morceaux).length} octets)`);
    res.writeHead(200);
    res.end('ok');
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Récepteur prêt : ouvrir http://127.0.0.1:${PORT}/  (dépôt dans ${DIR})`));
