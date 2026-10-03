# ORBIT update — 3 October 2026

The supplied checkout matched https://lauorbit.github.io/ before these changes. All 12 tracked public project files, including ORBIT.xlsx, had identical SHA-256 hashes. Local HEAD and remote main were 9d16014aa561251c96b911b6d1393c03d7467a42. External CDN dependencies were outside that file comparison.

## Filters and journal display

- Journal name/ISSN search and all journal filters share the Search Journals tab. The separate Filter Journals tab has been removed. Filters update results automatically and narrow the search, or browse matching journals when the query is blank.
- Clearing the journal search text retains selected filters. Reset all clears the query, filters, and sort order. The default sort preserves relevance for searches and uses name order when browsing. Search with no criteria browses the full journal directory.
- Conferences: multiple ORBIT grades and CORE research areas, combined with name/ISSN search.
- Publishers: multiple ORBIT grades, combined with name/ISBN search.
- Journal grade filter: Elite and Warning list select the existing list-membership flags. Selections within this control are alternatives; the other journal criteria narrow those results.
- Elite journals: the Scholar extension's blue (#174ea6), with a visible Elite label. Warning styling takes precedence if both flags apply.
- Directory filters support reset, empty results, pagination, and retained selections across tabs. Missing publisher scores display as N/A.
- A complete ISSN with exact matches returns only those matching journals, including former IEEE identifiers. Name searches and complete ISSNs without an exact match retain their existing behavior.

## IEEE title succession

| Former title | Current title | ORBIT grade |
|---|---|---|
| IEEE Transactions on Systems, Man, and Cybernetics, Part A: Systems and Humans | IEEE Transactions on Systems, Man, and Cybernetics: Systems | A |
| IEEE Transactions on Systems, Man, and Cybernetics, Part B: Cybernetics | IEEE Transactions on Cybernetics | A+ |
| IEEE Transactions on Systems, Man, and Cybernetics, Part C: Applications and Reviews | IEEE Transactions on Human-Machine Systems | B |

The current-title grades already existed in the supplied workbook. Their canonical titles now appear first, with the former titles and ISSNs retained as searchable aliases. The ungraded historical Part A duplicate was merged into Systems. The separate pre-1996 journal record is unchanged. Former ISSNs are search aliases, not claims that the current journals still use those ISSNs.

Sources: [IEEE Systems](https://www.ieeesmc.org/publications/transactions-on-smc-systems/), [IEEE Cybernetics](https://www.ieeesmc.org/publications/transactions-on-cybernetics/), [IEEE Human-Machine Systems](https://www.ieeesmc.org/publications/transactions-on-human-machine-systems/), [IEEE reorganization editorial](https://www.ieeesmc.org/wp-content/uploads/2015/01/Editorial-SMC-Legacy-2013.pdf), [ISSN Part B](https://portal.issn.org/resource/ISSN/1941-0492), [ISSN Part C](https://portal.issn.org/resource/ISSN/1558-2442).

## Publisher scores and entity matching

The existing publisher methodology defines Reliability_Score as cross-system disagreement, the absolute difference between JUFO and Norwegian percentile scores on a 0–100 scale. The normalized value is:

`normalized disagreement = original Reliability_Score / 100`

This fixed scale preserves zero, ordering, and comparability; it does not force the observed smallest/largest values to 0/1. Lower values mean greater agreement. Grades continue to use the existing JUFO/Norwegian overlap rubric, independently of this score. Missing scores remain blank in Excel. All 1,199 remaining numeric publisher scores lie between 0.00254 and 0.75419.

The shared ISBN prefix 978311 had incorrectly linked the parent publisher to separately ranked imprints. Entity-name matches now retain each entity's own levels:

| Publisher | JUFO | Norwegian | ORBIT | Normalized score |
|---|---:|---:|---|---:|
| Walter de Gruyter (De Gruyter) | 3 | 2 | A+ | 0.01581 |
| De Gruyter Mouton | 2 | 2 | A | 0.00254 |
| De Gruyter Saur | 1 | 1 | C | 0.09020 |
| De Gruyter Oldenbourg | 1 | 1 | C | 0.09020 |

Excel rows retained/repaired: Publishers 2282, 2278, 2648, 2831. Source levels were taken from matching names already present in the supplied workbook, including Norwegian row 4712 for Oldenbourg and JUFO row 2778 for Mouton. Oldenbourg's current and predecessor ISBN prefixes and former name are preserved. Mouton's own source lists do not share an identical prefix, so Shared_ISBNs is blank rather than inventing a shared identifier.

Eight cross-match/redundant rows were cleared: 2279, 2280, 2281, 2649, 2777, 2778, 2832, 4712. Row positions are retained to preserve workbook references. Genuine Max Niemeyer and Medieval Institute Publications entries remain. This is a correction of the supplied release, not a refresh of source rankings.

Identity sources: [De Gruyter brands](https://www.degruyterbrill.com/publishing/about-us/about-de-gruyter-brill/our-brands), [Oldenbourg](https://www.degruyterbrill.com/publishing/about-us/about-de-gruyter-brill/our-brands/de-gruyter-oldenbourg). Score and grade definitions were checked against the retained OLDWEBSITE/index.html publisher methodology.

## Conference research areas

All 355 conferences were matched uniquely by normalized source title to retained OLDWEBSITE/ORBIT.xlsx conference records. The original core_FoR1/core_FoR2/core_FoR3 assignments supply 13 distinct research areas. No topics were inferred from name keywords and no conference grades changed. Research Areas and CORE FoR Codes are stored in Excel and emitted in the website dataset.

The CSE label is CORE's Computer systems engineering category; 46 is the broader Information and computing sciences category. [CORE area labels](https://www.core.edu.au/icore-portal/icore-portal-2026-committees).

## Rebuilding

Run `python3 tools/build_site_dataset.py` with openpyxl available. The workbook is the source of record. If the external Scopus/source ranking databases are absent, the builder reuses the published ASJC lookup and source distribution counts already in data/orbit-site-meta.js. It recomputes current ORBIT counts and rejects publisher scores outside [0,1]. Publisher score precision is preserved to five decimal places.

The output contains 49,623 journal records, 6,565 publisher records, and 355 conference records.

## Validation

An independent comparison checked 1,167,268 workbook cells: all 2,019 value changes fall within the explicit edit ranges, and unrelated values, styles, and worksheet features are preserved. Every generated website record and count matches the updated workbook. All 355 conference area/code assignments match the retained source mappings, and the corrected IEEE and De Gruyter records pass individual checks.

Browser verification passed 45 assertions covering Elite/Warning membership, combined conference grade/area filters, publisher grade filters, clearing/resetting filters, retained tab selections, current/former IEEE ISSNs, corrected De Gruyter results, normal journal-name search, and 390-pixel mobile layouts. No JavaScript page errors were detected. Desktop and mobile screenshots were visually reviewed.

The subsequent journal-search integration passed browser checks for name/ISSN and all-filter intersections, each criterion excluding an otherwise exact match, filter-only counts and pagination, every sort option, clear/reset behavior, retained state across tabs, rapid input changes, and browsing the complete directory. Desktop and 390-pixel mobile screenshots passed visual review with no horizontal overflow or JavaScript page errors. The workbook and generated datasets remain byte-identical to the validated data update.
