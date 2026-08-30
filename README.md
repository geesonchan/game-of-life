# 生命游戏实验台 · Game of Life Lab

**在线试玩 / Live demo：** 见仓库右侧 About 区的链接（GitHub Pages）。

一个跑在浏览器里的康威生命游戏**实验台**——不是又一个"点开看方块闪"的小玩具。
你可以改写规则本身（不止 B3/S23）、把一局的历史堆成一座可以绕着看的 3D「时间之塔」、
让它在后台批量试上百条规则并告诉你哪几条"最有意思"。
界面有中英双语，还有**儿童版**：同一套功能，换成大白话，按钮只留最要紧的几个。
不需要装任何东西，打开网页就能玩。你画的棋盘、存档、实验台账**一律留在你自己的机器上**，
不会上传到任何地方（存档靠手动导出文件）。线上版本只有一个匿名的访问计数
（[GoatCounter](https://www.goatcounter.com/)，无 cookie、不采集个人信息），
自己下载下来跑的话连这个也没有。

A browser-based **laboratory** for Conway's Game of Life — not another blinking-squares toy.
Rewrite the rules themselves (far beyond B3/S23), stack a run's entire history into a 3-D
"Tower of Time" you can orbit, and let it batch-test hundreds of rules in the background
and tell you which ones are actually interesting. Bilingual (中文 / English), with a
**kids version** that keeps every feature but swaps the jargon for plain words and hides
all but the essential buttons. Nothing to install. Your boards, saves and experiment log
**stay on your own machine** — nothing is uploaded (saving means exporting a file yourself).
The hosted copy carries one anonymous page-view counter
([GoatCounter](https://www.goatcounter.com/) — no cookies, no personal data); a copy you
run yourself has not even that.

**主要功能 / What's inside**

| | |
| --- | --- |
| 规则编辑器 · Rule editor | 用「条件 → 结果」的条款写规则，带校验器；能和标准 B/S 记法互转 |
| 时间之塔 · Tower of Time | 一代一层堆成 3D 塔：静物是直柱，闪灯是麻花，滑翔机是斜线 |
| 规则勘探器 · Rule explorer | 后台批量跑规则，按"持续复杂"排序，一键跳回主界面复现 |
| 记录与台账 · Records | 人口曲线、死因统计、编年史、CSV 导出、存档与 RLE 互通 |

规格见 [game-of-life-spec.md](./game-of-life-spec.md)，
验收进度见 [docs/acceptance.md](./docs/acceptance.md)，设计决策见 [docs/decisions.md](./docs/decisions.md)，
用户反馈记录见 [docs/feedback.md](./docs/feedback.md)，
**v1 复盘（流程资产 / 方法清单 / v2 待办）见 [docs/retrospective.md](./docs/retrospective.md)**。

当前进度：**v1 封版**。全部规格阶段（1–6，含插入的 3.5 / 3.6 / 3.7 / 5.5）已通过验收，`acceptance.md` 零未勾项。

## 目录结构

```
src/engine/   纯逻辑，零 DOM 依赖，可在 Node 里跑测试
  prng.js       mulberry32 种子化随机
  rules.js      条款列表 → 查找表的预编译器 + 可达性闭包 + B/S 记法互转
  validate.js   规则校验器（结构校验 / 永不可达 / 冗余 / B/S 表达力）
  presets.js    5 个内置规则预设
  rule-io.js    规则导出导入（B/S 记法 或 条款 JSON）
  board.js      双缓冲棋盘与单代演进
  patterns.js   5 个内置图案与放置函数
  rle.js        标准 RLE 格式解析与生成
  save.js       存档格式（规格 3.1）与读档重建
src/render/   只读引擎状态，负责画
  viewport.js       棋盘坐标 ↔ 屏幕坐标
  renderer.js       Canvas 渲染（ImageData 放大方案 + 拖尾图层）
  palette.js        色带与颜色查找表
  visual-state.js   细胞年龄 / 死亡余晖（渲染层自有缓冲，引擎无感知）
  chart.js          存活数折线图
src/data/     数据记录，纯逻辑零 DOM
  series.js         定长环形序列（折线图用）
  snapshots.js      每代快照表，按规格 3.3 抽稀
  detector.js       终止检测：全灭 / 静止 / 循环 / 代数上限，Map 查重
  chronicle.js      事件编年史
  ledger.js         实验台账
  csv.js            CSV 生成
  tower.js          时间之塔的数据模型（滑动窗口 / 切片 / 几何度量）
  explorer.js       规则勘探：单局观测、结局七类分类、多局总判与排序、B/S 采样
src/i18n/     中英词典与运行时（界面上的每个字都在这里）
  dict.js           中英对照表
  index.js          t() 取词、data-i18n 整树重刷、语言切换广播
src/ui/       控件绑定与画布交互
  rule-editor.js    条款规则编辑器（模态窗）
  library.js        图案盒子与世界卡片
  intro.js          三幕介绍卡与规矩实验角
  records.js        记录面板、总结卡片与 CSV 导出
  io.js             存档下载读取（分片重放 + 进度条）、RLE 导入与框选导出
  tower-view.js     观塔模式（three.js InstancedMesh + 切片联动）
  explorer-view.js  规则勘探器（批量结果表 / 候选名单 / 一键复现）
src/workers/
  tower-builder.js  时间之塔的构建 Worker（只搬运，逻辑在 data/tower.js）
  explorer.js       规则勘探的批量 Worker（同样只搬运）
src/main.js   装配与主循环
tests/        验收用例（Vitest 与 jsc 运行器共用）
```

## 运行

```bash
npm install
npm run dev
```

发布到 GitHub Pages 的步骤见 [docs/deploy.md](./docs/deploy.md)。

## 测试

```bash
npm test
```

Node 已就绪（v24），`npm run dev` / `npm test` 均可用。以下两个不依赖 Node 的替代方式仍然保留 ——
它们在没有 Node 的机器上依然管用，`jsc` 那条也是本项目早期唯一的验证手段：

跑验收测试（用 macOS 自带的 JavaScriptCore，跑的是同一批用例）：

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tests/run-jsc.js
```

起本地预览（源码只用相对路径的 ES module，静态服务器即可）：

```bash
python3 -m http.server 5174
```

然后打开 http://127.0.0.1:5174/index.html

## 操作

| 操作 | 效果 |
| --- | --- |
| 左键拖动 | 画活细胞 |
| 右键拖动 | 擦除 |
| 中键 / 空格+左键 拖动 | 平移视口 |
| 滚轮 | 以光标为锚点缩放 |
| P / N / F / R / C | 播放暂停 / 单步 / 适配视图 / 随机填充 / 清空 |
