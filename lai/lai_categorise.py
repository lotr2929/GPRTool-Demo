"""
lai_categorise.py
GPRTool - LAI Species Categoriser

Reads LAI_combined_clean.csv and assigns each entry a category:
    Tree / Shrub / Grass / Bamboo / Mangrove / Palm / Groundcover /
    Generic-Benchmark / Multi-Species / REVIEW

Single species are categorised by genus lookup table.
Multi-species and community entries are tagged as benchmarks.
Anything unrecognised is flagged REVIEW for Boon to annotate.

Usage (PowerShell):
    cd C:\\Users\\263350F\\_myProjects\\GPRTool-Demo
    .venv\\Scripts\\Activate.ps1
    python lai\\lai_categorise.py

Outputs:
    lai/LAI_categorised.csv
    lai/LAI_category_report.txt

Author: Boon + Claude
Date: 2026-03-17
"""

import csv
import os
from collections import Counter

BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
LAI_DIR   = BASE_DIR
IN_CSV    = os.path.join(LAI_DIR, "LAI_combined_clean.csv")
OUT_CSV   = os.path.join(LAI_DIR, "LAI_categorised.csv")
OUT_RPT   = os.path.join(LAI_DIR, "LAI_category_report.txt")

# ── Genus → Category lookup ────────────────────────────────────────────────────
# Covers genera found in the database. Add more as needed.

