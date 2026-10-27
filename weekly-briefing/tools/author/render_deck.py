#!/usr/bin/env python3
"""render_deck.py — briefing.json → deck.pdf (1080×1920 frames), narration.txt, _stops.json.

    python3 -I render_deck.py briefing.json --out <dir> [--keep-frames]

Reads the typed briefing (schema in README.md), renders one HTML frame per entry in `frames`
with Playwright/Chromium (device_scale_factor 2), zooms each frame's body to fill the canvas,
checks overflow at document / .wrap / .frame level, writes <out>/deck.pdf through img2pdf at
152.4 × 270.9 mm (9:16), <out>/narration.txt (one paragraph per frame, blank line between),
<out>/_stops.json (one stop title per frame) and <out>/deck.html (all frames, for the record).

Hard checks (exit 2 on failure):
  * every frame has a non-empty narration paragraph and stop_title
  * "Kompass" never appears in narration; "Compass" never appears on a frame
  * no "slide" and no banned construction in frame text or narration
  * hours / set / cold-set counts on the title and glance frames are computed from `sets`
"""
import argparse, html, json, os, re, sys

NAVY, TEAL, ORANGE, RED = "#1B2A4A", "#0891B2", "#F59E0B", "#DC2626"
LIGHT, YEL, LBLUE = "#F0F4F8", "#FEF3C7", "#ECFEFF"
COLORS = {"teal": TEAL, "red": RED, "orange": ORANGE, "navy": NAVY}

BANNED = re.compile(r"\b(because|so that|so expect|in order to|as a result of|with the intent of|which means|"
                    r"this is important because|the reason is|that way|warriors?|enjoying|well-deserved|slide)\b", re.I)

CSS = f"""
*{{box-sizing:border-box;margin:0;padding:0}}
html,body{{width:1080px;height:1920px;overflow:hidden;background:{LIGHT};font-family:'Carlito','Calibri',sans-serif;color:{NAVY}}}
.frame{{position:relative;width:1080px;height:1920px;display:flex;flex-direction:column}}
.bar{{height:12px;background:{TEAL};flex:none}}
.head{{background:{NAVY};color:#fff;padding:54px 64px 46px;flex:none}}
.kicker{{font-size:30px;letter-spacing:5px;text-transform:uppercase;color:{ORANGE};font-weight:700}}
.title{{font-size:78px;font-weight:700;line-height:1.05;margin-top:12px}}
.wrap{{flex:1;padding:44px 64px 20px;display:flex;flex-direction:column;gap:26px;overflow:hidden}}
.foot{{flex:none;display:flex;justify-content:space-between;padding:0 64px 34px;font-size:26px;color:#5b6b86}}
.card{{flex:none;background:#fff;border-radius:18px;box-shadow:0 5px 16px rgba(27,42,74,.14);overflow:hidden}}
.ch{{gap:16px;background:{TEAL};color:#fff;padding:16px 30px;font-size:38px;font-weight:700;display:flex;justify-content:space-between;align-items:center}}
.ch.red{{background:{RED}}} .ch.navy{{background:{NAVY}}} .ch.org{{background:{ORANGE};color:{NAVY}}}
.hrs{{white-space:nowrap;font-size:34px;background:rgba(255,255,255,.22);padding:2px 18px;border-radius:30px}}
.cb{{padding:22px 30px 26px;font-size:40px;line-height:1.28}}
.cb p+p,.cb ul+p,.cb p+ul{{margin-top:12px}}
.cb ul{{list-style:none}} .cb li{{padding-left:34px;position:relative;margin-top:9px}}
.cb li:before{{content:'';position:absolute;left:4px;top:19px;width:14px;height:14px;border-radius:50%;background:{TEAL}}}
.act{{flex:none;background:{YEL};color:{RED};font-weight:700;border-left:12px solid {RED};padding:18px 26px;font-size:40px;line-height:1.25;border-radius:8px}}
.cb .act{{margin-top:14px}}
.info{{flex:none;background:{LBLUE};color:{NAVY};border-left:12px solid {TEAL};padding:18px 26px;font-size:38px;line-height:1.25;border-radius:8px}}
.info.big{{font-size:52px;font-weight:700;text-align:center;padding:40px}}
.chip{{display:inline-block;color:#fff;font-weight:700;font-size:40px;padding:2px 20px;border-radius:12px;margin:6px 10px 2px 0}}
.snow{{font-size:34px}}
table{{width:100%;border-collapse:collapse;font-size:35px}}
th{{background:{NAVY};color:#fff;text-align:left;padding:12px 18px;font-size:30px;letter-spacing:2px;text-transform:uppercase}}
th.n{{text-align:right}}
td{{padding:11px 18px;border-bottom:2px solid #e3e9f1}}
tr.dept td{{background:{TEAL};color:#fff;font-weight:700;font-size:29px;letter-spacing:3px;text-transform:uppercase;padding:7px 18px}}
td.n{{text-align:right;font-weight:700}} td.t{{color:#5b6b86}}
.bigno{{font-size:300px;font-weight:700;line-height:1;color:{ORANGE}}}
.titlefr{{background:{NAVY};color:#fff}}
.tiles{{margin-top:80px;display:flex;gap:30px}}
.tile{{padding:34px 44px;border-radius:18px}} .tile .v{{font-size:120px;font-weight:700;line-height:1}} .tile .l{{font-size:36px;letter-spacing:3px;text-transform:uppercase}}
"""


