# Parity checklist — what this is for

**Parity** means: the new field app (`eod-field-app`) can do the same *job* as live Dump Bin EOD for a real closeout day, without breaking data the phone already has, and without surprising the field lead.

You are **not** checking that every pixel matches the old accordion UI. You are checking:

1. Same backends (eod-api) still work.
2. Same saved day on the phone still loads (drafts, photos, day-confirm).
3. The new “digital sheet is the heart” rules behave correctly.
4. Send is safe (especially when a hosted sheet exists).

Live app (leave alone): https://the-dump-bin.com/EOD/  
Pilot app: this folder, served locally (see below).  
Pilot version badge: `v3.0.1` (tap = test mode; long-press = force Update). SAS/SI green lights + refresh match live EOD (`/sas-auth-status`, `/rebotics-auth-status`, trigger-auth).

When every checklist item below passes on **store 999** and then **one real store**, the rebuild is ready for you to *consider* cutover (`CUTOVER.md`). Until then, production stays on live 2.13.x.

---

## How to run the side-by-side

You want **two tabs, same browser profile** (Chrome profile, etc.):

| Tab | URL | Role |
|-----|-----|------|
| A — Live | https://the-dump-bin.com/EOD/ | “What works today” |
| B — Pilot | http://localhost:5173 | “What we’re shipping next” |

### Start the pilot

```bat
cd C:\Users\tgaut\eod-field-app
npx --yes serve -l 5173
```

### Auth (localhost is a different “site”)

APIs need a Dump Bin session JWT in **this page’s** `localStorage.dumpBinSession`.

Signing in on https://the-dump-bin.com does **not** sign you into http://localhost:5173 — browsers keep storage per origin.

On the pilot you’ll see a **Pilot sign-in** card. Use one of:

1. **Text me a PIN** (easiest) — same SMS OTP as Dump Bin sign-in.
2. **Email me a link** — magic link should return to `localhost:5173` (needs eod-api deploy that allows localhost return URLs).
3. **Paste JWT** — on Dump Bin while signed in: DevTools → Application → Local Storage → `dumpBinSession` → paste into the pilot.

Auth dot green + sign-in card gone = good. If SMS/email fail with a network/CORS message, eod-api hasn’t allowed localhost origins yet (deploy in progress / needed).

### Which stores to use

1. **999 first** — safe test store; Find Shifts returns a fake visit; good for UI and gates without touching a real SAS visit.
2. **One real store** — pick a store/date that either (a) has a hosted digital sheet for the week, or (b) does not, so you can exercise both paper-hidden and paper-required paths.

---

## What “same contracts” means (phone data)

Field leads often mid-week switch apps or we cut over later. The pilot must read/write the **same browser storage keys** as live so nothing evaporates.

| What the lead cares about | Where it’s stored | Why it matters |
|---------------------------|-------------------|----------------|
| “I already confirmed this store today” | `localStorage.kompassDayConfirm` | Token sent as `X-Day-Confirm` on marks/send. Wrong shape → 412 / re-confirm loops. |
| Draft answers (recipients, managers, notes, Yes/No flags) | `localStorage.kompassEOD` | Closing the tab shouldn’t wipe the day. |
| Name / email | `localStorage.kompassProfile` | Used on Send and reply paths. |
| Lead signature image | `localStorage.kompassSignature` | Required before Send in the pilot. |
| Cart / sign-off photos | IndexedDB photo sessions (`session:<store>:<date>`) | Must still be there after reload and after cutover. |
| Server truth | `https://eod-api.the-dump-bin.com` | No second API; marks and send hit production. |

**Pass:** Confirm store on pilot → close tab → reopen pilot → same store/date still confirmed (or re-confirm once if token expired). Photos you added still show under Photos.

---

## Checklist (do these in order)

Mark each **Pass / Fail** as you go. Fail = note what you saw; that’s a fix ticket for `eod-field-app` only.

### 1. Visit gate

**What:** You cannot wander into Signoff/Crew/Send until store + date are confirmed for the day.

**Do:** On Visit, enter store + date + your name → **Confirm store & date** → **Find shifts**.

**Pass:**

- Status shows confirmed; bottom nav appears; Continue goes to Signoff.
- Shifts for that store only (exact match: store **28** must not pull **281**).
- On 999, you get a test shift card without a real SAS hit.

**Why:** Live already requires day-confirm before send; the pilot makes it a hard front door.

---

### 2. Land on Signoff (heart)

**What:** After Visit is ready, the default home is the **digital signoff sheet**, not a six-section accordion.

**Do:** Confirm → Continue (or tap Signoff in the nav).

**Pass:** Big “Digital signoff sheet” card is first. Crew / Photos / Send are secondary (bottom nav / Cover link).

**Why:** That’s the whole point of the greenfield IA — the sheet is the day, not buried under photos and managers.

---

### 3. Hosted sheet — marks and send unlock

**What:** If eod-api has an ingested sheet for that store/week, you mark sets on the sheet.

**Do:** Wait for the sheet to load. Mark a few rows Complete / Not in store / Not in SI. Use search. Leave some rows open, go to Send (should be blocked). Tap **Acknowledge remaining open**, then Send should unlock (other Send requirements still apply).

