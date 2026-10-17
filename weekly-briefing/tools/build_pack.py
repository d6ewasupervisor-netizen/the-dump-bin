#!/usr/bin/env python3
"""
Weekly Briefing — content pack builder.

Turns one week's briefing outputs into a Store Walk content pack:

    packs/<WEEK>/pack.json
    packs/<WEEK>/frames/f01.webp ... (810x1440, one per deck page)
    packs/<WEEK>/audio/a01.m4a  ... (narration sliced per page, AAC mono)

Inputs (same files the Briefing Builder already uses, plus two small JSON files):

    --pdf        P##W#_Briefing_Deck_District8.pdf   (one page per frame)
    --mp3        ElevenLabs_P##W#_Weekly_Team_Meeting.mp3
    --timing     output/P##W#_timing.txt            (from the Briefing Builder)
    --narration  P##W#_Narration_District8.txt      (one paragraph per frame)
    --meta       source/P##W#/meta.json             (week, title, dueAt, stop titles, sections)
    --questions  source/P##W#/questions.json        (list of {id, stop, type, q, options, correct, explain})
    --out        weekly-briefing/packs              (pack root; <WEEK>/ is created inside)

Run from the briefing_builder venv (needs pymupdf + imageio-ffmpeg) or any Python
with PyMuPDF and an ffmpeg on PATH:

    python build_pack.py --pdf ... --mp3 ... --timing ... --narration ... \
        --meta source/P10W1/meta.json --questions source/P10W1/questions.json --out packs

Hard checks (the build stops on any of these):
    * PDF page count == narration paragraph count == timing row count == len(meta.stops)
    * every question's `stop` is a valid frame number and `correct` indexes its options
    * no banned constructions in question or explanation text
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

FRAME_W, FRAME_H = 810, 1440
WEBP_QUALITY = 80
AUDIO_BITRATE = "56k"
AUDIO_RATE = "32000"

BANNED = [
    r"\bbecause\b", r"\bso that\b", r"\bso expect\b", r"\bin order to\b", r"\bas a result of\b",
    r"\bwith the intent of\b", r"\bwhich means\b", r"\bthis is important because\b",
    r"\bthe reason is\b", r"\bthat way\b", r"\bwarriors?\b", r"\benjoying\b", r"\bwell-deserved\b",
]


def _pymupdf():
    try:
        import pymupdf  # noqa: WPS433

        return pymupdf
    except ImportError:
        import fitz  # older PyMuPDF

        return fitz


def die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def find_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg  # type: ignore

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        die("ffmpeg not found on PATH and imageio-ffmpeg is not installed")
    return ""


def parse_timing(path: Path) -> list[float]:
    """Timing report from the Briefing Builder: header lines, then `slide<TAB>m:ss<TAB>cue`."""
    starts: list[float] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split("\t")
        if len(parts) < 2 or not parts[0].strip().isdigit():
            continue
        m, s = parts[1].strip().split(":")
        starts.append(int(m) * 60 + float(s))
    if not starts:
        die(f"no timing rows found in {path}")
    return starts


def parse_narration(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8").strip()
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    return paras


def audio_duration(ffmpeg: str, mp3: Path) -> float:
    ffprobe = str(Path(ffmpeg).with_name(Path(ffmpeg).name.replace("ffmpeg", "ffprobe")))
    if shutil.which(ffprobe) or Path(ffprobe).exists():
        out = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(mp3)],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        return float(out)
    # Fall back: parse ffmpeg's own stderr.
    res = subprocess.run([ffmpeg, "-i", str(mp3)], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", res.stderr)
    if not m:
        die("could not read audio duration")
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def page_text(page) -> str:
    """Text layer if the PDF has one; otherwise OCR (deck PDFs are screenshots, so they usually don't)."""
    text = page.get_text() or ""
    if text.strip():
        return text
    try:
        tp = page.get_textpage_ocr(flags=0, language="eng", dpi=120, full=True)
        return page.get_text(textpage=tp) or ""
    except Exception as exc:  # noqa: BLE001 — tesseract missing or OCR unsupported
        if not getattr(page_text, "_warned", False):
            print(f"WARNING: deck PDF has no text layer and OCR is unavailable ({exc}); "
                  '"Compass" scan of the frames skipped', file=sys.stderr)
            page_text._warned = True  # type: ignore[attr-defined]
        return ""


def render_frames(pdf: Path, out_dir: Path, ffmpeg: str) -> list[str]:
    fitz = _pymupdf()
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(str(pdf))
    names: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, page in enumerate(doc, 1):
            zoom = FRAME_W / page.rect.width
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            png = Path(tmp) / f"f{i:02d}.png"
            pix.save(str(png))
            webp = out_dir / f"f{i:02d}.webp"
            subprocess.run(
                [ffmpeg, "-v", "error", "-y", "-i", str(png),
                 "-vf", f"scale={FRAME_W}:{FRAME_H}:flags=lanczos",
                 "-c:v", "libwebp", "-quality", str(WEBP_QUALITY), "-compression_level", "6", str(webp)],
                check=True,
            )
            names.append(webp.name)
    return names


def slice_audio(mp3: Path, starts: list[float], total: float, out_dir: Path, ffmpeg: str) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    clips = []
    for i, st in enumerate(starts):
        en = starts[i + 1] if i + 1 < len(starts) else total
        name = f"a{i + 1:02d}.m4a"
        subprocess.run(
            [ffmpeg, "-v", "error", "-y", "-ss", f"{st:.3f}", "-to", f"{en:.3f}", "-i", str(mp3),
             "-ac", "1", "-ar", AUDIO_RATE, "-c:a", "aac", "-b:a", AUDIO_BITRATE, "-movflags", "+faststart",
             str(out_dir / name)],
            check=True,
        )
        clips.append({"file": name, "seconds": round(en - st, 2)})
    return clips


def check_timing(starts: list[float], total: float, paras: list[str]) -> None:
    """Catch a timing report that was cut against a different recording (e.g. a stale SRT).

    Each clip's length should track its paragraph's share of the words; a clip that is
    far off (>40% and >8s) means the cues don't belong to this audio.
    """
    if starts[0] > 1.0:
        die(f"timing: first cue starts at {starts[0]:.1f}s, expected ~0")
    for a, b in zip(starts, starts[1:]):
        if b <= a:
            die(f"timing: cues are not increasing ({a:.1f}s then {b:.1f}s)")
    if starts[-1] >= total - 1.0:
        die(f"timing: last cue {starts[-1]:.1f}s is at/after the end of the audio ({total:.1f}s)")
    if len(starts) != len(paras):
        return  # count mismatch is reported by the caller
    words = [max(len(p.split()), 1) for p in paras]
    total_words = sum(words)
    bad = []
    for i, st in enumerate(starts):
        en = starts[i + 1] if i + 1 < len(starts) else total
        actual = en - st
        expected = total * words[i] / total_words
        if abs(actual - expected) > max(8.0, 0.4 * expected):
            bad.append(f"frame {i + 1}: clip {actual:.0f}s vs ~{expected:.0f}s expected from its word count")
    if bad:
        for b in bad:
            print("  - " + b, file=sys.stderr)
        die("timing does not fit this audio — the timing report was probably made from an SRT "
            "for a different recording; rebuild it from this recording's SRT")


def list_clips(clips_dir: Path) -> list[Path]:
    files = sorted(p for p in clips_dir.iterdir() if p.is_file() and re.fullmatch(r"a\d{2}\.\w+", p.name))
    if not files:
        die(f"no clips named a01.* .. aNN.* in {clips_dir}")
    for i, f in enumerate(files, 1):
        if f.name[1:3] != f"{i:02d}":
            die(f"clips are not contiguous: expected a{i:02d}.*, found {f.name}")
    return files


def transcode_clips(files: list[Path], out_dir: Path, ffmpeg: str) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    clips = []
    for i, src in enumerate(files, 1):
        name = f"a{i:02d}.m4a"
        subprocess.run(
            [ffmpeg, "-v", "error", "-y", "-i", str(src),
             "-ac", "1", "-ar", AUDIO_RATE, "-c:a", "aac", "-b:a", AUDIO_BITRATE, "-movflags", "+faststart",
             str(out_dir / name)],
            check=True,
        )
        clips.append({"file": name, "seconds": round(audio_duration(ffmpeg, out_dir / name), 2)})
    return clips


# Product/brand names that collide with a banned word. Stripped before the check.
ALLOWED_PHRASES = ["Good Warrior"]


WRITTEN_ONLY = [
    # "Compass" is the narration-only spelling (ElevenLabs pronunciation). Written text is always "Kompass".
    (r"\bCompass\b", 'use "Kompass" in written text; "Compass" is for the spoken transcript only'),
]


def check_written(label: str, text: str, errors: list[str]) -> None:
    for pat, why in WRITTEN_ONLY:
        if re.search(pat, text):
            errors.append(f"{label}: {why}: {text[:90]!r}")


def check_banned(label: str, text: str, errors: list[str]) -> None:
    for phrase in ALLOWED_PHRASES:
        text = text.replace(phrase, "")
    for pat in BANNED:
        if re.search(pat, text, flags=re.IGNORECASE):
            errors.append(f"{label}: banned construction /{pat}/ in: {text[:90]!r}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pdf", required=True, type=Path)
    ap.add_argument("--mp3", type=Path, help="one narration MP3 (sliced by --timing)")
    ap.add_argument("--timing", type=Path, help="Briefing Builder timing report for --mp3")
    ap.add_argument("--clips-dir", type=Path,
                    help="pre-cut clips, one per frame (a01.mp3 .. aNN.mp3, any ffmpeg-readable format); replaces --mp3/--timing")
    ap.add_argument("--allow-compass-frames", action="store_true",
                    help='skip the "Compass" scan of the deck PDF text (written frames must say "Kompass")')
    ap.add_argument("--build-request", default="", help="opaque id recorded in pack.json as buildRequest")
    ap.add_argument("--check-only", action="store_true",
                    help="validate deck/narration/meta/questions and exit without audio or rendering")
    ap.add_argument("--narration", required=True, type=Path)
    ap.add_argument("--meta", required=True, type=Path)
    ap.add_argument("--questions", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path, help="packs root directory")
    ap.add_argument("--set-current", action="store_true", help="also write packs/current.json pointing at this week")
    args = ap.parse_args()

    if not args.check_only and args.clips_dir is None and (args.mp3 is None or args.timing is None):
        die("give either --clips-dir or both --mp3 and --timing")
    required = [args.pdf, args.narration, args.meta, args.questions]
    if not args.check_only:
        required += [args.clips_dir] if args.clips_dir is not None else [args.mp3, args.timing]
    for p in required:
        if not p.exists():
            die(f"missing input: {p}")

    meta = json.loads(args.meta.read_text(encoding="utf-8"))
    questions = json.loads(args.questions.read_text(encoding="utf-8"))
    week = str(meta.get("week", "")).strip()
    if not re.fullmatch(r"P\d{2}W\d", week):
        die(f"meta.week must look like P10W1, got {week!r}")

    ffmpeg = find_ffmpeg()
    paras = parse_narration(args.narration)
    clip_files: list[Path] = []
    starts: list[float] = []
    total = 0.0
    if args.check_only:
        audio_rows = None
    elif args.clips_dir is not None:
        clip_files = list_clips(args.clips_dir)
        audio_rows = len(clip_files)
    else:
        starts = parse_timing(args.timing)
        total = audio_duration(ffmpeg, args.mp3)
        check_timing(starts, total, paras)
        audio_rows = len(starts)

    fitz = _pymupdf()
    doc = fitz.open(str(args.pdf))
    page_count = len(doc)
    if not args.allow_compass_frames:
        hits = [i + 1 for i, page in enumerate(doc) if re.search(r"\bCompass\b", page_text(page))]
        if hits:
            die(f'deck PDF says "Compass" on page(s) {hits}; written frames must say "Kompass" '
                "(pass --allow-compass-frames only for a deck T has already presented as-is)")
    for i, para in enumerate(paras, 1):
        if re.search(r"\bKompass\b", para):
            print(f"WARNING: narration paragraph {i} spells \"Kompass\" — the voice may mispronounce it; "
                  "narration is the one place to write \"Compass\"", file=sys.stderr)
    titles = meta.get("stops") or []
    counts = {"pdf pages": page_count, "narration paragraphs": len(paras), "meta.stops": len(titles)}
    if audio_rows is not None:
        counts["audio clips/timing rows"] = audio_rows
    if len(set(counts.values())) != 1:
        die(f"frame count mismatch: {counts}")
    n = page_count

    errors: list[str] = []
    seen_ids: set[str] = set()
    for q in questions:
        qid = str(q.get("id", ""))
        if not qid or qid in seen_ids:
            errors.append(f"question id missing or duplicated: {qid!r}")
        seen_ids.add(qid)
        stop = q.get("stop")
        if not isinstance(stop, int) or not 1 <= stop <= n:
            errors.append(f"{qid}: stop {stop!r} is not a frame number 1..{n}")
        qtype = q.get("type", "choice")
        if qtype not in ("choice", "tf", "multi"):
            errors.append(f"{qid}: unknown type {qtype!r}")
        opts = q.get("options") or []
        if qtype == "tf":
            opts = ["True", "False"]
            q["options"] = opts
        if len(opts) < 2:
            errors.append(f"{qid}: needs at least two options")
        correct = q.get("correct")
        if qtype == "multi":
            if not isinstance(correct, list) or not correct or any(not (0 <= c < len(opts)) for c in correct):
                errors.append(f"{qid}: multi `correct` must be a non-empty list of option indexes")
        elif not isinstance(correct, int) or not 0 <= correct < len(opts):
            errors.append(f"{qid}: `correct` {correct!r} does not index its options")
        check_banned(qid, str(q.get("q", "")), errors)
        for t in (q.get("q", ""), q.get("explain", ""), *opts):
            check_written(qid, str(t), errors)
        check_banned(qid, str(q.get("explain", "")), errors)
        for o in opts:
            check_banned(qid, str(o), errors)
    if errors:
        for e in errors:
            print("  - " + e, file=sys.stderr)
        die(f"{len(errors)} question problem(s)")
    if args.check_only:
        print(f"check ok: {week} frames={n} questions={len(questions)}")
        return

    pack_dir = args.out / week
    if pack_dir.exists():
        shutil.rmtree(pack_dir)
    frames = render_frames(args.pdf, pack_dir / "frames", ffmpeg)
    if clip_files:
        clips = transcode_clips(clip_files, pack_dir / "audio", ffmpeg)
        total = sum(c["seconds"] for c in clips)
    else:
        clips = slice_audio(args.mp3, starts, total, pack_dir / "audio", ffmpeg)

    by_stop: dict[int, list[dict]] = {}
    for q in questions:
        by_stop.setdefault(q["stop"], []).append(q)

    stops = []
    for i in range(n):
        num = i + 1
        stops.append({
            "n": num,
            "id": f"s{num:02d}",
            "title": titles[i],
            "frame": f"frames/{frames[i]}",
            "audio": f"audio/{clips[i]['file']}",
            "seconds": clips[i]["seconds"],
            "narration": paras[i],
            "words": len(paras[i].split()),
            "checkpoint": [
                {k: q[k] for k in ("id", "type", "q", "options", "correct", "explain") if k in q}
                for q in by_stop.get(num, [])
            ],
        })

    pack = {
        "schema": 1,
        "week": week,
        "build": datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"),
        "buildRequest": args.build_request or None,
        "district": meta.get("district", "D8"),
        "title": meta.get("title", week),
        "dueAt": meta.get("dueAt"),
        "passPct": int(meta.get("passPct", 80)),
        "board": meta.get("board", "none"),
        "closer": meta.get("closer", ""),
        "sections": meta.get("sections", []),
        "totalSeconds": round(total, 1),
        "questionCount": len(questions),
        "stops": stops,
    }
    (pack_dir / "pack.json").write_text(json.dumps(pack, indent=1, ensure_ascii=False), encoding="utf-8")
    if args.set_current:
        (args.out / "current.json").write_text(json.dumps({"week": week}) + "\n", encoding="utf-8")

    size = sum(p.stat().st_size for p in pack_dir.rglob("*") if p.is_file())
    print(f"built {pack_dir}  frames={n} questions={len(questions)} audio={total:.0f}s size={size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
