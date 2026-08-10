<?php
// ============================================================
//  REGISTRE DES PLANS DE LA GUILDE
//
//  Répond à deux questions qu'aucun outil ne tranche aujourd'hui :
//    · qui peut me crafter tel plan ?
//    · que manque-t-il à la guilde ENTIÈRE ?
//
//  Ce qu'on stocke : les plans POSSÉDÉS de chaque membre, avec pour chacun ses
//  CHARGES et son RANG. Les trois sont indispensables ensemble :
//    · savoir qu'une personne « a » un plan ne dit pas si elle peut crafter — il y a
//      six rangs, et le rang 0 ne produit pas ce que le rang 5 produit ;
//    · sans les charges, tout le monde sollicite la même personne, y compris quand
//      il ne lui en reste qu'une. C'est l'argument de la répartition de charge.
//  Format : { <id> : { c: <charges> } }            pour un objet sans rangs (T1..T5)
//           { <id> : { r: { "0": n, "5": n } } }   pour un objet à rangs (T6)
//  Une entrée VIDE est valide : elle vient de l'ancien export de l'addon, qui dit
//  « possédé » sans connaître rang ni charges. Mieux vaut un membre au registre avec
//  une information partielle qu'un membre absent — mais elle est marquée comme telle
//  à la lecture, jamais présentée comme un zéro.
//
//  PARTAGE VOLONTAIRE. Un membre qui n'a jamais cliqué « Partager » n'existe pas
//  dans ce fichier, et `retirer` efface réellement son entrée — pas seulement son
//  affichage. Le registre SERT la personne listée (on la sollicite pour ce qu'elle
//  sait faire) : c'est ce qui le distingue du suivi d'activité, resté admin-only.
//  Conséquence assumée : ni classement, ni annonce automatique quand quelqu'un
//  apprend un plan.
// ============================================================

header('Content-Type: application/json; charset=utf-8');
date_default_timezone_set('Europe/Paris');

// Session partagée avec le reste du site (cookie 30 j, cf. discord_oauth.php).
require_once __DIR__ . '/discord_oauth.php';

const PLANS_STORE   = __DIR__ . '/plans_guilde.json';
const PLANS_UNIVERS = __DIR__ . '/plans_uniques.json';

function pj_out(bool $ok, array $payload = [], string $err = ''): void {
    echo json_encode($ok ? (['ok' => true] + $payload) : ['ok' => false, 'error' => $err],
        JSON_UNESCAPED_UNICODE);
    exit;
}

/** Identité du membre connecté. Jamais de pseudo envoyé par le client : la session fait foi. */
function pj_moi(): array {
    $id = (string)($_SESSION['discord_id'] ?? '');
    $ps = (string)($_SESSION['user'] ?? '');
    if ($ps === '') pj_out(false, [], 'Connecte-toi pour utiliser le registre.');
    // Repli sur le pseudo si le compte n'est pas lié à Discord : le registre doit
    // rester utilisable par un membre créé avant l'authentification Discord.
    return ['id' => $id !== '' ? $id : 'pseudo:' . $ps, 'pseudo' => $ps];
}

function pj_lire(): array {
    if (!file_exists(PLANS_STORE)) return ['membres' => []];
    $d = json_decode((string)@file_get_contents(PLANS_STORE), true);
    if (!is_array($d) || !isset($d['membres']) || !is_array($d['membres'])) return ['membres' => []];
    return $d;
}

/**
 * Écriture sous verrou EXCLUSIF non bloquant. Deux membres qui partagent en même
 * temps écrasent sinon l'un l'autre en silence — même précaution que `data-api.php`,
 * et le même choix : échouer franchement plutôt que perdre une écriture.
 */
