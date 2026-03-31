# GPRTool LAI Database Strategy
**Author:** Boon Lay Ong  
**Created:** 2026-03-17  
**Status:** Working document — update as strategies are resolved

---

## Purpose

This document records all known free LAI data sources, their suitability for GPRTool, and the strategy for building a curated, defensible LAI plant library for GPR calculation.

The LAI database is the intellectual core of GPRTool. The CAD visualiser is simply the delivery mechanism. A scientifically rigorous, auditable, urban-context LAI database — the first of its kind — is the publishable IP.

---

## The Central Scientific Problem

All existing LAI databases were compiled for ecological and forestry research. Values were measured in natural forests, plantations, and experimental plots — not urban conditions. Urban greenery is fundamentally different:

- Root volume restriction → reduced LAI vs open-ground
- Substrate depth constraints (green roofs, podium gardens)
- Light level variation (street tree shade, atrium interiors, aspect)
- Wind exposure on rooftops
- Irrigation regimes and soil quality
- Pruning management

**GPRTool must ultimately provide:**
1. A best-available LAI value per species (from literature)
2. An urban adjustment factor per installation type — OR — direct urban-measured LAI where data exists
3. Full traceability: source, methodology, context

---

## LAI Variability by Context — The Fundamental Challenge

### Why LAI values vary so widely

LAI is not a fixed property of a species. It is a dynamic response to growing conditions. The same species measured in different contexts can yield LAI values that differ by a factor of 2–10. This is not measurement error — it is ecophysiological reality.

The Singapore field data (Boon & Tan 2009) makes this starkly visible. Comparing Singapore urban field measurements against TRY database values (open/natural context):

| Species | TRY mean | Singapore field | Ratio | Notes |
|---------|----------|-----------------|-------|-------|
| *Acer spicatum* | 1.34 | 6.91 | 5.2× | TRY measured in shade; Singapore in open tropical urban |
| *Cirsium arvense* | 4.76 | 6.62 | 1.4× | Similar context |
| *Deschampsia cespitosa* | 3.08 | 4.52 | 1.5× | Singapore warmer climate drives higher LAI |
| *Cornus stolonifera* | 0.05 | 0.23 | 4.6× | TRY has many drought/dormancy measurements dragging mean |
| *Caryocar brasiliense* | 1.48 | 2.36 | 1.6× | Savanna vs urban tropical |

The extreme cases (*Acer spicatum* 5×, *Cornus stolonifera* 4.6×) illustrate that using the wrong source value can produce a GPR result that is off by nearly an order of magnitude for a single surface.

### Primary context variables driving LAI variation

**1. Climate zone**  
Tropical humid climates sustain higher LAI year-round than temperate climates with seasonal deciduous loss. A temperate deciduous tree measured in winter vs a tropical evergreen are not comparable. TRY and ORNL databases aggregate across all seasons and climates — the mean hides this.

| Climate zone | Typical LAI range | Notes |
|---|---|---|
| Tropical humid (year-round) | 3–10 | Continuous growing season; high LAI |
| Subtropical (wet/dry) | 2–8 | Dry season reduction |
| Temperate (seasonal) | 1–7 | Deciduous species: near 0 in winter |
| Mediterranean (summer dry) | 1–5 | Drought-adapted; summer reduction |
| Arid/semi-arid | 0.2–3 | Extreme reduction; succulents low |

**2. Urban vs rural vs natural context**  
Urban environments impose multiple simultaneous constraints. The net effect is highly species- and installation-specific:

| Factor | Effect on LAI | Direction |
|---|---|---|
| Root restriction (pit, planter) | Reduced canopy size | ↓ LAI |
| Substrate depth < 400mm | Reduced root volume, stress | ↓ LAI |
| Elevated CO₂ (urban air) | Slight photosynthetic increase | ↑ LAI |
| Urban heat island | Extended growing season | ↑ LAI (temperate) |
| Light reduction (overshadowing) | Reduced photosynthesis | ↓ LAI |
| Irrigation supplementation | Reduced drought stress | ↑ LAI |
| Pollution / compaction | Stress response | ↓ LAI |
| Regular pruning | Reduced canopy density | ↓ LAI |

Net effect: urban LAI is typically 30–60% lower than open-ground LAI for the same species under the same climate. Some species show the opposite (street trees in warm irrigated climates can perform similarly to natural growth).

**3. Installation type**  
This is the most actionable variable for a planning tool because it is specified by the designer:

