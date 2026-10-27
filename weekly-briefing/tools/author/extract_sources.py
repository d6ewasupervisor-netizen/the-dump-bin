import os
#!/usr/bin/env python3
"""extract_sources.py — turn one week's Dump Bin folder into week_extract.json (+ a digest).

    python3 -I extract_sources.py <week_dir> [<extra_dir> ...] --out week_extract.json [--out-md digest.md]

Every directory given is scanned recursively. Files are recognised by name:

    Considerations*.pdf          *Kompass Notes*.pdf (Final / Tentative)
    Anticipations*.pdf           Test Set Notes*.pdf
    Projections*.pdf             Vestcom*.pdf
    Strip Manifests/District 8/*Store 00###.pdf
    *Agenda*.docx                *Remodel*.xlsx

Everything that comes out is data for the author (a person or a Claude session) to reconcile.
Nothing here decides what goes into the briefing. Store grids that live inside images are OCR'd
(tesseract) and marked "ocr": true — confirm those against a text-layer source (Projections,
Considerations) before they drive a store callout.
"""
import argparse, io, json, os, re, subprocess, sys, zipfile
from collections import OrderedDict, defaultdict

import pymupdf

D8_STORES = [19, 23, 28, 31, 53, 215, 391, 459, 658, 682]
D8_SET = set(D8_STORES)
WEEK_RE = re.compile(r"\bP(\d{1,2})W(\d)\b")


# ----------------------------------------------------------------------------- helpers

def pdftotext(path, first=None, last=None):
    cmd = ["pdftotext", "-layout"]
    if first:
        cmd += ["-f", str(first)]
    if last:
        cmd += ["-l", str(last)]
    cmd += [path, "-"]
    return subprocess.run(cmd, capture_output=True, text=True).stdout.replace("\f", "\n")


def page_texts(path):
    """Layout text per page (1-based list index 0 == page 1)."""
    n = len(pymupdf.open(path))
    return [pdftotext(path, i, i) for i in range(1, n + 1)]


def column_lines(page, ncols=None, bounds=None, anchor=None):
    """Group a page's words into columns, return list of line strings per column.
    bounds: list of x positions where each column starts; or anchor: a word whose distinct x0
    positions define the columns (e.g. "Commodity", "District"); else ncols equal slices."""
    words = page.get_text("words")  # x0,y0,x1,y1,word,block,line,wno
    width = page.rect.width
    if anchor:
        xs = sorted({round(w[0]) for w in words if w[4] == anchor})
        merged = []
        for x in xs:
            if not merged or x - merged[-1] > 30:
                merged.append(x)
        if merged:
            # column boundary = the widest vertical gutter (x no word spans) between consecutive anchors
            W = int(width) + 2
            cov = [0] * W
            for w in words:
                if any(w[0] < ax - 2 and w[2] > ax + 2 for ax in merged):
                    continue  # a word glued across the column boundary (two columns touching)
                for x in range(max(0, int(w[0])), min(W, int(w[2]) + 1)):
                    cov[x] = 1
            bounds = [0]
            for i in range(len(merged) - 1):
                lo, hi = int(merged[i]) + 1, int(merged[i + 1])
                best, run, start = None, 0, None
                for x in range(lo, hi + 1):
                    if cov[x] == 0:
                        if start is None:
                            start = x
                        run = x - start + 1
                        if best is None or run > best[0]:
                            best = (run, start, x)
                    else:
                        start = None
                bounds.append((best[1] + best[2]) / 2 if best else (merged[i] + merged[i + 1]) / 2)
    if bounds:
        bounds = sorted(bounds)
        ncols = len(bounds)
    else:
        bounds = [i * (width / ncols) for i in range(ncols)]
    cols = [[] for _ in range(ncols)]
    for w in words:
        c = 0
        for i, b in enumerate(bounds):
            if w[0] >= b:
                c = i
        cols[c].append(w)
    out = []
    for ws in cols:
        ws.sort(key=lambda w: (w[1], w[0]))
        lines, cur, cy = [], [], None
        for w in ws:
            if cy is None or abs(w[1] - cy) <= 3.5:
                cur.append(w)
            else:
                lines.append(" ".join(x[4] for x in sorted(cur, key=lambda x: x[0])))
                cur = [w]
            cy = w[1] if cy is None or abs(w[1] - cy) > 3.5 else cy
        if cur:
            lines.append(" ".join(x[4] for x in sorted(cur, key=lambda x: x[0])))
        out.append(lines)
    return out


def grid_rows_from_text(text):
    """Rows that are only 1–3 digit numbers (>=3 of them) → store grid rows. Also 701 00### lists."""
    rows, five = [], []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        if re.fullmatch(r"[\d\s|]+", s):
            nums = [int(x) for x in re.findall(r"\b\d{1,3}\b", s)]
            if len(nums) >= 3:
                rows.append(nums)
        for m in re.finditer(r"\b701\s+00(\d{3})\b", s):
            five.append(int(m.group(1)))
    return rows, five


