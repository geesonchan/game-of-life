# 生命游戏实验台

基于浏览器的 Conway 生命游戏实验平台。规格见 [game-of-life-spec.md](./game-of-life-spec.md)，
验收进度见 [docs/acceptance.md](./docs/acceptance.md)，设计决策见 [docs/decisions.md](./docs/decisions.md)。

当前进度：**阶段 1（引擎 + 渲染 + 基础控制）已完成**。

## 目录结构

```
src/engine/   纯逻辑，零 DOM 依赖，可在 Node 里跑测试
  prng.js       mulberry32 种子化随机
  rules.js      条款列表 → 查找表的预编译器 + B/S 记法互转
  board.js      双缓冲棋盘与单代演进
src/render/   只读引擎状态，负责画
  viewport.js   棋盘坐标 ↔ 屏幕坐标
  renderer.js   Canvas 渲染（ImageData 放大方案）
src/ui/       控件绑定与画布交互
src/main.js   装配与主循环
tests/        验收用例（Vitest 与 jsc 运行器共用）
```

## 运行

```bash
npm install
npm run dev
```

## 测试

```bash
npm test
```

**本机暂未安装 Node/npm。** 在装好 Node 之前，可以用两个不依赖 Node 的替代方式：

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
