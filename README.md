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
- Grille de tuiles (flex-wrap), responsive : la dernière ligne reste centrée, 1 colonne sur mobile
- 10 destinations : Cartographie, Métiers, Missions, Migration, Chroniques, Œil du Mentat, Constructeur de Base, Optimiseur de Stuff, Retours de Soirée (Activité Guilde), Hub Jeux
- **Tuiles générées depuis le registre central `pages.js`** — ajouter une page = une seule entrée, elle apparaît automatiquement dans le menu **et** dans la gestion des accès (Mon Compte)
- **Accès par tuile** (défini par les admins, voir Mon Compte) : *active* (visible/cliquable), *pas active* (masquée pour les joueurs), *en travaux* (grisée + image `en_travaux.png` + non cliquable). Les admins voient et accèdent à tout en permanence, mais les tuiles non standard sont **signalées visuellement** : *en travaux* → ruban + image `en_travaux.png` ; *masquée* → vignette désaturée, icône œil barré et ruban « Masquée »
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
- **Accès géré comme toutes les autres tuiles** depuis **Mon Compte > Gestion des pages** (clé `analytics`) : *active* / *pas active* / *en travaux*. L'ancien toggle « 📊 Analytiques membres » du panneau ⚙️ de la carte a été retiré ; l'ancien flag booléen `analytics_public` est migré automatiquement vers `pages.analytics` au premier appel de `getSettings`
- La tuile est masquée (ou grisée) sur le menu pour les joueurs selon l'état choisi ; l'accès direct par URL est bloqué par `page-guard.js`
- L'état est persisté dans `settings.json` → `pages.analytics` (le fichier doit être en `664` sur le serveur)
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

### Optimiseur de Stuff (`optimiseur.html`)
Outil de **composition et comparaison de builds** — armes, armures, augments **et capacités/techniques** — avec stats cumulées, **DPS optimisé** et recettes. Permet de tester des combinaisons d'équipement et de s'optimiser. Tout en **français**.

