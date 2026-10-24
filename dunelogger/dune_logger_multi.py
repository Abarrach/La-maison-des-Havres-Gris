#!/usr/bin/env python3

import asyncio
import datetime as dt
import re
from pathlib import Path

from playwright.async_api import async_playwright

URL = "https://dune.gaming.tools/server-status"

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
CSV_PATH = DATA_DIR / "dune_counts.csv"
LOG_PATH = DATA_DIR / "errors.log"

TIMEOUT = 60000


def now_iso():
    return dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def log_error(msg):
    DATA_DIR.mkdir(exist_ok=True)
    with LOG_PATH.open("a") as f:
        f.write(f"{now_iso()} {msg}\n")


async def extract_data(page):
    results = []

    rows = page.locator("table tbody tr")
    count = await rows.count()

    current_server = None

    for i in range(count):
        row = rows.nth(i)
        text = (await row.inner_text()).strip()

        if not text:
            continue

        # Trouver pattern joueurs
        match = re.search(r"(\d+)\s*/\s*\d+", text)
        if not match:
            continue

        players = int(match.group(1))

        # Nettoyage texte
        clean = " ".join(text.split())

        # Cas serveur (pas "Sietch")
        if "Sietch" not in clean:
            current_server = clean.split(" ")[0]
            results.append((current_server, "GLOBAL", players))

        else:
            if current_server:
                results.append((current_server, clean, players))

    return results

async def run():
    DATA_DIR.mkdir(exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(storage_state=str(BASE_DIR / "storage_state.json"))
        page = await context.new_page()

        page.set_default_timeout(TIMEOUT)

        await page.goto(URL)

        # accepter cookies (safe)
        try:
            await page.locator("button:has-text('Accept')").click(timeout=3000)
        except:
            pass

        # attendre les serveurs
        await page.locator("text=/Galacia/i").wait_for()

        # récupérer liste des serveurs visibles
        server_elements = page.locator("table tbody tr")
        server_count = await server_elements.count()

        # cliquer chaque serveur pour ouvrir les sietch
        for i in range(server_count):
            row = server_elements.nth(i)
            text = await row.inner_text()

            if "Sietch" not in text:
                try:
                    await row.click()
                    await page.wait_for_timeout(300)
                except:
                    continue

        data = await extract_data(page)

        await browser.close()

    # écrire CSV (format long)
    timestamp = now_iso()

    with CSV_PATH.open("a") as f:
        for server, sietch, players in data:
            f.write(f"{timestamp};{server};{sietch};{players}\n")


def main():
    try:
        asyncio.run(run())
    except Exception as e:
        log_error(str(e))


if __name__ == "__main__":
    main()