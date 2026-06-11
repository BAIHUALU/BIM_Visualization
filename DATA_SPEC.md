# BIM 施工进度可视化数据规格

## 1. 数据总览

正式项目采用三类源文件和三类生成文件。

源文件：

```text
Airport1.glb
schedule_data.json
zone_definitions.json
```

生成文件：

```text
block_schedule.json
model_blocks.json
block_audit_report.json
```

数据流：

```text
Airport1.glb + zone_definitions.json + mapping_rules.json
  -> model_blocks.json

schedule_data.json + mapping_rules.json
  -> block_schedule.json

model_blocks.json + block_schedule.json
  -> block_audit_report.json
```

前端运行时主要读取：

```text
Airport1.glb
zone_definitions.json
model_blocks.json
block_schedule.json
```

## 2. 源文件说明

### 2.1 Airport1.glb

模型数字基座。用于提供：

- 构件几何
- 构件世界坐标
- 构件名称
- ElementID / UniqueId
- 部分 Revit 参数

当前已知特征：

```text
mesh 节点总数约 21785
带 ElementID / UniqueId / Revit 参数的 mesh 约 13355
部分 mesh 没有 ElementID，但仍有名称，可用临时 ID 处理
```

ID 读取优先级：

```text
extras.ElementID
extras.elementId
extras.UniqueId
extras.uniqueId
fallback: mesh-{index}-{mesh.name}
```

构件名称读取优先级：

```text
mesh.name
mesh.parent.name
fallback: 未命名构件
```

### 2.2 schedule_data.json

官方进度计划来源。正式项目只使用以下字段：

```json
{
  "name": "工程桩（管桩292）",
  "zone": "E1",
  "task_type": "工程桩",
  "start_date": "2026-03-01",
  "end_date": "2026-04-09"
}
```

忽略字段：

```text
predecessors
successors
wbs
outline_level
percent_complete
unique_id
duration
is_summary
```

这些字段可保留在原始文件中，但不进入第一版进度可视化主流程。

### 2.3 zone_definitions.json

区域标定成果。记录 19 个大区在 `Airport1.glb` 模型世界坐标系中的 X/Z 平面多边形。

结构：

