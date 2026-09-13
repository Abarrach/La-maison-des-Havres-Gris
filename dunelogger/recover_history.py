#!/usr/bin/env python3
"""
recover_history.py — outil de récupération PONCTUEL (écrit le 2026-09-05).

Contexte : jusqu'au 2026-09-05, dune_archiver.py réécrivait dune_counts.csv en ne gardant que
30 jours, sans sauvegarde. Tout le détail horaire par sietch plus ancien était détruit ; il n'en
restait qu'une moyenne journalière dans dune_counts_archive.csv. Environ 3 mois y sont passés.

MAIS ce détail survit dans plusieurs copies faites à d'autres fins (audit prod, sauvegarde avant
réparation d'un gel de scraper, anciens dossiers de travail). Ce script les recolle :

  1. Lit toutes les SOURCES ci-dessous, dédoublonne par (horodatage, serveur, sietch).
  2. N'accepte QUE ce qui est antérieur à --until (par défaut la borne de la copie froide déjà
     en place, lue dans history/.archived_until.json). Sans ce plafond, on réécrirait au froid
     des lignes encore présentes dans le fichier chaud : l'archiveur les y remettrait la semaine
     suivante et on aurait des doublons.
  3. Écrit un fichier par mois, au format EXACT de la copie froide : history/dune_counts_AAAA-MM.csv.gz
  4. Reconstruit dune_counts_archive.csv (résumé journalier) avec de VRAIS moy/min/max calculés
     sur l'horaire retrouvé, au lieu des moyennes seules d'origine.

Les fichiers sont produits dans un dossier de SORTIE local, jamais directement en production :
on vérifie, puis on téléverse à la main (WinSCP), archiveur à l'arrêt.

Usage :
    python recover_history.py --out ./recovered
    python recover_history.py --out ./recovered --until 2026-08-05T23:00:00Z
"""

import argparse
import csv
import gzip
import io
import json
import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

# Copies retrouvées, de la plus ancienne à la plus récente. L'ordre n'a pas d'importance
# (dédoublonnage par clé), il ne sert qu'à la lisibilité du rapport.
SOURCES = [
    r"J:\Download\Serveur\Carte Dune OK\v2\dune_counts.csv",
    r"J:\Download\Serveur\Carte Dune OK\dune_counts.csv",
    r"J:\Download\Serveur\Carte Dune OK\DuneMap\.claude\worktrees\elegant-panini-29b29c\dunelogger\dune_counts.csv",
    r"J:\Download\Serveur\Carte Dune OK\DuneMap\.claude\worktrees\elegant-panini-29b29c\dunelogger\dune_counts.csv.bak_20260705T203839Z",
    r"J:\Download\Serveur\Save\dune-map\v2\dune_counts.csv",
    r"J:\Download\Serveur\Save\dune-map\dune_counts.csv",
]


