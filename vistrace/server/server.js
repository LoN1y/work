/* =========================================================
 * server.js — 镜像溯源 VisTrace 视频帧比对服务
 *
 * 路由：
 *   GET  /                       静态托管前端 (与 API 同源，免 CORS)
 *   POST /api/match              上传截图+视频，创建比对任务，返回 jobId
 *   GET  /api/stream/:jobId      SSE 实时推送进度与最终结果
 *   GET  /api/health             健康检查
 *   POST /api/websearch          真实联网搜索（来源溯源）
 *   POST /api/find-sources       影视兜底：片源定向搜索与分类
 *   POST /api/probe-sources      影视兜底：并发探测片源是否可直读
 *   POST /api/resolve-url        探测在线视频 URL 是否可直读
 * ========================================================= */
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const { locateMoment } = require("./frameMatch");
const { webSearch, searchVideoSources } = require("./webSearch");

const app = express();
const PORT = process.env.PORT || 3777;
const FRONT_DIR = path.resolve(__dirname, "..");
const TMP_DIR = path.join(os.tmpdir(), "vistrace-uploads");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: "2mb" }));

/* ---------- 上传配置 ---------- */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || (file.mimetype.startsWith("image") ? ".png" : ".mp4");
    cb(null, crypto.randomBytes(12).toString("hex") + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 800 * 1024 * 1024 }, // 视频上限 800MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const imgExt = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"];
    const vidExt = [".mp4", ".mov", ".mkv", ".webm", ".avi", ".flv", ".m4v", ".ts"];
    const ok = imgExt.includes(ext) || vidExt.includes(ext) ||
      file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/");
    cb(ok ? null : new Error("仅支持图片或视频文件"), ok);
  },
});

/* ---------- 任务存储（内存） ---------- */
const jobs = new Map();

function cleanupFiles(paths) {
  for (const p of paths) {
    if (p && fs.existsSync(p)) { try { fs.unlinkSync(p); } catch (_) {} }
  }
}

/* ---------- 路由 ---------- */
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "vistrace-frame-match", time: Date.now() });
});

/** 真实联网搜索：接收关键词数组，抓取搜索引擎真实结果 */
app.post("/api/websearch", async (req, res) => {
  try {
    const queries = req.body?.queries || [];
    const r = await webSearch(queries);
    res.json(r);
  } catch (e) {
    res.json({ ok: false, results: [], error: e?.message || "联网搜索失败" });
  }
});

/** 探测单个在线 URL 是否可被 ffmpeg 直读（复用函数） */
function probeVideoUrl(url, timeout = 20000) {
  return new Promise((resolve) => {
    if (!/^https?:\/\//i.test(url)) return resolve({ ok: false, reason: "URL 格式不正确" });
    const args = ["-v", "error", "-probesize", "2M", "-analyzeduration", "3M",
      "-i", url, "-t", "0.2", "-f", "null", "-"];
    execFile(ffmpegPath, args, { timeout }, (err) => {
      if (err) {
        const msg = (err.stderr || "").toString().toLowerCase();
        const reason = /403|401|forbidden|unauthor/i.test(msg)
          ? "该链接需要登录或鉴权，无法直接读取"
          : /invalid|protocol|404|not found/i.test(msg)
            ? "链接无效或不是可直接播放的视频文件"
            : "该站点有防盗链限制，建议改用本地上传";
        return resolve({ ok: false, reason });
      }
      resolve({ ok: true, reason: "链接可直读" });
    });
  });
}

/** 探测在线 URL 是否可被 ffmpeg 直读（直链视频可行；需鉴权平台会失败） */
app.post("/api/resolve-url", async (req, res) => {
  const url = (req.body?.url || "").trim();
  res.json(await probeVideoUrl(url));
});

/** 影视兜底：联网搜索片源候选（按可比对性分类） */
app.post("/api/find-sources", async (req, res) => {
  try {
    const queries = req.body?.queries || [];
    const r = await searchVideoSources(queries);
    res.json(r);
  } catch (e) {
    res.json({ ok: false, results: [], counts: {}, error: e?.message || "片源搜索失败" });
  }
});

/** 影视兜底：并发探测多个片源 URL 是否可直读，返回可直读者 */
app.post("/api/probe-sources", async (req, res) => {
  try {
    const urls = (Array.isArray(req.body?.urls) ? req.body.urls : [])
      .map((u) => String(u || "").trim()).filter((u) => /^https?:\/\//i.test(u)).slice(0, 12);
    if (!urls.length) return res.json({ ok: false, readable: [], error: "没有可探测的 URL" });
    const probed = await Promise.all(urls.map(async (url) => ({ url, ...(await probeVideoUrl(url, 12000)) })));
    const readable = probed.filter((p) => p.ok);
    res.json({ ok: readable.length > 0, readable, probed });
  } catch (e) {
    res.json({ ok: false, readable: [], error: e?.message || "探测失败" });
  }
});

/** 创建比对任务 */
app.post("/api/match", upload.fields([
  { name: "screenshot", maxCount: 1 },
  { name: "video", maxCount: 1 },
]), (req, res) => {
  const screenshot = req.files?.screenshot?.[0];
  const videoFile = req.files?.video?.[0];
  const videoUrl = (req.body?.videoUrl || "").trim();

  if (!screenshot) return res.status(400).json({ error: "缺少截图文件" });
  if (!videoFile && !videoUrl) return res.status(400).json({ error: "请上传视频文件或提供视频直链" });

  const jobId = crypto.randomBytes(10).toString("hex");
  jobs.set(jobId, { status: "queued", progress: 0, label: "任务已创建", result: null, error: null });

  // 异步执行比对
  (async () => {
    const job = jobs.get(jobId);
    const toClean = [screenshot.path];
    let videoPath = null;
    try {
      job.status = "running";
      if (videoFile) {
        videoPath = videoFile.path;
        toClean.push(videoPath);
      } else {
        videoPath = videoUrl; // ffmpeg 直接支持 http(s) 输入
      }

      job.label = "开始视频帧比对";
      const result = await locateMoment(videoPath, screenshot.path, (p, label) => {
        job.progress = p;
        job.label = label;
      });

      job.result = result;
      job.progress = 100;
      job.status = "done";
      job.label = "比对完成";
    } catch (e) {
      job.status = "error";
      job.error = e?.message || "比对过程出错";
      job.label = "比对失败";
    } finally {
      // 延迟清理，给前端读取结果的时间
      setTimeout(() => cleanupFiles(toClean), 60_000);
    }
  })();

  res.json({ jobId });
});

/** SSE 推送进度与结果 */
app.get("/api/stream/:jobId", (req, res) => {
  const jobId = req.params.jobId;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let closed = false;
  const send = (obj) => {
    if (!closed) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  const timer = setInterval(() => {
    const job = jobs.get(jobId);
    if (!job) {
      send({ status: "error", error: "任务不存在或已过期" });
      clearInterval(timer); res.end(); return;
    }
    send({ status: job.status, progress: job.progress, label: job.label,
      result: job.result, error: job.error });
    if (job.status === "done" || job.status === "error") {
      clearInterval(timer);
      setTimeout(() => { jobs.delete(jobId); res.end(); }, 300);
    }
  }, 250);

  req.on("close", () => { closed = true; clearInterval(timer); });
});

/* ---------- 静态托管（放在 API 之后） ---------- */
app.use(express.static(FRONT_DIR, { index: "index.html" }));

app.listen(PORT, () => {
  console.log(`[VisTrace] 视频帧比对服务已启动: http://localhost:${PORT}`);
  console.log(`[VisTrace] ffmpeg: ${ffmpegPath}`);
});
