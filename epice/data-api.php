<?php
require_once __DIR__ . '/auth_epice.php'; // session + helpers de droits
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

$action = $_GET['action'] ?? '';

// Lire le body UNE seule fois (php://input n'est lisible qu'une fois)
$raw   = file_get_contents('php://input');
$input = json_decode($raw, true) ?? [];

// --- Contrôle d'accès serveur (basé sur la session du site, plus de token en dur) ---
$organize_actions = ['list', 'open_sorties', 'new_soiree', 'close_soiree', 'reopen_sortie', 'save_assign', 'save_analyse', 'history', 'sortie_detail', 'delete_sortie', 'save_sop_content', 'role_stats', 'save_presence', 'publish_shares'];
$member_actions   = ['init', 'get_assign', 'my_debrief', 'save_debrief', 'public_history', 'public_sortie', 'me', 'my_activity', 'get_sop_content'];
$admin_only       = ['get_orga', 'set_orga', 'activity_report'];
if      (in_array($action, $admin_only, true))       epice_require_admin();
elseif  (in_array($action, $organize_actions, true)) epice_require_organize();
elseif  (in_array($action, $member_actions, true))   epice_require_login();

$data_dir = __DIR__ . '/data';
if (!is_dir($data_dir)) mkdir($data_dir, 0755, true);
define('DATA_FILE', $data_dir . '/debriefs.json');

function read_data(): array {
    if (!file_exists(DATA_FILE)) return ['soiree_active' => null, 'sorties' => []];
    return json_decode(file_get_contents(DATA_FILE), true)
        ?? ['soiree_active' => null, 'sorties' => []];
}

// Acquiert un verrou exclusif en NON bloquant, avec quelques retries courts, plutôt qu'un
// flock() classique qui peut bloquer indéfiniment si un autre process (ex : le bot Discord
// discord_sortie.php, qui partage ce même fichier) tient le verrou trop longtemps.
function try_lock($fp, $maxWaitSeconds = 1.5) {
    $deadline = microtime(true) + $maxWaitSeconds;
    do {
        if (flock($fp, LOCK_EX | LOCK_NB)) return true;
        usleep(50000); // 50ms
    } while (microtime(true) < $deadline);
    return false;
}

function write_data(array $data): void {
    $fp = @fopen(DATA_FILE, 'c+');
    if (!$fp) out(false, [], "Écriture impossible : droits insuffisants sur data/debriefs.json (le serveur web — www-data — doit pouvoir écrire le fichier).");
    if (!try_lock($fp)) { fclose($fp); out(false, [], "Fichier de sorties occupé (accès concurrent). Réessaie dans quelques secondes."); }
    ftruncate($fp, 0); rewind($fp);
    $ok = fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) !== false;
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    if (!$ok) out(false, [], "Écriture impossible dans data/debriefs.json (droits serveur).");
}

function out(bool $ok, array $payload = [], string $err = ''): void {
    echo json_encode(
        $ok ? array_merge(['ok' => true], $payload) : ['ok' => false, 'error' => $err],
        JSON_UNESCAPED_UNICODE
    );
    exit;
}

// Minuscule insensible à la casse, sans dépendre de l'extension mbstring (absente sur ce serveur)
function lc($s): string {
    return function_exists('mb_strtolower') ? mb_strtolower((string)$s) : strtolower((string)$s);
}

// Renvoie l'id de la sortie "vedette" à utiliser pour toute action grand-public
// (Retour joueur, Manuel de combat, mise à jour de retour…). Ne dépend PLUS strictement
// de `soiree_active` : si ce miroir est nul, obsolète ou pointe vers une sortie disparue,
// on retombe automatiquement sur la sortie OUVERTE la plus récente. Retourne '' si aucune.
//
// Ce miroir a un historique d'incohérence (suppression manuelle, race, ancien code sans
// fallback dans close_soiree/delete_sortie…). Plutôt que d'attendre qu'il soit toujours
// juste, on le vérifie et on répare à la volée pour ne jamais bloquer un retour joueur
// alors qu'il y a bien une sortie ouverte visible dans le sélecteur d'assignation.
function active_sortie_id(array $d): string {
    $activeId = $d['soiree_active']['id'] ?? '';
    if ($activeId !== '') {
        foreach ($d['sorties'] as $s) {
            if (($s['id'] ?? '') === $activeId && ($s['statut'] ?? '') === 'ouverte') {
                return $activeId; // le miroir est bon, rien à faire
            }
        }
    }
    // Miroir cassé (null / sortie disparue / clôturée) → on prend la plus récente ouverte.
    foreach (array_reverse($d['sorties']) as $s) {
        if (($s['statut'] ?? '') === 'ouverte') return $s['id'] ?? '';
    }
    return '';
}

// ---- Partage de la récolte au prorata de la présence -------------------------
// Un relevé toutes les 30 min dans le salon vocal ; présent = 1 point. La valeur d'un
// point est le volume divisé par le total des points — ce qui rend la répartition
// indifférente au nombre de participants, celui-ci pouvant varier d'une demi-heure à
// l'autre sur une journée en relève.
//
// Cette fonction est le SEUL endroit où les parts sont calculées : l'écran d'admin et
// le message Discord la partagent. Deux calculs séparés finiraient par se contredire,
// et c'est précisément sur ce chiffre-là qu'on ne peut pas se permettre un doute.
function parts_presence(array $s): array {
    $p      = $s['presence'] ?? [];
    $ticks  = is_array($p['ticks'] ?? null) ? $p['ticks'] : [];
    $noms   = is_array($p['noms']  ?? null) ? $p['noms']  : [];
    $volume = max(0, (int)($p['volume'] ?? 0));

    $points = [];
    foreach ($ticks as $ids) {
        // array_unique : la présence est un booléen par demi-heure, pas un compteur.
        // Le relevé et la sauvegarde dédoublonnent déjà, mais c'est ICI que le chiffre
        // devient des ressources dans une poche — la fonction ne doit dépendre de la
        // propreté de personne.
        foreach (array_unique(array_map('strval', (array)$ids)) as $id) {
            if ($id === '') continue;
            $points[$id] = ($points[$id] ?? 0) + 1;
        }
    }
    $total = array_sum($points);

    $lignes = [];
    foreach ($points as $id => $pts) {
        // Arrondi à la centaine INFÉRIEURE : la petite raffinerie consomme par lots de
        // 100, une part de 7 437 laisserait 37 unités inutilisables chez son
        // propriétaire. Le reliquat retourne au pot commun.
        $brut = $total > 0 ? ($volume * $pts / $total) : 0;
        $lignes[] = [
            'id'     => $id,
            'nom'    => (string)($noms[$id] ?? $id),
            'points' => $pts,
            'part'   => (int)(floor($brut / 100) * 100),
        ];
    }
    usort($lignes, function ($a, $b) {
        return ($b['points'] <=> $a['points']) ?: strcasecmp($a['nom'], $b['nom']);
    });

    $distribue = 0;
    foreach ($lignes as $l) $distribue += $l['part'];
    return [
        'lignes'       => $lignes,
        'total_points' => $total,
        'volume'       => $volume,
        'par_point'    => $total > 0 ? round($volume / $total, 1) : 0,
        'distribue'    => $distribue,
        'reliquat'     => max(0, $volume - $distribue),
        'nb_ticks'     => count($ticks),
    ];
}

