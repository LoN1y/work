/* =========================================================
 * frameMatch.js — 视频帧精确比对核心
 *
 * 原理：
 *  1) 把用户上传的截图缩放为 64x64 灰度图 A
 *  2) 把视频按 fps=1 抽成 64x64 灰度帧序列，用 dHash + NCC 与 A 比对
 *     → 粗定位到"第几秒"
 *  3) 在该秒前后 ±2 秒按 fps=20 精抽帧，再比对 → 精确到 0.05 秒
 *  4) 返回精确时刻、相似度、匹配帧缩略图(base64)
 *
 * 这是像素级真实比对，不依赖 AI 猜测。
 * ========================================================= */
const { execFile } = require("child_process");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const fs = require("fs");
const path = require("path");

const FRAME_SIZE = 64;            // 比对分辨率 64x64
const FRAME_BYTES = FRAME_SIZE * FRAME_SIZE; // 每帧字节数(gray)
const MAX_SCAN_SECONDS = 1800;    // 粗定位最多扫描 30 分钟，防止超大视频卡死

function runFFmpeg(args, maxBuffer = 200 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { maxBuffer, encoding: "buffer" }, (err, stdout, stderr) => {
      // ffmpeg 即使返回非零，只要 stdout 有帧数据也可继续（例如末尾截断）
      if (err && !stdout?.length) {
        return reject(new Error((stderr?.toString() || err.message).slice(-500)));
      }
      resolve({ stdout: stdout || Buffer.alloc(0), stderr: stderr?.toString() || "" });
    });
  });
}

/** 把一张图片转成 64x64 灰度 Buffer */
async function imageToGray(imgPath) {
  const { stdout } = await runFFmpeg([
    "-v", "error",
    "-i", imgPath,
    "-vf", `scale=${FRAME_SIZE}:${FRAME_SIZE}:force_original_aspect_ratio=disable,format=gray`,
    "-f", "rawvideo", "-pix_fmt", "gray", "-",
  ]);
  if (stdout.length < FRAME_BYTES) throw new Error("截图解析失败，请确认是有效图片");
  return stdout.subarray(0, FRAME_BYTES);
}

/**
 * 从视频抽取灰度帧序列
 * @param {string} videoPath
 * @param {number} fps 抽帧率
 * @param {number} ss 起始秒(可选)
 * @param {number} t 持续秒(可选)
 * @returns {{frames: Buffer[], times: number[]}}
 */
async function extractFrames(videoPath, fps, ss = null, t = null) {
  const vfParts = [`fps=${fps}`, `scale=${FRAME_SIZE}:${FRAME_SIZE}:force_original_aspect_ratio=disable`, "format=gray", "showinfo"];
  const args = ["-v", "info"];
  if (ss !== null) args.push("-ss", String(ss));
  args.push("-i", videoPath);
  if (t !== null) args.push("-t", String(t));
  args.push("-vf", vfParts.join(","), "-f", "rawvideo", "-pix_fmt", "gray", "-");

  const { stdout, stderr } = await runFFmpeg(args);
  const frameCount = Math.floor(stdout.length / FRAME_BYTES);
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    frames.push(stdout.subarray(i * FRAME_BYTES, (i + 1) * FRAME_BYTES));
  }
  // 解析 showinfo 的 pts_time 作为真实时间戳
  const times = [];
  const re = /pts_time:([0-9.]+)/g;
  let m;
  while ((m = re.exec(stderr)) !== null) times.push(parseFloat(m[1]));
  // 兜底：若 showinfo 数量不匹配，用序号/fps 推算
  if (times.length !== frames.length) {
    times.length = 0;
    const start = ss || 0;
    for (let i = 0; i < frames.length; i++) times.push(start + i / fps);
  }
  return { frames, times };
}

/** 计算 dHash（64x64 → 相对哈希），返回 Uint8Array(长度=(63*64)/8 字节) */
function dHash(gray) {
  const W = FRAME_SIZE, H = FRAME_SIZE;
  const bits = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      bits.push(gray[y * W + x] > gray[y * W + x + 1] ? 1 : 0);
    }
  }
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3] |= 1 << (i & 7);
  return bytes;
}

function hamming(a, b) {
  let d = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let v = a[i] ^ b[i];
    while (v) { d += v & 1; v >>= 1; }
  }
  return d;
}