```json
{
  "version": 1,
  "coordinate_system": "three_world_xz",
  "assignment_strategy": "mesh_center_point",
  "zones": [
    {
      "id": "E1",
      "label": "E1",
      "points": [
        [-100.1, -20.5],
        [-80.2, -20.3],
        [-80.0, -5.7],
        [-100.4, -5.8]
      ]
    }
  ]
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| `version` | 区域文件版本 |
| `coordinate_system` | 固定为 `three_world_xz` |
| `assignment_strategy` | 固定为 `mesh_center_point` |
| `zones` | 19 个区域定义 |
| `zones[].id` | 区域 ID，例如 `E1` |
| `zones[].label` | 显示名称 |
| `zones[].points` | 多边形顶点数组，每个点为 `[x, z]` |

有效性要求：

- 必须包含 19 个区域。
- 每个区域至少 3 个点。
- 区域 ID 只能来自 E1-E13、W1-W6。

## 3. 规则文件 mapping_rules.json

建议在正式项目中维护：

```text
data/rules/mapping_rules.json
```

结构：

```json
{
  "display_categories": [
    "灌注桩",
    "管桩",
    "咬合桩",
    "钢板桩",
    "立柱桩",
    "钢围檩",
    "混凝土支撑",
    "钢支撑"
  ],
  "glb_name_rules": [],
  "category_to_official_group": {},
  "schedule_name_rules": [],
  "zone_merge_rules": {}
}
```

### 3.1 glb_name_rules

示例：

```json
[
  { "match": "灌注桩", "category": "灌注桩" },
  { "match": "管桩", "category": "管桩" },
  { "match": "格构柱", "category": "立柱桩" },
  { "match": "钢板桩", "category": "钢板桩" },
  { "match": "素桩", "category": "咬合桩" },
  { "match": "荤桩", "category": "咬合桩" },
  { "match": "850mm@600", "category": "咬合桩" },
  { "match": "工字钢", "category": "钢围檩" },
  { "match": "板支撑", "category": "混凝土支撑" },
  { "match": "1000x1000", "category": "钢支撑" }
]
```

匹配规则：

- 按数组顺序进行字符串包含匹配。
- 命中第一个规则即返回对应分类。
- 未命中时返回 `未分类`。

### 3.2 category_to_official_group

```json
{
  "灌注桩": "工程桩",
  "管桩": "工程桩",
  "立柱桩": "工程桩",
  "钢板桩": "支护桩",
  "咬合桩": "支护桩",
  "钢围檩": "钢支撑",
  "混凝土支撑": "钢支撑",
  "钢支撑": "钢支撑"
}
```

### 3.3 schedule_name_rules

用于从官方任务名称中提取更细的展示分类。

示例：

```json
[
  { "match": "管桩", "category": "管桩" },
  { "match": "灌注桩", "category": "灌注桩" },
  { "match": "钢板桩", "category": "钢板桩" },
  { "match": "工法桩", "category": "咬合桩" },
  { "match": "钢支撑", "category": "钢支撑" }
]
```

### 3.4 zone_merge_rules

```json
{
  "E7-1": "E7",
  "E7-2": "E7",
  "E7-3": "E7",
  "E8-1": "E8",
  "E8-2": "E8",
  "E9-1": "E9",
  "E9-2": "E9",
  "E10-1": "E10",
  "E10-2": "E10",
  "E10-3": "E10",
  "E10-4": "E10",
  "E11-1": "E11",
  "E11-2": "E11",
  "E11-3": "E11",
  "E11-4": "E11",
  "E12-1": "E12",
  "E12-2": "E12",
  "E12-3": "E12",
  "W3-1": "W3",
  "W3-2": "W3",
  "W3-3": "W3",
  "W3-4": "W3"
}
```

未在该表中的区域保持原值。

## 4. 生成文件说明

### 4.1 model_blocks.json

由模型、区域、分类规则生成。

结构：

```json
{
  "generated_at": "2026-04-24T05:53:35.000Z",
  "coordinate_system": "three_world_xz",
  "blocks": {
    "E1|钢板桩": {
      "block_id": "E1|钢板桩",
      "zone": "E1",
      "category": "钢板桩",
      "mesh_count": 691,
      "mesh_ids": ["5395977", "5395978"]
    }
  }
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| `blocks` | 以 `区域|分类` 为 key 的板块字典 |
| `block_id` | 板块 ID |
| `zone` | 大区 ID |
| `category` | 展示分类 |
| `mesh_count` | 板块内构件数量 |
| `mesh_ids` | 板块内构件 ID 列表 |

生成逻辑：

```text
1. 遍历 GLB mesh
2. 读取 mesh ID 和名称
3. 根据 glb_name_rules 得到 category
4. 计算 mesh 世界包围盒中心点 [x, z]
5. 根据 zone_definitions 判断 zone
6. 按 zone + category 聚合
```

### 4.2 block_schedule.json

由官方计划和映射规则生成。

建议结构：

```json
{
  "generated_at": "2026-04-24T00:00:00.000Z",
  "blocks": {
    "E1|管桩": {
      "block_id": "E1|管桩",
      "zone": "E1",
      "category": "管桩",
      "official_group": "工程桩",
      "start_date": "2026-03-01",
      "end_date": "2026-04-09",
      "match_level": "exact",
      "source_tasks": [
        {
          "name": "工程桩（管桩292）",
          "zone": "E1",
          "task_type": "工程桩",
          "start_date": "2026-03-01",
          "end_date": "2026-04-09"
        }
      ]
    }
  }
}
```

生成逻辑：

```text
1. 读取 schedule_data.json
2. 合并官方子区到大区
3. 优先用 schedule_name_rules 从任务名提取 category
4. 如果任务名无法细分，则根据 task_type 继承给模型中实际存在的相关分类
5. 同一 block_id 多条任务合并，取最早 start_date、最晚 end_date
6. 保留 source_tasks 方便追溯
```

注意：

`block_schedule.json` 最好结合 `model_blocks.json` 生成。这样当官方任务只有 `支护桩` 这种粗分类时，只继承给模型里实际存在的 `钢板桩` 或 `咬合桩`，避免生成不存在的板块。

### 4.3 block_audit_report.json

用于检查模型板块与计划板块是否对齐。

建议结构：

```json
{
  "generated_at": "2026-04-24T00:00:00.000Z",
  "summary": {
    "model_block_count": 92,
    "schedule_block_count": 80,
    "matched_block_count": 75,
    "model_without_schedule_count": 17,
    "schedule_without_model_count": 5
  },
  "model_without_schedule": [],
  "schedule_without_model": [],
  "matched_blocks": []
}
```

审计类型：

```text
模型有，计划有 -> matched_blocks
模型有，计划没有 -> model_without_schedule
计划有，模型没有 -> schedule_without_model
```

该报告用于发现：

- 区域边界错误
- 分类规则错误
- 官方计划缺失
- 模型中存在但计划中未覆盖的内容

## 5. 运行时状态计算

前端根据当前日期和 `block_schedule` 判断状态：

```text
currentDate < start_date -> pending
start_date <= currentDate <= end_date -> in_progress
currentDate > end_date -> completed
无计划 -> no_schedule
```

建议状态字段：

```json
{
  "status": "in_progress",
  "label": "施工中",
  "color": "#2f80ed"
}
```

建议颜色：

| 状态 | 英文字段 | 颜色 |
|---|---|---|
| 未开始 | `pending` | 灰色 |
| 施工中 | `in_progress` | 蓝色 |
| 计划完成 | `completed` | 绿色 |
| 无计划 | `no_schedule` | 深灰或透明 |

## 6. 点击构件时的数据链路

点击构件后：

```text
mesh -> mesh_id
mesh -> block_id
block_id -> model_blocks[block_id]
block_id -> block_schedule[block_id]
```

面板显示：

```text
ElementID / mesh_id
构件名称
区域
分类
block_id
板块构件数量
计划开始日期
计划结束日期
来源任务
匹配等级
```

## 7. 当前标定结果质量

当前已导出的区域标定结果检查如下：

```text
区域数量：19
有效区域：19
总 mesh：21785
已归区：21742
未归区：43
未归区比例：约 0.2%
生成板块：92
```

该质量可以作为正式项目初始区域数据使用。

后续如需提高精度，可在标定工具中微调区域边界并重新导出 `zone_definitions.json`。

## 8. 文件放置建议

正式项目建议目录：

```text
public/
  models/
    Airport1.glb

data/
  raw/
    schedule_data.json

  rules/
    zone_definitions.json
    mapping_rules.json

  generated/
    model_blocks.json
    block_schedule.json
    block_audit_report.json

docs/
  PROJECT_REQUIREMENTS.md
  DATA_SPEC.md
```

规则：

- `data/raw` 中的原始文件不手工修改。
- `data/rules` 中的规则文件可以人工维护。
- `data/generated` 中的文件由脚本生成，可以删除重建。

