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
- Limite de bases par joueur selon la zone (1 en Hagga, 2 en Désert Profond)
- **Wipe hebdomadaire automatique** du Désert Profond chaque mardi à 5h00 (heure de Paris)
- Minuterie de tempête affichée en temps réel
- Panneau d'administration pour approuver, modifier ou supprimer des bases

### Simulateur de Talents
- Arbre de compétences interactif avec allocation de points
- Plusieurs filières de métiers (Combat, Artisanat, etc.)
- Simulez et testez vos combinaisons de talents avant de les appliquer en jeu

### Demandes de Craft
- Formulaire de soumission avec description détaillée
- Ajout de jusqu'à 4 images par demande
- Suivi et gestion des requêtes côté administration

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
├── migration.html       # Coordinateur de migration
├── news.html            # Actualités du jeu
├── dune_chronologie.html # Chronologie de l'univers
├── login.html / register.html
│
├── script.js            # Logique cartographique
├── skills.js            # Simulateur de talents
├── planner.js           # Planificateur d'événements
├── migration.js         # Logique de migration
│
├── save.php             # API principale (bases, utilisateurs, craft)
├── auth.php             # Authentification
├── api.php              # Données de groupe
├── migration_api.php    # Réservations de migration
│
├── bases.json           # Bases des territoires
├── requetes.json        # Demandes de craft
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
```

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
