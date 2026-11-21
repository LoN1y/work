/* =========================================================
 * browserMatch.js — 多片源「浏览器播放 + canvas 抓帧」比对
 *
 * 背景：影视平台片源(腾讯/爱奇艺/B站)多为网页播放器，ffmpeg 无法直读。
 * 思路：用无头 Edge 打开候选片源页，找到 <video>，按时间点 seek，
 *       用 canvas 抓 64x64 灰度帧，复用 frameMatch 的 ncc/dHash 与目标截图比对，
 *       多个片源并发开标签(多开)，谁先高置信命中就返回真实时刻。
 *
 * 依赖：系统已安装的 Microsoft Edge + Node 内置 WebSocket（无 npm 新依赖）。
 * 限制：DRM/强保护视频会黑屏或被污染，抓不到帧时如实返回，不编造。
 * ========================================================= */
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { ncc, dHash, hamming, FRAME_SIZE, formatTime } = require("./frameMatch");

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const DEBUG_PORT = 9333;
const USER_DATA = path.join(os.tmpdir(), "vistrace-browser-match");

let edgeProc = null;
let readyPromise = null;

/** 查找 Edge 可执行文件 */
function findEdge() {
  for (const p of EDGE_CANDIDATES) if (fs.existsSync(p)) return p;
  return null;
}

/** 确保无头 Edge 调试实例已启动 */
async function ensureEdge() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const exe = findEdge();
    if (!exe) throw new Error("未找到 Microsoft Edge，无法启用浏览器播放比对");
    try { fs.mkdirSync(USER_DATA, { recursive: true }); } catch (_) {}
    edgeProc = spawn(exe, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      "--autoplay-policy=no-user-gesture-required", "--mute-audio",
      "--disable-features=TranslateUI", "--window-size=1280,720",
      `--user-data-dir=${USER_DATA}`, `--remote-debugging-port=${DEBUG_PORT}`,
      "about:blank",
    ], { stdio: "ignore", detached: false });
    // 等待调试端口就绪
    for (let i = 0; i < 40; i++) {
      const ok = await httpJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (ok) return true;
      await sleep(250);
    }
    throw new Error("无头浏览器启动超时");
  })();
  return readyPromise;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function httpJson(url, method = "GET") {
  return new Promise((resolve) => {
    const req = http.request(url, { method, timeout: 4000 }, (res) => {
      let d = ""; res.on("data", (c) => (d += c));
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch (_) { resolve(null); } });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.end();
  });
}

/** 新建标签返回 {ws, targetId} */
async function newTab(url = "about:blank") {
  const t = await httpJson(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`, "PUT");
  if (!t || !t.webSocketDebuggerUrl) throw new Error("新建浏览器标签失败");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return { ws, targetId: t.id };
}

function closeTab(targetId) {
  httpJson(`http://127.0.0.1:${DEBUG_PORT}/json/close/${targetId}`).catch(() => {});
}

/** 简易 CDP 调用器 */
function cdpClient(ws) {
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    let x; try { x = JSON.parse(ev.data); } catch (_) { return; }
    if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
  };
  const call = (method, params = {}, timeout = 15000) => new Promise((resolve) => {
    const myId = ++id;
    const timer = setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); resolve({ __timeout: true }); } }, timeout);
    pending.set(myId, (x) => { clearTimeout(timer); resolve(x); });
    try { ws.send(JSON.stringify({ id: myId, method, params })); }
    catch (_) { clearTimeout(timer); pending.delete(myId); resolve({ __error: true }); }
  });
  const evalJs = async (expression, awaitPromise = false, timeout = 15000) => {
    const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }, timeout);
    if (r.__timeout || r.__error || r.result?.exceptionDetails) return null;
    return r.result?.result?.value ?? null;
  };
  return { call, evalJs };
}