def _ocr_candidates(txt, k, label):
    grid, five = grid_rows_from_text(txt)
    toks = txt.split()
    numeric = [t for t in toks if re.fullmatch(r"\d{1,3}|00\d{3}", t)]
    score = (len(five) + sum(len(r) for r in grid), len(numeric))
    cand = {"image_index": k, "variant": label, "rows": grid, "stores": five or sorted({n for r in grid for n in r}),
            "numeric_tokens": len(numeric), "all_tokens": len(toks), "ocr": True}
    return score, cand


def _tess(path, psm):
    return subprocess.run(["tesseract", path, "-", "--psm", str(psm)], capture_output=True, text=True).stdout


def ocr_image_grids(doc, pno):
    """OCR each embedded image on a page; return list of {rows, stores, ocr:True, image_index}.
    Tesseract is fragile on bordered grids, so several variants are tried (colour/grey, 2x/3x,
    grid lines kept/erased, psm 4/6) and the one yielding the most store numbers wins. The author
    must still compare the count with the "N stores" claim in the talking points."""
    try:
        from PIL import Image, ImageOps
        import numpy as np
    except ImportError:
        return [{"error": "PIL/numpy missing", "ocr": True}]
    if not shutil_which("tesseract"):
        return [{"error": "tesseract missing", "ocr": True}]
    page = doc[pno - 1]
    found = []
    tmp = f"/tmp/_wb_ocr_{os.getpid()}.png"
    for k, img in enumerate(page.get_images(full=True)):
        try:
            pix = pymupdf.Pixmap(doc, img[0])
            if pix.n > 4:
                pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
            im0 = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
        except Exception as e:  # noqa
            found.append({"image_index": k, "error": str(e), "ocr": True})
            continue
        w, h = im0.size
        if w * h < 20000 or w > 2400:
            continue
        # quick pre-check: is there numeric table text at all?
        im0.convert("L").resize((w * 2, h * 2), Image.LANCZOS).save(tmp)
        s0, c0 = _ocr_candidates(_tess(tmp, 4), k, "L2-raw-4")
        if not c0["all_tokens"] or c0["numeric_tokens"] < 3 or c0["numeric_tokens"] / c0["all_tokens"] < 0.3:
            continue
        best = (s0, c0)
        for mode in ("RGB", "L"):
            for sc in (2, 3):
                im = im0.convert(mode).resize((w * sc, h * sc), Image.LANCZOS)
                a = np.array(im.convert("L"))
                dark = a < 128
                for y in np.where(dark.mean(axis=1) > 0.5)[0]:
                    a[max(0, y - 3):y + 4, :] = 255
                for x in np.where(dark.mean(axis=0) > 0.5)[0]:
                    a[:, max(0, x - 3):x + 4] = 255
                variants = {"raw": ImageOps.expand(im, border=40, fill=(255, 255, 255) if mode == "RGB" else 255),
                            "nolines": ImageOps.expand(Image.fromarray(a), border=40, fill=255)}
                for vname, vim in variants.items():
                    vim.save(tmp)
                    for psm in (4, 6):
                        sc_, cand = _ocr_candidates(_tess(tmp, psm), k, f"{mode}{sc}-{vname}-{psm}")
                        if sc_ > best[0]:
                            best = (sc_, cand)
        c = best[1]
        if c["all_tokens"] and c["numeric_tokens"] >= 5 and c["numeric_tokens"] / c["all_tokens"] >= 0.6:
            found.append(c)
    try:
        os.remove(tmp)
    except OSError:
        pass
    return found


def shutil_which(x):
    from shutil import which
    return which(x)


def d8_hits(nums):
    return sorted(n for n in set(nums) if n in D8_SET)


# ----------------------------------------------------------------------------- Kompass Notes

SEC_RE = re.compile(r"^SECTION\s+(\d{3})\s+(.+?)\s{2,}(NII|UPDATE|BLITZ|KMAINT|MAINTENANCE|VENDOR)\s*$", re.M)


