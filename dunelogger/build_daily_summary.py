#!/usr/bin/env python3
"""
build_daily_summary.py — produit dune_counts_daily.csv (2026-09-05).

C'est la brique du chargement paresseux de l'Œil du Mentat : la page ne télécharge plus les
~80 Mo de dune_counts.csv à chaque ouverture, elle lit ce résumé (~1 Mo compressé) et ne va
chercher l'horaire QUE lorsqu'on zoome sur une période courte.

Contenu : UNE ligne par (jour, serveur, sietch) sur TOUT l'historique, avec moyenne/min/max.
  timestamp;serveur;sietch;moyenne;min;max      (horodatage à 12:00:00Z, comme l'archive)

Sources, dans cet ordre de priorité (la première qui fournit un jour l'emporte) :
  1. dune_counts.csv          — fenêtre chaude, horaire (les ~30 derniers jours)
  2. history/*.csv.gz         — copie froide, horaire (tout le reste)
  3. dune_counts_archive.csv  — résumé déjà journalier, pour les jours dont l'horaire est perdu
                                (21-29/05 et 25-30/06 : aucune sauvegarde ou données gelées)

Pourquoi ce fichier EN PLUS de dune_counts_archive.csv, qui est déjà journalier : l'archive
s'arrête 30 jours en arrière, par construction. Il lui manque donc toujours la période la plus
consultée. Ce fichier-ci couvre tout, d'un bloc — la page n'a qu'un seul fichier à lire au
démarrage. C'est un CACHE : il est reconstruit intégralement à chaque passage, et sa
suppression ne perd rien.

Cron (après le logger, qui tourne à l'heure pile) :
  10 * * * *  cd /home/dune && /home/dune/.venvs/dune_logger_env/bin/python build_daily_summary.py >> /home/dune/data/daily_summary.log 2>&1

Usage :
    python build_daily_summary.py
    python build_daily_summary.py --dry-run
"""

import argparse
import csv
import gzip
import io
import logging
import os
from collections import defaultdict
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR / "data"
LOG_FILE = DATA_DIR / "daily_summary.log"

WEB_DIR = Path("/srv/dune-map")
HOT_FILE = WEB_DIR / "dune_counts.csv"
HISTORY_DIR = WEB_DIR / "history"
ARCHIVE_FILE = WEB_DIR / "dune_counts_archive.csv"
OUT_FILE = WEB_DIR / "dune_counts_daily.csv"
TOTAL_FILE = WEB_DIR / "dune_counts_hourly_total.csv"
WORLD_FILE = WEB_DIR / "dune_counts_hourly_world.csv"

DATA_DIR.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.FileHandler(LOG_FILE), logging.StreamHandler()],
)
logger = logging.getLogger(__name__)


