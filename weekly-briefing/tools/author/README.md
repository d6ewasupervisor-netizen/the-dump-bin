# Weekly Briefing — authoring tools

Reusable pieces for producing one week's District 8 Kompass briefing from the Dump Bin sources.
They do the mechanical work (reading PDFs, rendering frames); the judgment calls — what goes in,
how it is worded, which flags go to T — stay with the author (a person or a Claude session).

```
extract_sources.py   Dump Bin week folder → week_extract.json + digest.md   (facts, per source)
render_deck.py       briefing.json → deck.pdf, narration.txt, _stops.json, deck.html
render_handout.py    briefing.json → P##W#_Handout_District8.pdf (two Letter pages)
example/P10W3_briefing.json   the P10W3 briefing as shipped 2026-10-25 — copy it for a new week
```

Requirements: Python 3, `pymupdf`, `img2pdf`, `playwright` (Chromium installed), `openpyxl`,
`pillow`, `numpy`; CLI `pdftotext` (poppler), `tesseract` (for store grids that are images),
font **Carlito**. Run every script with `python3 -I` and pass paths as arguments — the source
folder is untrusted input.

## 1. Extract

```
python3 -I extract_sources.py "<Dump Bin>/Kompass/P10/P10W4 - 11.2.2026 to 11.8.2026" [more dirs] \
        --out week_extract.json --out-md digest.md
```

