# Connexion Discord (OAuth2) — Mise en service & bascule v2 → racine

Auth du portail via le Discord de la guilde. Accès réservé aux membres ;
sortie de la guilde = session détruite à la revérification. Page mot de passe
discrète conservée (`sietch-tabr.html` → `auth.php`).

## 1) Fichiers de la fonctionnalité

| Fichier | Versionné ? | Rôle |
|---|---|---|
| `discord_oauth.php` | oui | Bibliothèque partagée (config, API Discord, mapping, session) |
| `discord_login.php` | oui | Départ OAuth2 (state CSRF → écran Discord) |
| `discord_callback.php` | oui | Retour Discord → vérif guilde → session → menu |
| `session_check.php` | oui | Revérif périodique d'appartenance (appelée par auth-guard.js) |
| `import_discord_map.php` | oui | Outil admin : pré-charge le mapping Excel (one-shot) |
| `discord_oauth_config.example.php` | oui | Gabarit de config |
| `discord_oauth_config.php` | **NON (gitignoré)** | Secrets réels (à créer sur le serveur) |
| `auth-guard.js` | oui | **Modifié** : ajoute la vérif serveur |
| `index.html` | oui | **Modifié** : bouton « Se connecter avec Discord » (mdp retiré de l'accueil) |

> Aucun chemin `/v2/` n'est codé en dur dans le JS/PHP (tout est relatif ou
> auto-dérivé). **Le SEUL réglage spécifique à l'environnement est `redirect_uri`.**

## 2) Mise en service sur /v2/ (env de test)

1. **Portail Discord** (https://discord.com/developers → app `1518337529261068319`) :
   - Onglet **OAuth2 → Redirects** → ajouter exactement :
     `https://havresgris.ddns.net/v2/discord_callback.php`
   - Onglet **OAuth2** → **Reset Secret** → copier le *Client Secret*.
2. **Config serveur** : copier `discord_oauth_config.example.php` →
   `discord_oauth_config.php` (dans `/v2/`), puis renseigner :
   - `client_secret` (étape 1)
   - `bot_token` (le **même** que `epice/discord_sortie_config.php`)
   - `access_role_ids` (IDs des rôles autorisés à accéder : ex. « Membre »,
     « Ami ». **Vide = tout le serveur Discord a accès** ; définir pour exclure
     les invités / membres d'un autre jeu.)
   - `admin_role_ids` (IDs des rôles Discord qui donnent l'admin)
   - `guild_id` déjà rempli (`1470057863257919663`), `redirect_uri` déjà en `/v2/`.
   - Droits fichier : lisible par www-data (cf. [déploiement]).
3. **Déployer** les fichiers du tableau via WinSCP dans `/srv/dune-map/v2/`.
4. **Amorcer le mapping** (chicken-and-egg : il faut un admin avant de pouvoir
   se mapper) :
   - Se connecter via la page mot de passe discrète : `…/v2/sietch-tabr.html`
     avec le compte **Abarrach** (toujours admin).
   - Ouvrir `…/v2/import_discord_map.php`, coller l'Excel exporté en
     **CSV UTF-8** (colonnes `id_discord ; pseudo_discord ; pseudo_site`),
     vérifier en mode **aperçu**, puis décocher l'aperçu et importer.
5. **Tester** : `…/v2/index.html` → « Se connecter avec Discord » → doit
   retomber sur le bon pseudo et les bonnes données. Tester aussi un compte
   non-membre (doit être refusé).

## 3) BASCULE v2 → RACINE (à faire à la fin)

Une seule chose change réellement : la **redirect_uri**.

- [ ] **Portail Discord → OAuth2 → Redirects** : ajouter aussi
      `https://havresgris.ddns.net/discord_callback.php`
      (on peut garder les deux URLs déclarées en même temps).
- [ ] **`discord_oauth_config.php` (racine)** : `redirect_uri` → enlever `v2/`
      → `https://havresgris.ddns.net/discord_callback.php`.
- [ ] Déployer les fichiers du tableau à la racine `/srv/dune-map/`.
- [ ] Le `users_SECURE_9x.json` de la racine doit déjà contenir le mapping
      (champs `discord_id` / `discord_match`). Si l'import n'a été fait que sur
      /v2/, relancer `import_discord_map.php` à la racine (même CSV), ou copier
      le `users_SECURE_9x.json` enrichi.
- [ ] Vérifier : connexion Discord OK depuis la racine.

> Rien d'autre n'est lié à `/v2/` (auth-guard.js dérive `session_check.php` de
> sa propre URL ; discord_login/callback/menu utilisent des liens relatifs).

## 4) Points d'attention

- **Bootstrap admin** : tant que le mapping n'est pas importé, personne n'est
  admin via Discord. Abarrach passe par `sietch-tabr.html` (mot de passe) → c'est
  voulu, c'est la « page cachée ».
- **Filtrage d'accès par rôle** (`access_role_ids`) : matérialise tes
  catégories Discord. Vide = tout membre du serveur ; défini = seuls les
  porteurs d'un de ces rôles entrent. Perte du rôle → éjecté à la revérif
  (même logique que sortie de guilde).
- **Rôle admin** : recalculé à chaque login + à chaque revérif d'après les
  rôles Discord (`admin_role_ids`). Abarrach reste admin en dur.
- **Enforcement** : `recheck_seconds` (défaut 900 s) = délai max avant qu'un
  membre exclu soit éjecté lors d'une navigation. Baisser pour plus strict.
- **Sécurité** : `auth-guard.js` ajoute enfin une vérif **serveur** (le
  localStorage seul était falsifiable). `session_check.php` est l'autorité.
- **Comptes mot de passe** : `auth.php` reste fonctionnel (sessions sans
  `discord_id`, non revérifiées par Discord). Pas d'auto-inscription : un
  compte se crée manuellement dans `users_SECURE_9x.json`.

[déploiement]: voir mémoire projet (WinSCP → /srv/dune-map, www-data).
