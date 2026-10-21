<?php
// ============================================================
//  discord_paris.php — parier sur un tournoi PvP depuis Discord
//
//  Le bot poste UN message de paris par tournoi (p_discord_message, dans
//  tournois-api.php) et le réédite au fil du tournoi. Ses boutons arrivent ici :
//    tpari:<tournoi>:<cible>    « Parier » (cible = vainqueur ou id du match) → formulaire
//    tparim:<tournoi>:<cible>   formulaire validé → p_parier(), la MÊME règle que le site
//    tparimes:<tournoi>         « Mes paris » → la liste du membre, en privé
//  Toutes les réponses sont éphémères : seul le parieur les voit, le message
//  public ne montre que des montants par camp (anonyme comme la page).
//
//  Le parieur : son pseudo du site retrouvé par son compte Discord
//  (users_SECURE_9x.json), sinon son nom Discord. Un pari posé sur le site se
//  modifie donc depuis Discord, et inversement.
//
//  Atteint UNIQUEMENT via discord_interactions.php, qui a vérifié la signature
//  (préfixe « tpari » dans sa liste blanche : un préfixe absent = 400 muet).
// ============================================================
if (!defined('DUNE_INTERACTIONS_DISPATCHED')) { http_response_code(403); echo 'accès direct refusé'; exit; }

// Pas de session du site ici (Discord n'a pas de cookie) : celle qu'ouvre
// auth_epice.php ne doit ni poser de cookie ni laisser de fichier derrière elle.
ini_set('session.use_cookies', '0');
define('TOURNOIS_LIB', true);
require __DIR__ . '/tournois-api.php';
if (session_status() === PHP_SESSION_ACTIVE) session_destroy();

header('Content-Type: application/json; charset=utf-8');
$body = json_decode((string)file_get_contents('php://input'), true) ?? [];
$type = (int)($body['type'] ?? 0);
$cid  = (string)($body['data']['custom_id'] ?? '');
[$quoi, $tid, $cible] = array_pad(explode(':', $cid, 3), 3, '');

$u   = $body['member']['user'] ?? ($body['user'] ?? []);
$did = preg_replace('/\D/', '', (string)($u['id'] ?? ''));
$qui = dp_pseudo($did, trim((string)($u['global_name'] ?? '')) ?: trim((string)($u['username'] ?? '')));

