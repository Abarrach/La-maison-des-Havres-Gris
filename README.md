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
- Grille **2 rangées × 3 tuiles** (CSS Grid), responsive : 2 colonnes sur tablette, 1 sur mobile
- 6 destinations : Cartographie, Métiers, Missions, Migration, Chroniques, Œil du Mentat
- Widget compte joueur et déconnexion accessibles depuis le menu

### Carte Interactive
- Visualisation des deux zones de jeu : **Bassin de Hagga** et **Désert Profond**
- Placement de bases avec marqueurs typés (Guilde, Landsraad, Joueur, Ressource)
- Zoom et navigation sur des cartes haute résolution
- **Wipe hebdomadaire automatique** du Désert Profond chaque mardi à 5h00 (heure de Paris)
- Minuterie de tempête affichée en temps réel
- Panneau d'administration pour approuver, modifier ou supprimer des bases

#### Hagga — Gestion multi-sietchs
- Liste fixe de **20 sietchs** (serveur Galacia)
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

#### Désert Profond — Carte dynamique et champs d'épice
- **`dd_map_update.php`** recompose `deep_desert.jpg` chaque semaine en assemblant les 64 tuiles (8×8) téléchargées depuis le CDN de gaming.tools
- Le tileset tourne sur un cycle de 12 semaines basé sur un seed hebdomadaire (seed de référence = 12 au 13 mai 2026)
- **`dd_proxy.php`** interroge l'API acteurs de gaming.tools (seed=0 = semaine courante) pour récupérer les positions des champs d'épice en temps réel
- Les marqueurs de champs d'épice sont projetés sur la carte via `gameToLeaflet()` (coordonnées monde gaming.tools → pixels Leaflet)
- Chaque tooltip de champ indique la **cellule de la grille** (ex. F5) pour faciliter la localisation
- La carte est versionnée côté client (`?v=<seed>`) pour invalider le cache navigateur automatiquement à chaque rotation de tileset

### Simulateur de Talents
- Arbre de compétences interactif avec allocation de points
- Plusieurs filières de métiers (Combat, Artisanat, etc.)
- Simulez et testez vos combinaisons de talents avant de les appliquer en jeu

### Commandes & Services (`skills.html`)
- Formulaire de soumission avec description détaillée
- Ajout de jusqu'à 4 images par demande
- Suivi et gestion des requêtes côté administration
- **Message Discord automatique** après soumission : lien direct vers l'onglet Commandes (`?tab=requetes`), copie en un clic avec fermeture automatique
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
- **Disclaimer** : bandeau précisant que les données proviennent de Gaming Tools et couvrent uniquement les joueurs présents dans Hagga Basin (hors Deep Desert)
- KPIs : monde le plus peuplé, pic d'affluence, sietch dominant, **tendance** (évolution sur la fenêtre courante vs la même durée précédente, label dynamique)
- **Courbe de population mondiale** avec rangeslider et boutons de zoom (12h → Max)
- **Matrice d'activité** (heatmap heures de pointe par jour), **Top 15 Mondes** et **Top 15 Sietches** se mettent à jour automatiquement selon la fenêtre temporelle visible sur la courbe (rangeslider inclus)
- Filtre global : monde cible ; drill-down clic/Ctrl+Clic sur les barres
- **Sietch dominant** : calculé sur le serveur le plus peuplé de la fenêtre active (ou le serveur sélectionné), pour éviter une moyenne diluée par des mondes quasi-vides
- **Comparateur de Serveurs et Sietches** : ajoutez plusieurs mondes pour comparer leurs courbes ; tableau de synthèse avec pop. moyenne, pic, heure de pointe, tendance et sietch dominant par serveur — les stats et tendances se recalculent automatiquement selon la fenêtre de zoom du graphe de comparaison ; répartition par sietch dépliable avec tooltip d'évolution temporelle au survol
- **Chargement d'archive transparent** : les boutons de zoom > 1 mois (1m, 3m, 6m, 1y) déclenchent automatiquement le chargement de `dune_counts_archive.csv` si non encore chargé — fusion et déduplication en mémoire, sans action manuelle ; si les données archivées restent insuffisantes pour la période demandée, retour automatique à la vue Max

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

> [!WARNING]
> **Feature en cours de développement.** Sessions 0–5 livrées (pipeline + socle 3D + géométries + claim complet + multi-étages lisibles + UX avancée : undo/redo, rotation, click-to-place). Sessions 6–7 à venir (toits inclinés, placeables, sauvegarde PHP). Pas encore liée depuis `menu.html` (sera ajoutée en session 7).

Outil de planification 3D pour Dune Awakening. Permet aux membres de la guilde de poser virtuellement les pièces de construction du jeu sur une grille de claim avant de bâtir in-game.

