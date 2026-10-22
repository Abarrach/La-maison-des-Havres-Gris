<?php
// ============================================================
//  dd_publish.php — publie la carte Deep Desert de la semaine sur Discord
//
//  Appelé par le bouton « Envoyer la carte sur Discord » de map.html (Deep Desert),
//  ouvert à tout membre connecté une fois par semaine, puis aux seuls admins.
//    GET  ?action=etat   → déjà publiée cette semaine ? (grise le bouton)
//    POST                → publie (ou, pour un admin, remplace) le message
//  Le navigateur envoie (multipart, de lui à NOUS — Discord, lui, reçoit l'image
//  par URL publique) :
//    image  = la carte composée (JPEG), telle qu'affichée à l'écran ;
//    releve = ce qu'il y a dessus + tous les sites à schéma unique (JSON).
//  Pourquoi le navigateur : le serveur est bloqué par Cloudflare sur les données
//  de la semaine (cf. dd_discord.php).
//
//  Stockage : dd_cartes/ (public : Discord vient y chercher l'image).
//    carte_s<seed>_<date>.jpg   une image par publication (nom unique : Discord
//                               met les images en cache par URL)
//    releve.json                le dernier relevé, relu par /carte
//  Les DD_GARDER dernières images sont conservées : les anciens messages du salon
//  pointent dessus.
// ============================================================

header('Content-Type: application/json; charset=utf-8');
date_default_timezone_set('Europe/Paris');

// Session partagée avec le reste du site (cookie 30 j).
require_once __DIR__ . '/discord_oauth.php';
require_once __DIR__ . '/dd_discord.php';

function ddp_out(bool $ok, array $payload = [], string $err = ''): void {
    echo json_encode($ok ? (['ok' => true] + $payload) : ['ok' => false, 'error' => $err], JSON_UNESCAPED_UNICODE);
    exit;
}

// Qui peut publier (décision de l'utilisateur, 2026-10-21) : N'IMPORTE QUEL MEMBRE
// connecté, une fois par semaine — « le premier qui passe envoie l'info », sinon il
// faudrait absolument un admin. Ensuite le bouton est grisé jusqu'au reset, et seul
// un admin peut republier (correction, bug). Identité et rôle viennent de la
// SESSION, jamais d'un champ envoyé par la page.
$moi   = (string)($_SESSION['user'] ?? '');
$admin = ($_SESSION['role'] ?? '') === 'admin';
// « Aperçu joueur » des admins (auth-guard.js) : seul le navigateur change de rôle,
// la session reste admin. La page le signale (apercu=1) et on la traite alors en
// membre — sinon l'aperçu montrait « Republier (admin) » (constaté le 2026-10-21).
// Ne fait que RETIRER des droits : un joueur qui l'envoie n'y gagne rien.
if (($_REQUEST['apercu'] ?? '') === '1') $admin = false;
if ($moi === '') ddp_out(false, [], 'Connecte-toi pour publier la carte.');