def iter_hourly(path):
    """Lit un CSV horaire (clair ou .gz) -> (jour, serveur, sietch, joueurs)."""
    if not os.path.exists(path):
        return
    opener = gzip.open if str(path).endswith('.gz') else io.open
    with opener(path, mode='rt', encoding='utf-8', errors='ignore', newline='') as f:
        for row in csv.reader(f, delimiter=';'):
            if len(row) < 4 or not row[0].startswith('20'):
                continue
            sietch = row[2].strip()
            if 'players status' in sietch.lower():
                continue
            try:
                yield row[0][:10], row[1].strip(), sietch, int(row[3]), row[0][:13]
            except ValueError:
                continue


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true', help="n'écrit rien")
    args = ap.parse_args()

    # --- 1 & 2 : tout ce dont on a l'horaire ---
    stats = defaultdict(lambda: [0, 0, None, None])   # (jour,srv,sietch) -> [somme, n, min, max]
    hourly_total = defaultdict(int)                   # heure ISO -> total joueurs, tous mondes
    hourly_world = defaultdict(int)                   # (heure ISO, monde) -> total joueurs
    sources = [HOT_FILE] + sorted(HISTORY_DIR.glob('*.csv.gz')) if HISTORY_DIR.exists() else [HOT_FILE]
    for src in sources:
        n0 = len(stats)
        for day, srv, sietch, v, hour in iter_hourly(src):
            hourly_total[hour] += v
            hourly_world[(hour, srv)] += v
            s = stats[(day, srv, sietch)]
            s[0] += v
            s[1] += 1
            s[2] = v if s[2] is None or v < s[2] else s[2]
            s[3] = v if s[3] is None or v > s[3] else s[3]
        logger.info(f"  {Path(src).name:<34} → {len(stats) - n0:>8,} couples inédits")

    hourly_days = {k[0] for k in stats}
    rows = [
        [f"{day}T12:00:00Z", srv, sietch, round(s[0] / s[1]), s[2], s[3]]
        for (day, srv, sietch), s in stats.items()
    ]

    # --- 3 : les jours dont l'horaire n'existe plus, repris tels quels de l'archive ---
    reprises = 0
    if ARCHIVE_FILE.exists():
        with io.open(ARCHIVE_FILE, encoding='utf-8', newline='') as f:
            for row in csv.reader(f, delimiter=';'):
                if len(row) < 4 or not row[0].startswith('20'):
                    continue
                if row[0][:10] in hourly_days:
                    continue          # on a mieux : l'horaire
                # complète en 6 colonnes si la ligne est à l'ancien format
                rows.append(row if len(row) >= 6 else [row[0], row[1], row[2], row[3], row[3], row[3]])
                reprises += 1

    rows.sort(key=lambda r: (r[0], r[1], r[2]))
    jours = len({r[0][:10] for r in rows})
    logger.info(f"📦 {len(rows):,} lignes · {jours} jours "
                f"({len(hourly_days)} avec horaire, {reprises:,} lignes reprises de l'archive)")

    if args.dry_run:
        logger.info(f"[dry-run] {OUT_FILE.name} n'a pas été écrit.")
        return

    # Écriture atomique : la page peut lire le fichier à tout instant.
    tmp = OUT_FILE.with_suffix('.csv.tmp')
    with io.open(tmp, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f, delimiter=';')
        w.writerow(['timestamp', 'serveur', 'sietch', 'moyenne', 'min', 'max'])
        w.writerows(rows)
    os.replace(tmp, OUT_FILE)
    logger.info(f"✅ {OUT_FILE.name} — {OUT_FILE.stat().st_size/1e6:.1f} Mo "
                f"(≈{OUT_FILE.stat().st_size/1e6/10:.1f} Mo une fois gzippé par nginx)")

    # --- Totaux horaires : une ligne par heure, tous mondes confondus ---
    # Quelques dizaines de Ko pour TOUT l'historique. Sert aux cartes « pic de connexion » :
    # sans lui, elles seraient calculées sur des MOYENNES journalières et donc très sous-évaluées
    # (mesuré : 1 053 au lieu de 2 263 sur les 3 derniers jours). Le résumé journalier ne peut pas
    # y répondre — une moyenne de la journée n'est pas le pic de la journée.
    tmp2 = TOTAL_FILE.with_suffix('.csv.tmp')
    with io.open(tmp2, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f, delimiter=';')
        w.writerow(['timestamp', 'total'])
        for hour in sorted(hourly_total):
            w.writerow([f"{hour}:00:00Z", hourly_total[hour]])
    os.replace(tmp2, TOTAL_FILE)
    logger.info(f"✅ {TOTAL_FILE.name} — {len(hourly_total):,} heures, "
                f"{TOTAL_FILE.stat().st_size/1e3:.0f} Ko")

    # --- Totaux horaires PAR MONDE ---
    # Même rôle que le précédent, mais pour la courbe d'un monde isolé : sans lui, dès qu'on
    # filtre sur un serveur la courbe repasse par le journalier et redevient lisse là où le
    # détail n'est pas chargé — l'utilisateur lit ça comme « ça ne se met pas à jour ».
    # Chargé PARESSEUSEMENT par la page, seulement à la première sélection d'un monde.
    tmp3 = WORLD_FILE.with_suffix('.csv.tmp')
    with io.open(tmp3, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f, delimiter=';')
        w.writerow(['timestamp', 'serveur', 'total'])
        for (hour, srv) in sorted(hourly_world):
            w.writerow([f"{hour}:00:00Z", srv, hourly_world[(hour, srv)]])
    os.replace(tmp3, WORLD_FILE)
    logger.info(f"✅ {WORLD_FILE.name} — {len(hourly_world):,} lignes, "
                f"{WORLD_FILE.stat().st_size/1e6:.1f} Mo")


if __name__ == '__main__':
    main()
