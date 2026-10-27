#!/usr/bin/env python3
"""eod-api client for the Weekly Briefing author run.

Env: EOD_API_BASE (e.g. https://eod-api.the-dump-bin.com), WEEKLY_BRIEFING_AUTHOR_TOKEN.
Routes (Part C, all under /api/weekly-briefing/worker/, Authorization: Bearer <author token>):
  GET  sources?week=P10W4            -> {prefix, files:[{key,size,modified}]}
  GET  source-file?key=...           -> object bytes
  POST text {message}                -> sends "[briefing] ..." to T
  POST thread {week, action}         -> open|close the reply-capture thread
  GET  replies?week=&since=<iso>     -> [{id, body, received_at}]
  POST source {week, request, mode, files:{name: base64}} -> {sha}

Usage:
  eodapi.py sources   --week P10W4 --out ./src_P10W4
  eodapi.py text      "message text"            (or --file msg.txt)
  eodapi.py thread    --week P10W4 open|close
  eodapi.py replies   --week P10W4 --since 2026-10-29T22:00:00Z
  eodapi.py wait      --week P10W4 --since <iso> [--timeout 2700] [--every 60]
  eodapi.py post      --week P10W4 --request 20261029-1 --mode staging --dir ./build
"""
import argparse, base64, json, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

BASE = os.environ.get("EOD_API_BASE", "").rstrip("/")
TOKEN = os.environ.get("WEEKLY_BRIEFING_AUTHOR_TOKEN", "")
PREFIX = "/api/weekly-briefing/worker/"
POST_FILES = ["deck.pdf", "narration.txt", "meta.json", "questions.json", "briefing.json"]


def _req(method, path, body=None, raw=False, params=None):
    if not BASE or not TOKEN:
        sys.exit("EOD_API_BASE and WEEKLY_BRIEFING_AUTHOR_TOKEN must be set")
    url = BASE + PREFIX + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = None
    headers = {"Authorization": f"Bearer {TOKEN}"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            b = resp.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path} -> HTTP {e.code}: {e.read()[:300]!r}")
    return b if raw else json.loads(b or b"{}")


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def cmd_sources(a):
    lst = _req("GET", "sources", params={"week": a.week})
    prefix = lst["prefix"]
    files = lst["files"]
    os.makedirs(a.out, exist_ok=True)
    for f in files:
        key = f["key"]
        rel = key[len(prefix):].lstrip("/") if key.startswith(prefix) else os.path.basename(key)
        dest = os.path.join(a.out, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        open(dest, "wb").write(_req("GET", "source-file", raw=True, params={"key": key}))
        print(f"  {rel} ({f.get('size', '?')} B)")
    print(f"{len(files)} files from {prefix} -> {a.out}")
    json.dump(lst, open(os.path.join(a.out, "_listing.json"), "w"), indent=1)


def cmd_text(a):
    msg = open(a.file).read() if a.file else a.message
    if not msg:
        sys.exit("no message")
    print(_req("POST", "text", {"message": msg}))


def cmd_thread(a):
    print(_req("POST", "thread", {"week": a.week, "action": a.action}))


def cmd_replies(a):
    print(json.dumps(_req("GET", "replies", params={"week": a.week, "since": a.since}), indent=1))


def cmd_wait(a):
    deadline = time.time() + a.timeout
    since = a.since or now_iso()
    while time.time() < deadline:
        r = _req("GET", "replies", params={"week": a.week, "since": since})
        if isinstance(r, dict):
            r = r.get("replies", [])
        if r:
            print(json.dumps(r, indent=1))
            return
        time.sleep(a.every)
    print("[]")
    sys.exit(3)


def cmd_post(a):
    files = {}
    for name in POST_FILES:
        p = os.path.join(a.dir, name)
        if not os.path.exists(p):
            sys.exit(f"missing {p}")
        files[name] = base64.b64encode(open(p, "rb").read()).decode()
    body = {"week": a.week, "request": a.request, "mode": a.mode, "files": files}
    print(_req("POST", "source", body))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sources"); s.add_argument("--week", required=True); s.add_argument("--out", required=True); s.set_defaults(f=cmd_sources)
    s = sub.add_parser("text"); s.add_argument("message", nargs="?"); s.add_argument("--file"); s.set_defaults(f=cmd_text)
    s = sub.add_parser("thread"); s.add_argument("--week", required=True); s.add_argument("action", choices=["open", "close"]); s.set_defaults(f=cmd_thread)
    s = sub.add_parser("replies"); s.add_argument("--week", required=True); s.add_argument("--since", required=True); s.set_defaults(f=cmd_replies)
    s = sub.add_parser("wait"); s.add_argument("--week", required=True); s.add_argument("--since"); s.add_argument("--timeout", type=int, default=2700); s.add_argument("--every", type=int, default=60); s.set_defaults(f=cmd_wait)
    s = sub.add_parser("post"); s.add_argument("--week", required=True); s.add_argument("--request", required=True); s.add_argument("--mode", choices=["staging", "live"], default="staging"); s.add_argument("--dir", required=True); s.set_defaults(f=cmd_post)
    a = ap.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
