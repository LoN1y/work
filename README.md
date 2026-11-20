# work · 镜像溯源 VisTrace

在线访问（GitHub Pages）：**https://lon1y.github.io/work/**

上传图片即可 AI 识别来源 / 影视作品与片段，并提供多引擎核验入口。

## 功能与运行说明

- **AI 识别**（图片来源 / 影视作品）：纯前端 + 云端模型，在线打开即用。
- **真实联网搜索、视频帧比对、自动找片源**：依赖本地 Node 服务（Express + ffmpeg），GitHub Pages 为纯静态托管，无法运行。需用完整功能时：
  1. 在 `server/` 下执行 `npm install`
  2. 双击 `启动网站.bat`，浏览器打开 `http://localhost:3777`

## 目录

```
index.html / styles.css / app.js   前端
server/                            后端（联网搜索 + 帧比对，需本地运行）
  server.js / frameMatch.js / webSearch.js / package.json
devtool.js / backup.bat / restore.bat / 修改记录.md   备份与变更记录
启动网站.bat                       Windows 一键启动完整服务
```

> `.gitignore` 排除 `node_modules`、备份目录与浏览器缓存。