def parse_kompass_notes(path):
    doc = pymupdf.open(path)
    pages = page_texts(path)
    out = {"file": os.path.basename(path), "kind": "tentative" if "entative" in os.path.basename(path) else "final",
           "week": None, "cover": [], "cover_total_hours": None, "test_set_cover": [], "test_set_total_hours": None,
           "gm": [], "gm_total_no_blitz": None, "gm_total_with_blitz": None, "sections": [], "pages_with_images": []}
    m = re.search(r"Kompass Notes - Period (\d+) Week (\d+)", pages[0])
    if m:
        out["week"] = f"P{int(m.group(1)):02d}W{m.group(2)}"
    # cover table(s): lines "   26   Dry Ramen ...   1   NII"
    dept, test_mode = None, False
    for line in pages[0].splitlines():
        s = line.strip()
        dm = re.match(r"Department (\d+) - (.+)", s)
        if dm:
            dept = dm.group(2).strip(); continue
        if s.startswith("TEST SET"):
            test_mode = True; continue
        tm = re.match(r"Total Hours \(Estimate\)\s+([\d.]+)", s)
        if tm:
            key = "test_set_total_hours" if test_mode else "cover_total_hours"
            out[key] = float(tm.group(1)); continue
        rm = re.match(r"(\d{1,3})\s{2,}(.+?)\s{2,}(?:([\d.]+)\s+)?(NII|UPDATE|BLITZ|VENDOR|MAINTENANCE|KMAINT)\s*$", s)
        if rm:
            row = {"code": f"C{int(rm.group(1)):03d}", "name": re.sub(r"\s*\*\*.*?\*\*", "", rm.group(2)).strip(),
                   "includes": re.findall(r"C\d{3}", rm.group(2)), "hours": float(rm.group(3)) if rm.group(3) else None,
                   "type": rm.group(4), "dept": dept}
            (out["test_set_cover"] if test_mode else out["cover"]).append(row)
    # GM page
    for pi, t in enumerate(pages):
        if "Department - GM" in t:
            for line in t.splitlines():
                gm = re.match(r"\s*(\d{3})\s+\d{3}\s+(.+?)\s{2,}([\d.]+)\s+(\w+)", line)
                if gm:
                    out["gm"].append({"code": gm.group(1), "name": gm.group(2).strip(), "hours": float(gm.group(3)), "type": gm.group(4), "gm": True})
                t1 = re.search(r"TOTAL NO BLITZ\s+([\d.]+)", line); t2 = re.search(r"TOTAL WITH BLITZ\s+([\d.]+)", line)
                if t1: out["gm_total_no_blitz"] = float(t1.group(1))
                if t2: out["gm_total_with_blitz"] = float(t2.group(1))
    # sections: start pages
    starts = []
    for pi, t in enumerate(pages):
        if re.search(r"^ASSORTMENT REPORT", t, re.M):
            starts.append(pi)
    for si, pi in enumerate(starts):
        end = starts[si + 1] if si + 1 < len(starts) else len(pages)
        text = "\n".join(pages[pi:end])
        sm = SEC_RE.search(text)
        if not sm:
            continue
        sec = OrderedDict()
        sec["code"] = f"C{sm.group(1)}"; sec["name"] = sm.group(2).strip(); sec["type"] = sm.group(3)
        sec["is_test_set"] = bool(re.search(r"TEST SET - STORE", text[:sm.start()])) or any("TEST SET - STORE" in pages[j] for j in range(max(0, pi - 1), pi + 1) if j < pi and starts and (j not in starts))
        dm = re.search(r"^DEPARTMENT\s+(.+?)\s{2,}", text, re.M); sec["dept"] = dm.group(1).strip() if dm else None
        mm = re.search(r"^MANAGER\s+(.+?)\s*$", text, re.M); sec["manager"] = mm.group(1).strip() if mm else None
        for key, label in (("strips_ordered", "Shelf Strips Ordered"), ("tags_ordered", "Shelf Tags Ordered"),
                           ("items", "New Items/Delete"), ("hours_text", "Hours to Complete")):
            km = re.search(rf"{label}:\s+(.+?)\s*$", text, re.M); sec[key] = km.group(1).strip() if km else None
        hm = re.search(r"([\d.]+)\s*hour", sec["hours_text"] or "")
        sec["hours"] = float(hm.group(1)) if hm else None
        # special instructions may wrap on the line above and below the label
        si_lines = []
        lines = text.splitlines()
        for i, l in enumerate(lines):
            if "Special Instructions:" in l:
                si_lines.append(l.split("Special Instructions:", 1)[1].strip())
                for j in (i - 1, i + 1):
                    if 0 <= j < len(lines) and re.match(r"\s{20,}\S", lines[j]) and not re.match(r"\s*(NEW|CHANGE|DELETE|Case UPC)", lines[j]):
                        si_lines.append(lines[j].strip())
                break
        sec["special_instructions"] = " ".join(x for x in si_lines if x).strip() or None
        sec["includes"] = sorted(set(re.findall(r"C\d{3}", sec["special_instructions"] or "")) - {sec["code"]})
        # talking points: after the label, drop item rows / page numbers
        tps = []
        for part in re.split(r"Talking Points for Update", text)[1:]:
            for l in part.splitlines():
                s = l.strip()
                if not s or re.fullmatch(r"\d{1,3}", s) or s.startswith("ASSORTMENT REPORT") or re.match(r"(Case UPC|NEW|CHANGE|DELETE)\b", s):
                    continue
                if re.match(r"\d{10,14}\s", s) or s.startswith("CHANGING "):
                    continue
                if s.startswith("SECTION") or s.startswith("DEPARTMENT") or s.startswith("MANAGER"):
                    break
                tps.append(s)
        sec["talking_points"] = tps
        sec["page_numbers"] = list(range(pi + 1, end + 1))
        # store grids: text layer first, then OCR of images on those pages
        grids = []
        for j in range(pi, end):
            rows, five = grid_rows_from_text(pages[j])
            rows = [r for r in rows if not (len(r) == 1)]
            # drop rows that are UPC-ish or sizes (only 1-3 digit tokens survive the regex anyway)
            if rows or five:
                grids.append({"page": j + 1, "ocr": False, "rows": rows, "stores": five or sorted({n for r in rows for n in r})})
            if doc[j].get_images():
                out["pages_with_images"].append(j + 1)
                for g in ocr_image_grids(doc, j + 1):
                    g["page"] = j + 1
                    grids.append(g)
        em = re.search(r"\b(\d{1,3}) stores\b", " ".join(sec["talking_points"]))
        sec["expected_store_count"] = int(em.group(1)) if em else None
        for g in grids:
            g["d8"] = d8_hits(g.get("stores", []))
            if sec["expected_store_count"] and g.get("stores") is not None:
                g["count_matches_text"] = len(g["stores"]) == sec["expected_store_count"]
        sec["store_tables"] = grids
        out["sections"].append(sec)
    # test-set flag: the marker line sits on the page before or the same page
    for sec in out["sections"]:
        p0 = sec["page_numbers"][0]
        sec["is_test_set"] = any("TEST SET - STORE" in pages[p - 1] for p in range(max(1, p0 - 1), p0 + 1)) \
            and sec["code"] in {r["code"] for r in out["test_set_cover"]} or sec["code"] in {r["code"] for r in out["test_set_cover"]}
    out["pages_with_images"] = sorted(set(out["pages_with_images"]))
    return out


