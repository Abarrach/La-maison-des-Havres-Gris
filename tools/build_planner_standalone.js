#!/usr/bin/env node
/**
 * build_planner_standalone.js — Génère planner-standalone/, le constructeur de base en
 * version AUTONOME (site statique : sans compte, sans PHP, sans base de données), à partir
 * du planner du site tel qu'il est aujourd'hui.
 *
 *   node tools/build_planner_standalone.js            # page + scripts + données
 *   node tools/build_planner_standalone.js --models   # + copie de models/ (~357 Mo)
 *   node tools/build_planner_standalone.js --models=<dossier>   # modèles pris ailleurs
 *   (models/ n'est pas versionné : la copie complète est sur le serveur, /srv/dune-map/models/)
 *
 * Pourquoi un générateur : la première version (juin 2026) était une COPIE faite à la main
 * de base_planner.html / .js ; vingt lots plus tard, elle était à des kilomètres du site.
 * Ici, la page autonome est DÉDUITE de base_planner.html par quelques transformations,
 * chacune sur un repère précis : si le site change un repère, le script s'arrête en le
 * nommant, au lieu de produire une page à moitié cassée.
 *
 * Transformations : pas d'auth-guard / page-guard ni d'en-tête du portail (compte, Menu) ;
 * « Sauvegarder / Mes plans / Partager » (sauvegarde serveur) remplacés par
 * « Partager le lien / Exporter / Importer » : le plan voyage dans l'URL (#p=…, gzip +
 * base64url) ou dans un fichier .json. S'appuie sur window.bpSerializePlanData /
 * bpApplyPlanData, exposés par base_planner.js.
 *
 * Sortie : planner-standalone/ — seuls README.md et nginx.conf y sont suivis par git, le
 * reste est régénéré (cf. .gitignore).
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const SORTIE = path.join(RACINE, 'planner-standalone');
const OPT_MODELES = process.argv.find(a => a === '--models' || a.startsWith('--models='));

function remplacer(src, motif, par, nom, attendu = 1) {
  const n = typeof motif === 'string' ? src.split(motif).length - 1 : (src.match(motif) || []).length;
  if (n !== attendu) {
    throw new Error(`repère « ${nom} » trouvé ${n} fois dans base_planner.html (attendu : ${attendu}) — `
      + 'la page du site a changé, adapter tools/build_planner_standalone.js');
  }
  return typeof motif === 'string' ? src.split(motif).join(par) : src.replace(motif, par);
}

// ── Page ────────────────────────────────────────────────────────────────────────
let html = fs.readFileSync(path.join(RACINE, 'base_planner.html'), 'utf8').replace(/\r\n/g, '\n');

html = remplacer(html, /<title>Constructeur de Base[^<]*<\/title>/,
  '<title>Constructeur de Base (édition publique) — Havres Gris</title>', 'title');
html = remplacer(html, /<script src="(?:auth|page)-guard\.js"[^>]*><\/script>\n?/g,
  '', 'auth-guard / page-guard', 2);
html = remplacer(html, '<div class="title">Constructeur de Base</div>',
  '<div class="title">Constructeur de Base <span style="color:#6b5836; font-weight:400; font-size:0.7em;">— Édition publique</span></div>',
  'titre de l\'en-tête');
html = remplacer(html, /<a href="account\.html" class="user-account-widget"[\s\S]*?<a href="menu\.html" class="disconnect">Menu<\/a>/,
  '<span style="color:#6b5836; font-size:12px; letter-spacing:0.5px;">Maison des Havres Gris · Dune Awakening</span>',
  'compte + Menu');
html = remplacer(html, /<script>\(function\(\)\{var u=localStorage\.getItem\("user"\)[^\n]*<\/script>\n?/,
  '', 'script du pseudo');
html = remplacer(html, /[ \t]*<button[^>]*id="btn-save-plan"[^>]*>[^<]*<\/button>\n[ \t]*<button[^>]*id="btn-my-plans"[^>]*>[^<]*<\/button>\n[ \t]*<button[^>]*id="btn-share-plan"[^>]*>[^<]*<\/button>/,
  `    <button class="bp-action-btn share" id="btn-share-link" title="Copier un lien qui contient ce plan">🔗 Partager le lien</button>
    <button class="bp-action-btn primary" id="btn-export-plan" title="Télécharger ce plan en fichier .json">⬇ Exporter</button>
    <button class="bp-action-btn secondary" id="btn-import-plan" title="Charger un plan depuis un fichier .json">⬆ Importer</button>
    <input type="file" id="import-file-input" accept="application/json,.json" style="display:none;">`,
  'boutons Sauvegarder / Mes plans / Partager');
html = remplacer(html, /[ \t]*\/\/ Boutons modales — passe par bpOpen\*Modal[\s\S]*?(?=[ \t]*\/\/ Bouton Aide)/,
  fs.readFileSync(path.join(__dirname, 'planner_standalone_partage.js'), 'utf8').replace(/\r\n/g, '\n'),
  'écouteurs des boutons de sauvegarde');

// ── Fichiers à recopier : ceux que la page et les modules chargent ───────────────
const js = fs.readFileSync(path.join(RACINE, 'base_planner.js'), 'utf8');
if (!/window\.bpSerializePlanData\s*=/.test(js) || !/window\.bpApplyPlanData\s*=/.test(js)) {
  throw new Error('base_planner.js n\'expose plus window.bpSerializePlanData / bpApplyPlanData');
}
const fichiers = new Set();
for (const m of html.matchAll(/(?:src|href)="([A-Za-z0-9_.\/-]+\.(?:js|css))(?:\?[^"]*)?"/g)) fichiers.add(m[1]);
const modules = ['base_planner.js'];
for (let i = 0; i < modules.length; i++) {
  const code = fs.readFileSync(path.join(RACINE, modules[i]), 'utf8');
  for (const m of code.matchAll(/from\s+['"]\.\/([A-Za-z0-9_.-]+\.js)(?:\?[^'"]*)?['"]/g)) {
    if (!modules.includes(m[1])) modules.push(m[1]);
  }
  for (const m of code.matchAll(/['"`]([A-Za-z0-9_-]+\.json)(?:\?[^'"`]*)?['"`]/g)) fichiers.add(m[1]);
}
modules.forEach(f => fichiers.add(f));

fs.mkdirSync(SORTIE, { recursive: true });
fs.writeFileSync(path.join(SORTIE, 'index.html'), html);
let total = 0;
for (const f of [...fichiers].sort()) {
  const src = path.join(RACINE, f);
  if (!fs.existsSync(src)) throw new Error(`fichier chargé par le planner introuvable : ${f}`);
  fs.copyFileSync(src, path.join(SORTIE, f));
  total += fs.statSync(src).size;
  console.log(`  ${f}`);
}
console.log(`✔ planner-standalone/index.html + ${fichiers.size} fichiers (${(total / 1048576).toFixed(1)} Mo)`);

// ── Modèles 3D (gros : seulement sur demande) ─────────────────────────────────────
// Par défaut : la base locale unique des modèles (tools/models_dir.js), tenue à jour par le pipeline.
const modeles = OPT_MODELES && OPT_MODELES.includes('=') ? path.resolve(OPT_MODELES.split('=')[1]) : require('./models_dir')();
if (OPT_MODELES) {
  if (!fs.existsSync(modeles)) throw new Error(`${modeles} introuvable : récupérer models/ depuis le serveur (/srv/dune-map/models/)`);
  fs.cpSync(modeles, path.join(SORTIE, 'models'), { recursive: true });
  console.log(`✔ models/ copié (${fs.readdirSync(modeles).length} fichiers)`);
} else if (!fs.existsSync(path.join(SORTIE, 'models'))) {
  console.log('⚠ models/ non copié : relancer avec --models, ou le déposer à côté de index.html (cf. README).');
}
