<?php
// ============================================================
//  bd_api.php — « Havres Gris Stories », la BD de la guilde (page bd/aventures.html)
//
//  Une BD de guilde qui s'écrit au fil des soirées : chaque HISTOIRE porte un
//  titre, la date de la soirée, le récit (souvent le post Discord d'origine) et
//  ses PLANCHES, dans l'ordre de lecture.
//
//  Stockage :
//    - bd/data/albums.json          métadonnées (gitignoré, donnée vivante)
//    - bd/pages/<histoire>/<id>.<ext>   planches + vignettes (gitignoré)
//  Les planches sont servies en statique : leur URL doit rester publique pour
//  qu'une annonce Discord puisse un jour les afficher (doctrine « images par
//  URL », cf. AGENTS.md). Les noms sont aléatoires, pas d'index du dossier.
//
//  CIRCUIT DE VALIDATION (décidé avec l'utilisateur le 2026-10-17) :
//    brouillon ──soumettre──▶ soumis ──publier (admin)──▶ publie
//        ▲                      │
//        └──renvoyer + motif────┘   (admin ; aussi depuis « publie » = dépublier)
//    - Tout membre connecté crée des histoires. Un brouillon n'est visible QUE de
//      son auteur ; une histoire soumise, de son auteur et des admins.
//    - Seuls les ADMINS valident (pas de liste de modérateurs, choix explicite).
//    - Une histoire publiée est VERROUILLÉE pour son auteur : seuls les admins la
//      retouchent. L'auteur ne peut plus la supprimer non plus.
//    - Le retour à l'auteur passe par la page (statut + motif dans « Mes
//      histoires ») : jamais de message privé Discord (doctrine guilde).
//    - L'alerte aux admins est un compteur (action `a_valider`) lu par la page ET
//      par la tuile du menu (champ `badge` de pages.js).
//
//  HISTOIRES FLASH (2026-10-17) : une image + une fiche (titre, description, date,
//  lieu/activité obligatoires ; personnages facultatifs). Même fichier, `type: flash`,
//  une seule entrée dans `pages`. Décisions de l'utilisateur :
//    - PUBLICATION DIRECTE dès que la fiche est complète (pas de validation) ; un
//      admin peut dépublier avec un motif (`renvoyer`), l'auteur corrige et republie.
//    - « Fiche non complétée = pas de proposition » : la complétude est vérifiée ICI,
//      la page ne fait qu'afficher ce qui manque.
//    - L'auteur garde la main sur sa flash (modifier, remplacer l'image, supprimer).
//    - Une flash ne compte pas dans la numérotation des épisodes BD.
//  Une seule voie d'écriture pour les flash : `flash_save` (multipart). Les actions
//  des BD (save, upload, soumettre…) les refusent, pour qu'aucune flash ne se
//  retrouve sans image ou en attente d'une validation qui n'existe pas.
//
//  SÉRIES (2026-10-17) : la Saga des Havres Gris (tout ce qui est publié, « Épisode N »)
//  contient des SÉRIES (arcs : « Le Sable Rose »…) dont les histoires sont des PARTIES.
//    - Registre `series` dans albums.json : {id, nom, cree_par, cree_le} ; une histoire
//      pointe vers sa série par `serie`. Une flash peut rejoindre une série (« coulisses »).
//    - Tout joueur crée une série ou écrit la suite de n'importe quelle série. Un nom
//      identique (casse et espaces ignorés) REJOINT la série existante : pas de doublon.
//    - Partie N = rang parmi les BD PUBLIÉES de la série, par date de soirée : calculé à
//      la lecture, jamais stocké. Une série n'est visible qu'à travers les histoires que
//      l'on voit : le nom tapé dans un brouillon reste privé jusqu'à sa publication.
//    - Admins : renommer, fusionner deux séries.
//
//  Envoi d'une planche : multipart, UNE planche par requête (+ sa vignette),
//  réduite côté navigateur sous ~900 Ko. Le corps de requête reste ainsi sous le
//  `client_max_body_size` par défaut de nginx (1 Mo) : au-delà, nginx répond
//  413 avant même que PHP ne voie la requête.
// ============================================================
require_once __DIR__ . '/../epice/auth_epice.php'; // session + epice_user()/epice_role()
require_once __DIR__ . '/bd_discord.php';           // annonce Discord à la publication
header('Content-Type: application/json; charset=utf-8');
date_default_timezone_set('Europe/Paris');
umask(0002); // fichiers 664 / dossiers 775 : le compte dune doit pouvoir les reprendre

$action = $_GET['action'] ?? '';

