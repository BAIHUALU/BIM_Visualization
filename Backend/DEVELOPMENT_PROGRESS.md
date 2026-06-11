# 后端开发进度说明：实际进度接口与双视口支撑

## 当前后端职责

当前后端仍使用 Flask，负责为前端大屏提供数据接口：

- `/api/model-blocks`：返回模型构件和板块映射。
- `/api/block-schedule`：返回计划进度板块时间。
- `/api/audit-report`：返回模型和计划匹配审计结果。
- `/api/actual-progress`：读取和保存实际进度录入数据。
- `/api/dashboard-summary`：返回大屏摘要数据。

本次双视口改造没有改变 API 路径和返回结构，前端实际视口直接复用 `/api/actual-progress` 的 `items` 数据。

## 已完成能力

- 支持读取 `data/progress/actual_progress.json`，文件不存在时回退到 sample 数据。
- 支持 `PUT /api/actual-progress` 保存板块级实际进度。
- 保存时校验 `actual_percent` 范围为 0-100。
- 保存时校验实际开始和完成日期格式为 `YYYY-MM-DD`。
- 保存结果按 `block_id` 标准化，并写入 `generated_at` 与 `updated_at`。

## 本次策略

- 暂缓 Java 后端迁移，避免展示层大改和后端技术栈切换同时进行。
- 保持现有接口兼容，保证 Vue 前端可以在不改 API 地址的情况下完成计划/实际双视口展示。
- 后续迁移 Java 时，应优先复刻当前接口契约，而不是先改变前端调用方式。

## 后续建议

- Java 迁移可使用 Spring Boot 实现同名 REST API。
- 若引入数据库，建议先从 `actual_progress.json` 迁移实际进度录入数据。
- 建议为实际进度接口补充单元测试和导入校验测试，避免批量录入时污染进度数据。
