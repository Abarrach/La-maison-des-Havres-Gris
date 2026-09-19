# Dernier Rempart — édition guilde 1.0

Version préparée dans le worktree codex/dernier-rempart. Main et production non modifiés.

## Livraison manuelle dans /v2 uniquement, puis validation

Envoyer ces six fichiers avec leur arborescence :

- jeux/dernier_rempart.html
- jeux/dernier_rempart_engine.js
- jeux/dernier_rempart_view.js
- jeux/dernier_rempart.js
- jeux/img/rempart_arrakis.webp
- jeux/img/rempart_buildings.png

Le paquet contient aussi jeux/hub.html et jeux/scores_api.php. **Ce sont des fichiers partagés basés sur le dépôt, pas des copies vérifiées de la production.** Comparer aux fichiers effectivement utilisés sur /v2 et en production, en normalisant CRLF/LF, et reporter seulement les changements nécessaires si ces fichiers ont évolué :

- API : ajouter l'entrée dernier_rempart dans GAMES, nom Dernier Rempart, plancher max_score 300000 et cooldown 2. Conserver score_ceiling() dynamique existant.
- Hub : carte, nom du jeu et onglet de classement. La carte Sandwalk est retirée, son jeu et ses scores ne sont pas supprimés.

Envoyer les JS et images AVANT le HTML. Tous les modules sont appelés avec ?v=3. Ne pas envoyer tout le dépôt et ne jamais remplacer jeux/data/, les comptes, les configurations ou les secrets. Le jeu utilise les gardes d'authentification déjà présentes sur le site.

## Recette indispensable avant promotion à la racine

1. Ctrl+F5, vérifier l'apparition des trois bâtiments, l'absence de 404 et d'erreur console.
2. Partie souris et tactile : tir, impulsion, pause/reprise, retour après changement d'onglet.
3. Depuis froid : environ six tirs en rafale avant la surchauffe ; des tirs espacés permettent de refroidir.
4. Fin de partie avec une session Discord valide : vérifier la confirmation serveur puis les classements Semaine et Hall of Fame. Une partie moins bonne ne doit pas effacer le meilleur score.
5. Vérifier les notifications Discord selon la configuration /v2 : le serveur de scores peut déclencher une annonce réelle si /v2 partage le webhook de production. Le mode localhost n'appelle jamais l'API.
6. Si le serveur refuse un score, un message et un bouton apparaissent. Le renvoi reste disponible après « Rejouer », tant que la page n'est pas fermée.

Ne promouvoir qu'après cette recette. Les tests automatisés simulent les réponses de l'API, sans contact avec la production.

## Contrôles

Clic ou doigt : tirer devant la trajectoire. Maintien : rafale (chauffe).
Espace ou bouton : impulsion de secours. P / Échap : pause.
Trois bâtiments, 3 PV chacun ; une réparation par vague sur un bâtiment survivant.
Les chaînes rétribuent les tirs bien placés. Aucun déblocage permanent affectant le classement.

## Références et assets

Architecture originale inspirée de la direction industrielle/brutaliste décrite par Funcom :
[Building in Dune: Awakening](https://duneawakening.com/news/building-in-dune-awakening-claim-your-piece-of-arrakis/).
Concept arcade inspiré de Missile Command. Ni jeu officiel, ni copie d'assets officiels.
Décor et atlas créés avec l'outil intégré ImageGen ; prompts et provenance dans img/rempart_art.md.
Sons synthétisés localement, pas de banque officielle Dune.

## Tests reproductibles

- node jeux/tests/dernier_rempart.test.cjs
- node jeux/tests/dernier_rempart_ui.test.cjs
- C:\php\php.exe -l jeux/scores_api.php
- Aperçu sans identifiants : node tools/preview_rempart.cjs 8769, puis http://127.0.0.1:8769/jeux/dernier_rempart.html.

Le serveur d'aperçu retire la garde uniquement de sa réponse en mémoire et sert une liste blanche de fichiers. Ne jamais utiliser ce serveur comme hébergement public.
