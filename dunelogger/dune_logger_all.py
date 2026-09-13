import csv
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import requests

# --- CONFIGURATION ---
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
LOG_FILE = DATA_DIR / "dune_logger_cron.log"
CSV_FILE = Path("/srv/dune-map/dune_counts.csv")

API_BASE = "https://api.awoo.tools"
API_KEY_FILE = BASE_DIR / "awoo_api_key.txt"
SEABASS_CONFIG_ID = 3  # "Public" (le jeu live ; 4 = Public Test Client)
REGION_ID = "Europe"
REQUEST_TIMEOUT = 15
DELAY_BETWEEN_CALLS = 1.1  # reste sous la limite de 60 req/min (~87 serveurs = ~1min35 par run)
MAX_RETRIES_429 = 3

# --- SERVEURS OFFICIELS HAGGA BASIN (whitelist) ---
# Extraite le 2026-05-14, données les plus anciennes disponibles (non corrompues).
# Mettre à jour si Funcom ajoute/supprime des serveurs officiels.
# Vérifiée le 2026-07-05 contre l'API awoo.tools (serviceHostType=Official) : les 87
# noms ci-dessous correspondent exactement à un sous-ensemble des serveurs "Official"
# retournés (le reste = serveurs de dev/QA internes à Funcom, jamais inclus ici).
OFFICIAL_SERVERS: set = {
    'Actaeon', 'Aiglon', 'Alpha Corvus', 'Andromeda', 'Aquarius',
    'Archidamas III', 'Arkon', 'Bahamonde', 'Batigh', 'Buzzell',
    'Calypso', 'Canopus', 'Cassiopeia', 'Centaurus', 'Chapterhouse',
    'Circinus', 'Corona Borealis', 'Cycliadas', 'Daedros', 'Daxos',
    'Deneb', 'Dione', 'Dur', 'Eluzai', 'Epsilon Eridani', 'Eumenes',
    'Fides', 'Galacia', 'Gansireed', 'Ghanima', 'Grumman', 'Hagal',
    'Helios', 'Hicetas', 'Horologium', 'Icarus', 'Indra', 'Ipyr',
    'Ixalco', 'Jansine', 'Jongleur', 'Karna', 'Khala', 'Korona',
    'Lacerta', 'Lampadas', 'Laurrant', 'Leto', 'Limos', 'Lothar',
    'Lynx', 'Martijoz', 'Menelaus', 'Mihna', 'Molitor', 'Mycenae',
    'Nereus', 'Niveus', 'Numenor', 'Octans', 'Orion', 'Ostara',
    'Oxylon', 'Pax', 'Persephone', 'Phaedra', 'Pisces', 'Porthos',
    'Puppis', 'Quirinus', 'Remus', 'Rhea', 'Richese', 'Rossak',
    'Salusa Secundus', 'Saturnia', 'Selene', 'Serpens', 'Shamal',
    'Solaria', 'Suk Alusus', 'Tantalus', 'Terminus', 'Thule',
    'Tucana', 'Volans', 'Xenophon',
}

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


def load_api_key() -> str:
    if not API_KEY_FILE.exists():
        raise SystemExit(
            f"Clé API introuvable : {API_KEY_FILE}. "
            f"Créer ce fichier (un seul token à l'intérieur, sans guillemets ni retour à la ligne superflu)."
        )
    key = API_KEY_FILE.read_text(encoding='utf-8').strip()
    if not key:
        raise SystemExit(f"{API_KEY_FILE} est vide.")
    return key


def api_get(session: requests.Session, path: str, params: Optional[dict] = None) -> dict:
    for attempt in range(1, MAX_RETRIES_429 + 1):
        resp = session.get(f"{API_BASE}{path}", params=params, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 429 and attempt < MAX_RETRIES_429:
            wait_s = float(resp.headers.get('Retry-After', 5))
            logger.warning(f"⏳ 429 Too Many Requests sur {path} — attente {wait_s}s (essai {attempt}/{MAX_RETRIES_429})")
            time.sleep(wait_s)
            continue
        resp.raise_for_status()
        return resp.json()
    raise requests.HTTPError(f"429 persistant sur {path} après {MAX_RETRIES_429} essais")


# --- ÉCRITURE CSV ---

def write_to_csv(data: List[Dict], filepath: Path):
    file_exists = filepath.exists()
    with open(filepath, mode='a', newline='', encoding='utf-8') as f:
        writer = csv.writer(f, delimiter=';')
        if not file_exists:
            writer.writerow(['timestamp', 'serveur', 'sietch', 'joueurs'])
        for row in data:
            writer.writerow([row['timestamp'], row['serveur'], row['sietch'], row['joueurs']])
    logger.info(f"✅ {len(data)} lignes insérées dans {filepath.name}")


# --- COLLECTE VIA L'API awoo.tools ---

def fetch_official_battlegroups(session: requests.Session) -> List[dict]:
    """Liste les serveurs (battlegroups) Europe marqués Official par l'API,
    puis ne garde que ceux de notre whitelist (exclut les serveurs de dev/QA Funcom)."""
    data = api_get(
        session,
        f"/serverbrowser/{SEABASS_CONFIG_ID}/{REGION_ID}",
        params={"serviceHostFilter": "Official"},
    )
    battlegroups = data.get('battlegroups', [])
    matched = [b for b in battlegroups if b.get('displayName') in OFFICIAL_SERVERS]
    logger.info(f"✅ {len(matched)}/{len(battlegroups)} serveurs officiels identifiés (whitelist)")
    missing = OFFICIAL_SERVERS - {b['displayName'] for b in matched}
    if missing:
        logger.warning(f"⚠️ Serveurs de la whitelist absents de la réponse API : {sorted(missing)}")
    return matched


def fetch_dimensions(session: requests.Session, battlegroup_id: str) -> List[dict]:
    """Détail d'un serveur = liste des sietches (dimensions) avec leur population."""
    data = api_get(session, f"/serverbrowser/{SEABASS_CONFIG_ID}/{REGION_ID}/{battlegroup_id}")
    return data.get('dimensions', [])


def collect_dune_servers() -> List[Dict]:
    current_timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    api_key = load_api_key()

    session = requests.Session()
    session.headers.update({"X-API-KEY": api_key})

    all_data: List[Dict] = []

    try:
        battlegroups = fetch_official_battlegroups(session)
    except requests.RequestException as e:
        logger.error(f"🧨 Erreur lors de la récupération des serveurs : {e}")
        return []

    for bg in battlegroups:
        server_name = bg['displayName']
        try:
            dimensions = fetch_dimensions(session, bg['id'])
        except requests.RequestException as e:
            logger.error(f"🧨 Erreur sur le serveur {server_name} : {e}")
            continue

        for dim in dimensions:
            sietch_name = dim.get('displayName', '').strip()
            if not sietch_name:
                continue
            all_data.append({
                'timestamp': current_timestamp,
                'serveur': server_name,
                'sietch': sietch_name,
                'joueurs': int(dim.get('activePlayers', 0)),
            })

        time.sleep(DELAY_BETWEEN_CALLS)

    logger.info(f"📊 {len(all_data)} entrées collectées ({len(battlegroups)} serveurs)")
    return all_data


def main():
    all_data = collect_dune_servers()
    if not all_data:
        logger.warning("⚠️ Aucune donnée — pas d'écriture CSV.")
        return
    write_to_csv(all_data, CSV_FILE)


if __name__ == "__main__":
    main()
