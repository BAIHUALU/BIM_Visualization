import json

from common import DATA_DIR, read_json, utc_now, write_json


def compact_block(block):
    return {
        "block_id": block.get("block_id"),
        "zone": block.get("zone"),
        "category": block.get("category"),
        "mesh_count": block.get("mesh_count"),
        "start_date": block.get("start_date"),
        "end_date": block.get("end_date"),
        "match_level": block.get("match_level"),
    }


def generate(
    model_blocks_path=DATA_DIR / "generated" / "model_blocks.json",
    block_schedule_path=DATA_DIR / "generated" / "block_schedule.json",
    output_path=DATA_DIR / "generated" / "block_audit_report.json",
):
    model_payload = read_json(model_blocks_path)
    schedule_payload = read_json(block_schedule_path)
    model_blocks = model_payload.get("blocks", {})
    schedule_blocks = schedule_payload.get("blocks", {})
    model_ids = set(model_blocks)
    schedule_ids = set(schedule_blocks)
    matched_ids = sorted(model_ids & schedule_ids)
    model_without_schedule_ids = sorted(model_ids - schedule_ids)
    schedule_without_model_ids = sorted(schedule_ids - model_ids)

    payload = {
        "generated_at": utc_now(),
        "summary": {
            "model_block_count": len(model_blocks),
            "schedule_block_count": len(schedule_blocks),
            "matched_block_count": len(matched_ids),
            "model_without_schedule_count": len(model_without_schedule_ids),
            "schedule_without_model_count": len(schedule_without_model_ids),
            "unassigned_mesh_count": model_payload.get("summary", {}).get("unassigned_mesh_count", 0),
            "unclassified_mesh_count": model_payload.get("summary", {}).get("unclassified_mesh_count", 0),
        },
        "model_without_schedule": [compact_block(model_blocks[item]) for item in model_without_schedule_ids],
        "schedule_without_model": [compact_block(schedule_blocks[item]) for item in schedule_without_model_ids],
        "matched_blocks": [
            {
                **compact_block(model_blocks[item]),
                "start_date": schedule_blocks[item].get("start_date"),
                "end_date": schedule_blocks[item].get("end_date"),
                "match_level": schedule_blocks[item].get("match_level"),
            }
            for item in matched_ids
        ],
        "unassigned_meshes": model_payload.get("unassigned_meshes", []),
        "unclassified_meshes": model_payload.get("unclassified_meshes", []),
    }
    write_json(output_path, payload)
    return payload


if __name__ == "__main__":
    result = generate()
    print(json.dumps(result["summary"], ensure_ascii=False, indent=2))