function pj_ecrire(array $d): bool {
    $fp = @fopen(PLANS_STORE, 'c+');
    if (!$fp) return false;
    if (!flock($fp, LOCK_EX | LOCK_NB)) { fclose($fp); return false; }
    ftruncate($fp, 0); rewind($fp);
    fwrite($fp, json_encode($d, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    fflush($fp); flock($fp, LOCK_UN); fclose($fp);
    @chmod(PLANS_STORE, 0664);
    return true;
}

function pj_univers(): array {
    if (!file_exists(PLANS_UNIVERS)) return [];
    $d = json_decode((string)@file_get_contents(PLANS_UNIVERS), true);
    return (is_array($d) && isset($d['plans']) && is_array($d['plans'])) ? $d['plans'] : [];
}

$action = $_GET['action'] ?? '';
$input  = json_decode(file_get_contents('php://input'), true) ?: [];
if ($action === '') $action = (string)($input['action'] ?? '');

switch ($action) {

// ---- Ce que le membre connecté partage aujourd'hui ----------
case 'me': {
    $moi = pj_moi();
    $d   = pj_lire();
    $m   = $d['membres'][$moi['id']] ?? null;
    pj_out(true, [
        'partage'    => $m !== null,
        'maj'        => $m['maj'] ?? null,
        'nb_possede' => $m ? count($m['possede']) : 0,
        'nb_membres' => count($d['membres']),
    ]);
}

// ---- Partager / mettre à jour sa liste ----------------------
case 'partager': {
    $moi = pj_moi();
    $recu = $input['possedes'] ?? null;
    if (!is_array($recu)) pj_out(false, [], 'Liste des plans possédés manquante.');

    $univers = pj_univers();
    if (!$univers) pj_out(false, [], 'Univers des plans absent côté serveur (plans_uniques.json).');

    // Nettoyage strict. On ne garde que des identifiants connus de l'univers — un
    // identifiant inventé ou un plan hors périmètre fausserait les angles morts — et
    // on borne les valeurs : le client n'écrit jamais directement dans le registre.
    //   'c' = charges d'un objet SANS rangs (T1..T5)
    //   'r' = charges PAR RANG (T6), clé 0..5
    $propre = [];
    foreach ($recu as $id => $e) {
        $id = strtolower(trim((string)$id));
        if ($id === '' || !isset($univers[$id])) continue;
        $entree = [];
        if (is_array($e)) {
            if (isset($e['c']) && is_numeric($e['c'])) $entree['c'] = max(0, (int)$e['c']);
            if (isset($e['r']) && is_array($e['r'])) {
                $rangs = [];
                foreach ($e['r'] as $g => $n) {
                    $g = (int)$g;
                    if ($g < 0 || $g > 5 || !is_numeric($n)) continue;
                    $rangs[(string)$g] = max(0, (int)$n);
                }
                if ($rangs) { ksort($rangs); $entree['r'] = $rangs; }
            }
        }
        // Une entrée vide reste valide : elle vient de l'ancien export de l'addon, qui
        // dit « possédé » sans savoir ni le rang ni les charges. Mieux vaut un membre
        // au registre avec une information partielle qu'un membre absent.
        $propre[$id] = $entree;
    }

    $d = pj_lire();
    $d['membres'][$moi['id']] = [
        'pseudo'  => $moi['pseudo'],
        'maj'     => date('c'),
        'source'  => ($input['source'] ?? '') === 'companion' ? 'companion' : 'addon',
        'possede' => $propre,
    ];
    if (!pj_ecrire($d)) pj_out(false, [], 'Registre occupé, réessaie dans quelques secondes.');

    $craftables = 0;
    foreach ($propre as $e) {
        // « Craftable maintenant » = au moins une charge quelque part. Un plan appris
        // mais épuisé (0) compte comme connu, pas comme disponible — c'est toute la
        // raison d'avoir demandé les charges.
        if ((isset($e['c']) && $e['c'] > 0) || (isset($e['r']) && max($e['r']) > 0)) $craftables++;
        elseif (!$e) $craftables++;   // information partielle (ancien export) : on ne présume pas d'un zéro
    }
    pj_out(true, [
        'nb_possede'   => count($propre),
        'nb_craftable' => $craftables,
        'nb_univers'   => count($univers),
    ]);
}

// ---- Se retirer (suppression réelle) ------------------------
case 'retirer': {
    $moi = pj_moi();
    $d = pj_lire();
    if (!isset($d['membres'][$moi['id']])) pj_out(true, ['retire' => false]);
    unset($d['membres'][$moi['id']]);
    if (!pj_ecrire($d)) pj_out(false, [], 'Registre occupé, réessaie dans quelques secondes.');
    pj_out(true, ['retire' => true]);
}

// ---- Qui possède un plan donné ? ---------------------------
case 'qui': {
    $id = strtolower(trim((string)($_GET['id'] ?? '')));
    if ($id === '') pj_out(false, [], 'Identifiant de plan manquant.');
    $univers = pj_univers();
    if (!isset($univers[$id])) pj_out(false, [], 'Plan inconnu.');

    $ont = []; $nbPartageurs = 0;
    foreach (pj_lire()['membres'] as $m) {
        $nbPartageurs++;
        if (!isset($m['possede'][$id])) continue;
        $e = $m['possede'][$id];
        // On expose le MEILLEUR RANG atteint et les charges qui l'accompagnent :
        // demander un craft à quelqu'un qui n'a que le rang 0 quand on veut du rang 5
        // fait perdre du temps aux deux. Et sans les charges, tout le monde solliciterait
        // la même personne, y compris quand elle n'en a plus qu'une.
        $rangMax = null; $chargesRang = null;
        foreach (($e['r'] ?? []) as $g => $n) {
            if ($rangMax === null || (int)$g > $rangMax) { $rangMax = (int)$g; $chargesRang = (int)$n; }
        }
        $ont[] = [
            'pseudo'   => $m['pseudo'],
            'maj'      => $m['maj'],
            'charges'  => $e['c'] ?? $chargesRang,
            'rang_max' => $rangMax,
            // Information partielle : vient de l'ancien export, qui dit « possédé »
            // sans connaître ni le rang ni les charges. À afficher comme tel, jamais
            // à présenter comme un zéro.
            'partiel'  => !$e,
        ];
    }
    pj_out(true, ['plan' => $univers[$id], 'ont' => $ont, 'nb_membres' => $nbPartageurs]);
}

// ---- Les angles morts de la guilde -------------------------
//  Le calcul qui justifie tout le reste : ce que PERSONNE n'a (où orienter une
//  sortie), et ce qu'UN SEUL détient (fragilité : s'il ne joue plus, la guilde
//  perd la capacité).
case 'angles_morts': {
    $univers = pj_univers();
    $membres = pj_lire()['membres'];
    if (!$membres) pj_out(true, ['nb_membres' => 0, 'personne' => [], 'unique_detenteur' => []]);

    $personne = []; $seul = [];
    foreach ($univers as $id => $p) {
        $detenteurs = [];
        foreach ($membres as $m) {
            if (isset($m['possede'][$id])) $detenteurs[] = $m['pseudo'];
        }
        if (!$detenteurs)              $personne[] = ['id' => $id] + $p;
        elseif (count($detenteurs) === 1) $seul[]   = ['id' => $id, 'par' => $detenteurs[0]] + $p;
    }
    pj_out(true, [
        'nb_membres'       => count($membres),
        'personne'         => $personne,
        'unique_detenteur' => $seul,
    ]);
}

default:
    pj_out(false, [], 'Action inconnue.');
}
