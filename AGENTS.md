# Consignes pour les agents (Codex, Claude, autres)

Ce dépôt est travaillé par **plusieurs agents en parallèle**, et par un humain unique
(Abarrach) qui garde la main sur le déploiement. Ce fichier existe pour qu'on ne se marche
pas dessus et qu'on ne repaie pas deux fois les mêmes erreurs.

**Le README reste la documentation de référence** (1 200 lignes, détaillée, à jour). Ce
fichier-ci ne le remplace pas : il donne les règles de travail et la carte des pièges.

---

## 0. Les six choses qui cassent tout

À lire avant la première modification. Chacune a déjà provoqué un incident réel.

1. **La production n'est PAS déployée par git.** L'humain copie les fichiers à la main
   (WinSCP) vers `/srv/dune-map`. Le dépôt et la prod **dérivent dans les deux sens** :
   des fichiers n'ont existé qu'en prod (vignettes du hub jeux, bannières) et un
   redéploiement complet les aurait effacés ; à l'inverse du code commité peut n'être
   jamais monté. **Ne jamais supposer que `main` == prod.** Pour trancher, télécharger le
   fichier depuis `https://havresgris.ddns.net/<chemin>` et comparer.

2. **Ne jamais utiliser `git stash`.** Une vingtaine de worktrees partagent la même pile
   de stash, plusieurs agents peuvent tourner en même temps : un `stash pop` peut dépiler
   le travail de quelqu'un d'autre. Pour mettre de côté : commit temporaire sur une
   branche.

3. **Fins de ligne.** Le dépôt est en CRLF côté poste Windows, la prod en LF. Toute
   comparaison dépôt ↔ prod doit **normaliser les fins de ligne**, sinon une vingtaine de
   fichiers ressortent « modifiés » pour rien et le vrai signal se perd.

4. **Des fichiers indispensables sont gitignorés** et n'existent que sur le serveur :
   `models/` (357 Mo de .glb pour le planner), `jeux/data/` (scores), `settings.json`
   (visibilité des pages, écrit par les admins), `users_SECURE_9x.json`, et tous les
   fichiers de configuration portant des secrets (`discord_oauth_config.php`,
   `epice/discord_sortie_config.php`, `config.php`, `dunelogger/awoo_api_key.txt`).
   Ne pas les committer, ne pas supposer leur absence en prod, ne pas les écraser.

5. **Le planner a un cache-busting manuel.** `base_planner.js`, ses `import`, le
   `<script>` de `base_planner.html` et le `fetch` de `planner_pieces.json` portent tous
   un `?v=lotXX`. **Le bumper à chaque modification**, partout, sinon le navigateur sert
   l'ancien module et le bug « corrigé » persiste chez l'utilisateur.

6. **Droits de fichiers sur le serveur.** Tout doit rester `dune:www-data`, fichiers 664,
   dossiers 775 (setgid). Un fichier créé par PHP arrive en `www-data:644` et devient
   non modifiable par WinSCP et par les crons. **Ne jamais faire `chown -R www-data`**,
   ça casse l'envoi de fichiers.

---

## 1. Se répartir le travail

### Règles de base

- **Une branche par chantier**, partant de `main` à jour. Jamais deux agents sur la même
  branche.
