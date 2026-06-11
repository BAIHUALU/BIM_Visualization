import json

from common import DATA_DIR, merge_zone, normalize_tasks, pick_category, read_json, utc_now, write_json


def source_task(task, merged_zone):
    return {
        "id": task.get("id"),
        "unique_id": task.get("unique_id"),
        "name": task.get("name"),
        "zone": task.get("zone"),
        "display_zone": merged_zone,
        "task_type": task.get("task_type"),
        "start_date": task.get("start_date"),
        "end_date": task.get("end_date"),
    }


def update_block(blocks, zone, category, official_group, match_level, task, merged_zone):
    block_id = f"{zone}|{category}"
    block = blocks.setdefault(
        block_id,
        {
            "block_id": block_id,
            "zone": zone,
            "category": category,
            "official_group": official_group,
            "start_date": task.get("start_date"),
            "end_date": task.get("end_date"),
            "match_level": match_level,
            "source_tasks": [],
        },
    )
    if task.get("start_date") and (not block["start_date"] or task["start_date"] < block["start_date"]):
        block["start_date"] = task["start_date"]
    if task.get("end_date") and (not block["end_date"] or task["end_date"] > block["end_date"]):
        block["end_date"] = task["end_date"]
    levels = {block["match_level"], match_level}
    if "coarse_merged" in levels:
        block["match_level"] = "coarse_merged"
    elif "coarse" in levels and "merged" in levels:
        block["match_level"] = "coarse_merged"
    elif "coarse" in levels:
        block["match_level"] = "coarse"
    elif "merged" in levels:
        block["match_level"] = "merged"
    else:
        block["match_level"] = "exact"
    block["source_tasks"].append(source_task(task, merged_zone))


def categories_for_group(model_blocks, zone, official_group, category_to_group):
    categories = []
    for block in model_blocks.values():
        if block.get("zone") == zone and category_to_group.get(block.get("category")) == official_group:
            categories.append(block["category"])
    return sorted(set(categories))


def generate(
    schedule_path=DATA_DIR / "raw" / "schedule_data.json",
    rules_path=DATA_DIR / "rules" / "mapping_rules.json",
    model_blocks_path=DATA_DIR / "generated" / "model_blocks.json",
    output_path=DATA_DIR / "generated" / "block_schedule.json",
):
    schedule_payload = read_json(schedule_path)
    rules = read_json(rules_path)
    model_payload = read_json(model_blocks_path)
    model_blocks = model_payload.get("blocks", {})
    category_to_group = rules["category_to_official_group"]
    blocks = {}

    for task in normalize_tasks(schedule_payload):
        if task.get("is_summary"):
            continue
        zone = task.get("zone_group") or task.get("zone")
        merged_zone = merge_zone(zone, rules["zone_merge_rules"])
        zone_changed = zone != merged_zone
        task_type = task.get("task_type")
        category = pick_category(task.get("name"), rules["schedule_name_rules"], fallback=None)

        if category:
            official_group = category_to_group.get(category, task_type)
            match_level = "merged" if zone_changed else "exact"
            update_block(blocks, merged_zone, category, official_group, match_level, task, merged_zone)
            continue

        official_group = task_type
        inherited = categories_for_group(model_blocks, merged_zone, official_group, category_to_group)
        match_level = "coarse_merged" if zone_changed else "coarse"
        for inherited_category in inherited:
            update_block(blocks, merged_zone, inherited_category, official_group, match_level, task, merged_zone)

    payload = {
        "generated_at": utc_now(),
        "source_schedule": "schedule_data.json",
        "summary": {
            "schedule_block_count": len(blocks),
            "source_task_count": len(normalize_tasks(schedule_payload)),
        },
        "blocks": dict(sorted(blocks.items())),
    }
    write_json(output_path, payload)
    return payload


if __name__ == "__main__":
    result = generate()
    print(json.dumps(result["summary"], ensure_ascii=False, indent=2))
