#!/usr/bin/env python3
# ============================================================
#  SONDE de couverture — combien de joueurs le collecteur NE VOIT PAS
# ============================================================
# Deux angles morts possibles dans dune_logger_all.py, tous deux silencieux :
#
#   1. LA WHITELIST. OFFICIAL_SERVERS est figée au 2026-05-14. Le collecteur
#      avertit quand un serveur de la liste a disparu de l'API, mais JAMAIS
#      quand l'API renvoie un serveur que la liste ignore — celui-là est écarté
#      sans un mot. Un afflux de joueurs pousse l'éditeur à rouvrir des mondes,
#      qui tombent alors dans ce trou : la courbe s'aplatit au moment précis où
#      elle devrait monter.
#
#   2. LA RÉGION. REGION_ID vaut "Europe", en dur, sur sept régions existantes.
#
# La sonde répond en chiffres, pas en hypothèses : combien de joueurs sont
# actuellement hors comptage, et où. Elle ne modifie rien et n'écrit aucun CSV.
#
#   python3 diag_couverture.py                 # Europe seule (rapide)
#   python3 diag_couverture.py --regions       # teste aussi les autres régions
#
# À lancer depuis le dossier du collecteur (elle lui emprunte sa clé, sa
# whitelist et son client HTTP — rien n'est recopié ici).
# ============================================================

import argparse
import sys
import time

import requests

from dune_logger_all import (
    API_BASE,
    OFFICIAL_SERVERS,
    REGION_ID,
    SEABASS_CONFIG_ID,
    REQUEST_TIMEOUT,
    DELAY_BETWEEN_CALLS,
    load_api_key,
)

# Noms de régions à sonder. Le collecteur n'en connaît qu'une ; ceux-ci sont des
# CANDIDATS — la sonde signale ceux que l'API refuse, au lieu de les supposer bons.
REGIONS_CANDIDATES = [
    "Europe", "North America", "NorthAmerica", "US East", "US West", "US Central",
    "Asia", "Oceania", "South America", "SouthAmerica",
]


def get(session, path, params=None):
    resp = session.get(f"{API_BASE}{path}", params=params, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def population(session, region, battlegroup_id):
    """Somme des joueurs de tous les sietches d'un monde."""
    dims = get(session, f"/serverbrowser/{SEABASS_CONFIG_ID}/{region}/{battlegroup_id}").get('dimensions', [])
    return sum(int(d.get('activePlayers', 0)) for d in dims), len(dims)


def sonder_europe(session):
    print("=" * 66)
    print(f"  WHITELIST — région « {REGION_ID} »")
    print("=" * 66)

    bgs = get(session, f"/serverbrowser/{SEABASS_CONFIG_ID}/{REGION_ID}",
              params={"serviceHostFilter": "Official"}).get('battlegroups', [])
    connus    = [b for b in bgs if b.get('displayName') in OFFICIAL_SERVERS]
    inconnus  = [b for b in bgs if b.get('displayName') not in OFFICIAL_SERVERS]
    disparus  = sorted(OFFICIAL_SERVERS - {b.get('displayName') for b in bgs})

    print(f"  Serveurs « Official » renvoyés par l'API : {len(bgs)}")
    print(f"  Retenus par la whitelist                 : {len(connus)}")
    print(f"  ÉCARTÉS EN SILENCE                       : {len(inconnus)}")
    if disparus:
        print(f"  Dans la whitelist mais absents de l'API  : {len(disparus)}  {disparus}")

    if inconnus:
        print("\n  Ces serveurs existent et ne sont PAS collectés :")

    perdus = 0
    for b in inconnus:
        try:
            joueurs, nb_sietches = population(session, REGION_ID, b['id'])
        except requests.RequestException as e:
            print(f"    · {b.get('displayName', '?'):<24} (illisible : {e})")
            continue
        perdus += joueurs
        print(f"    · {b.get('displayName', '?'):<24} {joueurs:>5} joueurs  ({nb_sietches} sietches)")
        time.sleep(DELAY_BETWEEN_CALLS)

    # Le total est calculé MÊME quand la whitelist est à jour : c'est le seul chiffre
    # comparable à un site tiers (dunestatus, dune.exchange) pris à la même minute, et
    # c'est ce qui départage « mon collecteur rate des joueurs » de « l'Europe a
    # simplement moins bougé ». Sans lui, « 0 perdu » ne prouverait rien.
    vus = 0
    for b in connus:
        try:
            joueurs, _ = population(session, REGION_ID, b['id'])
            vus += joueurs
        except requests.RequestException:
            pass
        time.sleep(DELAY_BETWEEN_CALLS)

    total = vus + perdus
    horodatage = time.strftime('%Y-%m-%d %H:%M:%SZ', time.gmtime())
    print(f"\n  À {horodatage}")
    print(f"  Comptés par le collecteur : {vus}")
    if perdus:
        part = (perdus / total * 100) if total else 0
        print(f"  Perdus par la whitelist   : {perdus}")
        print(f"  Total réel {REGION_ID}         : {total}   → sous-estimation de {part:.1f} %")
    else:
        print(f"  Total réel {REGION_ID}         : {total}   (whitelist à jour)")
    print(f"\n  → Compare CE chiffre à « {REGION_ID} » sur dunestatus.com DANS LA MINUTE.")
    print("    À faire à une heure de plateau (20h-22h heure locale), jamais au creux")
    print("    de la nuit : la courbe y est si raide qu'une heure d'écart vaut un facteur 2.")
    return vus, perdus


def sonder_regions(session):
    print("\n" + "=" * 66)
    print("  AUTRES RÉGIONS — ce que le collecteur ne regarde pas")
    print("=" * 66)
    for region in REGIONS_CANDIDATES:
        try:
            bgs = get(session, f"/serverbrowser/{SEABASS_CONFIG_ID}/{region}",
                      params={"serviceHostFilter": "Official"}).get('battlegroups', [])
        except requests.RequestException as e:
            code = getattr(e.response, 'status_code', '?')
            print(f"  {region:<18} nom refusé par l'API ({code})")
            continue
        print(f"  {region:<18} {len(bgs):>3} mondes  (population non sommée — relancer par région si besoin)")
        time.sleep(DELAY_BETWEEN_CALLS)
    print("\n  Les noms acceptés ci-dessus sont ceux à boucler dans le collecteur.")


def main():
    ap = argparse.ArgumentParser(description="Sonde de couverture du collecteur Dune")
    ap.add_argument('--regions', action='store_true',
                    help="sonde aussi les autres régions (plus long)")
    args = ap.parse_args()

    session = requests.Session()
    session.headers.update({"X-API-KEY": load_api_key()})

    try:
        sonder_europe(session)
        if args.regions:
            sonder_regions(session)
    except requests.RequestException as e:
        print(f"\n🧨 Appel API en échec : {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
