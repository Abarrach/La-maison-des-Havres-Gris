<?php
// ============================================================
//  COMMANDE DISCORD /plan — registre des plans de la guilde
//
//  C'est ICI qu'atterrit la valeur du registre. Le site sert à la saisie (rare,
//  trente secondes) ; Discord sert à la consultation (fréquente), parce que c'est
//  là que vit la guilde. Un outil de site consulté trois fois par semaine ne vaut
//  jamais la même chose que la même réponse dans le salon où les gens sont déjà.
//
//  /plan qui-a <nom>   qui peut crafter, à quel rang, avec combien de charges
//  /plan manque        angles morts : ce que PERSONNE n'a, ce qu'UN SEUL détient
//
//  Réponse PUBLIQUE et non éphémère : une réponse éphémère fait reposer la même
//  question la semaine suivante, alors qu'une réponse visible devient de la
//  connaissance partagée dans le salon.
//
//  Appelé par le dispatcher racine (discord_interactions.php), qui a déjà vérifié
//  la signature Ed25519 — d'où l'absence de contrôle ici, comme discord_commande.php.
// ============================================================

if (!defined('DUNE_INTERACTIONS_DISPATCHED')) {
    http_response_code(403);
    echo 'accès direct interdit';
    exit;
}

// Libellés de tier en français. `plans_uniques.json` les stocke sous leur clé
// interne anglaise : les afficher bruts donnait « TDuraluminum » en pied d'encart.
const PLAN_TIERS = [
    'Copper' => 'Cuivre', 'Iron' => 'Fer', 'Steel' => 'Acier',
    'Aluminum' => 'Aluminium', 'Duraluminum' => 'Duraluminium', 'Plastanium' => 'Plastanium',
];
function dp_tier($t) {
    $t = (string)$t;
    return PLAN_TIERS[$t] ?? ($t !== '' ? $t : '?');
}

const PLAN_UNIVERS = __DIR__ . '/plans_uniques.json';
const PLAN_STORE   = __DIR__ . '/plans_guilde.json';

function dp_json($path, $cle) {
    if (!file_exists($path)) return [];
    $d = json_decode((string)@file_get_contents($path), true);
    return (is_array($d) && isset($d[$cle]) && is_array($d[$cle])) ? $d[$cle] : [];
}

