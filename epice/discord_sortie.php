<?php
// ============================================================
//  ENDPOINT INTERACTIONS DISCORD — bot "Sorties" épice
//
//  URL à déclarer chez Discord (portail dev → General Information →
//  "Interactions Endpoint URL") :  https://.../epice/discord_sortie.php
//
//  Gère, en pur PHP (aucun démon) :
//   - PING (type 1)            → PONG : poignée de main de validation Discord
//   - SLASH /sortie creer (2)  → ouvre un FORMULAIRE (modal)
//   - SOUMISSION du modal (5)  → crée la sortie dans debriefs.json + poste
//                                l'encart avec l'inscription par poste
//   - SELECT / BOUTON (3)      → inscrit / désinscrit + rafraîchit le roster
//
//  Sécurité : chaque requête Discord est signée (Ed25519). On la VÉRIFIE
//  avant tout traitement (sinon 401). Clé publique dans la config.
// ============================================================

// ---- Config -------------------------------------------------
$CFG_PATH = __DIR__ . '/discord_sortie_config.php';
if (!file_exists($CFG_PATH)) { http_response_code(500); echo 'config absente'; exit; }
$CFG = require $CFG_PATH;

// ---- Journal d'erreurs (silencieux côté Discord) ------------
function dlog($msg) {
    @file_put_contents(__DIR__ . '/discord_sortie.log', date('c') . ' ' . $msg . "\n", FILE_APPEND);
}

// ---- Postes proposés à l'inscription ------------------------
//  id technique (stocké) => libellé affiché. Mappés sur la structure
//  d'assignation de l'outil Activité Guilde (recolte / defense / distance).
const POSTES = [
    'moissonneur'  => 'Moissonneur',
    'transporteur' => 'Transporteur',
    'defenseur_cac'=> 'Défenseur CaC',
    'pilote_orni'  => 'Pilote Ornithoptère',
    'present'      => 'Présent (poste à définir)',
];
const POSTE_ICON = [
    'moissonneur'  => '⛏️',
    'transporteur' => '🚚',
    'defenseur_cac'=> '⚔️',
    'pilote_orni'  => '🦅',
    'present'      => '✅',
];

// ---- Types de sortie ----------------------------------------
//  'site'   => true  : intégré à l'Activité Guilde (soirée active, assignation, historique).
//            => false : vit uniquement côté Discord (jauge d'intérêt), stockage séparé.
//  'postes' => true  : inscription par poste (menu déroulant). false : RSVP Présent/Peut-être/Absent.
const SORTIE_TYPES = [
    'epice'     => ['label' => 'Épice',       'icon' => '🏜️', 'site' => true,  'postes' => true],
    'labo'      => ['label' => 'Labos-Donjons', 'icon' => '🧪', 'site' => false, 'postes' => false],
    'farm'      => ['label' => 'Farm divers', 'icon' => '🔁', 'site' => false, 'postes' => false],
    'landsraad' => ['label' => 'Landsraad',   'icon' => '🏛️', 'site' => false, 'postes' => false],
];
function sortie_type($stype): array { return SORTIE_TYPES[$stype] ?? SORTIE_TYPES['epice']; }

// ============================================================
//  1) VÉRIFICATION DE LA SIGNATURE
// ============================================================
$raw       = file_get_contents('php://input');
$signature = $_SERVER['HTTP_X_SIGNATURE_ED25519']   ?? '';
$timestamp = $_SERVER['HTTP_X_SIGNATURE_TIMESTAMP'] ?? '';

if (!function_exists('sodium_crypto_sign_verify_detached')) {
    dlog('FATAL: extension sodium absente — signature non vérifiable');
    http_response_code(500); echo 'sodium manquant'; exit;
}
if ($signature === '' || $timestamp === '') { http_response_code(401); echo 'signature manquante'; exit; }

$ok = false;
try {
    $ok = sodium_crypto_sign_verify_detached(
        sodium_hex2bin($signature),
        $timestamp . $raw,
        sodium_hex2bin($CFG['public_key'])
    );
} catch (Throwable $e) {
    dlog('Erreur vérif signature: ' . $e->getMessage());
}
if (!$ok) { http_response_code(401); echo 'signature invalide'; exit; }

// ============================================================
//  2) ROUTAGE DE L'INTERACTION
// ============================================================
header('Content-Type: application/json; charset=utf-8');
$body = json_decode($raw, true) ?? [];
$type = $body['type'] ?? 0;

// -- PING : poignée de main de Discord ------------------------
if ($type === 1) { echo json_encode(['type' => 1]); exit; }