// Message Discord de répartition. Le bloc de code garde l'alignement des colonnes ;
// un message Discord plafonne à 2000 caractères, d'où la troncature au-delà de 40 noms
// (un message rejeté le serait EN ENTIER, cf. le tableau de couverture des rallys).
function message_parts(array $s, array $r): string {
    $nl    = chr(10);
    $titre = trim((string)($s['titre'] ?? 'Sortie'));
    $fmt   = function ($n) { return number_format($n, 0, ',', ' '); };

    $t  = '🌾 **Partage de l’épice — ' . $titre . '**' . $nl;
    $t .= trim(($s['date'] ?? '') . ' · ' . ($s['heure'] ?? ''), ' ·') . $nl . $nl;
    $t .= 'Relevé automatique toutes les 30 minutes dans le salon vocal. Présent = 1 point.' . $nl . $nl;
    $t .= 'Récolte : **' . $fmt($r['volume']) . '** · **' . $fmt($r['total_points']) . ' points** au total · '
        . '**' . $fmt($r['par_point']) . '** par point' . $nl . $nl;

    // Le pied est construit AVANT le tableau : son poids doit être retranché du budget.
    $pied = '```' . $nl;
    if ($r['reliquat'] > 0)
        $pied .= '*Les parts sont arrondies à la centaine inférieure (le raffinage consomme par lots de 100). '
               . 'Reliquat de ' . $fmt($r['reliquat']) . ' au pot commun.*' . $nl;
    $pied .= '*Aucun prélèvement : ornis, roquettes et buggys restent à la charge de la guilde.*';

    // ⚠ str_pad() compte des OCTETS. « Lorhelyne✨ » pèse trois octets de plus qu'il
    // n'occupe de colonnes, et sa ligne se décalait. Sans mbstring (absente de ce
    // serveur), on approche la largeur d'affichage en comptant les points de code :
    // les octets de continuation UTF-8 (0x80-0xBF) ne sont pas des caractères.
    // Limite assumée : un emoji est souvent rendu sur DEUX colonnes, donc une ligne
    // qui en contient peut encore dériver d'un cran — au lieu de trois.
    $larg = function ($x) { return strlen(preg_replace('/[\x80-\xBF]/', '', $x)); };
    $padd = function ($x, $n) use ($larg) { $m = $n - $larg($x); return $x . ($m > 0 ? str_repeat(' ', $m) : ''); };
    $padg = function ($x, $n) use ($larg) { $m = $n - $larg($x); return ($m > 0 ? str_repeat(' ', $m) : '') . $x; };

    // Colonnes resserrées à 35 caractères : un bloc de code Discord ne se replie pas,
    // il défile horizontalement. Sur téléphone, 43 caractères obligeaient déjà à
    // faire glisser le tableau pour lire la colonne des parts.
    $t .= '```' . $nl;
    $t .= $padd('Joueur', 18) . $padg('Points', 7) . $padg('Part', 10) . $nl;
    $t .= str_repeat('-', 35) . $nl;

    // Troncature sur le BUDGET RÉEL, en octets, et non sur un nombre de lignes : un
    // message Discord plafonne à 2000 caractères et il est rejeté EN ENTIER au-delà.
    // Deux erreurs successives ici : d'abord une limite à 40 lignes (40 pseudos longs
    // = 2100 octets), puis un budget fixe de 1750 qui ignorait le poids de l'en-tête
    // et des caractères multi-octets (─ et … pèsent 3 octets chacun). Le budget se
    // MESURE, il ne s'estime pas.
    $budget = 1900 - strlen($t) - strlen($pied);
    $n = 0;
    foreach ($r['lignes'] as $l) {
        // strlen() et non mb_strlen() : pas de mbstring sur ce serveur (cf. AGENTS.md).
        // On coupe sur les octets, donc un pseudo accentué est tronqué un cheveu plus
        // tôt — sans conséquence pour un alignement de colonnes.
        // Troncature sur les points de code, pas sur les octets : couper « Lorhelyne✨ »
        // au milieu de son emoji produirait des octets invalides dans le message.
        $nom = $l['nom'];
        while ($larg($nom) > 17) $nom = preg_replace('/.$/us', '', $nom);
        if ($nom !== $l['nom']) $nom .= '…';
        $ligne = $padd($nom, 18) . $padg((string)$l['points'], 7)
               . $padg($fmt($l['part']), 10) . $nl;
        $queue = '… et ' . (count($r['lignes']) - $n) . ' autres, détail sur le site' . $nl;
        if (strlen($ligne) + strlen($queue) > $budget) { $t .= $queue; break; }
        $t .= $ligne;
        $budget -= strlen($ligne);
        $n++;
    }
    return $t . $pied;
}

// ---- Compos par créneau (rallys) --------------------------------------------
// Le créneau 0 — et toute sortie qui n'est PAS un rally — vit dans `assignation`,
// les créneaux suivants dans `assignations`. Asymétrique à dessein : les lecteurs
// historiques (Manuel de combat, historique, liste des participants, `a_compo`)
// n'ont rien à apprendre sur les rallys, et surtout chaque compo n'est stockée
// qu'à UN endroit. Recopier le créneau 0 dans les deux champs pour faire joli
// ouvrirait exactement la divergence qu'on passe son temps à traquer ailleurs.
function sortie_compo($s, $i) {
    $i = (int)$i;
    if ($i <= 0) return $s['assignation'] ?? null;
    return $s['assignations'][$i] ?? null;
}

// Toutes les compos réellement posées, créneau 0 compris.
function sortie_compos($s): array {
    $out = [];
    if (!empty($s['assignation'])) $out[] = $s['assignation'];
    foreach (($s['assignations'] ?? []) as $c) if (!empty($c)) $out[] = $c;
    return $out;
}

