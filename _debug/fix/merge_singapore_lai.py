# merge_singapore_lai.py: Merges Singapore field LAI measurements into LAI_categorised.csv.
"""
merge_singapore_lai.py
Merges Singapore field LAI measurements (Boon Ong & Dr Tan, 2009)
into LAI_categorised.csv.

Run from project root:
    python "GPR - LAI Values/merge_singapore_lai.py"
Or double-click if Python is on PATH.

What it does:
- Backs up LAI_categorised.csv as LAI_categorised_pre_sg_merge.csv
- Adds 5 new columns to every row:
    singapore_field_lai       mean of Singapore measurements
    singapore_field_lai_min   min  (= mean if single measurement)
    singapore_field_lai_max   max  (= mean if single measurement)
    singapore_n               number of Singapore measurements (1 or 2)
    urban_context             True if Singapore field data present
- Updates sources field to include "Singapore field (Boon & Tan 2009)"
- Writes result back to LAI_categorised.csv (in-place)

All 35 unique Singapore species were already present in LAI_categorised.csv
from TRY. Duplicates in the Singapore CSV:
    Anthoxanthum odoratum   7.34, 3.72  -> mean 5.53
    Calamagrostis epigejos  6.42, 3.21  -> mean 4.815
"""

import csv
import shutil

# ── Singapore field data (Boon & Tan 2009) ────────────────────────────────
# (mean, min, max, n_measurements)
sg = {
    "agrostis capillaris":      (8.40,  8.40, 8.40, 1),
    "arrhenatherum elatius":    (7.66,  7.66, 7.66, 1),
    "alopecurus pratensis":     (7.65,  7.65, 7.65, 1),
    "anthoxanthum odoratum":    (5.53,  3.72, 7.34, 2),   # duplicate resolved
    "alopecurus geniculatus":   (7.21,  7.21, 7.21, 1),
    "apera spica-venti":        (7.04,  7.04, 7.04, 1),
    "clinopodium vulgare":      (6.93,  6.93, 6.93, 1),
    "acer spicatum":            (6.91,  6.91, 6.91, 1),
    "cirsium arvense":          (6.62,  6.62, 6.62, 1),
    "calamagrostis epigejos":   (4.815, 3.21, 6.42, 2),   # duplicate resolved
    "anthyllis vulneraria":     (5.52,  5.52, 5.52, 1),
    "digitalis purpurea":       (5.42,  5.42, 5.42, 1),
    "cirsium acaule":           (5.31,  5.31, 5.31, 1),
    "aegopodium podagraria":    (5.04,  5.04, 5.04, 1),
    "arctium lappa":            (4.72,  4.72, 4.72, 1),
    "aextoxicon punctatum":     (4.60,  4.60, 4.60, 1),
    "deschampsia cespitosa":    (4.52,  4.52, 4.52, 1),
    "centaurium erythraea":     (3.83,  3.83, 3.83, 1),
    "bromus hordeaceus":        (3.79,  3.79, 3.79, 1),
    "amomyrtus meli":           (3.60,  3.60, 3.60, 1),
    "brachypodium sylvaticum":  (3.50,  3.50, 3.50, 1),
    "campanula rotundifolia":   (2.97,  2.97, 2.97, 1),
    "byrsonima coccolobifolia": (2.57,  2.57, 2.57, 1),
    "dalbergia miscolobium":    (2.52,  2.52, 2.52, 1),
    "byrsonima verbascifolia":  (2.39,  2.39, 2.39, 1),
    "caryocar brasiliense":     (2.36,  2.36, 2.36, 1),
    "annona crassiflora":       (1.57,  1.57, 1.57, 1),
    "dacryodes rostrata":       (1.06,  1.06, 1.06, 1),
    "canarium denticulatum":    (1.05,  1.05, 1.05, 1),
    "cleistanthus paxii":       (0.98,  0.98, 0.98, 1),
    "dacryodes laxa":           (0.96,  0.96, 0.96, 1),
    "cleistanthus baramicus":   (0.89,  0.89, 0.89, 1),
    "aporusa lucida":           (0.86,  0.86, 0.86, 1),
    "canarium pilosum":         (0.71,  0.71, 0.71, 1),
    "cornus stolonifera":       (0.23,  0.23, 0.23, 1),
}

# ── File paths ────────────────────────────────────────────────────────────
import os
base = os.path.dirname(os.path.abspath(__file__))
src  = os.path.join(base, "LAI_categorised.csv")
bak  = os.path.join(base, "LAI_categorised_pre_sg_merge.csv")

# ── Backup ─────────────────────────────────────────────────────────────────
shutil.copy(src, bak)
print(f"Backup written: {bak}")

# ── Read ───────────────────────────────────────────────────────────────────
with open(src, encoding="utf-8-sig") as f:
    reader      = csv.DictReader(f)
    orig_fields = reader.fieldnames
    rows        = list(reader)

print(f"Read {len(rows)} rows, {len(orig_fields)} columns from {src}")

# ── New columns ─────────────────────────────────────────────────────────────
new_fields = orig_fields + [
    "singapore_field_lai",
    "singapore_field_lai_min",
    "singapore_field_lai_max",
    "singapore_n",
    "urban_context",
]

# ── Merge ──────────────────────────────────────────────────────────────────
matched   = 0
unmatched = []

for row in rows:
    key = row["species"].strip().lower()
    if key in sg:
        m, mn, mx, n = sg[key]
        row["singapore_field_lai"]     = m
        row["singapore_field_lai_min"] = mn
        row["singapore_field_lai_max"] = mx
        row["singapore_n"]             = n
        row["urban_context"]           = True
        # Append to sources if not already present
        src_field = row.get("sources", "")
        if "Singapore" not in src_field:
            row["sources"] = (src_field + ", Singapore field (Boon & Tan 2009)").lstrip(", ")
        matched += 1
    else:
        row["singapore_field_lai"]     = ""
        row["singapore_field_lai_min"] = ""
        row["singapore_field_lai_max"] = ""
        row["singapore_n"]             = ""
        row["urban_context"]           = False

# Check for unmatched Singapore species
for key in sg:
    if not any(r["species"].strip().lower() == key for r in rows):
        unmatched.append(key)

# ── Write ──────────────────────────────────────────────────────────────────
with open(src, "w", encoding="utf-8", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=new_fields)
    writer.writeheader()
    writer.writerows(rows)

# ── Report ─────────────────────────────────────────────────────────────────
print(f"\nMerge complete.")
print(f"  Matched {matched}/35 Singapore species")
print(f"  Rows written: {len(rows)}")
print(f"  Columns: {len(new_fields)} (was {len(orig_fields)})")

if unmatched:
    print(f"\nWARNING: {len(unmatched)} Singapore species NOT found:")
    for u in unmatched:
        print(f"  {u}")
else:
    print("  No unmatched Singapore species.")

print(f"\nNew columns: singapore_field_lai, singapore_field_lai_min, "
      f"singapore_field_lai_max, singapore_n, urban_context")

print("\nSample of matched rows:")
print(f"  {'Species':<35} {'TRY mean':>10} {'SG field':>10} {'SG n':>5} {'Category'}")
print("  " + "-"*75)
for row in rows:
    if row["singapore_field_lai"]:
        print(f"  {row['species']:<35} {float(row['mean_lai']):>10.3f} "
              f"{float(row['singapore_field_lai']):>10.3f} "
              f"{str(row['singapore_n']):>5}  {row['category']}")