def esc(s):
    return html.escape(str(s), quote=False)


def chips(stores, color="teal"):
    c = COLORS.get(color, color)
    return "".join(f'<span class="chip" style="background:{c}">{esc(n)}</span>' for n in stores)


def render_block(b, ctx):
    k = b["kind"]
    if k == "card":
        right = ""
        if b.get("cold"):
            right += '<span class="snow">❄ cold</span> '
        hrs = b.get("hrs")
        if hrs is not None:
            if isinstance(hrs, str) and hrs.startswith("@"):
                hrs = ctx["hours_of"](hrs[1:])
            right += f'<span class="hrs">{fmt_hours(hrs)}</span>'
        # content keys render in the order they appear in the JSON object
        body = ""
        for key, val in b.items():
            if key == "paragraphs":
                body += "".join(f"<p>{p}</p>" for p in val)
            elif key == "bullets":
                body += "<ul>" + "".join(f"<li>{x}</li>" for x in val) + "</ul>"
            elif key == "chips":
                body += f'<p>{val.get("label", "")}' + ("<br>" if val.get("label") else "") + chips(val["stores"], val.get("color", "teal")) + "</p>"
            elif key == "act":
                body += f'<div class="act">{val}</div>'
            elif key == "html":
                body += val
        return f'<div class="card"><div class="ch {b.get("cls", "")}"><span>{b["head"]}</span><span>{right}</span></div><div class="cb">{body}</div></div>'
    if k == "act":
        return f'<div class="act">{b["text"]}</div>'
    if k == "info":
        return f'<div class="info{" big" if b.get("big") else ""}">{b["html"]}</div>'
    if k == "table":
        cols = b["columns"]
        head = "".join(f'<th class="{"n" if c.get("num") else ""}">{c["label"]}</th>' for c in cols)
        rows = ""
        for r in b["rows"]:
            if isinstance(r, dict) and r.get("dept"):
                rows += f'<tr class="dept"><td colspan="{len(cols)}">{r["dept"]}</td></tr>'
                continue
            cells = r["cells"] if isinstance(r, dict) else r
            rows += "<tr>" + "".join(
                f'<td class="{"n" if c.get("num") else ("t" if c.get("muted") else "")}">{v}</td>' for c, v in zip(cols, cells)) + "</tr>"
        return f'<div class="card"><table><tr>{head}</tr>{rows}</table></div>'
    if k == "sets_table":
        # computed from ctx["sets"]: COM# / Set / Hrs / Type grouped by dept
        rows, last = "", None
        for s in ctx["sets"]:
            if s["dept"] != last:
                rows += f'<tr class="dept"><td colspan="4">{esc(s["dept"])}</td></tr>'; last = s["dept"]
            rows += f'<tr><td>{esc(s["code"])}</td><td>{esc(s["name"])}{" ❄" if s.get("cold") else ""}</td><td class="n">{fmt_num(s["hours"])}</td><td class="t">{esc(s["type"])}</td></tr>'
        return f'<div class="card"><table><tr><th>COM#</th><th>Set</th><th class="n">Hrs</th><th>Type</th></tr>{rows}</table></div>'
    if k == "counts_info":
        c = ctx["counts"]
        return f'<div class="info"><b>{fmt_num(c["hours"])} hours</b> · {c["sets"]} sets · ❄ = cold set, product out no longer than 20 minutes ({c["cold"]} sets)</div>'
    if k == "keyfacts":
        items = "".join(f"<li>{x}</li>" for x in b["items"])
        return f'<div class="card"><div class="ch navy"><span>{b.get("head", "Key Facts")}</span></div><div class="cb"><ul>{items}</ul></div></div>'
    raise ValueError(f"unknown block kind {k}")