try {
    $d = t_read();
    $i = t_index($d, $tid);
    if ($i < 0) throw new RuntimeException('Ce tournoi n\'existe plus.');
    $t = $d['tournois'][$i];
    $P = t_read('paris.json')['tournois'][$tid] ?? [];

    if ($quoi === 'tparimes' && $type === 3) { dp_repondre(dp_mes_paris($t, $P, $qui, $did)); exit; }

    if ($quoi === 'tpari' && $type === 3) {
        echo json_encode(dp_formulaire($t, $P, $cible, $qui, $did), JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($quoi === 'tparim' && $type === 5) {
        $v = dp_valeurs($body);
        $choix = (string)(is_array($v['choix'] ?? null) ? ($v['choix'][0] ?? '') : ($v['choix'] ?? ''));
        $mise  = dp_mise((string)($v['mise'] ?? ''));
        $o = $cible === 'vainqueur' ? [] : dp_fenetre($t, $P, $cible);
        $fait = p_parier($t, $qui, $did, $cible, $choix, $mise, (string)($o['a'] ?? ''), (string)($o['b'] ?? ''));
        $sur = $cible === 'vainqueur' ? 'le vainqueur du tournoi' : p_lib_match($o, $cible);
        if ($fait === 'retire') $txt = "↩️ Pari retiré ({$sur}).";
        else $txt = ($fait === 'modifie' ? '✏️ Pari modifié' : '✅ Pari posé') . ' : **' . p_sol($mise) . ' Solaris** sur **' . p_nom($t, $choix) . "** ({$sur})."
            . ($cible === 'vainqueur' ? "\nIl est définitif." : "\nModifiable jusqu'à la fermeture, <t:" . (int)$o['fin'] . ':R> (mise 0 pour le retirer).')
            . "\nLe banquier **" . (t_banquier_nom($t) ?: '—') . '** fait les comptes en jeu à la fin du tournoi.';
        dp_repondre($txt);
        p_discord_plus_tard($tid);     // cagnottes du message public, après la réponse
        exit;
    }
    throw new RuntimeException('Action inconnue.');
} catch (RuntimeException $e) {
    dp_repondre('⚠️ ' . $e->getMessage());
    exit;
}

// ------------------------------------------------------------------ outils
function dp_repondre(string $texte): void {
    echo json_encode(['type' => 4, 'data' => ['content' => t_cut($texte, 1900), 'flags' => 64,
        'allowed_mentions' => ['parse' => []]]], JSON_UNESCAPED_UNICODE);
}
// Pseudo du site du membre Discord (son compte relié), sinon son nom Discord.
function dp_pseudo(string $did, string $nomDiscord): string {
    $f = dirname(__DIR__) . '/users_SECURE_9x.json';
    if ($did !== '' && is_file($f)) {
        $users = json_decode((string)file_get_contents($f), true);
        foreach (is_array($users) ? $users : [] as $x) {
            if ((string)($x['discord_id'] ?? '') === $did && trim((string)($x['user'] ?? '')) !== '') return t_cut($x['user'], 60);
        }
    }
    return t_cut($nomDiscord, 60);
}
// « 2 000 », « 2000 », « 2k », « 2,5k » → 2000 / 2500. -1 si illisible (refusé par p_parier).
function dp_mise(string $s): int {
    $s = strtolower(str_replace([' ', "\u{00A0}", "\u{202F}", '_', '.'], '', trim($s)));
    if (preg_match('/^(\d+(?:,\d+)?)k$/', $s, $m)) return (int)round((float)str_replace(',', '.', $m[1]) * 1000);
    $s = str_replace(',', '', $s);
    return preg_match('/^\d{1,9}$/', $s) ? (int)$s : -1;
}
// Valeurs d'un formulaire validé : {custom_id: valeur du champ texte | valeurs du menu}.
function dp_valeurs(array $body): array {
    $out = [];
    $marche = function ($c) use (&$out, &$marche) {
        if (!is_array($c)) return;
        if (isset($c['component'])) { $marche($c['component']); return; }
        if (isset($c['components']) && is_array($c['components'])) { foreach ($c['components'] as $x) $marche($x); return; }
        $id = (string)($c['custom_id'] ?? '');
        if ($id === '') return;
        if (isset($c['values']) && is_array($c['values'])) $out[$id] = $c['values'];
        elseif (isset($c['value'])) $out[$id] = (string)$c['value'];
    };
    foreach ($body['data']['components'] ?? [] as $c) $marche($c);
    return $out;
}
// Fenêtre de pari d'un combat encore ouverte, sinon l'explication.
function dp_fenetre(array $t, array $P, string $cible): array {
    if (empty($t['paris'])) throw new RuntimeException('Les paris ne sont pas ouverts sur ce tournoi.');
    if ($t['statut'] !== 'en_cours') throw new RuntimeException($t['statut'] === 'termine' ? 'Le tournoi est terminé : les paris sont clos.' : 'Le tournoi n\'est pas encore lancé.');
    $o = $P['ouvertures'][$cible] ?? null;
    if (!is_array($o)) throw new RuntimeException('Les paris de ce combat ne sont pas ouverts.');
    $e = p_etat_combat($t, $P, $cible, $o, time());
    if ($e === 'joue') throw new RuntimeException('Ce combat est déjà joué.');
    if ($e === 'lance') throw new RuntimeException('Les paris de ce combat sont fermés : il est lancé.');
    return $o;
}
// Son pari actuel sur cette cible (même règle de reconnaissance que p_parier).
function dp_mon_pari(array $P, string $cible, string $qui, string $did): ?array {
    foreach ($P['paris'] ?? [] as $p) {
        if ($p['cible'] !== $cible) continue;
        if (($did !== '' && ($p['discord_id'] ?? '') === $did) || strcasecmp((string)$p['qui'], $qui) === 0) return $p;
    }
    return null;
}
// Libellé d'un participant pour le menu : le nom, et les membres pour une équipe.
function dp_option(array $t, string $id, ?string $choisi, string $desc = ''): array {
    $o = ['label' => t_cut(p_nom($t, $id), 100) ?: '?', 'value' => $id];
    if ($desc === '' && t_taille_equipe($t) > 1) foreach ($t['equipes'] ?? [] as $e) {
        if ($e['id'] === $id) $desc = implode(', ', t_noms_membres($t, $e));
    }
    if ($desc !== '') $o['description'] = t_cut($desc, 100);
    if ($choisi === $id) $o['default'] = true;
    return $o;
}
// Formulaire de pari (type 9) : « Sur qui ? » + « Mise ».
function dp_formulaire(array $t, array $P, string $cible, string $qui, string $did): array {
    $mien = dp_mon_pari($P, $cible, $qui, $did);
    $plafond = p_sol(PLAFOND_PARI);
    if ($cible === 'vainqueur') {
        if (empty($t['paris'])) throw new RuntimeException('Les paris ne sont pas ouverts sur ce tournoi.');
        if ($t['statut'] !== 'preparation') throw new RuntimeException('Les paris sur le vainqueur sont fermés : le tournoi est lancé.');
        if (empty($t['devoile'])) throw new RuntimeException('Les paris sur le vainqueur ouvriront quand l\'organisateur dévoilera l\'arbre.');
        $ids = array_keys(p_participants($t));
        if ($mien && in_array($mien['choix'], $ids, true))
            throw new RuntimeException('Ton pari sur le vainqueur est définitif : ' . p_sol((int)$mien['mise']) . ' Solaris sur ' . p_nom($t, $mien['choix']) . '.');
        // Un menu Discord tient 25 choix ; au-delà, le site prend le relais.
        $options = array_map(function ($id) use ($t) { return dp_option($t, (string)$id, null); }, array_slice($ids, 0, 25));
        $titre = 'Parier · vainqueur du tournoi';
        $intro = "🏆 **Qui remportera le tournoi ?**\nPari **définitif** une fois posé." . (count($ids) > 25 ? "\n_Liste complète sur le site : le menu ne tient que 25 choix._" : '');
        $descMise = "1 à {$plafond} Solaris";
        $valeur = '';
    } else {
        $o = dp_fenetre($t, $P, $cible);
        $a = (string)$o['a']; $b = (string)$o['b'];
        $mien = $mien && p_meme($mien, $a, $b) ? $mien : null;
        // Jamais contre soi : un combattant ne voit que son propre camp.
        $camp = p_camp($t, p_joueur($t, $qui, $did));
        $soi = $camp !== '' && ($camp === $a || $camp === $b);
        $choisi = $mien['choix'] ?? null;
        $options = $soi ? [dp_option($t, $camp, $camp, t_taille_equipe($t) > 1 ? 'Ton équipe : jamais de pari contre toi' : 'Toi : jamais de pari contre toi')]
                        : [dp_option($t, $a, $choisi), dp_option($t, $b, $choisi)];
        $c = p_cagnotte($P, $cible, $a, $b);
        $titre = 'Parier · ' . p_lib_match($o, $cible);
        $intro = '**' . p_lib_match($o, $cible) . '** · ferme <t:' . (int)$o['fin'] . ":R>\n" . p_ligne_camp($t, $c, $a) . ' — ' . p_ligne_camp($t, $c, $b);
        $descMise = "1 à {$plafond} Solaris · 0 pour retirer ton pari";
        $valeur = $mien ? (string)$mien['mise'] : '';
    }
    $mise = ['type' => 4, 'custom_id' => 'mise', 'style' => 1, 'required' => true, 'max_length' => 9, 'placeholder' => 'ex. 2000'];
    if ($valeur !== '') $mise['value'] = $valeur;
    return ['type' => 9, 'data' => [
        'custom_id'  => 'tparim:' . $t['id'] . ':' . $cible,
        'title'      => t_cut($titre, 45),
        'components' => [
            ['type' => 10, 'content' => t_cut($intro, 1800)],
            ['type' => 18, 'label' => 'Sur qui ?', 'component' => ['type' => 3, 'custom_id' => 'choix', 'options' => $options,
                'min_values' => 1, 'max_values' => 1, 'required' => true]],
            ['type' => 18, 'label' => 'Mise en Solaris', 'description' => t_cut($descMise, 100), 'component' => $mise],
        ],
    ]];
}
// « Mes paris » : ses paris sur ce tournoi et où ils en sont. Le gain exact (part
// de la cagnotte) se calcule sur le site, avec le même moteur que le banquier.
function dp_mes_paris(array $t, array $P, string $qui, string $did): string {
    $L = [];
    $now = time();
    foreach ($P['paris'] ?? [] as $p) {
        if (!(($did !== '' && ($p['discord_id'] ?? '') === $did) || strcasecmp((string)$p['qui'], $qui) === 0)) continue;
        $cible = (string)$p['cible'];
        if ($cible === 'vainqueur') {
            $sur = 'Vainqueur du tournoi';
            $champ = '';
            foreach ($t['podium'] ?? [] as $x) if ((int)($x['rang'] ?? 0) === 1) $champ = (string)$x['id'];
            $etat = $t['statut'] !== 'termine' ? '⏳ en attente' : ($champ === $p['choix'] ? '✅ gagné' : '❌ perdu');
        } else {
            $o = $P['ouvertures'][$cible] ?? null;
            $sur = is_array($o) ? p_lib_match($o, $cible) : $cible;
            $r = $t['resultats'][$cible] ?? null;
            if (is_array($r) && p_meme(['a' => (string)($r['p1'] ?? ''), 'b' => (string)($r['p2'] ?? '')], (string)$p['a'], (string)$p['b']))
                $etat = ($r['w'] ?? '') === $p['choix'] ? '✅ gagné' : '❌ perdu';
            elseif (is_array($o) && p_meme($o, (string)$p['a'], (string)$p['b']) && p_etat_combat($t, $P, $cible, $o, $now) === 'ouvert')
                $etat = '🎲 modifiable, ferme <t:' . (int)$o['fin'] . ':R>';
            else $etat = '⚔️ combat en cours';
        }
        $L[] = "› **{$sur}** : " . p_sol((int)$p['mise']) . ' sur **' . p_nom($t, (string)$p['choix']) . "** — {$etat}";
    }
    $cfg = p_discord_cfg($t);
    $lien = ($cfg ? $cfg[2] : 'https://havresgris.ddns.net') . '/epice/tournois.html?t=' . rawurlencode((string)$t['id']);
    if (!$L) return "Tu n'as aucun pari sur **{$t['nom']}**.";
    // Comptes publiés en fin de tournoi : son solde, à régler avec le banquier.
    $solde = '';
    foreach ($P['comptes']['soldes'] ?? [] as $nom => $x) {
        if (!(($did !== '' && ($x['did'] ?? '') === $did) || strcasecmp((string)$nom, $qui) === 0)) continue;
        $n = (int)$x['net'];
        $b = t_banquier_nom($t) ?: 'le banquier';
        $solde = "\n💰 " . ($n > 0 ? 'Tu gagnes **+' . p_sol($n) . "** : **{$b}** te les verse en jeu."
                         : ($n < 0 ? 'Tu dois **' . p_sol(-$n) . "** à **{$b}**." : 'À l\'équilibre : rien à payer ni à recevoir.'));
    }
    return "📋 **Tes paris — {$t['nom']}**\n" . implode("\n", $L) . $solde
         . "\n\n" . ($solde !== '' ? 'Le détail' : 'Le gain exact (ta part de la cagnotte)') . " est sur le site : <{$lien}>";
}