# ----------------------------------------------------------------------------- Considerations

CONS_HEADS = ["Status", "Overview", "Priorities", "Callouts", "Looking ahead", "Cross-commodity NII", "Vendor Sets",
              "Standing rules", "Active vendor windows", "Mapping coverage", "Strip manifests", "Deli & Bakery",
              "Category Execution Detail", "Calldowns", "2026 Remodels", "GM Kompass", "Blitz store coordination", "Anticipations"]


def parse_considerations(path):
    text = pdftotext(path)
    lines = text.splitlines()
    out = {"file": os.path.basename(path), "week": None, "sections": OrderedDict(), "category_detail": [], "calldowns": [],
           "anticipations_table": [], "cross_commodity": []}
    m = WEEK_RE.search(text)
    if m:
        out["week"] = f"P{int(m.group(1)):02d}W{m.group(2)}"
    cur = "_preamble"
    buf = defaultdict(list)
    for l in lines:
        s = l.strip()
        head = None
        for h in CONS_HEADS:
            if re.fullmatch(rf"(P\d+W\d\s+)?{re.escape(h)}( — P\d+W\d| P\d+W\d( 2026)?)?", s):
                head = h
        if head:
            cur = head
            continue
        buf[cur].append(l)
    for k, v in buf.items():
        txt = "\n".join(v).strip("\n")
        out["sections"][k] = [x.strip() for x in txt.splitlines() if x.strip()]
    # category execution detail entries
    ced = buf.get("Category Execution Detail", [])
    entry = None
    for l in ced:
        s = l.strip()
        hm = re.match(r"(C\d{3})\s+(.+?)\s+—\s+(NII|Update|Blitz|Maintenance)\s*,\s*([\d.]+)\s*hrs?\s*(❄)?", s)
        if hm:
            entry = {"code": hm.group(1), "name": hm.group(2).strip(), "type": hm.group(3), "hours": float(hm.group(4)),
                     "cold": bool(hm.group(5)), "text": [], "store_bullets": [], "execution": None}
            out["category_detail"].append(entry); continue
        if s == "Test Set" and entry is not None:
            entry = None; continue
        em = re.match(r"Execution:\s*(P\d+W\d)", s)
        if em:
            # applies to the next entry
            pending_exec = em.group(1)
            out.setdefault("_pending_exec", pending_exec); continue
        if entry is None:
            continue
        bm = re.match(r"•\s+((?:\d{1,3}\s+)+)(.*)", s)
        if bm:
            stores = [int(x) for x in bm.group(1).split()]
            entry["store_bullets"].append({"stores": stores, "d8": d8_hits(stores), "text": bm.group(2).strip()})
        elif s:
            entry["text"].append(s)
    # execution week for test-set entries: look at the raw lines order
    exec_week = None
    for l in ced:
        s = l.strip()
        em = re.match(r"Execution:\s*(P\d+W\d)", s)
        if em:
            exec_week = em.group(1); continue
        hm = re.match(r"(C\d{3})\s+(.+?)\s+—\s+", s)
        if hm and exec_week:
            for e in out["category_detail"]:
                if e["code"] == hm.group(1) and e["execution"] is None:
                    e["execution"] = exec_week; e["is_test_set"] = True
            exec_week = None
    out.pop("_pending_exec", None)
    for e in out["category_detail"]:
        e.setdefault("is_test_set", False)
        e["cold"] = e["cold"] or any("20 minutes" in t for t in e["text"])
    # calldowns
    for l in buf.get("Calldowns", []):
        cm = re.match(r"\s*(This Week|Next|\+\d)\s+(\d{1,3})\s+(.+?)\s{2,}(District \d+)\s+(\S+)\s+([\d/]+\s*[–-]\s*[\d/]+)\s+(.+?)\s*$", l)
        if cm:
            out["calldowns"].append({"window": cm.group(1), "store": int(cm.group(2)), "store_name": cm.group(3).strip(),
                                     "district": cm.group(4), "relay_manager": cm.group(5), "dates": cm.group(6), "project": cm.group(7).strip(),
                                     "d8": int(cm.group(2)) in D8_SET})
    # cross-commodity
    for l in buf.get("Cross-commodity NII", []):
        xm = re.match(r"\s*(C\d{3})\s+(.+?)\s{2,}(C\d{3})\s+(.+?)\s*$", l)
        if xm:
            out["cross_commodity"].append({"receive": xm.group(1), "receive_name": xm.group(2).strip(), "report_under": xm.group(3), "report_under_name": xm.group(4).strip()})
    # anticipations table (next week)
    for l in buf.get("Anticipations", []):
        am = re.match(r"\s*(C\d{3})\s+C\d{3}\s+(.+?)\s{2,}(NII|UPDATE|BLITZ|MAINTENANCE)\s+([\d.]+)(?:\s+(C\d{3}))?", l)
        if am:
            out["anticipations_table"].append({"code": am.group(1), "name": am.group(2).strip(), "type": am.group(3), "hours": float(am.group(4)), "records_under": am.group(5)})
        tm = re.match(r"\s*Total\s+([\d.]+)", l)
        if tm:
            out["anticipations_total_hours"] = float(tm.group(1))
    return out


