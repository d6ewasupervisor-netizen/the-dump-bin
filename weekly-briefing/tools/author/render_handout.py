#!/usr/bin/env python3
"""render_handout.py — briefing.json → two-page Letter handout PDF.

    python3 -I render_handout.py briefing.json --out <dir>   → <dir>/P##W#_Handout_District8.pdf

Page 1: computed counts bar + the sets table (COM#, set, hours, type, execution text from
`handout.execution[code]`). Page 2: the `handout.page2` sections (act / columns / bullets / table).
Exit 2 if the PDF is not exactly two pages, if "Compass" appears, or if a banned construction appears.
"""
import argparse, html, json, os, re, sys

BANNED = re.compile(r"\b(because|so that|so expect|in order to|as a result of|with the intent of|which means|"
                    r"this is important because|the reason is|that way|warriors?|enjoying|well-deserved)\b", re.I)

CSS = """
@page{size:Letter;margin:0.4in}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Carlito','Calibri',sans-serif;color:#1B2A4A;font-size:10.5pt;line-height:1.28}
.hd{background:#1B2A4A;color:#fff;padding:10pt 14pt;display:flex;justify-content:space-between;align-items:baseline}
.hd b{font-size:20pt}.hd span{font-size:11pt;color:#F59E0B;letter-spacing:2px;text-transform:uppercase}
.bar{background:#F59E0B;color:#1B2A4A;font-weight:700;padding:5pt 14pt;font-size:11pt;margin-bottom:8pt}
h2{font-size:10.5pt;text-transform:uppercase;letter-spacing:1.5px;border-left:5pt solid #0891B2;padding-left:7pt;margin:9pt 0 4pt}
h2.r{border-color:#DC2626}h2.y{border-color:#F59E0B}
table{width:100%;border-collapse:collapse}
th{background:#1B2A4A;color:#fff;text-align:left;padding:3pt 5pt;font-size:9pt;text-transform:uppercase}
td{padding:3pt 5pt;border-bottom:.6pt solid #d5deea;vertical-align:top;font-size:9.6pt}
td.n{text-align:center;font-weight:700}
.act{background:#FEF3C7;border-left:5pt solid #DC2626;padding:5pt 8pt;margin:4pt 0;font-weight:700;color:#B91C1C}
.cols{display:flex;gap:12pt}.cols>div{flex:1}
ul{margin-left:14pt}li{margin:1.5pt 0}
.pg{page-break-after:always}
.ft{position:fixed;bottom:0;left:0;right:0;font-size:8.5pt;color:#5b6b86;display:flex;justify-content:space-between}
"""


def fmt(h):
    return str(int(h)) if float(h).is_integer() else str(h)


def build(bj):
    sets = bj["sets"]
    ho = bj.get("handout", {})
    exe = ho.get("execution", {})
    total = sum(float(s["hours"]) for s in sets)
    ncold = sum(1 for s in sets if s.get("cold"))
    rev = bj.get("rev") or bj["week"]
    rows = "".join(
        f"<tr><td>{s['code']}</td><td><b>{html.escape(s['name'])}{' ❄' if s.get('cold') else ''}</b></td><td class='n'>{fmt(s['hours'])}</td><td>{s['type']}</td><td>{exe.get(s['code'], '')}</td></tr>"
        for s in sets)
    p2 = ""
    for sec in ho.get("page2", []):
        p2 += f"<h2 class='{sec.get('cls', '')}'>{sec['head']}</h2>"
        if sec.get("act"):
            p2 += f"<div class='act'>{sec['act']}</div>"
        if sec.get("cols"):
            p2 += "<div class='cols'>" + "".join(
                f"<div><b>{c['title']}</b><ul>" + "".join(f"<li>{x}</li>" for x in c["items"]) + "</ul></div>" for c in sec["cols"]) + "</div>"
        if sec.get("after"):
            p2 += f"<p style='margin-top:3pt'>{sec['after']}</p>"
        if sec.get("table"):
            cols = sec.get("table_columns", [])
            p2 += "<table><tr>" + "".join(f"<th>{c}</th>" for c in cols) + "</tr>" + "".join(
                "<tr>" + "".join(f"<td class='{'n' if j and re.fullmatch(r'[\d.]+', str(v)) else ''}'>{v}</td>" for j, v in enumerate(r)) + "</tr>" for r in sec["table"]) + "</table>"
        if sec.get("bullets"):
            p2 += "<ul style='margin-top:4pt'>" + "".join(f"<li>{x}</li>" for x in sec["bullets"]) + "</ul>"
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>
<div class="ft"><span>Retail Odyssey</span><span>{rev}</span></div>
<div class="pg">
<div class="hd"><b>{bj['week']} Handout</b><span>{bj['title']} · District 8</span></div>
<div class="bar">{fmt(total)} hours · {len(sets)} sets · {ncold} cold sets (❄): product out no longer than 20 minutes</div>
<h2>Sets</h2>
<table><tr><th>COM#</th><th>Set</th><th>Hrs</th><th>Type</th><th>Execution</th></tr>{rows}</table>
</div>
<div>
<div class="hd"><b>{bj['week']} Handout</b><span>Page 2</span></div>
{p2}
</div></body></html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("briefing")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    bj = json.load(open(a.briefing))
    H = build(bj)
    txt = html.unescape(re.sub(r"<style.*?</style>|<[^>]+>", " ", H, flags=re.S))
    errs = []
    if re.search(r"\bCompass\b", txt):
        errs.append("handout says Compass (must be Kompass)")
    for m in BANNED.finditer(txt):
        errs.append(f"banned word on handout: {m.group(0)!r}")
    if errs:
        print("\n".join("ERROR " + e for e in errs)); sys.exit(2)
    os.makedirs(a.out, exist_ok=True)
    hp = os.path.join(a.out, "handout.html")
    open(hp, "w").write(H)
    pdf = os.path.join(a.out, f"{bj['week']}_Handout_District8.pdf")
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page()
        pg.goto("file://" + os.path.abspath(hp)); pg.wait_for_timeout(200)
        pg.pdf(path=pdf, format="Letter", print_background=True, margin={"top": "0.4in", "bottom": "0.5in", "left": "0.4in", "right": "0.4in"})
        b.close()
    import pymupdf
    n = len(pymupdf.open(pdf))
    if n != 2:
        print(f"ERROR handout is {n} pages, must be 2"); sys.exit(2)
    print(f"{pdf} · 2 pages")


if __name__ == "__main__":
    main()
