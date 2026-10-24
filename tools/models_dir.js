// Dossier de la base LOCALE des modèles 3D du planner (.glb, ~785 Mo, non versionnée).
//
// Une seule base pour tous les dossiers de travail : `meshes.out` de
// tools/extract/extract.config.json (chemin absolu, ou relatif à tools/extract/). Avant,
// chaque export écrivait dans le models/ du worktree d'où il était lancé : les 82 meshes du
// patch du 19/10 étaient restés dans un worktree, et aucune copie locale n'était complète.
// DuneExtract --meshes, tools/flatten_glb.js et tools/build_planner_standalone.js lisent tous
// ce même réglage. La copie de référence pour les joueurs reste celle du serveur
// (/srv/dune-map/models/) : les .glb nouveaux s'y envoient par WinSCP.
const fs = require('fs');
const path = require('path');

const EXTRACT = path.join(__dirname, 'extract');

module.exports = function modelsDir() {
  try {
    const conf = JSON.parse(fs.readFileSync(path.join(EXTRACT, 'extract.config.json'), 'utf8'));
    const out = conf.meshes && conf.meshes.out;
    if (out) return path.resolve(EXTRACT, out);
  } catch { /* config absente ou illisible : repli ci-dessous */ }
  return path.join(__dirname, '..', 'models');
};
