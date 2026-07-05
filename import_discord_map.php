<?php
// ============================================================
//  import_discord_map.php — pré-charge le mapping "Discord ↔ pseudo site"
//
//  Outil d'amorçage (one-shot), réservé aux ADMINS.
//  Abarrach se connecte via la page mot de passe cachée (sietch-tabr.html)
//  pour obtenir une session admin, puis ouvre cette page.
//
//  Entrée : CSV (export Excel "CSV UTF-8"), collé ou téléversé.
//    Entête attendu (ordre libre, séparateur ; ou , ou tab) :
//      id_discord ; pseudo_discord ; pseudo_site
//    - id_discord    : facultatif mais RECOMMANDÉ (lien définitif, immuable)
//    - pseudo_discord: utilisé pour relier l'id à la 1re connexion si l'id manque
//    - pseudo_site   : OBLIGATOIRE (clé des données existantes du site)
//
//  Effet : pour chaque ligne, on retrouve le compte du site par pseudo
//  et on lui pose discord_id (si fourni) et/ou discord_match (pseudo
//  Discord). Compte inexistant → créé (stub, role user).
// ============================================================

require_once __DIR__ . '/discord_oauth.php';

// --- Garde admin ---
if (($_SESSION['role'] ?? '') !== 'admin') {
    http_response_code(403);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><meta charset="UTF-8"><body style="background:#0a0603;color:#cda434;font-family:sans-serif;text-align:center;padding-top:20vh">'
       . '<h2>🔒 Réservé aux administrateurs</h2>'
       . '<p>Connecte-toi d\'abord en tant qu\'admin via la page mot de passe (<a href="sietch-tabr.html" style="color:#d4a23b">sietch-tabr.html</a>).</p></body>';
    exit;
}

/** Normalise un entête (minuscule, sans accents/espaces). */
function dmap_norm(string $s): string {
    $s = dco_lc(trim($s));
    $s = strtr($s, ['é'=>'e','è'=>'e','ê'=>'e','à'=>'a','î'=>'i','ï'=>'i','ô'=>'o','û'=>'u','ç'=>'c']);
    return preg_replace('/[^a-z0-9]/', '', $s);
}

/** Détecte le séparateur le plus probable d'une ligne. */
function dmap_delim(string $line): string {
    $best = ';'; $max = 0;
    foreach ([';', ',', "\t", '|'] as $d) {
        $n = substr_count($line, $d);
        if ($n > $max) { $max = $n; $best = $d; }
    }
    return $best;
}

