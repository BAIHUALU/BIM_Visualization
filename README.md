# Airport BIM Progress Visualization

深圳宝安国际机场 T2 航站楼基础工程 BIM 施工进度可视化系统。

本项目以 `Airport1.glb` 作为三维数字基座，将施工计划、区域标定规则和 BIM 构件信息统一映射到模型板块，实现按时间轴查看施工状态、按区域/类别筛选、点击构件查看详情，以及模型与计划一致性审计。

## 核心功能

- 加载机场基础工程 BIM 模型，并在浏览器中进行三维交互展示。
- 将 GLB 构件解析为施工板块，形成 `区域 + 工程类别` 的 `block_id`。
- 将施工计划表解析为 `block_schedule.json`，并与模型板块自动匹配。
- 支持时间轴驱动的构件状态变色，展示未开始、进行中、已完成、无计划等状态。
- 支持点击 BIM 构件查看构件 ID、名称、区域、类别、施工板块和计划来源。
- 自动生成审计报告，识别模型有但计划无、计划有但模型无、已成功匹配的板块。
- 使用离线几何缓存与 GPU 颜色纹理优化大体量 BIM 模型渲染性能。

## 技术栈

前端：

- Vue 3
- Vite
- Three.js
- ECharts
- Draco decoder
- meshoptimizer

后端：

- Python
- Flask
- pygltflib

数据与模型：

- `Airport1.glb`：BIM 数字基座
- `zone_definitions.json`：施工区域边界
- `mapping_rules.json`：构件/计划分类映射规则
- `model_blocks.json`：模型板块数据
- `block_schedule.json`：板块级施工计划
- `block_audit_report.json`：模型与计划匹配审计结果

## 目录结构

```text
Airport_BIM_Progress/
├── Backend/                 # Flask API 与数据生成脚本
│   ├── app/                 # 后端服务入口
│   ├── data/                # 原始数据、规则、生成结果
│   ├── scripts/             # 模型板块、计划、审计报告生成脚本
│   └── requirements.txt
├── Frontend/                # Vue + Three.js 前端工作台
│   ├── public/              # 静态数据、模型、Draco decoder、几何缓存
│   ├── scripts/             # 离线几何缓存预处理脚本
│   └── src/                 # 页面、组件、服务与样式
├── DATA_SPEC.md             # 数据结构说明
├── PROJECT_REQUIREMENTS.md  # 项目需求说明
└── README.md
```

## Git LFS 说明

本仓库包含 BIM 模型和离线几何缓存，文件体积较大。`*.glb` 和 `*.bin` 已通过 Git LFS 管理。

首次克隆后请确保已安装 Git LFS：

```bash
git lfs install
git lfs pull
```

如果没有拉取 LFS 文件，前端可能无法加载完整模型或几何缓存。

## 后端运行

进入后端目录：

```bash
cd Backend
```

创建虚拟环境并安装依赖：

```bash
python -m venv .venv
.venv\Scripts\python.exe -m ensurepip --upgrade --default-pip
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

生成模型板块、计划匹配和审计数据：

```bash
.venv\Scripts\python.exe scripts\generate_all.py
```

启动 API 服务：

```bash
.venv\Scripts\python.exe run.py
```

默认 API 地址：

```text
http://127.0.0.1:5000/api/health
```

主要接口：

- `GET /api/health`
- `GET /api/model-blocks`
- `GET /api/block-schedule`
- `GET /api/audit-report`
- `GET /api/dashboard-summary`
- `GET /api/actual-progress`
- `POST /api/regenerate`

## 前端运行

进入前端目录：

```bash
cd Frontend
```

安装依赖：

```bash
npm install
```

如需重新生成前端几何缓存：

```bash
npm run preprocess:geometry
```

启动开发服务器：

```bash
npm run dev
```

默认访问地址：

```text
http://127.0.0.1:5173/
```

生产构建：

```bash
npm run build
```

## 模型加载优化方案

原始 `Airport1.glb` 为大体量 Draco 压缩模型，浏览器直接解码会带来明显加载和交互压力。项目采用以下优化链路：

1. 离线解码 `Airport1.glb` 的 Draco 几何。
2. 使用 `meshoptimizer` 进行拓扑网格简化，保留实体几何形态。
3. 输出 `geometry_manifest.json` 与 `geometry_chunk_*.bin` 分块缓存。
4. 前端运行时优先加载几何缓存，不再每次完整解码 GLB。
5. Three.js 按 chunk 构建合并 `BufferGeometry`。
6. 每个顶点携带 `component_id`，通过 GPU `DataTexture` 查表更新构件颜色。

这样在拖动时间轴或筛选构件时，只更新颜色/可见性状态，不重建几何、不重新加载模型。

## 构件点击与信息回查

用户点击三维视口后，系统通过 Three.js Raycaster 优先命中真实几何面，并从命中三角面的顶点属性读取 `component_id`。随后通过 `geometry_manifest.json` 回查构件的 `mesh_id`、`element_id`、名称、区域、类别和 `block_id`，再通过 `block_id` 关联 `model_blocks.json` 与 `block_schedule.json`，最终在右侧面板展示构件详情和计划状态。

对细桩、薄梁等难以直接点击的构件，系统增加了不可见的拾取代理，提高点击命中率；代理只参与拾取，不参与最终渲染。

## 数据生成流程

```text
Airport1.glb
  + zone_definitions.json
  + mapping_rules.json
        ↓
model_blocks.json
        ↓
schedule_data.json + mapping_rules.json
        ↓
block_schedule.json
        ↓
block_audit_report.json
```

其中：

- `model_blocks.json` 描述 BIM 构件与施工板块的关系。
- `block_schedule.json` 描述板块级施工计划。
- `block_audit_report.json` 用于检查模型与计划是否一致。

## 注意事项

- `Frontend/node_modules/`、`Frontend/dist/`、`Backend/.venv/`、`.deps/` 等本地依赖和构建产物不会提交到仓库。
- 仓库中的大模型和几何缓存通过 Git LFS 管理，克隆后需要执行 `git lfs pull`。
- 如果重新生成几何缓存，相关 `*.bin` 文件会继续由 Git LFS 跟踪。
- 后端数据生成依赖 `Backend/data/raw/` 与 `Backend/data/rules/` 中的原始数据和规则文件。

## 项目定位

本项目的关键工作不是简单加载 BIM 模型，而是建立 `模型构件 - 施工区域 - 计划任务 - 进度状态` 的映射关系，并通过离线几何缓存和 GPU 状态纹理，实现大体量 BIM 模型在浏览器中的流畅施工进度可视化。
