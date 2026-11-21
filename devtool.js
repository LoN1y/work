#!/usr/bin/env node
/* =========================================================
 * devtool.js — VisTrace 安全修改工具
 *
 * 用法：
 *   node devtool.js backup [标签]      备份当前源文件（每次修改前必做）
 *   node devtool.js restore <备份名>   从某个备份恢复（恢复前会自动再备份当前状态）
 *   node devtool.js list               列出所有备份
 *   node devtool.js verify <备份名>    校验某个备份的完整性
 *   node devtool.js note "说明"        追加一条修改记录（修改后必做）
 *
 * 备份保存在 .backup/ 下，每个备份含 MANIFEST.json（SHA256 校验）。
 * ========================================================= */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const BACKUP_DIR = path.join(ROOT, ".backup");
const LOG_FILE = path.join(ROOT, "修改记录.md");

// 纳入备份的源文件（不含 node_modules / 临时测试文件）
const TRACKED = [
  "index.html", "styles.css", "app.js", "启动网站.bat",
  "devtool.js", "backup.bat", "restore.bat", "修改记录.md",
  "server/server.js", "server/frameMatch.js", "server/webSearch.js", "server/browserMatch.js",
  "server/package.json", "server/package-lock.json",
];

const p2 = (n) => String(n).padStart(2, "0");
function nowStr() {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function sanitize(s) {
  return String(s).replace(/[^\w\u4e00-\u9fa5-]/g, "_").slice(0, 40);
}

function appendLog(text) {
  let content = "";
  if (!fs.existsSync(LOG_FILE)) {
    content = "# 修改记录 · 镜像溯源 VisTrace\n\n" +
      "> 每次修改前先备份、修改后在此追加说明。\n" +
      "> 回退：`node devtool.js list` 查看备份 → `node devtool.js restore <备份名>`。\n\n";
  } else {
    content = fs.readFileSync(LOG_FILE, "utf8");
  }
  fs.writeFileSync(LOG_FILE, content + text + "\n", "utf8");
}

function backup(label = "") {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = (label ? sanitize(label) + "_" : "") + stamp();
  const dir = path.join(BACKUP_DIR, name);
  fs.mkdirSync(dir, { recursive: true });

  const files = {};
  for (const rel of TRACKED) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    files[rel] = { sha256: sha256(src), size: fs.statSync(src).size };
  }
  fs.writeFileSync(path.join(dir, "MANIFEST.json"),
    JSON.stringify({ created: nowStr(), label, files }, null, 2), "utf8");

  appendLog(`## ${nowStr()} — ${label || "自动备份"}\n- 备份目录：\` .backup/${name} \`\n- 纳入文件：${Object.keys(files).length} 个`);
  console.log(`✅ 备份完成：.backup/${name}（${Object.keys(files).length} 个文件）`);
  return name;
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) { console.log("暂无备份"); return []; }
  const dirs = fs.readdirSync(BACKUP_DIR)
    .filter((d) => fs.existsSync(path.join(BACKUP_DIR, d, "MANIFEST.json")))
    .sort((a, b) => {
      const ma = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, a, "MANIFEST.json"), "utf8")).created;
      const mb = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, b, "MANIFEST.json"), "utf8")).created;
      return mb.localeCompare(ma); // 按创建时间倒序，最新在前
    });
  if (!dirs.length) { console.log("暂无备份"); return []; }
  console.log("可用备份（最新在前）：");
  for (const d of dirs) {
    const m = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, d, "MANIFEST.json"), "utf8"));
    console.log(`  ${d}  ${m.created}  ${m.label || "-"}  (${Object.keys(m.files).length} 文件)`);
  }
  return dirs;
}

function restore(name) {
  const dir = path.join(BACKUP_DIR, name);
  const manifest = path.join(dir, "MANIFEST.json");
  if (!fs.existsSync(manifest)) {
    console.error(`❌ 备份不存在或无效：${name}`);
    process.exit(1);
  }
  // 恢复本身是危险操作：先备份当前状态，保证可逆
  backup("auto-before-restore");
  const { files } = JSON.parse(fs.readFileSync(manifest, "utf8"));
  let count = 0;
  for (const rel of Object.keys(files)) {
    const src = path.join(dir, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    count++;
  }
  appendLog(`## ${nowStr()} — 恢复到 .backup/${name}\n- 已恢复 ${count} 个文件；恢复前的状态已另存备份`);
  console.log(`✅ 已从 .backup/${name} 恢复 ${count} 个文件（恢复前状态已自动备份）`);
}

function verify(name) {
  const dir = path.join(BACKUP_DIR, name);
  const manifest = path.join(dir, "MANIFEST.json");
  if (!fs.existsSync(manifest)) { console.error(`❌ 备份不存在：${name}`); process.exit(1); }
  const { files } = JSON.parse(fs.readFileSync(manifest, "utf8"));
  let bad = 0;
  for (const [rel, info] of Object.entries(files)) {
    const f = path.join(dir, rel);
    const ok = fs.existsSync(f) && sha256(f) === info.sha256;
    console.log(`  ${ok ? "✓" : "✗"} ${rel}`);
    if (!ok) bad++;
  }
  console.log(bad ? `⚠️ ${bad} 个文件校验失败，备份可能损坏` : "✅ 全部文件校验通过");
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "backup": backup(args.join(" ")); break;
  case "restore":
    if (!args[0]) { console.error("用法: node devtool.js restore <备份名>"); process.exit(1); }
    restore(args[0]); break;
  case "list": listBackups(); break;
  case "verify":
    if (!args[0]) { console.error("用法: node devtool.js verify <备份名>"); process.exit(1); }
    verify(args[0]); break;
  case "note":
    if (!args[0]) { console.error("用法: node devtool.js note \"修改说明\""); process.exit(1); }
    appendLog(`## ${nowStr()} — 修改记录\n- ${args.join(" ")}`);
    console.log("✅ 记录已追加到 修改记录.md");
    break;
  default:
    console.log(`VisTrace 安全修改工具
  node devtool.js backup [标签]      修改前备份
  node devtool.js restore <备份名>   回退到某个备份
  node devtool.js list               列出备份
  node devtool.js verify <备份名>    校验备份完整性
  node devtool.js note "说明"        追加修改记录`);
}
