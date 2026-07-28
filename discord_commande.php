<?php
// ============================================================
//  HANDLERS DE LA COMMANDE /commande (route "commande" du dispatcher)
//
//  Appelé par discord_interactions.php UNIQUEMENT après vérification
//  Ed25519 (constante DUNE_INTERACTIONS_DISPATCHED définie). Reçoit
//  dans son scope : $CFG, $body, $raw.
//
//  Gère :
//   - type 3 (bouton) : cmd_take / cmd_done / cmd_release / cmd_delete
//                       / cmd_delok  → mutation requetes.json + refresh
//                       de l'encart + MP au demandeur.
//   - type 2 (slash)  : /commande creer  → livré au lot 4 (stub pour l'instant).
//   - type 5 (modal)  : cmd_create_modal → idem lot 4.
//
//  Toutes les écritures passent par un verrou exclusif non bloquant
//  sur requetes.json (même patron que le bot Sorties, cf. epice/discord_sortie.php).
// ============================================================

require_once __DIR__ . '/discord_helper.php';

// Catégories proposées par /commande creer (menu natif Discord, 25 max).
// Le libellé affiché aux joueurs part vers le champ "type" de la demande,
// concaténé avec l'objet précis (ex: "Armes · Fusil laser Mk III · T5").
const CATEGORIES = [
    'armes'        => 'Armes',
    'armures'      => 'Armures',
    'outils'       => 'Outils',
    'vehicules'    => 'Véhicules',
    'consommables' => 'Consommables',
    'modules'      => 'Modules',
    'autre'        => 'Autre',
];

function cmd_log($msg) {
    $dir = __DIR__ . '/epice/data';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    @file_put_contents($dir . '/discord_commande.log', date('c') . ' ' . $msg . "\n", FILE_APPEND);
}

// Filet erreurs fatales (sinon Discord n'affiche qu'un générique "Une erreur s'est produite").
register_shutdown_function(function () {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        cmd_log('FATAL (shutdown) : ' . $err['message'] . ' @ ' . $err['file'] . ':' . $err['line']);
    }
});