GENUS_CATEGORY = {
    # ── Trees ──────────────────────────────────────────────────────────────────
    "abies": "Tree", "acer": "Tree", "aesculus": "Tree", "alnus": "Tree",
    "annona": "Tree", "aporusa": "Tree", "aspidosperma": "Tree",
    "avicennia": "Tree",  # also mangrove — listed here, overridden below
    "betula": "Tree", "bruguiera": "Tree",
    "bucida": "Tree", "bursera": "Tree",
    "canarium": "Tree", "carapa": "Tree", "carpinus": "Tree",
    "castanea": "Tree", "castanopsis": "Tree", "casuarina": "Tree",
    "cecropia": "Tree", "chamaecyparis": "Tree", "cinnamomum": "Tree",
    "cleistanthus": "Tree", "combretodendron": "Tree",
    "cornus": "Tree", "cryptomeria": "Tree", "cunninghamia": "Tree",
    "cupressus": "Tree", "cyrilla": "Tree",
    "dacryodes": "Tree", "dacrycarpus": "Tree", "dacrydium": "Tree",
    "dalbergia": "Tree", "dendrocalamus": "Tree",
    "dipterocarpus": "Tree", "diospyros": "Tree", "dryobalanops": "Tree",
    "elaeagnus": "Tree", "elaeis": "Tree",
    "eperua": "Tree", "eucalyptus": "Tree", "eucryphia": "Tree",
    "fagus": "Tree", "ficus": "Tree", "fraxinus": "Tree",
    "graffenrieda": "Tree", "grevillea": "Tree",
    "hevea": "Tree", "hopea": "Tree",
    "intsia": "Tree",
    "jacaranda": "Tree",
    "kandelia": "Tree", "koompassia": "Tree",
    "lagerstroemia": "Tree", "laguncularia": "Tree",
    "larix": "Tree", "liriodendron": "Tree", "liquidambar": "Tree",
    "lithocarpus": "Tree", "litsea": "Tree",
    "machilus": "Tree", "magnolia": "Tree", "mangifera": "Tree",
    "marquesia": "Tree", "melaleuca": "Tree", "metasequoia": "Tree",
    "metrosideros": "Tree", "micarandra": "Tree",
    "nothofagus": "Tree", "nyssa": "Tree",
    "ocotea": "Tree",
    "palaquium": "Tree", "parashorea": "Tree", "peltophorum": "Tree",
    "picea": "Tree", "pinus": "Tree", "platanus": "Tree",
    "podocarpus": "Tree", "populus": "Tree", "prestoea": "Tree",
    "protium": "Tree", "prunus": "Tree", "pseudotsuga": "Tree",
    "pterocarpus": "Tree",
    "qualea": "Tree", "quercus": "Tree",
    "rhizophora": "Tree", "robinia": "Tree",
    "salix": "Tree", "samanea": "Tree", "scaphium": "Tree",
    "sequoia": "Tree", "shorea": "Tree", "sonneratia": "Tree",
    "swietenia": "Tree",
    "tabebuia": "Tree", "tamarix": "Tree", "taxodium": "Tree",
    "tectona": "Tree", "terminalia": "Tree", "theobroma": "Tree",
    "thuja": "Tree", "thujopsis": "Tree", "toona": "Tree",
    "tsuga": "Tree", "turreanthus": "Tree",
    "ulmus": "Tree", "urophyllum": "Tree",
    "virola": "Tree",
    "weinmannia": "Tree",
    "zelkovab": "Tree",
    # ── Shrubs ─────────────────────────────────────────────────────────────────
    "adenostoma": "Shrub", "andromeda": "Shrub", "arbutus": "Shrub",
    "arctium": "Shrub", "artemisia": "Shrub", "atriplex": "Shrub",
    "banksia": "Shrub", "betula_nana": "Shrub",
    "callistemon": "Shrub", "cassiope": "Shrub", "chamaedaphne": "Shrub",
    "chrysothamnus": "Shrub", "cistus": "Shrub",
    "empetrum": "Shrub",
    "gaultheria": "Shrub", "grevillea": "Shrub",
    "ilex": "Shrub",
    "kalmia": "Shrub",
    "larrea": "Shrub", "ledum": "Shrub", "leiophyllum": "Shrub",
    "loiseleuria": "Shrub",
    "melaleuca": "Shrub",  # can be tree or shrub; keep as shrub for small spp.
    "morella": "Shrub",
    "rhododendron": "Shrub", "rhus": "Shrub",
    "sarcobatus": "Shrub",
    "vaccinium": "Shrub",
    # ── Grasses & Forbs ────────────────────────────────────────────────────────
    "aegopodium": "Groundcover", "agrostis": "Grass",
    "alopecurus": "Grass", "anthoxanthum": "Grass", "anthyllis": "Groundcover",
    "apera": "Grass", "arctium": "Groundcover",
    "arrhenatherum": "Grass",
    "brachypodium": "Grass", "bromus": "Grass",
    "calamagrostis": "Grass", "campanula": "Groundcover",
    "centaurium": "Groundcover", "cirsium": "Groundcover",
    "clinopodium": "Groundcover",
    "dactylis": "Grass", "deschampsia": "Grass", "digitalis": "Groundcover",
    "digitaria": "Grass",
    "festuca": "Grass", "filipendula": "Groundcover",
    "geranium": "Groundcover",
    "holcus": "Grass",
    "lamium": "Groundcover", "lapsana": "Groundcover", "luzula": "Grass",
    "medicago": "Groundcover", "molinia": "Grass",
    "nardus": "Grass",
    "origanum": "Groundcover",
    "phalaris": "Grass", "plantago": "Groundcover", "poa": "Grass",
    "pulicaria": "Groundcover",
    "scirpus": "Grass", "stellaria": "Groundcover", "succisa": "Groundcover",
    "taraxacum": "Groundcover", "thlaspi": "Groundcover",
    "trifolium": "Groundcover", "trisetum": "Grass",
    "urtica": "Groundcover",
    # ── Bamboo ─────────────────────────────────────────────────────────────────
    "bambusa": "Bamboo", "dendrocalamus": "Bamboo",
    "phyllostachys": "Bamboo", "sasa": "Bamboo",
    # ── Mangroves ──────────────────────────────────────────────────────────────
    "avicennia": "Mangrove", "bruguiera": "Mangrove",
    "kandelia": "Mangrove", "laguncularia": "Mangrove",
    "rhizophora": "Mangrove", "sonneratia": "Mangrove",
    # ── Palms ──────────────────────────────────────────────────────────────────
    "calamus": "Palm", "elaeis": "Palm",
}

