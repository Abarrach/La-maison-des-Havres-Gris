#!/usr/bin/env python3
"""
dune_archiver.py

Fait maigrir dune_counts.csv SANS JAMAIS PERDRE UNE MESURE.

À lancer hebdomadairement via cron (ex : tous les lundis à 3h).

Ce que fait le script, dans cet ordre :
  1. Lit dune_counts.csv et sépare récent / ancien. Le seuil (RETENTION_DAYS) est arrondi à
     minuit UTC : seules des journées COMPLÈTES sont archivées, jamais un jour à moitié.
  2. DÉPLACE l'ancien, tel quel (horaire, par sietch), dans history/dune_counts_AAAA-MM.csv.gz.
     C'est la copie froide : jamais servie au navigateur, jamais agrégée, conservée pour toujours.
  3. Résume l'ancien en une ligne par (jour, serveur, sietch) dans dune_counts_archive.csv,
     avec moy/min/max — c'est le fichier tiède que lit la page.
  4. Seulement ALORS, réécrit dune_counts.csv avec les données récentes.

Pourquoi cette réécriture (2026-09-05) — l'ancienne version DÉTRUISAIT l'historique :
elle réécrivait dune_counts.csv en ne gardant que 30 jours, sans sauvegarde. Tout le détail
horaire par sietch antérieur disparaissait définitivement, il n'en restait qu'une moyenne
journalière. Trois mois de mesures y sont passés avant qu'on s'en aperçoive.
Désormais l'agrégation n'est plus qu'un CACHE : la copie froide permet de tout recalculer.

Trois garde-fous ajoutés :
  - ÉTAT (history/.archived_until.json) : mémorise l'horodatage le plus récent déjà déplacé.
    Une relance après un plantage ne redéplace donc jamais les mêmes lignes (l'ancienne version
    faisait un `append` aveugle : elle dupliquait à la moindre reprise).
  - ORDRE : la copie froide est écrite ET RELUE POUR VÉRIFICATION avant que dune_counts.csv ne
    soit touché. Si quoi que ce soit échoue avant, on sort sans rien supprimer.
  - ÉCRITURE ATOMIQUE : dune_counts.csv est écrit dans un .tmp puis renommé (os.replace).
    Une coupure en plein milieu ne peut plus laisser un CSV tronqué.

Compatibilité de dune_counts_archive.csv : les colonnes min/max sont ajoutées À LA FIN
(timestamp;serveur;sietch;moyenne;min;max). La 4e colonne reste la moyenne, donc les lignes
déjà écrites par l'ancienne version et le lecteur de dune_analytics.html restent valides.

Usage :
    python dune_archiver.py
    python dune_archiver.py --dry-run    (n'écrit rien, dit ce qu'il ferait)

Cron :
  0 3 * * 1  cd /home/dune && /home/dune/.venvs/dune_logger_env/bin/python dune_archiver.py >> /home/dune/data/archiver.log 2>&1
"""

import argparse
import csv
import gzip
import json
import logging
import os
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

# --- CONFIGURATION ---
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR / "data"
LOG_FILE = DATA_DIR / "archiver.log"
CSV_FILE = Path("/srv/dune-map/dune_counts.csv")
ARCHIVE_FILE = Path("/srv/dune-map/dune_counts_archive.csv")
HISTORY_DIR = Path("/srv/dune-map/history")          # copie froide, une archive .gz par mois
STATE_FILE = HISTORY_DIR / ".archived_until.json"

# Nombre de jours de données brutes (horaires) à conserver dans le fichier principal
RETENTION_DAYS = 30

DATA_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


def parse_timestamp(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace('Z', '+00:00'))


# --- ÉTAT : jusqu'où a-t-on déjà déplacé ? ---

def load_archived_until() -> datetime:
    """Horodatage le plus récent déjà mis en copie froide (epoch si inconnu)."""
    try:
        raw = json.loads(STATE_FILE.read_text(encoding='utf-8'))
        return parse_timestamp(raw['archived_until'])
    except (OSError, ValueError, KeyError):
        return datetime.fromtimestamp(0, tz=timezone.utc)


def save_archived_until(ts: datetime):
    STATE_FILE.write_text(
        json.dumps({'archived_until': ts.strftime('%Y-%m-%dT%H:%M:%SZ')}, indent=2),
        encoding='utf-8',
    )