| Installation type | Substrate / root volume | Typical LAI adjustment | Confidence |
|---|---|---|---|
| Ground planting, deep soil (>1m) | Unlimited | 0.85–1.0 × open-ground | Medium |
| Ground planting, raised bed (600mm–1m) | Moderate | 0.70–0.90 | Low |
| Podium garden (400–600mm substrate) | Restricted | 0.55–0.75 | Low |
| Extensive green roof (<150mm) | Highly restricted | 0.30–0.55 | Low |
| Intensive green roof (150–400mm) | Restricted | 0.45–0.70 | Low |
| Street tree pit (standard) | Very restricted | 0.40–0.65 | Low |
| Street tree pit (structural soil) | Moderate | 0.60–0.80 | Low |
| Vertical greenery, soil-based | Wall-mounted, limited | 0.55–0.80 | Very low |
| Vertical greenery, hydroponic | No substrate limit | 0.70–0.90 | Very low |
| Atrium planting | Reduced light | 0.40–0.70 | Very low |

*Confidence reflects availability of measured data, not theoretical understanding.*

**4. Light availability**  
LAI is directly regulated by light. Shade-adapted species develop high LAI at low light; sun-adapted species may have low LAI but high photosynthetic efficiency per unit area. This matters for:
- North-facing walls (southern hemisphere) — significantly lower light
- Atrium and podium gardens with overshadowing
- Street tree pits under building canopies
- Understorey planting in multi-layered schemes

**5. Measurement methodology**  
Different measurement methods produce systematically different LAI values:

| Method | Typical bias | Notes |
|---|---|---|
| Destructive harvest (gold standard) | None | Labour-intensive; not practical at scale |
| LAI-2000 / Plant Canopy Analyser | Slight underestimate | Most common; Boon & Tan 2009 method |
| Hemispherical photography | Underestimate 10–30% | Clumping correction required |
| Litter traps | Seasonal; one-sided area | Standard for forests |
| MODIS/remote sensing | Landscape-scale; urban artefacts | Not species-level |

The TRY database aggregates across all methods without systematic correction. This adds methodological noise to the already large contextual variance.

### What this means for GPRTool

**Immediate position (MVP):**
- Use best-available LAI value from the highest-confidence source (Singapore field > ORNL/TRY)
- Display source provenance for every value in the UI
- Flag ORNL/TRY values with a caution note: *"Measured in open/natural conditions. Urban LAI may be lower. Urban calibration pending."*
- Do not fabricate urban adjustment factors without measured data to support them

**Near-term database work:**
- Add `context_notes` field to the database recording known variation (e.g. *"TRY mean includes shade-grown values; Singapore field measured in open tropical urban"*)
- Add `measurement_method` field where known
- Add `climate_zone_of_measurement` field
- Record `min_lai` and `max_lai` from TRY — the range is as informative as the mean

**Long-term research programme (substantial funding required):**
This is a research programme, not a development task. It requires:
- Systematic field LAI measurement campaigns across climate zones (Perth, Singapore, Hong Kong, a temperate European city)
- Controlled experiments varying substrate depth, light level, and installation type
- A peer-reviewed publication establishing the urban LAI adjustment framework
- Funding order of magnitude: AUD 500K–2M for a rigorous multi-city programme

Until that data exists, GPRTool's LAI values carry an honest uncertainty that must be communicated to users — not hidden. The Singapore field data is the only directly urban-measured source we currently have. It covers 35 species. Everything else is an informed estimate.

### Database notation standard

Every LAI entry in the database should carry sufficient metadata for a user or reviewer to assess its fitness for a given application. The minimum required fields are:

| Field | Purpose |
|---|---|
| `mean_lai` | Best-estimate value for calculation |
| `min_lai` / `max_lai` | Known range — communicates uncertainty |
| `measurement_count` | Sample size — low n = low confidence |
| `sources` | Primary source(s) |
| `urban_context` | Boolean — was this measured in an urban setting? |
| `singapore_field_lai` | Singapore urban field value if available (Boon & Tan 2009) |
| `context_notes` | Free text — known sources of variation, climate of measurement, method |
| `confidence_tier` | 1 = urban field measured; 2 = open-ground measured; 3 = literature estimate |

**Confidence tier definition:**
- **Tier 1** — directly measured in urban conditions (Singapore field data; future urban campaigns)
- **Tier 2** — measured in open/natural conditions; reasonable proxy with disclosed uncertainty
- **Tier 3** — estimated from literature, manufacturer data, or expert judgement; use with caution

Currently in GPRTool's database:
- Tier 1: 35 species (Singapore field, Boon & Tan 2009)
- Tier 2: ~725 species (ORNL/TRY)
- Tier 3: 0 (not yet added)

The free-tier `plants_free.json` already implements provenance badges (Field / ORNL / Lit) as a user-facing representation of this tier system.

---

## Current Processed Data (as of 2026-03-17)

