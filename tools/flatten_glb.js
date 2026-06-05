// Aplati les .glb exportés par FModel vers ./models/<basename>.glb
// Usage : node tools/flatten_glb.js  [dossier_export_FModel]
// Si aucun dossier fourni, cherche aux emplacements FModel habituels.
const fs = require('fs'), path = require('path');

const projModels = path.join(__dirname, '..', 'models');
const candidates = process.argv[2] ? [process.argv[2]] : [
  'D:/Tools/FModel/Output/Exports',
  path.join(process.env.APPDATA || '', 'FModel/Output/Exports'),
  path.join(process.env.LOCALAPPDATA || '', 'FModel/Output/Exports'),
];

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp, out);
    else if (e.name.toLowerCase().endsWith('.glb')) out.push(fp);
  }
  return out;
}

let src = candidates.find(d => d && fs.existsSync(d));
if (!src) { console.error('Dossier export FModel introuvable. Passe-le en argument.'); process.exit(1); }
fs.mkdirSync(projModels, { recursive: true });

const files = walk(src, []);
let n = 0;
for (const f of files) {
  const base = path.basename(f);
  fs.copyFileSync(f, path.join(projModels, base));
  n++;
}
console.log(`source : ${src}`);
console.log(`${n} fichiers .glb copiés vers models/`);