$report = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $csv = '';
    if (!empty($_FILES['csvfile']['tmp_name']) && is_uploaded_file($_FILES['csvfile']['tmp_name'])) {
        $csv = file_get_contents($_FILES['csvfile']['tmp_name']);
    } else {
        $csv = $_POST['csvtext'] ?? '';
    }
    $dryRun = !empty($_POST['dryrun']);

    // Nettoyage BOM + normalisation des fins de ligne
    $csv = preg_replace('/^\xEF\xBB\xBF/', '', $csv);
    $csv = str_replace(["\r\n", "\r"], "\n", trim($csv));
    $lines = array_values(array_filter(explode("\n", $csv), fn($l) => trim($l) !== ''));

    if (count($lines) < 2) {
        $report = ['error' => 'Il faut au moins une ligne d\'entête + une ligne de données.'];
    } else {
        $delim = dmap_delim($lines[0]);
        $head  = array_map('dmap_norm', str_getcsv($lines[0], $delim));

        // Repérage des colonnes (ordre libre)
        $idCol = $discCol = $siteCol = -1;
        foreach ($head as $i => $h) {
            if ($idCol < 0   && strpos($h, 'id') !== false)                                   { $idCol = $i;   continue; }
            if ($discCol < 0 && strpos($h, 'discord') !== false)                              { $discCol = $i; continue; }
            if ($siteCol < 0 && (strpos($h, 'site') !== false || strpos($h, 'jeu') !== false)) { $siteCol = $i; continue; }
        }
        // Repli positionnel si l'entête n'est pas reconnu
        if ($siteCol < 0 && $discCol < 0 && $idCol < 0) {
            $cols = count($head);
            if ($cols >= 3) { $idCol = 0; $discCol = 1; $siteCol = 2; }
            elseif ($cols === 2) { $discCol = 0; $siteCol = 1; }
        }

        if ($siteCol < 0) {
            $report = ['error' => 'Colonne "pseudo_site" introuvable. Entête attendu : id_discord ; pseudo_discord ; pseudo_site.'];
        } else {
            $users = dco_read_users();
            // Index pseudo (insensible à la casse + trim contre espaces/\r cachés)
            $byName = [];
            foreach ($users as $i => $u) { $byName[dco_lc(trim((string)($u['user'] ?? '')))] = $i; }

            $rows = [];
            $nMatched = $nCreated = $nLinkedId = $nLinkedName = 0;

            for ($r = 1; $r < count($lines); $r++) {
                $cells = str_getcsv($lines[$r], $delim);
                $site  = trim($cells[$siteCol] ?? '');
                $disc  = $discCol >= 0 ? trim($cells[$discCol] ?? '') : '';
                $idRaw = $idCol  >= 0 ? trim($cells[$idCol]  ?? '') : '';
                $id    = preg_match('/^\d{5,}$/', $idRaw) ? $idRaw : '';

                if ($site === '') { $rows[] = ['site'=>'(vide)','status'=>'ignorée (pseudo_site vide)']; continue; }

                $key = dco_lc($site);
                if (isset($byName[$key])) {
                    $idx = $byName[$key];
                    $status = [];
                    if ($id !== '')   { $users[$idx]['discord_id'] = $id; $status[] = 'id lié'; $nLinkedId++; }
                    if ($disc !== '') { $users[$idx]['discord_match'] = $disc; $status[] = 'pseudo Discord'; if ($id==='') $nLinkedName++; }
                    $rows[] = ['site'=>$site, 'discord'=>$disc, 'id'=>$id, 'status'=>'trouvé · ' . (implode(' + ', $status) ?: 'rien à lier')];
                    $nMatched++;
                } else {
                    $new = ['user'=>$site, 'role'=>'user'];
                    if ($id !== '')   { $new['discord_id'] = $id; $nLinkedId++; }
                    if ($disc !== '') { $new['discord_match'] = $disc; if ($id==='') $nLinkedName++; }
                    $users[] = $new;
                    $byName[$key] = count($users) - 1;
                    $rows[] = ['site'=>$site, 'discord'=>$disc, 'id'=>$id, 'status'=>'CRÉÉ (nouveau compte)'];
                    $nCreated++;
                }
            }

            $written = false;
            if (!$dryRun) { $written = dco_write_users($users); }

            $report = [
                'rows' => $rows,
                'summary' => compact('nMatched','nCreated','nLinkedId','nLinkedName'),
                'delim' => $delim === "\t" ? 'tab' : $delim,
                'dry' => $dryRun,
                'written' => $written,
            ];
        }
    }
}
?><!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Import mapping Discord ↔ site</title>
<style>
  body{margin:0;background:#0a0603;color:#cda434;font-family:'Segoe UI',sans-serif;padding:30px;line-height:1.5}
  h1{font-size:1.3rem;letter-spacing:1px} h2{font-size:1rem;color:#d4a23b;margin-top:28px}
  .card{max-width:860px;margin:0 auto}
  textarea{width:100%;height:200px;background:#160d05;color:#e8c876;border:1px solid #5a3e14;border-radius:4px;padding:10px;font-family:monospace;font-size:13px}
  input[type=file]{color:#9a8050;margin:8px 0}
  button{padding:11px 26px;border:1px solid #d4a23b;border-radius:4px;background:linear-gradient(180deg,#2e1c08,#1a0f04);color:#cda434;font-weight:bold;text-transform:uppercase;letter-spacing:1px;cursor:pointer;margin:6px 6px 0 0}
  button:hover{background:#3d2610;color:#fff}
  label.chk{display:inline-block;margin:10px 0;color:#9a8050}
  table{border-collapse:collapse;width:100%;margin-top:12px;font-size:13px}
  th,td{border:1px solid #3d2b10;padding:6px 8px;text-align:left}
  th{background:#1a1007;color:#d4a23b}
  .ok{color:#5dbb8a}.warn{color:#e8a13b}.new{color:#7fb3e8}.err{color:#ff6b6b}
  code{background:#1a1007;padding:2px 6px;border-radius:3px;color:#e8c876}
  a{color:#d4a23b}
</style></head>
<body><div class="card">
  <h1>⚙️ Import du mapping Discord ↔ pseudo du site</h1>
  <p style="color:#9a8050">Colle le CSV (export Excel « CSV UTF-8 ») ou téléverse le fichier. Entête (ordre libre) :
     <code>id_discord ; pseudo_discord ; pseudo_site</code>. <code>pseudo_site</code> obligatoire ;
     <code>id_discord</code> recommandé (lien définitif).</p>

  <?php if ($report && isset($report['error'])): ?>
    <p class="err">❌ <?= htmlspecialchars($report['error']) ?></p>
  <?php elseif ($report): ?>
    <h2><?= $report['dry'] ? '👁️ Aperçu (rien enregistré)' : ($report['written'] ? '✅ Import enregistré' : '⚠️ Échec d\'écriture du fichier') ?></h2>
    <p style="color:#9a8050">Séparateur détecté : <code><?= htmlspecialchars($report['delim']) ?></code> ·
       Trouvés : <b><?= $report['summary']['nMatched'] ?></b> ·
       Créés : <b><?= $report['summary']['nCreated'] ?></b> ·
       Liés par id : <b><?= $report['summary']['nLinkedId'] ?></b> ·
       Liés par pseudo : <b><?= $report['summary']['nLinkedName'] ?></b></p>
    <table><tr><th>pseudo_site</th><th>pseudo_discord</th><th>id_discord</th><th>résultat</th></tr>
    <?php foreach ($report['rows'] as $row):
        $cls = strpos($row['status'],'CRÉÉ')!==false ? 'new' : (strpos($row['status'],'ignorée')!==false ? 'warn' : 'ok'); ?>
      <tr><td><?= htmlspecialchars($row['site']) ?></td>
          <td><?= htmlspecialchars($row['discord'] ?? '') ?></td>
          <td><?= htmlspecialchars($row['id'] ?? '') ?></td>
          <td class="<?= $cls ?>"><?= htmlspecialchars($row['status']) ?></td></tr>
    <?php endforeach; ?>
    </table>
  <?php endif; ?>

  <h2>Nouvel import</h2>
  <form method="post" enctype="multipart/form-data">
    <textarea name="csvtext" placeholder="id_discord;pseudo_discord;pseudo_site&#10;123456789012345678;Abarrach;Abarrach&#10;..."><?= isset($_POST['csvtext']) ? htmlspecialchars($_POST['csvtext']) : '' ?></textarea>
    <div>… ou fichier : <input type="file" name="csvfile" accept=".csv,.txt"></div>
    <label class="chk"><input type="checkbox" name="dryrun" value="1" checked> Mode aperçu (ne rien écrire — décoche pour appliquer)</label><br>
    <button type="submit">Analyser / Importer</button>
    <a href="account.html" style="margin-left:14px">← Mon compte</a>
  </form>
</div></body></html>