- **Mode Simple / Expert** (toggle en haut de page, à côté de « Partager le build ») — revue d'ergonomie 2026-07-03 : la page dense (16 barres de mitigation/EHP empilées, 3 réglages mélangés dans une seule ligne, 979 caractères de texte formule toujours visibles) rebutait un débutant. **Mode Simple** (par défaut) : loadout + 5 métriques bandeau + DPS/TTK essentiels par arme + recette + capacités — l'essentiel pour équiper et comparer sans se noyer. **Mode Expert** : tout l'existant (réglages Perso/Cible/Résistances, détail mitigations/EHP, grille de stats complète par arme, rolls/qualité/pièce des augments). Préférence **stockée en `localStorage`** séparément du build (`optim_uimode`), donc **non partagée** par le lien « Partager le build ». Correctifs universels (les deux modes) : la note d'explication des formules est passée d'un bloc de texte toujours visible à une **icône ⓘ** cliquable à côté du titre « Stats cumulées » ; les 8 barres de % de mitigation et les 8 barres de PV effectifs (EHP) sont désormais dans **2 onglets** au lieu d'être empilées (16 barres → 8 à la fois).
- **Loadout** (colonne gauche) : 10 emplacements — *Arme principale / secondaire*, *Tête / Torse / Mains / Jambes / Pieds* (armure légère, lourde, stillsuit ou combinaison utilitaire selon la partie du corps), *Augment 1-3*. Clic sur un emplacement → **picker** (recherche par nom, tri *meilleure stat / tier / nom*, rareté + tier + sous-catégorie affichés). **Comparateur instantané** (roadmap Phase 1 ①) : chaque candidat affiche sa **métrique « comme équipé »** (DPS optimisé pour une arme, valeur d'armure pour une pièce — toutes deux **à grade max**, selon tes capacités/options) et, si le slot est déjà occupé, le **Δ vert/rouge** face à l'objet équipé (badge « équipé » + surlignage sur la ligne en place) — pour comparer **sans équiper**. Cohérent par construction (mêmes calculs que le bilan). Augments : pas de Δ (aucune stat chiffrée, cf. Phase 0). Un bandeau d'aide rappelle la métrique et l'objet de référence. **Couleurs sémantiques + meilleur en évidence** (roadmap Phase 1 ②) : la valeur de chaque candidat est colorée sur une **échelle calibrée** (vert excellent → or → terne) avec une **mini-barre heatmap**, et le **meilleur objet de sa catégorie** porte un badge **« ★ Meilleur »** + surlignage. Dans le loadout, chaque arme/pièce équipée affiche un repère **★** (meilleur de sa catégorie pour l'emplacement) ou **▲ +X** (un meilleur de la même catégorie existe, gain au potentiel max). **Comparaison « ce qui est comparable » (theorycrafting)** : la « meilleure valeur » (★ / barre) est **normalisée par catégorie**, jamais globalement — un laser (arme lourde) ne se compare pas à un pistolet, une combinaison antiradiations pas à un plastron. Le picker **regroupe les candidats par catégorie** avec en-têtes : pour les **armes** → *Fusils, Armes de poing, Fusils à dispersion, Armes lourdes, Lames* (toutes les lames longues + courtes ensemble) ; pour les **armures** → *Armure légère, Armure lourde, Distilles, **Combinaisons** (antiradiations/utilitaires, traitées à part car usage spécifique full-body), Tenues sociales*. Le **Δ** reste un **écart absolu** vs l'objet équipé (vrai impact sur le build). La base de comparaison est **expliquée dans le bandeau** du picker. **Filtres** (roadmap Phase 1 ③) : 3 menus *Tier / Rareté / Sous-type* dans la barre du picker, **peuplés dynamiquement** avec les seules valeurs présentes pour le slot (sous-types en français : Fusils, Armes de poing, Lames longues, Armure légère, Distille…), **cumulables** avec la recherche et le tri ; masqués dans le picker de capacités/techniques. **Sélecteur de grade/qualité** par arme (Base → Grade 5) : le DPS scale fortement avec le grade (~2,4× au grade 5), défaut au grade max ; dég/tir, DPS brut/effectif et dég. bouclier suivent. Calculé en local depuis les **multiplicateurs dataminés** des courbes `CF_*PerQuality` (Q_DAMAGE/Q_SHIELD/Q_ARMOR dans `optimiseur.html`) — courbes globales, donc valable sans donnée par-arme. **Armure** aussi : sélecteur de grade sur chaque pièce → la valeur d'armure scale (×1,69 au grade 5) et le % de réduction se recalcule ; les mitigations restent fixes (conforme au jeu : seule `ArmorValue` scale). **Infobulle au survol** (objet du picker ou équipé) → toutes les stats détaillées, pour ne pas choisir à l'aveugle. Pour les **augments** : description FR (`desc`, **dataminée** — `tools/build_descriptions_from_datamine.js` lit `CDT_BaseItems` exporté de FModel en Français → LongDesc = effet détaillé avec compromis ; couverture 100 %, plus de dépendance Cloudflare) **et** effets chiffrés (au potentiel max Q5/roll 100 %, fourchette min…max si rollé) — l'infobulle et un résumé compact directement dans la ligne du picker (ex. « +48 % Dégâts ») évitent de devoir équiper pour connaître l'effet. Build **persisté en `localStorage`** et **partageable par lien** (bouton « Partager le build » → URL avec `#b=` base64url encodant tout le build, copiée au presse-papier ; ouvrir le lien recharge le build complet).
- **Capacités & Techniques** (panneau bas) : sélection multiple parmi les **113 capacités/techniques/attributs** du jeu (`skills.d.json`), avec **sélecteur de niveau** (1→max) par skill. Leurs **bonus de dégâts** (`WeaponDamageBonus`, `RangedDamageBonus`, type-spécifiques `Rifle/Pistol/Scattergun/Lmg/Lasgun/…`, `Melee/Blade`) sont **détectés selon l'arme équipée** et **cumulés dans le « DPS optimisé »** = DPS effectif × (1 + Σ bonus applicables). Les bonus **conditionnels** (tête/corps/dans-le-dos/attaque surprise) sont listés à part, non inclus dans le chiffre principal pour ne pas le gonfler.
- **Stats cumulées** (colonne droite) : bilan défensif **additionné sur les pièces d'armure** (armure totale, durabilité, et mitigations *lame / dard léger / dard lourd / concussion / énergie / feu / radiation / poison* en barres ; les **malus** ressortent en rouge) + stats offensives **par arme** (principale ET secondaire, chacune avec son **DPS optimisé propre** — les bonus de capacités/techniques applicables diffèrent selon le type d'arme : un bonus « fusil » ne booste pas une lame) + bloc **« Apports des capacités & techniques »** (effets non-DPS agrégés : résistances, survie, endurance…). **Augments d'armure équipés** (Phase 0 v2) : les **mitigations** (Add, réduc. par type) sont **additionnées** aux barres ci-dessus quelle que soit la pièce (flat, comme les pièces d'armure) ; le **bonus d'armure** (%, Multiply) ne s'applique **qu'à la pièce choisie** par l'utilisateur dans le détail de l'augment équipé (sélecteur « Bonus d'armure appliqué sur… », auto-sélection si une seule pièce compatible équipée) — un augment est serti sur une seule pièce alors que les 3 emplacements du build sont globaux, donc jamais deviné/appliqué aux 5 pièces (éviterait de gonfler le total). **EHP / Survie** (roadmap Phase 2.1) : bloc **« PV effectifs par type de dégâts »** sous les barres de mitigation — PV max (métrique bandeau, éditable via **PV de base** communautaire dans la barre d'options + bonus **Vitalité** dataminé du skill) divisé par ((1−réduc. armure)×(1−mitigation du type)), profil par type (pas de score unique), barre heatmap calibrée sur le max des 8. Cinq métriques en bandeau : **DPS optimisé, DPS arme (effectif), Armure totale, PV max, Durabilité**.
- **Barre d'options** (modèles communautaires, repris de dune.naguya.tech, affichés comme tels — pas officiels Funcom, **non dataminés**) : **Armure → % de réduction** (`armure/(armure+500)`, plafond 95 %, rendements décroissants) ; **toggle PvE/PvP** (dégâts ×0,4 en PvP) ; **Tirs à la tête** (multiplicateur éditable × bonus tête des skills → « DPS tête » par arme à distance) ; **Perso** → **PV de base** éditable (défaut 150, communautaire) pour le calcul d'EHP ; **Cible** (PV + armure adverse) → ligne **« Tirs/coups pour tuer la cible »** par arme, recalculée avec le grade, les bonus, le mode PvP et la réduction d'armure de la cible (même pipeline que le DPS → chiffres cohérents entre eux). **Résistances de la cible** (bouton « Résistances ▾ ») : grille des 8 types de mitigation, % éditable par type, appliquée en plus de l'armure de la cible (`(1−réduc. armure)×(1−résistance du type)`) — le type de dégâts de l'arme est détecté automatiquement (stat `damageType`) et mappé sur la bonne résistance ; note de transparence sous chaque TTK (« dont X % réduc. armure + Y % résist. [Type] »), à saisir manuellement selon la cible visée (pas de préréglages inventés).
- **Recette & composants** : au choix d'une arme ou d'une pièce, affiche la **recette de craft** (ingrédients + quantités, icônes) et le prix vendeur — répond au *« où trouver les composants »*. **Emplacements de loot** (2026-07-03, `stuff_loot.json`) : pour les objets uniques trouvables à un **lieu nommé** (5 stations expérimentales à thème élémentaire Feu/Électricité/Poison/Obscurité/Radiations + le donjon *The Old Quarry*), section « Se trouve aussi » avec le **% de chance** d'apparition en ouvrant le conteneur Ultra Rare du lieu (calculé depuis les tables de loot dataminées, tirages indépendants + tirage pondéré imbriqués — voir `tools/build_loot_locations_from_datamine.js`). 189 objets couverts. Les conteneurs génériques (Rare/Basic/UltraRare « ordinaires », trouvables n'importe où) utilisent un système de filtrage par tags bien plus complexe — **volontairement non traité** (résultat fiable sur les lieux nommés plutôt qu'approximatif partout).
- **Source des données = HYBRIDE gaming.tools (snapshot) + datamine FModel**, de plus en plus dataminée au fil des sessions (armes / armures / augments / utilitaires, ~691 items). Format liste « flatted » `.d.json` (même que `dd_proxy.php`).
  - ⚠ **Cloudflare bloque l'IP datacenter du serveur** sur gaming.tools (403 « Just a moment… », challenge JS) — un curl serveur ne peut pas le résoudre. **Le proxy live n'est donc pas fiable en prod** (ça affecte aussi `dd_proxy.php` / la carte Deep Desert) : en pratique `stuff_proxy.php` sert **toujours le snapshot**, jamais le live. On génère donc les données depuis une **machine non bloquée** (IP résidentielle) et on déploie les fichiers statiques (`stuff_data.json`, `stuff_recipes.json`, `stuff_skills.json`, `stuff_augments.json`).
  - **Toujours gaming.tools (scrapé, pas live)** : liste d'items (noms, icônes, tier/rareté), stats brutes d'**armes** (DPS, dégâts, cadence…) — `DT_ItemTableWeapons.json`/`DT_MeleeWeaponItemTable.json` ne contiennent que des références vers des **Blueprints** (`HandheldRef`), pas les chiffres réels ; impraticable à dataminer sans exporter les Blueprints (non tenté). Capacités/techniques (`skills.d.json` → `stuff_skills.json`, 113 entrées).
  - **Datamine FModel, remplace gaming.tools** :
    - **Recettes** : `tools/build_recipes_from_datamine.js` ← `Systems/Crafting/DT_ItemsCraftingRecipes` (usmap Dumper-7 + `mapstructtypes.json`) → `stuff_recipes.json` (1440 recettes, ~98 % couverture).
    - **Descriptions FR** : `tools/build_descriptions_from_datamine.js` ← `CDT_BaseItems.json` (4154 items, FModel en Français, champ `LongDesc`) → injecte `desc` dans `stuff_data.json`.
    - **Augments** (effets chiffrés + rolls) : `tools/build_augments_from_datamine.js` ← `Systems/Items/Upgrades/DA_AUGMENT_*` → `stuff_augments.json` (104/104 augments).
    - **Armures** (`ArmorValue` + 8 mitigations) : `tools/build_armor_stats_from_datamine.js` ← `Systems/Items/DT_ArmorItemTable.json` (560 items, stats en clair — contrairement aux armes) → écrase les valeurs gaming.tools dans `stuff_data.json` (271/271 garments appariés, valeurs déjà identiques lors du premier passage 2026-07-03, confirme la fiabilité du scrape gaming.tools historique). Ce fichier a **plus de types de mitigation** que gaming.tools/l'outil (Froid, Coriolis, Explosifs, Récolte, Réparation, Tempête de sable ×3, Soins) — **non exposés** (choix : garder les 8 types existants, ne pas complexifier). ⚠ Piège découvert : le stat brut `PhysicalDamageMitigationArmor` EST la mitigation « Commotion » de gaming.tools (`concussiveMitigation`), pas un bonus généraliste distinct.
    - **Courbes de grade** (`Q_DAMAGE`/`Q_SHIELD`/`Q_ARMOR` dans `optimiseur.html`) ← courbes `CF_*PerQuality` (Funcom), globales.
    - Pont d'ID commun à tous les scripts : clé de ligne FModel (EItemTemplateID) `.toLowerCase()` = id gaming.tools.
  - `stuff_proxy.php` reste **hybride** côté code (tente le live, retombe sur le snapshot) même si le live n'aboutit jamais en prod ; il copie le snapshot en cache 24 h. Endpoint `?id=xxx` = recette (live → repli `stuff_recipes.json`). `?skills=1` = capacités/techniques. `?debug=1` = diagnostic.
  - **Langue FR** : gaming.tools sert les données traduites via la locale d'URL (`/dune/data/fr/…`) ; `STUFF_LOCALE`/`LOCALE` = **`fr`**. Les `id` et slugs de catégorie restent en anglais (identifiants internes).
  - **Régénération — liste + capacités** : `node tools/build_stuff_snapshot.js` (fetch FR, 1 requête chacun). ⚠ **IP partagée** : le terminal local (Node) tourne sur l'IP de la machine ; des requêtes trop rapprochées (ou plusieurs `node.exe` en parallèle) font flaguer Cloudflare quelques minutes. Tuer les zombies : `taskkill /F /IM node.exe`.
  - Icônes servies directement depuis le CDN gaming.tools (`cdn-hosted.gaming.tools/dune/images…`) — chargeables en `<img>` sans blocage (pas de hotlink-protection).
- **Limite connue** : les emplacements de loot ne sont couverts que pour les **lieux nommés** (voir ci-dessus) — pas de coordonnées GPS précises, et les conteneurs génériques (grottes/épaves quelconques) restent non couverts (système de tags trop complexe).
- **À déployer (WinSCP)** : `optimiseur.html`, `stuff_proxy.php`, `stuff_data.json`, `stuff_recipes.json`, `stuff_skills.json`, `stuff_augments.json` (effets d'augments dataminés), `stuff_loot.json` (emplacements de loot dataminés), `pages.js` (tuile « Optimiseur de Stuff »), `optimiseur.jpg` (vignette — fallback auto vers `intro.jpg` si absente). Le proxy crée `stuff_cache_list.json` + `stuff_cache_skills.json` + `stuff_cache/` (runtime, gitignorés) → PHP doit pouvoir y écrire.
- **Après un patch du jeu — orchestrateur `tools/update_datamine.js`** (2026-07-11) : ré-exporte d'abord les DataTables via FModel (voir chemins ci-dessus), puis lance `node tools/update_datamine.js --check` (aucune écriture, vérifie juste que les exports FModel attendus existent et leur date) et `node tools/update_datamine.js` (régénère dans le bon ordre `stuff_recipes.json` / `stuff_data.json` (desc + armure) / `stuff_augments.json` / `stuff_loot.json` / `planner_pieces.json`, puis affiche un résumé des compteurs avant/après vs le dernier commit — ne commite ni ne déploie rien). `--with-snapshot` ajoute l'étape réseau gaming.tools (liste d'objets, lente/throttlée, seulement utile si le patch a ajouté de **nouveaux** objets). `--run-planner-import` lance aussi le script **externe** (hors dépôt) `J:/Download/Fmodel/import_building_data.js` qui régénère `base_pieces_v3.json` et resynchronise le résultat dans le dépôt courant (ce script écrit toujours vers la racine du dépôt principal par défaut). **Angle mort connu** : `dune_pieces_sockets.json` / `dune_socket_profiles.json` / `dune_group_config.json` (sockets/meshes du planner) n'ont **aucun script de régénération retrouvé** — `--check` le rappelle à chaque lancement.

#### Roadmap Optimiseur (synthèse reviews ChatGPT + Gemini — passer de calculateur à *assistant*)
Principes : **déterministe** (pas de LLM dans l'optimiseur), **pas de score global unique** (profil par axe à la place), **échelles calibrées** (sinon barres/heatmap incohérentes), contributions à la **vraie formule** (DPS multiplicatif).
- **Phase 0 — fondation** : **augments numériques** — ✅ **fait (v1 + v2)**. Effets **dataminés** (`tools/build_augments_from_datamine.js` → `stuff_augments.json`, 104/104 augments) depuis les DataAssets `AugmentStatsPerQualityDataAsset` (`Systems/Items/Upgrades/`). Chaque effet a une **fourchette [min,max] par qualité** (le craft tire un nombre dedans : `Multiply`=facteur, `Add`=delta). UI : sous chaque slot augment, **sélecteur de qualité** (0→5) + **un curseur de roll par effet** (slider + **champ % éditable**, synchronisés, défaut max ; mise à jour visuelle en direct pendant le drag, recalcul complet au relâchement pour ne pas casser le slider). **Câblage moteur** : les augments de **dégâts compatibles** (selon les tags `ApplicableItems` ↔ type d'arme) sont **repliés dans le DPS** de l'arme concernée (×Damage/×Cadence ; ex. +48 à +70 % au Q5) et le TTK ; badge violet « aug +X% ». **v2 (agrégation armure)** : les **mitigations** (Add) sont **additionnées** aux totaux (flat, indépendant de la pièce) ; le **bonus d'armure** (%, Multiply) est appliqué à la **pièce choisie** par l'utilisateur (sélecteur dans le détail de l'augment, auto-sélection si une seule pièce compatible équipée — jamais deviné, pour ne pas gonfler le total en l'appliquant aux 5 pièces). RESTE : effets hors-DPS (recul/précision/recharge/munitions…) une fois ces métriques modélisées (Phase 2).
- **Phase 1 — lisibilité** : ① **comparateur instantané** dans le picker (Δ vert/rouge vs équipé, sans équiper) — ✅ **fait** (métrique « comme équipé » à grade max + Δ par candidat, armes & armures) ; ② couleurs sémantiques + meilleure valeur mise en avant — ✅ **fait** (échelle calibrée + heatmap dans le picker, badge « ★ Meilleur », repère ★/▲ par slot du loadout) ; ③ filtres picker (tier/rareté/sous-type) — ✅ **fait** (3 menus peuplés dynamiquement selon le slot, sous-types en FR, cumulables, masqués pour le picker de capacités). **→ Phase 1 complète.**
- **Phase 2 — analyse** : ④ **EHP / survie par type de dégâts** — ✅ **fait**. PV max = PV de base (éditable, communautaire) + bonus **Vitalité** (skill dataminé) ; bloc « PV effectifs par type de dégâts » = PV max / ((1−réduc. armure)×(1−mitigation du type)), 8 valeurs (profil par type, pas de score unique), barre heatmap calibrée sur le max des 8. ⑤ **profil par axe** (DPS / survie / résistances / mobilité) + mode objectif (PvP/PvE/Tank/DPS) ; ⑥ **arbre des contributions** par stat — restent à faire.
- **Phase 3 — assistant** : ⑦ suggestions déterministes (caps gaspillés, meilleur swap) ; ⑧ Δ par grade ; ⑨ coût total du build (somme recettes + regroupement ressources).
- **Hors roadmap numérotée (retours joueur 2026-07-03)** : **résistances de la cible par type de dégâts** dans la barre d'options (voir *Barre d'options* ci-dessus) — répond au besoin « combattant avec réduction aiguilles, etc. » pour un TTK réaliste en PvP.

---

### Retours de Soirée — Épice (`epice/debrief.html`)
Outil de **préparation, débrief et analyse** des sorties de récolte d'épice en zone PvP (doctrine 100 % aérienne, « personne au sol »). Quatre onglets : **Organisation**, **Manuel de combat**, **Retour joueur**, **Admin**.

- **Organisation** (tout membre connecté) : menu déroulant des raids (page vide par défaut, auto-affichage du raid en préparation s'il existe) → composition en **lecture seule**. Distingue **« sur le terrain »** (rôles + placement) et **« groupes en jeu »** (groupes de **max 4** = ce que chacun voit sur la carte). Boussole cardinale pour la Défense, badges CS/CDR/CP. Un raid clôturé n'apparaît plus comme actif mais reste consultable.
- **Manuel de combat** : briefing de guilde basé sur le script lu par le CS avant chaque sortie (doctrine récolte, checklist matériel, chaîne de commandement, callouts, scénarios JAUNE/ORANGE/ROUGE, protocole d'urgence). Bloc **« Ce soir »** en tête de page : CS/CDR/CP et consignes particulières affichés **en direct** depuis la compo de la sortie active (remplis dans Admin → Assignation, pas de double saisie). **Page éditable directement** (organisateurs) : bouton « ✎ Modifier cette page » → texte modifiable en place (`contenteditable`), « 💾 Enregistrer » (persisté serveur, visible de tous) / « ✕ Annuler » / « ↺ Réinitialiser » (revient au contenu par défaut livré dans le code).
- **Retour joueur** : le joueur **choisit son pseudo** dans la liste des participants, note la soirée (cristaux + 4 axes) et coche points positifs / points noirs. **Un seul retour par pseudo, modifiable tant que la soirée n'est pas clôturée.**
- **Admin (organisateurs)** : composition d'équipes (commandement + **briefing du soir** en texte libre, récolte, défense cardinale, groupe à distance non plafonné, **groupes en jeu** pré-remplissables), cycle de vie de la sortie (créer / clôturer / supprimer / réinitialiser la compo), synthèse des retours (moyennes par axe, points forts/faibles) et **analyse IA** (proxy `api-gemini.php` → Gemini) au format structuré, **sauvegardée et consultable** dans l'historique.
- **Rôle Défenseur CAC retiré** (plus rentable de mettre un CAC dans le transporteur) et **Formation Faucon désactivée** (mécanique de montage à deux sur un orni retirée du jeu, liée à un exploit qui pourrait revenir — code gardé derrière `FAUCON_MODE_ENABLED = false` dans `debrief.html`, y compris côté bot Discord `discord_sortie.php` où le poste reste listé pour l'affichage mais n'est plus proposé à l'inscription). Les anciens raids qui portaient ces rôles restent lisibles tels quels dans Organisation / Historique.
- **Rôle Pilote Ornithoptère + CaC** (patrouille uniquement) : option supplémentaire à côté de « Patrouilleur » dans le select Retour joueur, toggle « ⚔ CaC » par pilote dans le builder d'assignation (Groupe à distance), affiché en lecture seule dans Organisation/Historique. Coexiste avec « Patrouilleur » (ne le remplace pas). Poste équivalent ajouté au menu d'inscription du bot Discord (`discord_sortie.php`, `pilote_orni_cac`).
- **CaC en Défense Rapprochée** (2026-07) : chaque cardinal (Nord/Sud/Est/Ouest) a aussi un bouton `⚔ CaC` identique à celui de la patrouille — même bascule « Pilote Ornithoptère + CaC ». Affiché dans le builder ET la vue Organisation (badge ⚔ sur la boussole).
- **Seconde escouade de Défense Rapprochée** (2026-07) : le modèle `defense` passe d'un objet fixe à 4 cardinaux à un **tableau d'escouades** de 4. Bouton **« + Ajouter une escouade Défense Rapprochée »** désactivé (avec infobulle) tant qu'il n'y a pas 2 groupes Récolte — actif dès qu'une 2e récolte est présente, c'est ce qui justifie une 2e vague de défenseurs. Chaque escouade a sa propre boussole dans Organisation, est retirable indépendamment, et alimente un groupe distinct dans « Groupes en jeu ». **Rétrocompat** : les anciennes sorties (`defense` en objet unique, sans `cac`) sont migrées automatiquement à la lecture, côté JS (`normalizeCompo`) comme côté PHP (`roster_from_assign`). La condition « formation minimale réunie » ne regarde que la 1re escouade — la 2e reste optionnelle.
- **Multi-sorties en parallèle** : plusieurs sorties peuvent être **ouvertes en même temps** (la création n'archive plus les autres). L'onglet **Assignation** a un **sélecteur de sortie** (`open_sorties`) : l'**admin** voit/assigne **toutes** les sorties ouvertes, un **organisateur** uniquement **les siennes**. `list` / `save_assign` / `close_soiree` ciblent une sortie par `sid` (vérif ouverture + créateur côté serveur). Clôture **par sortie** (bouton « Clôturer cette sortie » dans l'Assignation ; le bouton d'en-tête clôture la sortie « vedette » = `soiree_active`). **Réouverture** (`reopen_sortie`) : bouton **« ↻ Rouvrir »** sur une sortie archivée de l'Historique → elle redevient *ouverte* et *vedette* (assignation + retours de nouveau possibles), admin = toutes, organisateur = les siennes — évite toute édition manuelle de `debriefs.json`. Le **Retour joueur** reste sur la sortie vedette (la plus récente non clôturée).
- **Rôles** (auth serveur par session — voir *Authentification*) : *consultation* = membre connecté ; *organiser* = **admin OU organisateur** (pseudo listé dans `epice/data/organizers.json`, géré par les admins via le sous-onglet « Organisateurs » — **sélecteur de comptes connus**, plus de saisie libre) ; un organisateur ne peut **assigner / clôturer / supprimer** que **ses propres** sorties.
- Stockage JSON (`epice/data/debriefs.json`) ; clé Gemini hors Git (`epice/config.php`) ; protection compo : édition possible uniquement si une soirée est ouverte.

#### Bot Sorties Discord (`epice/discord_sortie.php`)
Créer une sortie épice **directement depuis Discord** et gérer les inscriptions par poste, synchronisées avec l'outil ci-dessus (même `debriefs.json`).
- **Architecture** : endpoint HTTP d'**interactions Discord** en pur PHP (aucun démon/bot permanent). Discord POST sur `epice/discord_sortie.php`, signature **Ed25519 vérifiée** (`sodium`) à chaque requête. Le bot apparaît « hors ligne » dans Discord, c'est normal (pas de connexion gateway).
- **Types de sortie** : la commande `/sortie creer` propose un **type** (menu natif) : **Épice** (la seule liée au site), **Labos-Donjons**, **Farm divers**, **Landsraad**, **Entraînement PvP**, **Chasse PvP**, **Construction Base Guilde DD**, **Activité Guilde** (générique). Épice utilise l'inscription **par poste** ; les autres types un **RSVP simple** (Présent / Peut-être / Absent) pour jauger l'intérêt.
- **Flux** : `/sortie creer` → choix du type → formulaire (titre, date & heure, zone, **durée en heures**, description) → encart doré (bannière par type). Inscription épice via **menu déroulant de postes** (Moissonneur, Transporteur, Pilote Ornithoptère, Pilote Ornithoptère + CaC, Présent — Défenseur CaC **retiré du menu 2026-07**, plus rentable de placer un CaC dans le transporteur ; la colonne du même nom n'apparaît plus dans l'encart si personne n'est dessus, mais reste visible sur les anciennes sorties qui portaient ce rôle) + boutons **❓ Peut-être / ✖️ Absent / Me désinscrire / 🎖️ Chef de section**. Le roster se met à jour en direct (`UPDATE_MESSAGE`). Le compteur `X inscrits` ne compte que les présents ; la durée s'affiche dans l'encart (`⏱️`).
- **Chef de section** (2026-07) : bouton bascule 🎖️ ajouté à la ligne d'actions — un membre déjà inscrit à un poste candidate pour être Chef de section (drapeau `chef_section` indépendant du poste, ne le remplace pas). Reclic = retire la candidature. Un membre non encore inscrit reçoit un message éphémère lui demandant de choisir un poste d'abord. Les candidats apparaissent avec un badge 🎖️ à côté de leur nom dans leur colonne de poste, avec rappel discret en footer (« 🎖️ = candidat Chef de section »). Discord n'ayant pas de vraie case à cocher dans un message, un bouton toggle sert exactement le même usage.
- **Gestion** : boutons **✏️ Modifier** (rouvre le formulaire pré-rempli → met à jour l'encart) et **🗑️ Supprimer**, **réservés au créateur ET au staff** (Administrateur / Gérer le serveur / Gérer les messages / Expulser / Bannir / Modérer les membres). Les boutons sont visibles par tous (Discord ne sait pas masquer par utilisateur) mais un membre sans droit reçoit un refus privé. **Suppression différenciée** : pour une sortie **épice** (liée au site), 🗑️ retire **uniquement le post Discord** et **conserve les données du raid** (retours, compo, analyse, historique) — la suppression réelle se fait depuis le site ; pour les **autres types** (store Discord séparé), la fiche est supprimée entièrement.
- **Notification MP en cas de changement de date/heure** : si une modification change la **date et/ou l'heure**, le bot prévient **par message privé** tous les inscrits, avec un texte **différencié selon le statut** (présent / peut-être / absent). L'**auteur** de la modif n'est pas notifié (admins/modos peuvent aussi éditer). Les MP partent **en arrière-plan** (`fastcgi_finish_request` après la réponse Discord, pour rester sous la limite de 3 s) via l'API REST du bot (`POST /users/@me/channels` puis message) ; un échec (MP fermés, blocage) est silencieux et journalisé. Aucun re-`register` nécessaire (changement de comportement, pas de structure).
- **Suppression automatique du post** (`discord_sortie_cleanup.php`, **cron**) : pour désencombrer le canal, le message d'une sortie est supprimé **4h après la fin** (`fin = date+heure + durée` ; durée absente → 4h présumées), **pour tous les types y compris épice** (le nettoyage ne retire que le post, jamais les données — voir ci-dessus). Le bot stocke le `message_id` de l'encart (récupéré à la création via `…/@original`, et au 1er clic d'inscription pour les sorties existantes). Script **CLI uniquement** (`--dry` pour simuler), lancé par cron toutes les ~15 min. Une sortie sans heure exploitable n'est jamais auto-supprimée. Idempotent (flag `discord.cleaned`).
- **Données** : une sortie **épice** est ajoutée à `debriefs.json` (`source='discord'`, `type='epice'`, `signups[]` = `{id,name,poste,statut,ts}`) et devient la soirée active. Les **autres types** vont dans `epice/data/discord_sorties.json` (store séparé, gitignoré) et **ne touchent pas** au débrief. Côté `debrief.html`, l'Assignation propose les inscrits Discord via un **menu déroulant maison** (aux couleurs du site, filtrage à la frappe + navigation clavier) sur tous les champs de rôle ; un joueur **déjà placé n'est plus proposé ailleurs** (anti-doublon) ; saisie manuelle toujours possible. Les inscrits **« ❓ Peut-être »** sont affichés **en orange + badge** (pour ne pas les affecter comme s'ils étaient sûrs) ; les **« absents »** ne sont pas proposés. L'interface `debrief.html` est habillée façon **Dune Awakening** (cadres à équerres dorées, en-tête orné + devise, séparateurs en losange, titres Cinzel, champs à accent doré).
- **Config** : `epice/discord_sortie_config.php` (**gitignoré** — `bot_token` secret ; `app_id`/`public_key` publics ; `guild_id` optionnel). Gabarit = `discord_sortie_config.example.php`.
- **Mise en place** : `discord_register.php` (déclare la commande `/sortie`, à lancer à chaque changement de commande — gardé sur le serveur volontairement, pratique en cas de future modification). `discord_probe.php` (sonde de diagnostic ponctuelle) a été retiré du serveur après usage. Nécessite **HTTPS** sur le domaine (Let's Encrypt) car Discord refuse les URL `http`. URL d'interactions à déclarer dans le portail Discord (General Information → Interactions Endpoint URL).

---

### Hub Jeux (`jeux/hub.html`)
Mini-jeux de guilde entre membres, avec records et classements. Tuile dédiée dans le menu.
- **5 mini-jeux** : Orni Flap, Sandstorm Memory, Spice Runner, Worm Rider, Muad'Dib Rescue.
- **Scores** : sauvegarde automatique par joueur (`jeux/scores_api.php`), un score soumis alimente **deux classements en parallèle** : `jeux/data/scores.json` (**Hall of Fame**, all-time, jamais remis à zéro) et `jeux/data/scores_weekly.json` (**classement hebdomadaire**, semaine en cours). Anti-triche (hash + cooldown) tranché **une seule fois** sur le store all-time, pour ne pas pouvoir contourner le cooldown juste après un reset hebdo.
- **Remise à zéro hebdomadaire** (2026-07-14) : `jeux/weekly_reset.php`, lancé par CRON **chaque mardi 05:00 UTC** (= 7h Paris été, 6h Paris hiver — le serveur tourne en UTC et on n'y touche pas, les resets carte/DD sont calés dessus ; le hub affiche « à l'aube » plutôt qu'une heure fixe pour ne pas se contredire avec la tempête in-game). Sous prétexte lore qu'**une tempête de Coriolis vient de balayer Arrakis**, calcule le champion de la semaine par jeu, poste l'annonce dans Discord (webhook `jeux/data/discord_webhook.txt`, même fichier que les records) avec **deux blocs séparés** (`fields` Discord) : « 🏆 Champions de la semaine » (frais, remis à zéro) et « 🏛️ Hall of Fame — le score à détrôner » (repère all-time, lecture seule de `scores.json`, jamais modifié par ce script — donne un objectif à viser plutôt qu'un classement froid). Archive l'état sortant dans `jeux/data/weekly_archive/<année>-W<semaine>.json` (jamais écrasé), puis vide `scores_weekly.json`. `--dry` pour tester sans rien écrire/poster. **Contrôle avant vol** (ajouté après la panne silencieuse du 21/07/2026) : refuse de poster l'annonce si le fichier n'est pas inscriptible, cf. droits ci-dessous.
- **Notif Discord « meneur de la semaine »** (2026-07-14) : en plus du message all-time existant (record battu → embed doré), un **second message distinct** (embed bleu Discord, `notify_discord_weekly_record` dans `scores_api.php`) se déclenche quand un score dépasse le **meneur hebdomadaire** en cours — sans ça, personne ne sait qu'un défi de la semaine est en jeu et personne ne le relève (principe d'interaction demandé). Ne se déclenche que si aucune notif podium (rank 1/2/3 all-time) ne part pour la même soumission (pas de double post).
- **Hub** (`hub.html`) : panneau classement avec bascule **🗓️ Cette semaine** (défaut) / **🏆 Hall of Fame**, note explicative avec compte à rebours avant le prochain reset (calculé en UTC → juste toute l'année). Les badges « record » sur les cartes de jeux restent **toujours all-time** (valeur de prestige stable). Le mini-classement **dans chaque jeu** (`orni_flap.html` etc., panneau « 🗓️ Cette semaine ») est lui aussi passé en **hebdomadaire** (`scope=weekly`) — sinon un nouveau joueur ne s'y voit jamais, écrasé par les scores historiques.
- **Refonte graphique 2026-07** (Codex) : 4 des 5 jeux (Orni Flap, Spice Runner, Worm Rider, Muad'Dib Rescue) ont un habillage sprite premium à la place du dessin procédural (`jeux/img/*.png`, ~900 Ko commités dans le repo). Toujours **fallback procédural intégré** si un sprite n'est pas chargé : le jeu reste jouable même avec une image manquante côté serveur. Sandstorm Memory reste en dessin canvas.
- **Worm Rider** (2026-07) : refonte physique (chaîne trail-based, rotation par tangente, tête sprite découpée en 4 tranches articulées, stretch dynamique pour éviter les gaps en piqué/montée), et **économie de score revue** : la récolte d'épice passe de flat +5 à **multiplicateur × 1.05/unité** (×2.75 max) sur le score de distance — ramasser reste rentable, ne rien ramasser aussi (choix stratégique plutôt qu'EV négatif). Le combo close-call reste inchangé (+8 par frôlement, ×5 max, fenêtre ~1.67 s).
- Chaque jeu est une page HTML autonome (`jeux/<jeu>.html`) protégée par `../auth-guard.js`.

---

### Mon Compte (`account.html`)
- **Widget compte joueur** présent dans toutes les pages : cercle avatar + pseudo, clic → page compte
- Avatar personnalisable : grille de presets + upload personnel (redimensionné 200×200 px côté serveur via PHP GD, crop centré automatique)
- Les avatars uploadés sont privés : chaque joueur ne voit que les siens dans le sélecteur
- Changement de mot de passe : affiché uniquement pour un compte **sans** lien Discord (comptes liés OAuth : rien à faire, ce champ est masqué)
- **Stats** : bases placées, destinations signalées, rang
- **Historique commandes** : tuiles dépliantes « Commandes passées » (avec statut : en attente / en cours / terminé) et « Services rendus » (demandes fulfillées par le joueur)
- **Gestion des utilisateurs (admin uniquement)** : liste de tous les comptes, boutons Promouvoir/Rétrograder et Supprimer (`save.php`, actions `updateRole`/`deleteUser`, validation admin **côté serveur** via la session PHP réelle). Le responsable du site et le chef de guilde n'ont pas ces boutons (protégés, voir plus bas). Remplace l'ancien panneau « Gérer Utilisateurs » de la carte (retiré).
- **Vérification Discord à la demande** : bouton « 🔄 Vérifier Discord » dans l'en-tête de la Gestion des utilisateurs — **déclenchement manuel uniquement** (rien au chargement de la page, trop lent/sensible au rate-limit Discord pour tourner automatiquement). Interroge l'API Discord pour tous les comptes liés (`save.php` action `checkDiscordMembership` → `discord_oauth.php` `dco_guild_members_check()`, lots de 4 en parallèle avec retry sur 429/Retry-After). Les comptes confirmés absents de la guilde affichent un badge rouge « ⚠ Hors Discord » ; un compte jamais vérifié ou en erreur transitoire n'a pas de badge (pas de faux positif).
- **Gestion des pages (admin uniquement)** : section listant toutes les tuiles du registre `pages.js`, chacune réglable sur *Active* / *Pas active* / *En travaux*. L'état est stocké dans `settings.json` (`pages.<clé>`) via `save.php` (action `updatePage`, validation admin côté serveur). Chaque page applique son état à l'accès direct par URL grâce à `page-guard.js` (les joueurs sont bloqués sur une page *pas active* ou *en travaux*, les admins jamais)
- **Accès nominatif par page** : bouton « 👤 Accès » sur chaque ligne de la gestion des pages → menu déroulant à cases à cocher pour donner l'accès à une page *pas active*/*en travaux* à un ou plusieurs joueurs précis, sans changer son statut global (la tuile reste invisible dans le menu, seul le lien direct fonctionne pour eux). Stocké dans `settings.json` (`pages_access.<clé>`), action `save.php` `updatePageAccess`. Les joueurs **nouvellement** cochés reçoivent automatiquement un **MP Discord** avec le lien de la page (bot, réutilise le `bot_token` de la connexion Discord).

---

## Authentification et Rôles

### Connexion via Discord (OAuth2) — méthode principale

L'accès au portail se fait en **« Se connecter avec Discord »** : pas de mot de passe à gérer, et l'accès est **réservé aux membres de la guilde** (sortie de la guilde = accès perdu). On réutilise l'application Discord du bot *Sorties* (`epice/`).

- **Flux** (`discord_login.php` → `discord_callback.php`, lib partagée `discord_oauth.php`) : redirection vers Discord (scope `identify`, `state` anti-CSRF, `prompt=none` pour ne montrer l'écran d'autorisation qu'**une fois** par membre) → retour → vérification de l'appartenance à la guilde **via le bot** (`GET /guilds/{id}/members/{uid}`) → session PHP + `localStorage`.
- **Filtrage par rôle Discord** (`access_role_ids`) : seuls les porteurs des rôles autorisés (ex. *Dune*, *Dune Pause*) entrent ; les invités / membres d'un autre jeu sont refusés.
- **Admin dérivé d'un rôle Discord** (`admin_role_ids`, ex. *Admins* / *Modos*) : recalculé à chaque connexion. `Abarrach` reste admin en dur. Un rôle admin donne aussi l'accès. **Override manuel persistant** : un joueur promu admin depuis Mon Compte (« Gestion des utilisateurs ») reste admin même sans le rôle Discord requis — ce rôle stocké dans `users_SECURE_9x.json` est désormais consulté par `dco_compute_role()` en plus du rôle Discord (avant ce fix, la revérification périodique l'écrasait silencieusement).
- **Enforcement continu** (`session_check.php`, appelé par `auth-guard.js`) : à chaque navigation, si la dernière vérif date de plus de `recheck_seconds` (~15 min), le serveur revérifie l'appartenance + le rôle. **Quitter la guilde ou perdre le rôle = session détruite immédiatement**, même session ouverte. C'est aussi une vraie protection **serveur** (le `localStorage` seul était falsifiable).
- **Mapping pseudo** (`import_discord_map.php`, outil admin) : un CSV `id_discord ; pseudo_site` pré-lie chaque ID Discord à un compte existant (champ `discord_id` dans `users_SECURE_9x.json`) → chacun se connecte avec Discord **sans perdre ses données** (bases, avatar, demandes…). Un membre absent du CSV se voit créer un compte neuf à sa 1re connexion.
- **Config** : `discord_oauth_config.php` (**gitignoré** : `client_secret` + `bot_token`) ; gabarit = `discord_oauth_config.example.php`. Nécessite **HTTPS** + la Redirect URI déclarée dans le portail Discord.

### Accès par mot de passe (page cachée, repli)

- `sietch-tabr.html` (non liée depuis l'accueil, nom volontairement discret) reste fonctionnelle via `auth.php` : comptes à mot de passe dans `users_SECURE_9x.json` (sessions sans `discord_id`, non revérifiées par Discord). Sert notamment à l'amorçage admin (`Abarrach`) avant l'import du mapping.
- **Pas d'auto-inscription** : la création de compte mot de passe (`register.html`, action `save.php` `addUser`) a été retirée. Un compte mot de passe se crée désormais **manuellement**, en ajoutant l'entrée dans `users_SECURE_9x.json`.

### Communs

- Deux niveaux d'accès : **Joueur** et **Administrateur**.
- **Comptes protégés** (ni rétrogradables ni supprimables par un autre admin, vérifié côté serveur dans `save.php`) : `Abarrach` (responsable technique du site, protégé par pseudo) et le **chef de guilde** (protégé par `discord_id`, pas par pseudo — immunise contre une faute de frappe ou un renommage).
- **Toutes les pages** sont protégées par `auth-guard.js` (garde client instantané + validation serveur via `session_check.php`).
- **Auth serveur (épice)** : les endpoints de *Retours de Soirée* vérifient la session PHP **côté serveur** (`epice/auth_epice.php`). Rôle **organisateur** = admin OU pseudo dans `epice/data/organizers.json`.
- La déconnexion efface la session `localStorage` et redirige vers la page de connexion (ne révoque pas l'autorisation Discord).

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
├── base_planner.html     # Constructeur de Base 3D (Three.js, moteur sockets v2) — LIVRÉ en prod
│
├── script.js             # Logique cartographique (Leaflet, marqueurs, Désert Profond)
├── skills.js             # Simulateur de talents + commandes de craft
├── planner.js            # Planificateur d'événements
├── migration.js          # Logique de migration (validation, refus, Discord)
├── base_planner.js       # Logique 3D du Constructeur de Base (Three.js, moteur sockets, ~6150 lignes)
├── auth-guard.js         # Protection des pages (garde client + validation serveur session_check.php)
├── pages.js              # Registre central des tuiles du menu (clé, lien, image, icône, titre) — source unique
├── page-guard.js         # Garde d'accès par page (bloque hidden/wip pour les joueurs ; admin = accès total)
│
├── save.php              # API principale (bases, utilisateurs, craft, commandes)
├── auth.php              # Authentification par mot de passe (page cachée sietch-tabr.html)
├── discord_oauth.php     # Lib partagée OAuth2 Discord (config, API, mapping, session)
├── discord_login.php     # Départ « Se connecter avec Discord » (state CSRF, prompt=none)
├── discord_callback.php  # Retour Discord → vérif guilde/rôle → session → menu
├── session_check.php     # Revérif périodique d'appartenance (appelé par auth-guard.js)
├── import_discord_map.php # Outil admin : pré-charge le mapping CSV id_discord↔pseudo_site
├── discord_oauth_config.example.php # Gabarit OAuth — discord_oauth_config.php hors Git
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
│   ├── discord_sortie.php # Bot Sorties : endpoint interactions Discord (Ed25519)
│   ├── discord_register.php # Déclare la commande /sortie (à lancer une fois)
│   ├── discord_probe.php  # Sonde diagnostic (sodium/cURL/config) — à supprimer après
│   ├── discord_sortie_config.example.php # Gabarit (bot_token) — config hors Git
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
> **Purge des posts de sortie** (`discord_sortie_cleanup.php`) : ajouter un cron (utilisateur `dune`) — supprime le message Discord d'une sortie 4h après sa fin, tous types confondus y compris épice (données conservées). Tester d'abord avec `--dry`. **⚠ Jamais installé en prod à ce jour** (crontab vide, log absent — vérifié le 2026-07-04) : c'est la vraie raison pour laquelle rien ne s'est jamais auto-supprimé, le code lui-même n'a pas de bug de ce côté.
> ```
> */15 * * * * php /srv/dune-map/epice/discord_sortie_cleanup.php >> /home/dune/data/sortie_cleanup.log 2>&1
> ```

> [!IMPORTANT]
> **Reset hebdomadaire du Hub Jeux** (`jeux/weekly_reset.php`) : ajouter un cron (utilisateur `dune`) — chaque mardi **05:00 UTC** (= 7h à Paris l'été, 6h l'hiver : le serveur tourne en UTC et on n'y touche pas, les resets carte/DD sont calés dessus), vide `jeux/data/scores_weekly.json` et poste l'annonce Discord (tempête de Coriolis). Tester d'abord avec `--dry`.
> ```
> 0 5 * * 2 php /srv/dune-map/jeux/weekly_reset.php >> /home/dune/data/weekly_reset.log 2>&1
> ```
> **Droits obligatoires** — `scores.json` ET `scores_weekly.json` doivent être en `664 dune:www-data` : le site (`www-data`) écrit les scores, le cron (`dune`) remet à zéro. Un fichier créé par PHP arrive en `644 www-data` → le cron ne peut plus le vider, et l'annonce Discord part quand même (panne silencieuse du 21/07/2026). Depuis, le script refuse de poster s'il ne peut pas écrire. Correction :
> ```
> sudo chown dune:www-data jeux/data/scores_weekly.json && sudo chmod 664 jeux/data/scores_weekly.json
> sudo chmod g+s jeux/data     # les nouveaux fichiers héritent du groupe www-data
> ```

> [!IMPORTANT]
> **Connexion Discord** (`discord_oauth_config.php`, hors Git) : copier `discord_oauth_config.example.php` → `discord_oauth_config.php` et renseigner `client_secret` + `bot_token` (le même que le bot Sorties). Déclarer la **Redirect URI** dans le portail Discord (OAuth2 → Redirects) à l'identique de `redirect_uri` (ex. `https://havresgris.ddns.net/discord_callback.php`). Le fichier `users_SECURE_9x.json` doit être `dune:www-data` en `664` (PHP écrit le mapping ; WinSCP doit pouvoir l'éditer). Amorçage : se connecter en admin via `sietch-tabr.html` (mot de passe), puis lancer l'import du mapping via `import_discord_map.php` **avant** d'ouvrir l'accès aux membres (sinon comptes-doublons). Procédure complète et bascule `/v2/` → racine : voir `DEPLOY_DISCORD_AUTH.md`.

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
- Login : modale flottante avec glassmorphism (`backdrop-filter: blur`) et animation `floatIn` ; s'ouvre via URL hash `#login` (redirection `auth-guard.js` quand aucune session)
- Animations : fondu, lueur, vibration
- Design responsive adapté aux différentes tailles d'écran

---

## Licence

Voir le fichier [LICENSE](LICENSE).