// ---- Habitudes de poste ------------------------------------------------------
// Clé de rapprochement entre un pseudo Discord et un pseudo tapé à la main dans une
// vieille compo : « Lorhelyne✨ » et « Lorhelyne » doivent se retrouver, « Sté » et
// « Sté » aussi. On ne garde que [a-z0-9] — sur une chaîne UTF-8 cela retire les
// emojis, les accents et la ponctuation en travaillant sur les OCTETS, donc sans
// mbstring (absente de ce serveur, cf. AGENTS.md). Appliqué des DEUX côtés de la
// comparaison, un « é » perdu ne gêne pas : « Sté » et « Sté » donnent tous deux « st ».
function pseudo_key($s): string {
    return preg_replace('/[^a-z0-9]/', '', strtolower((string)$s));
}

// Compte les rôles tenus dans UNE compo. Vocabulaire volontairement plus fin que les
// postes Discord : « cardinal » et « patrouille » sont deux métiers différents alors
// que Discord ne connaît que « pilote d'ornithoptère ».
function tally_compo($c, array &$stats): void {
    if (!is_array($c)) return;
    $vus = [];
    $add = function ($nom, $role) use (&$stats, &$vus) {
        $nom = trim((string)$nom);
        if ($nom === '') return;
        $k = pseudo_key($nom);
        if ($k === '') return;
        if (!isset($stats[$k])) $stats[$k] = ['nom' => $nom, 'roles' => [], 'sorties' => 0];
        $stats[$k]['roles'][$role] = ($stats[$k]['roles'][$role] ?? 0) + 1;
        $vus[$k] = true;
    };
    foreach (($c['recolte'] ?? []) as $g) {
        $add($g['transporteur'] ?? '', 'transporteur');
        $add($g['moissonneur'] ?? '', 'moissonneur');
        $add($g['defenseur_cac'] ?? '', 'cardinal');
    }
    // Défense rapprochée : tableau d'escouades (format courant) ou objet unique (ancien).
    $df = $c['defense'] ?? [];
    $squads = (is_array($df) && array_key_exists('nord', $df)) ? [$df] : (is_array($df) ? $df : []);
    foreach ($squads as $sq) {
        if (!is_array($sq)) continue;
        foreach (['nord', 'sud', 'est', 'ouest'] as $k) {
            $d = $sq[$k] ?? null;
            $nom = is_array($d) ? ($d['nom'] ?? '') : $d;   // ancien format : la valeur EST le pseudo
            $add($nom, 'cardinal');
            if (is_array($d) && !empty($d['assaut'])) $add($nom, 'assaut');
            if (is_array($d) && !empty($d['cac']))    $add($nom, 'cac');
        }
        foreach (($sq['assauts'] ?? []) as $p) $add($p['nom'] ?? '', 'assaut');
    }
    foreach ((($c['distance'] ?? [])['pilotes'] ?? []) as $p) {
        $add($p['nom'] ?? '', 'patrouille');
        if (!empty($p['cac'])) $add($p['nom'] ?? '', 'cac');
    }
    foreach ((($c['recon'] ?? [])['scouts'] ?? []) as $p) $add($p['nom'] ?? '', 'scout');
    $b = $c['base_avancee'] ?? [];
    if (!empty($b['active'])) {
        $add($b['constructeur'] ?? '', 'base_constructeur');
        $add($b['buggy'] ?? '', 'base_buggy');
    }
    foreach (['cs', 'cdr', 'cp', 'cb'] as $k) $add(($c['commandement'] ?? [])[$k] ?? '', $k);
    // Une sortie compte pour UNE, quel que soit le nombre de rôles tenus dedans :
    // c'est ce qui permet de dire « 6 fois sur 8 sorties » plutôt qu'un chiffre gonflé.
    foreach (array_keys($vus) as $k) $stats[$k]['sorties']++;
}

// Range les compos reçues de save_assign dans la sortie. Sortie de la boucle du
// switch pour être testable : c'est la seule transformation du lot qui peut détruire
// des données, elle ne doit pas vivre noyée dans un case.
function apply_compos(array $s, array $input): array {
    // Nouveau client : la carte ENTIÈRE des créneaux, en un seul enregistrement.
    // Enregistrer créneau par créneau perdrait le travail de celui qu'on vient de
    // quitter — et sur une journée on passe son temps à les comparer.
    if (isset($input['assignations']) && is_array($input['assignations'])) {
        $compos = $input['assignations'];
        $s['assignation'] = $compos[0] ?? [];
        $reste = [];
        foreach ($compos as $k => $v) if ((int)$k > 0 && !empty($v)) $reste[(int)$k] = $v;
        if ($reste) $s['assignations'] = $reste; else unset($s['assignations']);
        return $s;
    }
    // Ancien client (page ouverte avant le déploiement) : compo unique. On ne touche
    // PAS à `assignations` — l'écraser effacerait les relèves d'un rally parce que
    // quelqu'un a laissé un onglet ouvert depuis la veille.
    $s['assignation'] = $input['assignation'] ?? [];
    return $s;
}

// Participants de TOUTE la sortie, créneaux confondus : sur un rally, quelqu'un qui
// n'a joué que de 14 h à 16 h doit pouvoir déposer son retour comme les autres.
function roster_from_sortie($s): array {
    $names = [];
    foreach (sortie_compos($s) as $c) foreach (roster_from_assign($c) as $n) $names[] = $n;
    return array_values(array_unique($names));
}

