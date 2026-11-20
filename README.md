# work

本仓库存放「镜像溯源 VisTrace」图片搜索网站源码。

## 功能

- **来源溯源**：上传图片，联网搜索并给出真实来源网址。
- **影视识别**：识别截图出自的影视作品、集数；时刻推断不准时，自动联网搜片源 → 探测可直读性 → 逐帧像素比对 → 汇总为综合结论。

## 目录

```
vistrace/
  index.html          前端页面
  styles.css          样式
  app.js              前端逻辑（AI 识别 / 联网搜索 / 兜底链路）
  启动网站.bat        Windows 一键启动
  devtool.js          备份/恢复/变更记录工具
  backup.bat / restore.bat
  修改记录.md
  server/
    server.js         Express 服务（端口 3777）
    frameMatch.js     视频帧比对核心（dHash + NCC）
    webSearch.js      真实联网搜索 + 片源搜索
    package.json
```

## 启动

在 `vistrace/server/` 下执行 `npm install`，然后双击 `vistrace/启动网站.bat`（或在 server 目录 `npm start`），浏览器打开 `http://localhost:3777`。

> `.gitignore` 已排除 `node_modules`、备份目录与浏览器缓存，仅提交源码。
