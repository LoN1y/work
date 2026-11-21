#!/usr/bin/env node
/* =========================================================
 * devtool.js — VisTrace 修改记录工具
 *
 * 本地备份功能已取消（2026-11-22）：历史版本统一归档在
 * GitHub 仓库 https://github.com/LoN1y/work 的 1/ 2/ 3/ ... 文件夹，
 * 需要回退时从对应版本目录取回源码即可，不再在本机保存副本。

 * 用法：
 *   node devtool.js note "说明"   追加一条修改记录
 *   node devtool.js versions      查看 GitHub 版本归档说明
 * ========================================================= */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const LOG_FILE = path.join(ROOT, "修改记录.md");
const VERSION_URL = "https://github.com/LoN1y/work";

const p2 = (n) => String(n).padStart(2, "0");
function nowStr() {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

function appendLog(text) {
  let content = "";
  if (!fs.existsSync(LOG_FILE)) {
    content = "# 修改记录 · 镜像溯源 VisTrace\n\n" +
      "> 本地备份已取消；历史版本归档在 GitHub 仓库 `LoN1y/work` 的 `1/`～`13/` 等编号文件夹。\n" +
      "> 回退：打开对应版本目录取回源码；记录：`node devtool.js note \"说明\"`。\n\n";
  } else {
    content = fs.readFileSync(LOG_FILE, "utf8");
  }
  fs.writeFileSync(LOG_FILE, content + text + "\n", "utf8");
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "note":
    if (!args[0]) { console.error('用法: node devtool.js note "修改说明"'); process.exit(1); }
    appendLog(`## ${nowStr()} — 修改记录\n- ${args.join(" ")}`);
    console.log("✅ 记录已追加到 修改记录.md");
    break;
  case "versions":
    console.log(`历史版本归档：${VERSION_URL}`);
    console.log("按时间顺序存于 1/ 2/ 3/ ... 文件夹，根目录为当前版本；详见 版本目录.md。");
    break;
  default:
    console.log(`VisTrace 修改记录工具（本地备份已取消，版本统一归档 GitHub）
  node devtool.js note "说明"   追加修改记录
  node devtool.js versions      查看 GitHub 版本归档说明`);
}