/** Réponse publique (type 4) sous forme d'encart. */
function dp_repondre(array $embed, bool $ephemere = false): void {
    $data = ['embeds' => [$embed]];
    if ($ephemere) $data['flags'] = 64;
    echo json_encode(['type' => 4, 'data' => $data], JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Normalisation identique à celle du site (`plans.html`, `build_plans_index.js`).
 * Elle doit rester alignée des deux côtés, sinon un plan trouvé sur le site
 * resterait introuvable sur Discord — le genre d'écart qu'on ne remarque que
 * lorsqu'un membre insiste.
 */
function dp_norm($s) {
    $s = mb_strtolower_compat((string)$s);
    $s = str_replace(['’', '‘', '`', '´'], "'", $s);
    $s = preg_replace('/\s+/u', ' ', $s);
    $s = preg_replace('/[^a-z0-9\' ]/u', '', $s);
    return trim($s);
}
// Ce serveur n'a PAS mbstring (piège connu, cf. epice/data-api.php et discord_oauth.php) :
// on ne peut donc pas utiliser mb_strtolower. strtolower ne touche pas aux accents,
// ce qui suffit ici puisque la normalisation retire ensuite tout caractère non ASCII.
function mb_strtolower_compat($s) {
    return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
}
function mb_substr_compat($s, $n) {
    return function_exists('mb_substr') ? mb_substr($s, 0, $n, 'UTF-8') : substr($s, 0, $n);
}

// `$body`, `$raw` et `$CFG` viennent du dispatcher, qui inclut ce fichier dans son
// scope après avoir vérifié la signature (même contrat que discord_commande.php).
$type = (int)($body['type'] ?? 0);
$opts = $body['data']['options'][0] ?? [];      // sous-commande
$sub  = (string)($opts['name'] ?? '');

$univers = dp_json(PLAN_UNIVERS, 'plans');
$membres = dp_json(PLAN_STORE, 'membres');

// ============================================================
//  AUTOCOMPLÉTION (type 4) — réponse de type 8, 25 choix maximum
// ============================================================
if ($type === 4) {
    $saisi = '';
    foreach (($opts['options'] ?? []) as $o) {
        if (!empty($o['focused'])) $saisi = (string)($o['value'] ?? '');
    }
    $q = dp_norm($saisi);

    // Sans saisie, on propose ce que la guilde possède : plus utile qu'un ordre
    // alphabétique arbitraire, et ça montre immédiatement que le registre est vivant.
    $possedes = [];
    foreach ($membres as $m) foreach (array_keys($m['possede'] ?? []) as $id) $possedes[$id] = true;

    $choix = [];
    foreach ($univers as $id => $p) {
        $nom = (string)($p['n'] ?? $id);
        if ($q !== '' && strpos(dp_norm($nom), $q) === false) continue;
        if ($q === '' && !isset($possedes[$id])) continue;
        // Un libellé de choix Discord est limité à 100 caractères.
        $etiquette = $nom . (isset($possedes[$id]) ? ' ✅' : '');
        $choix[] = ['name' => mb_substr_compat($etiquette, 100), 'value' => $id];
        if (count($choix) >= 25) break;
    }
    echo json_encode(['type' => 8, 'data' => ['choices' => $choix]], JSON_UNESCAPED_UNICODE);
    exit;
}

// ============================================================
//  /plan qui-a <nom>
// ============================================================
if ($sub === 'qui-a') {
    $id = '';
    foreach (($opts['options'] ?? []) as $o) if (($o['name'] ?? '') === 'nom') $id = (string)($o['value'] ?? '');

    if (!$membres) {
        dp_repondre([
            'title'       => '📋 Registre vide',
            'description' => "Personne n'a encore partagé ses plans.\n"
                           . "Chacun peut le faire en une fois sur le site, page **Plans** — "
                           . "un Ctrl+A sur l'onglet UNIQUES de gaming.tools suffit.",
            'color'       => hexdec('7A6A4A'),
        ]);
    }
    if (!isset($univers[$id])) {
        dp_repondre(['title' => '❔ Plan inconnu',
            'description' => "Choisis un plan dans la liste proposée pendant la saisie.",
            'color' => hexdec('B85428')], true);
    }

    $p = $univers[$id];
    $lignes = [];
    foreach ($membres as $m) {
        if (!isset($m['possede'][$id])) continue;
        $e = $m['possede'][$id];

        if (!$e) {
            // Information partielle (ancien export) : on le DIT au lieu d'afficher un
            // zéro trompeur. Le demandeur saura qu'il faut confirmer avant de compter dessus.
            $lignes[] = '• **' . $m['pseudo'] . '** — possédé (rang et charges inconnus)';
            continue;
        }
        if (isset($e['c'])) {
            $lignes[] = '• **' . $m['pseudo'] . '** — ' . ($e['c'] > 0
                ? $e['c'] . ' charge' . ($e['c'] > 1 ? 's' : '')
                : '_plus de charge_');
            continue;
        }
        // Objet à rangs : on liste les rangs réellement appris, du plus haut au plus bas.
        // Le rang décide de ce que l'objet vaut — l'afficher est tout l'intérêt.
        $rangs = $e['r'] ?? [];
        krsort($rangs, SORT_NUMERIC);
        $bouts = [];
        foreach ($rangs as $g => $n) {
            $bouts[] = 'G' . $g . ' ' . ($n > 0 ? '×' . $n : '(épuisé)');
        }
        $lignes[] = '• **' . $m['pseudo'] . '** — ' . implode(' · ', $bouts);
    }

    $nb = count($membres);
    if (!$lignes) {
        dp_repondre([
            'title'       => '❌ ' . $p['n'],
            'description' => "**Personne ne l'a** parmi les {$nb} membre" . ($nb > 1 ? 's' : '')
                           . " du registre.\nC'est une cible de farm pour la guilde.",
            'color'       => hexdec('B85428'),
            'footer'      => ['text' => dp_tier($p['tier'] ?? '') . ' · ' . ($p['cat'] ?? '?')],
        ]);
    }

    dp_repondre([
        'title'       => '🔨 ' . $p['n'],
        'description' => implode("\n", $lignes),
        'color'       => hexdec('D4A23B'),
        'footer'      => ['text' => dp_tier($p['tier'] ?? '') . ' · ' . ($p['cat'] ?? '?')
                        . ' · ' . $nb . ' membre' . ($nb > 1 ? 's' : '') . ' au registre'],
    ]);
}

// ============================================================
//  /plan manque — les angles morts de la guilde
// ============================================================
if ($sub === 'manque') {
    if (!$membres) {
        dp_repondre(['title' => '📋 Registre vide',
            'description' => "Personne n'a encore partagé ses plans — rien à comparer.",
            'color' => hexdec('7A6A4A')]);
    }

    $personne = []; $seul = [];
    foreach ($univers as $id => $p) {
        $detenteurs = [];
        foreach ($membres as $m) if (isset($m['possede'][$id])) $detenteurs[] = $m['pseudo'];
        if (!$detenteurs)                 $personne[] = $p['n'] ?? $id;
        elseif (count($detenteurs) === 1) $seul[]     = ($p['n'] ?? $id) . ' _(' . $detenteurs[0] . ')_';
    }

    // Un encart Discord plafonne à 1024 caractères par champ : on tronque en le disant,
    // plutôt que de laisser Discord rejeter tout le message.
    $tronque = function (array $l, int $max = 900) {
        $s = ''; $n = 0;
        foreach ($l as $x) {
            if (strlen($s) + strlen($x) + 3 > $max) break;
            $s .= ($s === '' ? '' : ' · ') . $x; $n++;
        }
        if ($n < count($l)) $s .= ' … et ' . (count($l) - $n) . ' autres';
        return $s === '' ? '—' : $s;
    };

    $nb = count($membres);
    dp_repondre([
        'title'  => '🕳️ Angles morts de la guilde',
        'color'  => hexdec('D4A23B'),
        'fields' => [
            ['name'  => '❌ Que personne ne possède (' . count($personne) . ')',
             'value' => $tronque($personne)],
            ['name'  => '⚠️ Détenus par une seule personne (' . count($seul) . ')',
             'value' => $tronque($seul)],
        ],
        'footer' => ['text' => 'Sur ' . count($univers) . ' plans uniques · '
                    . $nb . ' membre' . ($nb > 1 ? 's' : '') . ' au registre'],
    ]);
}

dp_repondre(['title' => 'Sous-commande inconnue', 'color' => hexdec('B85428')], true);