// -- SLASH COMMAND --------------------------------------------
if ($type === 2) {
    $name = $body['data']['name'] ?? '';
    $sub  = $body['data']['options'][0]['name'] ?? '';
    if ($name === 'sortie' && $sub === 'creer') {
        // Type choisi dans le menu natif de la commande (option « type »).
        $stype = 'epice';
        foreach ($body['data']['options'][0]['options'] ?? [] as $o) {
            if (($o['name'] ?? '') === 'type') $stype = $o['value'] ?? 'epice';
        }
        if (!array_key_exists($stype, SORTIE_TYPES)) $stype = 'epice';
        respond_modal($stype);
    }
    respond_message("Commande inconnue.", true);
}

// -- SOUMISSION DU MODAL --------------------------------------
if ($type === 5) {
    $cid = $body['data']['custom_id'] ?? '';
    if (strpos($cid, 'sortie_edit_modal:') === 0) {
        handle_edit_save($body, substr($cid, strlen('sortie_edit_modal:')));
    }
    if (strpos($cid, 'sortie_create_modal') === 0) {
        // Le type est encodé dans le custom_id : "sortie_create_modal:<type>".
        $stype = (strpos($cid, ':') !== false) ? substr($cid, strpos($cid, ':') + 1) : 'epice';
        if (!array_key_exists($stype, SORTIE_TYPES)) $stype = 'epice';
        handle_create($body, $stype);
    }
    respond_message("Formulaire inconnu.", true);
}

// -- COMPOSANT (select d'inscription / boutons présent / peut-être / absent / désinscription) -
if ($type === 3) {
    $cid = $body['data']['custom_id'] ?? '';
    if (strpos($cid, 'signup:') === 0)   { handle_signup($body, substr($cid, 7)); }
    if (strpos($cid, 'present:') === 0)  { handle_status($body, substr($cid, 8), 'present'); }
    if (strpos($cid, 'maybe:') === 0)    { handle_status($body, substr($cid, 6), 'maybe'); }
    if (strpos($cid, 'absent:') === 0)   { handle_status($body, substr($cid, 7), 'absent'); }
    if (strpos($cid, 'unsignup:') === 0) { handle_unsignup($body, substr($cid, 9)); }
    if (strpos($cid, 'edit:') === 0)     { handle_edit_open($body, substr($cid, 5)); }
    if (strpos($cid, 'delok:') === 0)    { handle_delete_confirm($body, substr($cid, 6)); }
    if (strpos($cid, 'del:') === 0)      { handle_delete($body, substr($cid, 4)); }
    respond_message("Action inconnue.", true);
}

http_response_code(400); echo 'type non géré'; exit;


// ============================================================
//  HANDLERS
// ============================================================

// Construit un MODAL de sortie (création OU modification) pré-rempli avec $vals.
function sortie_modal($customId, $title, $vals = []) {
    $field = function ($id, $label, $style, $required, $ph = '', $max = 0) use ($vals) {
        $c = ['type' => 4, 'custom_id' => $id, 'label' => $label, 'style' => $style, 'required' => $required];
        if (isset($vals[$id]) && $vals[$id] !== '') $c['value'] = (string)$vals[$id];
        if ($ph  !== '') $c['placeholder'] = $ph;
        if ($max  >  0)  $c['max_length']  = $max;
        return ['type' => 1, 'components' => [$c]];
    };
    return ['type' => 9, 'data' => [
        'custom_id'  => $customId,
        'title'      => $title,
        'components' => [
            $field('titre',  'Titre de la sortie',      1, true,  'Run épice Sud — gros déstockage', 100),
            $field('quand',  'Date & heure',            1, true,  '25-06-2026 21:00', 40),
            $field('zone',   'Zone',                    1, false, 'Deep Desert — secteur F4', 100),
            $field('duree',  'Durée (en heures)',       1, false, 'ex : 2  (ou 1h30)', 10),
            $field('desc',   'Description / consignes', 2, false, 'Objectif, packtage requis…', 600),
        ],
    ]];
}

// Ouvre le formulaire de CRÉATION (réponse type 9 = MODAL). $stype = type de sortie.
function respond_modal($stype = 'epice') {
    $t = sortie_type($stype);
    echo json_encode(sortie_modal('sortie_create_modal:' . $stype, 'Nouvelle sortie ' . $t['label']));
    exit;
}

// Reconstruit "JJ-MM-AAAA HH:MM" à partir des champs date (Y-m-d) + heure, pour pré-remplir le modal.
function fmt_when($sortie) {
    $date = $sortie['date'] ?? ''; $heure = $sortie['heure'] ?? '';
    $d = DateTime::createFromFormat('Y-m-d', $date);
    $ds = ($d instanceof DateTime) ? $d->format('d-m-Y') : $date;
    return trim($ds . ' ' . $heure);
}

