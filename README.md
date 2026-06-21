# DuneMap — Portail de la Maison des Havres Gris

Portail web de gestion collaborative pour guilde du jeu **Dune: Awakening**.  
Interface centralisée pour la cartographie, la planification et la coordination entre membres.

> [!NOTE]
> Ce site est partagé afin de faire bénéficier du travail réalisé à toutes les personnes qui pourraient être interessées par un tel projet. Je ne ferai pas de maintenance.

> [!NOTE]
> Pour être parfaitement transparent, je n'ai pas de connaissances en programmation et même si les idées et l'organisation du site sont de moi, **tout** est vibecodé par diverses IA


---

## Aperçu

DuneMap est un outil interne destiné aux membres de la guilde *Maison des Havres Gris*. Il permet de gérer les territoires, planifier les événements Landsraad et soumettre des demandes de craft, le tout dans une interface immersive à l'univers Dune.

---

## Fonctionnalités

### Menu Principal (`menu.html`)
- Grille de tuiles (CSS Grid), responsive : 2 colonnes sur tablette, 1 sur mobile
- 8 destinations : Cartographie, Métiers, Missions, Migration, Chroniques, Œil du Mentat, Constructeur de Base, Retours de Soirée
- Widget compte joueur et déconnexion accessibles depuis le menu

### Carte Interactive
- Visualisation des deux zones de jeu : **Bassin de Hagga** et **Désert Profond**
- Placement de bases avec marqueurs typés (Guilde, Landsraad, Joueur, Ressource)
- Zoom et navigation sur des cartes haute résolution
- **Wipe hebdomadaire automatique** du Désert Profond chaque mardi à 5h00 (heure de Paris)
- Minuterie de tempête affichée en temps réel
- Panneau d'administration pour approuver, modifier ou supprimer des bases

#### Hagga — Gestion multi-sietchs
- Liste fixe de **25 sietchs** (serveur Galacia)
- Sélecteur de sietch au-dessus de la carte pour filtrer la vue
- **Boutons rapides** apparaissant uniquement pour les sietchs qui ont au moins une base
- Bouton **Tous** en tête de barre : affiche toutes les bases d'un coup avec le total des joueurs
- Chaque bouton sietch affiche un **badge compteur** avec le nombre de bases dans ce sietch
- Chaque base est taguée avec son sietch ; cliquer un joueur dans la liste bascule automatiquement sur son sietch
- Un joueur a **une seule base principale** sur Hagga (avec son sietch)

#### Désert Profond — Instances PVP / PVE
- Le DD est split en **deux instances** : PVP et PVE
- Au placement, le joueur choisit son instance
- Icône avec **pastille rouge** (PVP) ou **bleue** (PVE)
- Légende visible sur la carte du Désert Profond
- Un joueur peut avoir une base dans chaque instance (max 2)

#### Désert Profond — Carte dynamique, champs d'épice et POI
- **`dd_seed.php`** détecte le **seed actif réel** de la semaine en lisant la page `dune.gaming.tools/deep-desert` (lien préchargé `seed=N` / `deepdesert_1_NN.d.json`). ⚠ Les numéros de seed de l'API gaming.tools ne sont PAS des compteurs hebdomadaires séquentiels (seeds vides intercalés), donc aucune formule de date ne peut les retrouver : seule la page source fait foi. Cache 30 min. Helper partagé par le proxy et le composeur de carte.
- **`dd_map_update.php`** recompose `deep_desert.jpg` chaque semaine en assemblant les 64 tuiles (8×8) du tileset `deepdesert_1_NN` (NN = seed actif via `dd_seed.php`)
- **`dd_proxy.php`** interroge, sur le **même seed actif**, deux sources gaming.tools côté serveur (cache 4h, invalidé au changement de seed) :
  - API acteurs (`seed=N`) → zones PVP/PVE, champs d'épice (L/M/S), filons titane/stravidium **regroupés en champs** (clustering serveur, badge = nb de nœuds)
  - données carte (`deepdesert_1_NN.d.json`, format « flatted » décodé en PHP) → **grottes, labos (stations de test), épaves**
  - ⚠ Correctif : avant, le proxy interrogeait `seed=0` (une vieille semaine figée) → l'épice avait toujours 1-3 semaines de retard
- Côté client, **barre de filtres à icônes** (façon method.gg) : chaque couche se masque/affiche, état mémorisé (localStorage). Visibles par défaut : grands champs d'épice + gros champs titane/stravidium
- Les marqueurs sont projetés via `gameToLeaflet()` (coordonnées monde gaming.tools → pixels Leaflet), validé contre le `gridCell` officiel de gaming.tools
- Chaque tooltip indique la **cellule de la grille** (ex. F5) et le nom du POI le cas échéant
- La carte est versionnée côté client (`?v=<seed>`) pour invalider le cache navigateur à chaque rotation de tileset

### Simulateur de Talents
- Arbre de compétences interactif avec allocation de points
- Plusieurs filières de métiers (Combat, Artisanat, etc.)
- Simulez et testez vos combinaisons de talents avant de les appliquer en jeu