// Liste dédupliquée des participants à partir de l'assignation (pour la liste déroulante joueur)
function roster_from_assign($a): array {
    if (!is_array($a)) return [];
    $names = [];
    $push = function ($v) use (&$names) { $v = trim((string)$v); if ($v !== '') $names[] = $v; };
    $cm = $a['commandement'] ?? [];
    foreach (['cs','cdr','cp','cb'] as $k) $push($cm[$k] ?? '');
    foreach (($a['recolte'] ?? []) as $g) foreach (['transporteur','moissonneur','defenseur_cac'] as $k) $push($g[$k] ?? '');
    $base = $a['base_avancee'] ?? [];
    if (!empty($base['active'])) {
        $push($base['constructeur'] ?? ''); $push($base['buggy'] ?? '');
        foreach (($base['patrouilleurs'] ?? []) as $p) $push($p);
    }
    $df = $a['defense'] ?? [];
    // Défense Rapprochée : tableau d'escouades de 4 cardinaux (nouveau format, plusieurs
    // escouades possibles) ; rétro-compat ancien format = un seul objet à 4 cardinaux
    // (repéré par la clé 'nord' présente directement à la racine).
    $squads = (is_array($df) && array_key_exists('nord', $df)) ? [$df] : (is_array($df) ? $df : []);
    foreach ($squads as $squad) {
        if (!is_array($squad)) continue;
        foreach (['nord','sud','est','ouest'] as $k) {
            $v = $squad[$k] ?? '';
            if (is_array($v)) { $push($v['nom'] ?? ''); $push($v['passager'] ?? ''); } // {nom,faucon,passager,cac}
            else $push($v); // rétro-compat plus ancien format encore (chaîne)
        }
        // Pilotes d'assaut de défense du transporteur (0..N, ajoutés à la même escouade)
        foreach (($squad['assauts'] ?? []) as $p) { $push(is_array($p) ? ($p['nom'] ?? '') : $p); }
    }
    // Repérage — scouts (bloc séparé, plus loin que la patrouille)
    foreach (($a['recon']['scouts'] ?? []) as $p) { $push(is_array($p) ? ($p['nom'] ?? '') : $p); }
    foreach (($a['distance']['pilotes'] ?? []) as $p) { $push($p['nom'] ?? ''); $push($p['passager'] ?? ''); }
    foreach (($a['ingame'] ?? []) as $g) foreach (($g['membres'] ?? []) as $m) $push($m);
    // rétro-compat ancien format
    foreach (($a['patrouille'] ?? []) as $b) { $push($b['a'] ?? ''); $push($b['b'] ?? ''); }
    foreach (($a['faucon'] ?? []) as $b) { $push($b['pilote'] ?? ''); $push($b['passager'] ?? ''); }
    $seen = []; $out = [];
    foreach ($names as $n) { $key = lc($n); if (!isset($seen[$key])) { $seen[$key] = 1; $out[] = $n; } }
    sort($out, SORT_NATURAL | SORT_FLAG_CASE);
    return $out;
}

