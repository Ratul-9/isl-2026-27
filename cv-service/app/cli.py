"""Command line: analyse a segment of a video and write the JSON result plus diagnostics.

    uv run python -m app.cli analyze ../test_clip.mp4 --start 140 --duration 8 --out ../cv-output/run1
    uv run python -m app.cli scan ../test_clip.mp4          # list camera shots and suggest wide segments
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from .config import Settings
from .diagnostics import render
from .processing import AnalyzeRequest, ModelsMissing, analyze
from .scan import scan
from .video_io import VideoError


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="dizpitch-cv")
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analyze", help="detect, track and calibrate one segment")
    a.add_argument("video", type=Path)
    a.add_argument("--start", type=float, default=0.0, help="segment start in seconds")
    a.add_argument("--duration", type=float, default=8.0, help="segment length in seconds")
    a.add_argument("--out", type=Path, required=True)
    a.add_argument("--no-video", action="store_true", help="skip diagnostic.mp4 (sample frames are still written)")
    s = sub.add_parser("scan", help="find camera cuts and suggest wide-shot segments worth tracking")
    s.add_argument("video", type=Path)
    args = p.parse_args(argv)

    settings = Settings()
    last = [0.0]

    def progress(stage: str, done: int, total: int) -> None:
        if time.time() - last[0] > 2 or stage == "done":
            print(f"  {stage}: {done}/{total}", flush=True)
            last[0] = time.time()

    if args.cmd == "scan":
        try:
            found = scan(args.video, settings, progress)
        except ModelsMissing as e:
            print(f"error: {e}\nRun: ./scripts/download_models.sh", file=sys.stderr)
            return 2
        except VideoError as e:
            print(f"error [{e.code}]: {e.message}", file=sys.stderr)
            return 3
        print(f"{len(found['shots'])} shots; suggested segments (start s, length s, wide score):")
        for g in found["suggestions"]:
            print(f"  --start {g['startS']} --duration {g['durationS']}   wide {g['wideScore']}")
        return 0

    try:
        result = analyze(AnalyzeRequest(args.video, args.start, args.duration, args.video.name), settings, progress)
    except ModelsMissing as e:
        print(f"error: {e}\nRun: ./scripts/download_models.sh", file=sys.stderr)
        return 2
    except VideoError as e:
        print(f"error [{e.code}]: {e.message}", file=sys.stderr)
        return 3
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "result.json").write_text(json.dumps(result, separators=(",", ":")))
    written = render(args.video, result, args.out, video=not args.no_video)
    cal = result["calibration"]
    people = [t for t in result["tracks"] if t["objectType"] != "ball"]
    ball = next((t for t in result["tracks"] if t["objectType"] == "ball"), None)
    summary = [
        f"segment {result['segment']['startMs'] / 1000:.2f}-{result['segment']['endMs'] / 1000:.2f}s, {result['segment']['processedFrames']} frames, device {result['device']}",
        f"timings ms: {result['timingsMs']}",
        f"calibration: {cal['status']} {cal['framesCalibrated']}/{cal['framesTotal']} frames, median LOO error {cal['medianErrorM']} m, max {cal['maxErrorM']} m, shots {len(cal['shots'])}",
        f"tracks: {len(people)} people ({', '.join(f'{k}={sum(1 for t in people if t['objectType'] == k)}' for k in ('player', 'goalkeeper', 'referee'))})",
        f"track length (frames): median {sorted(len(t['observations']['frame']) for t in people)[len(people) // 2] if people else 0}",
        f"teams: {result['teams']['clusters']}",
        f"ball: {len(ball['observations']['frame']) if ball else 0} observations ({sum(1 for s in ball['observations']['source'] if s == 'interpolated') if ball else 0} interpolated)",
        "warnings:",
        *[f"  - {w}" for w in result["warnings"]],
        f"files: result.json ({(args.out / 'result.json').stat().st_size / 1024:.0f} KB), " + ", ".join(str(p.relative_to(args.out)) for p in written[:3]) + (" ..." if len(written) > 3 else ""),
    ]
    (args.out / "summary.txt").write_text("\n".join(summary) + "\n")
    print("\n".join(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