def fmt_num(h):
    return str(int(h)) if float(h).is_integer() else str(h)


def fmt_hours(h):
    if isinstance(h, str):
        return h
    return f"{fmt_num(h)} hr{'s' if float(h) != 1 else ''}"


def page(kicker, title, body, rev):
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>
<div class="frame"><div class="bar"></div>
<div class="head"><div class="kicker">{kicker}</div><div class="title">{title}</div></div>
<div class="wrap">{body}</div>
<div class="foot"><span>Retail Odyssey</span><span>{rev}</span></div></div></body></html>"""


def title_page(fr, ctx, rev):
    c = ctx["counts"]
    tiles = f"""<div class="tiles">
<div class="tile" style="background:{TEAL}"><div class="v">{fmt_num(c['hours'])}</div><div class="l">Hours</div></div>
<div class="tile" style="background:{ORANGE};color:{NAVY}"><div class="v">{c['sets']}</div><div class="l">Sets</div></div>
<div class="tile" style="background:{RED}"><div class="v">{c['cold']}</div><div class="l">Cold sets</div></div></div>"""
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body><div class="frame titlefr"><div class="bar"></div>
<div style="padding:150px 80px;display:flex;flex-direction:column;gap:30px;flex:1">
<div class="kicker">{fr.get('kicker', 'Weekly Kompass Briefing')}</div>
<div class="bigno">{esc(ctx['week'])}</div>
<div style="font-size:84px;font-weight:700">{esc(ctx['title'])}</div>
<div style="font-size:70px;color:{TEAL};font-weight:700">District 8</div>
{tiles}</div>
<div class="foot" style="color:#9fb0cc"><span>Retail Odyssey</span><span>{rev}</span></div></div></body></html>"""


def text_of(h):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<style.*?</style>|<[^>]+>", " ", h, flags=re.S))).strip()


def build(bj):
    sets = bj["sets"]
    counts = {"hours": sum(float(s["hours"]) for s in sets), "sets": len(sets), "cold": sum(1 for s in sets if s.get("cold"))}
    ctx = {"sets": sets, "counts": counts, "week": bj["week"], "title": bj["title"],
           "hours_of": lambda code: next(float(s["hours"]) for s in sets if s["code"] == code)}
    rev = bj.get("rev") or bj["week"]
    frames = []
    for fr in bj["frames"]:
        if fr.get("kind") == "title":
            h = title_page(fr, ctx, rev)
        else:
            body = "".join(render_block(b, ctx) for b in fr["blocks"])
            h = page(fr["kicker"], fr["title"], body, rev)
        frames.append(h)
    return frames, ctx