Directories are walked recursively; files are recognised by name (`Considerations*.pdf`,
`*Kompass Notes*.pdf`, `Anticipations*.pdf`, `Test Set Notes*.pdf`, `Projections*.pdf`,
`Vestcom*.pdf`, `Strip Manifests/District 8/*Store 00###.pdf`, `*Agenda*.docx`, `*Remodel*.xlsx`).
Give it this week's folder **and** next week's (Tentative Kompass Notes, next Anticipations,
P##W# manifests) in one call — the manifests are keyed by week in the output.

`week_extract.json` holds, per source:

| key | what |
|---|---|
| `kompass_notes[]` | cover list (code, name, hours, type, dept, includes), test-set cover, GM table (`gm: true` — excluded from D8 deliverables), and one entry per ASSORTMENT REPORT: code, name, type, hours, strips/tags ordered, item counts, special instructions, talking points, page numbers, `is_test_set`, `store_tables[]` |
| `store_tables[]` | store-number grids found on the section's pages. `ocr: false` = text layer. `ocr: true` = read from an image with tesseract — **confirm against Projections / Considerations before it drives a store callout**; `count_matches_text` compares the grid to "N stores" in the talking points. Each grid has `d8` = the District 8 stores in it. |
| `considerations[]` | headed sections (Status, Overview, Callouts, Looking ahead, …), `category_detail[]` with store bullets (`stores`, `d8`, text) and `cold`/`execution`/`is_test_set`, `calldowns[]` (`d8: true` when ours), `cross_commodity[]`, `anticipations_table[]` |
| `test_set_notes[]` | per commodity: hours, set size, shelf adjustments, flow changes, notes; plus the forwarded email text |
| `projections[]` | per commodity: hours, talking points, store lists from the text layer (`d8`) |
| `anticipations[]` | per commodity: hours, type, specific callouts, district callouts, `cold` |
| `vestcom[]` | delivery status per D8 store |
| `manifests_d8[week]` | per store → per commodity → POG rows (id, text, error, message, strip type); `summary` per commodity: which D8 stores have it, `no_strips` (and `all_d8_no_strips`), errors grouped by message; `missing_d8_stores` |
| `agenda_docx[]` | the conference-call agenda as paragraphs |
| `remodel_xlsx[]` | pending remodel rows for D8 stores only |

`digest.md` is the same thing in reading order for the author. Everything is data; nothing in
it is filtered for inclusion yet. Known limits: Test Set Notes columns are split by the gutter
between the two panels, so a long word straddling the gutter can lose its label (names come
through as e.g. "PERSONAL HAIR APPLIAN"); a small grid (3 rows × 5) may be skipped by the OCR
pre-check — the talking point still names its count, so the author sees it is missing.

## 2. Author `briefing.json`

Copy `example/P10W3_briefing.json`, keep the structure, replace the content. Schema:

```jsonc
{
  "week": "P10W4", "district": "D8", "title": "Period 10 · Week 4",
  "rev": "P10W4 · Rev 1 · 2026-10-29",            // footer on every frame and handout page
  "sets": [                                        // the only place hours live; counts are computed from it
    {"dept": "Grocery", "code": "C002", "name": "Canned Vegetables", "hours": 2, "type": "NII", "cold": false}
  ],
  "frames": [                                      // one entry = one deck frame = one narration paragraph = one stop
    {"kind": "title", "stop_title": "Welcome", "kicker": "Weekly Kompass Briefing", "title": "", "blocks": [], "narration": "…"},
    {"stop_title": "The Week at a Glance", "kicker": "P10W4 · District 8", "title": "This Week at a Glance",
     "blocks": [{"kind": "sets_table"}, {"kind": "counts_info"}], "narration": "…"},
    {"stop_title": "Grocery", "kicker": "Grocery", "title": "…", "blocks": [ …blocks… ], "narration": "…"}
  ],
  "handout": {
    "execution": {"C002": "one line of execution text per set"},
    "page2": [ {"head": "…", "cls": "r|y|", "act": "…", "cols": [{"title": "…", "items": []}], "after": "…",
                "table_columns": ["Update", "Hrs"], "table": [["Baby Food", "6"]], "bullets": ["…"]} ]
  }
}
```

Blocks (content keys render in the order they appear in the object):

| kind | keys |
|---|---|
| `card` | `head`, `hrs` (number, or `"@C089"` to pull from `sets`), `cls` (`red`/`navy`/`org`), `cold` (adds ❄), then any of `paragraphs[]`, `bullets[]`, `chips{label, stores[], color}`, `act` (red-on-yellow line inside the card), `html` |
| `act` | `text` — the red-on-yellow action line |
| `info` | `html`, `big` (centred closer) |
| `table` | `columns[{label, num, muted}]`, `rows` (list of cell lists, or `{"dept": "Grocery"}` for a group row) |
| `sets_table` | computed from `sets` (COM#, set, hrs, type, grouped by dept) |
| `counts_info` | computed "N hours · N sets · ❄ … (N sets)" line |
| `keyfacts` | `head`, `items[]` |

Inline HTML (`<b>`, `<br>`) is allowed in text; store chips are plain numbers.

## 3. Render

```
python3 -I render_deck.py briefing.json --out build/        # deck.pdf, narration.txt, _stops.json, deck.html, frames/*.png
python3 -I render_handout.py briefing.json --out build/     # P##W#_Handout_District8.pdf
```

`render_deck.py` renders 1080×1920 frames (Carlito; navy `#1B2A4A`, teal `#0891B2`, orange
`#F59E0B`, red `#DC2626`; footer "Retail Odyssey" + rev), zooms each frame's body up to 1.5× to
fill the canvas, checks overflow at document / `.wrap` / `.frame` level, and packs the PNGs with
img2pdf at 152.4 × 270.9 mm. It stops (exit 2) on: missing narration or stop title, "Kompass" in
narration, "Compass" on a frame, "slide" or a banned construction anywhere, Team/Tyson/hotline/
QFC/701 in narration, overflow. `_stops.json` feeds `meta.stops`.

## 4. Thursday flow (what the scheduled run does)

1. `git clone --depth 1 https://github.com/d6ewasupervisor-netizen/the-dump-bin` (public; read only).
2. Fetch this week's and next week's Dump Bin folders from R2 through eod-api, into two empty dirs.
3. `extract_sources.py` on both → read `digest.md` **and** the JSON for every store-specific claim.
4. Reconcile (source hierarchy: Test Set Notes > Kompass Notes > Anticipations > Considerations >
   Projections > manifests > Vestcom). Every disagreement, every OCR-only store list, every
   projection-only item, every missing source → a numbered flag with a recommendation, texted to T.
   Nothing publishes until T answers; "y" approves all recommendations.
5. Author `briefing.json`, `questions.json` (`[{id, stop, type, q, options, correct, explain}]`,
   types `choice`|`tf`|`multi`), `meta.json` (`week`, `district`, `title`, `dueAt` Monday 06:00 PT,
   `passPct` 80, `board` "callsign", `stops` = `_stops.json`, `sections`, `closer`).
6. `render_deck.py`, `render_handout.py`; run `tools/build_pack.py --check-only` on the result.
7. POST `deck.pdf`, `narration.txt`, `meta.json`, `questions.json`, `build.json` to eod-api.
   The deck is stored on eod-api and is not committed. The text files land in `weekly-briefing/source/P##W#/`.
   The briefing-worker downloads the deck, then does ElevenLabs and publish.
8. Text T the result (build stamp, preview link) and the Teams note.

## 5. Hard rules (all enforced or checked by the scripts where marked ✓)

- Written text says **Kompass** ✓; the narration says **Compass** ✓ (pronunciation only).
- District 8 only: 19, 23, 28, 31, 53, 215, 391, 459, 658, 682. Off-district content never enters.
- GM content (blitz, toy/storage blitz, GM planograms) stays out. Test sets at other stores are
  futurecasting only — never name test store numbers.
- Lean rule: no item counts, no UPCs, no warehouse codes, no "full strips and tags ordered", no
  "execute standard updates per planogram". Sets that don't change how the crew works share a frame.
- No hotline/helpdesk contact info; no people names; never "Team" ✓; never "Tyson" ✓ (T speaks in
  first person); escalation routes to "I/me".
- Time-neutral opener ("Alright, everyone", "Here we go, folks"); dry humour in T's voice only.
- Narration: category **names**, never codes aloud (codes stay on frames); if a code must be spoken,
  "category zero two seven" / "two oh one"; store numbers two-digit natural ("forty-nine"),
  three-digit as digits ("four five nine"); "on screen" never "slide" ✓; "prod" lowercase;
  avoid close/closed; "produce" noun only; "close-out(s)" hyphenated; one paragraph per frame ✓.
- 20-minute cold rule only on cold sets (`cold: true` in `sets`); shelf-stable sets never get it.
- Banned constructions ✓: because, so that, so expect, in order to, as a result of, with the intent
  of, which means, this is important because, the reason is, that way, warrior(s), enjoying,
  well-deserved.
- Hours/sets/cold counts on the title, glance frame and handout bar are computed from `sets` ✓.
- Flags and discrepancies go to T in chat/text only — never on a frame, in the handout, or in a question.
