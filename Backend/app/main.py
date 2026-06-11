import sys
import re
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS

BASE_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = BASE_DIR / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from common import DATA_DIR, read_json, utc_now, write_json
from generate_all import generate_all


GENERATED_DIR = DATA_DIR / "generated"
PROGRESS_DIR = DATA_DIR / "progress"
ACTUAL_PROGRESS_PATH = PROGRESS_DIR / "actual_progress.json"
ACTUAL_PROGRESS_SAMPLE_PATH = PROGRESS_DIR / "actual_progress.sample.json"
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def json_file(path, fallback):
    if not path.exists():
        return fallback
    return read_json(path)


def read_actual_progress():
    if ACTUAL_PROGRESS_PATH.exists():
        return json_file(ACTUAL_PROGRESS_PATH, {"items": {}})
    return json_file(ACTUAL_PROGRESS_SAMPLE_PATH, {"items": {}})


def is_valid_date(value):
    return value in (None, "") or (isinstance(value, str) and DATE_PATTERN.match(value))


def validate_actual_progress(payload):
    if not isinstance(payload, dict):
        return None, "Payload must be an object."

    items = payload.get("items", {})
    if not isinstance(items, dict):
        return None, "items must be an object keyed by block_id."

    normalized_items = {}
    now = utc_now()
    for block_id, item in items.items():
        if not isinstance(block_id, str) or not block_id.strip():
            return None, "Each actual progress item needs a non-empty block_id."
        if not isinstance(item, dict):
            return None, f"{block_id} must be an object."

        percent = item.get("actual_percent")
        try:
            percent = float(percent)
        except (TypeError, ValueError):
            return None, f"{block_id} actual_percent must be a number."
        if percent < 0 or percent > 100:
            return None, f"{block_id} actual_percent must be between 0 and 100."

        actual_start_date = item.get("actual_start_date") or ""
        actual_finish_date = item.get("actual_finish_date") or ""
        if not is_valid_date(actual_start_date):
            return None, f"{block_id} actual_start_date must be YYYY-MM-DD."
        if not is_valid_date(actual_finish_date):
            return None, f"{block_id} actual_finish_date must be YYYY-MM-DD."

        normalized_items[block_id] = {
            "block_id": block_id,
            "actual_start_date": actual_start_date,
            "actual_finish_date": actual_finish_date,
            "actual_percent": round(percent, 2),
            "remark": str(item.get("remark") or ""),
            "updated_at": item.get("updated_at") or now,
        }

    return {"generated_at": now, "items": normalized_items}, None


def create_app():
    app = Flask(__name__)
    CORS(app)

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok", "service": "bim-progress-backend"})

    @app.get("/api/model-blocks")
    def model_blocks():
        return jsonify(json_file(GENERATED_DIR / "model_blocks.json", {"blocks": {}, "meshes": {}}))

    @app.get("/api/block-schedule")
    def block_schedule():
        return jsonify(json_file(GENERATED_DIR / "block_schedule.json", {"blocks": {}}))

    @app.get("/api/audit-report")
    def audit_report():
        return jsonify(json_file(GENERATED_DIR / "block_audit_report.json", {"summary": {}}))

    @app.get("/api/actual-progress")
    def actual_progress():
        return jsonify(read_actual_progress())

    @app.put("/api/actual-progress")
    def save_actual_progress():
        payload, error = validate_actual_progress(request.get_json(silent=True) or {})
        if error:
            return jsonify({"status": "error", "message": error}), 400
        write_json(ACTUAL_PROGRESS_PATH, payload)
        return jsonify({"status": "ok", **payload})

    @app.get("/api/dashboard-summary")
    def dashboard_summary():
        model_payload = json_file(GENERATED_DIR / "model_blocks.json", {"summary": {}, "blocks": {}})
        schedule_payload = json_file(GENERATED_DIR / "block_schedule.json", {"summary": {}, "blocks": {}})
        audit_payload = json_file(GENERATED_DIR / "block_audit_report.json", {"summary": {}})
        return jsonify(
            {
                "model": model_payload.get("summary", {}),
                "schedule": schedule_payload.get("summary", {}),
                "audit": audit_payload.get("summary", {}),
                "actual_progress": {
                    "status": "placeholder",
                    "message": "V1 reserves the entry point for actual progress and variance comparison.",
                },
            }
        )

    @app.post("/api/regenerate")
    def regenerate():
        return jsonify({"status": "ok", "summary": generate_all()})

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
