# lai_explorer.py: Explores LAI databases, reading and processing ORNL and TRY raw CSV data to extract geographic origin and flag tropical/subtropical species.
"""
lai_explorer.py
GPRTool - LAI Database Explorer

Reads ORNL and TRY raw CSV databases PLUS the full TRY raw
data file (37339.txt), deduplicates, averages measurements,
extracts geographic origin, and flags tropical/subtropical
species by actual measurement latitude (not just name keywords).

Outputs:
    lai/LAI_combined_clean.csv     main output
    lai/LAI_tropical_subset.csv    tropical/subtropical only
    lai/LAI_explorer_report.txt    summary report

Usage (PowerShell):
    cd C:\\Users\\263350F\\_myProjects\\GPRTool-Demo
    .venv\\Scripts\\Activate.ps1
    python lai\\lai_explorer.py

Author: Boon + Claude
Date: 2026-03-17
"""

import csv
import os
import statistics
from collections import defaultdict

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR       = os.path.dirname(os.path.abspath(__file__))
LAI_DIR        = BASE_DIR
ORNL_CSV       = os.path.join(LAI_DIR, "LAI Database - ONRL.csv")
TRY_CSV        = os.path.join(LAI_DIR, "LAI Database - TRY.csv")
TRY_RAW        = os.path.join(LAI_DIR, "TRY Database", "37339.txt")
OUT_CSV        = os.path.join(LAI_DIR, "LAI_combined_clean.csv")
OUT_TROPICAL   = os.path.join(LAI_DIR, "LAI_tropical_subset.csv")
OUT_REPORT     = os.path.join(LAI_DIR, "LAI_explorer_report.txt")

# ── Geographic filter ──────────────────────────────────────────────────────────
# Tropical/subtropical belt: covers Perth (-32), Singapore (1),
# all of SE Asia, tropical Australia, India, Africa, Latin America
LAT_MIN = -35.0
LAT_MAX =  35.0

# ── Keyword fallback (for ORNL and TRY summary CSVs which lack coordinates) ───
TROPICAL_KEYWORDS = [
    "eucalyptus", "acacia", "melaleuca", "callistemon", "ficus",
    "casuarina", "banksia", "grevillea", "agonis", "allocasuarina",
    "tropical", "subtropical", "mangrove", "palm", "bamboo",
    "calophyllum", "terminalia", "intsia", "shorea", "dipterocarp",
    "swietenia", "tectona", "pterocarpus", "peltophorum",
    "samanea", "albizia", "leucaena", "delonix", "cassia",
    "lagerstroemia", "plumeria", "tabebuia", "jacaranda",
    "singapore", "malaysia", "indonesia", "australia",
]

# ── Helpers ────────────────────────────────────────────────────────────────────

def is_multi_species(name):
    indicators = ["/", " + ", " & ", "Various", "spp.,", "mixed", "mixture"]
    return any(i.lower() in name.lower() for i in indicators)


def is_tropical_keyword(name):
    return any(kw in name.lower() for kw in TROPICAL_KEYWORDS)


def is_tropical_lat(lat):
    """Return True if latitude falls within tropical/subtropical belt."""
    try:
        return LAT_MIN <= float(lat) <= LAT_MAX
    except (TypeError, ValueError):
        return False


# ── Reader: ORNL summary CSV ───────────────────────────────────────────────────