### Commandes & Services (`skills.html`)
- Formulaire de soumission avec description détaillée
- Ajout de jusqu'à 4 images par demande
- Suivi et gestion des requêtes côté administration
- **Intégration Discord automatique** (`discord_helper.php` via `save.php`) : à la création, un embed est posté sur le salon (bordure dorée, type/note/lien + capture en **vignette**) ; à la prise en charge il devient **vert** avec « Pris en charge par … » ; une fois **terminé**, le message est **transformé en remerciement** (« 🙏 Merci à … », bordure violette, captures retirées) au lieu d'être effacé ; **supprimé** → le message Discord est effacé. Lien adaptatif (`window.location`), repli sur copie manuelle si webhook absent. URL du webhook dans `discord_webhook.txt` (non versionné). `discord_complete_message` est robuste (repli si Discord refuse `attachments:[]`, log dans `discord_debug.log`)
- Confirmation de suppression dans une modale stylisée (thème sombre, cohérent avec le site)
- **Suppression protégée** : seul l'auteur peut supprimer sa propre demande (vérification côté serveur) ; les demandes marquées « Terminé » sont verrouillées en historique permanent
- Correction : guard contre un `id` undefined sur les anciennes entrées (évite l'erreur `missing_data`)

### Plan de Migration (`migration.html`)
- Chaque joueur place son marqueur sur la carte et choisit son sietch de destination parmi **8 sietchs** : 5 premiers choix (Rajifiri, Fajr, Al Rab, Umbu, Tharwa) et 3 seconds choix (Kathib, Makab, Saajid)
- Deux types de placement : **Impératif** (base ne rentre nulle part ailleurs) ou **Souhait** (flexible)
- Gestion de la disponibilité : présent seul, présent avec fief libre à offrir, ou absent
- Système d'entraide : lier un helper à un joueur absent (sous-fief)
- Filtre par sietch, listes « Besoin d'un fief » et « Fief libre » en temps réel
- **Limite : 1 marqueur par joueur par sietch** — un joueur peut placer sur plusieurs sietches différents mais pas deux fois sur le même
- **Pseudo pré-rempli** depuis la session connectée ; champ verrouillé pour les joueurs, éditable pour les admins (placement pour un tiers)
- **Offre de fief** : en un clic depuis le popup, sans ressaisir son pseudo
- **Validation par un officier** : chaque marqueur démarre en attente (pointillés pâles) jusqu'à validation
  - ✔ **Valider** → marqueur passe en solide ; message Discord pré-rempli généré automatiquement
  - ✖ **Refuser** → note de refus obligatoire + jusqu'à 2 photos explicatives ; message Discord généré
  - Tout edit d'un marqueur le remet en attente de validation
- **Marqueurs refusés** affichés en orange pour que le joueur repositionne sans ambiguïté
- Message Discord copié en un clic (fermeture automatique de la fenêtre après copie)
- **Capture d'écran joueur** : avant validation, l'officier peut ajouter une photo de l'emplacement vérifié (glisser-déposer, coller Ctrl+V ou sélecteur de fichier) ; un message Discord est généré automatiquement pour inviter le joueur à vérifier sa position
- Accessible depuis le menu principal (tuile dédiée avec image `migration.png`)
- Header standard avec widget compte joueur et bouton retour **Menu**

### Planificateur d'Événements Landsraad
- Sélection de quêtes parmi 25 missions réparties en 5 catégories
- Gestion des participants (ajout/suppression de membres)
- Attribution automatique des rôles selon la composition du groupe
- Aperçu et sauvegarde des données de l'événement

### Chronologie de Dune
- Timeline de l'univers Dune sur 15 000 ans
- Référence historique et narrative pour les joueurs

### Télémétrie des Mondes (`dune_analytics.html`)
- **Accès restreint par défaut** : visible uniquement par les administrateurs
- L'admin peut ouvrir l'accès aux membres via le toggle **📊 Analytiques membres** dans le panneau ⚙️ de la carte (🔒 Restreint / ✅ Ouvert) — vérifié côté serveur
- La tuile est masquée sur le menu pour les membres non autorisés
- Le flag est persisté dans `settings.json` (doit être en `664` sur le serveur)
- Chargement automatique du fichier `dune_counts.csv` (ou import manuel par glisser-déposer)
- **Disclaimer** : bandeau précisant que les données proviennent de Gaming Tools, couvrent uniquement les **serveurs européens** (guilde française) et les joueurs présents dans Hagga Basin (hors Deep Desert)
- KPIs : monde le plus peuplé, pic d'affluence (d'un monde), sietch dominant, **tendance** (évolution sur la fenêtre courante vs la même durée précédente, calculée sur le **total** de connectés, label dynamique)
- **Cartes « Pic de connexion »** : pic du total de joueurs connectés sur les **3 derniers jours** et les **3 derniers mois**, avec indicateur d'évolution rapide (pic 3j rapporté au pic 3 mois)
- **Courbe « Fluctuations »** : **total des joueurs connectés par heure** (somme des mondes EU ; en vue serveur unique = population de ce serveur), avec rangeslider et boutons de zoom (12h → Max)
- **Matrice d'activité** (heatmap heures de pointe par jour, en **moyenne**), **Top 15 Mondes** et **Top 15 Sietches** se mettent à jour automatiquement selon la fenêtre temporelle visible sur la courbe (rangeslider inclus)
- Filtre global : monde cible ; drill-down clic/Ctrl+Clic sur les barres
- **Serveurs désactivés** (regroupement Funcom du 26/05/2026) : les 59 mondes fermés sont **retirés des listes déroulantes** (on ne peut plus s'y connecter) mais **conservés dans les données** pour que totaux, tendances et historique restent justes
- **Sietch dominant** : calculé sur le serveur le plus peuplé de la fenêtre active (ou le serveur sélectionné), pour éviter une moyenne diluée par des mondes quasi-vides
- **Comparateur de Serveurs et Sietches** : ajoutez plusieurs mondes pour comparer leurs courbes ; tableau de synthèse avec pop. moy. (période), pic, heure de pointe, tendance et sietch dominant par serveur — les stats et tendances se recalculent automatiquement selon la fenêtre de zoom du graphe de comparaison ; répartition par sietch dépliable avec tooltip d'évolution temporelle au survol
- **Chargement d'archive transparent** : les boutons de zoom > 1 mois (1m, 3m, 6m, 1y) déclenchent automatiquement le chargement de `dune_counts_archive.csv` si non encore chargé — fusion et déduplication en mémoire, sans action manuelle ; si les données archivées restent insuffisantes pour la période demandée, retour automatique à la vue Max
- **Lien vers la synthèse** : bouton « 📊 Synthèse Regroupement » dans l'en-tête, vers `rapport_regroupement.html`

### Synthèse Regroupement des serveurs (`rapport_regroupement.html`)

Rapport autonome (HTML + Plotly) destiné à la guilde, documentant le regroupement des serveurs EU de mai 2026 (87 → 28 mondes).

- **Comparaison Avant / Après** des 28 mondes conservés (population au pic début mai vs fin mai), côte à côte, pour identifier les mondes qui ont absorbé la migration
- KPIs : mondes fermés (59), conservés (28), croissance des survivants (×2,1), plus gros gain
- Synthèse rédigée + classement des mondes conservés par palier de population
- Bouton « ← Retour aux Analytiques » vers `dune_analytics.html`

### Collecte de données (`dune_logger_all.py`)

Script Python/Playwright tournant en cron toutes les heures sur le serveur. Scrape [gaming.tools/server-status](https://dune.gaming.tools/server-status) et alimente `dune_counts.csv`.

- **Whitelist des 87 serveurs officiels Hagga Basin** : seuls les serveurs officiels Funcom sont collectés (les serveurs privés apparus post-maj sont ignorés)
- Extraction DOM via Playwright : clic JS ciblé sur les serveurs officiels uniquement (évite le freeze de 30s causé par les 140+ serveurs privés)
- Correspondance nom DOM → nom canonique par sous-chaîne (gère les suffixes de région ex. `"Actaeon Europe Paris"` → `"Actaeon"`)
- Normalisation des espaces avant le regex pour éviter les décalages d'index avec `innerText` brut
- Filtrage des entrées parasites (`"Players Status"`) issues du DOM de gaming.tools
- Format CSV : `timestamp;serveur;sietch;joueurs` (séparateur `;`, encodage UTF-8)
- Cron suggéré : `0 * * * *` (toutes les heures)

### Archivage des données (`dune_archiver.py`)

Script Python d'archivage hebdomadaire. Maintient `dune_counts.csv` dans une fenêtre glissante de 30 jours.

- Lit `dune_counts.csv`, sépare les données récentes (< 30 jours) des anciennes
- Agrège les anciennes en **moyennes journalières** par `(jour, serveur, sietch)` avec timestamp `T12:00:00Z`
- Ajoute les lignes agrégées dans `dune_counts_archive.csv` (append, crée le fichier si absent)
- Réécrit `dune_counts.csv` avec uniquement les données récentes
- Cron suggéré : `0 3 * * 1` (tous les lundis à 3h)

---

### Constructeur de Base (`base_planner.html`)

> [!IMPORTANT]
> **Refonte v2 (2026-06) — moteur sockets + meshes réels du jeu.** Le planner n'utilise plus
> de primitives schématiques : il charge les **vrais maillages `.glb`** extraits du jeu (FModel)
> et un **accrochage par sockets** (points de connexion du jeu). Bascule via le flag `ENGINE`
> dans `base_planner.js` (`'sockets'` = nouveau moteur, `'legacy'` = ancien). Voir la section
> **« Refonte v2 »** ci-dessous. L'historique des sessions 0–8 (approche primitives) reste documenté plus bas.

Outil de planification 3D pour Dune Awakening. Permet aux membres de la guilde de poser virtuellement les pièces de construction du jeu sur une grille de claim avant de bâtir in-game.

#### Refonte v2 — Sockets + meshes réels (2026-06)

**Pourquoi.** L'approche v1 (chaque pièce = une primitive faite main) rendait les formes spéciales
(triangles, rampes longues, coins arrondis) non reconnaissables et coûtait un temps fou à caler.
Le reverse-engineering de `dune.layout.tools` a montré le bon chemin : réutiliser **les données du jeu**.

**Architecture (3 modules réutilisables) :**
- `planner_socket_engine.js` — moteur d'accrochage **sans dépendance Three** : matcher socket-à-socket
  généralisé (chaque socket actif vs chaque socket posé, compat `type`+`cost`), `gridSnap`, garde NaN,
  filtre de hauteur (`zHint`). Travaille en **cm Unreal** (X/Y horizontal, Z up).
- `planner_mesh.js` — rendu Three.js : cache `GLTFLoader`, matériau « argile » clair `DoubleSide`,
  fallback boîte dérivée des sockets, swap async glb→clay. Mesh FModel = mètres → échelle `100×SCALE`.
- `planner_pieces.json` — catalogue unifié (généré par `tools/build_planner_pieces.js`) : champs UI de
  `base_pieces_v3.json` + sockets/mesh/size de `dune_pieces_sockets.json`.

**Données du jeu (reverse de dune.layout.tools + extraction FModel) :**
- `dune_socket_profiles.json` (71 profils de sockets), `dune_group_config.json` (92 groupes),
  `dune_pieces_sockets.json` (552 pièces : sockets `{lx,ly,lz,yawDeg,cost,types}`, size, mesh).
- Meshes `.glb` : export FModel de `DuneSandbox/Content/Dune/Environment/PlayerBuilt/<Faction>/Outpost/Meshes/`
  (index **non chiffré**, UE **5.2.1**, profil natif `GAME_DuneAwakening`, `.usmap` auto). Aplatis dans
  `models/<basename>.glb` via `tools/flatten_glb.js`. **`models/` est gitignoré (~357 Mo, assets Funcom) —
  déploiement séparé via WinSCP.** Smuggler/Watershippers sous `/DLC/...` restent à exporter.

**Bridge coordonnées (intégration dans `base_planner.js`) :**
- 1 unité monde = 1 cellule = `CM_PER_CELL` (512 cm = 1 fondation) ; 1 niveau = `CM_PER_LEVEL` (384 cm) ;
  `WORLD_PER_CM = 1/512`. Échelle uniforme (pas de distorsion des meshes).
- Item v2 : `{ id, piece_id, x, y (cm), cz (cm hauteur), z (niveau d'étage), rotation }`.
  Sauvegarde **version 2** (`cz` sérialisé). Pas de migration v1 (repartir à zéro).
- Coutures : `buildMeshForPiece`/`placeMeshAt` → meshes ; `tryShowGhostForPiece`/`tryPlacePieceAt` → snap ;
  `loadCatalog` → catalogue + re-dérivation catégories (`deriveGameCategory`) + désactivation du groupement de variantes.

**Acquis v2 (vérifiés) :** accrochage fidèle (triangles, rampes, demi-pièces), centrage cases, anti-superposition,
rotation `R`/`Ctrl+molette` (autour du centre), **étages** (snap conscient de la hauteur, visibilité par span,
pièces hautes type Grande porte), vue solide, **limites du fief** (ghost rouge hors zone) + **grille dynamique**
qui suit l'extension du claim (5 extensions dans toutes les directions), sauvegarde/chargement v2.

**Pièges rencontrés (à retenir) :** une erreur d'éval ESM (déclaration dupliquée) fait planter **tout** le module
silencieusement → la console preview ne la capture pas ; diag via `import('/base_planner.js?probe=…').catch`.
Le **cache navigateur des modules ES** masque les déploiements → versioning `?v=lotX` sur le `<script>` + les
`import` (bumper à chaque modif) + Ctrl+Shift+R.

**Finitions (2026-06, lots `lot1`→`lot20`) :**
- **Stabilité (socket)** : `computeStabilitySocket` — connectivité par **coïncidence de sockets monde**
  (mêmes règles que le snap, `costMatch`/`typeMatch` exportés), **budget 10 pas** propagé en BFS depuis
  les ancres (fondations + **piliers/colonnes au sol**). Coût : horizontal 1, vertical via mur 1, via
  pilier/fondation 0. Rejet des jonctions **coin↔coin** (sinon raccourci diagonal sol↔sol). Bouton
  bouclier : vert/orange/rouge + pose bloquée si hors budget.
- **Catalogue mesh complet** : 100 % des factions structurelles (Atréides, Harkonnen, CHOAM, CHOAM N2,
  Abri CHOAM, Contrebandiers, Marchands d'eau, extra) + **17 machines** + **6 véhicules** (via les
  **proxy meshes** statiques `SM_ProxyMesh_*`, ornithoptères ailes ouvertes mais collision sur boîte
  garée). 3 racines de mesh : `Dune/Environment/PlayerBuilt`, `/Game/DLC/…`, `Dune/Vehicles/…`.
- **Vignettes de palette** : rendu offscreen des `.glb` (vue iso, lazy via IntersectionObserver, cache).
  Fallback **glyphe SVG** par type tant que le mesh charge / si absent. Piège CSS : `background:` (raccourci)
  réinitialise `background-size` → vignettes rognées ; fix `background-color:` + longhands JS.
- **Machines/véhicules** : pose libre centrée (empreinte parité-aware depuis la **vraie bbox du glb**,
  `real_size_m` ayant des axes incohérents) + **règles de pose** : pas de chevauchement placeable↔placeable,
  **sol porteur requis** sous l'empreinte, **pas à travers un mur**.
- **Auto-empilement** : cliquer plusieurs fois au même endroit empile murs/sols/fondations vers le haut
  (scan des niveaux, priorité au plus bas si accroche sous le curseur). Fondations/piliers idem.
- **Piliers/colonnes** = catégorie `foundations` (comme le jeu), **pose libre** au sol (ancres), empilables.
  Colonne **centrale** = support ponctuel (pas de bords) ; colonne **de coin** supporte les coins de sol.
- **UX** : sélection réparée (raycast récursif sur les groupes glb + surbrillance émissive), curseur
  contextuel (pointeur sur survol), drag-vs-clic (orbiter sans poser), **bouton Nouveau plan** + flag
  « modifié » + confirmation, **modale d'aide** (raccourcis + tutoriel), URL `?plan=` nettoyée après load.
- **Mode texturé : abandonné** — les `_M` exportés sont des masques packés, la couleur du jeu est composée
  à l'exécution par un matériau en couches (non reproductible). On garde l'argile (comme dune.layout.tools).

**Durcissement post-lancement (lots `lot21`→`lot33`, retours utilisateurs en prod) :**
- **Sol ↔ pilier** : le socket central des sols (`No_Cost`) est promu en `Foundation_Edge` au build →
  on peut poser un sol sur un pilier et inversement.
- **Chemins legacy réparés** : le drag-and-drop, le copier-coller d'étage (Ctrl+C/V) et la rotation d'une
  pièce posée passaient encore par l'ancien moteur (coordonnées cellules) → re-câblés sur le moteur sockets.
- **Mode solide actif par défaut** à l'ouverture.
- **Curseur 3D fidèle** : le point actif suit la géométrie sous la souris (raycast) ; l'étage suit l'**onglet**
  (sauf escaliers/rampes qui suivent la hauteur survolée pour enchaîner vers le haut). Les **sols arrondis**
  se posent via un **plan de construction** (projection sur un plan horizontal à la hauteur de l'étage) →
  fiable partout, quel que soit l'angle.
- **Sélection « clic-pour-traverser »** : un re-clic au même endroit sélectionne la pièce occultée derrière
  (utile en 3D quand un mur masque un sol).
- **Fief sauvegardé/rechargé correctement** : l'UI (onglets d'étage, compteurs d'extensions) est rafraîchie
  au chargement (bug `rebuildFloorTabs` inexistant corrigé) ; éditeur de fief mort retiré de la modale Sauvegarder.
- **Meshes machines/véhicules câblés dans le build** (`MV_MESH`) → plus perdus à chaque régénération de `planner_pieces.json`.
- **Rambardes inclinées** s'accrochent au flanc des escaliers/rampes ; le **mur arrondi** n'« aspire » plus le sol arrondi.
- **Anti-cache** : versioning `?v=lotX` sur le `<script>` + les `import` + le `fetch` de `planner_pieces.json`
  (bumper à chaque modif, actuellement `lot33buildplane`).

---

#### Historique v1 (approche primitives schématiques)

#### Choix techniques fondateurs
- **3D abstraite avec Three.js r170** (via importmap ES module + OrbitControls). Pas de modèles in-game importés ; chaque pièce est représentée par une primitive (pavé, prisme triangulaire, rampe inclinée, marches, quart de cylindre…). Le rendu 3D est intentionnellement schématique pour rester lisible comme un blueprint.
- **Double caméra** : orthographique top-down (vue plan, équivalent 2D) ↔ perspective orbit (vue 3D inclinée). Bascule par bouton ou touche `V`. C'est le pari ergonomique central : le plan reste l'outil de travail, la 3D sert à vérifier que ça tient debout.
- **Modèle de données sémantique** : chaque pièce porte `placement_rules` indiquant `snap_target` (cell / edge / corner), `footprint_shape`, `ignore_groups`. Le moteur de placement dispatche selon ces règles — pas de cas particuliers en dur.

#### Pipeline de données — v3 (datamining FModel direct)

La donnée est désormais entièrement dérivée des **DataTables FModel** du jeu, sans catalogue curé manuel :

```
j:\Download\Fmodel\Output\Exports\DuneSandbox\Content\Dune\Systems\Building\Data\
  BuildingData\DT_BuildingData_Atreides.json      ┐
  BuildingData\DT_BuildingData_Harkonnen.json      │  1 fichier par faction
  BuildingData\DT_BuildingData_Choam.json          │  (9 fichiers au total)
  BuildingData\DT_BuildingData_Choam_Level2.json   │
  BuildingData\DT_BuildingData_Choam_Shelter.json  │
  BuildingData\DT_BuildingData_Smugglers.json      │
  BuildingData\DT_BuildingData_Watershippers.json  │
  BuildingData\DT_BuildingData_Blockout.json       │
  BuildingData\DT_BuildingData_MiniSets.json       ┘
  BuildableGroupData\DT_BuildableGroupData_Building.json  (92 groupes, shapes, snap)
  DT_DuneBuildableUiSubcategory.json                      (catégories UI officielles)
                              ↓
               j:\Download\Fmodel\import_building_data.js   (script Node, ~350 lignes)
                              ↓
               base_pieces_v3.json   (670 pièces, ~820 KB, source unique du planner)
```

**Logique du script `import_building_data.js` :**
- La faction est dérivée du **nom du fichier** (pas de `m_BuildableFaction.Name` qui a des valeurs inconsistantes comme `Choam2`, `ExtraSets`, `Smuggler`)
- `m_BuildableBrushCornersShape` → forme de la grille (Square / TriangleIsosceles / TriangleEquilateral) via `BRUSH_SHAPE_MAP`
- `GROUP_VISUAL_SHAPE_OVERRIDE` : force `dim.shape = 'corner'` pour les groupes visuellement arrondis (`Wall_Round_Corner*`, `Roof_Round_Corner*`, etc.) que le jeu stocke avec footprint `Square`
- Hauteur inférée du suffixe : `_Half` → 0.5, `_Tall` → 2.0, sinon 1.0 ; largeur : `_Wide` → 2
- Détection fenêtres : `/window/i.test(rowId)` OU `group.startsWith('Window')` OU **`/fenêtre/i.test(label_fr)`** (capture les pièces comme `Wall_Round_Corner_03` = "Fenêtre arrondie" dont l'ID ne contient pas "Window")
- Labels depuis `m_DisplayName.LocalizedString` (traduction officielle du jeu)
- Filtre `faction_id !== 'blockout'` à l'usage (les Blockout restent dans le JSON comme référence)

Stats v3 (post-session 7b) : **670 pièces** = 643 structurelles + 19 machines (raffineries + fabricateurs, depuis `DT_PlaceableData_Functional.json`) + 8 véhicules (depuis les BPs `Systems/Vehicles/Blueprints/*`). 9 factions structurelles + 1 faction virtuelle `placeables` pour machines/véhicules (universelle).

#### État au moment de la pause de cette branche

**Sessions livrées :**

| Session | Contenu |
|---|---|
| 0 | Pipeline d'enrichissement (`tools/build_enriched_pieces.js`), génération `base_pieces_v2.json` |
| 1 | Socle Three.js : scène, caméras ortho/perspective, grille de claim 10×10, drag & drop palette → canvas, sélection / suppression, rotation, raycaster, bascule ortho ↔ 3D, HUD coords/zoom |
| 2 | Géométries sémantiques (prismes triangulaires pour wedges/round-corners, rampes inclinées, escaliers en marches, panneaux verticaux fins pour murs), snap par catégorie (cellule/arête/coin), Y-base correct par catégorie, hover indicator visuel, ghost rouge si conflit `ignore_groups` |
| 2.5 | **Correctifs placement vertical** : auto-stack murs (`findBestPlacementFloor` cherche le 1er étage libre), coexistence sol + toit dans `sameVerticalSpace`, fix `placeMeshAt` qui utilisait `state.currentFloor` au lieu de `item.z`. |
| 3 | **Système de claim complet** : boundary XZ + limites verticales strictes + gestion interactive des blocs (clic + / × avec validation BFS de connectivité) + pieux verticaux cliquables (5 pips) + onglets d'étage dynamiques [`getMinFloor()..getMaxFloor()`] + `ensureFloors()`. Règles : 1 bloc principal + 5 extensions horizontales max, shape libre, 5 pieux verticaux max (+7 niveaux / +5 sous-sol par pieu). |
| 4 | **Multi-étages lisibles** : opacité par étage (N-1 à 40%, N-2+ à 18%), contours discrets noirs, badge compteur sur chaque onglet (`updateFloorBadges`), HUD doré `↑ N2` quand l'auto-stack dépose sur un étage différent du courant (`showFloorResolveHud`), `userData.floorZ` sur chaque mesh. |
| 5 | **UX avancée** : géométrie stairs/ramps creuse, géométrie `Wall_Round_Corner` (quart de cylindre creux 8 segments), sous-catégories sidebar FR (70+ groupes), **undo/redo** stack 50 ops (Ctrl+Z/Y), **rotation** R + Ctrl+molette, **mode click-to-place** (highlight doré + ghost + pose multiple), détection toits par label (`isPieceRooflike`). |
| 5.1 | **Correctifs visibilité** : fix rotation géométrie triangulaire (`rotateX +π/2`), plafond physique (toit Z visible comme plafond depuis Z, plancher Z+1 idem), surbrillance sidebar stable après drag. |
| 5.5 | **Système demi-étages** : `state.ghostHalf` + bouton UI — `findBestPlacementFloor` retourne `currentFloor - 1` si ghostHalf actif, `placeMeshAt` ajoute `+0.5 * WALL_UNIT` en Y. Détection de conflit half-aware : edge snaps comparent `it.half !== state.ghostHalf`, cell snaps idem — deux pièces à ±0.5 du même niveau ne se bloquent plus mutuellement. |
| 6 | **Pipeline datamining v3** : `import_building_data.js` génère `base_pieces_v3.json` directement depuis les DataTables FModel. 9 factions (Atréides, Harkonnen, CHOAM, CHOAM Shelter, CHOAM N2, Contrebandiers, Marchands d'eau, Blockout, Mini-sets) avec onglets faction dans la sidebar. `BRUSH_SHAPE_MAP` mappe les enums jeu → géométrie JS. `GROUP_VISUAL_SHAPE_OVERRIDE` force `shape='corner'` pour les groupes visuellement arrondis (footprint Square dans le jeu, cylindre creux en 3D). Fenêtres arrondies distinctes des murs arrondis : cadre ouvert (`makeRoundCornerWindowGeometry` : allège + traverse + montants) + vitrage bleu (`makeRoundCornerWallGeometry` thin). Format JSON v3 : wrapper `{ pieces: [...] }`, champs `faction_id`, `label_fr/en`, `dimensions.w/d/h/shape`, `placement_rules.footprint_shape`, `menu_order`. |
| 6.1 | **Correctifs fenêtres & catégories** : (1) `isPieceWindowType` étendu au label_fr (`/fenêtre/i`) — capture `Wall_Round_Corner_03` = "Fenêtre arrondie" dont l'ID ne contient pas "Window" → correctement classé en `category: windows` dans v3 et rendu avec cadre ouvert + vitrage ; (2) `buildVariantIndex` utilise `getDisplayGroup(p)` à la place de `p.group` brut → fenêtres arrondies et murs arrondis ne partagent plus le même groupe de variantes ; (3) vitrage des fenêtres arrondies stocké dans `userData.cornerGlass` (pas `glassPanel`) → **toujours visible** même en solidView (opacité 0.38 normal / 0.18 solidView), épaisseur portée à 60% de l'épaisseur du mur pour être clairement identifiable. Même logique de détection appliquée dans `import_building_data.js` pour la génération du JSON. |
| 6.2 | **Murs triangulaires (géométrie 3D) + séparation Sols/Toits-plats** : (1) `makeTriangleWallGeometry(w, h, corner)` + helper `triangleWallCorner(group)` → 4 variantes BL/BR/TL/TR couvrant les 88 entrées `Wall_Triangle_*` (Half/Wide/Tall traitées automatiquement via `dim.w/h`) ; (2) `MIXED_FLOOR_GROUPS` whitelist (`Floor`, `Floor_Round_Corner`, `Floor_Round_Corner_Inverted`, `Floor_Wedge`) + `getDisplayGroup` suffixe `_Roof` aux pièces rooflike → séparation des tuiles "Toit plat" et "Plancher" dans la sidebar ; (3) `getEffectiveCategory` retourne `'roofs_flat'` pour les rooflike → catégorie sidebar séparée. `piece.category` JSON reste `'floors'` donc aucun impact sur `getCategoryYOffset` / `isPieceRooflike` / `ignore_groups`. |
| 8 | **Sauvegarde PHP + partage public + tuile menu** : (1) `base_planner_api.php` (~190 lignes) — CRUD plans avec actions `list`/`load`/`load_shared`/`save`/`delete`/`share`/`unshare`, stockage dans `base_plans.json`, ownership vérifiée pour les actions destructives. (2) Section persistance dans `base_planner.js` (~280 lignes) — `bpSerializePlanData` (claim + items, pas les meshes) / `bpApplyPlanData` (reconstruit les meshes via `buildMeshForPiece`) / `bpResetPlan` / modale save/list/share/delete câblées / auto-load via URL `?plan=<token>` (lecture seule si pas owner). Exposition explicite des fonctions sur `window` car le script est chargé en `type="module"` (scope module → handlers inline HTML ne voient pas les fonctions sans cet expose). Synchronisation `state.plan.{id,name}` avec `state.currentPlanId/Name`. (3) `menu.html` : tuile "Constructeur de Base" ajoutée comme 7ème carte (icône maison stylisée, fallback `intro.jpg`). Déploiement : `chmod 664 base_plans.json` lors de la première sauvegarde. |
| 7b (restreint) | **Machines + véhicules** : (1) Pipeline étendu (`import_building_data.js` + 100 lignes) — lit `DT_PlaceableData_Functional.json` pour 19 machines (whitelist `MACHINE_IDS_REFINERIES` 8 + `MACHINE_IDS_FABRICATORS` 11) et parse les BPs `Systems/Vehicles/Blueprints/{Ground,Flying}Vehicles/BP_*` pour 8 véhicules. Dimensions calculées depuis `m_PlaceableBoxesData.m_PlacementCheckBox.m_Extent` (machines) ou `VehicleInteractionComponent.m_BoxExtent` (véhicules) — convention `taille_cells = ceil(extent×2/100 / 2.5)`, `real_size_m` conservé pour rendu visuel. Constante `CELL_METERS = 2.5`, faction virtuelle `placeables`, flags `is_machine`/`is_vehicle`. (2) **Onglets sidebar Structures/Machines/Véhicules** (`state.activeTab`, `pieceTabOf(p)`, `TAB_CATEGORIES`, `setActiveTab`) avec pills faction cachées sur Machines/Véhicules. (3) **Rendu** : `createGeometryForPiece` retourne `BoxGeometry` aux vraies dimensions m (centré sur footprint), matériau semi-transparent (opacity 0.55, edges 0.75), couleurs distinctes via `getPieceColor` (`placeables=0xc8a64a` ambré machines, `vehicles=0x4a78b8` bleu acier véhicules), label sprite-canvas `makeMachineLabelSprite` flottant au sommet (depthTest false → toujours lisible). (4) **Blocage volumétrique** : `getOccupiedCells(piece, item)` (footprint avec échange w↔d à rotation 90/270), `getFloorRange` (`[z, z+h-1]` pour machines), `edgeAdjacentCells` / `cornerAdjacentCells`, `isMachinePlacementAllowed` (machine vs autre machine = intersection footprints ; vs mur = mur intérieur ; vs pilier coin = 4 cellules adjacentes ; vs pilier central = dans footprint ; vs sol/plafond via `carriedFloorIndex` → conflit ssi plancher porté strictement à l'intérieur de la plage verticale machine), `checkAgainstExistingMachines` (symétrique). (5) `findBestPlacementFloor` retourne `state.currentFloor` pour les machines (PAS d'auto-stack — ghost rouge force le changement d'étage manuel). |

**Sessions à venir :**

| Session | Contenu prévu |
|---|---|
| 7a | **Toits inclinés** : géométries dédiées pour `Roof`, `Roof_Half`, `Roof_Corner` (+ `_Half`, `_Inward`), `Roof_Round_Corner`, `Roof_Wedge_Bottom/Top`, `Roof_Cover_*`, `Angled_Wedge_*`. ⚠️ **Session partiellement faite** : les pièces sont posables et identifiables, mais les géométries sont des **approximations** (rampes / pyramides simples) qui ne correspondent pas à la réalité du jeu. **À refaire** sur la base des thumbnails FModel observés (`J:\Download\Fmodel\...\Thumbnails\Atre\`) : (1) **`Roof_Half`** = 3 plaques empilées en cascade descendante (escalier de toit Atréides), pas une rampe inclinée — c'est la signature visuelle de la faction ; (2) **`Roof_Corner_Half`** = cascade diagonale descendant vers un coin ; (3) **`Roof_Corner_Half_In`** = cascade concave inverse (proche de l'impl actuelle mais pas exactement) ; (4) **`Roof_Cover_*`** = wedge effilé asymétrique (auvent / couverture allongée), différencié par Bottom/Top (orientation du mur vertical) et Left/Right (miroir) ; (5) **`Roof_Round_Corner_Half`** = quart de cylindre arrondi sur ~3 niveaux verticaux superposés (pas un slab plate quart de disque) ; (6) **`Rooftop_*`** = toit plat avec léger décrochement décoratif. Pas de variantes "full height" en jeu — l'utilisateur empile plusieurs `_Half` pour gagner en hauteur. **`Roof_Wedge_*`** n'a pas de thumbnail dédié dans `Atre/` — probablement la même cascade orientée sur un footprint triangulaire. |
| 7c | **UX d'édition** : sélection multiple (Shift+clic), copier-coller un étage entier (Ctrl+C / Ctrl+V sur onglet d'étage), déplacement/rotation/suppression en groupe. |
| 7d | **Simulation de stabilité** : module dédié basé sur les sockets dataminés (`DT_DuneSocketCostsData.json` + `DT_DuneSocketSetupData.json`). Règles confirmées par vidéo : ancrage uniquement Foundation/Pillar/Column au sol, budget de **9 pas** propagé depuis chaque ancrage (1 pas = 10 unités cost), horizontal = 1 pas, vertical via mur = 1 pas, vertical via pilier/empilement fondations = 0 pas. Algorithme : BFS depuis pièces ancrées, pièces non atteintes → overlay d'alerte rouge. |

#### Conventions techniques (à garder en tête pour la suite)
- 1 cellule = 1 unité monde Three.js (CELL = 1)
- Axe Y = vers le haut (convention Three.js par défaut)
- 1 mur plein = 1 unité de hauteur (`WALL_UNIT = 1`)
- 1 bloc de claim = 10×10 cellules (`BLOCK_CELLS = 10`)
- **Surface de marche au niveau Z** = `FOUNDATION_DEPTH + Z * WALL_UNIT` (= 0.5 + Z)
- **Fondation au niveau Z** : pavé épais, TOP à la surface du niveau, BOTTOM 0.5 unité en-dessous
- **Sol au niveau Z** : slab fin (15 cm), TOP à la surface du niveau
- **Toit au niveau Z** (catégorie `roofs` OU groupe `Rooftop` OU label "Toit*/Plafond*") : slab fin, TOP à la surface du niveau Z+1 — un toit à Z et un plancher à Z+1 occupent **exactement le même Y**
- **Mur / pilier / escalier / porte** : posés sur la surface, montent de 1 unité (ou 0.5 pour les demis)
- **Demi-étage** (`dim.h === 0.5`, bouton UI ½) : `findBestPlacementFloor` retourne `currentFloor - 1`, `placeMeshAt` ajoute `+0.5 * WALL_UNIT`. Conflit détecté par comparaison `it.half !== state.ghostHalf`.
- Représentation des arêtes (`snap_target: 'edge'`) : `{ x, y, axis: 'h' | 'v' }` (forme canonique)
- Représentation des coins (`snap_target: 'corner'`) : `{ x, y }` aux intersections de grille (entiers)
- **`isPieceWindowType(p)`** : vérifie `/window/i.test(p.id)` OU `p.group.startsWith('Window')` OU `/fenêtre/i.test(p.label_fr)` — même logique dans le JS et dans `import_building_data.js`
- **`getDisplayGroup(p)`** : retourne `'Window_Round_Corner'` / `'Window'` pour les fenêtres, sinon `p.group` — utilisé par `buildVariantIndex` pour séparer les variantes fenêtres des variantes murs
- **`GROUP_VISUAL_SHAPE_OVERRIDE`** : liste de groupes dont `dim.shape` est forcé à `'corner'` (ex. `Wall_Round_Corner`) indépendamment du footprint jeu (`Square`) — nécessaire pour que la géométrie JS soit correcte
- **Historique undo/redo** : `state.history = [{undo, redo}]` + `state.histFront`, push à chaque place/remove/rotate, max 50 entrées
- **OrbitControls** : `enableZoom = false` — tout le zoom passe par `zoomBy(factor)`, ce qui libère Ctrl+molette pour la rotation du ghost

#### Fichiers de la feature

```
base_planner.html              # Layout + importmap Three.js + modales + CSS sidebar
base_planner.js                # Logique 3D complète (~6150 lignes, moteur sockets — script type="module" → expose API sur window)
base_planner_api.php           # CRUD plans côté serveur (list/load/save/delete/share/unshare)
base_pieces_v3.json            # Catalogue dataminé (670 pièces, ~820 KB, source unique)
base_plans.json                # Plans utilisateurs (créé automatiquement à la 1ère sauvegarde, chmod 664 si write_error)
base_planner_v1.bak.html       # Backup Konva (à supprimer après validation longue)
base_planner_v1.bak.js         # Backup Konva (idem)
tools/
  └── build_enriched_pieces.js # Script v2 — conservé mais remplacé par import_building_data.js

j:\Download\Fmodel\
  └── import_building_data.js  # Script v3 — génère base_pieces_v3.json depuis les DataTables FModel
                               # À relancer après chaque ré-extraction FModel post-patch du jeu
```

#### Relancer le pipeline après un patch jeu

```bash
# Depuis j:\Download\Fmodel\
node import_building_data.js
# → Écrit directement dans J:\Download\Serveur\Carte Dune OK\DuneMap\base_pieces_v3.json
# Puis déployer base_pieces_v3.json + base_planner.js via WinSCP → /srv/dune-map/v2/
```

#### Raccourcis clavier / souris

| Raccourci | Action |
|---|---|
| `R` | Rotation +90° de la pièce sélectionnée OU du ghost (drag / click-to-place). Reset vue si rien d'actif. |
| `Ctrl + molette` | Rotation ±90° du ghost pendant drag ou click-to-place |
| `Molette` seule | Zoom (ortho ET persp) |
| `Ctrl + Z` | Undo (place / remove / rotate) |
| `Ctrl + Y` ou `Ctrl + Shift + Z` | Redo |
| `Delete` / `Backspace` | Supprime la pièce sélectionnée |
| `V` | Bascule caméra ortho ↔ perspective |
| `Escape` | Annule le mode click-to-place ou désélectionne |
| Clic dans la sidebar | Active la pièce pour pose au clic (toggle on/off) |
| Clic sur une pièce posée | Sélection ; **re-clic au même endroit** → pièce occultée derrière (clic-pour-traverser) |
| Clic droit canvas | Annule le mode click-to-place |
| Drag depuis la sidebar | Glisser-déposer (utilise le même moteur sockets que le click-to-place) |
| `T` | Bascule **vue solide** (active par défaut) |
| Onglets d'étage / `?` | Choix de l'étage de pose · bouton **?** = aide intégrée (fonctions + raccourcis) |

#### Reprise dans une nouvelle session — checklist
1. Relancer le pipeline si FModel a été ré-extrait : `cd j:\Download\Fmodel && node import_building_data.js`
2. Vérifier que `base_pieces_v3.json` (~780 KB) est bien déployé sur le serveur
3. Le HTML porte des inline scripts pour les modales (save/plans/share) — fonctionnels visuellement mais l'appel API n'existe pas encore (prévu session 8)
4. `base_placeables_data.json` est référencé dans le code mais **n'existe pas encore** — prévu session 7
5. Les `placement_rules.ignore_groups` sont exploitées (matrice de compatibilité opérationnelle)
6. Three.js et OrbitControls sont chargés via importmap depuis `unpkg.com`

---

### Retours de Soirée — Épice (`epice/debrief.html`)
Outil de **préparation, débrief et analyse** des sorties de récolte d'épice en zone PvP (doctrine 100 % aérienne, « personne au sol »). Quatre onglets : **Organisation**, **Manuel de combat**, **Retour joueur**, **Admin**.

- **Organisation** (tout membre connecté) : menu déroulant des raids (page vide par défaut, auto-affichage du raid en préparation s'il existe) → composition en **lecture seule**. Distingue **« sur le terrain »** (rôles + placement, passagers Faucon compris) et **« groupes en jeu »** (groupes de **max 4** = ce que chacun voit sur la carte). Boussole cardinale pour la Défense, badges CS/CDR/CP. Un raid clôturé n'apparaît plus comme actif mais reste consultable.
- **Manuel de combat** : doctrine de guilde (règles aériennes, DEADZONE, format des callouts, manœuvre Faucon, scénarios JAUNE / ORANGE / ROUGE, fiches de rôle).
- **Retour joueur** : le joueur **choisit son pseudo** dans la liste des participants, note la soirée (cristaux + 4 axes) et coche points positifs / points noirs. **Un seul retour par pseudo, modifiable tant que la soirée n'est pas clôturée.**
- **Admin (organisateurs)** : composition d'équipes (commandement, récolte, **défense cardinale ± Faucon**, groupe à distance non plafonné, **groupes en jeu** pré-remplissables), cycle de vie de la sortie (créer / clôturer / supprimer / réinitialiser la compo), synthèse des retours (moyennes par axe, points forts/faibles) et **analyse IA** (proxy `api-gemini.php` → Gemini) au format structuré, **sauvegardée et consultable** dans l'historique.
- **Rôles** (auth serveur par session — voir *Authentification*) : *consultation* = membre connecté ; *organiser* = **admin OU organisateur** (pseudo listé dans `epice/data/organizers.json`, géré par les admins via le sous-onglet « Organisateurs ») ; un organisateur ne peut supprimer que **ses propres** sorties.
- Stockage JSON (`epice/data/debriefs.json`) ; clé Gemini hors Git (`epice/config.php`) ; protection compo : édition possible uniquement si une soirée est ouverte.

---

### Mon Compte (`account.html`)
- **Widget compte joueur** présent dans toutes les pages : cercle avatar + pseudo, clic → page compte
- Avatar personnalisable : grille de presets + upload personnel (redimensionné 200×200 px côté serveur via PHP GD, crop centré automatique)
- Les avatars uploadés sont privés : chaque joueur ne voit que les siens dans le sélecteur
- Discord : saisie et sauvegarde du pseudo Discord
- Changement de mot de passe sécurisé
- **Stats** : bases placées, destinations signalées, rang
- **Historique commandes** : tuiles dépliantes « Commandes passées » (avec statut : en attente / en cours / terminé) et « Services rendus » (demandes fulfillées par le joueur)

---

## Authentification et Rôles

- Inscription et connexion sécurisées
- Deux niveaux d'accès : **Joueur** et **Administrateur**
- Gestion des utilisateurs (création, suppression, changement de rôle) via le panneau admin
- L'administrateur principal (`Abarrach`) ne peut pas être rétrogradé
- **Toutes les pages sont protégées** par `auth-guard.js` — tout accès direct sans session active redirige vers `index.html#login`
- **Auth serveur (épice)** : les endpoints de l'outil *Retours de Soirée* vérifient la session PHP **côté serveur** (`epice/auth_epice.php`), pas seulement le garde client. Rôle **organisateur** = admin OU pseudo dans `epice/data/organizers.json`
- La déconnexion efface la session localStorage et redirige vers la page de connexion

---

## Stack Technique

| Couche | Technologies |
|--------|-------------|
| Frontend | HTML5, CSS3, JavaScript (ES6+ modules), Leaflet.js, Three.js r170 (Base Planner) |
| Backend | PHP 7+, API REST, stockage JSON |
| Outillage | Node.js (scripts de génération de données, ex. enrichissement FModel → JSON) |
| Style | CSS personnalisé, Tailwind CSS (actualités) |
| Médias | Images haute résolution, icônes PNG |

---

## Structure du Projet

```
DuneMap/
├── index.html            # Écran d'introduction (bandeau guilde, bouton Entrer, modale login flottante)
├── menu.html             # Hub de navigation principal
├── map.html              # Carte des territoires
├── 404.html              # Page d'erreur 404 thématisée Dune
├── account.html          # Page compte joueur (avatar, Discord, stats, historique)
├── skills.html           # Simulateur de talents + demandes de craft
├── planner.html          # Planificateur Landsraad
├── migration.html        # Coordinateur de migration vers Icarus
├── dune_analytics.html   # Télémétrie des mondes (stats population)
├── rapport_regroupement.html # Synthèse guilde : regroupement serveurs EU (mai 2026)
├── dune_chronologie.html # Chronologie de l'univers
├── news.html             # Actualités du jeu
├── register.html         # Création de compte (design deux colonnes : formulaire + présentation guilde)
├── base_planner.html     # Constructeur de Base 3D (Three.js, moteur sockets v2) — LIVRÉ en prod
│
├── script.js             # Logique cartographique (Leaflet, marqueurs, Désert Profond)
├── skills.js             # Simulateur de talents + commandes de craft
├── planner.js            # Planificateur d'événements
├── migration.js          # Logique de migration (validation, refus, Discord)
├── base_planner.js       # Logique 3D du Constructeur de Base (Three.js, moteur sockets, ~6150 lignes)
├── auth-guard.js         # Protection des pages (redirection login si non connecté)
│
├── save.php              # API principale (bases, utilisateurs, craft, commandes)
├── auth.php              # Authentification
├── api.php               # Données de groupe
├── account_api.php       # API compte joueur (avatar, profil, stats, historique)
├── migration_api.php     # Réservations de migration (validation, refus, entraide)
├── dd_seed.php           # Détection du seed Deep Desert actif (page gaming.tools) — partagé
├── dd_map_update.php     # Composition de deep_desert.jpg depuis les tuiles CDN gaming.tools
├── dd_proxy.php          # Proxy serveur : épice (L/M/S) + filons + POI (grottes/labos/épaves)
│
# Collecte & archivage (sur le serveur, hors DuneMap/)
# /home/dune/dune_logger_all.py   # Scrape gaming.tools toutes les heures → /srv/dune-map/dune_counts.csv
# /home/dune/dune_archiver.py     # Archive hebdomadaire : fenêtre 30j + moyennes journalières
│
├── bases.json            # Bases des territoires
├── requetes.json         # Demandes de craft
├── profiles_data.json    # Profils joueurs (avatar, Discord)
├── landsraad_data.json   # Quêtes disponibles
├── metiers.json          # Définitions des talents
├── base_pieces_v3.json   # Catalogue dataminé des pièces du Constructeur de Base (670 pièces, ~820 KB)
├── base_placeables_data.json  # Catalogue des placeables Dune Awakening (469 objets)
├── last_wipe.txt         # Horodatage du dernier wipe hebdomadaire du Désert Profond
│
├── tools/                # Scripts d'outillage (génération de données, Node.js)
│   └── build_enriched_pieces.js  # Génère base_pieces_v2.json à partir des exports FModel
│
├── epice/                # Outil « Retours de Soirée »
│   ├── debrief.html      # UI (Organisation / Manuel de combat / Retour joueur / Admin)
│   ├── data-api.php      # CRUD sorties / retours / compo / analyse (stockage JSON)
│   ├── api-gemini.php    # Proxy IA (analyse) → Gemini
│   ├── auth_epice.php    # Auth serveur partagée (session + rôle organisateur)
│   ├── config.example.php # Modèle de config (clé Gemini) — config.php hors Git
│   └── data/             # debriefs.json + organizers.json (runtime, hors Git)
│
├── avatars/              # Avatars presets + uploads joueurs (préfixe u_pseudo_)
├── uploads/              # Images des demandes de craft
├── images/               # Ressources statiques (404_bg.jpg, etc.)
├── map.jpg               # Carte Bassin de Hagga
├── deep_desert.jpg       # Carte Désert Profond (regénérée chaque semaine)
└── icons/                # Icônes de marqueurs
```

---

## Déploiement

Le projet nécessite un serveur PHP (Apache/Nginx) avec les droits d'écriture sur les fichiers JSON et le dossier `uploads/`.

```bash
# Cloner le dépôt
git clone <url-du-repo>

# Placer dans le répertoire web du serveur
# et s'assurer que PHP peut écrire dans :
chmod 664 *.json last_wipe.txt
chmod 775 avatars/ uploads/
```

> [!IMPORTANT]
> Le fichier `bases.json` doit être déployé manuellement depuis la copie locale après chaque migration de données. PHP doit pouvoir écrire dessus — si une erreur `write_error` apparaît, vérifier les permissions : `chmod 664 bases.json`.

> [!IMPORTANT]
> Le dossier `avatars/` doit exister et être accessible en écriture par PHP (`chmod 775`, propriétaire `www-data`) pour permettre l'upload d'avatars personnalisés.

> [!IMPORTANT]
> `settings.json` doit être en `664` pour que PHP puisse y écrire (toggle accès analytiques). Si l'erreur `write_error` apparaît lors du basculement du toggle, corriger avec `chmod 664 settings.json`.

> [!IMPORTANT]
> `dune_counts.csv` et `dune_counts_archive.csv` sont dans `/srv/dune-map/` (propriétaire `dune`, groupe `www-data`, droits `664`). Le logger et l'archiver tournent sous l'utilisateur `dune` ; nginx/php-fpm sous `www-data` peut lire les fichiers. Crons à configurer dans `crontab -e` (utilisateur `dune`) :
> ```
> 0 * * * *  /home/dune/.venvs/dune_logger_env/bin/python /home/dune/dune_logger_all.py >> /home/dune/data/dune_logger_cron.log 2>&1
> 0 3 * * 1  /home/dune/.venvs/dune_logger_env/bin/python /home/dune/dune_archiver.py >> /home/dune/data/archiver.log 2>&1
> ```

> [!IMPORTANT]
> Outil **Retours de Soirée** (`epice/`) : copier `epice/config.example.php` → `epice/config.php` (clé Gemini, hors Git). `epice/data/` doit être inscriptible par PHP (`chmod 664 epice/data/*.json`, dossier `775`, propriétaire `dune:www-data`). Bloquer l'accès web direct au dossier de données dans la conf nginx :
> ```nginx
> location ^~ /epice/data/    { deny all; }
> location ^~ /v2/epice/data/ { deny all; }
> ```

Accéder ensuite à `index.html` via le navigateur.

---

## Responsive Mobile

Le site est adapté pour une consultation sur téléphone :
- Header fixe sur la carte (reste visible même après interaction avec Leaflet)
- Menu principal : cartes qui s'empilent en 2 colonnes (tablette) puis 1 colonne (mobile)
- Panneaux de la carte repositionnés et redimensionnés selon la largeur d'écran
- Tooltip sietch (Œil du Mentat) confiné dans les limites de l'écran
- Planificateur et colonnes de skills ajustés pour petits écrans

---

## Thème Visuel

Interface entièrement thématisée autour de l'univers de Dune :
- Palette désertique (or `#cda434`, sable `#f5deb3`, brun profond `#1a1007`)
- Fond atmosphérique `menu_bg.png` appliqué globalement via l'élément `html` (non affecté par l'animation `fade-in` du `body`)
- Filigrane semi-transparent du blason de guilde (`images/logoguilde.png`) sur toutes les pages
- Écran d'accueil (`index.html`) : bandeau `guilde.png` + bouton `enter_arrakis.png` avec `mix-blend-mode: screen` (supprime le fond noir sans retouche de l'image)
- Login : modale flottante avec glassmorphism (`backdrop-filter: blur`) et animation `floatIn` ; s'ouvre via URL hash `#login` depuis `register.html` et `auth-guard.js`
- `register.html` : mise en page deux colonnes (formulaire à gauche, présentation guilde à droite)
- Animations : fondu, lueur, vibration
- Design responsive adapté aux différentes tailles d'écran

---

## Licence

Voir le fichier [LICENSE](LICENSE).