# ----------------------------------------------------------------------------- Test Set Notes

def parse_test_set_notes(path):
    doc = pymupdf.open(path)
    out = {"file": os.path.basename(path), "sets": [], "email": []}
    for page in doc:
        full = page.get_text()
        if "Email Notes" in full or "From:" in full:
            out["email"].extend([l.strip() for l in full.splitlines() if l.strip()])
            continue
        for lines in column_lines(page, anchor="Commodity"):
            cur = None
            for l in lines:
                cm = re.match(r"(?:Commodity\s+)?(\d{3})-([A-Za-z].*)", l)
                if cm:
                    name = re.sub(r"Commodity\s*$", "", cm.group(2)).strip()
                    cur = {"code": f"C{cm.group(1)}", "name": name, "hours": None, "set_size": None,
                           "shelf_adjustments": None, "flow_changes": None, "notes": []}
                    out["sets"].append(cur); continue
                if cur is None:
                    continue
                for key, label in (("hours", "Hours to Complete"), ("set_size", "Set Size"), ("shelf_adjustments", "Shelf Adjustments"), ("flow_changes", "Flow Changes")):
                    km = re.match(rf"{label}\s+(.+)", l)
                    if km:
                        v = km.group(1).strip()
                        if key == "hours":
                            hm = re.search(r"([\d.]+)", v); v = float(hm.group(1)) if hm else v
                        cur[key] = v; break
                else:
                    if l.strip() not in ("Integrated", "Test Set Notes"):
                        cur["notes"].append(l.strip())
    for s in out["sets"]:
        s["notes"] = " ".join(s["notes"])
    return out


# ----------------------------------------------------------------------------- Projections

PROJ_HEAD = re.compile(r"^(C\d{3})\s*[–-]+\s*(.+?)\s{2,}Period (\d+) Week (\d+)\s*$", re.M)


def parse_projections(path):
    text = pdftotext(path)
    out = {"file": os.path.basename(path), "sections": []}
    heads = list(PROJ_HEAD.finditer(text))
    for i, h in enumerate(heads):
        seg = text[h.end(): heads[i + 1].start() if i + 1 < len(heads) else len(text)]
        hm = re.search(r"Hours\s+([\d.]+)", seg)
        rows, five = grid_rows_from_text(seg)
        tp = []
        if "Talking Points" in seg:
            tp = [l.strip() for l in seg.split("Talking Points for Update", 1)[1].splitlines() if l.strip() and not re.fullmatch(r"[\d\s|]+", l.strip()) and not re.search(r"\b701\s+00\d{3}\b", l)]
        code = h.group(1)
        existing = next((s for s in out["sections"] if s["code"] == code), None)
        sec = existing or {"code": code, "name": h.group(2).strip(), "week": f"P{int(h.group(3)):02d}W{h.group(4)}", "hours": None, "talking_points": [], "stores": [], "grid_rows": []}
        if hm and sec["hours"] is None:
            sec["hours"] = float(hm.group(1))
        sec["talking_points"].extend(t for t in tp if t not in sec["talking_points"])
        sec["stores"] = sorted(set(sec["stores"]) | set(five) | {n for r in rows for n in r})
        sec["grid_rows"].extend(rows)
        if not existing:
            out["sections"].append(sec)
    for s in out["sections"]:
        s["d8"] = d8_hits(s["stores"])
    return out


# ----------------------------------------------------------------------------- Anticipations

def parse_anticipations(path):
    text = pdftotext(path)
    out = {"file": os.path.basename(path), "week": None, "sets": []}
    m = re.search(r"ANTICIPATIONS\s+(P\d+W\d)", text)
    if m:
        out["week"] = m.group(1)
    blocks = re.split(r"\n(?=C\d{3} [A-Z])", text)
    for b in blocks:
        hm = re.match(r"(C\d{3}) (.+)", b.strip())
        if not hm:
            continue
        body = " ".join(l.strip() for l in b.splitlines()[1:] if l.strip() and "| Division 701 | Page" not in l)
        s = {"code": hm.group(1), "name": hm.group(2).strip(), "hours": None, "type": None, "specific": None, "district": None, "cold": "refrigerated/frozen" in body.lower()}
        tm = re.search(r"estimated at ([\d.]+) hours — (\w+)", body)
        if tm:
            s["hours"] = float(tm.group(1)); s["type"] = tm.group(2)
        sm = re.search(r"Specific Callouts:\s*(.+?)(?:• District Callouts:|$)", body)
        if sm:
            s["specific"] = sm.group(1).strip()
        dm = re.search(r"District Callouts:\s*(.+)$", body)
        if dm:
            s["district"] = dm.group(1).strip()
        out["sets"].append(s)
    return out