# Community/generic entry markers → Generic-Benchmark
COMMUNITY_MARKERS = [
    "forest", " species", "spp.", "trees", "shrub", "vegetation",
    "savanna", "heath", "deciduous", "evergreen", "riparian",
    "coniferous", "temperate", "tropical", "mix", "combination",
    "family", "not described", "alder", "maple", "1176", "57 species",
    "shurb", "dryland", "wetland",
]


def classify(species: str) -> str:
    sp = species.strip()

    # Multi-species: comma or slash between names
    if "," in sp or "/" in sp or " + " in sp:
        return "Multi-Species"

    # Community/generic description
    sp_lower = sp.lower()
    if any(m in sp_lower for m in COMMUNITY_MARKERS):
        return "Generic-Benchmark"

    # Extract genus (first word)
    genus = sp_lower.split()[0].rstrip(".")

    # Look up genus
    if genus in GENUS_CATEGORY:
        return GENUS_CATEGORY[genus]

    # Partial match fallback (e.g. "Eucalyptus*clone*")
    for key, cat in GENUS_CATEGORY.items():
        if sp_lower.startswith(key):
            return cat

    return "REVIEW"


def main():
    rows_in = []
    with open(IN_CSV, encoding="utf-8") as f:
        rows_in = list(csv.DictReader(f))

    out_fields = list(rows_in[0].keys()) + ["category"]
    rows_out   = []
    for row in rows_in:
        row["category"] = classify(row["species"])
        rows_out.append(row)

    # Write categorised CSV sorted by category then mean_lai desc
    cat_order = ["Tree","Shrub","Grass","Groundcover","Bamboo",
                 "Mangrove","Palm","Generic-Benchmark","Multi-Species","REVIEW"]
    rows_out.sort(key=lambda r: (
        cat_order.index(r["category"]) if r["category"] in cat_order else 99,
        -float(r["mean_lai"])
    ))

    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=out_fields)
        writer.writeheader()
        writer.writerows(rows_out)

    # Tally
    tally = Counter(r["category"] for r in rows_out)
    review_items = [r["species"] for r in rows_out if r["category"] == "REVIEW"]

    lines = []
    a = lines.append
    a("=" * 55)
    a("GPRTool — LAI Category Report")
    a("=" * 55)
    a("")
    a("── CATEGORY COUNTS ───────────────────────────────────")
    total = sum(tally.values())
    for cat in cat_order:
        n = tally.get(cat, 0)
        bar = "█" * (n // 5)
        a(f"  {cat:<20} {n:>4}  {bar}")
    a(f"  {'TOTAL':<20} {total:>4}")
    a("")
    a("── REVIEW LIST (unrecognised genus) ──────────────────")
    a(f"  {len(review_items)} entries need manual categorisation:")
    for sp in sorted(review_items):
        a(f"    {sp}")
    a("")
    a("── NOTES ─────────────────────────────────────────────")
    a("  1. Open LAI_categorised.csv")
    a("  2. Filter category = REVIEW")
    a("  3. Assign correct category for each species")
    a("  4. Mangrove / Palm may overlap with Tree — adjust")
    a("     if preferred for GPRTool UI grouping")
    a("  5. Multi-Species and Generic-Benchmark can be used")
    a("     as planning-level LAI presets in GPRTool")
    a("=" * 55)

    report = "\n".join(lines)
    with open(OUT_RPT, "w", encoding="utf-8") as f:
        f.write(report)

    print(report)
    print(f"\nWritten: LAI_categorised.csv ({len(rows_out)} rows)")
    print(f"Written: LAI_category_report.txt")


if __name__ == "__main__":
    main()
