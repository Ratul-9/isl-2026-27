#!/usr/bin/env bash
# Downloads the three Roboflow "sports" football models (YOLOv8, trained with Ultralytics) into ./models.
# Source: https://github.com/roboflow/sports (examples/soccer/setup.sh). Licence: see README "Licences" (AGPL-3.0 applies).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$DIR/models"
cd "$DIR"
download() {
  local name="$1" id="$2"
  if [[ -s "models/$name" ]]; then echo "models/$name already present"; return; fi
  uv run gdown -O "models/$name" "https://drive.google.com/uc?id=$id"
}
download football-player-detection.pt 17PXFNlx-jI7VjVo_vQnB1sONjRyvoB-q
download football-ball-detection.pt   1isw4wx-MK9h9LMr36VvIWlJD6ppUvw7V
download football-pitch-detection.pt  1Ma5Kt86tgpdjCTKfum79YMgNnSjcoOyf
shasum -a 256 models/*.pt