# --- COPIE FROIDE : le brut, par mois, gzippé ---

def freeze_rows(rows_by_month: dict, dry_run: bool) -> bool:
    """Ajoute les lignes brutes aux archives mensuelles .gz, puis RELIT pour vérifier.
    Renvoie True seulement si tout est bien en sécurité sur le disque."""
    if not dry_run:
        HISTORY_DIR.mkdir(parents=True, exist_ok=True)

    for month, rows in sorted(rows_by_month.items()):
        target = HISTORY_DIR / f"dune_counts_{month}.csv.gz"
        if dry_run:
            logger.info(f"[dry-run] {len(rows):,} lignes iraient dans {target.name}")
            continue

        before = 0
        if target.exists():
            with gzip.open(target, mode='rt', encoding='utf-8') as f:
                before = sum(1 for _ in f)

        # mode 'at' : un fichier gzip accepte la concaténation de membres, et les lecteurs
        # la gèrent de façon transparente. Pas besoin de réécrire le mois entier à chaque fois.
        with gzip.open(target, mode='at', newline='', encoding='utf-8', compresslevel=6) as f:
            w = csv.writer(f, delimiter=';')
            if before == 0:
                w.writerow(['timestamp', 'serveur', 'sietch', 'joueurs'])
            w.writerows(rows)

        # Vérification : on relit vraiment le fichier avant d'autoriser la moindre suppression.
        with gzip.open(target, mode='rt', encoding='utf-8') as f:
            after = sum(1 for _ in f)
        expected = before + len(rows) + (1 if before == 0 else 0)
        if after != expected:
            logger.error(
                f"🧨 {target.name} : {after} lignes relues, {expected} attendues. "
                f"ABANDON — dune_counts.csv n'est PAS touché."
            )
            return False
        logger.info(
            f"🧊 {target.name} : +{len(rows):,} lignes "
            f"({after:,} au total, {target.stat().st_size/1e6:.1f} Mo)"
        )

    return True