# ----------------------------------------------------------------------------- Vestcom

def parse_vestcom(path):
    doc = pymupdf.open(path)
    out = {"file": os.path.basename(path), "d8": OrderedDict(), "all": []}
    for page in doc:
        for lines in column_lines(page, anchor="District"):
            last = None
            for l in lines:
                tm = re.match(r"(\d{12})\s+FE(\d{5})\s*-\s*(.+)", l)
                if tm:
                    last = {"tracking": tm.group(1), "store": int(tm.group(2)), "store_name": tm.group(3).strip(), "status": None}
                    out["all"].append(last); continue
                if last and re.match(r"(Delivered|In Transit|Out for|Label|Exception|Picked)", l, re.I):
                    last["status"] = l.strip(); last = None
    for r in out["all"]:
        if r["store"] in D8_SET:
            out["d8"][str(r["store"])] = {"tracking": r["tracking"], "status": r["status"]}
    return out


# ----------------------------------------------------------------------------- Strip manifests (D8)

STRIP_TYPES = r"(NII BOTH|R BOTH|NII POG|R POG|NII STRIPS|R STRIPS|NII BOOK|R BOOK)"


def parse_manifest(path):
    text = pdftotext(path)
    lines = text.splitlines()
    sm = re.search(r"Store #(\d{5})", text)
    store = int(sm.group(1)) if sm else None
    # header columns
    hdr = next((l for l in lines if "POG ID" in l and "Error Message" in l), "")
    col_err = hdr.find("Errors"); col_msg = hdr.find("Error Message"); col_strip = hdr.find("Strip/POGBook")
    rows = []
    for l in lines:
        m = re.match(r"^(0\d{4})\s+(D701_\S+)\s*(.*)$", l)
        if m:
            rest = m.group(3)
            em = re.search(rf"\s(Yes|No)\s+(.*?)\s*{STRIP_TYPES}?\s*(Store|Office)?\s*$", rest)
            if em:
                pog_text = rest[:em.start()].strip()
                row = {"pog_id": m.group(2), "pog_text": pog_text, "error": em.group(1) == "Yes",
                       "error_message": (em.group(2) or "").strip(), "strip_type": em.group(3), "owner": em.group(4)}
            else:
                row = {"pog_id": m.group(2), "pog_text": rest.strip(), "error": None, "error_message": "", "strip_type": None, "owner": None}
            rows.append(row); continue
        if rows and l.startswith(" ") and l.strip():
            # continuation line: [pog-id suffix at the far left] [pog text] [error message] by column position
            r = rows[-1]
            rest = l
            lm = re.match(r"^\s{1,20}([\w_]{1,24})(?=\s{2,}|\s*$)", l)
            if lm:
                r["pog_id"] += lm.group(1)
                rest = l[:lm.start(1)] + " " * len(lm.group(1)) + l[lm.end(1):]
            for part in re.finditer(r"\S(?:.*?\S)?(?=\s{2,}|\s*$)", rest):
                txt = part.group(0).strip()
                if not txt:
                    continue
                pos = part.start()
                if col_err > 0 and pos >= col_err - 12:
                    if col_strip > 0 and pos >= col_strip - 4:
                        continue  # strip-type / owner column; already captured
                    r["error_message"] = (r["error_message"] + " " + txt).strip()
                else:
                    r["pog_text"] = (r["pog_text"] + " " + txt).strip()
    by_code = OrderedDict()
    for r in rows:
        cm = re.search(r"_C(\d{3})_", r["pog_id"])
        code = f"C{cm.group(1)}" if cm else "?"
        by_code.setdefault(code, []).append(r)
    return store, by_code


def manifest_summary(stores):
    """stores: {store: {code: [rows]}} → per code: stores with it / errors / no strips."""
    summ = OrderedDict()
    for store, codes in stores.items():
        for code, rows in codes.items():
            s = summ.setdefault(code, {"stores": [], "errors": {}, "no_strips": [], "pog_texts": {}})
            s["stores"].append(int(store))
            for r in rows:
                s["pog_texts"].setdefault(r["pog_text"], []).append(int(store))
                if r["error"]:
                    s["errors"].setdefault(r["error_message"] or "error", []).append(int(store))
                    if re.search(r"will not get strips|Could Not produce", r["error_message"] or ""):
                        s["no_strips"].append(int(store))
    for code, s in summ.items():
        s["stores"] = sorted(set(s["stores"]))
        s["no_strips"] = sorted(set(s["no_strips"]))
        s["all_d8_no_strips"] = set(s["no_strips"]) >= set(s["stores"]) and bool(s["stores"])
        for k in s["errors"]:
            s["errors"][k] = sorted(set(s["errors"][k]))
        s["pog_texts"] = {k: sorted(set(v)) for k, v in s["pog_texts"].items()}
    return summ


# ----------------------------------------------------------------------------- docx / xlsx