// Formate la durée pour l'affichage : "2" → "2h" ; "1h30"/"2h" → tels quels ; vide → "".
function fmt_duree($d) {
    $d = trim((string)$d);
    if ($d === '') return '';
    return ctype_digit($d) ? $d . 'h' : $d;
}

// Crée la sortie + poste l'encart (réponse type 4 = message public). $stype = type de sortie.
function handle_create($body, $stype = 'epice') {
    $v = modal_values($body);
    $user = interaction_user($body);

    $titre = trim($v['titre'] ?? '');
    if ($titre === '') respond_message("Le titre est obligatoire.", true);

    [$date, $heure] = parse_when($v['quand'] ?? '');

    $sortie = [
        'id'          => 'sortie_' . time(),
        'type'        => $stype,
        'date'        => $date,
        'heure'       => $heure,
        'titre'       => $titre,
        'zone'        => trim($v['zone'] ?? ''),
        'duree'       => trim($v['duree'] ?? ''),
        'description' => trim($v['desc'] ?? ''),
        'statut'      => 'ouverte',
        'source'      => 'discord',
        'createur'    => $user['name'],
        'discord'     => [
            'user_id'    => $user['id'],
            'channel_id' => $body['channel_id']        ?? ($body['channel']['id'] ?? ''),
            'guild_id'   => $body['guild_id']          ?? '',
        ],
        'signups'     => [],
        'debriefs'    => [],
    ];

    if (sortie_type($stype)['site']) {
        // ÉPICE : intégré à l'Activité Guilde. Multi-sorties : on N'ARCHIVE PLUS les
        // autres ouvertes (plusieurs en parallèle) ; cette sortie devient la "vedette".
        $d = read_data();
        $d['sorties'][]     = $sortie;
        $d['soiree_active'] = ['id'=>$sortie['id'],'date'=>$date,'titre'=>$titre,'zone'=>$sortie['zone'],'statut'=>'ouverte'];
        write_data($d);
    } else {
        // AUTRES TYPES : store Discord séparé, n'affecte pas le débrief ni la soirée active.
        $ds = read_dstore();
        $ds['sorties'][] = $sortie;
        write_dstore($ds);
    }

    echo json_encode(['type' => 4, 'data' => build_sortie_message($sortie)]);
    exit;
}

// Trouve la sortie par id dans l'un des deux stores (débrief OU store Discord),
// applique la mutation sur ses signups, sauvegarde, et renvoie la sortie à jour (ou null).
function mutate_sortie($sortieId, callable $fn) {
    $d = read_data();
    foreach ($d['sorties'] as &$s) {
        if (($s['id'] ?? '') === $sortieId) {
            if (!isset($s['signups']) || !is_array($s['signups'])) $s['signups'] = [];
            $fn($s); write_data($d); return $s;
        }
    }
    unset($s);
    $ds = read_dstore();
    foreach ($ds['sorties'] as &$s) {
        if (($s['id'] ?? '') === $sortieId) {
            if (!isset($s['signups']) || !is_array($s['signups'])) $s['signups'] = [];
            $fn($s); write_dstore($ds); return $s;
        }
    }
    unset($s);
    return null;
}

// Upsert l'inscription d'un membre (un membre = une seule entrée, remplacée).
function upsert_signup(&$s, $user, $poste, $statut) {
    foreach ($s['signups'] as &$su) {
        if (($su['id'] ?? '') === $user['id']) {
            $su['poste'] = $poste; $su['statut'] = $statut; $su['name'] = $user['name']; $su['ts'] = time();
            return;
        }
    }
    unset($su);
    $s['signups'][] = ['id'=>$user['id'],'name'=>$user['name'],'poste'=>$poste,'statut'=>$statut,'ts'=>time()];
}

// Inscription à un poste (select épice). Statut « présent » + poste choisi.
function handle_signup($body, $sortieId) {
    $poste = $body['data']['values'][0] ?? '';
    if (!array_key_exists($poste, POSTES)) respond_message("Poste inconnu.", true);
    $user = interaction_user($body);
    $updated = mutate_sortie($sortieId, function (&$s) use ($user, $poste) {
        upsert_signup($s, $user, $poste, 'present');
    });
    if (!$updated) respond_message("Cette sortie n'existe plus.", true);
    // type 7 = UPDATE_MESSAGE : on réécrit l'encart sur place (roster à jour).
    echo json_encode(['type' => 7, 'data' => build_sortie_message($updated)]);
    exit;
}