def run(dry_run: bool = False):
    if not CSV_FILE.exists():
        logger.warning(f"Fichier CSV introuvable : {CSV_FILE}")
        return

    # Seuil ARRONDI À MINUIT UTC : on n'archive que des journées COMPLÈTES.
    # Sans cet arrondi, le jour qui contient le seuil part à moitié (ex. 00:00-08:00) et son
    # résumé journalier est calculé sur les seules heures creuses → moyenne artificiellement
    # basse. Et comme le garde-fou anti-doublon empêche de la recalculer au passage suivant,
    # cette valeur fausse resterait dans l'archive définitivement. Le reliquat de la journée
    # attend simplement la semaine d'après, où elle sera traitée d'un bloc.
    cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).replace(
        hour=0, minute=0, second=0, microsecond=0)
    archived_until = load_archived_until()
    logger.info(f"📅 Seuil d'archivage : {cutoff.strftime('%Y-%m-%d')} ({RETENTION_DAYS}j de rétention)")
    logger.info(f"🔖 Déjà mis au froid jusqu'à : {archived_until.strftime('%Y-%m-%d %H:%M')}")

    recent_rows = []
    old_rows = []
    header = None

    # --- Lecture et tri ---
    with open(CSV_FILE, newline='', encoding='utf-8') as f:
        reader = csv.reader(f, delimiter=';')
        for row in reader:
            if not row:
                continue
            if row[0].lower().startswith('time'):
                header = row
                continue
            if len(row) < 4:
                continue
            try:
                ts = parse_timestamp(row[0])
                if ts < cutoff:
                    old_rows.append((ts, row))
                else:
                    recent_rows.append(row)
            except (ValueError, KeyError):
                recent_rows.append(row)  # ligne non parsable : conserver par sécurité

    logger.info(f"📊 Lignes récentes : {len(recent_rows):,} | à sortir du fichier chaud : {len(old_rows):,}")

    if not old_rows:
        logger.info("✅ Rien à archiver — fichier CSV déjà dans la fenêtre de rétention.")
        return

    # --- 1. Copie froide (uniquement ce qui n'y est pas déjà) ---
    to_freeze = defaultdict(list)
    newest = archived_until
    for ts, row in old_rows:
        if ts <= archived_until:
            continue                      # déjà au froid lors d'un passage précédent
        to_freeze[ts.strftime('%Y-%m')].append(row)
        if ts > newest:
            newest = ts

    frozen_count = sum(len(v) for v in to_freeze.values())
    if frozen_count:
        if not freeze_rows(to_freeze, dry_run):
            return                        # échec de vérification → on ne supprime rien
    else:
        logger.info("🔖 Toutes les lignes anciennes étaient déjà au froid (reprise après incident).")

    # --- 2. Résumé journalier moy/min/max pour la page ---
    # Jours déjà présents dans l'archive tiède : on ne les réécrit pas (l'ancienne version
    # faisait un append aveugle et dupliquait les jours à chaque relance).
    existing_days = set()
    if ARCHIVE_FILE.exists():
        with open(ARCHIVE_FILE, newline='', encoding='utf-8') as f:
            for row in csv.reader(f, delimiter=';'):
                if row and not row[0].lower().startswith('time'):
                    existing_days.add(row[0][:10])

    stats = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    for ts, row in old_rows:
        date_key = ts.strftime('%Y-%m-%d')
        if date_key in existing_days:
            continue
        try:
            joueurs = int(row[3]) if row[3].strip().lstrip('-').isdigit() else 0
            stats[date_key][row[1].strip()][row[2].strip()].append(joueurs)
        except (ValueError, IndexError):
            pass

    archive_rows = []
    for date_key in sorted(stats):
        for serveur in sorted(stats[date_key]):
            for sietch in sorted(stats[date_key][serveur]):
                vals = stats[date_key][serveur][sietch]
                # 4e colonne = moyenne, comme avant → les lignes déjà écrites et le lecteur
                # de dune_analytics.html restent valides. min/max ajoutés en 5e et 6e.
                archive_rows.append([
                    f"{date_key}T12:00:00Z", serveur, sietch,
                    round(sum(vals) / len(vals)), min(vals), max(vals),
                ])

    if archive_rows and not dry_run:
        archive_exists = ARCHIVE_FILE.exists()
        with open(ARCHIVE_FILE, mode='a', newline='', encoding='utf-8') as f:
            writer = csv.writer(f, delimiter=';')
            if not archive_exists:
                writer.writerow(['timestamp', 'serveur', 'sietch', 'moyenne', 'min', 'max'])
            writer.writerows(archive_rows)
    logger.info(f"📦 Résumé journalier : {len(archive_rows):,} lignes ({len(stats)} jours)")

    # --- 3. Réécriture atomique du CSV principal ---
    if dry_run:
        logger.info(f"[dry-run] dune_counts.csv passerait de {len(recent_rows)+len(old_rows):,} à {len(recent_rows):,} lignes.")
        logger.info(f"[dry-run] {frozen_count:,} lignes auraient été mises au froid. Rien n'a été écrit.")
        return

    tmp = CSV_FILE.with_suffix('.csv.tmp')
    with open(tmp, mode='w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f, delimiter=';')
        if header:
            writer.writerow(header)
        writer.writerows(recent_rows)
    os.replace(tmp, CSV_FILE)             # atomique : jamais de fichier à moitié écrit
    save_archived_until(newest)
    logger.info(f"✅ CSV principal réécrit : {CSV_FILE.name}")

    # --- Bilan ---
    csv_mb = CSV_FILE.stat().st_size / 1e6
    arc_mb = ARCHIVE_FILE.stat().st_size / 1e6 if ARCHIVE_FILE.exists() else 0
    cold_mb = sum(p.stat().st_size for p in HISTORY_DIR.glob('*.csv.gz')) / 1e6 if HISTORY_DIR.exists() else 0
    logger.info(
        f"📈 Bilan : {len(stats)} jours résumés | {frozen_count:,} lignes au froid | "
        f"dune_counts.csv = {csv_mb:.1f} Mo | archive = {arc_mb:.1f} Mo | history/ = {cold_mb:.1f} Mo"
    )


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Archive dune_counts.csv sans perdre de mesure.")
    ap.add_argument('--dry-run', action='store_true', help="n'écrit rien, affiche ce qui serait fait")
    run(dry_run=ap.parse_args().dry_run)
