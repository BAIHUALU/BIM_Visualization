import json
from datetime import datetime, timezone
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def read_json(path):
    with Path(path).open("r", encoding="utf-8") as file:
        return json.load(file)


def write_json(path, payload):
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")


def normalize_tasks(schedule_payload):
    if isinstance(schedule_payload, list):
        return schedule_payload
    if isinstance(schedule_payload, dict):
        return schedule_payload.get("tasks", [])
    return []


def pick_category(name, rules, fallback="未分类"):
    safe_name = name or ""
    for rule in rules:
        if rule.get("match") and rule["match"] in safe_name:
            return rule["category"]
    return fallback


def merge_zone(zone, rules):
    return rules.get(zone, zone)