// Réponse présent (RSVP) / peut-être / absent (boutons) : un statut, sans poste.
function handle_status($body, $sortieId, $statut) {
    $user = interaction_user($body);
    $updated = mutate_sortie($sortieId, function (&$s) use ($user, $statut) {
        upsert_signup($s, $user, '', $statut);
    });
    if (!$updated) respond_message("Cette sortie n'existe plus.", true);
    echo json_encode(['type' => 7, 'data' => build_sortie_message($updated)]);
    exit;
}

// Désinscription (bouton) : retire complètement le membre.
function handle_unsignup($body, $sortieId) {
    $user = interaction_user($body);
    $updated = mutate_sortie($sortieId, function (&$s) use ($user) {
        $s['signups'] = array_values(array_filter($s['signups'], function ($su) use ($user) {
            return ($su['id'] ?? '') !== $user['id'];
        }));
    });
    if (!$updated) respond_message("Cette sortie n'existe plus.", true);
    echo json_encode(['type' => 7, 'data' => build_sortie_message($updated)]);
    exit;
}


// ============================================================
//  MODIFICATION / SUPPRESSION (réservées au créateur de l'activité)
// ============================================================

// Le cliqueur est-il le créateur de la sortie ?
function is_creator($body, $sortie): bool {
    $u = interaction_user($body)['id'];
    return $u !== '' && $u === ($sortie['discord']['user_id'] ?? '');
}

// Le cliqueur a-t-il un rôle de staff (admin/modérateur) sur le serveur ?
// On lit le bitfield de permissions du membre fourni dans l'interaction.
function member_is_staff($body): bool {
    $perms = $body['member']['permissions'] ?? '';
    if ($perms === '') return false;
    $p = intval($perms); // PHP 64 bits : couvre tous les bits utilisés ci-dessous
    // ADMINISTRATOR(8) | MANAGE_GUILD(32) | MANAGE_MESSAGES(8192) | KICK(2) | BAN(4) | MODERATE_MEMBERS(1<<40)
    $staffMask = 8 | 32 | 8192 | 2 | 4 | 1099511627776;
    return ($p & $staffMask) !== 0;
}

// Peut gérer l'activité = créateur OU staff (modérateur/admin).
function can_manage($body, $sortie): bool {
    return is_creator($body, $sortie) || member_is_staff($body);
}

// Cherche une sortie par id dans les deux stores (lecture seule).
function find_sortie($id) {
    foreach (read_data()['sorties']  as $s) { if (($s['id'] ?? '') === $id) return $s; }
    foreach (read_dstore()['sorties'] as $s) { if (($s['id'] ?? '') === $id) return $s; }
    return null;
}

// Ouvre le formulaire de MODIFICATION (pré-rempli). Réservé au créateur.
function handle_edit_open($body, $sid) {
    $sortie = find_sortie($sid);
    if (!$sortie)                      respond_message("Cette activité n'existe plus.", true);
    if (!can_manage($body, $sortie))   respond_message("✋ Réservé à l'organisateur, aux modérateurs et aux admins.", true);
    $vals = [
        'titre'  => $sortie['titre'] ?? '',
        'quand'  => fmt_when($sortie),
        'zone'   => $sortie['zone'] ?? '',
        'duree'  => $sortie['duree'] ?? '',
        'desc'   => $sortie['description'] ?? '',
    ];
    echo json_encode(sortie_modal('sortie_edit_modal:' . $sid, 'Modifier la sortie', $vals));
    exit;
}

// Enregistre la modification + rafraîchit l'encart. Réservé au créateur.
function handle_edit_save($body, $sid) {
    $sortie = find_sortie($sid);
    if (!$sortie)                    respond_message("Cette activité n'existe plus.", true);
    if (!can_manage($body, $sortie)) respond_message("✋ Réservé à l'organisateur, aux modérateurs et aux admins.", true);

    // Date/heure AVANT modification (pour détecter un changement → MP aux inscrits)
    // + auteur de la modif (qu'on n'avertit pas lui-même).
    $oldDate  = $sortie['date']  ?? '';
    $oldHeure = $sortie['heure'] ?? '';
    $editorId = interaction_user($body)['id'];

    $v = modal_values($body);
    $titre = trim($v['titre'] ?? '');
    if ($titre === '') respond_message("Le titre est obligatoire.", true);
    [$date, $heure] = parse_when($v['quand'] ?? '');

    $updated = mutate_sortie($sid, function (&$s) use ($titre, $date, $heure, $v) {
        $s['titre']       = $titre;
        $s['date']        = $date;
        $s['heure']       = $heure;
        $s['zone']        = trim($v['zone'] ?? '');
        $s['duree']       = trim($v['duree'] ?? '');
        $s['description'] = trim($v['desc'] ?? '');
    });
    if (!$updated) respond_message("Cette activité n'existe plus.", true);

    // Si c'est la soirée épice active, on synchronise aussi le miroir soiree_active.
    $d = read_data();
    if (($d['soiree_active']['id'] ?? null) === $sid) {
        $d['soiree_active']['titre'] = $titre;
        $d['soiree_active']['date']  = $date;
        $d['soiree_active']['zone']  = trim($v['zone'] ?? '');
        write_data($d);
    }

    // On répond à Discord (rafraîchit l'encart) AVANT d'envoyer les MP → on reste sous la limite de 3 s.
    echo json_encode(['type' => 7, 'data' => build_sortie_message($updated)]);

    // MP aux inscrits si la DATE et/ou l'HEURE a changé — envoi en arrière-plan.
    if ($oldDate !== $date || $oldHeure !== $heure) {
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        notify_when_change($updated, $oldDate, $oldHeure, $editorId);
    }
    exit;
}

