"""Writes the JSON Schema of the tracking result (schemaVersion 1) to schema/tracking-result.v1.schema.json.

    uv run python scripts/export_schema.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.schemas import TrackingResult  # noqa: E402

OUT = ROOT / "schema" / "tracking-result.v1.schema.json"


def schema_text() -> str:
    schema = TrackingResult.model_json_schema()
    schema["$id"] = "https://dizpitch.local/schema/tracking-result.v1.schema.json"
    return json.dumps(schema, indent=2, sort_keys=True) + "\n"


if __name__ == "__main__":
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(schema_text())
    print(f"wrote {OUT.relative_to(ROOT)}")
