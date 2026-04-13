# _archive/lai_count.py: Script to quickly count single, multi, and community species in a combined CSV file.
"""Quick count of single vs multi/community species in combined CSV."""
import csv

single, multi, community = [], [], []

COMMUNITY_MARKERS = [
    "forest", "species", "spp.", "trees", "shrub", "vegetation",
    "savanna", "heath", "deciduous", "evergreen", "riparian",
    "coniferous", "temperate", "tropical", "mix", "combination",
    "family", "not described", "alder", "maple", "picea", "pinus",
    "betula", "cecropia", "1176", "57 species", "shurb"
]

with open(r"C:\GPRToolDemo\GPR - LAI Values\LAI_combined_clean.csv",
          encoding="utf-8") as f:
    for row in csv.DictReader(f):
        sp = row["species"]
        # Multi-species: contains comma or slash between names
        if "," in sp or "/" in sp or " + " in sp:
            multi.append(sp)
        # Community-level: descriptive text entry
        elif any(m in sp.lower() for m in COMMUNITY_MARKERS):
            community.append(sp)
        else:
            single.append(sp)

print(f"Single species:          {len(single):>4}")
print(f"Multi-species entries:   {len(multi):>4}")
print(f"Community/generic:       {len(community):>4}")
print(f"TOTAL:                   {len(single)+len(multi)+len(community):>4}")
print(f"\nMulti+Community (generic benchmarks): {len(multi)+len(community)}")