// ============================================================
//  NOTIFICATION MP — changement de date/heure d'une activité
// ============================================================

// Ouvre (ou récupère) le canal MP avec un utilisateur. Renvoie l'id du canal ou ''.
function dm_open_channel($userId) {
    global $CFG;
    if (!$userId || empty($CFG['bot_token']) || !function_exists('curl_init')) return '';
    $ch = curl_init('https://discord.com/api/v10/users/@me/channels');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode(['recipient_id' => (string)$userId]),
        CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . $CFG['bot_token'], 'Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT        => 5,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code < 200 || $code >= 300) { dlog("dm_open_channel échec uid={$userId} HTTP {$code}"); return ''; }
    $j = json_decode($resp, true);
    return $j['id'] ?? '';
}

// Envoie un MP texte à un utilisateur. Silencieux : un échec (MP fermés, blocage…) est juste journalisé.
function dm_send($userId, $content) {
    global $CFG;
    $chan = dm_open_channel($userId);
    if (!$chan) return false;
    $ch = curl_init("https://discord.com/api/v10/channels/{$chan}/messages");
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode(['content' => $content], JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . $CFG['bot_token'], 'Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT        => 5,
    ]);
    $code = (curl_exec($ch) !== false) ? curl_getinfo($ch, CURLINFO_HTTP_CODE) : 0;
    curl_close($ch);
    if ($code < 200 || $code >= 300) { dlog("dm_send échec uid={$userId} HTTP {$code}"); return false; }
    return true;
}

// Prévient par MP les inscrits d'un changement de date/heure.
// Message différencié selon le statut (présent / peut-être / absent).
// N'envoie rien à l'auteur de la modif. Un seul MP par personne.
function notify_when_change($sortie, $oldDate, $oldHeure, $editorId) {
    $titre   = $sortie['titre'] ?? 'la sortie';
    $icon    = sortie_type($sortie['type'] ?? 'epice')['icon'] ?? '📌';
    $newWhen = fmt_when($sortie);
    $oldWhen = fmt_when(['date' => $oldDate, 'heure' => $oldHeure]);

    $head = "{$icon} **L'activité « {$titre} » a été modifiée.**\n"
          . "📅 Nouvelle date/heure : **{$newWhen}**"
          . ($oldWhen !== '' ? "  _(avant : {$oldWhen})_" : '') . "\n\n";

    $tail = [
        'present' => "Tu étais inscrit comme **✅ Présent** : vérifie que le nouveau créneau te convient toujours !",
        'maybe'   => "Tu avais répondu **❓ Peut-être** : le créneau a changé, n'hésite pas à confirmer ou décliner.",
        'absent'  => "Tu avais indiqué **✖️ Absent** : le créneau a changé, celui-ci t'arrange peut-être mieux ?",
    ];

    $seen = [];
    foreach ($sortie['signups'] ?? [] as $su) {
        $uid = (string)($su['id'] ?? '');
        if ($uid === '' || $uid === (string)$editorId || isset($seen[$uid])) continue;
        $seen[$uid] = true;
        $statut = $su['statut'] ?? 'present';
        if (!isset($tail[$statut])) $statut = 'present';
        dm_send($uid, $head . $tail[$statut]);
        usleep(200000); // ~5 MP/s : sous la limite de Discord
    }
}

