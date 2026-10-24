# Constructeur de Base — édition publique (autonome, statique)

Version **indépendante** du Constructeur de Base, à héberger sur **n'importe quel serveur**
statique (nginx/Apache, autre VPS, Netlify, Cloudflare Pages…). Aucun lien avec le site
principal : **pas de compte, pas de PHP, pas de base de données**.

Le partage se fait par **lien auto-porteur** : le plan est compressé et encodé dans l'URL
(`…/index.html#p=…`) ; celui qui ouvre le lien voit la base, sans backend. Pour les très gros
plans : **Exporter / Importer** un fichier `.json`.

---

## Ce dossier est GÉNÉRÉ

Seuls ce `README.md` et `nginx.conf` sont suivis par git. Tout le reste est produit à partir
du planner du site, tel qu'il est au moment où on lance :

```bash
node tools/build_planner_standalone.js                      # page + scripts + données
node tools/build_planner_standalone.js --models=<dossier>   # + les modèles 3D
```

Le générateur part de `base_planner.html` et y applique quelques transformations : pas de
garde de connexion ni d'en-tête du portail, et les boutons de sauvegarde serveur
(Sauvegarder / Mes plans / Partager) remplacés par **Partager le lien / Exporter / Importer**
(`tools/planner_standalone_partage.js`). Il recopie ensuite les fichiers que la page et les
modules chargent (`base_planner.js`, `planner_socket_engine.js`, `planner_mesh.js`,
`planner_pieces.json`, `planner_costs.json`, `base_pieces_v3.json`, `style.css`, `dune-tip.js`).

**Mettre à jour** après une évolution du planner du site = relancer le générateur. Si la page
du site a changé au point qu'un repère n'est plus trouvé, il s'arrête en le nommant : il suffit
d'adapter le repère dans `tools/build_planner_standalone.js`.

Historique : la première version (juin 2026) était une copie faite à la main ; vingt lots plus
tard, elle n'avait plus grand-chose à voir avec le site. D'où le générateur.

### Les modèles 3D (`models/`, ~357 Mo)

Ils ne sont pas versionnés (assets du jeu). La copie complète et à jour est sur le serveur du
site : `/srv/dune-map/models/`. La récupérer (WinSCP) puis la passer au générateur avec
`--models=<dossier>`, ou la déposer directement à côté de `index.html`.

### Dépendance externe : Three.js

Chargé depuis le CDN (voir l'`importmap` de la page) : le visiteur doit avoir accès à Internet.

---

## Déploiement

Site **statique** : poser le dossier sur l'hébergeur. Les modules `.js` doivent être servis en
`text/javascript` et les `.glb` en binaire (nginx/Apache le font par défaut). Ouvrir
`index.html` en `file://` ne marche **pas** (modules ES et `fetch` exigent http(s)).

Exemple nginx : `nginx.conf` (cache long sur les `.glb`, qui ne changent pas).

Hébergeurs statiques : attention à la taille de `models/` (quotas selon l'offre). Un petit VPS
nginx est le plus simple pour ce volume.

---

## Utilisation

- **Construire** : comme le constructeur du site (structures, machines, utilitaires,
  véhicules, étages, vue 3D/plan, stabilité, Synthèse).
- **Partager le lien** : génère un lien contenant le plan et le copie dans le presse-papiers.
- **Exporter / Importer** : sauvegarde / charge un plan en fichier `.json`.

Navigateur récent requis (Chrome/Edge 80+, Firefox 113+, Safari 16.4+) : le lien utilise
`CompressionStream` (gzip natif).
