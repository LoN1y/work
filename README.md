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
devtool.js / 修改记录.md   修改记录工具与变更日志（本地备份已取消，见版本目录.md）
启动网站.bat                       Windows 一键启动完整服务
```

> 历史版本统一归档在本仓库 `1/`～`14/` 文件夹，本地不再保留 `.backup` 备份副本。

## 版本归档

历史版本按时间顺序存放于 `1/`、`2/`、`3/` …… 文件夹，详情见 [版本目录.md](版本目录.md)。根目录始终为当前本地制作版本。新版本制作完成后会先询问是否上传，确认后顺延编号归档。
