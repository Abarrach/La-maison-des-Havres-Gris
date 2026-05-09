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
- Chaque base est taguée avec son sietch ; cliquer un joueur dans la liste bascule automatiquement sur son sietch
- Un joueur a **une seule base principale** sur Hagga (avec son sietch)

#### Désert Profond — Instances PVP / PVE
- Le DD est split en **deux instances** : PVP et PVE
- Au placement, le joueur choisit son instance
- Icône avec **pastille rouge** (PVP) ou **bleue** (PVE)
- Légende visible sur la carte du Désert Profond
- Un joueur peut avoir une base dans chaque instance (max 2)

### Simulateur de Talents
- Arbre de compétences interactif avec allocation de points
- Plusieurs filières de métiers (Combat, Artisanat, etc.)
- Simulez et testez vos combinaisons de talents avant de les appliquer en jeu

### Demandes de Craft
- Formulaire de soumission avec description détaillée
- Ajout de jusqu'à 4 images par demande
- Suivi et gestion des requêtes côté administration

### Plan de Migration (`migration.html`)
- Chaque joueur place son marqueur sur la carte source (Hagga) pour indiquer sa position souhaitée
- Deux types de placement : **Impératif** (base ne rentre nulle part ailleurs) ou **Souhait** (flexible)
- Gestion de la disponibilité : présent seul, présent avec fief libre à offrir, ou absent
- Système d'entraide : lier un helper à un joueur absent (sous-fief)
- Filtre par sietch, listes « Besoin d'un fief » et « Fief libre » en temps réel
- **Import depuis Destination** : les bases confirmées sur `destination.html` apparaissent en marqueurs bleus pointillés ; le joueur vérifie son pseudo et finalise son inscription en un clic

### Destination Icarus (`destination.html`)
- Outil de **reconnaissance** sur le serveur de destination (Icarus)
- Un éclaireur place des **bases projetées** pour chaque joueur à l'endroit exact repéré en jeu
- Le joueur concerné confirme ou refuse l'emplacement (vérification par pseudo)
- 3 états visuels : projeté (orange pointillé), confirmé (vert ✓), refusé (rouge ✕)
- Ajout de **photos de la zone** par glisser-déposer ou coller (Ctrl+V), max 2 par base — compressées automatiquement côté client, stockées dans `uploads/`
- Cohérence croisée avec Migration :
  - Badge vert « Inscrit sur Migration » + statut dispo complet une fois le joueur inscrit
  - Avertissement si sietch divergent ou joueur noté Absent sur Migration
  - « Remettre en projeté » bloqué tant que l'inscription Migration est active
  - Suppression protégée si le joueur est déjà dans Migration
- Navigation rapide entre les deux pages (bouton haut-droite)
- Filtre par sietch, barre de progression globale, liste latérale avec badges d'état

### Planificateur d'Événements Landsraad
- Sélection de quêtes parmi 25 missions réparties en 5 catégories
- Gestion des participants (ajout/suppression de membres)
- Attribution automatique des rôles selon la composition du groupe
- Aperçu et sauvegarde des données de l'événement

### Chronologie de Dune
- Timeline de l'univers Dune sur 15 000 ans
- Référence historique et narrative pour les joueurs

---

## Authentification et Rôles

- Inscription et connexion sécurisées
- Deux niveaux d'accès : **Joueur** et **Administrateur**
- Gestion des utilisateurs (création, suppression, changement de rôle) via le panneau admin
- L'administrateur principal (`Abarrach`) ne peut pas être rétrogradé

---

## Stack Technique

| Couche | Technologies |
|--------|-------------|
| Frontend | HTML5, CSS3, JavaScript (ES6+), Leaflet.js |
| Backend | PHP 7+, API REST, stockage JSON |
| Style | CSS personnalisé, Tailwind CSS (actualités) |
| Médias | Images haute résolution, icônes PNG |

---

## Structure du Projet

```
DuneMap/
├── index.html           # Écran d'introduction
├── menu.html            # Hub de navigation principal
├── map.html             # Carte des territoires
├── skills.html          # Simulateur de talents + demandes de craft
├── planner.html         # Planificateur Landsraad
├── migration.html       # Coordinateur de migration (serveur source)
├── destination.html     # Reconnaissance et bases projetées (serveur destination)
├── news.html            # Actualités du jeu
├── dune_chronologie.html # Chronologie de l'univers
├── login.html / register.html
│
├── script.js            # Logique cartographique
├── skills.js            # Simulateur de talents
├── planner.js           # Planificateur d'événements
├── migration.js         # Logique de migration
├── destination.js       # Logique des bases projetées
│
├── save.php             # API principale (bases, utilisateurs, craft)
├── auth.php             # Authentification
├── api.php              # Données de groupe
├── migration_api.php    # Réservations de migration
├── destination_api.php  # Bases projetées + upload images
│
├── bases.json           # Bases des territoires (champs : user, x, y, type, map, note, sietch, instance)
├── requetes.json        # Demandes de craft
├── destination_data.json # Bases projetées sur Icarus (auto-créé au premier enregistrement)
├── landsraad_data.json  # Quêtes disponibles
├── metiers.json         # Définitions des talents
│
├── map.jpg              # Carte Bassin de Hagga
├── deep_desert.jpg      # Carte Désert Profond
└── icons/               # Icônes de marqueurs
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
chmod 775 uploads/

# destination_data.json est créé automatiquement au premier enregistrement
# si le répertoire est accessible en écriture pour www-data.
```

> [!IMPORTANT]
> Le fichier `bases.json` doit être déployé manuellement depuis la copie locale après chaque migration de données (ajout des champs `sietch` / `instance`). PHP doit pouvoir écrire dessus — si une erreur `write_error` apparaît, vérifier les permissions : `chmod 664 bases.json`.

Accéder ensuite à `index.html` via le navigateur.

---

## Thème Visuel

Interface entièrement thématisée autour de l'univers de Dune :
- Palette désertique (or `#cda434`, sable `#f5deb3`, brun profond `#1a1007`)
- Animations : fondu, lueur, vibration
- Design responsive adapté aux différentes tailles d'écran

---

## Licence

Voir le fichier [LICENSE](LICENSE).
