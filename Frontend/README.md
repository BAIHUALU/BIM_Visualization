# BIM 施工进度可视化前端

Vue3 + Vite + JavaScript + Three.js + ECharts 工作台。

## Commands

```bash
npm install
npm run preprocess:geometry
npm run dev
npm run build
npm run preview
```

## Notes

- 入口页面是施工进度工作台，不是营销页。
- Three.js 视口使用温和天空浅蓝背景，不显示网格线。
- `public/models/Airport1.glb` 是正式源模型；运行时优先加载 `public/models/processed/geometry_manifest.json` 和 `geometry_chunk_*.bin`，避免浏览器每次打开页面都解码 190MB Draco GLB。
- `npm run preprocess:geometry` 会离线生成前端专用真实几何缓存。默认使用 `meshoptimizer` 做拓扑网格简化，避免抽样三角面导致点云化；如需全精度缓存，可在 PowerShell 中运行 `$env:GEOMETRY_MAX_TRIANGLES='0'; npm run preprocess:geometry`，但输出体积会显著增大。
- Three.js 渲染按 chunk 合并几何，顶点携带 `component_id`，通过 GPU 颜色纹理更新构件状态；时间轴变色和筛选只刷新颜色/可见性表，不重建模型。
- 点击优先命中真实几何面，并保留不参与渲染的构件包围盒拾取代理，保证细桩和薄梁也能稳定选中；选中构件会进入同一套颜色纹理高亮。
- 实际进度录入和偏差比对目前为 V1 预留入口，不做生产持久化。
