# 扩声设计工坊 SR Design Studio

纯浏览器端扩声（SR）设计工具，面向剧场/会议中心投标场景，替代依赖硬件锁的桌面声学软件。
**TypeScript + WebGL2 + Web Audio + Web Worker + IndexedDB，零运行时第三方依赖、零外部服务。**

## 启动

```bash
npm install
npm run dev        # 开发服务器（默认 http://localhost:5173）
npm run build      # 类型检查 + 生产构建（dist/）
npm run preview    # 预览生产包
npm test           # 31 个核心算法单元测试（Vitest）
```

首次打开自动写入演示工程（24m×30m×10m 剧场，含两套可对比布置方案）与内置材料/设备库，全部数据保存在浏览器 IndexedDB，可整体导出/导入 JSON 备份。

## 五大页面

| 页面 | 能力 |
| --- | --- |
| 项目列表 | 新建/删除/打开项目，数据导入导出 |
| 场地建模 | 尺寸生成房间盒体；观众区多边形圈选（3D 点地追加顶点 + 坐标表精编）；六面材料绑定 8 频段吸声系数；材料库自定义 |
| 音箱布置 | 点声源/超低/线阵列/话筒 3D 布放与拾取；线阵列逐只张角、自动反推张角、吊挂物理校核；信号流图与通道 DSP（PEQ/高低切/限幅/预设） |
| 声场分析 | SPL 热力图、赛宾/伊林 RT60、逐级电平预算标红、啸叫余量曲线与危险频点、一二阶反射声线与回声座位、座位频响/RIR/卷积试听、双方案对照 |
| 报告 | 可打印（含打印样式，可另存 PDF）的设计报告；设备清单 BOM 按区域分组、CSV 导出、功耗与吊挂总重估算 |

## 九项需求落地位置

1. **多方案对比** — `analysis` 页「方案对比」标签 / `src/ui/pages/compare-page.ts`：双 Worker 并行分析，RT60、SPL、余量、啸叫、回声、重量、功耗对照表，超阈值差值格自动描红（`diff-hot`）。
2. **场地与材料** — `venue` 页 / `src/core/seed.ts`、`src/core/acoustics/reverb.ts`；材料库支持新增并持久化。
3. **信号流与 DSP** — `layout` 页「信号流/DSP」标签 / `src/ui/pages/signal-flow.ts`、`src/core/dsp.ts`（RBJ 双二阶系数，计算与试听共用同一组参数）；预设可跨通道套用。
4. **线阵列吊挂** — `src/core/array.ts`：逐只张角 → 箱体坐标/姿态 → 总重（含 8% 框架系数）→ 重心 → 各吊点杠杆分配载荷，超额定报警；`autoSplay` 按观众区前后排反推张角。
5. **电平预算** — `src/core/level-budget.ts`：从节目源 dBu 沿 mixer→processor→amp→speaker 逐级推算，限幅钳制、削波比较，最先过载级标红。
6. **传声增益/啸叫** — `src/core/feedback.ts`：48 个对数频点上的环路增益（音箱偏轴 + 话筒心形指向 + 距离 + DSP + NOM 罚分），输出余量曲线、最差 5 个频点；拖动设备后重跑即更新。
7. **反射与回声** — `src/core/reflection.ts`：镜像声源法枚举一阶/二阶路径，含遮挡校验；赛宾 RT60；按延时/强度阈值筛回声并标记受影响座位，换材料后重算。
8. **座位试听** — `src/core/reflection.ts#synthesizeRIR` 合成 RIR（晚期场 `exp(-t/τ)`，τ=RT60/13.8155，单测用包络回归保证与 RT60 对齐）；`src/audio/engine.ts` 用 `ConvolverNode` 卷积自合成干声（语音/音乐/粉噪，`signal-generator.ts`），DSP 链与计算引擎同参。
9. **BOM** — `src/core/bom.ts`：音箱/功放/线缆/吊挂件按型号与区域统计，功耗按额定 1/3 工程系数估算。

## 性能与线程模型

- `src/workers/acoustics.worker.ts` 承载**反射路径搜索、啸叫余量、全量声场分析、座位 RIR 探测**，构建为独立 Worker chunk；主线程仅负责 WebGL2 渲染与交互，墙面/音箱数量上升时不阻塞 UI。
- 声场采样网格间距可调（默认 2m），分析进度经 Worker 消息回传顶部进度条。
- WebGL2 渲染器（`src/render/scene.ts`）自写 mat4/轨道相机/射线拾取，无 3D 库依赖；热力图走点精灵 + GPU 颜色映射 shader。

## 目录结构

```
src/
  core/           纯算法层（可在 Node 与 Worker 中复用，无 DOM 依赖）
    acoustics/    频带常量、混响、指向性、直达/混响声场
    math/         向量、几何/射线、FFT
    array.ts      线阵列几何与吊挂
    dsp.ts        双二阶滤波与通道链
    feedback.ts   啸叫余量
    reflection.ts 镜像声源与 RIR 合成
    level-budget.ts / bom.ts / analysis.ts
  workers/        Worker 入口与客户端封装
  render/         WebGL2 场景
  audio/          Web Audio 卷积试听与干声合成
  state/          IndexedDB 存储、发布订阅仓库、hash 路由
  ui/             页面与组件
test/             Vitest 单元测试（31 项）
```

## 模型边界（工程近似，投标方案阶段适用）

- 指向性采用余弦幂双轴模型（由 -6dB 覆盖角反推指数），非厂家实测 GLL 球谐数据；
- 混响为赛宾/伊林集总模型，未做模态/波动声学；
- 反射为镜面镜像声源（一二阶），不含散射/衍射；
- RIR 为随机噪声 + 指数包络的统计合成，保证衰减时间与 RT60 一致，但不等同实测卷积核。
