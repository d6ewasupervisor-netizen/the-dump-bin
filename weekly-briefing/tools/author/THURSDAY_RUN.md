# Thursday run — instructions for the scheduled author session

You are producing the District 8 Weekly Kompass Briefing for the week named in the task prompt
(`WEEK`, e.g. `P10W4`; `NEXT` is the week after, e.g. `P11W1`). T is reachable by text only.
Nothing publishes unless T replies. Work alone; do not ask questions in chat — the chat has no reader.

Budget: start at 3:00 pm PT, flags texted by ~3:25, published by 4:00 pm PT.

## 0. Setup (5 min)

```
git clone --depth 1 https://github.com/d6ewasupervisor-netizen/the-dump-bin ~/hub
cd ~/hub/weekly-briefing/tools/author
pip install --break-system-packages -q pymupdf img2pdf openpyxl pillow numpy
export EOD_API_BASE=...   WEEKLY_BRIEFING_AUTHOR_TOKEN=...      # from the task prompt
python3 -I eodapi.py sources --week $WEEK --out ~/src/$WEEK
python3 -I eodapi.py sources --week $NEXT --out ~/src/$NEXT     # may be partial or absent
```

Read `README.md` here and the rules in it. The project memory files (content-rules,
build-and-narration) are the same rules; README wins if they differ.

**Stop-and-text conditions** (text T, then exit; do not build):
- `Considerations*.pdf` or `*Kompass Notes*.pdf` (Final for `WEEK`) missing from the week folder.
- `Test Set Notes*.pdf` missing AND the week has a test set on the Kompass Notes cover.
- eod-api unreachable or 401.

Text format for a stop: `[briefing] WEEK stopped: <what is missing>. Nothing built. Reply "go" to
build without it, or add the file to the Dump Bin and reply "retry".` Then `wait` up to 45 min and
act on the reply (`go` = build and say so in the final text; `retry` = re-fetch sources once).

## 1. Extract and read (10 min)

```
python3 -I extract_sources.py ~/src/$WEEK ~/src/$NEXT --out ~/wk/week_extract.json --out-md ~/wk/digest.md
```

Read `digest.md` fully. For every store-specific claim you intend to use, open the JSON and confirm
it against the underlying table (manifest rows, store grid, Projections store list). OCR grids
(`ocr: true`) must agree with a text-layer source or become a flag.

## 2. Flags → text (by 3:25)

Open the thread, then text the numbered flag list. One flag per disagreement, projection-only item,
OCR-only store list, missing optional source, or judgment call on inclusion. Each flag ends with a
recommendation. Keep it under ~1,200 characters; the route splits long texts.

```
python3 -I eodapi.py thread --week $WEEK open
python3 -I eodapi.py text --file ~/wk/flags.txt
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
python3 -I eodapi.py wait --week $WEEK --since $SINCE --timeout 2700
```

Flag text shape:
```
[briefing] P10W4 flags (reply "y" for all recs, or "2: 4 hrs, 5: out"):
1. Meatless hours: TSN 2 / KNotes 4 → rec 4
2. ...
Build: staging unless you say "live".
```

Reply handling: `y` = all recommendations; `N: text` overrides flag N; `live` anywhere = live mode;
`stop` = close thread, text "stopped", exit. No reply in 45 min: text
`[briefing] WEEK: no reply by 4:10 — nothing published. Reply "y" to resume.` and `wait` another
30 min; still nothing → close the thread and exit. Never publish without a reply.

While waiting, draft `briefing.json`, `questions.json`, `meta.json` on the recommended path so the
build starts the moment the reply lands.

## 3. Author (parallel with the wait)

- `briefing.json`: copy `example/P10W3_briefing.json`, replace content. `sets` = this week's D8
  sets from the Kompass Notes cover (GM table excluded, vendor rows excluded). Frames: title →
  glance → one frame per set that changes execution (sets that don't, share a frame) → callouts →
  looking ahead (NEXT: hours, updates, D8-specific store lists; test sets futurecast only, no test
  store numbers; "the week after" = NEXT+1 in one line) → key facts close. Narration paragraph per frame.
- `questions.json`: one or two per content stop, 10–16 total for a normal week, `stop` = the frame
  the fact lives on. Store-number questions only for D8-wide facts confirmed in step 1.
- `meta.json`: `week`, `district: "D8"`, `title` "Period N · Week N", `dueAt` = Monday 06:00 PT
  after the week starts (ISO with -07:00/-08:00), `passPct: 80`, `board: "callsign"`,
  `stops` = `_stops.json` from the render, `sections` (name + stop numbers), one dry `closer`.
- Apply T's overrides exactly; "y" = every recommendation as written in the flag text.

## 4. Render and check

```
python3 -I render_deck.py ~/wk/briefing.json --out ~/wk/build
python3 -I render_handout.py ~/wk/briefing.json --out ~/wk/build
cp ~/wk/questions.json ~/wk/meta.json ~/wk/briefing.json ~/wk/build/
python3 -I ../build_pack.py --check-only --pdf ~/wk/build/deck.pdf --narration ~/wk/build/narration.txt \
        --meta ~/wk/build/meta.json --questions ~/wk/build/questions.json --out /tmp/chk
```
Fix anything the checks report; re-render. Look at `frames/*.png` (contact sheet) once — overflow
and wrapped pills are the usual defects.

## 5. Publish

```
REQ=$(date -u +%Y%m%d)-1
python3 -I eodapi.py post --week $WEEK --request $REQ --mode ${MODE:-staging} --dir ~/wk/build
```
eod-api commits the files + `build.json`; briefing-worker builds (≈5–6 min) and texts T the result
with the preview/hub link. Then:

```
python3 -I eodapi.py thread --week $WEEK close
python3 -I eodapi.py text "[briefing] WEEK handed to the worker (request REQ, MODE). Teams note: <paste note>. Handout attached in the email."
```
Teams note (no set details): "The meeting recap is available above. If you missed it or need to
refresh your memory, watch it, then take the quiz. https://the-dump-bin.com/weekly-briefing/ The
WEEK handout is attached."

If `post` fails, text T the error and exit. Do not retry a publish that may have succeeded.

## 6. Leave a trail

Final chat message (for T reading later): week, flags and T's answers, request id, mode, anything
the extractor couldn't parse, and the full path of the build folder.