/** 把 0-255 灰度数据抽到固定 FRAME_SIZE 并归一化成 0-255 Buffer（供 ncc 用） */
function normalizeGray(arr, srcW, srcH) {
  const out = Buffer.alloc(FRAME_SIZE * FRAME_SIZE);
  if (!arr || arr.length < srcW * srcH) return null;
  for (let y = 0; y < FRAME_SIZE; y++) {
    for (let x = 0; x < FRAME_SIZE; x++) {
      const sx = Math.floor(x * srcW / FRAME_SIZE);
      const sy = Math.floor(y * srcH / FRAME_SIZE);
      out[y * FRAME_SIZE + x] = arr[sy * srcW + sx] & 0xff;
    }
  }
  return out;
}

/**
 * 在单个视频 URL 上定位目标截图的时刻（浏览器 canvas 抓帧版）
 * @param {string} url 片源页面/直链 URL
 * @param {number[]} targetGray 目标截图 64x64 灰度(Buffer/数组)
 * @param {object} opts { coarseStep, fineStep, maxSeconds, onProgress }
 */
async function locateInBrowser(url, targetGray, opts = {}) {
  const coarseStep = opts.coarseStep || 2;   // 粗扫步长(秒)
  const fineStep = opts.fineStep || 0.2;      // 精扫步长(秒)
  const maxSeconds = opts.maxSeconds || 1500; // 单视频最多扫描时长
  const onProgress = opts.onProgress || (() => {});
  const targetHash = dHash(Buffer.from(targetGray));

  const { ws, targetId } = await newTab("about:blank");
  const { call, evalJs } = cdpClient(ws);
  const cleanup = () => { try { ws.close(); } catch (_) {} closeTab(targetId); };

  try {
    // 打开目标页
    const nav = await call("Page.navigate", { url }, 20000);
    if (nav.__timeout) throw new Error("页面打开超时");
    // 等待 video 元素出现并可读
    let vinfo = null;
    for (let i = 0; i < 30; i++) {
      vinfo = await evalJs(`JSON.stringify((()=>{const v=document.querySelector('video');if(!v)return null;return {dur:(isFinite(v.duration)&&v.duration>0)?v.duration:0,w:v.videoWidth,h:v.videoHeight,src:(v.currentSrc||v.src||'').slice(0,60)};})())`);
      if (vinfo) { try { vinfo = JSON.parse(vinfo); } catch (_) { vinfo = null; } }
      if (vinfo && vinfo.w > 0) break;
      await sleep(400);
    }
    if (!vinfo || !vinfo.w) throw new Error("页面无可用视频元素或视频未加载(可能需登录/受保护)");

    const duration = Math.min(vinfo.dur || maxSeconds, maxSeconds);
    const scanLimit = vinfo.dur ? duration : maxSeconds;
    const CW = 64, CH = 36; // canvas 抓帧分辨率(接近16:9)，再抽到64x64
    onProgress(10, `已打开片源，视频时长 ${Math.round(scanLimit)}s`);

    // 注入抓帧函数：seek 到 t 后用 canvas 抓灰度数组
    const grab = async (t) => {
      const js = `(async()=>{
        const v=document.querySelector('video'); if(!v) return null;
        const target=${t};
        if(Math.abs(v.currentTime-target)>0.05){ v.currentTime=target; }
        // 等待 seek 完成
        for(let k=0;k<40;k++){ if(!v.seeking && v.readyState>=2) break; await new Promise(r=>setTimeout(r,50)); }
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const c=document.createElement('canvas'); c.width=${CW}; c.height=${CH};
        const ctx=c.getContext('2d',{willReadFrequently:true});
        try{ ctx.drawImage(v,0,0,${CW},${CH}); const d=ctx.getImageData(0,0,${CW},${CH}).data;
          const g=new Array(${CW}*${CH}); for(let i=0,j=0;i<d.length;i+=4,j++) g[j]=Math.round((d[i]+d[i+1]+d[i+2])/3);
          return JSON.stringify({g});
        }catch(e){ return JSON.stringify({err:String(e&&e.message||e)}); }
      })()`;
      const raw = await evalJs(js, true, 12000);
      if (!raw) return null;
      let o; try { o = JSON.parse(raw); } catch (_) { return null; }
      if (o.err || !o.g) return null;
      return normalizeGray(o.g, CW, CH);
    };

    // 粗扫
    const coarse = [];
    for (let t = 0; t < scanLimit; t += coarseStep) {
      const g = await grab(t);
      if (g) coarse.push({ t, g });
      if (coarse.length % 30 === 0) onProgress(10 + Math.round(50 * t / scanLimit), `粗扫 ${Math.round(t)}/${Math.round(scanLimit)}s`);
    }
    if (!coarse.length) throw new Error("无法从视频抓取画面(可能 DRM 保护或视频未解码)");
    let best = null;
    for (const { t, g } of coarse) {
      const c = ncc(g, targetGray);
      const ham = hamming(targetHash, dHash(g));
      const score = 0.72 * Math.max(0, c) + 0.28 * (1 - ham / (FRAME_SIZE * (FRAME_SIZE - 1)));
      if (!best || score > best.score) best = { t, score, ncc: c };
    }
    onProgress(65, `粗定位 ${best.t.toFixed(1)}s，精扫中`);

    // 精扫
    const ss = Math.max(0, best.t - coarseStep);
    const se = Math.min(scanLimit, best.t + coarseStep);
    let fineBest = { t: best.t, score: best.score, ncc: best.ncc };
    for (let t = ss; t <= se; t += fineStep) {
      const g = await grab(Number(t.toFixed(2)));
      if (!g) continue;
      const c = ncc(g, targetGray);
      const ham = hamming(targetHash, dHash(g));
      const score = 0.72 * Math.max(0, c) + 0.28 * (1 - ham / (FRAME_SIZE * (FRAME_SIZE - 1)));
      if (score > fineBest.score) fineBest = { t, score, ncc: c };
    }
    onProgress(100, "完成");
    return {
      url, time: Number(fineBest.t.toFixed(2)), timeFormatted: formatTime(fineBest.t),
      similarity: Math.round(fineBest.score * 100), ncc: Number(fineBest.ncc.toFixed(3)),
      method: "browser-canvas", videoDuration: Number(scanLimit.toFixed(1)),
    };
  } finally {
    cleanup();
  }
}