#### Choix techniques fondateurs
- **3D abstraite avec Three.js r170** (via importmap ES module + OrbitControls). Pas de modèles in-game importés ; chaque pièce est représentée par une primitive (pavé, prisme triangulaire, rampe inclinée, marches…). Le rendu 3D est intentionnellement schématique pour rester lisible comme un blueprint.
- **Double caméra** : orthographique top-down (vue plan, équivalent 2D) ↔ perspective orbit (vue 3D inclinée). Bascule par bouton ou touche `V`. C'est le pari ergonomique central : le plan reste l'outil de travail, la 3D sert à vérifier que ça tient debout.
- **Modèle de données sémantique** : chaque pièce porte `placement_rules` indiquant `snap_target` (cell / edge / corner), `rotation_mode`, `footprint_shape`, `vertical_offset_pct`, `ignore_groups`. Le moteur de placement dispatche selon ces règles — pas de cas particuliers en dur.

#### Pipeline de données

La donnée est dérivée des exports **FModel** du jeu (extraction des .uasset Unreal Engine) :

```
J:\Download\Fmodel\...\DT_BuildingData_*.json         (1 par faction, 645 pièces au total)
J:\Download\Fmodel\...\DT_BuildableGroupData_Building.json   (92 groupes, règles de snap)
J:\Download\files2\base_pieces_data.json              (catalogue curé Claude — précédent)
                              ↓
                  tools/build_enriched_pieces.js      (script Node, ~250 lignes)
                              ↓
                  base_pieces_v2.json                 (1 MB, source unique du planner)
```