try {

$type = $body['type'] ?? 0;

// -- COMPOSANTS (boutons) --------------------------------------
if ($type === 3) {
    $cid = (string)($body['data']['custom_id'] ?? '');
    cmd_log('component cid=' . $cid);
    if (strpos($cid, 'cmd_take:')    === 0) { handle_take   ($body, substr($cid, strlen('cmd_take:'))); }
    if (strpos($cid, 'cmd_done:')    === 0) { handle_done   ($body, substr($cid, strlen('cmd_done:'))); }
    if (strpos($cid, 'cmd_release:') === 0) { handle_release($body, substr($cid, strlen('cmd_release:'))); }
    if (strpos($cid, 'cmd_delok:')   === 0) { handle_delete_ok($body, substr($cid, strlen('cmd_delok:'))); }
    if (strpos($cid, 'cmd_delete:')  === 0) { handle_delete_ask($body, substr($cid, strlen('cmd_delete:'))); }
    respond_ephemeral("Action inconnue.");
}

// -- SLASH COMMAND /commande creer categorie:… ------------------
if ($type === 2) {
    $name = $body['data']['name'] ?? '';
    $sub  = $body['data']['options'][0]['name'] ?? '';
    if ($name === 'commande' && $sub === 'creer') {
        $cat = 'autre';
        foreach ($body['data']['options'][0]['options'] ?? [] as $o) {
            if (($o['name'] ?? '') === 'categorie') $cat = (string)($o['value'] ?? 'autre');
        }
        if (!array_key_exists($cat, CATEGORIES)) $cat = 'autre';
        open_create_modal($cat);
    }
    respond_ephemeral("Commande inconnue.");
}

// -- MODAL SUBMIT cmd_create_modal:<categorie> -------------------
if ($type === 5) {
    $cid = (string)($body['data']['custom_id'] ?? '');
    if (strpos($cid, 'cmd_create_modal:') === 0) {
        $cat = substr($cid, strlen('cmd_create_modal:'));
        if (!array_key_exists($cat, CATEGORIES)) $cat = 'autre';
        handle_create_submit($body, $cat);
    }
    respond_ephemeral("Formulaire inconnu.");
}

respond_ephemeral("Type d'interaction non géré.");

} catch (Throwable $e) {
    cmd_log('FATAL (exception) : ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine() . "\n" . $e->getTraceAsString());
    respond_ephemeral("Erreur interne. Réessaie, et préviens un admin si ça persiste.");
}

// ============================================================
//  HANDLERS
// ============================================================

// -- Prise en charge -------------------------------------------
function handle_take($body, $id) {
    $req = find_req($id);
    if (!$req) respond_ephemeral("Cette demande n'existe plus.");
    if (($req['status'] ?? 'pending') !== 'pending') {
        $st = $req['status'] ?? '';
        $msg = $st === 'progress'
            ? "Cette demande est déjà prise en charge par **" . ($req['crafterAssigned'] ?? '?') . "**."
            : "Cette demande est déjà terminée.";
        respond_ephemeral($msg);
    }

    $u = interaction_user_info($body);
    $crafterLabel = $u['pseudo'] !== '' ? $u['pseudo'] : $u['display'];

    $updated = mutate_req($id, function (&$r) use ($crafterLabel, $u) {
        $r['status']            = 'progress';
        $r['crafterAssigned']   = $crafterLabel;
        $r['crafterDiscordId']  = $u['discord_id']; // sert aux checks de droits Terminé/Libérer
    });
    if (!$updated) respond_ephemeral("Impossible d'écrire la demande (fichier verrouillé ?). Réessaie.");

    // On rafraîchit l'encart tout de suite (rester sous 3 s). Pas de MP :
    // le canal commandes est notre unique canal d'info pour ne pas fragmenter
    // les échanges hors du Discord guilde.
    respond_update_encart($updated, /* thanks */ false);
    exit;
}

// -- Terminé ---------------------------------------------------
function handle_done($body, $id) {
    $req = find_req($id);
    if (!$req) respond_ephemeral("Cette demande n'existe plus.");
    if (($req['status'] ?? '') !== 'progress') {
        respond_ephemeral("Cette demande n'est pas en cours de prise en charge.");
    }

    $u = interaction_user_info($body);
    if (!user_is_crafter($u, $req) && !user_is_requester($u, $req) && !$u['is_admin']) {
        respond_ephemeral("✋ Réservé au crafteur (**" . ($req['crafterAssigned'] ?? '?') . "**), au demandeur (**" . ($req['player'] ?? '?') . "**) ou à un admin.");
    }

    $updated = mutate_req($id, function (&$r) { $r['status'] = 'done'; });
    if (!$updated) respond_ephemeral("Impossible d'écrire la demande. Réessaie.");

    respond_update_encart($updated, /* thanks */ true);
    exit;
}

// -- Libérer ---------------------------------------------------
function handle_release($body, $id) {
    $req = find_req($id);
    if (!$req) respond_ephemeral("Cette demande n'existe plus.");
    if (($req['status'] ?? '') !== 'progress') {
        respond_ephemeral("Cette demande n'est pas en cours de prise en charge.");
    }

    $u = interaction_user_info($body);
    if (!user_is_crafter($u, $req) && !$u['is_admin']) {
        respond_ephemeral("✋ Seul **" . ($req['crafterAssigned'] ?? '?') . "** ou un admin peut libérer cette demande.");
    }

    $prevCrafter = $req['crafterAssigned'] ?? '';
    $updated = mutate_req($id, function (&$r) {
        $r['status']           = 'pending';
        $r['crafterAssigned']  = null;
        $r['crafterDiscordId'] = null;
    });
    if (!$updated) respond_ephemeral("Impossible d'écrire la demande. Réessaie.");

    respond_update_encart($updated, /* thanks */ false);
    exit;
}

// -- Suppression : étape 1 (demande de confirmation éphémère) ---
function handle_delete_ask($body, $id) {
    $req = find_req($id);
    if (!$req) respond_ephemeral("Cette demande n'existe plus.");

    $u = interaction_user_info($body);
    if (!user_is_requester($u, $req) && !$u['is_admin']) {
        respond_ephemeral("✋ Réservé au demandeur (**" . ($req['player'] ?? '?') . "**) ou à un admin.");
    }

    echo json_encode(['type' => 4, 'data' => [
        'flags'      => 64, // éphémère
        'content'    => "🗑️ Supprimer définitivement la demande **" . ($req['type'] ?? '?') . "** de **" . ($req['player'] ?? '?') . "** ?\nCette action est irréversible.",
        'components' => [['type' => 1, 'components' => [
            ['type' => 2, 'style' => 4, 'label' => 'Confirmer la suppression', 'emoji' => ['name' => '🗑️'], 'custom_id' => "cmd_delok:{$id}"],
        ]]],
    ]]);
    exit;
}

// -- Suppression : étape 2 (confirmation, effacement effectif) ---
function handle_delete_ok($body, $id) {
    $req = find_req($id);
    if (!$req) { respond_update_ephemeral("🗑️ Cette demande n'existe déjà plus."); }

    $u = interaction_user_info($body);
    if (!user_is_requester($u, $req) && !$u['is_admin']) {
        respond_update_ephemeral("✋ Refusé : réservé au demandeur ou à un admin.");
    }

    $removed = remove_req($id);
    if (!$removed) respond_update_ephemeral("Impossible d'écrire la demande. Réessaie.");

    // 1) Met à jour l'éphémère de confirmation tout de suite (rester sous 3 s).
    echo json_encode(['type' => 7, 'data' => ['content' => "🗑️ Demande supprimée.", 'components' => []]]);
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();

    // 2) Efface l'encart principal en arrière-plan (via bot REST, routé par discordMsgVia).
    if (!empty($removed['discordMsgId'])) discord_delete_message($removed['discordMsgId'], $removed);
    exit;
}

// -- Création : étape 1 (ouverture du modal) --------------------
// Le modal Discord ne supporte que du texte (5 champs max), pas d'upload d'image.
// L'ajout des captures se fait après, depuis le site (case addImagesToRequete de save.php),
// via un lien envoyé dans l'éphémère de confirmation.
function open_create_modal($cat) {
    $catLbl = CATEGORIES[$cat] ?? 'Autre';
    echo json_encode(['type' => 9, 'data' => [
        'custom_id'  => 'cmd_create_modal:' . $cat,
        'title'      => 'Nouvelle commande — ' . $catLbl,
        'components' => [
            ['type' => 1, 'components' => [[
                'type' => 4, 'custom_id' => 'objet', 'label' => "Objet précis",
                'style' => 1, 'required' => true,
                'placeholder' => 'ex : Fusil laser Mk III', 'max_length' => 100,
            ]]],
            ['type' => 1, 'components' => [[
                'type' => 4, 'custom_id' => 'tier', 'label' => "Tier / qualité",
                'style' => 1, 'required' => false,
                'placeholder' => 'ex : T5 unique', 'max_length' => 60,
            ]]],
            ['type' => 1, 'components' => [[
                'type' => 4, 'custom_id' => 'notes', 'label' => "Notes (quantité, matériaux, urgence…)",
                'style' => 2, 'required' => false, 'max_length' => 1000,
            ]]],
        ],
    ]]);
    exit;
}

// -- Création : étape 2 (soumission du modal) -------------------
// Crée la demande dans requetes.json, poste l'encart via bot, répond en éphémère
// avec un lien vers le site pour ajouter les captures.
function handle_create_submit($body, $cat) {
    $v = [];
    foreach ($body['data']['components'] ?? [] as $row) {
        foreach ($row['components'] ?? [] as $c) {
            if (isset($c['custom_id'])) $v[$c['custom_id']] = (string)($c['value'] ?? '');
        }
    }
    $objet = trim($v['objet'] ?? '');
    $tier  = trim($v['tier'] ?? '');
    $notes = trim($v['notes'] ?? '');
    if ($objet === '') respond_ephemeral("L'objet précis est obligatoire.");
    if (strlen($notes) > 1600) $notes = substr($notes, 0, 1600);

    // Construit le libellé de type affiché sur le site + dans l'encart Discord :
    //   "Armes · Fusil laser Mk III"           (tier vide)
    //   "Armes · Fusil laser Mk III · T5 unique" (tier renseigné)
    $catLbl = CATEGORIES[$cat] ?? 'Autre';
    $typeStr = $catLbl . ' · ' . $objet;
    if ($tier !== '') $typeStr .= ' · ' . $tier;

    $u = interaction_user_info($body);
    $playerLabel = $u['pseudo'] !== '' ? $u['pseudo'] : $u['display'];

    // Format aligné sur save.php addRequete : mêmes clés pour rester rétrocompat côté site.
    $newReq = [
        'id'                => uniqid('req_'),
        'player'            => $playerLabel,
        'type'              => $typeStr,
        'notes'             => $notes,
        'image'             => null,
        'images'            => [],
        'status'            => 'pending',
        'crafterAssigned'   => null,
        'crafterDiscordId'  => null,
        'discordMsgId'      => null,
        'discordMsgVia'     => null,
        'siteUrl'           => dune_site_base_url() . '/skills.html?tab=requetes',
        'source'            => 'discord',
        'creatorDiscordId'  => $u['discord_id'], // permet de rattacher la demande à un compte lié plus tard
    ];

    // 1) Écriture DANS requetes.json (verrou exclusif, mêmes conventions que save.php).
    if (!prepend_req($newReq)) {
        respond_ephemeral("Impossible d'écrire la demande (fichier verrouillé ?). Réessaie.");
    }

    // 2) Poste l'encart via bot (fallback webhook si config incomplète — même patron que save.php).
    $post = discord_post_request($newReq, $newReq['siteUrl']);
    if ($post && !empty($post['id'])) {
        mutate_req($newReq['id'], function (&$r) use ($post) {
            $r['discordMsgId']  = $post['id'];
            $r['discordMsgVia'] = $post['via'];
        });
    } else {
        // Log mais on n'annule pas — la demande est créée côté site, l'encart sera juste absent.
        cmd_log('handle_create_submit: post Discord échoué (raison=' . ($GLOBALS['discord_last_error'] ?? '?') . ')');
    }

    // 3) Réponse éphémère à l'auteur avec le lien "Ajouter des captures".
    $addImgsUrl = dune_site_base_url() . '/skills.html?tab=requetes&addImgs=' . urlencode($newReq['id']);
    echo json_encode(['type' => 4, 'data' => [
        'flags'   => 64,
        'content' => "✅ Commande créée : **{$typeStr}**\n📎 [Ajouter des captures]({$addImgsUrl})",
    ]]);
    exit;
}

// Ajoute une demande en tête de requetes.json. Renvoie true en cas de succès.
function prepend_req($req) {
    $fp = @fopen(req_file_path(), 'c+');
    if (!$fp) { cmd_log('prepend_req: fopen impossible (droits ?)'); return false; }
    if (!try_lock($fp)) { cmd_log('prepend_req: verrou non acquis'); fclose($fp); return false; }

    $raw = stream_get_contents($fp);
    $data = json_decode((string)$raw, true);
    if (!is_array($data)) $data = [];
    array_unshift($data, $req);

    ftruncate($fp, 0); rewind($fp);
    fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    return true;
}

// ============================================================
//  RÉPONSES
// ============================================================

// Message éphémère (visible du seul cliqueur).
function respond_ephemeral($text) {
    echo json_encode(['type' => 4, 'data' => ['flags' => 64, 'content' => $text]]);
    exit;
}

// Met à jour un message éphémère existant (utilisé par handle_delete_ok pour signaler un échec/refus).
// Le caller doit exit après. Ne fait AUCUNE action en arrière-plan.
function respond_update_ephemeral($text) {
    echo json_encode(['type' => 7, 'data' => ['content' => $text, 'components' => []]]);
    exit;
}

// Rafraîchit l'encart principal (type 7 = UPDATE_MESSAGE) et rend la main pour permettre
// à l'appelant d'envoyer les MP en arrière-plan (fastcgi_finish_request appelé ici).
// NE FAIT PAS de exit — c'est l'appelant qui exit après avoir envoyé les MP éventuels.
function respond_update_encart($req, $thanks) {
    echo json_encode(['type' => 7, 'data' => build_encart_payload($req, $thanks)]);
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
}

// Payload embed + composants pour l'encart, selon l'état.
function build_encart_payload($req, $thanks) {
    if ($thanks) {
        return [
            'embeds'      => [discord_build_thanks_embed($req)],
            'components'  => [],
            'attachments' => [],
        ];
    }
    $siteUrl = (string)($req['siteUrl'] ?? '');
    return [
        'embeds'     => discord_build_all_embeds($req, $siteUrl),
        'components' => discord_build_components($req),
    ];
}

// ============================================================
//  ACCÈS DONNÉES — requetes.json (mêmes conventions que save.php)
// ============================================================

function req_file_path() { return __DIR__ . '/requetes.json'; }

function find_req($id) {
    $f = req_file_path();
    if (!file_exists($f)) return null;
    $data = json_decode(file_get_contents($f), true);
    if (!is_array($data)) return null;
    foreach ($data as $r) if (($r['id'] ?? '') === $id) return $r;
    return null;
}

function try_lock($fp, $maxWaitSeconds = 1.5) {
    $deadline = microtime(true) + $maxWaitSeconds;
    do {
        if (flock($fp, LOCK_EX | LOCK_NB)) return true;
        usleep(50000);
    } while (microtime(true) < $deadline);
    return false;
}

// Applique $fn sur la demande d'id $id, ré-écrit le fichier, renvoie la demande à jour ou null.
function mutate_req($id, callable $fn) {
    $fp = @fopen(req_file_path(), 'c+');
    if (!$fp) { cmd_log('mutate_req: fopen impossible (droits ?)'); return null; }
    if (!try_lock($fp)) { cmd_log('mutate_req: verrou non acquis'); fclose($fp); return null; }

    $raw = stream_get_contents($fp);
    $data = json_decode((string)$raw, true);
    if (!is_array($data)) $data = [];

    $updated = null;
    foreach ($data as &$r) {
        if (($r['id'] ?? '') === $id) {
            $fn($r);
            $updated = $r;
            break;
        }
    }
    unset($r);

    if ($updated) {
        ftruncate($fp, 0); rewind($fp);
        fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        fflush($fp);
    }
    flock($fp, LOCK_UN);
    fclose($fp);
    return $updated;
}

// Supprime la demande, renvoie l'objet supprimé (pour pouvoir effacer aussi le message Discord).
function remove_req($id) {
    $fp = @fopen(req_file_path(), 'c+');
    if (!$fp) { cmd_log('remove_req: fopen impossible'); return null; }
    if (!try_lock($fp)) { cmd_log('remove_req: verrou non acquis'); fclose($fp); return null; }

    $raw = stream_get_contents($fp);
    $data = json_decode((string)$raw, true);
    if (!is_array($data)) $data = [];

    $removed = null;
    $kept = [];
    foreach ($data as $r) {
        if (!$removed && ($r['id'] ?? '') === $id) { $removed = $r; continue; }
        $kept[] = $r;
    }

    if ($removed) {
        ftruncate($fp, 0); rewind($fp);
        fwrite($fp, json_encode(array_values($kept), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        fflush($fp);
    }
    flock($fp, LOCK_UN);
    fclose($fp);
    return $removed;
}

// ============================================================
//  RÉSOLUTION UTILISATEUR — Discord ↔ site
// ============================================================

function users_file_path() { return __DIR__ . '/users_SECURE_9x.json'; }

function read_users_secure() {
    $f = users_file_path();
    if (!file_exists($f)) return [];
    $data = json_decode(file_get_contents($f), true);
    return is_array($data) ? $data : [];
}

// Renvoie l'objet user complet correspondant à un Discord ID, ou null.
function user_by_discord_id($did) {
    if ($did === '') return null;
    foreach (read_users_secure() as $u) {
        if ((string)($u['discord_id'] ?? '') === (string)$did) return $u;
    }
    return null;
}

// Renvoie l'objet user complet correspondant à un pseudo site (insensible casse), ou null.
function user_by_pseudo($pseudo) {
    if ($pseudo === '') return null;
    foreach (read_users_secure() as $u) {
        if (strcasecmp((string)($u['user'] ?? ''), $pseudo) === 0) return $u;
    }
    return null;
}

// Mappe un pseudo site vers un Discord ID (chaîne vide si pas de compte lié).
function pseudo_to_discord_id($pseudo) {
    $u = user_by_pseudo($pseudo);
    return $u ? (string)($u['discord_id'] ?? '') : '';
}

// Extrait l'utilisateur du corps d'interaction et l'enrichit du contexte site.
function interaction_user_info($body) {
    $u = $body['member']['user'] ?? ($body['user'] ?? []);
    $did  = (string)($u['id'] ?? '');
    $name = trim($u['global_name'] ?? '') ?: trim($u['username'] ?? '') ?: 'Inconnu';

    $site = user_by_discord_id($did);
    return [
        'discord_id' => $did,
        'display'    => $name,                       // display name Discord (fallback quand pas de compte site)
        'pseudo'     => $site ? (string)($site['user'] ?? '') : '',
        'is_admin'   => $site ? (($site['role'] ?? 'user') === 'admin') : false,
    ];
}

function user_is_crafter($u, $req) {
    $cd  = (string)($req['crafterDiscordId'] ?? '');
    $cn  = (string)($req['crafterAssigned']  ?? '');
    if ($cd !== '' && (string)$u['discord_id'] === $cd) return true;
    if ($u['pseudo'] !== '' && strcasecmp($u['pseudo'], $cn) === 0) return true;
    return false;
}

function user_is_requester($u, $req) {
    $pn = (string)($req['player'] ?? '');
    if ($u['pseudo'] !== '' && strcasecmp($u['pseudo'], $pn) === 0) return true;
    // Fallback : compare display name (utilisateurs Discord sans compte site rattaché,
    // demande créée depuis Discord dans le futur lot 4).
    if ($pn !== '' && strcasecmp($u['display'], $pn) === 0) return true;
    return false;
}