- **Rebaser sur `main` avant de pousser** (`git fetch origin && git rebase origin/main`).
- **Commits petits et thématiques**, message en français, sujet à l'impératif ou nominal
  (voir l'historique : `Hub de jeux : un record ne doit plus disparaître en silence`).
- **Ne jamais reformater un fichier en entier** (indentation, guillemets, ordre des clés).
  Ces fichiers font 1 500 à 6 800 lignes ; un reformatage rend tout conflit irrésoluble et
  noie la revue. Modifier uniquement les lignes utiles.
- **Ne pas renommer ni déplacer de fichier** sans le signaler : le déploiement manuel ne
  supprime jamais l'ancien côté serveur, on se retrouve avec deux versions vivantes.

### Périmètres

Les gros fichiers sont les zones de collision. Si deux agents travaillent en même temps,
se répartir par **domaine**, pas par tâche :

| Domaine | Fichiers principaux |
|---|---|
| Planner 3D | `base_planner.{html,js}`, `planner_socket_engine.js`, `planner_mesh.js`, `planner_*.json` |
| Analytique | `dune_analytics.html`, `dunelogger/*.py` |
| Mini-jeux | `jeux/**` |
| Carte / Deep Desert | `map.html`, `script.js`, `dd_*.php`, `dune_chronologie.html` |
| Discord (bots, commandes) | `discord_*.php`, `epice/discord_*.php` |
| Auth / comptes / admin | `discord_oauth.php`, `save.php`, `account*.{html,php}`, `page-guard.js`, `auth-guard.js` |
| Optimiseur / plans | `optimiseur.html`, `plans*.{html,js,php}`, `stuff_*.json` |
| Épice (sorties, débrief) | `epice/**` |

`README.md` est touché par tout le monde : **écrire dans sa propre section**, ne pas
réorganiser le fichier.

### Ce qu'il faut écrire quand on a fini

Le README n'est pas lu automatiquement par les agents : c'est l'humain et les agents
suivants qui s'en servent. **Toute évolution de fonctionnalité doit s'y refléter dans le
même commit** — c'est une demande explicite et répétée de l'utilisateur. Consigner en
particulier ce qui a coûté du temps : le piège rencontré vaut plus que la description du
correctif.

---

## 2. La production

- **Machine** : VM Linux, hostname `DuneLogger`. Site dans `/srv/dune-map`, servi par
  nginx + php-fpm (`www-data`). Domaine `havresgris.ddns.net` (HTTPS, Certbot).
  ⚠ **Différente du serveur dédié OVH** (`ns3115183`), qui héberge autre chose et ne
  partage qu'un compte DDNS.
- **Conf nginx** : `/etc/nginx/sites-enabled/havresgris`. Pour la trouver sans deviner :
  `sudo nginx -T | grep -E "^# configuration file|server_name|root "`. Rituel :
  sauvegarde → édition → **`sudo nginx -t`** → `systemctl reload nginx`.
- **Environnement de test** : `/srv/dune-map/v2` (`havresgris.ddns.net/v2/...`).
  L'utilisateur déploie **toujours dans `/v2` d'abord**, teste, puis promeut à la racine.
  Lui rappeler le **Ctrl+F5** si une page semble afficher l'ancienne version.
- **Cron** (utilisateur `dune`) : scraper horaire, archivage hebdo lundi 3 h UTC, résumé
  journalier à `:10`, régénération carte Deep Desert mardi 6 h 30 UTC, nettoyage des posts
  de sortie toutes les 15 min, reset du hub jeux mardi 5 h UTC, purge des bases des partis
  à 6 h. Le détail exact est dans le README, relevé sur la prod.
- **PHP 8.2 CLI est installé en local** (`C:\php\php.exe`, sans `mbstring` — volontaire,
  pour reproduire le serveur). **Faire `php -l` sur chaque fichier PHP touché.**

---

## 3. Carte du site

Site de guilde Dune Awakening, ~236 fichiers suivis. Pages servies en statique, logique
métier en PHP, données en JSON sur disque (pas de base de données).

- **Authentification** : OAuth2 Discord (`discord_login.php` → `discord_callback.php`),
  session revalidée périodiquement (`session_check.php`) — quitter le Discord coupe
  l'accès. `sietch-tabr.html` est une page mot de passe de secours, volontairement
  discrète et non liée. `auth-guard.js` (garde client) + `page-guard.js` (garde serveur).
  Rôle admin dérivé d'un rôle Discord **ou** d'un override persistant en JSON.
- **Carte interactive** (`map.html`) : bases de guilde, POI, Deep Desert régénérée chaque
  semaine. Les données du Deep Desert sont lues **par le navigateur** (Cloudflare bloque
  les appels serveur et Node).
- **Planner de base 3D** (`base_planner.html`) : Three.js, moteur d'accroche par
  « sockets », meshes réels extraits du jeu (FModel), stabilité, coûts matériaux, synthèse.
- **Œil du Mentat** (`dune_analytics.html`) : fréquentation des serveurs, Plotly,
  chargement par paliers (résumé journalier au démarrage, horaire à la demande).
- **Hub de jeux** (`jeux/`) : 6 mini-jeux canvas, double classement semaine / Hall of Fame,
  annonces Discord automatiques.
- **Épice** (`epice/`) : sorties de guilde (bot Discord bidirectionnel), débriefs.
- **Optimiseur de stuff**, **registre des plans**, **migration de sietch**, **Mon Compte**.

---

## 4. Pièges avérés

Tous constatés en production ou en test, pas théoriques.

### PHP
- **Le serveur n'a pas `mbstring`.** `mb_strtolower` et consorts sont fatals. Utiliser les
  helpers de repli existants (`dco_lc()`).
- `isset()` sur une **constante** est une erreur fatale ; les `const` ne sont pas hissées.
- Les fichiers de config collés à la main contiennent souvent un `\n` parasite →
  `trim()` défensif sur chaque champ.
- Un endpoint admin ne doit jamais faire confiance à un champ client : vérifier
  `$_SESSION['role']` côté serveur.

### API Discord
- **`PUT /applications/{id}/commands` REMPLACE toutes les commandes de l'application.**
  Chaque script n'enregistrant que la sienne, un PUT efface silencieusement les autres —
  c'est déjà arrivé. **Toujours POST.** Corollaire : supprimer une commande obsolète
  demande un `DELETE` manuel.
- Limites : 25 options par commande, 5 composants par modal, pas d'autocomplétion
  relancée après un clic.
- Les images doivent être passées **par URL publique**, jamais en multipart (sinon double
  affichage grand format + vignette).
- Pas de messages privés pour les annonces de guilde : la doctrine est « tout dans le
  canal » (voir §5).

### Plotly (analytique)
- **`beginAtZero` est une clé Chart.js, ignorée EN SILENCE par Plotly.** Utiliser
  `rangemode: 'tozero'`. Aucune option Chart.js n'a d'effet dans ce fichier.
- **`yaxis.autorange` ignore la plage X** : il autorange sur tous les points. Pour une
  échelle qui suit la fenêtre visible, calculer les bornes soi-même.
- **Un `Plotly.relayout` appelé depuis un gestionnaire `plotly_relayout` est avalé** —
  Plotly est encore en train d'émettre l'événement. Le différer (`setTimeout(0)`).
- Notre propre relayout réémet l'événement : prévoir un **test d'égalité** pour couper la
  récursion. Un drapeau « occupé » ne convient pas, il avale aussi la première application.
- **Plotly fige la taille du graphe au tracé.** Un conteneur de 1 494 px a reçu un tracé de
  64 px parce que la grille n'était pas résolue au `newPlot`. `responsive: true` ne couvre
  que le redimensionnement de fenêtre ; prévoir un rattrapage après chaque rendu.

### Three.js / planner
- **OrbitControls écoute `pointerdown`, qui passe avant `mousedown`** : il démarre son
  glissé même si on veut faire autre chose. `onPointerMove` sort tôt quand
  `enabled === false` (donc la caméra ne bouge pas), mais `onPointerUp` n'a pas ce garde.
  Prévoir un filet sur `blur` si le bouton est relâché hors fenêtre.
- Les pièces sont des `Group` (le vrai mesh est en sous-objet) : **le raycast doit être
  récursif**, puis remonter jusqu'au groupe porteur de `userData.itemId`.
- Les contrôles de placement (`socketPlaceableReason`) ne concernent que machines et
  véhicules ; les structures se superposent librement, c'est voulu.

### Épice — base avancée et manuel
- Le manuel visible peut venir de `epice/data/sop_content.json` et différer complètement du HTML livré. Le lire connecté avant toute modification de doctrine ; ne jamais le remplacer par le défaut du dépôt. Le bloc Base avancée est ajouté avec un marqueur stable, puis reste éditable.
- **Assaut = propriété d’un défenseur cardinal**, cumulable avec CaC, pas un cinquième pilote. Il est groupé en jeu avec Récolte ; les deux buggys sont groupés avec deux patrouilleurs. Les rôles tactiques et les groupes en jeu se recoupent : ne pas compter ces personnes deux fois. Conserver les anciens rôles lors de la lecture des historiques.
- La page épice dépend désormais de `epice/raid-groups.js` : livrer les deux ensemble, avec `data-api.php` et `discord_sortie.php` pour cette évolution.

### Mini-jeux et scores
- **Un plafond `max_score` trop bas fait disparaître un record en silence** : la
  soumission sort avant enregistrement ET avant notification. C'est mécaniquement le
  meilleur joueur qu'on pénalise, et personne ne s'en aperçoit. Tous ces jeux sont
  **sans fin**, donc tout plafond finira par être dépassé : les refus sont désormais
  journalisés dans `jeux/data/scores_rejected.log` — **le consulter avant de conclure
  qu'un joueur ment**.
- Le secret anti-triche est **servi au client** : le hash ne protège de rien face à
  quelqu'un de déterminé. C'est le plafond qui fait le garde-fou réel.
- L'affichage « meilleur score » des jeux vient du `localStorage`, écrit **avant** l'appel
  serveur et sans regarder sa réponse : l'écran et le classement peuvent diverger.
- `scores.json` et `scores_weekly.json` doivent rester **664 `dune:www-data`** : le site
  écrit, le cron remet à zéro. Un 644 casse le reset hebdo, en silence.

### Tester dans un navigateur piloté
- **Les pages canvas ne se testent pas au rendu** : l'onglet reste masqué,
  `requestAnimationFrame` ne tourne jamais, les captures partent en timeout. Pour les
  mini-jeux, monter un **banc d'essai Node** avec des bouchons de canvas et piloter
  `tick()` à la main — plus rigoureux qu'une capture, et ça mesure des grandeurs.
- Pour le planner (Three.js), même racine : `matrixWorld` n'est jamais mis à jour, donc
  **tous les raycasts ratent**, y compris la sélection au clic. Remèdes : simuler
  `canvas.getBoundingClientRect()` (il vaut 0 × 0) puis appeler
  `scene.updateMatrixWorld(true)` avant chaque mesure.
- Les pages sont derrière `auth-guard.js` : pour tester en local, servir une copie avec
  les gardes neutralisées. **Ne pas demander ses identifiants à l'utilisateur.**
- Les CSV de données sont publics (pas d'auth) : on peut les télécharger pour reproduire
  fidèlement un bug d'affichage avec les vraies données.

---

## 5. Doctrines produit

Décisions de l'utilisateur, à respecter sans les rediscuter à chaque fois.

- **Le Discord de la guilde est le lieu principal.** Le site est un outil annexe. Ne pas
  proposer de fonctionnalité qui concurrence Discord (forum, chat, fil d'actualité, centre
  de notifications). Notifier **via** Discord plutôt que de dupliquer sur le site.
- **Qui organise et qui participe aux sorties = admin uniquement.** Citation :
  « je n'ai pas envie que les joueurs se sentent pistés ». Un joueur peut voir ses propres
  statistiques, jamais un classement de participation entre membres.
- **Comparer ce qui est comparable.** Tout classement d'objets doit grouper par catégorie
  d'usage réelle (un laser n'est pas un pistolet), normaliser les indicateurs visuels par
  classe, et **expliquer sa base dans l'interface**, pas seulement en commentaire.
- **Jamais de donnée inventée.** Si une valeur n'est pas dataminable ou sourcée, on ne
  l'estime pas : on l'affiche comme inconnue. Une piste de multiplicateur d'arme a été
  explicitement refusée pour cette raison.
- **Chercher des références soi-même.** Sur une demande d'amélioration de jeu, d'ergonomie
  ou de « feel », aller lire ce que font les autres jeux du genre avant de proposer —
  ne pas attendre que l'utilisateur cite une référence.

---

## 6. Impasses déjà explorées

Ne pas les reproposer sans élément nouveau.

- **Mode texturé du planner** : abandonné, les masques sont packés dans les textures du
  jeu.
- **Compagnon type gaming.tools** (lecture mémoire du jeu) : refusé — application native,
  autorisation Funcom nécessaire.
- **Multiplicateur de dégâts à la tête par arme** : non dataminable, donc pas affiché.
- **« La Marche du Désert »** (6ᵉ mini-jeu) : commité mais **non déployé**, jugé « pas
  top » par l'utilisateur — problème de game design, pas technique.
- **Auto-inscription** (`register.html` + action serveur) : supprimée volontairement, les
  comptes hors Discord sont créés à la main.

---

## 7. Ce qui reste ouvert

- **Bannières d'activité du bot Sorties** : 25 images à générer.
- **Plans manquants / lieux de drop** : 8 régions récoltées, ~70 % de couverture ;
  restent 92 emplacements non identifiés et l'export FR d'une table de localisation.
- **Plafonds `max_score` des autres mini-jeux** (`orni_flap` 9 999, `spice_runner` 99 999,
  `sandstorm_memory` 50 000, `muaddib_rescue` 50 000) : mêmes jeux sans fin, même risque
  qu'avec Worm Rider. Le journal des refus dira lequel coince en premier.
- **Trois scripts non versionnés** dans `dunelogger/` sur le poste de l'utilisateur :
  `fix_frozen_data.py` (outil de secours réutilisable, le plus utile), `dune_logger_multi.py`
  (ancien scraper, remplacé) et `analyze_dune.py`.
- **Registre des plans** (`/plan`) : livré et viable, mais l'utilisateur veut le retravailler.
