#!/usr/bin/env python3
"""
fix_frozen_data.py

Outil de secours réutilisable : détecte les périodes où le scraper a tourné
sans erreur mais a rejoué la même capture en boucle (ex. ban IP gaming.tools —
la page se charge depuis un cache/CDN au lieu du direct, aucune erreur levée).

Contrairement à une vraie panne (pas de lignes du tout), ce cas produit de
FAUSSES données plausibles qui polluent silencieusement les moyennes/pics tant
qu'elles n'ont pas vieilli hors des fenêtres de calcul.

Ce script :
  1. Détecte les timestamps où >= FREEZE_THRESHOLD des couples (serveur, sietch)
     ont une valeur strictement identique au relevé précédent, sur un minimum de
     MIN_RUN relevés consécutifs (élimine les faux positifs de basse activité).
  2. Retire ces lignes de dune_counts.csv (sauvegarde de l'original faite avant).
  3. Reconstruit une estimation pour la période concernée : pour chaque couple
     (serveur, sietch), moyenne des BASELINE_DAYS jours réels précédant le début
     de la panne, à la MÊME heure de la journée (préserve le cycle jour/nuit).
     Écrite dans un fichier SÉPARÉ (dune_counts_estimated.csv) — jamais mélangée
     aux données réelles, pour ne jamais fausser les KPI/moyennes/pics.

Usage :
    python fix_frozen_data.py dune_counts.csv
    python fix_frozen_data.py dune_counts.csv --dry-run   (affiche sans écrire)
"""

import argparse
import csv
import shutil
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

FREEZE_THRESHOLD = 0.97   # % de couples identiques au relevé précédent pour suspecter un gel
MIN_RUN = 3               # nb de relevés consécutifs minimum pour confirmer (évite les coïncidences)
BASELINE_DAYS = 10        # fenêtre de référence pour l'estimation (jours réels avant la panne)


def parse_ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace('Z', '+00:00'))


def fmt_ts(dt: datetime) -> str:
    return dt.strftime('%Y-%m-%dT%H:%M:%SZ')


def load_csv(path: Path):
    header = None
    rows = []
    with open(path, newline='', encoding='utf-8') as f:
        reader = csv.reader(f, delimiter=';')
        for row in reader:
            if not row:
                continue
            if row[0].lower().startswith('time'):
                header = row
                continue
            if len(row) < 4:
                continue
            rows.append(row)
    return header or ['timestamp', 'serveur', 'sietch', 'joueurs'], rows


def detect_frozen_timestamps(rows):
    by_ts = defaultdict(dict)
    for ts, srv, sietch, joueurs in rows:
        by_ts[ts][(srv, sietch)] = joueurs

    tslist = sorted(by_ts.keys(), key=parse_ts)
    frozen_flags = {}
    prev_ts = None
    for ts in tslist:
        if prev_ts is not None:
            cur, prev = by_ts[ts], by_ts[prev_ts]
            common = set(cur.keys()) & set(prev.keys())
            same = sum(1 for k in common if cur[k] == prev[k])
            pct = (same / len(common)) if common else 0
            frozen_flags[ts] = pct >= FREEZE_THRESHOLD
        else:
            frozen_flags[ts] = False
        prev_ts = ts

    # Ne garder que les runs consécutifs de longueur >= MIN_RUN
    frozen_ts = set()
    run = []
    for ts in tslist:
        if frozen_flags[ts]:
            run.append(ts)
        else:
            if len(run) >= MIN_RUN:
                frozen_ts.update(run)
            run = []
    if len(run) >= MIN_RUN:
        frozen_ts.update(run)

    return frozen_ts, tslist


def build_estimates(rows, frozen_ts):
    if not frozen_ts:
        return []

    frozen_start = min(frozen_ts, key=parse_ts)
    baseline_cutoff_start = parse_ts(frozen_start) - timedelta(days=BASELINE_DAYS)
    baseline_cutoff_end = parse_ts(frozen_start)

    # baseline[(srv,sietch)][hour] = [somme, compte]  — uniquement sur des relevés NON figés
    baseline = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    frozen_pairs_by_ts = defaultdict(list)  # ts figé -> [(srv,sietch)]

    for ts, srv, sietch, joueurs in rows:
        if ts in frozen_ts:
            frozen_pairs_by_ts[ts].append((srv, sietch))
            continue
        dt = parse_ts(ts)
        if baseline_cutoff_start <= dt < baseline_cutoff_end:
            try:
                v = int(joueurs)
            except ValueError:
                continue
            b = baseline[(srv, sietch)][dt.hour]
            b[0] += v
            b[1] += 1

    estimates = []
    for ts in sorted(frozen_pairs_by_ts.keys(), key=parse_ts):
        hour = parse_ts(ts).hour
        for pair in frozen_pairs_by_ts[ts]:
            b = baseline.get(pair, {}).get(hour)
            if b and b[1] > 0:
                est_val = round(b[0] / b[1])
            else:
                # Pas de référence pour ce couple à cette heure : on ne fabrique rien.
                continue
            estimates.append([ts, pair[0], pair[1], est_val])

    return estimates


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('csv_file', type=Path)
    ap.add_argument('--dry-run', action='store_true', help="Analyse seulement, n'écrit rien")
    args = ap.parse_args()

    header, rows = load_csv(args.csv_file)
    print(f"📄 {len(rows)} lignes lues dans {args.csv_file.name}")

    frozen_ts, tslist = detect_frozen_timestamps(rows)
    if not frozen_ts:
        print("✅ Aucune période figée détectée — rien à faire.")
        return

    frozen_sorted = sorted(frozen_ts, key=parse_ts)
    print(f"🧊 Période figée détectée : {frozen_sorted[0]} → {frozen_sorted[-1]} ({len(frozen_sorted)} relevés)")

    clean_rows = [r for r in rows if r[0] not in frozen_ts]
    removed_count = len(rows) - len(clean_rows)
    print(f"🗑️  {removed_count} lignes figées à retirer de {args.csv_file.name}")

    estimates = build_estimates(rows, frozen_ts)
    print(f"🔧 {len(estimates)} lignes estimées reconstruites (moyenne des {BASELINE_DAYS}j précédents, même heure)")

    if args.dry_run:
        print("(dry-run : rien écrit)")
        return

    backup_path = args.csv_file.with_suffix(args.csv_file.suffix + f".bak_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}")
    shutil.copy2(args.csv_file, backup_path)
    print(f"💾 Sauvegarde de l'original : {backup_path.name}")

    with open(args.csv_file, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f, delimiter=';')
        w.writerow(header)
        w.writerows(clean_rows)
    print(f"✅ {args.csv_file.name} nettoyé ({len(clean_rows)} lignes)")

    est_path = args.csv_file.parent / "dune_counts_estimated.csv"
    est_exists = est_path.exists()
    with open(est_path, 'a', newline='', encoding='utf-8') as f:
        w = csv.writer(f, delimiter=';')
        if not est_exists:
            w.writerow(['timestamp', 'serveur', 'sietch', 'joueurs'])
        w.writerows(estimates)
    print(f"✅ Estimations ajoutées à {est_path.name}")


if __name__ == "__main__":
    main()
