// Aplati les .glb exportés par FModel vers ./models/<basename>.glb
// Usage : node tools/flatten_glb.js [dossier_export_FModel] [--all]
//
// Par défaut : copie UNIQUEMENT les meshes RÉFÉRENCÉS par planner_pieces.json
// (champ `mesh`). L'export FModel contient des milliers de .glb (LOD `_MD`, props
// sans rapport) → on ne rapatrie que ce dont le planner a besoin (~580).
//   --all  : copie tous les .glb trouvés (ancien comportement, déconseillé).
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const projModels = path.join(ROOT, 'models');
const args = process.argv.slice(2);
const all = args.includes('--all');
const dirArg = args.find(a => !a.startsWith('--'));

const candidates = dirArg ? [dirArg] : [
  'J:/Download/Fmodel/Output/Exports',
  'D:/Tools/FModel/Output/Exports',
  path.join(process.env.APPDATA || '', 'FModel/Output/Exports'),
  path.join(process.env.LOCALAPPDATA || '', 'FModel/Output/Exports'),
];

// Basenames référencés par le catalogue (sauf --all).
let wanted = null;
if (!all) {
  const pj = path.join(ROOT, 'planner_pieces.json');
  const pieces = JSON.parse(fs.readFileSync(pj, 'utf8')).pieces || [];
  wanted = new Set(pieces.map(p => p.mesh).filter(Boolean));
  console.log(`meshes référencés par le catalogue : ${wanted.size}`);
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp, out);
    else if (e.name.toLowerCase().endsWith('.glb')) out.push(fp);
  }
  return out;
}

const src = candidates.find(d => d && fs.existsSync(d));
if (!src) { console.error('Dossier export FModel introuvable. Passe-le en argument.'); process.exit(1); }
fs.mkdirSync(projModels, { recursive: true });

const files = walk(src, []);
const seen = new Set();
let copied = 0, skipped = 0;
for (const f of files) {
  const base = path.basename(f, '.glb');
  if (!all && !wanted.has(base)) { skipped++; continue; }   // non référencé → ignoré
  if (seen.has(base)) continue;                              // doublon (plusieurs dossiers)
  seen.add(base);
  fs.copyFileSync(f, path.join(projModels, base + '.glb'));
  copied++;
}

console.log(`source : ${src}`);
console.log(`${copied} .glb copiés vers models/${all ? '' : ' (référencés uniquement, ' + skipped + ' ignorés)'}`);

// Signale les meshes référencés introuvables dans l'export (utile pour vérifier un export incomplet).
if (!all) {
  const missing = [...wanted].filter(b => !seen.has(b));
  if (missing.length) {
    console.log(`\n⚠ ${missing.length} mesh(es) référencé(s) NON trouvé(s) dans l'export :`);
    missing.slice(0, 40).forEach(m => console.log('   ' + m));
    if (missing.length > 40) console.log(`   … (+${missing.length - 40})`);
  } else {
    console.log('✓ tous les meshes référencés ont été trouvés.');
  }
}