**Pass:**

- Marks stick after Refresh.
- Chrome meta shows something like `3/12 marked` / `open sets` → `send OK` after ack or all marked.
- Send button stays disabled with a clear message while open sets remain (unless acknowledged).

**Why:** “Hard heart” rule — when a digital sheet exists, Send is gated on meaningful mark progress (or explicit acknowledge).

---

### 4. Paper sign-off hidden when sheet exists

**What:** Paper *sign-off photo* capture is only for weeks with **no** hosted sheet. Cart before/after photos stay.

**Do:** With a sheet loaded, open **Photos**.

**Pass:** You see cart before/after (and InstaWork photo if Yes). You do **not** see a paper sign-off capture section. Copy on the page should say the sheet exists / paper is hidden.

**Why:** Double work and confusion — digital marks replace photographing the paper weekly sheet when ingest already shipped it.

---

### 5. No hosted sheet — paper path still works

**What:** Opposite of #4. Some stores/weeks won’t have a sheet yet.

**Do:** Use a store/date with no sheet (summary says none), or temporarily trust the empty state on Signoff → **Paper sign-off photos**.

**Pass:**

- Photos shows paper sign-off capture.
- Send does **not** demand digital marks.
- Send **does** require at least one sign-off photo (plus signature / recipients as usual).

**Why:** Greenfield must not strand stores that aren’t on digital ingest yet.

---

### 6. Crew orbit

**What:** Timesheets and materials are secondary, but still reachable.

**Do:** Crew → Yes/No for InstaWork / Kompass → open each management overlay → Open the Dump Bin (materials).

**Pass:** Overlays open (same modules as live). Materials browser opens. Roster refresh doesn’t crash (999 may be empty — that’s OK).

**Why:** Ported modules must still mount outside the old monolith DOM.

---

### 7. Cover orbit

**What:** Managers, notes, helpdesk — not the main screen, but still part of the EOD.

**Do:** Cover (chrome link) → pick check-in/out managers from the saved pool if present → open Help desk → from Signoff, use department signatures.

**Pass:** Manager names load for *this* store (not a previous store if you switched quickly). Helpdesk wizard opens. Dept PIC UI mounts on Signoff.

**Why:** Live had race bugs when store-data responses arrived out of order; pilot load is seq-guarded — verify it.

---

### 8. Send review

**What:** Final gate + payload shape the API expects.

**Do:** Complete Visit + signature + ≥1 recipient (or profile email). Satisfy sheet gate (#3) or paper photo (#5). Tap **Preview**, then optionally **Send** on 999 / a safe test.

**Pass:**

- Preview shows a real subject like `KOMPASS EOD FM999 …`, a readable body, and recipient list.
- With open digital sets and no acknowledge → Send disabled / alert.
- Successful send returns success (or a clear API error — not a silent fail).
- If day-confirm expired → you’re sent back to Visit to re-confirm (412 handling).

**Why:** `/send-eod` requires `storeNumber`, `subject`, `body`, `recipients` (not the old draft-only blob). Pilot builds that contract; Preview is how you verify before a live send.

**Note:** Pilot may send **without** the fancy cover PDF (`pdfBase64`) that live builds. Email body + sign-off photo links still go out. Full PDF parity is a known gap until we port PDF generation.

---

### 9. Draft / photo reload

**What:** Closing the browser mid-day doesn’t lose the work.

**Do:** On pilot, set recipients, managers, notes, add a cart photo → close the tab → reopen http://localhost:5173.

**Pass:** Same store/date (if day-confirm still valid), draft fields back, photos back under Photos.

**Why:** Cutover safety — a phone that still has last week’s draft must keep working when we swap the HTML.

---

### 10. Pilot version banner

**What:** Hotfix path for the pilot host (later Pages path).

**Do:** With the server running, edit `eod-version.json` to a new string (e.g. `3.0.1-pilot`), wait up to a few minutes or reload once so the checker runs.

**Pass:** Yellow/blue update banner appears offering Reload. After reload, banner matches the new version.

**Why:** Live EOD already hotfixes via version JSON; pilot should too so field testing isn’t “clear cache and pray.”

---

## Known gaps (failures here are OK for now)

These are **intentional** differences, not parity blockers:

| Gap | Meaning |
|-----|---------|
| No cover PDF in send payload yet | Live embeds `pdfBase64`; pilot sends text report + signoff photos. |
| No Weekly Tasks / Rebotics UI | Dead UI on live; omitted on purpose. |
| No 6-group accordion | Replaced by Signoff heart + orbit routes. |
| Thinner SAS add/remove roster UI | View/refresh first; full add/remove polish can follow. |

If something **not** on this list fails (marks don’t stick, paper shows with a sheet, Send ignores the digital gate, drafts vanish), treat it as a real bug.

---

## After the checklist

- All Pass on 999 + one real store → say so in chat; we can tighten gaps or prep cutover.
- Any Fail → paste the step number + what you expected vs what you saw (screenshot OK).
- Do **not** copy into `the-dump-bin/EOD` until you explicitly approve cutover (`CUTOVER.md`).
