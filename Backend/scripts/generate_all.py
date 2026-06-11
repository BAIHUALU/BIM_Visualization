from generate_audit_report import generate as generate_audit_report
from generate_block_schedule import generate as generate_block_schedule
from generate_model_blocks import generate as generate_model_blocks


def generate_all():
    model_blocks = generate_model_blocks()
    block_schedule = generate_block_schedule()
    audit_report = generate_audit_report()
    return {
        "model_blocks": model_blocks.get("summary", {}),
        "block_schedule": block_schedule.get("summary", {}),
        "audit_report": audit_report.get("summary", {}),
    }


if __name__ == "__main__":
    summary = generate_all()
    for name, payload in summary.items():
        print(f"{name}: {payload}")