/** 归一化互相关相似度 (0~1，越大越像)，对亮度/对比度变化鲁棒 */
function ncc(a, b) {
  let sa = 0, sb = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  // 纯色/低对比画面：方差接近 0 时 NCC 无意义，回退为均值亮度相似度
  if (da < 1 || db < 1) {
    const diff = Math.abs(ma - mb) / 255;
    return 1 - diff; // 亮度越接近越相似
  }
  return num / Math.sqrt(da * db);
}

/**
 * 对一组帧打分，返回最优 {index, time, score, ncc, ham}
 * score = 0.7*ncc_norm + 0.3*hash_norm  （越大越好）
 */
function bestMatch(frames, times, targetGray, targetHash) {
  let best = null;
  for (let i = 0; i < frames.length; i++) {
    const c = ncc(frames[i], targetGray);
    const ham = hamming(targetHash, dHash(frames[i]));
    const hashNorm = 1 - ham / (FRAME_SIZE * (FRAME_SIZE - 1));
    const score = 0.72 * Math.max(0, c) + 0.28 * hashNorm;
    if (!best || score > best.score) {
      best = { index: i, time: times[i] ?? i, score, ncc: c, ham, hashNorm };
    }
  }
  return best;
}

/**
 * 主入口：在给定视频中定位目标截图的精确时刻
 * @param {string} videoPath 本地视频路径 或 可直链访问的 URL
 * @param {string} imagePath 本地截图路径
 * @param {(p:number,label:string)=>void} onProgress 进度回调
 */
async function locateMoment(videoPath, imagePath, onProgress = () => {}) {
  onProgress(5, "解析截图特征");
  const targetGray = await imageToGray(imagePath);
  const targetHash = dHash(targetGray);

  onProgress(15, "粗扫描视频帧（每秒 1 帧）");
  const coarse = await extractFrames(videoPath, 1);
  if (!coarse.frames.length) throw new Error("未能从视频中读取到帧，请确认视频可正常播放");
  const totalFrames = coarse.frames.length;
  const scanCap = Math.min(totalFrames, MAX_SCAN_SECONDS);
  onProgress(45, `已扫描 ${scanCap} 帧，正在比对相似度`);
  const coarseBest = bestMatch(coarse.frames.slice(0, scanCap), coarse.times.slice(0, scanCap), targetGray, targetHash);

  const center = coarseBest.time;
  const ss = Math.max(0, center - 2);
  const duration = 5; // ±2 秒 -> 5 秒窗口

  onProgress(70, "精定位中（每秒 20 帧）");
  const fine = await extractFrames(videoPath, 20, ss, duration);
  if (!fine.frames.length) {
    // 精定位失败则回退到粗定位结果
    return {
      time: center,
      timeFormatted: formatTime(center),
      similarity: Math.round(coarseBest.score * 100),
      precision: "coarse",
      frameDataUrl: null,
      videoDuration: coarse.times[coarse.times.length - 1] || totalFrames,
    };
  }
  const fineBest = bestMatch(fine.frames, fine.times, targetGray, targetHash);

  onProgress(88, "生成匹配帧预览");
  let frameDataUrl = null;
  try {
    const { stdout } = await runFFmpeg([
      "-v", "error", "-ss", String(Math.max(0, fineBest.time - 0.02)),
      "-i", videoPath, "-frames:v", "1", "-vf", "scale=320:-1", "-f", "image2pipe", "-vcodec", "mjpeg", "-",
    ]);
    if (stdout?.length) frameDataUrl = "data:image/jpeg;base64," + stdout.toString("base64");
  } catch (_) { /* 预览失败不影响主结果 */ }

  onProgress(100, "完成");
  return {
    time: Number(fineBest.time.toFixed(2)),
    timeFormatted: formatTime(fineBest.time),
    similarity: Math.round(fineBest.score * 100),
    ncc: Number(fineBest.ncc.toFixed(3)),
    precision: "fine",
    frameDataUrl,
    videoDuration: Number((coarse.times[coarse.times.length - 1] || totalFrames).toFixed(1)),
    coarseTime: Number(center.toFixed(2)),
  };
}

function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = s.toFixed(2).padStart(5, "0");
  return h > 0
    ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${ss}`
    : `${String(m).padStart(2, "0")}:${ss}`;
}

module.exports = { locateMoment, formatTime, imageToGray, extractFrames };