/**
 * 多片源并发比对：开多个标签并行播放抓帧，返回最佳匹配
 * @param {string[]} urls 候选片源 URL
 * @param {number[]} targetGray 目标截图灰度
 * @param {object} opts { concurrency, onProgress, coarseStep, maxSeconds }
 */
async function matchMultipleSources(urls, targetGray, opts = {}) {
  await ensureEdge();
  const concurrency = Math.max(1, Math.min(4, opts.concurrency || 3));
  const onProgress = opts.onProgress || (() => {});
  const results = [];
  const queue = urls.slice(0, 8);
  let cursor = 0;

  async function worker() {
    while (cursor < queue.length) {
      const url = queue[cursor++];
      try {
        const r = await locateInBrowser(url, targetGray, {
          coarseStep: opts.coarseStep, maxSeconds: opts.maxSeconds,
          onProgress: (p, label) => onProgress(p, label, url),
        });
        results.push({ ...r, ok: true });
      } catch (e) {
        results.push({ url, ok: false, error: e?.message || String(e) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));

  const ok = results.filter((r) => r.ok).sort((a, b) => b.similarity - a.similarity);
  const MIN_CONFIDENCE = 68; // 低于此相似度视为"抓到画面但未命中"，绝不把低分当真实时刻
  const strong = ok.filter((r) => r.similarity >= MIN_CONFIDENCE);
  const best = strong[0] || null;
  const topScore = ok[0]?.similarity || 0;
  return {
    ok: !!best,
    best,
    results,
    topScore,
    reason: best ? undefined
      : ok.length
        ? `多开抓到了画面，但最高相似度仅 ${topScore}%（低于 ${MIN_CONFIDENCE}% 阈值），无法确认为同一时刻——这些片源很可能不是目标视频`
        : (results[0]?.error || "所有片源均无法自动抓帧，可能需登录或受 DRM 保护"),
  };
}

module.exports = { matchMultipleSources, ensureEdge };