| File | Contents |
|------|----------|
| `LAI_combined_clean.csv` | All unique species from ORNL + TRY, aggregated |
| `LAI_tropical_subset.csv` | Tropical/subtropical species flagged by latitude |
| `LAI_categorised.csv` | All 760 species categorised by genus lookup |
| `LAI_category_report.txt` | Category counts and REVIEW list |
| `LAI_explorer_report.txt` | Full pipeline report |
| `Material Library.csv` | Working GPRTool species library (manual) |

### Category counts (from lai_categorise.py)
| Category | Count |
|----------|-------|
| Tree | 248 |
| Multi-Species | 323 |
| REVIEW | 55 |
| Generic-Benchmark | 38 |
| Shrub | 29 |
| Groundcover | 25 |
| Grass | 22 |
| Mangrove | 10 |
| Bamboo | 9 |
| Palm | 1 |
| **TOTAL** | **760** |

**Pending:** Boon to manually categorise 55 REVIEW species in `LAI_categorised.csv`.

---

## Data Sources

### 1. ORNL DAAC — Global LAI Database (Woody Plants 1932–2011)
- **File:** `LAI Database - ONRL.csv`
- **Coverage:** ~350 single species entries, global, woody plants only
- **Strength:** Long time series, peer-reviewed, includes some Australian Eucalyptus/Acacia
- **Weakness:** Mostly European and North American forest species; natural/plantation context only
- **Access:** Free, registration required — https://daac.ornl.gov
- **Status:** ✅ Downloaded, processed

### 2. TRY Plant Trait Database
- **File:** `LAI Database - TRY.csv` + `TRY Database/37339.txt`
- **Coverage:** Broader global coverage, includes some tropical genera (Ficus, Terminalia etc.)
- **Strength:** LAI measurements include latitude/longitude for tropical flagging; large dataset
- **Weakness:** Still natural/plantation context; requires data request/registration
- **Access:** Free, data request required — https://www.try-db.org
- **Status:** ✅ Downloaded, processed (including raw 37339.txt with location data)

### 3. Tan & Sia 2009 — GPR Guidebook (LOCAL REFERENCE)
- **File:** `Tan, Sia - 2009 - LAI of tropical plants - a Guidebook on its use in the calculation of GPR.pdf`
- **Coverage:** Tropical species specifically for GPR calculation in Singapore context
- **Strength:** Urban-context LAI, the only source directly calibrated for GPR; foundational IP reference
- **Weakness:** Limited species list; Singapore-centric
- **Access:** In-house — already in folder
- **Status:** ⏳ Pending — species list and LAI values to be manually extracted and cross-referenced

### 4. LeafWeb / LOPEX Database
- **Coverage:** Leaf optical properties and LAI, global
- **Strength:** Includes some canopy LAI measurements; useful for spectral validation
- **Weakness:** Primarily optical physics, not urban context
- **Access:** Free — https://www.lopexdatabase.com
- **Status:** 🔲 Not yet assessed

### 5. GlobAI — Global Plant Functional Type LAI
- **Coverage:** Satellite-derived LAI aggregated by plant functional type (PFT)
- **Strength:** Large coverage, includes tropical broadleaf evergreen (relevant for SE Asia)
- **Weakness:** PFT averages, not species-level; not urban
- **Access:** Free via ESA/Copernicus — https://land.copernicus.eu/global/products/lai
- **Status:** 🔲 Not yet assessed — potentially useful for benchmark/sanity check

### 6. MODIS LAI Product (MOD15A2H)
- **Coverage:** Global, 500m resolution, time series
- **Strength:** Continuous global LAI, tropical coverage excellent
- **Weakness:** Landscape-scale, not species-level; remote sensing artifact in urban areas
- **Access:** Free via NASA EarthData — https://earthdata.nasa.gov
- **Status:** 🔲 Not yet assessed — useful for regional benchmarks only

### 7. NParks Flora & Fauna Web (Singapore)
- **Coverage:** Singapore native and cultivated species database
- **Strength:** Directly relevant urban species for tropical GPR; includes growth form data
- **Weakness:** No LAI values — but provides species list, growth habit, and images useful for lookup
- **Access:** Free — https://www.nparks.gov.sg/florafaunaweb
- **Status:** 🔲 Not yet assessed — use as species crosswalk, not LAI source

### 8. FloraBase (Western Australia)
- **Coverage:** WA native flora, taxonomy, distribution
- **Strength:** Perth-relevant species; growth form data; useful for WA urban greenery context
- **Weakness:** No LAI values
- **Access:** Free — https://florabase.dpaw.wa.gov.au
- **Status:** 🔲 Not yet assessed — use as species crosswalk for Perth context