// a_valider répond 0 aux non-admins au lieu d'une erreur : le menu l'appelle
// pour tout le monde sans avoir à connaître les droits.
$known = ['list', 'a_valider', 'save', 'upload', 'reorder', 'delete_page', 'delete',
          'soumettre', 'retirer', 'publier', 'renvoyer', 'flash_save', 'annoncer',
          'serie_renommer', 'serie_fusionner'];
if (!in_array($action, $known, true)) bd_out(false, [], 'Action inconnue.');
epice_require_login();

const BD_MAX_PAGES     = 60;
const BD_MAX_BROUILLON = 3;   // histoires non publiées par auteur (admins exemptés)
const BD_MAX_OCTETS    = 12 * 1024 * 1024; // garde-fou serveur ; le navigateur vise ~900 Ko
const BD_TYPES         = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp'];
// Lieux / activités d'une histoire flash — source unique, renvoyée à la page par `list`.
const BD_LIEUX = [
    'hagga'  => 'Bassin de Hagga',
    'deep'   => 'Désert Profond',
    'epice'  => 'Sortie épice',
    'pvp'    => 'Combat PvP',
    'donjon' => 'Donjon & épave',
    'base'   => 'Base & construction',
    'autre'  => 'Autre',
];

function bd_out(bool $ok, array $payload = [], string $err = ''): void {
    echo json_encode($ok ? array_merge(['ok' => true], $payload) : ['ok' => false, 'error' => $err], JSON_UNESCAPED_UNICODE);
    exit;
}

// Coupe à $n caractères sans mbstring (absent du serveur).
function bd_cut($s, int $n): string {
    $s = trim(str_replace(["\r", "\0"], '', (string)$s));
    return preg_match('/^.{0,' . $n . '}/us', $s, $m) ? $m[0] : '';
}

function bd_id_ok($id): bool { return is_string($id) && preg_match('/^[a-z0-9_]{6,40}$/', $id) === 1; }
// « Aperçu joueur » des admins (auth-guard.js) : la LECTURE `list?apercu=1` se calcule
// comme pour un joueur — mêmes histoires, mêmes droits affichés. Le drapeau n'est posé
// que par `list` : aucune écriture ne le voit, les vrais droits restent ceux de la session.
$BD_APERCU = false;
function bd_admin(): bool { return epice_role() === 'admin' && empty($GLOBALS['BD_APERCU']); }
function bd_pages_dir(string $albumId): string { return __DIR__ . '/pages/' . $albumId; }
function bd_in(): array { return json_decode((string)file_get_contents('php://input'), true) ?? []; }