switch ($action) {

    case 'init':
        $d  = read_data();
        $id = active_sortie_id($d);
        if ($id === '') out(false, [], 'Aucune soirée ouverte');
        $target = null;
        foreach ($d['sorties'] as $s) { if (($s['id'] ?? '') === $id) { $target = $s; break; } }
        if (!$target) out(false, [], 'Aucune soirée ouverte');
        $soiree = ['id'=>$target['id'],'date'=>$target['date'] ?? '','titre'=>$target['titre'] ?? '','zone'=>$target['zone'] ?? '','statut'=>'ouverte'];
        out(true, ['soiree' => $soiree, 'participants' => roster_from_sortie($target)]);

    // Retour existant d'un joueur (public — pour pré-remplir / modifier)
    case 'my_debrief':
        $pseudo = trim($_GET['pseudo'] ?? '');
        $d  = read_data();
        $id = active_sortie_id($d);
        if (!$pseudo || $id === '') out(true, ['debrief' => null]);
        foreach ($d['sorties'] as $s) {
            if (($s['id'] ?? '') === $id) {
                foreach ($s['debriefs'] ?? [] as $db) {
                    if (lc(trim($db['pseudo'] ?? '')) === lc($pseudo)) out(true, ['debrief' => $db]);
                }
            }
        }
        out(true, ['debrief' => null]);

    case 'save_debrief':
        $pseudo = trim($input['pseudo'] ?? '');
        $note   = intval($input['note'] ?? 0);
        if (!$pseudo || $note < 1 || $note > 5) out(false, [], 'Pseudo et note obligatoires');
        $d  = read_data();
        $id = active_sortie_id($d);
        if ($id === '') out(false, [], 'Aucune soirée ouverte');
        $debrief = [
            'timestamp'    => date('H:i'),
            'pseudo'       => $pseudo,
            'role'         => trim($input['role'] ?? ''),
            'note'         => $note,
            'sliders'      => $input['sliders']      ?? [],
            'bien'         => $input['bien']          ?? [],
            'bien_autre'   => trim($input['bien_autre']  ?? ''),
            'points_noirs' => $input['points_noirs']  ?? [],
            'pn_autre'     => trim($input['pn_autre']    ?? ''),
            'libre'        => trim($input['libre']        ?? ''),
        ];
        $done = false; $updated = false;
        foreach ($d['sorties'] as &$s) {
            if ($s['id'] !== $id) continue;
            if (($s['statut'] ?? '') !== 'ouverte') out(false, [], 'Cette soirée est clôturée — modification impossible.');
            if (!isset($s['debriefs']) || !is_array($s['debriefs'])) $s['debriefs'] = [];
            foreach ($s['debriefs'] as &$ex) {
                if (lc(trim($ex['pseudo'] ?? '')) === lc($pseudo)) {
                    $debrief['id'] = $ex['id'] ?? ('db_' . uniqid('', true)); // conserve l'id existant
                    $ex = $debrief; $updated = true; break;
                }
            }
            unset($ex);
            if (!$updated) { $debrief['id'] = 'db_' . uniqid('', true); $s['debriefs'][] = $debrief; }
            $done = true; break;
        }
        unset($s);
        if (!$done) out(false, [], 'Soirée introuvable');
        write_data($d);
        out(true, ['message' => $updated ? 'Retour mis à jour' : 'Retour enregistré', 'updated' => $updated]);

    // Charge UNE sortie pour l'assignation. ?sid=<id> ciblé, sinon la sortie active.
    // Un organisateur ne peut charger que ses propres sorties (l'admin, toutes).
    case 'list':
        $d   = read_data();
        $sid = trim($_GET['sid'] ?? ($input['sid'] ?? ''));
        // Sans sid explicite, on utilise le helper (tolère un `soiree_active` cassé).
        $id  = $sid !== '' ? $sid : active_sortie_id($d);
        if ($id === '') out(false, [], 'Aucune soirée active');
        $sortie = null;
        foreach ($d['sorties'] as $s) { if (($s['id'] ?? '') === $id) { $sortie = $s; break; } }
        if (!$sortie) out(false, [], 'Sortie introuvable');
        // Contrôle de propriété UNIQUEMENT pour un accès CIBLÉ (?sid=) : empêche un
        // organisateur de charger la sortie d'un autre. La sortie « vedette » (sans
        // sid) reste visible de tout organisateur (en-tête admin / synthèse retours).
        if ($sid !== '' && !epice_owns_sortie($sortie))
            out(false, [], 'Réservé au créateur de la sortie.');
        out(true, ['sortie' => $sortie]);

    // Sorties OUVERTES assignables : admin = toutes ; organisateur = uniquement les siennes.
    case 'open_sorties':
        $d   = read_data();
        $adm = (epice_role() === 'admin');
        $activeId = $d['soiree_active']['id'] ?? null;
        $list = [];
        foreach ($d['sorties'] as $s) {
            if (($s['statut'] ?? '') !== 'ouverte') continue;
            $mine = epice_is_creator($s);
            if (!$adm && !$mine) continue;
            $list[] = [
                'id'       => $s['id'] ?? '',
                'titre'    => $s['titre'] ?? '',
                'date'     => $s['date'] ?? '',
                'createur' => $s['createur'] ?? '',
                'mine'     => $mine,
                'active'   => (($s['id'] ?? null) === $activeId),
            ];
        }
        out(true, ['sorties' => $list, 'active_id' => $activeId]);

    case 'new_soiree':
        $titre = trim($input['titre'] ?? '');
        if (!$titre) out(false, [], 'Titre obligatoire');
        $id       = 'sortie_' . time();
        $date     = trim($input['date'] ?? date('Y-m-d'));
        $zone     = trim($input['zone'] ?? '');
        $nouvelle = ['id'=>$id,'date'=>$date,'titre'=>$titre,'zone'=>$zone,'statut'=>'ouverte','debriefs'=>[],'createur'=>epice_user()];
        $d = read_data();
        // Multi-sorties : on N'ARCHIVE PLUS les autres (plusieurs ouvertes en parallèle).
        $d['sorties'][]     = $nouvelle;
        $d['soiree_active'] = ['id'=>$id,'date'=>$date,'titre'=>$titre,'zone'=>$zone,'statut'=>'ouverte'];
        write_data($d);
        out(true, ['soiree' => $nouvelle]);

    // Clôture UNE sortie. ?sid ciblé, sinon la sortie active. Organisateur = les siennes seulement.
    case 'close_soiree':
        $d   = read_data();
        $sid = trim($input['sid'] ?? ($_GET['sid'] ?? ''));
        if ($sid === '') $sid = $d['soiree_active']['id'] ?? '';
        if ($sid === '') out(false, [], 'Aucune sortie à clôturer.');
        $target = null;
        foreach ($d['sorties'] as $s) { if (($s['id'] ?? '') === $sid) { $target = $s; break; } }
        if (!$target) out(false, [], 'Sortie introuvable.');
        if (!epice_owns_sortie($target))
            out(false, [], 'Tu ne peux clôturer que tes propres sorties.');
        foreach ($d['sorties'] as &$s) { if (($s['id'] ?? '') === $sid) $s['statut'] = 'archivée'; }
        unset($s);
        // Si on clôture la sortie "vedette", on désigne la plus récente encore ouverte (ou rien).
        if (($d['soiree_active']['id'] ?? null) === $sid) {
            $d['soiree_active'] = null;
            foreach (array_reverse($d['sorties']) as $s) {
                if (($s['statut'] ?? '') === 'ouverte') {
                    $d['soiree_active'] = ['id'=>$s['id'],'date'=>$s['date'] ?? '','titre'=>$s['titre'] ?? '','zone'=>$s['zone'] ?? '','statut'=>'ouverte'];
                    break;
                }
            }
        }
        write_data($d);
        out(true, ['message' => 'Sortie clôturée']);

    // Sauvegarder l'assignation des rôles. ?sid ciblé, sinon active. Ouverte + (admin OU créateur).
    case 'save_assign':
        $d   = read_data();
        $sid = trim($input['sid'] ?? '');
        if ($sid === '') $sid = $d['soiree_active']['id'] ?? '';
        $target = null;
        foreach ($d['sorties'] as $s) { if (($s['id'] ?? '') === $sid) { $target = $s; break; } }
        if (!$target || ($target['statut'] ?? '') !== 'ouverte') out(false, [], 'Sortie introuvable ou non ouverte — modification impossible.');
        if (!epice_owns_sortie($target))
            out(false, [], 'Tu ne peux modifier que la compo de tes propres sorties.');
        foreach ($d['sorties'] as &$s) {
            if (($s['id'] ?? '') !== $sid) continue;
            $s = apply_compos($s, $input);
            break;
        }
        unset($s);
        write_data($d);
        out(true, ['message' => 'Assignation enregistrée']);

    // Corriger le relevé de présence et saisir le volume récolté.
    // Le relevé automatique n'est qu'un point de départ : un visiteur de passage, un
    // joueur resté en vocal sans jouer, une coupure — l'organisateur tranche. On écrase
    // donc `ticks` avec ce que l'écran renvoie, sans fusion : la grille affichée FAIT foi.
    case 'save_presence':
        $d   = read_data();
        $sid = trim($input['sid'] ?? '');
        $trouve = false;
        foreach ($d['sorties'] as &$s) {
            if (($s['id'] ?? '') !== $sid) continue;
            if (!epice_owns_sortie($s)) out(false, [], 'Réservé au créateur de la sortie.');
            $p = is_array($s['presence'] ?? null) ? $s['presence'] : ['ticks' => [], 'noms' => []];
            if (isset($input['ticks']) && is_array($input['ticks'])) {
                $propre = [];
                foreach ($input['ticks'] as $cle => $ids) {
                    if (!is_array($ids)) continue;
                    $ids = array_values(array_unique(array_map('strval', $ids)));
                    if ($ids) $propre[(string)$cle] = $ids;   // un tick vidé disparaît
                }
                ksort($propre);
                $p['ticks'] = $propre;
            }
            if (isset($input['volume'])) $p['volume'] = max(0, (int)$input['volume']);
            $s['presence'] = $p;
            $trouve = true;
            break;
        }
        unset($s);
        // « Sortie introuvable » tout court envoie chercher au mauvais endroit : le cas
        // courant n'est pas un identifiant erroné mais un onglet resté ouvert sur une
        // sortie supprimée depuis, qui affiche donc des données parfaitement crédibles.
        if (!$trouve) out(false, [], "Sortie introuvable — elle a peut-être été supprimée depuis l'ouverture de cette page. Recharge (Ctrl+F5) pour repartir de l'état réel.");
        write_data($d);
        $cible = null;
        foreach ($d['sorties'] as $s2) if (($s2['id'] ?? '') === $sid) $cible = $s2;
        out(true, ['parts' => parts_presence($cible ?: [])]);

    // Publier la répartition sur Discord, dans le canal de la sortie.
    case 'publish_shares':
        $d   = read_data();
        $sid = trim($input['sid'] ?? '');
        $cible = null;
        foreach ($d['sorties'] as $s2) if (($s2['id'] ?? '') === $sid) $cible = $s2;
        if (!$cible) out(false, [], 'Sortie introuvable');
        if (!epice_owns_sortie($cible)) out(false, [], 'Réservé au créateur de la sortie.');

        $r = parts_presence($cible);
        // Garde-fous : publier une répartition fausse est bien pire que ne rien publier.
        if ($r['volume'] <= 0)       out(false, [], 'Saisis le volume récolté avant de publier.');
        if ($r['total_points'] <= 0) out(false, [], 'Aucune présence relevée : rien à répartir.');

        $cfgPath = __DIR__ . '/discord_sortie_config.php';
        if (!file_exists($cfgPath)) out(false, [], 'Configuration du bot absente sur le serveur.');
        $CFG  = require $cfgPath;
        // Canal de publication : `partage_channel_id` d'abord, sinon celui où la sortie a
        // été créée. Le partage n'a pas sa place dans le salon des commandes du bot —
        // c'est une annonce à lire, pas une interaction — d'où le réglage dédié.
        $chan = trim((string)($CFG['partage_channel_id'] ?? ''));
        if ($chan === '') $chan = (string)(($cible['discord'] ?? [])['channel_id'] ?? '');
        if ($chan === '') out(false, [], "Aucun canal de publication : renseigne `partage_channel_id` dans discord_sortie_config.php, ou crée la sortie depuis Discord.");
        if (empty($CFG['bot_token']))     out(false, [], 'Le bot n a pas de token configuré.');
        if (!function_exists('curl_init')) out(false, [], 'cURL indisponible sur le serveur.');

        $ch = curl_init('https://discord.com/api/v10/channels/' . $chan . '/messages');
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode(['content' => message_parts($cible, $r)], JSON_UNESCAPED_UNICODE),
            CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . $CFG['bot_token'], 'Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_TIMEOUT        => 10,
        ]);
        $resp = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($resp === false || $code < 200 || $code >= 300) {
            // Discord DIT ce qui manque (« Missing Access » = le bot ne voit pas le salon,
            // « Missing Permissions » = il le voit mais ne peut pas y écrire). Jeter ce
            // texte pour n'afficher qu'un code obligeait à relancer la requête à la main
            // depuis le serveur pour l'obtenir — c'est arrivé.
            $j    = json_decode((string)$resp, true);
            $quoi = trim((string)($j['message'] ?? ''));
            $aide = '';
            if (stripos($quoi, 'Missing Access') !== false)
                $aide = " — le bot ne voit pas ce salon : accorde-lui « Voir le salon » et « Envoyer des messages » dessus.";
            elseif (stripos($quoi, 'Missing Permissions') !== false)
                $aide = " — le bot voit le salon mais ne peut pas y écrire : accorde-lui « Envoyer des messages ».";
            out(false, [], 'Discord a refusé le message (HTTP ' . $code
                . ($quoi !== '' ? ' : ' . $quoi : '') . ')' . $aide);
        }

        foreach ($d['sorties'] as &$s3) {
            if (($s3['id'] ?? '') === $sid) { $s3['presence']['publie'] = date('c'); break; }
        }
        unset($s3);
        write_data($d);
        out(true, ['message' => 'Répartition publiée sur Discord.']);

    // Sauvegarder l'analyse IA de la soirée active (admin)
    case 'save_analyse':
        $d  = read_data();
        $id = active_sortie_id($d);
        if ($id === '') out(false, [], 'Aucune soirée active');
        $txt = trim($input['analyse'] ?? '');
        foreach ($d['sorties'] as &$s) {
            if (($s['id'] ?? '') === $id) { $s['analyse'] = ['texte' => $txt, 'date' => date('Y-m-d H:i')]; break; }
        }
        unset($s);
        write_data($d);
        out(true, ['message' => 'Analyse enregistrée']);

    // Lire les infos de la soirée en cours pour le Manuel de combat (public — vue joueur).
    // Utilise le helper active_sortie_id() : accepte que le miroir `soiree_active` soit cassé
    // et retombe sur la sortie ouverte la plus récente. Le briefing s'affiche donc DÈS qu'une
    // sortie est ouverte, même sans assignation encore remplie.
    case 'get_assign':
        $d  = read_data();
        $id = active_sortie_id($d);
        if ($id === '') out(false, [], 'Aucune soirée ouverte');
        $target = null;
        foreach ($d['sorties'] as $s) { if (($s['id'] ?? '') === $id) { $target = $s; break; } }
        if (!$target) out(false, [], 'Aucune soirée ouverte');
        out(true, [
            'soiree'      => ['titre'=>$target['titre'] ?? '','date'=>$target['date'] ?? '','zone'=>$target['zone'] ?? ''],
            'assignation' => $target['assignation'] ?? null
        ]);

    // Habitudes de poste, tirées de TOUTES les compos passées (créneaux compris).
    // Calculé côté serveur et renvoyé sous les pseudos EXACTEMENT tels que le client les
    // a envoyés : le rapprochement « Lorhelyne✨ » ↔ « Lorhelyne » n'existe qu'ici, il n'y
    // a donc pas deux normalisations à garder d'accord.
    case 'role_stats':
        $d = read_data();
        $stats = [];
        foreach ($d['sorties'] as $s) {
            // On EXCLUT la sortie en cours de composition : se recommander soi-même
            // ferait passer un brouillon à moitié rempli pour une habitude.
            if (($s['id'] ?? '') === trim($input['sauf'] ?? '')) continue;
            foreach (sortie_compos($s) as $c) tally_compo($c, $stats);
        }
        $noms = is_array($input['noms'] ?? null) ? $input['noms'] : [];
        $out  = [];
        foreach ($noms as $n) {
            $k = pseudo_key($n);
            if ($k !== '' && isset($stats[$k]))
                $out[(string)$n] = ['roles' => $stats[$k]['roles'], 'sorties' => $stats[$k]['sorties']];
        }
        out(true, ['stats' => $out]);

    // Historique PUBLIC (vue joueur) — liste assainie : AUCUN retour, note ni analyse
    case 'public_history':
        $d = read_data();
        $resume = array_map(function($s) {
            return [
                'id'      => $s['id'],
                'date'    => $s['date'],
                'titre'   => $s['titre'],
                'zone'    => $s['zone'] ?? '',
                'statut'  => $s['statut'],
                'a_compo' => !empty($s['assignation']),
            ];
        }, $d['sorties']);
        out(true, ['sorties' => array_reverse($resume)]);

    // Compo PUBLIQUE d'une sortie donnée (vue joueur) — compo seule, JAMAIS les retours/analyse
    case 'public_sortie':
        $sid = $_GET['sid'] ?? '';
        $d   = read_data();
        foreach ($d['sorties'] as $s) {
            if ($s['id'] === $sid) {
                // heure + duree : la vue joueur en déduit le découpage en créneaux,
                // exactement comme l'encart Discord et la grille d'assignation.
                out(true, [
                    'soiree'       => ['titre'=>$s['titre'],'date'=>$s['date'],'zone'=>$s['zone'],'statut'=>$s['statut'],
                                       'heure'=>$s['heure'] ?? '','duree'=>$s['duree'] ?? ''],
                    'assignation'  => $s['assignation'] ?? null,
                    'assignations' => $s['assignations'] ?? null
                ]);
            }
        }
        out(false, [], 'Sortie introuvable');

    // Liste résumée de toutes les sorties (admin — historique)
    case 'history':
        $d = read_data();
        $resume = array_map(function($s) {
            $nb = count($s['debriefs'] ?? []);
            return [
                'id'       => $s['id'],
                'date'     => $s['date'],
                'titre'    => $s['titre'],
                'zone'     => $s['zone'] ?? '',
                'statut'   => $s['statut'],
                'nb'       => $nb,
                'note_moy' => $nb ? round(array_sum(array_column($s['debriefs'],'note')) / $nb, 1) : null,
                'a_compo'  => !empty($s['assignation']),
                'a_analyse'=> !empty($s['analyse']['texte'] ?? ''),
                'createur' => $s['createur'] ?? '',
            ];
        }, $d['sorties']);
        out(true, ['sorties' => array_reverse($resume)]);

    // Détail complet d'une sortie (admin — historique)
    case 'sortie_detail':
        $sid = $_GET['sid'] ?? '';
        $d   = read_data();
        foreach ($d['sorties'] as $s) {
            if ($s['id'] === $sid) out(true, ['sortie' => $s]);
        }
        out(false, [], 'Sortie introuvable');

    // Rouvrir une sortie archivée : elle redevient OUVERTE et la sortie « vedette »
    // (assignation + retours possibles). Admin = toutes ; organisateur = les siennes.
    case 'reopen_sortie':
        $sid = trim($input['sid'] ?? ($_GET['sid'] ?? ''));
        if ($sid === '') out(false, [], 'ID manquant');
        $d = read_data();
        $target = null;
        foreach ($d['sorties'] as $s) { if (($s['id'] ?? '') === $sid) { $target = $s; break; } }
        if (!$target) out(false, [], 'Sortie introuvable');
        if (!epice_owns_sortie($target))
            out(false, [], 'Tu ne peux rouvrir que tes propres sorties.');
        foreach ($d['sorties'] as &$s) { if (($s['id'] ?? '') === $sid) $s['statut'] = 'ouverte'; }
        unset($s);
        $d['soiree_active'] = ['id'=>$target['id'],'date'=>$target['date'] ?? '','titre'=>$target['titre'] ?? '','zone'=>$target['zone'] ?? '','statut'=>'ouverte'];
        write_data($d);
        out(true, ['message' => 'Sortie rouverte']);

    // Supprimer une sortie (admin — nettoyage / tests)
    case 'delete_sortie':
        $sid = trim($input['sid'] ?? ($_GET['sid'] ?? ''));
        if (!$sid) out(false, [], 'ID manquant');
        $d = read_data();
        $target = null;
        foreach ($d['sorties'] as $s) { if (($s['id'] ?? '') === $sid) { $target = $s; break; } }
        if (!$target) out(false, [], 'Sortie introuvable');
        // Un organisateur ne supprime QUE ses propres sorties ; l'admin peut tout supprimer
        if (!epice_owns_sortie($target))
            out(false, [], 'Tu ne peux supprimer que les sorties que tu as créées.');
        $d['sorties'] = array_values(array_filter($d['sorties'], function($s) use ($sid) {
            return ($s['id'] ?? '') !== $sid;
        }));
        // Si on supprime la sortie « vedette », on promeut la sortie la plus récente encore
        // ouverte (même logique que close_soiree). Sans ça, le Manuel de combat côté joueur
        // ne trouve plus quoi afficher alors qu'il reste des sorties ouvertes en parallèle.
        if (($d['soiree_active']['id'] ?? null) === $sid) {
            $d['soiree_active'] = null;
            foreach (array_reverse($d['sorties']) as $s) {
                if (($s['statut'] ?? '') === 'ouverte') {
                    $d['soiree_active'] = ['id'=>$s['id'],'date'=>$s['date'] ?? '','titre'=>$s['titre'] ?? '','zone'=>$s['zone'] ?? '','statut'=>'ouverte'];
                    break;
                }
            }
        }
        write_data($d);
        out(true, ['message' => 'Sortie supprimée']);

    // Identité + droits de l'utilisateur courant (pour l'UI)
    case 'me':
        out(true, ['user' => epice_user(), 'role' => epice_role(), 'can_organize' => epice_can_organize()]);

    // Mes activités (Mon Compte) : sorties QUE J'AI ORGANISÉES / AUXQUELLES J'AI PARTICIPÉ.
    // Personnel uniquement — jamais de comparaison avec d'autres membres (cf. rapport admin
    // séparé, action activity_report). Toutes sorties confondues (épice + autres types).
    case 'my_activity':
        $me        = epice_user() ?? '';
        $myDiscord = (string)($_SESSION['discord_id'] ?? '');
        $organized = [];
        $attended  = [];

        $dstoreFile = __DIR__ . '/data/discord_sorties.json';
        $dstore = file_exists($dstoreFile) ? (json_decode(file_get_contents($dstoreFile), true) ?: ['sorties' => []]) : ['sorties' => []];

        foreach ([read_data(), $dstore] as $store) {
            foreach ($store['sorties'] ?? [] as $s) {
                $entry = ['titre' => $s['titre'] ?? '(sans titre)', 'date' => $s['date'] ?? '', 'type' => $s['type'] ?? 'epice'];
                // Organiser une sortie = déjà compté présent pour celle-ci, pas besoin
                // d'être aussi inscrit (mêmes règles que le rapport admin activity_report).
                if (epice_is_creator($s)) { $organized[] = $entry; continue; }
                foreach ($s['signups'] ?? [] as $su) {
                    if (($su['statut'] ?? 'present') !== 'present') continue;
                    $isMe = ($myDiscord !== '' && (string)($su['id'] ?? '') === $myDiscord)
                         || ($me !== '' && strcasecmp((string)($su['name'] ?? ''), $me) === 0);
                    if ($isMe) { $attended[] = $entry; break; }
                }
            }
        }
        usort($organized, fn($a, $b) => strcmp($b['date'], $a['date']));
        usort($attended, fn($a, $b) => strcmp($b['date'], $a['date']));
        out(true, ['organized' => $organized, 'attended' => $attended]);

    // Liste des organisateurs (admin)
    case 'get_orga':
        out(true, ['organizers' => epice_organizers()]);

    // Définir la liste des organisateurs (admin)
    case 'set_orga':
        $list = $input['organizers'] ?? [];
        if (!is_array($list)) out(false, [], 'Format invalide');
        $clean = [];
        foreach ($list as $n) { $n = trim((string)$n); if ($n !== '' && !in_array($n, $clean, true)) $clean[] = $n; }
        $ok = @file_put_contents(__DIR__ . '/data/organizers.json', json_encode($clean, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) !== false;
        if (!$ok) out(false, [], "Écriture impossible (droits sur data/organizers.json).");
        out(true, ['organizers' => $clean, 'message' => 'Organisateurs enregistrés']);

    // Contenu personnalisé du Manuel de combat (édité directement sur la page par un
    // organisateur, cf debrief.html #sop-editable). html='' → le front garde son contenu par
    // défaut livré dans le code, pas besoin de dupliquer le texte par défaut ici.
    case 'get_sop_content':
        $p = __DIR__ . '/data/sop_content.json';
        $html = '';
        $base = '';
        if (file_exists($p)) {
            $j = json_decode(file_get_contents($p), true);
            $html = is_array($j) ? (string)($j['html'] ?? '') : '';
            // Empreinte du manuel livré au moment de la sauvegarde. Absente sur les
            // fichiers antérieurs à ce mécanisme : le front n'alerte alors pas (pas
            // d'information ≠ mise à jour disponible).
            $base = is_array($j) ? (string)($j['base_version'] ?? '') : '';
        }
        out(true, ['html' => $html, 'base_version' => $base]);

    case 'save_sop_content':
        $html = (string)($input['html'] ?? '');
        $ok = @file_put_contents(__DIR__ . '/data/sop_content.json', json_encode([
            'html' => $html, 'date' => date('Y-m-d H:i'), 'by' => epice_user(),
            // Sert à détecter plus tard qu'une nouvelle version du manuel a été livrée
            // (cf. bandeau d'information côté debrief.html — on prévient, on n'écrase pas).
            'base_version' => (string)($input['base_version'] ?? ''),
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) !== false;
        if (!$ok) out(false, [], "Écriture impossible (droits sur data/sop_content.json).");
        out(true, ['message' => 'Manuel de combat enregistré']);

    // Rapport admin : qui organise / qui participe aux activités (toutes sorties,
    // épice ET autres types). Réservé admin — jamais exposé aux joueurs (pas de
    // classement social visible). Croise debriefs.json + discord_sorties.json.
    case 'activity_report':
        $usersFile = __DIR__ . '/../users_SECURE_9x.json';
        $users = file_exists($usersFile) ? (json_decode(file_get_contents($usersFile), true) ?: []) : [];
        $pseudoByDiscordId = [];
        $allPseudos = [];
        foreach ($users as $u) {
            $p = trim((string)($u['user'] ?? ''));
            if ($p === '') continue;
            $allPseudos[] = $p;
            if (!empty($u['discord_id'])) $pseudoByDiscordId[(string)$u['discord_id']] = $p;
        }

        // Résout un identifiant de sortie (organisateur ou inscrit) vers un pseudo du
        // site : priorité à l'id Discord (immuable), repli sur le nom en clair.
        $resolve = function (string $discordId, string $rawName) use ($pseudoByDiscordId, $allPseudos): string {
            if ($discordId !== '' && isset($pseudoByDiscordId[$discordId])) return $pseudoByDiscordId[$discordId];
            foreach ($allPseudos as $p) { if (strcasecmp($p, $rawName) === 0) return $p; }
            return $rawName !== '' ? $rawName . ' (non lié)' : '?';
        };

        $stats = []; // pseudo => ['organized'=>[{titre,date,type}], 'attended'=>[...], 'present'=>int]
        $ensure = function (string $key) use (&$stats) {
            if (!isset($stats[$key])) $stats[$key] = ['organized' => [], 'attended' => [], 'present' => 0];
        };

        $dstoreFile = __DIR__ . '/data/discord_sorties.json';
        $dstore = file_exists($dstoreFile) ? (json_decode(file_get_contents($dstoreFile), true) ?: ['sorties' => []]) : ['sorties' => []];

        foreach ([read_data(), $dstore] as $store) {
            foreach ($store['sorties'] ?? [] as $s) {
                $entry = ['titre' => $s['titre'] ?? '(sans titre)', 'date' => $s['date'] ?? '', 'type' => $s['type'] ?? 'epice'];

                // Organiser une sortie = compté organisateur ET présent pour CETTE sortie
                // (on ne demande pas à l'organisateur de s'auto-inscrire pour être crédité).
                $organizer = $resolve((string)($s['discord']['user_id'] ?? ''), (string)($s['createur'] ?? ''));
                $ensure($organizer);
                $stats[$organizer]['organized'][] = $entry;
                $stats[$organizer]['present']++;
                $presentHere = [$organizer => true]; // anti-doublon si l'organisateur s'est AUSSI inscrit

                foreach ($s['signups'] ?? [] as $su) {
                    if (($su['statut'] ?? 'present') !== 'present') continue;
                    $p = $resolve((string)($su['id'] ?? ''), (string)($su['name'] ?? ''));
                    if (isset($presentHere[$p])) continue;
                    $presentHere[$p] = true;
                    $ensure($p);
                    $stats[$p]['present']++;
                    $stats[$p]['attended'][] = $entry;
                }
            }
        }

        // Le roster complet est inclus même à 0/0 (repérer ceux qui ne font ni l'un ni l'autre).
        foreach ($allPseudos as $p) { $ensure($p); }

        $rows = [];
        foreach ($stats as $pseudo => $v) {
            usort($v['organized'], fn($a, $b) => strcmp($b['date'], $a['date']));
            usort($v['attended'], fn($a, $b) => strcmp($b['date'], $a['date']));
            $rows[] = [
                'pseudo'        => $pseudo,
                'organized'     => count($v['organized']),
                'present'       => $v['present'],
                'organized_list'=> $v['organized'],
                'attended_list' => $v['attended'],
            ];
        }
        usort($rows, fn($a, $b) => ($b['organized'] + $b['present']) <=> ($a['organized'] + $a['present']));

        out(true, ['rows' => $rows]);

    default:
        out(false, [], 'Action inconnue : ' . htmlspecialchars($action));
}