### 9. AusTraits — Australian Plant Trait Database
- **Coverage:** Australian plants, functional traits including some LAI/SLA measurements
- **Strength:** Australian native species, peer-reviewed, growing dataset
- **Weakness:** LAI coverage sparse; mostly natural context
- **Access:** Free — https://austraits.org
- **Status:** 🔲 Not yet assessed — HIGH PRIORITY for Perth/Australian urban context

### 10. GBIF — Global Biodiversity Information Facility
- **Coverage:** Occurrence data, not LAI — but useful for confirming species distributions
- **Strength:** Confirms whether a species occurs in a target climate zone
- **Weakness:** Not a trait database
- **Access:** Free — https://www.gbif.org
- **Status:** 🔲 Background utility only

### 11. Peer-reviewed Urban LAI Literature (Manual Extraction)
- **Coverage:** Scattered papers measuring LAI in urban settings — green roofs, vertical greenery, street trees
- **Strength:** THE primary source for urban-context values; directly defensible
- **Weakness:** No single database exists; must be manually harvested
- **Key sources to mine:**
  - Papers citing Tan & Sia 2009
  - Singapore BCA / NParks technical reports
  - Hong Kong BEAM Plus studies
  - European urban greenery studies (Hedera, Parthenocissus for vertical greenery)
  - Living wall manufacturer technical data (Biotecture, Sempergreen, ANS Group)
  - Urban heat island studies with embedded LAI measurements
- **Access:** Google Scholar, Scopus, ResearchGate; some via Curtin library
- **Status:** 🔲 Not yet started — Phase 2 priority; Mobius Factory can assist

---

## Strategies

### Strategy A — Curated Species Library (MVP)
Build a hand-curated list of 50–100 species most relevant to Perth and Singapore urban greenery contexts. Source LAI from ORNL/TRY where available; supplement with Tan & Sia 2009 values; add urban adjustment factors based on installation type (conservative estimates until measured data available). This is the GPRTool MVP material library.

**Output:** `Material Library.csv` (already started)  
**Timeline:** Doable now with existing data  
**Risk:** Urban adjustment factors are expert estimates, not measured — must be disclosed

### Strategy B — Full Database Expansion
Systematically pull from AusTraits, NParks, and peer-reviewed urban LAI literature to expand species coverage and add measured urban LAI values where they exist. Cross-reference all entries with ORNL/TRY for consistency.

**Output:** Expanded `LAI_combined_clean.csv` with `urban_lai`, `urban_context`, `substrate_depth`, `light_level` fields  
**Timeline:** Months; suitable for Mobius Factory automation  
**Risk:** Labour-intensive; some sources incomplete

### Strategy C — Mobius Factory Autonomous Crawl
Configure a Mobius Factory module (`Urban Greenery & LAI`) to continuously crawl peer-reviewed urban LAI literature, Singapore/HK/EU technical guidelines, and manufacturer plant data. Evaluated findings enter a Supabase knowledge layer; GPRTool pulls from it periodically.

**Output:** Self-improving, citable urban LAI knowledge base  
**Timeline:** Medium-term; requires Factory module build  
**Risk:** Data quality depends on Factory evaluation prompts

---

## Recommended Next Steps (in order)

1. **Boon:** Manually categorise 55 REVIEW species in `LAI_categorised.csv`
2. **Boon:** Annotate `LAI_tropical_subset.csv` — mark species relevant to Perth/Singapore
3. **Extract Tan & Sia 2009** — species list and LAI values → add to combined database with `source = "Tan_Sia_2009"` and `urban_context = TRUE`
4. **Assess AusTraits** — download trait data, check LAI/SLA coverage for Australian species
5. **Build curated Material Library** — 50–100 species, Strategy A, ready for GPRTool MVP
6. **Define urban adjustment factor schema** — installation type × substrate depth × light level → LAI multiplier
7. **Strategy B/C** — post-MVP, expand with Factory integration

---

## Urban Context Metadata Schema (proposed)

For each species entry in the final material library:

| Field | Values | Notes |
|-------|--------|-------|
| `species_name` | binomial | |
| `common_name` | string | |
| `category` | Tree / Shrub / Groundcover / Grass / Climber / Bamboo / Palm / Mangrove | |
| `lai_reference` | float | Best available value from literature (natural context) |
| `lai_urban` | float | Measured urban value if available |
| `urban_adjustment` | float | Multiplier for installation type (0–1) |
| `installation_type` | Street Tree / Rooftop / Vertical / Podium / Atrium / Ground | |
| `substrate_depth_min` | mm | Minimum substrate for viable LAI |
| `light_requirement` | Full Sun / Part Shade / Shade | |
| `climate_zone` | Tropical / Subtropical / Temperate | |
| `source` | string | Citation |
| `urban_source` | string | Urban measurement citation if different |
| `notes` | string | |

---

*Last updated: 2026-03-17*
