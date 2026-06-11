# BIM 施工进度可视化后端

Flask + Python 数据生成/API 服务。

## Setup

```bash
python -m venv .venv
.venv\Scripts\python.exe -m ensurepip --upgrade --default-pip
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Generate Data

```bash
.venv\Scripts\python.exe scripts\generate_all.py
```

Outputs:

- `data/generated/model_blocks.json`
- `data/generated/block_schedule.json`
- `data/generated/block_audit_report.json`

## Run API

```bash
.venv\Scripts\python.exe run.py
```

API:

- `GET /api/health`
- `GET /api/model-blocks`
- `GET /api/block-schedule`
- `GET /api/audit-report`
- `GET /api/dashboard-summary`
- `GET /api/actual-progress`
- `POST /api/regenerate`