// ---- Stockage : lecture-modification-écriture sous UN SEUL verrou ----------
//  Même motif que tournois-api.php : deux personnes qui touchent la même
//  histoire en même temps ne doivent pas s'écraser.
function bd_file(): string {
    $dir = __DIR__ . '/data';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    return $dir . '/albums.json';
}
function bd_read(): array {
    $f = bd_file();
    if (!file_exists($f)) return ['albums' => []];
    $d = json_decode((string)file_get_contents($f), true);
    if (!is_array($d) || !isset($d['albums']) || !is_array($d['albums'])) $d = ['albums' => []];
    if (!isset($d['series']) || !is_array($d['series'])) $d['series'] = [];
    return $d;
}
function bd_mutate(callable $fn) {
    $fp = @fopen(bd_file(), 'c+');
    if (!$fp) bd_out(false, [], "Écriture impossible : droits insuffisants sur bd/data/albums.json (www-data doit pouvoir l'écrire).");
    $deadline = microtime(true) + 2;
    while (!flock($fp, LOCK_EX | LOCK_NB)) {
        if (microtime(true) > $deadline) { fclose($fp); bd_out(false, [], 'Fichier des histoires occupé, réessaie dans un instant.'); }
        usleep(50000);
    }
    $d = json_decode((string)stream_get_contents($fp), true);
    if (!is_array($d) || !isset($d['albums']) || !is_array($d['albums'])) $d = ['albums' => []];
    if (!isset($d['series']) || !is_array($d['series'])) $d['series'] = [];
    try { $ret = $fn($d); }
    catch (Throwable $e) { flock($fp, LOCK_UN); fclose($fp); bd_out(false, [], $e->getMessage()); }
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($d, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    return $ret;
}

function bd_find(array $d, string $id): ?int {
    foreach ($d['albums'] as $i => $a) { if (($a['id'] ?? '') === $id) return $i; }
    return null;
}

// Le membre courant a-t-il créé cette histoire ? (pseudo du site OU id Discord)
function bd_is_creator(array $a): bool {
    $me = epice_user() ?? '';
    if ($me !== '' && strcasecmp((string)($a['createur'] ?? ''), $me) === 0) return true;
    $myDiscord = (string)($_SESSION['discord_id'] ?? '');
    return $myDiscord !== '' && (string)($a['createur_discord'] ?? '') === $myDiscord;
}

function bd_statut(array $a): string {
    $s = (string)($a['statut'] ?? '');
    return in_array($s, ['brouillon', 'soumis', 'publie'], true) ? $s : 'brouillon';
}

function bd_is_flash(array $a): bool { return ($a['type'] ?? '') === 'flash'; }

// Contenu modifiable : un admin toujours ; l'auteur sur son brouillon BD, ou sur sa
// flash quel que soit son statut (publication directe : rien à contourner).
function bd_can_edit(array $a): bool {
    if (bd_admin()) return true;
    if (!bd_is_creator($a)) return false;
    return bd_is_flash($a) || bd_statut($a) === 'brouillon';
}
// Suppression : un admin toujours ; l'auteur tant que sa BD n'est pas publiée, et sa flash toujours.
function bd_can_delete(array $a): bool {
    if (bd_admin()) return true;
    if (!bd_is_creator($a)) return false;
    return bd_is_flash($a) || bd_statut($a) !== 'publie';
}
// Lecture : publié pour tous ; soumis pour l'auteur et les admins ; brouillon pour l'auteur seul.
function bd_can_see(array $a): bool {
    $s = bd_statut($a);
    if ($s === 'publie' || bd_is_creator($a)) return true;
    return $s === 'soumis' && bd_admin();
}

// Ordre de lecture de la saga : date de la soirée, puis date de création.
function bd_sort(array &$albums): void {
    usort($albums, function ($x, $y) {
        return [($x['date'] ?? ''), ($x['cree_le'] ?? '')] <=> [($y['date'] ?? ''), ($y['cree_le'] ?? '')];
    });
}

// Vue envoyée au client. Le numéro d'épisode ne compte que les histoires publiées
// (sur TOUTES les histoires, pas seulement celles visibles) : une histoire en
// cours ne décale jamais la numérotation que tout le monde voit.
function bd_view(array $albums, array $series = []): array {
    bd_sort($albums);
    $noms = [];
    foreach ($series as $se) $noms[$se['id']] = $se['nom'];
    // Parties : rang parmi les BD publiées de la série (ordre de la saga).
    $partie = []; $total = [];
    foreach ($albums as $a) {
        $sid = (string)($a['serie'] ?? '');
        if ($sid === '' || !isset($noms[$sid]) || bd_statut($a) !== 'publie' || bd_is_flash($a)) continue;
        $total[$sid] = ($total[$sid] ?? 0) + 1;
        $partie[$a['id']] = $total[$sid];
    }
    $out = [];
    $n = 0;
    foreach ($albums as $a) {
        // Les flash ne comptent pas dans les épisodes de la saga BD.
        $pub = bd_statut($a) === 'publie' && !bd_is_flash($a);
        $num = $pub ? ++$n : null;
        if (!bd_can_see($a)) continue;
        $sid = (string)($a['serie'] ?? '');
        if ($sid !== '' && isset($noms[$sid])) {
            $a['serie_nom'] = $noms[$sid];
            $a['partie'] = $partie[$a['id']] ?? null;
            $a['serie_total'] = $total[$sid] ?? 0;
        } else unset($a['serie']);
        $a['statut'] = bd_statut($a);
        $a['type'] = bd_is_flash($a) ? 'flash' : 'bd';
        $a['numero'] = $num;
        $a['mien'] = bd_is_creator($a);
        $a['peut_modifier'] = bd_can_edit($a);
        $a['peut_supprimer'] = bd_can_delete($a);
        unset($a['createur_discord']);
        $out[] = $a;
    }
    return $out;
}

// Clé de comparaison d'un nom de série : casse (ASCII, pas de mbstring) et espaces ignorés.
function bd_serie_cle(string $nom): string { return strtolower(preg_replace('/\s+/u', ' ', trim($nom))); }

// Séries que l'utilisateur courant peut voir : celles d'au moins une histoire qu'il voit.
// Un ADMIN les voit toutes (dès qu'une histoire y est rattachée) : sinon il ne pourrait pas
// ranger dans « Le Sable Rose » l'histoire qu'il valide quand cette série n'existe encore
// que dans des brouillons de joueurs — constaté en test. Les joueurs, eux, ne voient pas le
// nom d'une série tant qu'il n'a été écrit que dans le brouillon d'un autre.
function bd_series_visibles(array $d): array {
    $ids = [];
    foreach ($d['albums'] as $a) { if (!empty($a['serie']) && (bd_admin() || bd_can_see($a))) $ids[$a['serie']] = true; }
    $out = [];
    foreach ($d['series'] as $se) {
        if (!isset($ids[$se['id']])) continue;
        $pub = 0;
        foreach ($d['albums'] as $a) { if (($a['serie'] ?? '') === $se['id'] && bd_statut($a) === 'publie' && !bd_is_flash($a)) $pub++; }
        $out[] = ['id' => $se['id'], 'nom' => $se['nom'], 'publiees' => $pub];
    }
    usort($out, function ($x, $y) { return strcasecmp($x['nom'], $y['nom']); });
    return $out;
}

// Choix de série envoyé par la page → id de série (ou '' = histoire isolée).
//   serie = '' | 'se_…' (existante et visible) ; serie_nouvelle = nom d'une série à créer.
// Doit tourner SOUS le verrou ($d par référence) : la série créée est écrite avec l'histoire.
function bd_serie_resolve(array &$d, string $choix, string $nouvelle): string {
    $nouvelle = bd_cut($nouvelle, 80);
    if ($nouvelle !== '') {
        $cle = bd_serie_cle($nouvelle);
        foreach ($d['series'] as $se) { if (bd_serie_cle($se['nom']) === $cle) return $se['id']; } // pas de doublon
        $id = 'se_' . bin2hex(random_bytes(4));
        $d['series'][] = ['id' => $id, 'nom' => $nouvelle, 'cree_par' => epice_user(), 'cree_le' => date('c')];
        return $id;
    }
    if ($choix === '') return '';
    foreach (bd_series_visibles($d) as $se) { if ($se['id'] === $choix) return $choix; }
    throw new RuntimeException('Série introuvable.');
}

function bd_rm_files(string $albumId, array $pages): void {
    $dir = bd_pages_dir($albumId);
    foreach ($pages as $p) {
        foreach (['src', 'thumb'] as $k) {
            $f = __DIR__ . '/' . (string)($p[$k] ?? '');
            if (($p[$k] ?? '') !== '' && strpos(realpath($f) ?: '', realpath($dir) ?: "\0") === 0) @unlink($f);
        }
    }
}

// Valide un fichier envoyé : vraie image (signature lue, pas l'extension déclarée).
function bd_check_upload(string $field): array {
    $f = $_FILES[$field] ?? null;
    if (!$f || !is_array($f) || ($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        $code = is_array($f) ? (int)($f['error'] ?? -1) : -1;
        $msg = in_array($code, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)
            ? 'Image trop lourde pour la configuration PHP du serveur (upload_max_filesize).'
            : 'Image manquante ou envoi interrompu.';
        throw new RuntimeException($msg);
    }
    if ((int)$f['size'] > BD_MAX_OCTETS) throw new RuntimeException('Image trop lourde (12 Mo maximum).');
    $info = @getimagesize($f['tmp_name']);
    if (!$info || !isset(BD_TYPES[$info[2]])) throw new RuntimeException('Format non reconnu : JPEG, PNG ou WebP uniquement.');
    return ['tmp' => $f['tmp_name'], 'ext' => BD_TYPES[$info[2]], 'w' => (int)$info[0], 'h' => (int)$info[1]];
}

// Range une image validée (+ vignette) dans bd/pages/<histoire>/ et renvoie l'entrée de page.
// À appeler sous le verrou : l'entrée n'est ajoutée au JSON que si le fichier est bien écrit.
function bd_store(string $id, array $page, ?array $thumb): array {
    $pid = bin2hex(random_bytes(6));
    $rel = 'pages/' . $id . '/';
    $entry = [
        'id'    => $pid,
        'src'   => $rel . $pid . '.' . $page['ext'],
        'thumb' => $thumb ? $rel . $pid . '_t.' . $thumb['ext'] : $rel . $pid . '.' . $page['ext'],
        'w'     => $page['w'],
        'h'     => $page['h'],
    ];
    $dir = bd_pages_dir($id);
    if (!is_dir($dir) && !@mkdir($dir, 0775, true)) throw new RuntimeException("Dossier bd/pages non inscriptible (www-data doit pouvoir y écrire).");
    if (!move_uploaded_file($page['tmp'], __DIR__ . '/' . $entry['src'])) throw new RuntimeException("Écriture de l'image impossible.");
    if ($thumb) @move_uploaded_file($thumb['tmp'], __DIR__ . '/' . $entry['thumb']);
    return $entry;
}

// Annonce Discord d'une histoire publiée, UNE fois (drapeau `annonce_le`). Ne bloque
// jamais la publication : renvoie ['annonce' => 'ok'] ou ['annonce_erreur' => motif],
// que la page affiche à celui qui vient de publier.
function bd_annonce_id(string $id): array {
    $a = null;
    $d = bd_read();
    foreach (bd_view($d['albums'], $d['series']) as $x) { if ($x['id'] === $id) { $a = $x; break; } }
    if (!$a || $a['statut'] !== 'publie') return ['annonce_erreur' => "l'histoire n'est pas publiée"];
    if (!empty($a['annonce_le'])) return ['annonce_erreur' => 'déjà annoncée'];
    $err = bd_annoncer($a, BD_LIEUX);
    if ($err !== '') return ['annonce_erreur' => $err];
    bd_mutate(function (&$d) use ($id) {
        $i = bd_find($d, $id);
        if ($i !== null) $d['albums'][$i]['annonce_le'] = date('c');
    });
    return ['annonce' => 'ok'];
}

// Applique $fn à l'histoire $id sous verrou, après contrôle de droit $check.
function bd_on(string $id, callable $check, callable $fn) {
    return bd_mutate(function (&$d) use ($id, $check, $fn) {
        $i = bd_find($d, $id);
        if ($i === null || !bd_can_see($d['albums'][$i])) throw new RuntimeException('Histoire introuvable.');
        $msg = $check($d['albums'][$i]);
        if ($msg !== true) throw new RuntimeException((string)$msg);
        $ret = $fn($d['albums'][$i], $d); // $d par référence si la fonction le demande
        $d['albums'][$i]['modifie_le'] = date('c');
        return $ret;
    });
}
function bd_edit_check(array $a) {
    if (bd_can_edit($a)) return true;
    return bd_statut($a) === 'soumis'
        ? "Histoire en attente de validation : annule la soumission pour la modifier."
        : "Histoire publiée : seuls les admins peuvent la modifier.";
}

// Les actions propres aux BD refusent une flash (voie unique : flash_save).
if (in_array($action, ['save', 'upload', 'reorder', 'delete_page', 'soumettre', 'retirer', 'publier'], true)) {
    $cible = (string)($_GET['id'] ?? (bd_in()['id'] ?? ''));
    if ($cible !== '') {
        foreach (bd_read()['albums'] as $x) {
            if (($x['id'] ?? '') === $cible && bd_is_flash($x)) bd_out(false, [], 'Une histoire flash se modifie depuis sa fiche.');
        }
    }
}

// ============================================================
switch ($action) {

case 'list': {
    $BD_APERCU = ($_GET['apercu'] ?? '') === '1';
    bd_out(true, [
        'albums'    => bd_view(($d = bd_read())['albums'], $d['series']),
        'series'    => bd_series_visibles($d),
        'est_admin' => bd_admin(),
        'moi'       => epice_user(),
        'max_brouillons' => BD_MAX_BROUILLON,
        'lieux'     => BD_LIEUX,
    ]);
}

// Compteur des histoires en attente (pastille de la tuile du menu + onglet).
case 'a_valider': {
    $n = 0;
    if (bd_admin()) foreach (bd_read()['albums'] as $a) { if (bd_statut($a) === 'soumis') $n++; }
    bd_out(true, ['count' => $n]);
}

// Crée (sans id) ou met à jour (avec id) le TEXTE d'une histoire. Ne change
// jamais le statut : les transitions ont chacune leur action.
case 'save': {
    $in = bd_in();
    $titre = bd_cut($in['titre'] ?? '', 120);
    if ($titre === '') bd_out(false, [], 'Il faut un titre.');
    $date = (string)($in['date'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) $date = date('Y-m-d');
    $persos = [];
    foreach ((array)($in['personnages'] ?? []) as $p) {
        $p = bd_cut($p, 40);
        if ($p !== '' && !in_array($p, $persos, true)) $persos[] = $p;
        if (count($persos) >= 30) break;
    }
    $fields = [
        'titre'       => $titre,
        'sous_titre'  => bd_cut($in['sous_titre'] ?? '', 160),
        'date'        => $date,
        'recit'       => bd_cut($in['recit'] ?? '', 20000),
        'personnages' => $persos,
    ];
    $id = (string)($in['id'] ?? '');
    $serieChoix = (string)($in['serie'] ?? '');
    $serieNouv  = (string)($in['serie_nouvelle'] ?? '');
    if ($id === '') {
        $a = bd_mutate(function (&$d) use ($fields, $serieChoix, $serieNouv) {
            if (!bd_admin()) {
                $n = 0;
                foreach ($d['albums'] as $x) { if (bd_is_creator($x) && !bd_is_flash($x) && bd_statut($x) !== 'publie') $n++; }
                if ($n >= BD_MAX_BROUILLON) {
                    throw new RuntimeException("Tu as déjà " . BD_MAX_BROUILLON . " histoires en cours (brouillon ou en attente) : termine ou supprime l'une d'elles d'abord.");
                }
            }
            $fields['serie'] = bd_serie_resolve($d, $serieChoix, $serieNouv);
            $a = $fields + [
                'id'               => 'ep_' . date('Ymd') . '_' . bin2hex(random_bytes(4)),
                'statut'           => 'brouillon',
                'pages'            => [],
                'createur'         => epice_user(),
                'createur_discord' => (string)($_SESSION['discord_id'] ?? ''),
                'cree_le'          => date('c'),
            ];
            $d['albums'][] = $a;
            return $a;
        });
        bd_out(true, ['id' => $a['id']]);
    }
    bd_on($id, 'bd_edit_check', function (&$a, &$d) use ($fields, $serieChoix, $serieNouv) {
        $fields['serie'] = bd_serie_resolve($d, $serieChoix, $serieNouv);
        $a = array_merge($a, $fields);
    });
    bd_out(true, ['id' => $id]);
}

// Ajoute UNE planche (champ `page`) et sa vignette (champ `thumb`, facultatif)
// à la fin de l'histoire ?id=…
case 'upload': {
    $id = (string)($_GET['id'] ?? '');
    if (!bd_id_ok($id)) bd_out(false, [], 'Histoire invalide.');
    try {
        $page  = bd_check_upload('page');
        $thumb = isset($_FILES['thumb']) ? bd_check_upload('thumb') : null;
    } catch (RuntimeException $e) { bd_out(false, [], $e->getMessage()); }

    $res = bd_on($id, 'bd_edit_check', function (&$a) use ($id, $page, $thumb) {
        if (count($a['pages'] ?? []) >= BD_MAX_PAGES) throw new RuntimeException('Limite de ' . BD_MAX_PAGES . ' planches atteinte.');
        $entry = bd_store($id, $page, $thumb);
        $a['pages'][] = $entry;
        return [$entry, count($a['pages'])];
    });
    bd_out(true, ['page' => $res[0], 'nb_pages' => $res[1]]);
}

case 'reorder': {
    $in = bd_in();
    $ordre = array_values(array_map('strval', (array)($in['ordre'] ?? [])));
    bd_on((string)($in['id'] ?? ''), 'bd_edit_check', function (&$a) use ($ordre) {
        $par = [];
        foreach ($a['pages'] ?? [] as $p) $par[$p['id']] = $p;
        // L'ordre reçu doit contenir exactement les planches présentes : une page
        // restée ouverte sur une copie périmée ne doit ni perdre ni dupliquer de planche.
        $x = array_keys($par); $y = $ordre; sort($x); sort($y);
        if ($x !== $y) throw new RuntimeException("La liste des planches a changé entre-temps : recharge la page.");
        $a['pages'] = array_map(function ($pid) use ($par) { return $par[$pid]; }, $ordre);
    });
    bd_out(true);
}

case 'delete_page': {
    $in = bd_in();
    $id = (string)($in['id'] ?? '');
    $pid = (string)($in['page'] ?? '');
    $gone = bd_on($id, 'bd_edit_check', function (&$a) use ($pid) {
        $keep = []; $gone = [];
        foreach ($a['pages'] ?? [] as $p) { if ($p['id'] === $pid) $gone[] = $p; else $keep[] = $p; }
        if (!$gone) throw new RuntimeException('Planche introuvable.');
        if (!$keep && bd_statut($a) !== 'brouillon') {
            throw new RuntimeException("C'est la dernière planche d'une histoire publiée ou soumise : repasse-la en brouillon d'abord.");
        }
        $a['pages'] = $keep;
        return $gone;
    });
    bd_rm_files($id, $gone);
    bd_out(true);
}

case 'delete': {
    $id = (string)(bd_in()['id'] ?? '');
    $album = bd_mutate(function (&$d) use ($id) {
        $i = bd_find($d, $id);
        if ($i === null || !bd_can_see($d['albums'][$i])) throw new RuntimeException('Histoire introuvable.');
        $a = $d['albums'][$i];
        if (!bd_can_delete($a)) {
            throw new RuntimeException(bd_is_flash($a) ? "Seuls l'auteur ou un admin peuvent supprimer cette flash."
                                                       : "Histoire publiée : seul un admin peut la supprimer.");
        }
        array_splice($d['albums'], $i, 1);
        return $a;
    });
    bd_rm_files($id, $album['pages'] ?? []);
    if (bd_id_ok($id)) @rmdir(bd_pages_dir($id));
    bd_out(true);
}

// ---- Transitions de statut -------------------------------------------------

// Auteur : brouillon → soumis.
case 'soumettre': {
    bd_on((string)(bd_in()['id'] ?? ''), function ($a) {
        if (!bd_is_creator($a) && !bd_admin()) return "Seul l'auteur peut soumettre son histoire.";
        if (bd_statut($a) !== 'brouillon') return "Cette histoire n'est pas un brouillon.";
        if (empty($a['pages'])) return 'Ajoute au moins une planche avant de soumettre.';
        return true;
    }, function (&$a) {
        $a['statut'] = 'soumis';
        $a['soumis_le'] = date('c');
        unset($a['motif_renvoi'], $a['renvoye_le'], $a['renvoye_par']);
    });
    bd_out(true);
}

// Auteur : soumis → brouillon (il veut encore retoucher).
case 'retirer': {
    bd_on((string)(bd_in()['id'] ?? ''), function ($a) {
        if (!bd_is_creator($a)) return "Seul l'auteur peut annuler sa soumission.";
        return bd_statut($a) === 'soumis' ? true : "Cette histoire n'est pas en attente.";
    }, function (&$a) { $a['statut'] = 'brouillon'; unset($a['soumis_le']); });
    bd_out(true);
}

// Admin : → publie.
case 'publier': {
    bd_on((string)(bd_in()['id'] ?? ''), function ($a) {
        if (!bd_admin()) return 'Seuls les admins publient.';
        if (bd_statut($a) === 'publie') return 'Déjà publiée.';
        return empty($a['pages']) ? 'Impossible de publier une histoire sans planche.' : true;
    }, function (&$a) {
        $a['statut'] = 'publie';
        $a['publie_le'] = date('c');
        $a['publie_par'] = epice_user();
        unset($a['motif_renvoi'], $a['renvoye_le'], $a['renvoye_par'], $a['soumis_le']);
    });
    // Une BD dépubliée puis republiée n'est pas réannoncée (annonce_le conservé).
    $pid = (string)(bd_in()['id'] ?? '');
    $deja = false;
    foreach (bd_read()['albums'] as $x) { if (($x['id'] ?? '') === $pid && !empty($x['annonce_le'])) $deja = true; }
    bd_out(true, $deja ? [] : bd_annonce_id($pid));
}

// Admin : soumis/publie → brouillon, avec un motif que l'auteur lira.
case 'renvoyer': {
    $in = bd_in();
    $motif = bd_cut($in['motif'] ?? '', 600);
    if ($motif === '') bd_out(false, [], "Indique à l'auteur ce qu'il doit revoir.");
    bd_on((string)($in['id'] ?? ''), function ($a) {
        if (!bd_admin()) return 'Seuls les admins renvoient une histoire.';
        return bd_statut($a) === 'brouillon' ? "C'est déjà un brouillon." : true;
    }, function (&$a) use ($motif) {
        $a['statut'] = 'brouillon';
        $a['motif_renvoi'] = $motif;
        $a['renvoye_le'] = date('c');
        $a['renvoye_par'] = epice_user();
        unset($a['soumis_le']);
    });
    bd_out(true);
}

// Admin : annonce manuelle d'une histoire publiée jamais annoncée (rattrapage d'un
// échec, ou histoire publiée avant que l'annonce existe).
case 'annoncer': {
    if (!bd_admin()) bd_out(false, [], 'Réservé aux admins.');
    $r = bd_annonce_id((string)(bd_in()['id'] ?? ''));
    if (isset($r['annonce_erreur'])) bd_out(false, [], 'Annonce non envoyée : ' . $r['annonce_erreur'] . '.');
    bd_out(true, $r);
}

// Admin : renommer une série. Un nom déjà pris par une autre série est refusé
// (il faut alors fusionner, sinon on aurait deux séries indiscernables).
case 'serie_renommer': {
    if (!bd_admin()) bd_out(false, [], 'Réservé aux admins.');
    $in = bd_in();
    $sid = (string)($in['id'] ?? '');
    $nom = bd_cut($in['nom'] ?? '', 80);
    if ($nom === '') bd_out(false, [], 'Il faut un nom.');
    bd_mutate(function (&$d) use ($sid, $nom) {
        $i = null;
        foreach ($d['series'] as $k => $se) {
            if ($se['id'] === $sid) $i = $k;
            elseif (bd_serie_cle($se['nom']) === bd_serie_cle($nom)) throw new RuntimeException("La série « {$se['nom']} » existe déjà : fusionne plutôt les deux.");
        }
        if ($i === null) throw new RuntimeException('Série introuvable.');
        $d['series'][$i]['nom'] = $nom;
    });
    bd_out(true);
}

// Admin : fusionner la série `source` dans `cible` (ses histoires y passent, la source disparaît).
case 'serie_fusionner': {
    if (!bd_admin()) bd_out(false, [], 'Réservé aux admins.');
    $in = bd_in();
    $src = (string)($in['source'] ?? '');
    $dst = (string)($in['cible'] ?? '');
    if ($src === '' || $src === $dst) bd_out(false, [], 'Choisis deux séries différentes.');
    $n = bd_mutate(function (&$d) use ($src, $dst) {
        $ids = array_column($d['series'], 'id');
        if (!in_array($src, $ids, true) || !in_array($dst, $ids, true)) throw new RuntimeException('Série introuvable.');
        $n = 0;
        foreach ($d['albums'] as &$a) { if (($a['serie'] ?? '') === $src) { $a['serie'] = $dst; $n++; } }
        unset($a);
        $d['series'] = array_values(array_filter($d['series'], function ($se) use ($src) { return $se['id'] !== $src; }));
        return $n;
    });
    bd_out(true, ['deplacees' => $n]);
}

// Histoire flash : crée (sans id) ou met à jour, image facultative en mise à jour.
// Multipart : titre, description, date, lieu, personnages (« a, b, c »), page + thumb.
// Toujours (re)publiée : c'est la règle, une fiche complète paraît directement.
case 'flash_save': {
    $id     = (string)($_POST['id'] ?? '');
    $titre  = bd_cut($_POST['titre'] ?? '', 120);
    $recit  = bd_cut($_POST['description'] ?? '', 4000);
    $date   = (string)($_POST['date'] ?? '');
    $lieu   = (string)($_POST['lieu'] ?? '');
    $persos = [];
    foreach (explode(',', (string)($_POST['personnages'] ?? '')) as $p) {
        $p = bd_cut($p, 40);
        if ($p !== '' && !in_array($p, $persos, true)) $persos[] = $p;
        if (count($persos) >= 30) break;
    }
    $img = $thumb = null;
    if (isset($_FILES['page'])) {
        try {
            $img   = bd_check_upload('page');
            $thumb = isset($_FILES['thumb']) ? bd_check_upload('thumb') : null;
        } catch (RuntimeException $e) { bd_out(false, [], $e->getMessage()); }
    }
    // « Fiche non complétée, on ne peut pas proposer » : la règle vit côté serveur.
    $manque = [];
    if ($id === '' && !$img) $manque[] = 'une image';
    if ($titre === '') $manque[] = 'un titre';
    if ($recit === '') $manque[] = 'une description';
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $dm) || !checkdate((int)$dm[2], (int)$dm[3], (int)$dm[1])) $manque[] = 'la date du moment';
    if (!isset(BD_LIEUX[$lieu])) $manque[] = "le lieu ou l'activité";
    if ($manque) bd_out(false, [], 'Fiche incomplète : il manque ' . implode(', ', $manque) . '.');

    $fields = ['titre' => $titre, 'recit' => $recit, 'date' => $date, 'lieu' => $lieu, 'personnages' => $persos];
    $serieChoix = (string)($_POST['serie'] ?? '');
    $serieNouv  = (string)($_POST['serie_nouvelle'] ?? '');

    if ($id === '') {
        $new = 'fl_' . date('Ymd') . '_' . bin2hex(random_bytes(4));
        bd_mutate(function (&$d) use ($new, $fields, $img, $thumb, $serieChoix, $serieNouv) {
            $fields['serie'] = bd_serie_resolve($d, $serieChoix, $serieNouv);
            $d['albums'][] = $fields + [
                'id'               => $new,
                'type'             => 'flash',
                'statut'           => 'publie',
                'pages'            => [bd_store($new, $img, $thumb)],
                'createur'         => epice_user(),
                'createur_discord' => (string)($_SESSION['discord_id'] ?? ''),
                'cree_le'          => date('c'),
                'publie_le'        => date('c'),
            ];
        });
        // Annonce à la CRÉATION seulement : modifier ou republier une flash ne reposte rien.
        bd_out(true, ['id' => $new] + bd_annonce_id($new));
    }

    $old = bd_mutate(function (&$d) use ($id, $fields, $img, $thumb, $serieChoix, $serieNouv) {
        $i = bd_find($d, $id);
        if ($i === null || !bd_can_see($d['albums'][$i]) || !bd_is_flash($d['albums'][$i])) throw new RuntimeException('Histoire flash introuvable.');
        $a = &$d['albums'][$i];
        if (!bd_can_edit($a)) throw new RuntimeException("Seuls l'auteur ou un admin peuvent modifier cette flash.");
        $fields['serie'] = bd_serie_resolve($d, $serieChoix, $serieNouv);
        $old = [];
        if ($img) { $old = $a['pages'] ?? []; $a['pages'] = [bd_store($id, $img, $thumb)]; }
        $a = array_merge($a, $fields, ['statut' => 'publie', 'modifie_le' => date('c')]);
        if (empty($a['publie_le'])) $a['publie_le'] = date('c');
        unset($a['motif_renvoi'], $a['renvoye_le'], $a['renvoye_par']);
        return $old;
    });
    bd_rm_files($id, $old); // image remplacée : l'ancienne ne sert plus à rien
    bd_out(true, ['id' => $id]);
}
}