def parse_ts(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00'))


def read_rows(path, until):
    """Rend (ts, serveur, sietch, joueurs) pour les lignes valides et antérieures à `until`."""
    if not os.path.exists(path):
        return
    with io.open(path, encoding='utf-8', errors='ignore', newline='') as f:
        for row in csv.reader(f, delimiter=';'):
            if len(row) < 4 or not row[0].startswith('2026-'):
                continue
            try:
                ts = parse_ts(row[0])
            except ValueError:
                continue
            if ts >= until:
                continue
            sietch = row[2].strip()
            if 'players status' in sietch.lower():
                continue
            try:
                n = int(row[3])
            except ValueError:
                continue
            yield ts, row[1].strip(), sietch, n


def drop_frozen(seen, min_run=3):
    """Retire les captures GELÉES : le scraper d'avant la bascule awoo pouvait rejouer la même
    page (cache/CDN après un ban IP) sans lever d'erreur, produisant des heures entières de
    fausses données plausibles. fix_frozen_data.py les avait retirées de la prod — mais les
    sauvegardes, elles, sont antérieures à cette réparation et les contiennent encore.
    Les réinjecter serait pire que le trou qu'on veut combler.

    Détection : deux relevés consécutifs dont l'ENSEMBLE des couples (serveur, sietch, valeur)
    est stritement identique. Sur ~2 400 lignes, une coïncidence naturelle est impossible ;
    on exige quand même une série d'au moins `min_run` pour écarter tout faux positif.
    """
    per_ts = defaultdict(list)
    for (ts, srv, sietch), n in seen.items():
        per_ts[ts].append((srv, sietch, n))
    keys = sorted(per_ts)
    sigs = {k: hash(tuple(sorted(per_ts[k]))) for k in keys}

    frozen, run = set(), []
    for i in range(1, len(keys)):
        if sigs[keys[i]] == sigs[keys[i - 1]]:
            run.append(keys[i])
        else:
            if len(run) >= min_run:
                frozen.update(run)
            run = []
    if len(run) >= min_run:
        frozen.update(run)

    if frozen:
        lo, hi = min(frozen), max(frozen)
        removed = sum(1 for (ts, _, _) in seen if ts in frozen)
        print(f"\n  ⚠ {len(frozen)} relevés GELÉS écartés ({lo:%Y-%m-%d %H:%M} -> {hi:%Y-%m-%d %H:%M}), "
              f"soit {removed:,} lignes — fausses données du scraper, déjà reconstruites "
              f"dans dune_counts_estimated.csv.")
        return {k: v for k, v in seen.items() if k[0] not in frozen}
    return seen


def load_original_archive(path):
    """Résumé journalier existant, indexé par jour. Sert à NE PAS perdre les journées dont
    l'horaire n'a pas été retrouvé : elles gardent leur moyenne d'origine."""
    rows_by_day = defaultdict(list)
    if not os.path.exists(path):
        return rows_by_day
    with io.open(path, encoding='utf-8', newline='') as f:
        for row in csv.reader(f, delimiter=';'):
            if len(row) >= 4 and row[0].startswith('2026-'):
                rows_by_day[row[0][:10]].append(row)
    return rows_by_day


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='./recovered', help="dossier de sortie")
    ap.add_argument('--until', default=None,
                    help="ne récupérer que ce qui précède cet horodatage ISO (défaut : borne de la copie froide)")
    ap.add_argument('--state', default=r"J:\Download\Serveur\Save\dune-map\history\.archived_until.json",
                    help="fichier d'état de la copie froide, pour déduire --until")
    ap.add_argument('--archive', default=None,
                    help="dune_counts_archive.csv actuel — ses journées non retrouvées sont conservées")
    args = ap.parse_args()

    if args.until:
        until = parse_ts(args.until)
    else:
        try:
            until = parse_ts(json.loads(Path(args.state).read_text(encoding='utf-8'))['archived_until'])
        except Exception:
            until = parse_ts('2026-08-06T00:00:00Z')
    print(f"Plafond de récupération : tout ce qui précède {until:%Y-%m-%d %H:%M} UTC\n")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    # clé -> valeur, dédoublonné. Clé = (ts, serveur, sietch).
    seen = {}
    for src in SOURCES:
        before = len(seen)
        for ts, srv, sietch, n in read_rows(src, until):
            seen.setdefault((ts, srv, sietch), n)
        label = Path(src).parent.name + '/' + Path(src).name
        print(f"  {label:<58} +{len(seen)-before:>9,} lignes inedites")

    if not seen:
        print("\nAucune donnée récupérable.")
        return

    seen = drop_frozen(seen)

    # --- Écriture des mois ---
    by_month = defaultdict(list)
    for (ts, srv, sietch), n in seen.items():
        by_month[ts.strftime('%Y-%m')].append((ts, srv, sietch, n))

    print()
    hist = out / 'history'
    hist.mkdir(exist_ok=True)
    for month in sorted(by_month):
        rows = sorted(by_month[month])
        target = hist / f"dune_counts_{month}.csv.gz"
        with gzip.open(target, 'wt', newline='', encoding='utf-8', compresslevel=6) as f:
            w = csv.writer(f, delimiter=';')
            w.writerow(['timestamp', 'serveur', 'sietch', 'joueurs'])
            for ts, srv, sietch, n in rows:
                w.writerow([ts.strftime('%Y-%m-%dT%H:%M:%SZ'), srv, sietch, n])
        heures = len({r[0] for r in rows})
        print(f"  {target.name:<32} {len(rows):>9,} lignes  {heures:>4} relevés  {target.stat().st_size/1e6:>6.1f} Mo")

    # --- Résumé journalier reconstruit avec de vrais min/max ---
    stats = defaultdict(list)
    for (ts, srv, sietch), n in seen.items():
        stats[(ts.strftime('%Y-%m-%d'), srv, sietch)].append(n)
    recovered_days = {k[0] for k in stats}
    original = load_original_archive(args.archive) if args.archive else {}
    kept = sorted(set(original) - recovered_days)   # journées connues seulement en moyenne

    arc = out / 'dune_counts_archive.csv'
    with io.open(arc, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f, delimiter=';')
        w.writerow(['timestamp', 'serveur', 'sietch', 'moyenne', 'min', 'max'])
        for day in sorted(recovered_days | set(original)):
            if day in recovered_days:
                # horaire retrouvé -> vrais moy/min/max
                for (d, srv, sietch) in sorted(k for k in stats if k[0] == day):
                    v = stats[(d, srv, sietch)]
                    w.writerow([f"{day}T12:00:00Z", srv, sietch, round(sum(v)/len(v)), min(v), max(v)])
            else:
                # pas d'horaire : on RECOPIE la ligne d'origine telle quelle, rien n'est perdu
                for row in original[day]:
                    w.writerow(row)
    if kept:
        print(f"\n  {len(kept)} journées sans horaire conservées depuis l'archive d'origine "
              f"({kept[0]} -> {kept[-1]})")
    jours = len(recovered_days | set(original))
    print(f"\n  {arc.name:<32} {len(stats):>9,} lignes  {jours:>4} jours     {arc.stat().st_size/1e6:>6.1f} Mo")

    # --- Rapport de couverture : quels jours restent sans horaire ? ---
    have = {k[0] for k in stats}
    d0, d1 = min(have), max(have)
    cur = datetime.strptime(d0, '%Y-%m-%d')
    end = datetime.strptime(d1, '%Y-%m-%d')
    missing = []
    while cur <= end:
        k = cur.strftime('%Y-%m-%d')
        if k not in have:
            missing.append(k)
        cur = cur.replace() + (datetime.strptime('2026-01-02', '%Y-%m-%d') - datetime.strptime('2026-01-01', '%Y-%m-%d'))
    print(f"\nCouverture : {d0} -> {d1}")
    if missing:
        print(f"Jours SANS horaire retrouvé ({len(missing)}) : {missing[0]} -> {missing[-1]}")
        print("  (ils gardent leur moyenne journalière d'origine, à réinjecter manuellement)")
    else:
        print("Aucun jour manquant sur la période.")


if __name__ == '__main__':
    main()