// Étape 1 — demande de CONFIRMATION (éphémère, visible du seul créateur). Réservé au créateur.
function handle_delete($body, $sid) {
    $sortie = find_sortie($sid);
    if (!$sortie)                    respond_message("Cette activité n'existe plus.", true);
    if (!can_manage($body, $sortie)) respond_message("✋ Réservé à l'organisateur, aux modérateurs et aux admins.", true);

    // On embarque le salon + l'id du message d'origine dans le bouton de confirmation,
    // car l'éphémère qui suit n'aura plus accès au message de l'activité.
    $ch  = $body['channel_id'] ?? '';
    $mid = $body['message']['id'] ?? '';
    // Une sortie liée au site (épice) conserve ses données → message adapté.
    $isSite  = sortie_type($sortie['type'] ?? 'epice')['site'];
    $titre   = $sortie['titre'] ?? '';
    $content = $isSite
        ? "🗑️ Retirer le post de **{$titre}** du canal ?\nLes données du raid (retours, compo, analyse) **restent conservées sur le site**."
        : "🗑️ Supprimer définitivement l'activité **{$titre}** ?\nCette action est irréversible.";
    echo json_encode(['type' => 4, 'data' => [
        'flags'   => 64, // éphémère
        'content' => $content,
        'components' => [['type' => 1, 'components' => [
            ['type' => 2, 'style' => 4, 'label' => ($isSite ? 'Retirer le post' : 'Confirmer la suppression'), 'emoji' => ['name' => '🗑️'], 'custom_id' => "delok:{$sid}:{$ch}:{$mid}"],
        ]]],
    ]]);
    exit;
}

// Étape 2 — suppression effective après confirmation. $args = "<sid>:<channelId>:<messageId>".
function handle_delete_confirm($body, $args) {
    $parts = explode(':', $args);
    $sid = $parts[0] ?? '';
    $ch  = $parts[1] ?? '';
    $mid = $parts[2] ?? '';
    $sortie = find_sortie($sid);
    // L'éphémère n'est visible que du créateur ; on revérifie quand même si la sortie existe encore.
    if ($sortie && !can_manage($body, $sortie)) respond_update("✋ Réservé à l'organisateur, aux modérateurs et aux admins.");

    $res = delete_sortie_by_id($sid);
    discord_delete_message_api($ch, $mid); // le bot supprime son propre message d'activité
    respond_update($res === 'kept'
        ? "🗑️ Post retiré du canal. Les données du raid (retours, compo, analyse) sont **conservées sur le site**."
        : "🗑️ Activité supprimée.");
}

// Suppression depuis le bouton 🗑️ Discord.
//  - ÉPICE (débriefs.json, liée au site) : on CONSERVE les données du raid
//    (retours, compo, analyse, historique). On marque seulement le post comme
//    retiré (discord.cleaned) pour que le nettoyage auto ne le reprenne pas.
//    → retourne 'kept'. La suppression réelle se fait depuis le site (admin).
//  - Autres types (store Discord séparé = simple jauge d'intérêt) : suppression
//    complète de la fiche. → retourne 'removed'.
function delete_sortie_by_id($id) {
    $d = read_data();
    foreach ($d['sorties'] as &$s) {
        if (($s['id'] ?? '') === $id) {
            $s['discord']['cleaned'] = true; // post retiré, données conservées
            write_data($d);
            return 'kept';
        }
    }
    unset($s);
    $ds = read_dstore(); $n = count($ds['sorties']);
    $ds['sorties'] = array_values(array_filter($ds['sorties'], function ($s) use ($id) { return ($s['id'] ?? '') !== $id; }));
    if (count($ds['sorties']) !== $n) { write_dstore($ds); return 'removed'; }
    return false;
}

// Supprime un message Discord via l'API (auth bot token).
function discord_delete_message_api($channelId, $messageId) {
    global $CFG;
    if (!$channelId || !$messageId || empty($CFG['bot_token']) || !function_exists('curl_init')) return;
    $ch = curl_init("https://discord.com/api/v10/channels/{$channelId}/messages/{$messageId}");
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => 'DELETE',
        CURLOPT_HTTPHEADER     => ['Authorization: Bot ' . $CFG['bot_token']],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 2,
        CURLOPT_TIMEOUT        => 3,
    ]);
    curl_exec($ch);
    curl_close($ch);
}