def validate(bj, frames):
    errs = []
    narr = [fr.get("narration", "").strip() for fr in bj["frames"]]
    stops = [fr.get("stop_title", "").strip() for fr in bj["frames"]]
    if not all(narr):
        errs.append("every frame needs a narration paragraph")
    if not all(stops):
        errs.append("every frame needs a stop_title")
    for i, (n, h) in enumerate(zip(narr, frames), 1):
        if "Kompass" in n:
            errs.append(f"frame {i}: narration says Kompass (must be Compass)")
        if "\n" in n:
            errs.append(f"frame {i}: narration paragraph contains a line break")
        t = text_of(h)
        if re.search(r"\bCompass\b", t):
            errs.append(f"frame {i}: frame text says Compass (must be Kompass)")
        for m in BANNED.finditer(t):
            errs.append(f"frame {i}: banned word on frame: {m.group(0)!r}")
        for m in BANNED.finditer(n):
            errs.append(f"frame {i}: banned word in narration: {m.group(0)!r}")
        if re.search(r"\b(Team|Tyson|hotline|helpdesk|QFC|701)\b", n):
            errs.append(f"frame {i}: narration hits a no-go word (Team/Tyson/hotline/QFC/701)")
    for s in bj["sets"]:
        for k in ("code", "name", "dept", "hours", "type"):
            if k not in s:
                errs.append(f"set {s} missing {k}")
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("briefing")
    ap.add_argument("--out", required=True)
    ap.add_argument("--keep-frames", action="store_true")
    a = ap.parse_args()
    bj = json.load(open(a.briefing))
    frames, ctx = build(bj)
    errs = validate(bj, frames)
    if errs:
        print("\n".join("ERROR " + e for e in errs)); sys.exit(2)
    os.makedirs(os.path.join(a.out, "frames"), exist_ok=True)
    from playwright.sync_api import sync_playwright
    import img2pdf
    pngs, overflow = [], []
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1080, "height": 1920}, device_scale_factor=2)
        for i, h in enumerate(frames, 1):
            fp = os.path.join(a.out, "frames", f"f{i:02d}.html")
            open(fp, "w").write(h)
            pg.goto("file://" + os.path.abspath(fp)); pg.wait_for_timeout(200)
            ov = pg.evaluate("""()=>{const w=document.querySelector('.wrap');
              return {doc:document.documentElement.scrollHeight, wrap: w? w.scrollHeight-w.clientHeight : 0,
                      fr:document.querySelector('.frame').scrollHeight}}""")
            if ov["wrap"] > 0 or ov["doc"] > 1920 or ov["fr"] > 1920:
                overflow.append((i, ov))
            pg.evaluate("""()=>{const w=document.querySelector('.wrap'); if(!w) return;
              const foot=document.querySelector('.foot').getBoundingClientRect().top-34;
              let best=1; for(let z=1.0; z<=1.5; z+=0.02){ w.style.zoom=z; const b=w.lastElementChild.getBoundingClientRect().bottom;
                if(b<=foot) best=z; else break;} w.style.zoom=best;}""")
            png = os.path.join(a.out, "frames", f"f{i:02d}.png")
            pg.screenshot(path=png); pngs.append(png)
        br.close()
    if overflow:
        print("\n".join(f"ERROR frame {i} overflows: {ov}" for i, ov in overflow)); sys.exit(2)
    layout = img2pdf.get_layout_fun((img2pdf.mm_to_pt(152.4), img2pdf.mm_to_pt(270.9)))
    open(os.path.join(a.out, "deck.pdf"), "wb").write(img2pdf.convert(pngs, layout_fun=layout))
    open(os.path.join(a.out, "narration.txt"), "w").write("\n\n".join(fr["narration"].strip() for fr in bj["frames"]) + "\n")
    json.dump([fr["stop_title"] for fr in bj["frames"]], open(os.path.join(a.out, "_stops.json"), "w"), indent=1)
    open(os.path.join(a.out, "deck.html"), "w").write("\n<!-- FRAME -->\n".join(frames))
    import pymupdf
    n = len(pymupdf.open(os.path.join(a.out, "deck.pdf")))
    assert n == len(frames) == len(bj["frames"])
    if not a.keep_frames:
        for f in os.listdir(os.path.join(a.out, "frames")):
            if f.endswith(".html"):
                os.remove(os.path.join(a.out, "frames", f))
    c = ctx["counts"]
    print(f"deck.pdf {n} frames · {fmt_num(c['hours'])} h · {c['sets']} sets · {c['cold']} cold · narration {sum(len(fr['narration'].split()) for fr in bj['frames'])} words")


if __name__ == "__main__":
    main()