def parse_agenda_docx(path):
    z = zipfile.ZipFile(path)
    x = z.read("word/document.xml").decode("utf8", "replace")
    paras = []
    for p in re.findall(r"<w:p[ >].*?</w:p>", x, flags=re.S):
        t = "".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>", p, flags=re.S))
        t = t.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'")
        if t.strip():
            paras.append(t.strip())
    return {"file": os.path.basename(path), "paragraphs": paras, "media": [n for n in z.namelist() if "media/" in n]}


def parse_remodel_xlsx(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    out = {"file": os.path.basename(path), "d8_rows": []}
    for ws in wb:
        hdr = None
        for row in ws.iter_rows(values_only=True):
            if hdr is None:
                hdr = [str(c) if c is not None else "" for c in row]; continue
            rec = dict(zip(hdr, row))
            loc = str(rec.get("Loc") or "")
            if loc.isdigit() and int(loc) in D8_SET:
                rec = {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in rec.items() if k}
                rec["store"] = int(loc)
                out["d8_rows"].append(rec)
    return out


# ----------------------------------------------------------------------------- walk + main

def find_files(dirs):
    found = defaultdict(list)
    for d in dirs:
        for root, _, files in os.walk(d):
            for f in files:
                p = os.path.join(root, f); low = f.lower()
                if low.endswith(".pdf"):
                    if low.startswith("considerations"): found["considerations"].append(p)
                    elif "kompass notes" in low: found["kompass_notes"].append(p)
                    elif low.startswith("anticipations"): found["anticipations"].append(p)
                    elif low.startswith("test set notes"): found["test_set_notes"].append(p)
                    elif low.startswith("projections"): found["projections"].append(p)
                    elif low.startswith("vestcom"): found["vestcom"].append(p)
                    elif re.search(r"manifest district 8 store 00\d{3}", low): found["manifests_d8"].append(p)
                    else: found["other_pdf"].append(p)
                elif low.endswith(".docx") and "agenda" in low: found["agenda_docx"].append(p)
                elif low.endswith(".xlsx") and "remodel" in low: found["remodel_xlsx"].append(p)
                else: found["other"].append(p)
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dirs", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--out-md")
    a = ap.parse_args()
    files = find_files(a.dirs)
    ex = OrderedDict()
    ex["d8_stores"] = D8_STORES
    ex["files"] = {k: sorted(os.path.basename(p) for p in v) for k, v in files.items()}
    ex["kompass_notes"] = [parse_kompass_notes(p) for p in sorted(files["kompass_notes"])]
    ex["considerations"] = [parse_considerations(p) for p in sorted(files["considerations"])]
    ex["anticipations"] = [parse_anticipations(p) for p in sorted(files["anticipations"])]
    ex["test_set_notes"] = [parse_test_set_notes(p) for p in sorted(files["test_set_notes"])]
    ex["projections"] = [parse_projections(p) for p in sorted(files["projections"])]
    ex["vestcom"] = [parse_vestcom(p) for p in sorted(files["vestcom"])]
    man = OrderedDict()
    for p in sorted(files["manifests_d8"]):
        wk = WEEK_RE.search(os.path.basename(p)); wk = f"P{int(wk.group(1)):02d}W{wk.group(2)}" if wk else "?"
        store, by_code = parse_manifest(p)
        man.setdefault(wk, OrderedDict())[str(store)] = by_code
    ex["manifests_d8"] = OrderedDict()
    for wk, stores in man.items():
        ex["manifests_d8"][wk] = {"stores": stores, "summary": manifest_summary(stores),
                                  "missing_d8_stores": [s for s in D8_STORES if str(s) not in stores]}
    ex["agenda_docx"] = [parse_agenda_docx(p) for p in sorted(files["agenda_docx"])]
    ex["remodel_xlsx"] = [parse_remodel_xlsx(p) for p in sorted(files["remodel_xlsx"])]
    ex["unparsed_files"] = sorted(os.path.basename(p) for p in files["other_pdf"] + files["other"])
    os.makedirs(os.path.dirname(os.path.abspath(a.out)) or ".", exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(ex, f, indent=1, ensure_ascii=False, default=str)
    if a.out_md:
        with open(a.out_md, "w") as f:
            f.write(digest(ex))
    print(f"wrote {a.out}" + (f" and {a.out_md}" if a.out_md else ""))


def digest(ex):
    L = []
    for kn in ex["kompass_notes"]:
        L.append(f"# Kompass Notes ({kn['kind']}) {kn['week']} — {kn['file']}")
        L.append(f"Cover total {kn['cover_total_hours']} h; test-set total {kn['test_set_total_hours']} h; GM {kn['gm_total_no_blitz']} h (no blitz) — GM excluded from D8 deliverables.")
        for r in kn["cover"]:
            L.append(f"- {r['code']} {r['name']} — {r['type']} {r['hours'] if r['hours'] is not None else ''}h [{r['dept']}]" + (f" includes {', '.join(r['includes'])}" if r['includes'] else ""))
        if kn["test_set_cover"]:
            L.append("Test sets (other stores): " + "; ".join(f"{r['code']} {r['name']} {r['hours']}h" for r in kn["test_set_cover"]))
        for s in kn["sections"]:
            L.append(f"\n## {s['code']} {s['name']} — {s['type']} {s['hours']}h" + (" (TEST SET)" if s["is_test_set"] else "") + f"  p{s['page_numbers'][0]}")
            L.append(f"strips: {s['strips_ordered']} · tags: {s['tags_ordered']} · items: {s['items']}")
            if s["special_instructions"]:
                L.append(f"special: {s['special_instructions']}")
            for t in s["talking_points"]:
                L.append(f"  > {t}")
            for g in s["store_tables"]:
                src = "OCR" if g.get("ocr") else "text"
                if g.get("error"):
                    L.append(f"  [store grid p{g['page']} {src}: {g['error']}]"); continue
                note = ""
                if s.get("expected_store_count"):
                    note = f" (text says {s['expected_store_count']}" + ("; MATCH)" if g.get("count_matches_text") else "; MISMATCH — confirm against Projections/Considerations)")
                L.append(f"  [store grid p{g['page']} {src}] {len(g.get('stores', []))} stores{note}; D8: {g['d8']}")
        if kn["pages_with_images"]:
            L.append(f"\npages with images: {kn['pages_with_images']}")
    for c in ex["considerations"]:
        L.append(f"\n# Considerations {c['week']} — {c['file']}")
        for k in ("Status", "Overview", "Priorities", "Callouts", "Looking ahead"):
            if c["sections"].get(k):
                L.append(f"## {k}"); L.extend(f"  {x}" for x in c["sections"][k])
        if c["cross_commodity"]:
            L.append("## Cross-commodity NII"); L.extend(f"  {x['receive']} {x['receive_name']} → report under {x['report_under']} {x['report_under_name']}" for x in c["cross_commodity"])
        L.append("## Category Execution Detail")
        for e in c["category_detail"]:
            L.append(f"- {e['code']} {e['name']} — {e['type']} {e['hours']}h" + (" ❄" if e["cold"] else "") + (f" TEST SET exec {e['execution']}" if e.get("is_test_set") else ""))
            for t in e["text"]:
                L.append(f"    {t}")
            for b in e["store_bullets"]:
                L.append(f"    • stores {b['stores']} → D8 {b['d8']}: {b['text']}")
        if c["calldowns"]:
            L.append("## Calldowns"); L.extend(f"  {x['window']}: {x['store']} {x['store_name']} ({x['district']}) {x['dates']} {x['project']}" + (" ← D8" if x["d8"] else "") for x in c["calldowns"])
        if c["anticipations_table"]:
            L.append(f"## Anticipations table (next week) total {c.get('anticipations_total_hours')}h")
            L.extend(f"  {x['code']} {x['name']} — {x['type']} {x['hours']}h" + (f" (records under {x['records_under']})" if x['records_under'] else "") for x in c["anticipations_table"])
    for t in ex["test_set_notes"]:
        L.append(f"\n# Test Set Notes — {t['file']}")
        for s in t["sets"]:
            L.append(f"- {s['code']} {s['name']}: {s['hours']}h, set {s['set_size']}, shelf adj {s['shelf_adjustments']}, flow {s['flow_changes']}. {s['notes']}")
        if t["email"]:
            L.append("  email: " + " | ".join(t["email"][:60]))
    for p in ex["projections"]:
        L.append(f"\n# Projections — {p['file']}")
        for s in p["sections"]:
            L.append(f"- {s['code']} {s['name']} {s['week']} {s['hours']}h; stores listed: {len(s['stores'])}; D8: {s['d8']}")
            for t in s["talking_points"][:12]:
                L.append(f"    > {t}")
    for an in ex["anticipations"]:
        L.append(f"\n# Anticipations {an['week']} — {an['file']}")
        for s in an["sets"]:
            L.append(f"- {s['code']} {s['name']} — {s['type']} {s['hours']}h" + (" ❄" if s["cold"] else "") + f": {s['specific']}")
    for v in ex["vestcom"]:
        L.append(f"\n# Vestcom — {v['file']}")
        for st, r in v["d8"].items():
            L.append(f"- {st}: {r['status']}")
        miss = [s for s in D8_STORES if str(s) not in v["d8"]]
        if miss:
            L.append(f"  D8 stores missing from tracking: {miss}")
    for wk, m in ex["manifests_d8"].items():
        L.append(f"\n# Strip manifests D8 {wk} (stores present: {len(m['stores'])}; missing: {m['missing_d8_stores']})")
        for code, s in m["summary"].items():
            line = f"- {code}: at {s['stores']}"
            if s["no_strips"]:
                line += f"; NO STRIPS at {s['no_strips']}" + (" (all D8)" if s["all_d8_no_strips"] else "")
            L.append(line)
            for msg, stores in s["errors"].items():
                L.append(f"    error @{stores}: {msg}")
    for a in ex["agenda_docx"]:
        L.append(f"\n# Agenda docx — {a['file']} ({len(a['paragraphs'])} paragraphs; see JSON)")
    for r in ex["remodel_xlsx"]:
        L.append(f"\n# Remodel xlsx — {r['file']}: {len(r['d8_rows'])} D8 rows (stores {sorted({x['store'] for x in r['d8_rows']})})")
    if ex["unparsed_files"]:
        L.append(f"\n# Not parsed: {ex['unparsed_files']}")
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    main()