// ============================================================
//  RENDU DE L'ENCART (embed + composants)
// ============================================================
function build_sortie_message($sortie) {
    $desc = '';
    if (trim($sortie['description'] ?? '') !== '') $desc .= $sortie['description'] . "\n\n";
    $when = trim(($sortie['date'] ?? '') . ' · ' . ($sortie['heure'] ?? ''), ' ·');
    if ($when !== '')                          $desc .= "📅 **{$when}**\n";
    if (fmt_duree($sortie['duree'] ?? '') !== '') $desc .= "⏱️ Durée : " . fmt_duree($sortie['duree']) . "\n";
    if (trim($sortie['zone'] ?? '') !== '')    $desc .= "📍 " . $sortie['zone'] . "\n";

    $signups = $sortie['signups'] ?? [];
    $bullet  = function ($n) { return "• {$n}"; };
    // Statut par défaut 'present' (rétro-compat : anciennes inscriptions sans champ statut).
    $st = function ($su) { return $su['statut'] ?? 'present'; };

    // "X/N inscrits" = uniquement les présents (ceux qui prennent une place).
    $nb = 0;
    foreach ($signups as $su) { if ($st($su) === 'present') $nb++; }
    $desc .= "👥 **{$nb}** inscrit" . ($nb > 1 ? 's' : '');

    $t         = sortie_type($sortie['type'] ?? 'epice');
    $usePostes = $t['postes'];

    $fields = [];
    if ($usePostes) {
        // ÉPICE : un champ par poste (présents regroupés)
        foreach (POSTES as $pid => $plabel) {
            $names = [];
            foreach ($signups as $su) { if ($st($su) === 'present' && ($su['poste'] ?? '') === $pid) $names[] = $su['name']; }
            $icon = POSTE_ICON[$pid] ?? '•';
            $fields[] = [
                'name'   => "{$icon} {$plabel} (" . count($names) . ")",
                'value'  => $names ? implode("\n", array_map($bullet, $names)) : "—",
                'inline' => true,
            ];
        }
    } else {
        // AUTRES TYPES : une seule colonne « Présents » (RSVP)
        $presentNames = [];
        foreach ($signups as $su) { if ($st($su) === 'present') $presentNames[] = $su['name']; }
        $fields[] = [
            'name'   => "✅ Présents (" . count($presentNames) . ")",
            'value'  => $presentNames ? implode("\n", array_map($bullet, $presentNames)) : "—",
            'inline' => true,
        ];
    }

    // Champs Peut-être / Absent (communs à tous les types)
    $maybeNames = []; $absentNames = [];
    foreach ($signups as $su) {
        if ($st($su) === 'maybe')  $maybeNames[]  = $su['name'];
        if ($st($su) === 'absent') $absentNames[] = $su['name'];
    }
    $fields[] = [
        'name'   => "❓ Peut-être (" . count($maybeNames) . ")",
        'value'  => $maybeNames ? implode("\n", array_map($bullet, $maybeNames)) : "—",
        'inline' => true,
    ];
    $fields[] = [
        'name'   => "✖️ Absent (" . count($absentNames) . ")",
        'value'  => $absentNames ? implode("\n", array_map($bullet, $absentNames)) : "—",
        'inline' => true,
    ];

    $embed = [
        'title'       => $t['icon'] . ' ' . ($sortie['titre'] ?? 'Sortie'),
        'description' => $desc,
        'color'       => hexdec('D4A23B'), // doré Dune
        'fields'      => $fields,
        'footer'      => ['text' => $t['label'] . ' · organisé par ' . ($sortie['createur'] ?? '?') . ' · inscris-toi ci-dessous'],
    ];

    // Bannière par type (config 'banners'[type]) avec repli sur 'banner_url'.
    global $CFG;
    $stype  = $sortie['type'] ?? 'epice';
    $banner = $CFG['banners'][$stype] ?? ($CFG['banner_url'] ?? '');
    if (!empty($banner)) $embed['image'] = ['url' => $banner];

    $sid = $sortie['id'];
    if ($usePostes) {
        // ÉPICE : menu déroulant de postes + boutons peut-être / absent / désinscription.
        $options = [];
        foreach (POSTES as $pid => $plabel) {
            $options[] = ['label' => $plabel, 'value' => $pid, 'emoji' => ['name' => POSTE_ICON[$pid] ?? '✅']];
        }
        $components = [
            ['type' => 1, 'components' => [[
                'type' => 3, 'custom_id' => "signup:{$sid}",
                'placeholder' => "M'inscrire à un poste", 'options' => $options,
            ]]],
            ['type' => 1, 'components' => [
                ['type' => 2, 'style' => 1, 'label' => 'Peut-être',      'emoji' => ['name' => '❓'], 'custom_id' => "maybe:{$sid}"],
                ['type' => 2, 'style' => 4, 'label' => 'Absent',         'emoji' => ['name' => '✖️'], 'custom_id' => "absent:{$sid}"],
                ['type' => 2, 'style' => 2, 'label' => 'Me désinscrire', 'custom_id' => "unsignup:{$sid}"],
            ]],
        ];
    } else {
        // AUTRES TYPES : RSVP simple (Présent / Peut-être / Absent / Me désinscrire).
        $components = [
            ['type' => 1, 'components' => [
                ['type' => 2, 'style' => 3, 'label' => 'Présent',        'emoji' => ['name' => '✅'], 'custom_id' => "present:{$sid}"],
                ['type' => 2, 'style' => 1, 'label' => 'Peut-être',      'emoji' => ['name' => '❓'], 'custom_id' => "maybe:{$sid}"],
                ['type' => 2, 'style' => 4, 'label' => 'Absent',         'emoji' => ['name' => '✖️'], 'custom_id' => "absent:{$sid}"],
                ['type' => 2, 'style' => 2, 'label' => 'Me désinscrire', 'custom_id' => "unsignup:{$sid}"],
            ]],
        ];
    }

    // Rangée gestion : Modifier / Supprimer (boutons visibles par tous, mais
    // n'agissent QUE pour le créateur — Discord ne sait pas masquer par utilisateur).
    $components[] = ['type' => 1, 'components' => [
        ['type' => 2, 'style' => 2, 'label' => 'Modifier',  'emoji' => ['name' => '✏️'], 'custom_id' => "edit:{$sid}"],
        ['type' => 2, 'style' => 4, 'label' => 'Supprimer', 'emoji' => ['name' => '🗑️'], 'custom_id' => "del:{$sid}"],
    ]];

    return ['embeds' => [$embed], 'components' => $components];
}