Le script `tools/build_enriched_pieces.js` joint les trois sources, **corrige le `group` autoritaire** depuis le DT (à l'audit : 0 correction nécessaire, le curé était fidèle), et ajoute `placement_rules` à chaque pièce. Idempotent : peut être rejoué après chaque ré-extraction FModel post-patch du jeu.

Stats à l'enrichissement : 645/645 matchées, 334 cellules / 302 arêtes / 9 coins, 583 carrés / 43 triangles isocèles / 19 triangles équilatéraux.

#### État au moment de la pause de cette branche

**Sessions livrées :**

| Session | Contenu |
|---|---|
| 0 | Pipeline d'enrichissement (`tools/build_enriched_pieces.js`), génération `base_pieces_v2.json` |
| 1 | Socle Three.js : scène, caméras ortho/perspective, grille de claim 10×10, drag & drop palette → canvas, sélection / suppression, rotation, raycaster, bascule ortho ↔ 3D, HUD coords/zoom |
| 2 | Géométries sémantiques (prismes triangulaires pour wedges/round-corners, rampes inclinées, escaliers en marches, panneaux verticaux fins pour murs), snap par catégorie (cellule/arête/coin), Y-base correct par catégorie (sol aligné sur top de fondation), hover indicator visuel, ghost rouge si conflit `ignore_groups` |
| 2.5 | **Correctifs placement vertical** : auto-stack murs (`findBestPlacementFloor` cherche le 1er étage libre), coexistence sol + toit dans `sameVerticalSpace`, fix `placeMeshAt` qui utilisait `state.currentFloor` au lieu de `item.z`. |
| 3 | **Système de claim complet** : boundary XZ + limites verticales strictes + gestion interactive des blocs (clic + / × avec validation BFS de connectivité) + pieux verticaux cliquables (5 pips) + onglets d'étage dynamiques [`getMinFloor()..getMaxFloor()`] + `ensureFloors()`. Règles : 1 bloc principal + 5 extensions horizontales max, shape libre, 5 pieux verticaux max (+7 niveaux / +5 sous-sol par pieu). |
| 4 | **Multi-étages lisibles** : opacité par étage (N-1 à 40%, N-2+ à 18%), contours discrets noirs (plus de doré envahissant), badge compteur sur chaque onglet (`updateFloorBadges`), HUD doré `↑ N2` quand l'auto-stack dépose sur un étage différent du courant (`showFloorResolveHud`), `userData.floorZ` sur chaque mesh. |
| 5 | **UX avancée** : (1) géométrie correcte stairs/ramps en planches indépendantes (creuses dessous, comme dans le jeu) ; (2) géométrie `Wall_Round_Corner` (quart de cylindre creux 8 segments) ; (3) sous-catégories sidebar avec en-têtes FR mappées (70+ groupes : Mur arrondi, Fondation triangulaire, Escaliers coin int., …) ; (4) **undo/redo** stack 50 ops (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z) couvrant place / remove / rotate via `pushHistory(undo, redo)` ; (5) **rotation intelligente** R key sur pièce sélectionnée ou ghost pendant drag/click-to-place, **Ctrl+molette** ±90° (zoom OrbitControls désactivé pour éviter le conflit) ; (6) **mode click-to-place** : clic dans la sidebar → la pièce devient active (highlight doré + 📍), survol canvas → ghost suit, clic canvas → pose, Escape/clic droit → annule, pose multiple sans re-cliquer la sidebar ; (7) **détection toits par label** : `isPieceRooflike()` couvre `category === 'roofs'`, `group === 'Rooftop'`, ainsi que les labels commençant par "Toit" ou contenant "Plafond" — résout le cas où "Toit plat" et "Plancher" partagent le même `group: Floor` dans le JSON. |
| 5.1 | **Correctifs visibilité** : (a) géométrie triangulaire (`makeTrianglePrismGeometry`) — fix de la rotation `rotateX(+π/2)` au lieu de `-π/2` qui mappait la profondeur en `-Z` et plaçait la base à `y=h` (les fondations triangulaires apparaissaient flottantes dans la cellule d'à côté) ; (b) plafond physique — un toit posé à Z occupe la même hauteur que le plancher de Z+1, donc visible **depuis Z comme plafond semi-transparent** (65%) et **depuis Z+1 comme plancher solide** ; (c) inversement, un plancher posé à Z+1 est aussi affiché comme plafond translucide quand on est sur Z ; (d) la surbrillance de la pièce active dans la sidebar persiste après une pose ou un drag accidentel (séparation propre dragstart/click). |

**Sessions à venir :**

| Session | Contenu prévu |
|---|---|
| 6 | Toits inclinés (géométries `Roof_Wedge`, `Roof_Corner`, `Roof_Cover`), **placeables** (469 objets) avec règles de contact depuis `DT_PlaceablePlacementGroups.json` — boîtes proportionnelles colorées par catégorie en attendant l'import des meshes FModel `.glb`, sélection multiple (Shift+clic), copier-coller un étage entier. |
| 7 | Sauvegarde PHP : `base_planner_api.php` (CRUD plans côté serveur), modale « Mes plans » fonctionnelle, système de partage avec `share_token` public (URL `?plan=abc123`), intégration de la tuile dans `menu.html`. |

#### Conventions techniques (à garder en tête pour la suite)
- 1 cellule = 1 unité monde Three.js (CELL = 1)
- Axe Y = vers le haut (convention Three.js par défaut)
- 1 mur plein = 1 unité de hauteur (`WALL_UNIT = 1`)
- 1 bloc de claim = 10×10 cellules (`BLOCK_CELLS = 10`)
- **Surface de marche au niveau Z** = `FOUNDATION_DEPTH + Z * WALL_UNIT` (= 0.5 + Z)
- **Fondation au niveau Z** : pavé épais, TOP à la surface du niveau, BOTTOM 0.5 unité en-dessous
- **Sol au niveau Z** : slab fin (15 cm), TOP à la surface du niveau (aligné avec une fondation adjacente — réponse au feedback utilisateur)
- **Toit au niveau Z** (catégorie `roofs` OU groupe `Rooftop` OU label "Toit*/Plafond*") : slab fin, TOP à la surface du niveau Z+1 — un toit à Z et un plancher à Z+1 occupent **exactement le même Y**, d'où la logique de visibilité décalée d'un étage dans `updateFloorVisibility`
- **Mur / pilier / escalier / porte** : posés sur la surface, montent de 1 unité (ou 0.5 pour les demis)
- Représentation des arêtes (`snap_target: 'edge'`) : `{ x, y, axis: 'h' | 'v' }` (forme canonique, pas de duplication entre cellules voisines)
- Représentation des coins (`snap_target: 'corner'`) : `{ x, y }` aux intersections de grille (entiers)
- **Classification verticale** (`vertClass(piece)`) → `floor` / `roof` / `stair` / `other` pour le calcul de conflits dans `sameVerticalSpace` ; permet aux toits/Rooftops de coexister avec sols/fondations au même cell+étage sans déclencher l'auto-stack
- **Historique undo/redo** : `state.history = [{undo, redo}]` + `state.histFront`, push à chaque place/remove/rotate, max 50 entrées (les plus anciennes sont jetées par `shift()`)
- **OrbitControls** : `enableZoom = false` — tout le zoom (ortho ET persp) passe par `zoomBy(factor)`, ce qui libère Ctrl+molette pour la rotation du ghost sans conflit

#### Fichiers de la feature

```
base_planner.html              # Layout + importmap Three.js + modales + CSS sidebar (~1700 lignes)
base_planner.js                # Logique 3D complète (~2100 lignes après session 5)
base_pieces_v2.json            # Catalogue enrichi (645 pièces, 1 MB)
base_planner_v1.bak.html       # Backup Konva (à supprimer après validation longue)
base_planner_v1.bak.js         # Backup Konva (idem)
tools/
  └── build_enriched_pieces.js # Script Node de génération du JSON v2 (idempotent)
```

#### Nouveaux fichiers FModel disponibles (récupérés post-session 2)

| Fichier | Utilité pour le planner |
|---|---|
| `DT_DuneBuildableUiSubcategory.json` | **Prioritaire session 3** — contient les sous-catégories UI exactes du jeu (Foundations, Walls, Triangle_Walls, Roofs, Ramps, Stairs, Decorative, Railings, Floors, Lighting, Furniture, Banners, Misc, Fabricators…). Permet d'aligner la sidebar du planner sur l'interface in-game. |
| `DT_PlaceablePlacementGroups.json` | **Prioritaire session 5** — groupes de placement des placeables (Chair, Table, Vases, Carpets, Shelves, WallShelves, SmallDecorations…) avec `m_ValidContactGroups`. Alimente directement la logique de snap des placeables sur les meubles/sols. |
| `DT_DuneSocketSetupData.json` | Session 3 optionnelle — configurations de sockets (Empty, Angled…). Utile si on veut implémenter les connexions précises entre pièces. |
| `DT_DuneSocketCostsData.json` | Session future — coûts par type de socket (Foundation_Edge: 100, Sideways/Up/Down: 10). Base d'un futur calculateur de coût de construction. |
| `DT_BuildableStabilizationGroupData.json` | Info sur les temps de stabilisation (NoGroup/Shelter/Outpost). Pas utilisable en 3D planner, peut alimenter une doc ou tooltip si besoin. |
| `CDT_BuildableGroupData.json`, `CDT_BuildingData.json`, `CDT_PlaceableData.json` | Formats CDT (compiled data tables UE). À examiner — probablement redondant avec les DT_ déjà intégrés, mais peuvent contenir des données supplémentaires. À analyser lors du prochain passage sur le pipeline. |

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
| Clic droit canvas | Annule le mode click-to-place |
| Drag depuis la sidebar | Mode drag-and-drop classique (toujours fonctionnel) |

#### Reprise dans une nouvelle session — checklist
1. Relancer le pipeline si FModel a été ré-extrait : `cd tools && node build_enriched_pieces.js`
2. Vérifier que `base_pieces_v2.json` est bien déployé sur le serveur (1 MB)
3. Le HTML porte des inline scripts pour les modales (save/plans/share) — fonctionnels visuellement mais l'appel API n'existe pas encore (prévu session 7)
4. `base_placeables_data.json` est référencé dans le code (`fetch(PLACEABLES_JSON_URL)`) mais **n'existe pas encore** sur le disque — l'onglet Placeables sera implémenté en session 6 après extraction FModel des meshes/datatables placeables
5. Les `placement_rules.ignore_groups` sont exploitées (matrice de compatibilité opérationnelle), mais `vertical_offset_pct` ne l'est pas encore — affinement possible si besoin
6. Three.js et OrbitControls sont chargés via importmap depuis `unpkg.com` — vérifier que le serveur autorise les imports CORS depuis ce CDN si déploiement en production HTTPS
7. Le sandbox Three.js utilise `MeshStandardMaterial.transparent = true` sur les pièces des autres étages — vérifier le rendu si on change la lighting (pas de soucis actuellement avec la lumière ambiante actuelle)

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
├── dune_chronologie.html # Chronologie de l'univers
├── news.html             # Actualités du jeu
├── register.html         # Création de compte (design deux colonnes : formulaire + présentation guilde)
├── base_planner.html     # Constructeur de Base 3D (Three.js) — en dév (sessions 0-5 livrées, 6-7 à faire)
│
├── script.js             # Logique cartographique (Leaflet, marqueurs, Désert Profond)
├── skills.js             # Simulateur de talents + commandes de craft
├── planner.js            # Planificateur d'événements
├── migration.js          # Logique de migration (validation, refus, Discord)
├── base_planner.js       # Logique 3D du Constructeur de Base (Three.js, ~2100 lignes après session 5)
├── auth-guard.js         # Protection des pages (redirection login si non connecté)
│
├── save.php              # API principale (bases, utilisateurs, craft, commandes)
├── auth.php              # Authentification
├── api.php               # Données de groupe
├── account_api.php       # API compte joueur (avatar, profil, stats, historique)
├── migration_api.php     # Réservations de migration (validation, refus, entraide)
├── dd_map_update.php     # Composition de deep_desert.jpg depuis les tuiles CDN gaming.tools
├── dd_proxy.php          # Proxy serveur vers l'API acteurs de gaming.tools (champs d'épice)
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
├── base_pieces_v2.json   # Catalogue enrichi des pièces du Constructeur de Base (645 pièces, 1 MB)
├── base_placeables_data.json  # Catalogue des placeables Dune Awakening (469 objets)
├── last_wipe.txt         # Horodatage du dernier wipe hebdomadaire du Désert Profond
│
├── tools/                # Scripts d'outillage (génération de données, Node.js)
│   └── build_enriched_pieces.js  # Génère base_pieces_v2.json à partir des exports FModel
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