def read_ornl(filepath):
    rows, skipped = [], 0
    with open(filepath, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            sp  = row.get("Species", "").strip()
            val = row.get("LAI Value", "").strip()
            if not sp or not val:
                skipped += 1; continue
            try:
                lai = float(val)
            except ValueError:
                skipped += 1; continue
            if lai <= 0:
                skipped += 1; continue
            rows.append({
                "species":          sp,
                "accepted_species": sp,
                "lai_value":        lai,
                "source":           "ORNL",
                "dataset":          "ORNL Global LAI Woody Plants",
                "latitude":         None,
                "longitude":        None,
                "reference":        "",
                "multi_species":    is_multi_species(sp),
                "tropical_by_lat":  False,
                "tropical_by_kw":   is_tropical_keyword(sp),
            })
    return rows, skipped


# ── Reader: TRY summary CSV ────────────────────────────────────────────────────

def read_try_summary(filepath):
    rows, skipped = [], 0
    with open(filepath, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            sp  = row.get("SpeciesName", "").strip()
            val = row.get("LAI Value", "").strip()
            if not sp or not val:
                skipped += 1; continue
            try:
                lai = float(val)
            except ValueError:
                skipped += 1; continue
            if lai <= 0:
                skipped += 1; continue
            rows.append({
                "species":          sp,
                "accepted_species": sp,
                "lai_value":        lai,
                "source":           "TRY",
                "dataset":          "TRY Database (summary)",
                "latitude":         None,
                "longitude":        None,
                "reference":        "",
                "multi_species":    is_multi_species(sp),
                "tropical_by_lat":  False,
                "tropical_by_kw":   is_tropical_keyword(sp),
            })
    return rows, skipped


# ── Reader: TRY raw file (37339.txt) ──────────────────────────────────────────
# Structure: tab-separated, one trait per row.
# TraitID 926 = "Leaf area index (LAI) of a single plant"  → LAI value in StdValue
# TraitID  59 = Latitude   (StdValue)
# TraitID  60 = Longitude  (StdValue)
# We group by ObservationID to pair LAI with its coordinates.

def read_try_raw(filepath):
    print("  Parsing TRY raw file (this may take 10-20 seconds)...")

    # Pass 1: collect LAI rows and coordinate rows by ObservationID
    lai_by_obs   = {}   # obs_id -> {species, accepted_species, lai, dataset, reference}
    lat_by_obs   = {}   # obs_id -> latitude float
    lon_by_obs   = {}   # obs_id -> longitude float

    skipped = 0
    total   = 0

    with open(filepath, "r", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            total += 1
            trait_id = row.get("TraitID", "").strip()
            obs_id   = row.get("ObservationID", "").strip()
            if not obs_id:
                continue

            # LAI observation (TraitID 926)
            if trait_id == "926":
                val = row.get("StdValue", "").strip()
                try:
                    lai = float(val)
                except ValueError:
                    skipped += 1
                    continue
                if lai <= 0:
                    skipped += 1
                    continue
                sp       = row.get("SpeciesName", "").strip()
                acc_sp   = row.get("AccSpeciesName", "").strip() or sp
                dataset  = row.get("Dataset", "").strip()
                ref      = row.get("Reference", "").strip()
                lai_by_obs[obs_id] = {
                    "species":          sp,
                    "accepted_species": acc_sp,
                    "lai_value":        lai,
                    "dataset":          dataset,
                    "reference":        ref,
                }

            # Latitude (TraitID 59)
            elif trait_id == "59":
                val = row.get("StdValue", "").strip()
                try:
                    lat_by_obs[obs_id] = float(val)
                except ValueError:
                    pass

            # Longitude (TraitID 60)
            elif trait_id == "60":
                val = row.get("StdValue", "").strip()
                try:
                    lon_by_obs[obs_id] = float(val)
                except ValueError:
                    pass

    print(f"  Raw file: {total:,} total rows, {len(lai_by_obs):,} LAI observations found")

    # Pass 2: combine LAI + coordinates
    rows = []
    for obs_id, obs in lai_by_obs.items():
        lat = lat_by_obs.get(obs_id)
        lon = lon_by_obs.get(obs_id)
        sp  = obs["accepted_species"]
        rows.append({
            "species":          obs["species"],
            "accepted_species": sp,
            "lai_value":        obs["lai_value"],
            "source":           "TRY_RAW",
            "dataset":          obs["dataset"],
            "latitude":         lat,
            "longitude":        lon,
            "reference":        obs["reference"],
            "multi_species":    is_multi_species(sp),
            "tropical_by_lat":  is_tropical_lat(lat) if lat is not None else False,
            "tropical_by_kw":   is_tropical_keyword(sp),
        })

    return rows, skipped


# ── Aggregation ────────────────────────────────────────────────────────────────

def aggregate(all_rows):
    """
    Group by accepted_species (case-insensitive).
    Exclude multi-species entries from main aggregation.
    tropical = True if ANY measurement is tropical by lat OR keyword.
    """
    single = defaultdict(list)
    multi  = []

    for row in all_rows:
        if row["multi_species"]:
            multi.append(row)
        else:
            key = row["accepted_species"].strip().lower()
            single[key].append(row)

    aggregated = {}
    for key, entries in single.items():
        vals    = [e["lai_value"] for e in entries]
        sources = sorted(set(e["source"] for e in entries))
        datasets= sorted(set(e["dataset"] for e in entries if e["dataset"]))
        lats    = [e["latitude"] for e in entries if e["latitude"] is not None]
        trop_lat= any(e["tropical_by_lat"] for e in entries)
        trop_kw = any(e["tropical_by_kw"]  for e in entries)

        aggregated[key] = {
            "species":              entries[0]["accepted_species"],
            "mean_lai":             round(statistics.mean(vals), 3),
            "median_lai":           round(statistics.median(vals), 3),
            "min_lai":              round(min(vals), 3),
            "max_lai":              round(max(vals), 3),
            "measurement_count":    len(vals),
            "sources":              ", ".join(sources),
            "datasets":             " | ".join(datasets[:3]),
            "lat_range":            f"{min(lats):.1f} to {max(lats):.1f}" if lats else "",
            "tropical_by_lat":      trop_lat,
            "tropical_by_keyword":  trop_kw,
            "tropical":             trop_lat or trop_kw,
        }

    return aggregated, multi


# ── Writers ────────────────────────────────────────────────────────────────────

FIELDS_MAIN = [
    "species", "mean_lai", "median_lai", "min_lai", "max_lai",
    "measurement_count", "sources", "datasets", "lat_range",
    "tropical_by_lat", "tropical_by_keyword", "tropical",
]

def write_csv(rows, filepath, fieldnames):
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def write_report(aggregated, multi, counts, filepath):
    all_vals   = [v["mean_lai"] for v in aggregated.values()]
    tropical   = [v for v in aggregated.values() if v["tropical"]]
    trop_lat   = [v for v in aggregated.values() if v["tropical_by_lat"]]
    trop_kw    = [v for v in aggregated.values() if v["tropical_by_keyword"]]
    well_done  = [v for v in aggregated.values() if v["measurement_count"] >= 5]
    multi_src  = [v for v in aggregated.values()
                  if len(v["sources"].split(",")) > 1]

    lines = []
    a = lines.append
    a("=" * 65)
    a("GPRTool — LAI Database Explorer Report")
    a("Generated: 2026-03-17")
    a("=" * 65)
    a("")
    a("── RAW DATA SOURCES ──────────────────────────────────────────")
    for label, n, sk in counts:
        a(f"  {label:<30} {n:>6,} valid rows  ({sk} skipped)")
    total = sum(n for _, n, _ in counts)
    a(f"  {'TOTAL':<30} {total:>6,}")
    a("")
    a("── AFTER DEDUPLICATION ───────────────────────────────────────")
    a(f"  Unique single species:       {len(aggregated):,}")
    a(f"  Multi-species entries:       {len(multi):,}  (set aside)")
    a(f"  In multiple source DBs:      {len(multi_src):,}")
    a(f"  Well-measured (>=5 obs):     {len(well_done):,}")
    a("")
    a("── TROPICAL / SUBTROPICAL FILTER ─────────────────────────────")
    a(f"  Latitude band used:          {LAT_MIN} to {LAT_MAX}")
    a(f"  Flagged by latitude:         {len(trop_lat):,}")
    a(f"  Flagged by keyword only:     {len(trop_kw):,}")
    a(f"  Total tropical relevant:     {len(tropical):,}")
    a("")
    if tropical:
        a("  Top 25 tropical species by mean LAI:")
        for sp in sorted(tropical, key=lambda x: x["mean_lai"], reverse=True)[:25]:
            flag = "LAT" if sp["tropical_by_lat"] else "KW "
            a(f"    [{flag}] {sp['species']:<42} "
              f"mean={sp['mean_lai']:.2f}  n={sp['measurement_count']}")
    a("")
    a("── LAI DISTRIBUTION (all species) ───────────────────────────")
    bins = [(0,2,"Low  0-2"), (2,4,"Mid  2-4"),
            (4,7,"High 4-7"), (7,99,"Very high 7+")]
    for lo, hi, label in bins:
        count = sum(1 for x in all_vals if lo <= x < hi)
        bar   = "X" * (count // max(1, len(all_vals) // 40))
        a(f"  {label}:  {count:>5,}  {bar}")
    a("")
    a("── TOP 30 SPECIES OVERALL ────────────────────────────────────")
    for sp in sorted(aggregated.values(),
                     key=lambda x: x["mean_lai"], reverse=True)[:30]:
        a(f"  {sp['species']:<45} "
          f"mean={sp['mean_lai']:.2f}  n={sp['measurement_count']}")
    a("")
    a("── OUTPUTS ───────────────────────────────────────────────────")
    a(f"  Full list:     LAI_combined_clean.csv  ({len(aggregated):,} species)")
    a(f"  Tropical only: LAI_tropical_subset.csv ({len(tropical):,} species)")
    a("")
    a("── NEXT STEPS ────────────────────────────────────────────────")
    a("  1. Open LAI_tropical_subset.csv")
    a("     -> Boon to mark which species suit Perth/Singapore context")
    a("     -> Add column: category (Tree/Shrub/Grass/Groundcover/GreenRoof)")
    a("  2. Cross-reference with Tan & Sia 2009 GPR guidebook")
    a("  3. Finalised subset becomes lai/LAI_categorised.csv")
    a("  4. That feeds app plants_free.json and future Supabase pro tier")
    a("=" * 65)

    report_text = "\n".join(lines)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(report_text)
    return report_text


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print("\nGPRTool LAI Explorer")
    print("=" * 40)

    print("\n[1/4] Reading ORNL summary CSV...")
    ornl_rows, ornl_skip = read_ornl(ORNL_CSV)
    print(f"      {len(ornl_rows):,} rows")

    print("\n[2/4] Reading TRY summary CSV...")
    try_rows, try_skip = read_try_summary(TRY_CSV)
    print(f"      {len(try_rows):,} rows")

    print("\n[3/4] Reading TRY raw file (37339.txt)...")
    raw_rows, raw_skip = read_try_raw(TRY_RAW)
    print(f"      {len(raw_rows):,} LAI observations with location data")

    all_rows = ornl_rows + try_rows + raw_rows
    print(f"\n[4/4] Aggregating {len(all_rows):,} total rows...")
    aggregated, multi = aggregate(all_rows)
    print(f"      {len(aggregated):,} unique species")

    tropical = [v for v in aggregated.values() if v["tropical"]]

    # Write full clean CSV
    sorted_all = sorted(aggregated.values(),
                        key=lambda x: x["mean_lai"], reverse=True)
    write_csv(sorted_all, OUT_CSV, FIELDS_MAIN)
    print(f"\n  Wrote: LAI_combined_clean.csv  ({len(sorted_all):,} species)")

    # Write tropical subset
    sorted_trop = sorted(tropical,
                         key=lambda x: x["mean_lai"], reverse=True)
    write_csv(sorted_trop, OUT_TROPICAL, FIELDS_MAIN)
    print(f"  Wrote: LAI_tropical_subset.csv ({len(sorted_trop):,} species)")

    # Write report
    counts = [
        ("ORNL summary CSV",    len(ornl_rows), ornl_skip),
        ("TRY summary CSV",     len(try_rows),  try_skip),
        ("TRY raw (37339.txt)", len(raw_rows),  raw_skip),
    ]
    report = write_report(aggregated, multi, counts, OUT_REPORT)
    print(f"  Wrote: LAI_explorer_report.txt")

    print("\n" + "=" * 40)
    print(report)
    print("=" * 40)
    print("\nDone.")


if __name__ == "__main__":
    main()