// ============================================================
//  OUTILS
// ============================================================

// Réponse message simple. $ephemeral = visible du seul cliqueur.
function respond_message($text, $ephemeral = false) {
    $data = ['content' => $text];
    if ($ephemeral) $data['flags'] = 64;
    echo json_encode(['type' => 4, 'data' => $data]);
    exit;
}

// Met à jour le message du composant (type 7) — transforme l'éphémère de confirmation en résultat.
function respond_update($text) {
    echo json_encode(['type' => 7, 'data' => ['content' => $text, 'components' => []]]);
    exit;
}

// Extrait les champs d'un modal soumis en tableau id => valeur.
function modal_values($body) {
    $out = [];
    foreach ($body['data']['components'] ?? [] as $row) {
        foreach ($row['components'] ?? [] as $c) {
            if (isset($c['custom_id'])) $out[$c['custom_id']] = $c['value'] ?? '';
        }
    }
    return $out;
}

// Identité du cliqueur (en serveur : member.user ; en MP : user).
function interaction_user($body) {
    $u = $body['member']['user'] ?? ($body['user'] ?? []);
    $name = trim($u['global_name'] ?? '') ?: trim($u['username'] ?? '') ?: 'Inconnu';
    return ['id' => $u['id'] ?? '', 'name' => $name];
}

// Parse "25-06-2026 21:00" (et variantes) → [Y-m-d, H:i]. Tolérant.
function parse_when($s) {
    $s = trim($s);
    if ($s === '') return ['', ''];
    foreach (['d-m-Y H:i', 'd/m/Y H:i', 'Y-m-d H:i', 'd-m-Y', 'd/m/Y', 'Y-m-d'] as $fmt) {
        $dt = DateTime::createFromFormat($fmt, $s);
        if ($dt instanceof DateTime) {
            $heure = (strpos($fmt, 'H:i') !== false) ? $dt->format('H:i') : '';
            return [$dt->format('Y-m-d'), $heure];
        }
    }
    $ts = strtotime($s);
    if ($ts) return [date('Y-m-d', $ts), date('H:i', $ts)];
    return [$s, '']; // illisible : on garde le texte brut en "date"
}

// --- Stockage partagé avec data-api.php (même fichier, même verrou) ---
function data_file() {
    $dir = __DIR__ . '/data';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    return $dir . '/debriefs.json';
}
function read_data(): array {
    $f = data_file();
    if (!file_exists($f)) return ['soiree_active' => null, 'sorties' => []];
    return json_decode(file_get_contents($f), true) ?? ['soiree_active' => null, 'sorties' => []];
}
function write_data(array $data): void {
    $fp = @fopen(data_file(), 'c+');
    if (!$fp) { dlog('write_data: ouverture impossible (droits ?)'); return; }
    if (flock($fp, LOCK_EX)) {
        ftruncate($fp, 0); rewind($fp);
        fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        fflush($fp);
        flock($fp, LOCK_UN);
    }
    fclose($fp);
}

// --- Store séparé des sorties NON-épice (Labo/Farm/Landsraad) : ne touche pas au débrief ---
function dstore_file() {
    $dir = __DIR__ . '/data';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    return $dir . '/discord_sorties.json';
}
function read_dstore(): array {
    $f = dstore_file();
    if (!file_exists($f)) return ['sorties' => []];
    return json_decode(file_get_contents($f), true) ?? ['sorties' => []];
}
function write_dstore(array $data): void {
    $fp = @fopen(dstore_file(), 'c+');
    if (!$fp) { dlog('write_dstore: ouverture impossible (droits ?)'); return; }
    if (flock($fp, LOCK_EX)) {
        ftruncate($fp, 0); rewind($fp);
        fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        fflush($fp);
        flock($fp, LOCK_UN);
    }
    fclose($fp);
}