// GET ?action=etat — l'état du bouton : déjà publiée cette semaine ?
if (($_GET['action'] ?? '') === 'etat') {
    $r   = dd_lire_releve();
    $pub = $r && dd_releve_a_jour($r);
    ddp_out(true, ['publiee' => $pub, 'par' => $pub ? (string)($r['par'] ?? '') : '', 'admin' => $admin]);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') ddp_out(false, [], 'POST attendu');
// Contrôle rapide avant tout travail ; il est REFAIT sous verrou plus bas.
$deja = dd_lire_releve();
if (!$admin && $deja && dd_releve_a_jour($deja)) {
    ddp_out(false, [], 'La carte de la semaine a déjà été publiée' . (!empty($deja['par']) ? ' par ' . $deja['par'] : '')
        . ". Seul un admin peut la republier.");
}

// ---- Image ------------------------------------------------------------------
$f = $_FILES['image'] ?? null;
if (!$f || ($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    $e = (int)($f['error'] ?? UPLOAD_ERR_NO_FILE);
    ddp_out(false, [], ($e === UPLOAD_ERR_INI_SIZE || $e === UPLOAD_ERR_FORM_SIZE)
        ? "image trop lourde pour la configuration PHP (upload_max_filesize)"
        : "image non reçue (code d'envoi {$e})");
}
if ($f['size'] > 6 * 1024 * 1024) ddp_out(false, [], 'image trop lourde (6 Mo maximum)');
$info = @getimagesize($f['tmp_name']);
if (!$info || $info[2] !== IMAGETYPE_JPEG || $info[0] > 4000 || $info[1] > 4000) {
    ddp_out(false, [], "l'image reçue n'est pas une carte JPEG valide");
}

// ---- Relevé -------------------------------------------------------------------
$raw = (string)($_POST['releve'] ?? '');
if ($raw === '' || strlen($raw) > 400000) ddp_out(false, [], 'relevé absent ou trop gros');
$in = json_decode($raw, true);
if (!is_array($in) || !isset($in['seed']) || !is_numeric($in['seed'])) ddp_out(false, [], 'relevé illisible');

// On ne garde que les champs connus, bornés : le relevé est servi publiquement
// et réinjecté dans des messages Discord.
function ddp_txt($v, int $max = 80): string {
    $s = trim((string)preg_replace('/[\x00-\x1F\x7F]/u', '', (string)$v));
    // Coupe en CARACTÈRES (sans mbstring) : un substr couperait un accent en deux,
    // et json_encode refuse alors TOUT le relevé.
    if (strlen($s) > $max && preg_match('/^.{0,' . $max . '}/us', $s, $m)) $s = $m[0];
    return $s;
}
function ddp_item(array $i, bool $avecUniques): array {
    $o = ['cell' => ddp_txt($i['cell'] ?? '', 3)];
    if (!preg_match('/^[A-I][1-9]$/', $o['cell'])) $o['cell'] = '?';
    if (isset($i['count']))  $o['count'] = max(1, (int)$i['count']);
    if (!empty($i['name']))  $o['name']  = ddp_txt($i['name']);
    if ($avecUniques) {
        $o['uniques'] = [];
        foreach (array_slice((array)($i['uniques'] ?? []), 0, 80) as $u) {
            if (!is_array($u)) continue;
            $o['uniques'][] = [
                'nom' => ddp_txt($u['nom'] ?? '', 100),
                'p'   => max(0, min(1, (float)($u['p'] ?? 0))),
                'pid' => preg_match('/^[a-z0-9_]{1,120}$/', (string)($u['pid'] ?? '')) ? (string)$u['pid'] : null,
            ];
        }
    }
    return $o;
}

$releve = [
    'seed'    => ((int)$in['seed'] % 12 + 12) % 12,
    'affiche' => [],
    'sites'   => [],
];
foreach (array_keys(DD_COUCHES) as $id) {
    if (!isset($in['affiche'][$id]) || !is_array($in['affiche'][$id])) continue;
    $releve['affiche'][$id] = array_map(function ($i) { return ddp_item((array)$i, false); }, array_slice($in['affiche'][$id], 0, 200));
}
foreach (array_slice((array)($in['sites'] ?? []), 0, 200) as $s) {
    if (!is_array($s) || !isset(DD_TYPES[$s['type'] ?? ''])) continue;
    $releve['sites'][] = ['type' => $s['type']] + ddp_item($s, true);
}

// ---- Enregistrement -----------------------------------------------------------
if (!is_dir(DD_CARTES_DIR) && !@mkdir(DD_CARTES_DIR, 02775, true)) {
    ddp_out(false, [], "impossible de créer dd_cartes/ sur le serveur (droits du dossier du site)");
}
// Verrou : deux membres qui cliquent en même temps ne doivent pas poster deux
// messages. Le second attend, relit le relevé et se voit refuser.
$verrou = @fopen(DD_CARTES_DIR . '/.verrou', 'c');
if (!$verrou || !flock($verrou, LOCK_EX)) ddp_out(false, [], 'verrou de publication indisponible (droits de dd_cartes/)');
$ancien = dd_lire_releve();
if (!$admin && $ancien && dd_releve_a_jour($ancien)) {
    ddp_out(false, [], 'La carte de la semaine vient d\'être publiée' . (!empty($ancien['par']) ? ' par ' . $ancien['par'] : '') . '.');
}

$nom = 'carte_s' . $releve['seed'] . '_' . date('Ymd-His') . '.jpg';
if (!@move_uploaded_file($f['tmp_name'], DD_CARTES_DIR . '/' . $nom)) {
    ddp_out(false, [], "impossible d'écrire dans dd_cartes/ (droits : dune:www-data, 775)");
}
@chmod(DD_CARTES_DIR . '/' . $nom, 0664);

$releve += [
    'reset'     => dd_reset_courant(),
    'publie_le' => time(),
    'par'       => ddp_txt($moi, 40),
    'image'     => 'dd_cartes/' . $nom,
];

$res = dd_publier($releve, $ancien);
if (!$res['ok']) {
    @unlink(DD_CARTES_DIR . '/' . $nom);
    ddp_out(false, [], $res['error']);
}
$releve['message_id'] = $res['id'];
$releve['channel_id'] = $res['chan'];

if (!dd_ecrire_json(DD_RELEVE, $releve)) {
    // Le message est parti : on le dit, mais /carte servira l'ancien relevé.
    ddp_out(true, ['edite' => $res['edite'], 'lien' => $res['lien'],
        'avertissement' => "message publié, mais releve.json n'a pas pu être écrit : /carte affichera l'ancienne carte"]);
}

// Ménage : on garde les DD_GARDER images les plus récentes.
$imgs = glob(DD_CARTES_DIR . '/carte_s*.jpg') ?: [];
usort($imgs, function ($a, $b) { return filemtime($b) <=> filemtime($a); });
foreach (array_slice($imgs, DD_GARDER) as $vieux) @unlink($vieux);

ddp_out(true, ['edite' => $res['edite'], 'lien' => $res['lien']]);
