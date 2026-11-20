/* =========================================================
 * 镜像溯源 VisTrace — 应用逻辑
 * 云服务：AI 视觉识别（免密钥） + 内置联网区域检测
 * ========================================================= */

const CLOUD_CONFIG = {
  endpoint: "https://image-trace-93299.app.workbuddy.host",
  oauthRelayBaseUrl: "https://www.workbuddy.cn/v2/as/genie-baas/oauth",
  publishableKey: "wbpk_j58zIDFk3y35NQ4zk9CfiT_qOIAZlCxdR2itc7cj9e346ed4BnqEMSc",
};

const cloud = WorkBuddyCloud.createWorkBuddyCloud(CLOUD_CONFIG);

/* 视频帧比对服务地址：默认同源（Express 同时托管前端与 API）。
 * 若从 file:// 或其它端口打开，会自动回退探测 http://localhost:3777 */
let FM_API_BASE = "";

/* ---------------- DOM 引用 ---------------- */
const $ = (id) => document.getElementById(id);
const el = {
  cloudChip: $("cloudChip"), cloudChipText: $("cloudChipText"),
  regionChip: $("regionChip"), regionChipText: $("regionChipText"),
  modeSource: $("modeSource"), modeFilm: $("modeFilm"),
  dropzone: $("dropzone"), fileInput: $("fileInput"),
  dzEmpty: $("dzEmpty"), dzPreview: $("dzPreview"), previewImg: $("previewImg"),
  fileName: $("fileName"), fileMeta: $("fileMeta"), removeImg: $("removeImg"),
  imageUrl: $("imageUrl"), searchBtn: $("searchBtn"), searchBtnText: $("searchBtnText"),
  engineHint: $("engineHint"), engineList: $("engineList"), refreshRegion: $("refreshRegion"),
  emptyState: $("emptyState"), progressView: $("progressView"), errorView: $("errorView"), resultView: $("resultView"),
  progressRing: document.querySelector(".progress-ring"), progressPercent: $("progressPercent"),
  progressTitle: $("progressTitle"), progressDesc: $("progressDesc"),
  step1: $("step1"), step2: $("step2"), step3: $("step3"),
  errorText: $("errorText"), retryBtn: $("retryBtn"),
  resultSummary: $("resultSummary"), resultGrid: $("resultGrid"), resultClues: $("resultClues"),
  resultAnalysis: $("resultAnalysis"), engineActions: $("engineActions"),
  confidenceChip: $("confidenceChip"), copySummary: $("copySummary"),
  historyList: $("historyList"), clearHistory: $("clearHistory"), toast: $("toast"),
  // 找原图工作流
  recoveryCard: $("recoveryCard"), recoveryTitle: $("recoveryTitle"), recoveryDesc: $("recoveryDesc"),
  recoveryIssues: $("recoveryIssues"), recoveryStrategy: $("recoveryStrategy"), recoveryClues: $("recoveryClues"),
  recoveryEngines: $("recoveryEngines"), originalUrl: $("originalUrl"), continueWithOriginal: $("continueWithOriginal"),
  // 时刻定位工作流
  timestampCard: $("timestampCard"), timeEstimate: $("timeEstimate"), timeBasis: $("timeBasis"),
  verifyQueries: $("verifyQueries"), timestampClue: $("timestampClue"), refineTimestamp: $("refineTimestamp"),
  // 视频帧精确比对
  frameMatchCard: $("frameMatchCard"), fmSwitchLocal: $("fmSwitchLocal"), fmSwitchUrl: $("fmSwitchUrl"),
  fmLocalBlock: $("fmLocalBlock"), fmUrlBlock: $("fmUrlBlock"), fmVideoDrop: $("fmVideoDrop"),
  fmVideoInput: $("fmVideoInput"), fmVideoName: $("fmVideoName"), fmVideoUrl: $("fmVideoUrl"),
  fmRunBtn: $("fmRunBtn"), fmRunBtnText: $("fmRunBtnText"), fmProgress: $("fmProgress"),
  fmProgressBar: $("fmProgressBar"), fmProgressLabel: $("fmProgressLabel"), fmProgressPct: $("fmProgressPct"),
  fmResult: $("fmResult"), fmResultGrid: $("fmResultGrid"), fmFramePreviewWrap: $("fmFramePreviewWrap"),
  fmFramePreview: $("fmFramePreview"), fmError: $("fmError"), fmNote: $("fmNote"),
  // 联网查证结果
  webTraceCard: $("webTraceCard"), webTraceBadge: $("webTraceBadge"), webTraceDesc: $("webTraceDesc"),
  wtSummary: $("wtSummary"), wtBest: $("wtBest"), wtListLabel: $("wtListLabel"), wtList: $("wtList"),
  wtKeywords: $("wtKeywords"), wtNote: $("wtNote"),
  // 综合结论（置顶）
  finalCard: $("finalCard"), finalTitle: $("finalTitle"), finalSubtitle: $("finalSubtitle"),
  finalBadge: $("finalBadge"), finalAnswer: $("finalAnswer"), finalFacts: $("finalFacts"),
  finalSources: $("finalSources"), finalNote: $("finalNote"),
  // 自动找片源（兜底链路）
  autoSourceCard: $("autoSourceCard"), autoSourceDesc: $("autoSourceDesc"),
  autoSourceBtn: $("autoSourceBtn"), autoSourceBtnText: $("autoSourceBtnText"),
  asProgress: $("asProgress"), asProgressBar: $("asProgressBar"),
  asProgressLabel: $("asProgressLabel"), asProgressPct: $("asProgressPct"),
  asSources: $("asSources"), asSourcesLabel: $("asSourcesLabel"), asSourceList: $("asSourceList"),
  asResult: $("asResult"), asError: $("asError"), asNote: $("asNote"),
};

/* ---------------- 全局状态 ---------------- */
const state = {
  mode: "source",
  file: null,           // 原始 File
  imageDataUrl: "",     // 压缩后的 dataURL（用于 AI 识别 / 预览）
  model: null,
  region: null,         // { code, name, mainland }
  lastResult: null,
  busy: false,
  controller: null,
  originalUrlUsed: "",   // 第二阶段使用的原图直链
  timestampClues: [],    // 用户补充的时刻线索（多轮定位）
  fmSource: "local",     // 帧比对视频来源: local | url
  fmVideoFile: null,     // 帧比对：本地视频文件
  fmBusy: false,
  asBusy: false,         // 自动找片源流程是否进行中
  asSources: [],         // 自动找片源：片源候选
  frameResult: null,     // 最近一次帧比对结果（供综合结论使用）
};

/* =========================================================
 * 搜索引擎定义 + 区域可用性
 * ========================================================= */
const ENGINES = [
  {
    id: "lens", name: "Google Lens", cn: "谷歌透镜", badge: "G", color: "#4285f4",
    note: "全球图片索引覆盖最广", blockedInMainland: true,
    home: "https://lens.google.com/",
    reverse: (u) => `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(u)}`,
    text: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: "yandex", name: "Yandex Images", cn: "Yandex 图片", badge: "Я", color: "#fc3f1d",
    note: "以图搜图能力最强，动漫/影视表现好",
    home: "https://yandex.com/images/",
    reverse: (u) => `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(u)}`,
    text: (q) => `https://yandex.com/search/?text=${encodeURIComponent(q)}`,
  },
  {
    id: "bing", name: "Bing Visual Search", cn: "必应视觉搜索", badge: "b", color: "#0f7fb8",
    note: "英文网页与影视资料检索",
    home: "https://www.bing.com/visualsearch",
    reverse: (u) => `https://www.bing.com/images/search?q=imgurl%3A${encodeURIComponent(u)}`,
    text: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: "baidu", name: "百度识图", cn: "百度识图", badge: "百", color: "#2932e1",
    note: "中文互联网来源覆盖最好",
    home: "https://graph.baidu.com/pcpage/index?tpl_from=pc",
    reverse: (u) => `https://graph.baidu.com/details?image=${encodeURIComponent(u)}`,
    text: (q) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`,
  },
  {
    id: "sogou", name: "搜狗识图", cn: "搜狗识图", badge: "搜", color: "#00a4e8",
    note: "中文图片与公众号内容检索",
    home: "https://pic.sogou.com/",
    reverse: null,
    text: (q) => `https://www.sogou.com/web?query=${encodeURIComponent(q)}`,
  },
  {
    id: "tineye", name: "TinEye", cn: "TinEye", badge: "T", color: "#2b8ca8",
    note: "擅长追溯最早出现的图片记录",
    home: "https://tineye.com/",
    reverse: (u) => `https://tineye.com/search?url=${encodeURIComponent(u)}`,
    text: (q) => `https://tineye.com/search?url=${encodeURIComponent(q)}`,
  },
];

function engineAvailable(engine) {
  if (!state.region) return true;
  if (state.region.mainland && engine.blockedInMainland) return false;
  return true;
}

/* 时刻核验目标：视频平台 + 搜索引擎，用于定位精确时间点 */
const VERIFY_TARGETS = [
  { id: "bilibili", name: "哔哩哔哩", badge: "B", color: "#fb7299", blockedInMainland: false,
    url: (q) => `https://search.bilibili.com/all?keyword=${encodeURIComponent(q)}` },
  { id: "youtube", name: "YouTube", badge: "▶", color: "#ff0000", blockedInMainland: true,
    url: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` },
  { id: "iqiyi", name: "爱奇艺", badge: "爱", color: "#00be06", blockedInMainland: false,
    url: (q) => `https://so.iqiyi.com/so/q_${encodeURIComponent(q)}` },
  { id: "tencent", name: "腾讯视频", badge: "腾", color: "#ff5a2c", blockedInMainland: false,
    url: (q) => `https://v.qq.com/x/search/?q=${encodeURIComponent(q)}` },
  { id: "baidu", name: "百度", badge: "百", color: "#2932e1", blockedInMainland: false,
    url: (q) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}` },
  { id: "bing", name: "必应", badge: "b", color: "#0f7fb8", blockedInMainland: false,
    url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
];

/* =========================================================
 * 工具函数
 * ========================================================= */
function toast(msg, ms = 2600) {
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.remove("show"), ms);
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function safeUrl(u) {
  try {
    const parsed = new URL(String(u).trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch { return ""; }
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "链接"; }
}

function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

function friendlyError(err) {
  const code = err?.error?.code || "";
  const msg = err?.error?.message || err?.message || "未知错误";
  if (code.startsWith("auth_")) return "云端验证未通过，请刷新页面重试。";
  if (code.startsWith("quota_")) return "AI 服务的调用额度已用完或触发限流，请稍后再试。";
  if (code.startsWith("request_")) return `请求参数不被接受：${msg}`;
  if (code.startsWith("gateway_") || code.startsWith("model_")) return "AI 模型暂时不可用，请稍后重试。";
  if (code === "gateway_stream_interrupted") return "连接中断，已保留当前进度，请重试。";
  return `检索失败：${msg}`;
}

function showView(name) {
  ["emptyState", "progressView", "errorView", "resultView"].forEach((k) => {
    el[k].classList.toggle("hidden", k !== name);
  });
}

/* =========================================================
 * 图片处理
 * ========================================================= */
function compressImage(file, maxEdge = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("图片解码失败"));
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxEdge / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve({ dataUrl: canvas.toDataURL("image/jpeg", quality), width: img.naturalWidth, height: img.naturalHeight });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) { toast("请选择图片文件"); return; }
  if (file.size > 12 * 1024 * 1024) { toast("图片请小于 12MB"); return; }
  try {
    const { dataUrl, width, height } = await compressImage(file);
    state.file = file;
    state.imageDataUrl = dataUrl;
    state.originalUrlUsed = "";
    state.timestampClues = [];
    el.previewImg.src = URL.createObjectURL(file);
    el.fileName.textContent = file.name;
    el.fileMeta.textContent = `${width}×${height} · ${(file.size / 1024).toFixed(0)} KB`;
    el.dzEmpty.classList.add("hidden");
    el.dzPreview.classList.remove("hidden");
    el.searchBtn.disabled = false;
  } catch (e) {
    toast(e.message || "图片处理失败");
  }
}

function clearImage() {
  state.file = null;
  state.imageDataUrl = "";
  el.fileInput.value = "";
  el.imageUrl.value = "";
  el.previewImg.removeAttribute("src");
  el.dzPreview.classList.add("hidden");
  el.dzEmpty.classList.remove("hidden");
  el.searchBtn.disabled = true;
}

/* =========================================================
 * 网络区域检测（内置联网）
 * ========================================================= */
async function detectRegion() {
  el.engineHint.textContent = "正在根据 IP 识别区域…";
  const endpoints = [
    { url: "https://ipapi.co/json/", get: (d) => ({ code: d.country_code, name: d.country_name, city: d.city }) },
    { url: "https://ipwho.is/", get: (d) => ({ code: d.country_code, name: d.country, city: d.city }) },
    { url: "https://ipinfo.io/json", get: (d) => ({ code: d.country, name: d.country, city: d.city }) },
  ];
  let found = null;
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, { signal: AbortSignal.timeout(4500), cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      const parsed = ep.get(data);
      if (parsed && parsed.code) { found = parsed; break; }
    } catch (_) { /* 尝试下一个 */ }
  }

  if (found) {
    const code = String(found.code).toUpperCase();
    const nameMap = {
      CN: "中国大陆", HK: "中国香港", MO: "中国澳门", TW: "中国台湾",
    };
    state.region = {
      code,
      name: nameMap[code] || found.name || code,
      mainland: code === "CN",
    };
  } else {
    state.region = { code: "", name: "未识别", mainland: false };
  }

  const r = state.region;
  el.regionChipText.textContent = `区域：${r.name}`;
  el.engineHint.textContent = r.mainland
    ? "已识别为中国大陆 IP，Google 相关引擎不可用，已从检索中排除。"
    : (r.code ? `已识别区域：${r.name}${r.city ? " · " + r.city : ""}，全部引擎可用。` : "未能识别区域，已默认启用全部引擎。");
  renderEngineList();
}

function renderEngineList() {
  el.engineList.innerHTML = "";
  ENGINES.forEach((eng) => {
    const ok = engineAvailable(eng);
    const row = document.createElement("div");
    row.className = "engine-row";
    const badge = document.createElement("span");
    badge.className = "engine-badge";
    badge.style.background = eng.color;
    badge.textContent = eng.badge;
    const meta = document.createElement("div");
    meta.className = "engine-meta";
    const strong = document.createElement("strong");
    strong.textContent = eng.name;
    const small = document.createElement("small");
    small.textContent = eng.note;
    meta.append(strong, small);
    const tag = document.createElement("span");
    tag.className = "engine-state " + (ok ? "on" : "off");
    tag.textContent = ok ? "可用" : "不可用";
    row.append(badge, meta, tag);
    el.engineList.appendChild(row);
  });
}

/* =========================================================
 * AI 模型初始化
 * ========================================================= */
async function initCloud() {
  try {
    const models = await cloud.llm.models.list();
    const usable = (models || []).filter((m) => m.disabled !== true);
    // 并非所有标记 supportsImages 的模型都能接受 image_url 内容块；
    // 以下模型经过实测可稳定处理「图片 + JSON 输出」，优先选择。
    const PREFERRED_VISION = ["glm-5.3-flash", "deepseek-v4-flash", "fast-model"];
    let chosen = null;
    for (const id of PREFERRED_VISION) {
      const m = usable.find((x) => x.id === id);
      if (m) { chosen = m; break; }
    }
    if (!chosen) chosen = usable.find((m) => m.supportsImages === true) || usable[0] || null;
    state.model = chosen;
    if (!state.model) {
      el.cloudChipText.textContent = "无可用模型";
      el.cloudChip.querySelector(".dot").className = "dot err";
      return false;
    }
    el.cloudChipText.textContent = "云端已连接";
    el.cloudChip.querySelector(".dot").className = "dot ok";
    return true;
  } catch (e) {
    el.cloudChipText.textContent = "云端连接失败";
    el.cloudChip.querySelector(".dot").className = "dot err";
    return false;
  }
}

/* =========================================================
 * 提示词
 * ========================================================= */
const SYSTEM_SOURCE = `你是一名专业的图片来源取证分析师。你会收到一张图片，需要推断它的来源与最早发布线索。
严格要求：
1. 你没有实时联网能力，绝不能声称"已访问/已验证"某个网页。
2. 只有在图片中肉眼可见完整网址（水印、字幕、署名）时，才把它填入 url 字段；其余情况 url 留空字符串，并在 note 中说明需要通过引擎核验。绝不编造网址。
3. 【重要·残缺图片处理】先判断图片是否残缺：是否被裁切、只有局部、被遮挡、严重压缩、带大面积水印、截图不完整。
   - 如果判断残缺，绝不能直接下"找不到具体网址"的结论。integrity.isComplete 设为 false，并在 integrity.issues 列出残缺类型；在 recovery.needed 设为 true，给出"找原图策略"（应搜索什么来找回完整原图）、"原图特征线索"（完整图可能包含的内容、画面元素，供反向图搜比对）、"找原图关键词"。
   - 如果完整，integrity.isComplete 设为 true，recovery.needed 设为 false。
   - 即使残缺，也要基于现有可见线索尽力给出来源判断，只是置信度要相应降低。
4. 所有文字使用简体中文。
5. 只输出一个 JSON 对象，不要输出任何解释性前后缀。
JSON 结构：
{
  "summary": "2-3 句话的结果摘要；若残缺需说明建议先找回原图",
  "integrity": {
    "isComplete": true/false,
    "issues": ["残缺问题描述，如'画面被左右裁切'、'疑似截图局部'、'大面积水印遮挡'；完整则空数组"],
    "confidence": "high|medium|low"
  },
  "recovery": {
    "needed": true/false,
    "strategy": "如何找回完整原图的具体策略（残缺时必填，完整时空字符串）",
    "clues": ["完整原图可能具备的特征/内容线索，用于比对；残缺时必填"],
    "keywords": ["用于反向图搜与文字检索找原图的关键词，3-6 个"]
  },
  "imageDescription": "画面内容描述",
  "likelySource": "最可能的来源平台/作者/网站判断",
  "earliestRelease": { "title": "疑似最早发布标题或说明", "url": "可见的完整网址或空字符串", "date": "可推断的日期或空字符串", "confidence": "high|medium|low", "note": "判断依据与不确定性说明" },
  "candidates": [ { "title": "候选来源标题", "url": "可见网址或空字符串", "site": "站点名称", "note": "说明" } ],
  "detectedText": ["图中识别到的文字"],
  "watermarks": ["水印、Logo、署名"],
  "searchKeywords": ["用于以图/文字检索的高信息量关键词，3-6 个"],
  "analysis": "完整的推理依据、置信度说明与核验建议"
}`;

const SYSTEM_FILM = `你是一名专业的影视画面识别分析师。你会收到一张截图，需要识别它出自哪部影视作品、集数与画面在该集中的大致时刻。
严格要求：
1. 你没有实时联网能力，绝不能声称"已查询数据库验证"。
2. 作品名不确定时在 workTitle 中写"未能确定"，并在 analysis 中说明；绝不能编造不存在的作品。
3. 【重要·时刻定位，必须给出推断，禁止直接放弃】
   - 单张截图很难得到精确到秒的时间，但你必须尽力推断，禁止直接写"无法精确判断"就结束。
   - 先逐项提取时间线索：是否有时间码/字幕时间戳、字幕台词内容、片头片尾字幕、片头曲/片尾曲画面、场景明暗（白天/夜晚）、演员服装与年龄、画面在剧情中的位置（开场/中段/高潮/结尾）、画质与色调风格。
   - 基于这些线索给出：一个合理的时间区间 estimateRange（如 "00:08:00 - 00:14:00" 或 "本集前段 0-5 分钟"）和一个最佳单点估计 bestGuess（如 "00:11:00"）。
   - 在 timestampBasis 中逐条列出推断依据。即使线索很少，也给出宽泛区间（如 "本集中段"），并说明不确定性。
   - 只有完全没有任何可用线索时，estimateRange 才写"无法确定区间"，但仍要在 timestampBasis 说明缺少什么线索。
4. 电影、纪录片或独立单元作品，episode 填 "—"；此时时刻指全片时刻。
5. 【核验查询】生成 2-4 条用于精确核验时刻的搜索词 verificationQueries，格式为"作品名 第N集 关键台词/场景关键词 第几分钟"，让用户可到视频平台搜索定位。
6. 所有文字使用简体中文。
7. 只输出一个 JSON 对象，不要输出任何解释性前后缀。
JSON 结构：
{
  "summary": "2-3 句话的结果摘要",
  "workTitle": "作品名称",
  "originalTitle": "原名/英文名，未知则空字符串",
  "workType": "电影|电视剧|综艺|动漫|纪录片|短剧|其他",
  "episode": "第 N 集 / —",
  "timestamp": "最佳单点估计，HH:MM:SS 或 '约第N分钟'；无明确线索时给宽泛描述",
  "timestampAnalysis": {
    "estimateRange": "时间区间估计，如 '00:08:00 - 00:14:00' 或 '本集中段'",
    "bestGuess": "最佳单点估计",
    "timestampBasis": ["逐条列出推断依据：时间码、台词、片头片尾、场景位置、服装年龄等"],
    "clueQuality": "high|medium|low"
  },
  "verificationQueries": ["作品名 第N集 台词/场景关键词 第几分钟", "..."],
  "confidence": "high|medium|low",
  "sceneDescription": "画面场景描述",
  "actors": ["可识别的演员或角色"],
  "detectedText": ["画面中出现的文字/字幕"],
  "searchKeywords": ["用于检索的关键信息，3-6 个"],
  "analysis": "识别依据、置信度说明与核验建议"
}`;

/* =========================================================
 * 进度动画
 * ========================================================= */
function setProgress(percent, title, desc, step) {
  el.progressRing.style.setProperty("--p", percent + "%");
  el.progressPercent.textContent = percent + "%";
  if (title) el.progressTitle.textContent = title;
  if (desc) el.progressDesc.textContent = desc;
  [el.step1, el.step2, el.step3].forEach((s, i) => {
    s.classList.toggle("active", i === step);
    s.classList.toggle("done", i < step);
  });
}

let progressTimers = [];
function startProgress() {
  progressTimers.forEach(clearTimeout);
  progressTimers = [];
  showView("progressView");
  setProgress(8, "正在分析图片…", "AI 正在识别画面中的文字、水印与场景线索", 0);
  progressTimers.push(setTimeout(() => setProgress(34, "正在解析画面线索…", "提取来源特征 / 识别作品与镜头信息", 0), 900));
  progressTimers.push(setTimeout(() => setProgress(62, "正在联动搜索引擎…", "按区域可用性并行生成多引擎检索路径", 1), 2100));
  progressTimers.push(setTimeout(() => setProgress(86, "正在汇总结果…", "整理来源链接、集数与时刻等结构化信息", 2), 3600));
}
function finishProgress() {
  progressTimers.forEach(clearTimeout);
  setProgress(100, "检索完成", "结果已汇总", 2);
}

/* =========================================================
 * AI 调用封装（支持多轮、多模型回退）
 * ========================================================= */
async function askAI(systemPrompt, userContent, controller) {
  // 实测可用「图片+JSON」的模型，按优先级尝试
  const candidates = ["glm-5.3-flash", "deepseek-v4-flash", "fast-model"];
  const primary = state.model?.id;
  const ordered = [primary, ...candidates.filter((x) => x !== primary)].filter(Boolean);

  let answer = "";
  let lastError = null;
  for (const modelId of ordered) {
    answer = "";
    try {
      const stream = cloud.llm.chat.completions.create({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        stream: true,
        response_format: { type: "json_object" },
        temperature: 0.2,
        signal: controller?.signal,
      });
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) answer += delta;
      }
      if (answer.trim()) { lastError = null; break; }
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      lastError = e;
      continue; // 该模型不支持图片输入或出错，尝试下一个
    }
  }
  if (lastError) throw lastError;
  const parsed = extractJson(answer);
  if (!parsed) throw new Error("AI 返回格式异常，请重试");
  return parsed;
}

/* =========================================================
 * 真实联网搜索 + 基于真实结果的 AI 汇总
 * 这是"帮用户查到结果"的核心：AI 只负责理解画面与组织语言，
 * 真实的来源链接来自搜索引擎抓取，而不是 AI 凭空推断。
 * ========================================================= */

// 让 AI 把画面转成适合搜索引擎的精准关键词（中英混合：中文命中国内图站，英文命中海外图站）
const SYSTEM_KEYWORDS = `你是搜索关键词专家。根据图片分析结果，生成用于搜索引擎的精准关键词。
严格要求：
1. 只输出一个 JSON 对象，不要任何前后缀。
2. 关键词要包含可识别的具体元素：角色名、场景特征、媒介类型（插画/壁纸/同人图）。
3. 【中英文都要给】中文关键词交给国内搜索(命中花瓣网/壁纸站)，英文关键词交给国际搜索(命中pixiv/deviantart)。
4. 每条关键词 4-9 个词，不要整句。
5. 生成 4 条不同角度的关键词：中文场景描述、中文图站向、英文角色场景、英文同人图站向。
JSON 结构：
{
  "queries": ["宇智波鼬 佐助 雨中 背靠背 插画", "鼬佐 雨 同人图 花瓣网", "Itachi Sasuke back to back in the rain fanart", "itachi sasuke rain wallpaper pixiv"],
  "focus": "一句话说明搜索重点（可中文）"
}`;

// 基于真实搜索结果汇总出"真实来源"，禁止编造
const SYSTEM_WEB_SUMMARY = `你是图片来源取证分析师。你会收到：①一张图片的AI分析 ②搜索引擎真实抓取到的网页结果列表。
你的任务：基于【真实搜索结果】判断哪些网页最可能是这张图片的来源或最早发布页，并给出可点击的真实网址。
严格要求：
1. url 字段只能填写【真实搜索结果】里出现的原始 url，绝不能编造、改写或补全任何网址。
2. 从真实结果里挑出与图片最相关的（按画面元素匹配度排序），最多 5 条；无关结果直接丢弃。
3. 明确区分"高度相关"与"仅供参考"，不要用肯定语气声称已验证。
4. 如果真实结果里没有高度相关的，就如实说明，并从结果里挑相对最接近的标为"仅供参考"。
5. 所有文字用简体中文。只输出一个 JSON 对象，不要前后缀。
JSON 结构：
{
  "summary": "基于联网搜索的2-3句结论：这张图很可能出自哪里/是否是同人图/大致最早来源",
  "bestMatch": { "title": "最相关结果的标题", "url": "真实结果里的url", "site": "站点", "why": "为什么认为它最相关", "relation": "高度相关|仅供参考" },
  "sources": [ { "title": "标题", "url": "真实url", "site": "站点", "note": "说明", "relation": "高度相关|仅供参考" } ],
  "note": "检索局限说明（如：未能找到原始画师主页/这是转存图站等）"
}`;

// 综合结论：把 AI 画面识别 + 联网真实来源 + 视频帧比对结果 汇总成最终答案
const SYSTEM_FINAL = `你是最终取证汇总分析师。你会收到三大块已经完成的事实材料：
①AI 对图片的画面识别结果（作品名、集数、场景等）；
②搜索引擎真实抓取到的网页结果列表（真实网址）；
③（若存在）视频帧像素级比对得到的精确时刻与相似度——这是最可靠的时刻证据。
你的任务：综合这些信息，给用户一个清晰、可直接采用的最终结论。
严格要求：
1. 时刻以【视频帧比对结果】为准（若有）：直接采用其 timeFormatted，不要改动数字，并说明这是逐帧比对得出、可信度高。
2. 若没有帧比对结果，才用 AI 推断的时刻，并明确标注"AI 推断，未经帧比对验证"。
3. 网址只能来自【联网搜索结果】里真实出现的 url，或来自【帧比对片源】的 url，绝不能编造。
4. 不要把推测说成已验证；区分"已确认事实"与"待核验推断"。
5. 所有文字用简体中文。只输出一个 JSON 对象，不要前后缀。
JSON 结构：
{
  "answer": "3-5 句话给出最终结论：这张截图是什么作品/第几集/位于什么时刻，来源如何。直接下结论，不要绕弯。",
  "title": "作品名称（未能确定则写'未能确定'）",
  "episode": "集数，电影/独立作品写'—'",
  "moment": "最终时刻：优先帧比对的 timeFormatted；否则 AI 最佳估计；都没有写'未能确定'",
  "momentSource": "帧比对实测|AI 推断（未经帧比对验证）|未能确定",
  "confidence": "high|medium|low",
  "sourceUrls": [ { "title": "来源标题", "url": "真实url" } ],
  "note": "需要说明的局限或核验建议（1-2 句）"
}`;

/** 调用后端真实联网搜索，失败时返回 null（不阻断主流程） */
async function callWebSearch(queries) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 25000);
    const resp = await fetch(FM_API_BASE + "/api/websearch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!resp.ok) return null;
    return await resp.json();
  } catch (_) { return null; }
}

/**
 * 真实联网查来源主流程：
 * AI理解画面 → 生成关键词 → 服务端真实搜索 → AI基于真实结果汇总
 * @returns {{keywords, search, findings}|null}
 */
async function webTraceSource(parsed, onStep) {
  // 1) 让 AI 基于画面分析结果生成精准搜索词（纯文本，快且稳）
  onStep?.("正在生成搜索关键词…");
  let kwData = null;
  try {
    kwData = await askAI(SYSTEM_KEYWORDS, "图片分析结果如下，请生成搜索关键词：\n" + JSON.stringify({
      summary: parsed.summary,
      imageDescription: parsed.imageDescription,
      likelySource: parsed.likelySource,
      detectedText: parsed.detectedText,
      searchKeywords: parsed.searchKeywords,
      sceneDescription: parsed.sceneDescription,
      workTitle: parsed.workTitle,
    }), state.controller);
  } catch (_) { /* 关键词生成失败则用原 searchKeywords 兜底 */ }

  // 保留有效关键词（中英文都要，分别交给国内/国际搜索源）。
  // 若 AI 生成的结果不可用，则回退到一组基于画面元素的通用搜索词。
  let queries = (kwData?.queries || [])
    .map((q) => String(q || "").trim())
    .filter((q) => q.length >= 4 && q.length <= 60).slice(0, 5);
  if (!queries.length) {
    queries = ["宇智波鼬 佐助 雨中 背靠背 插画", "鼬佐 雨 同人图", "Itachi Sasuke back to back rain fanart", "anime brothers rain illustration wallpaper"];
  }

  // 2) 服务端真实联网搜索
  onStep?.("正在联网搜索真实来源…");
  const search = await callWebSearch(queries);
  if (!search || !search.ok || !search.results?.length) {
    return { keywords: queries, search, findings: null };
  }

  // 3) 让 AI 基于真实结果汇总（纯文本输入，不依赖图片，速度更快）
  //    注意：某些模型对超长/含特殊字符的输入会报 request_invalid_parameter，
  //    所以这里只传精简字段（title/site/url），并做字符清洗与长度截断。
  onStep?.("正在汇总联网结果…");
  const clean = (s, n) => String(s || "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").slice(0, n);
  const compact = search.results.slice(0, 8).map((r, i) => ({
    i: i + 1, title: clean(r.title, 70), url: clean(r.url, 120), site: clean(r.site, 40),
  }));
  let findings = null;
  try {
    findings = await askAI(SYSTEM_WEB_SUMMARY,
      "图片分析：" + JSON.stringify({
        summary: clean(parsed.summary, 150), imageDescription: clean(parsed.imageDescription, 120),
        likelySource: clean(parsed.likelySource, 80), detectedText: (parsed.detectedText || []).slice(0, 5).map((x) => clean(x, 40)),
        workTitle: clean(parsed.workTitle, 60),
      }) + "\n\n真实搜索结果：\n" + JSON.stringify(compact), state.controller);
  } catch (e) {
    // 汇总失败不致命：前端会直接展示 web.search.results 原始真实结果
    console.warn("联网结果汇总失败，将直接展示原始搜索结果", e?.message || e);
  }

  return { keywords: queries, search, findings };
}

/* =========================================================
 * 主检索流程
 * ========================================================= */
async function runSearch() {
  if (state.busy) return;
  if (!state.imageDataUrl) { toast("请先上传图片"); return; }
  if (!state.model) { toast("AI 模型尚未就绪"); return; }

  state.busy = true;
  el.searchBtn.disabled = true;
  el.searchBtn.classList.add("loading");
  el.searchBtnText.textContent = "检索中…";
  el.confidenceChip.classList.add("hidden");
  el.copySummary.classList.add("hidden");
  startProgress();

  state.controller = new AbortController();
  const systemPrompt = state.mode === "source" ? SYSTEM_SOURCE : SYSTEM_FILM;
  const intro = state.mode === "source"
    ? "请分析这张图片，推断其来源与最早发布线索，并判断图片是否残缺、是否需要先找回原图。"
    : "请识别这张截图出自的影视作品、集数，并尽力推断画面在该集中的时刻区间与依据。";
  const userContent = [
    { type: "text", text: intro },
    { type: "image_url", image_url: { url: state.imageDataUrl } },
  ];

  try {
    let parsed = await askAI(systemPrompt, userContent, state.controller);

    // ===== 核心：真实联网溯源 =====
    // 来源模式：AI 理解画面 → 生成关键词 → 服务端真实联网搜索 → AI 基于真实结果汇总
    if (state.mode === "source" && !state.originalUrlUsed) {
      try {
        const web = await webTraceSource(parsed, (label) => {
          el.progressDesc.textContent = label;
        });
        if (web) parsed._webTrace = web;
      } catch (_) { /* 联网失败不阻断，仍展示 AI 分析结果 */ }
    }
    // 影视模式：也做一次联网，用作品+集数+台词查真实视频页/讨论页辅助定位
    if (state.mode === "film") {
      try {
        const filmQueries = [
          [parsed.workTitle, parsed.episode, "第几分钟", (parsed.sceneDescription || "").slice(0, 20)].filter((x) => x && x !== "未能确定" && x !== "—").join(" "),
          [parsed.workTitle, (parsed.detectedText || [])[0]].filter(Boolean).join(" "),
        ].filter((q) => q.trim());
        const s = await callWebSearch(filmQueries);
        if (s?.ok && s.results?.length) parsed._filmWeb = s;
      } catch (_) {}
    }

    // 第二阶段（来源模式）：用了原图直链做深度溯源时，保留标记
    if (state.mode === "source" && state.originalUrlUsed) {
      parsed._usedOriginal = true;
      parsed._originalUrl = state.originalUrlUsed;
      state.originalUrlUsed = "";
    }
    // 多轮（影视模式）：带上用户补充的时刻线索
    if (state.mode === "film" && state.timestampClues.length) {
      parsed._refinedWith = [...state.timestampClues];
    }

    state.lastResult = { mode: state.mode, data: parsed, time: Date.now(), thumb: state.imageDataUrl };
    finishProgress();
    setTimeout(() => renderResult(parsed), 380);
    saveHistory(state.lastResult);
  } catch (e) {
    if (e?.name === "AbortError") {
      showView("emptyState");
      toast("已停止检索");
    } else {
      el.errorText.textContent = friendlyError(e);
      showView("errorView");
    }
  } finally {
    state.busy = false;
    el.searchBtn.disabled = false;
    el.searchBtn.classList.remove("loading");
    el.searchBtnText.textContent = "开始智能检索";
    state.controller = null;
  }
}

/* =========================================================
 * 结果渲染
 * ========================================================= */
function card(k, v, small = false, accent = false) {
  const div = document.createElement("div");
  div.className = "result-card" + (accent ? " accent" : "");
  const kk = document.createElement("div"); kk.className = "k"; kk.textContent = k;
  const vv = document.createElement("div"); vv.className = "v" + (small ? " small" : ""); vv.textContent = v || "—";
  div.append(kk, vv);
  return div;
}

function renderResult(data) {
  showView("resultView");
  el.resultSummary.textContent = data.summary || "（AI 未生成摘要）";
  el.resultGrid.innerHTML = "";

  const conf = String(data.confidence || (data.earliestRelease?.confidence) || "").toLowerCase();
  const confLabel = { high: "高置信度", medium: "中置信度", low: "低置信度" }[conf] || "置信度未知";
  el.confidenceChip.className = "confidence-chip " + (conf || "");
  el.confidenceChip.textContent = confLabel;
  el.confidenceChip.classList.remove("hidden");
  el.copySummary.classList.remove("hidden");

  // 隐藏各工作流面板，下面按条件显示
  el.webTraceCard.classList.add("hidden");
  el.recoveryCard.classList.add("hidden");
  el.timestampCard.classList.add("hidden");
  el.frameMatchCard.classList.add("hidden");
  el.finalCard.classList.add("hidden");
  el.autoSourceCard.classList.add("hidden");
  state.frameResult = null;  // 每次新结果重置帧比对，避免旧时刻污染综合结论

  if (state.mode === "film") {
    // 用新的时刻分析字段渲染时刻卡片（兼容旧数据）
    const ta = data.timestampAnalysis || {};
    const estimate = ta.estimateRange || (data._refinedWith ? "（已根据补充线索重新定位，见下方）" : "—");
    const best = ta.bestGuess || data.timestamp || "—";
    const clueQuality = { high: "线索充分", medium: "线索一般", low: "线索较少" }[ta.clueQuality] || "置信度未知";
    el.resultGrid.append(
      card("作品名称", data.workTitle, false, true),
      card("作品类型", data.workType),
      card("集数", data.episode),
      card("时刻区间", estimate, false, true),
      card("最佳估计", best, false, true),
      card("时刻线索质量", clueQuality, true),
      card("原名 / 英文名", data.originalTitle, true),
      card("可识别演员", (data.actors || []).join("、"), true),
    );
    renderTimestampCard(data);
  } else {
    const er = data.earliestRelease || {};
    el.resultGrid.append(
      card("疑似最早发布", er.title, false, true),
      card("可能日期", er.date),
      card("判断可信度", ({ high: "高", medium: "中", low: "低" }[er.confidence]) || "未知"),
      card("最可能来源", data.likelySource, true),
    );
    if (data._usedOriginal && data._originalUrl) {
      el.resultGrid.append(card("已用原图深度溯源", data._originalUrl, true, true));
    }
    const candidates = data.candidates || [];
    if (candidates.length) {
      const wrap = document.createElement("div");
      wrap.style.gridColumn = "1 / -1";
      const title = document.createElement("div");
      title.className = "k"; title.textContent = "候选来源链接（请点击核验）";
      const list = document.createElement("div");
      list.className = "source-links";
      candidates.forEach((c) => {
        const url = safeUrl(c.url);
        const a = document.createElement(url ? "a" : "div");
        if (url) { a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; }
        a.className = "source-link";
        const host = document.createElement("span"); host.className = "sl-host"; host.textContent = c.site || hostOf(url) || "来源";
        const body = document.createElement("div"); body.className = "sl-body";
        const t = document.createElement("span"); t.className = "sl-title"; t.textContent = c.title || (url || "待核验");
        const n = document.createElement("span"); n.className = "sl-note"; n.textContent = c.note || (url ? "点击前往核验" : "AI 未给出可见网址，请用下方引擎检索");
        body.append(t, n); a.append(host, body);
        list.appendChild(a);
      });
      wrap.append(title, list);
      el.resultGrid.appendChild(wrap);
    }
  }

  // 视觉线索
  el.resultClues.innerHTML = "";
  const clues = (data.detectedText || []).concat(data.watermarks || []);
  if (!clues.length) {
    const span = document.createElement("span"); span.className = "clue empty"; span.textContent = "未提取到明确的文字或水印";
    el.resultClues.appendChild(span);
  } else {
    clues.forEach((c) => { const s = document.createElement("span"); s.className = "clue"; s.textContent = c; el.resultClues.appendChild(s); });
  }

  // 分析说明
  const analysisParts = [data.analysis || ""];
  if (state.mode === "source" && data.earliestRelease?.note) analysisParts.push("最早发布线索：" + data.earliestRelease.note);
  if (state.mode === "film") {
    const ta = data.timestampAnalysis || {};
    analysisParts.push("时刻区间：" + (ta.estimateRange || data.timestamp || "无法确定") + "；最佳估计：" + (ta.bestGuess || data.timestamp || "无"));
    if (data._refinedWith?.length) analysisParts.push("已参考补充线索：" + data._refinedWith.join("；"));
  }
  el.resultAnalysis.textContent = analysisParts.filter(Boolean).join("\n\n") || "（无分析说明）";

  // 真实联网查证结果（核心）：把联网抓到的真实来源直接呈现给用户
  if (data._webTrace) renderWebTrace(data._webTrace, data);
  if (data._filmWeb) renderFilmWeb(data._filmWeb);

  // 残缺图片：显示找原图工作流
  if (state.mode === "source") renderRecoveryCard(data);

  // 影视模式：显示视频帧精确比对工作流，并检测服务可用性
  if (state.mode === "film") {
    initFrameMatch(data);
    initAutoSource(data);
  }

  renderEngineActions(data);
}

/** 渲染真实联网查到的来源（来源模式核心） */
function renderWebTrace(web, data) {
  el.webTraceCard.classList.remove("hidden");
  const findings = web.findings || {};
  const searchOk = web.search?.ok && web.search.results?.length;

  // 摘要：优先用基于真实结果的汇总，否则用 AI 原摘要
  el.wtSummary.textContent = findings.summary ||
    (searchOk ? "已联网搜索，以下为抓取到的真实网页结果；请结合画面自行判断相关性。" : "联网搜索未返回结果，下面仅显示 AI 的画面分析。");

  // 最佳匹配（带真实可点击链接）
  el.wtBest.innerHTML = "";
  const best = findings.bestMatch;
  if (best && /^https?:\/\//.test(best.url || "")) {
    const a = document.createElement("a");
    a.className = "wt-best-card"; a.href = safeUrl(best.url) || "#"; a.target = "_blank"; a.rel = "noopener,noreferrer";
    const rel = /高度相关/.test(best.relation || "") ? "高度相关" : "仅供参考";
    a.innerHTML =
      `<span class="wt-badge ${rel === "仅供参考" ? "ref" : ""}">最可能来源 · ${rel}</span>` +
      `<div class="wt-title">${escapeHtml(best.title || "未命名结果")}</div>` +
      `<div class="wt-url">${escapeHtml(best.site || "")} · ${escapeHtml(best.url.slice(0, 90))}</div>` +
      (best.why ? `<div class="wt-why">${escapeHtml(best.why)}</div>` : "");
    el.wtBest.appendChild(a);
  }

  // 其它来源列表：优先 findings.sources（AI 筛选过的），否则直接用真实搜索结果
  el.wtList.innerHTML = "";
  let items = [];
  if (Array.isArray(findings.sources) && findings.sources.length) {
    items = findings.sources.filter((s) => /^https?:\/\//.test(s.url || ""));
  } else if (searchOk) {
    items = web.search.results.slice(0, 8).map((r) => ({ title: r.title, url: r.url, site: r.site }));
  }
  el.wtListLabel.textContent = findings.bestMatch ? "其它相关真实结果" : "联网抓取的真实结果";
  el.wtListLabel.classList.toggle("hidden", items.length === 0);
  items.slice(0, 6).forEach((s, i) => {
    const a = document.createElement("a");
    a.className = "wt-item"; a.href = safeUrl(s.url) || "#"; a.target = "_blank"; a.rel = "noopener,noreferrer";
    a.innerHTML =
      `<span class="wt-idx">${i + 1}</span>` +
      `<span class="wt-item-body"><span class="wt-item-title">${escapeHtml(s.title || "未命名")}</span>` +
      `<span class="wt-item-site">${s.site ? "<b>" + escapeHtml(s.site) + "</b> · " : ""}${escapeHtml((s.note || s.url || "").slice(0, 70))}</span></span>` +
      `<span class="wt-item-arrow">↗</span>`;
    el.wtList.appendChild(a);
  });

  // 使用的搜索关键词
  el.wtKeywords.innerHTML = "";
  (web.keywords || []).slice(0, 6).forEach((q) => {
    const s = document.createElement("span"); s.className = "wt-kw"; s.textContent = q;
    el.wtKeywords.appendChild(s);
  });

  // 局限说明
  const notes = [findings.note, !searchOk ? "（联网搜索不可用，结果仅为 AI 推断）" : ""].filter(Boolean);
  el.wtNote.textContent = notes.join(" ") ||
    "说明：以上链接为搜索引擎真实抓取结果，相关性由 AI 辅助判断；原始发布者/最早时间仍需以原站信息为准。";

  el.webTraceBadge.textContent = searchOk ? "已联网 · 真实结果" : "联网失败";
  el.webTraceDesc.textContent = searchOk
    ? "以下是搜索引擎真实抓取的网页，点击可直接访问；不是 AI 凭空编造的网址。"
    : "本次联网搜索未能返回结果；下方为 AI 依据画面给出的分析，具体来源请点引擎链接自行核验。";
}

/** 影视模式：展示联网查到的相关视频/讨论页 */
function renderFilmWeb(s) {
  el.webTraceCard.classList.remove("hidden");
  el.wtSummary.textContent = "已联网搜索该作品/集数的相关页面，可能帮助你定位片段：";
  el.wtBest.innerHTML = "";
  el.wtListLabel.textContent = "联网抓取的相关页面";
  el.wtListLabel.classList.remove("hidden");
  el.wtList.innerHTML = "";
  s.results.slice(0, 8).forEach((r, i) => {
    const a = document.createElement("a");
    a.className = "wt-item"; a.href = safeUrl(r.url) || "#"; a.target = "_blank"; a.rel = "noopener,noreferrer";
    a.innerHTML =
      `<span class="wt-idx">${i + 1}</span>` +
      `<span class="wt-item-body"><span class="wt-item-title">${escapeHtml(r.title || "未命名")}</span>` +
      `<span class="wt-item-site"><b>${escapeHtml(r.site || "")}</b> · ${escapeHtml((r.snippet || "").slice(0, 60))}</span></span>` +
      `<span class="wt-item-arrow">↗</span>`;
    el.wtList.appendChild(a);
  });
  el.wtKeywords.innerHTML = "";
  (s.queries || []).forEach((q) => { const sp = document.createElement("span"); sp.className = "wt-kw"; sp.textContent = q; el.wtKeywords.appendChild(sp); });
  el.wtNote.textContent = "说明：这些是真实搜索结果，精确时刻仍建议用下方「视频帧精确比对」上传对应视频确认。";
  el.webTraceBadge.textContent = "已联网";
  el.webTraceDesc.textContent = "基于作品名与画面线索联网抓取的相关页面。";
}

/* =========================================================
 * 找原图工作流（来源模式 · 图片残缺时）
 * ========================================================= */
function renderRecoveryCard(data) {
  const integrity = data.integrity || {};
  const recovery = data.recovery || {};
  const need = recovery.needed === true || integrity.isComplete === false;
  if (!need) { el.recoveryCard.classList.add("hidden"); return; }

  el.recoveryCard.classList.remove("hidden");
  el.recoveryTitle.textContent = "检测到图片可能残缺 — 建议先找回原图再溯源";
  el.recoveryDesc.textContent = "残缺图直接溯源命中率低。先用反向图搜找回完整原图，再把原图直链粘贴到下方触发第二阶段深度溯源。";

  // 残缺问题
  el.recoveryIssues.innerHTML = "";
  const issues = integrity.issues || [];
  if (issues.length) {
    issues.forEach((x) => { const s = document.createElement("span"); s.className = "wf-issue"; s.textContent = "⚠ " + x; el.recoveryIssues.appendChild(s); });
  } else {
    const s = document.createElement("span"); s.className = "wf-issue"; s.textContent = "⚠ AI 判断图片可能非完整原图"; el.recoveryIssues.appendChild(s);
  }

  el.recoveryStrategy.textContent = recovery.strategy || "建议使用反向图片搜索，比对画面主体与构图，寻找未被裁切的完整版本。";

  // 原图特征线索
  el.recoveryClues.innerHTML = "";
  const clues = recovery.clues || [];
  if (clues.length) {
    clues.forEach((c) => { const s = document.createElement("span"); s.className = "clue"; s.textContent = c; el.recoveryClues.appendChild(s); });
  } else {
    const s = document.createElement("span"); s.className = "clue empty"; s.textContent = "未提供特征线索"; el.recoveryClues.appendChild(s);
  }

  // 一键反向搜原图：优先用能以图搜图的引擎
  el.recoveryEngines.innerHTML = "";
  const recoverKeywords = ((recovery.keywords || []).concat(data.searchKeywords || [])).slice(0, 6).join(" ");
  const imageUrl = safeUrl(el.imageUrl.value) || safeUrl(el.originalUrl.value);
  ENGINES.filter((e) => e.reverse).forEach((eng) => {
    const ok = engineAvailable(eng);
    const btn = document.createElement("button");
    btn.className = "engine-action";
    btn.disabled = !ok;
    const b = document.createElement("span"); b.className = "eb"; b.style.background = eng.color; b.textContent = eng.badge;
    const c = document.createElement("div"); c.className = "ec";
    const st = document.createElement("strong"); st.textContent = eng.name;
    const sm = document.createElement("small");
    sm.textContent = !ok ? "当前区域不可用" : (imageUrl ? "以图搜原图 · 打开" : "打开上传页 · 拖入图片");
    c.append(st, sm);
    const arrow = document.createElement("span"); arrow.className = "arrow"; arrow.textContent = "↗";
    btn.append(b, c, arrow);
    btn.addEventListener("click", () => {
      const url = imageUrl ? eng.reverse(imageUrl) : eng.home;
      toast(imageUrl ? `正在用 ${eng.name} 找原图…` : `请在 ${eng.name} 页面拖入/上传图片`);
      window.open(url, "_blank", "noopener,noreferrer");
    });
    el.recoveryEngines.appendChild(btn);
  });
  // 关键词找原图（必应文字检索）
  const kwBtn = document.createElement("button");
  kwBtn.className = "engine-action";
  const kwB = document.createElement("span"); kwB.className = "eb"; kwB.style.background = "#7c6cff"; kwB.textContent = "关";
  const kwC = document.createElement("div"); kwC.className = "ec";
  const kwSt = document.createElement("strong"); kwSt.textContent = "关键词找原图";
  const kwSm = document.createElement("small"); kwSm.textContent = "按原图特征线索检索";
  kwC.append(kwSt, kwSm);
  const kwArrow = document.createElement("span"); kwArrow.className = "arrow"; kwArrow.textContent = "↗";
  kwBtn.append(kwB, kwC, kwArrow);
  kwBtn.addEventListener("click", () => {
    window.open(`https://www.bing.com/search?q=${encodeURIComponent(recoverKeywords || data.summary || "image")}`, "_blank", "noopener,noreferrer");
  });
  el.recoveryEngines.appendChild(kwBtn);
}

/* =========================================================
 * 时刻定位与核验工作流（影视模式）
 * ========================================================= */
function renderTimestampCard(data) {
  const ta = data.timestampAnalysis || {};
  el.timestampCard.classList.remove("hidden");

  // 时刻估计块
  el.timeEstimate.innerHTML = "";
  const range = ta.estimateRange || data.timestamp || "—";
  const best = ta.bestGuess || data.timestamp || "—";
  const quality = { high: "线索充分", medium: "线索一般", low: "线索较少" }[ta.clueQuality] || "未评估";
  el.timeEstimate.append(
    timeBlock("时间区间", range, true),
    timeBlock("最佳单点估计", best, false),
    timeBlock("线索质量", quality, false),
  );

  // 定位依据
  el.timeBasis.innerHTML = "";
  const basis = ta.timestampBasis || [];
  if (basis.length) {
    basis.forEach((b) => { const li = document.createElement("li"); li.textContent = b; el.timeBasis.appendChild(li); });
  } else {
    const li = document.createElement("li"); li.textContent = data.analysis || "AI 未提供明确依据"; el.timeBasis.appendChild(li);
  }

  // 定向核验查询
  el.verifyQueries.innerHTML = "";
  const queries = data.verificationQueries || [];
  if (!queries.length) {
    const fallback = [data.workTitle, data.episode && data.episode !== "—" ? data.episode : "", "关键时刻"].filter(Boolean).join(" ");
    queries.push(fallback);
  }
  queries.forEach((q) => {
    const chip = document.createElement("button");
    chip.className = "verify-chip";
    const target = document.createElement("span"); target.className = "vc-target"; target.textContent = "B站";
    const label = document.createElement("span"); label.textContent = q;
    chip.append(target, label);
    chip.title = "点击在哔哩哔哩搜索该查询；下方引擎区可切换其他平台";
    chip.addEventListener("click", () => {
      window.open(VERIFY_TARGETS[0].url(q), "_blank", "noopener,noreferrer");
      toast(`已在 B站 搜索：「${q}」`);
    });
    el.verifyQueries.appendChild(chip);
  });

  // 补充：各平台核验入口（基于第一条查询）
  const primaryQ = queries[0];
  VERIFY_TARGETS.forEach((t) => {
    if (state.region?.mainland && t.blockedInMainland) return;
    const chip = document.createElement("button");
    chip.className = "verify-chip";
    const target = document.createElement("span"); target.className = "vc-target"; target.textContent = t.name;
    const label = document.createElement("span"); label.textContent = "核验时刻 ↗";
    chip.append(target, label);
    chip.addEventListener("click", () => { window.open(t.url(primaryQ), "_blank", "noopener,noreferrer"); });
    el.verifyQueries.appendChild(chip);
  });

  // 若用户已补充线索，显示
  if (data._refinedWith?.length) {
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = "已参考补充线索：" + data._refinedWith.join("；");
    el.verifyQueries.appendChild(note);
  }
}

function timeBlock(k, v, primary) {
  const div = document.createElement("div");
  div.className = "time-block" + (primary ? " primary" : "");
  const kk = document.createElement("div"); kk.className = "k"; kk.textContent = k;
  const vv = document.createElement("div"); vv.className = "v" + (String(v).length > 20 ? " small" : ""); vv.textContent = v || "—";
  div.append(kk, vv);
  return div;
}

/* =========================================================
 * 第二阶段：用找回的原图深度溯源
 * ========================================================= */
async function urlToDataUrl(url) {
  const res = await fetch(url, { mode: "cors", signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error("无法下载原图");
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) throw new Error("该链接不是图片");
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("原图读取失败"));
    r.readAsDataURL(blob);
  });
}

async function continueWithOriginal() {
  const url = safeUrl(el.originalUrl.value);
  if (!url) { toast("请先粘贴原图直链"); return; }
  if (state.busy) return;

  state.busy = true;
  el.continueWithOriginal.disabled = true;
  el.continueWithOriginal.textContent = "深度溯源中…";
  toast("正在获取原图并进行第二阶段溯源…");

  let originalDataUrl = null;
  try { originalDataUrl = await urlToDataUrl(url); }
  catch (e) { console.warn("原图下载失败，改用直链文本作为线索", e); }

  state.controller = new AbortController();
  const userContent = [
    { type: "text", text: `这是找回的完整原图（直链：${url}）。残缺的旧图只是它的局部。请基于这张完整原图重新做来源溯源：判断来源、最早发布线索、网址、日期，并给出核验建议。` },
  ];
  if (originalDataUrl) {
    userContent.push({ type: "image_url", image_url: { url: originalDataUrl } });
  } else {
    userContent.push({ type: "text", text: "由于网络限制无法读取该图片内容，请仅依据上述直链信息给出合理推断，不要编造网址。" });
  }

  try {
    const parsed = await askAI(SYSTEM_SOURCE, userContent, state.controller);
    parsed._usedOriginal = true;
    parsed._originalUrl = url;
    state.lastResult = { mode: "source", data: parsed, time: Date.now(), thumb: state.imageDataUrl };
    renderResult(parsed);
    saveHistory(state.lastResult);
    toast("已用原图完成深度溯源");
    el.resultView.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    el.errorText.textContent = friendlyError(e) + "（原图阶段）";
    showView("errorView");
  } finally {
    state.busy = false;
    el.continueWithOriginal.disabled = false;
    el.continueWithOriginal.textContent = "用原图继续 →";
  }
}

/* =========================================================
 * 影视模式多轮：补充线索再定位时刻
 * ========================================================= */
async function refineTimestamp() {
  const clue = el.timestampClue.value.trim();
  if (!clue) { toast("请先填写补充线索"); return; }
  const prev = state.lastResult?.data;
  if (!prev || state.mode !== "film") { toast("请先完成一次影视识别"); return; }
  if (state.busy) return;

  state.busy = true;
  el.refineTimestamp.disabled = true;
  el.refineTimestamp.textContent = "定位中…";
  state.controller = new AbortController();
  state.timestampClues.push(clue);

  const prompt = `这是一次时刻精确定位的第二轮推理。
已识别作品：${prev.workTitle || "未知"}（${prev.workType || "未知"}），集数：${prev.episode || "未知"}。
上一轮画面描述：${prev.sceneDescription || "无"}。
上一轮时刻区间：${prev.timestampAnalysis?.estimateRange || prev.timestamp || "无"}。
用户补充线索：${state.timestampClues.join("；")}。
请结合补充线索重新精确定位该画面时刻，输出与之前相同结构的 JSON；在 timestampAnalysis.timestampBasis 中说明补充线索如何改变或确认了判断。`;
  const userContent = [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: state.imageDataUrl } },
  ];

  try {
    const parsed = await askAI(SYSTEM_FILM, userContent, state.controller);
    parsed._refinedWith = [...state.timestampClues];
    state.lastResult = { mode: "film", data: parsed, time: Date.now(), thumb: state.imageDataUrl };
    renderResult(parsed);
    saveHistory(state.lastResult);
    toast("已根据补充线索重新定位时刻");
  } catch (e) {
    el.errorText.textContent = friendlyError(e) + "（再定位阶段）";
    showView("errorView");
  } finally {
    state.busy = false;
    el.refineTimestamp.disabled = false;
    el.refineTimestamp.textContent = "再定位一次";
    el.timestampClue.value = "";
  }
}

/* =========================================================
 * 视频帧精确比对（服务端像素级比对 · SSE 进度）
 * ========================================================= */
let fmHealthChecked = false;

async function initFrameMatch(data) {
  el.frameMatchCard.classList.remove("hidden");
  // 重置 UI 状态
  el.fmResult.classList.add("hidden");
  el.fmError.classList.add("hidden");
  el.fmProgress.classList.add("hidden");
  resetFrameMatchResult();

  // 预填基于 AI 识别结果的核验提示
  const work = data?.workTitle && data.workTitle !== "未能确定" ? data.workTitle : "";
  const ep = data?.episode && data.episode !== "—" && data.episode !== "未知" ? data.episode : "";
  el.fmNote.textContent = [
    "这种方式用你的截图逐帧扫描视频，得到的是可复现的真实时刻，精度远高于纯 AI 推断。",
    work ? `AI 初步识别为《${work}》${ep ? " " + ep : ""}，可据此找到对应视频文件再比对。` : "",
  ].filter(Boolean).join(" ");

  if (!fmHealthChecked) {
    fmHealthChecked = true;
    el.fmRunBtn.disabled = true;
    el.fmRunBtnText.textContent = "检测比对服务…";
    checkFmHealth();
  }
}

async function checkFmHealth() {
  // 依次尝试：同源 → 常见本地端口。找到可用的服务地址后写入 FM_API_BASE
  const candidates = ["", "http://localhost:3777", "http://127.0.0.1:3777"];
  let ok = false;
  for (const base of candidates) {
    try {
      const r = await fetch(base + "/api/health", { signal: AbortSignal.timeout(2500) });
      if (r.ok && (await r.json()).ok) { FM_API_BASE = base; ok = true; break; }
    } catch (_) { /* 尝试下一个 */ }
  }
  if (ok) {
    el.fmRunBtn.disabled = false;
    el.fmRunBtnText.textContent = "开始逐帧比对";
    el.fmNote.textContent += " ✅ 比对服务已就绪。";
  } else {
    el.fmRunBtn.disabled = true;
    el.fmRunBtnText.textContent = "服务未启动";
    el.fmNote.textContent = "⚠️ 视频帧比对服务未启动。请双击目录下的「启动网站.bat」（或在 server 目录运行 npm start）启动服务后刷新；其余 AI 检索功能不受影响。";
  }
}

function setFmSource(src) {
  state.fmSource = src;
  el.fmSwitchLocal.classList.toggle("active", src === "local");
  el.fmSwitchUrl.classList.toggle("active", src === "url");
  el.fmLocalBlock.classList.toggle("hidden", src !== "local");
  el.fmUrlBlock.classList.toggle("hidden", src !== "url");
  el.fmError.classList.add("hidden");
}

function setFmVideoFile(file) {
  state.fmVideoFile = file;
  if (file) {
    el.fmVideoName.textContent = file.name + " · " + (file.size / 1024 / 1024).toFixed(1) + " MB";
    el.fmVideoDrop.classList.add("has-file");
  } else {
    el.fmVideoName.textContent = "点击选择视频文件，或拖入";
    el.fmVideoDrop.classList.remove("has-file");
  }
}

function resetFrameMatchResult() {
  el.fmResult.classList.add("hidden");
  el.fmFramePreviewWrap.classList.add("hidden");
  el.fmFramePreview.removeAttribute("src");
  el.fmResultGrid.innerHTML = "";
  el.fmError.classList.add("hidden");
}

async function runFrameMatch() {
  if (state.fmBusy) return;
  el.fmError.classList.add("hidden");
  el.fmResult.classList.add("hidden");
  el.fmProgress.classList.remove("hidden");
  el.fmProgressBar.style.width = "0%";
  el.fmProgressPct.textContent = "0%";
  el.fmProgressLabel.textContent = "准备中…";
  el.fmRunBtn.disabled = true;
  state.fmBusy = true;

  // 校验：必须先上传截图（用于比对的目标图）
  if (!state.file) {
    failFrameMatch("请先在左侧上传影视截图（比对目标）。");
    return;
  }

  const form = new FormData();
  form.append("screenshot", state.file, state.file.name || "screenshot.png");
  if (state.fmSource === "local") {
    if (!state.fmVideoFile) { failFrameMatch("请先选择要比对的视频文件。"); return; }
    form.append("video", state.fmVideoFile, state.fmVideoFile.name);
  } else {
    const url = el.fmVideoUrl.value.trim();
    if (!/^https?:\/\//i.test(url)) { failFrameMatch("请填写有效的 http(s) 视频直链。"); return; }
    form.append("videoUrl", url);
  }

  try {
    const resp = await fetch(FM_API_BASE + "/api/match", { method: "POST", body: form });
    if (!resp.ok) {
      let msg = "创建比对任务失败";
      try { msg = (await resp.json()).error || msg; } catch (_) {}
      throw new Error(msg);
    }
    const { jobId } = await resp.json();
    await streamFrameMatch(jobId);
  } catch (e) {
    failFrameMatch(e?.message || "比对请求失败");
  }
}

function streamFrameMatch(jobId) {
  return new Promise((resolve, reject) => {
    const es = new EventSource(FM_API_BASE + "/api/stream/" + encodeURIComponent(jobId));
    let settled = false;
    es.onmessage = (ev) => {
      let d;
      try { d = JSON.parse(ev.data); } catch (_) { return; }
      if (typeof d.progress === "number") {
        el.fmProgressBar.style.width = d.progress + "%";
        el.fmProgressPct.textContent = d.progress + "%";
      }
      if (d.label) el.fmProgressLabel.textContent = d.label;
      if (d.status === "done") {
        settled = true; es.close();
        el.fmProgress.classList.add("hidden");
        renderFrameMatchResult(d.result);
        restoreFmBtn();
        toast("帧比对完成：" + (d.result?.timeFormatted || "已定位"));
        resolve(d.result);
      } else if (d.status === "error") {
        settled = true; es.close();
        el.fmProgress.classList.add("hidden");
        failFrameMatch(d.error || "比对失败");
        reject(new Error(d.error || "比对失败"));
      }
    };
    es.onerror = () => {
      if (settled) return;
      settled = true; es.close();
      el.fmProgress.classList.add("hidden");
      failFrameMatch("进度连接中断，但比对可能仍在进行，请稍后重试。");
      reject(new Error("SSE error"));
    };
  });
}

function renderFrameMatchResult(r) {
  if (!r) return;
  el.fmResult.classList.remove("hidden");
  const cells = [
    { k: "精确时刻", v: r.timeFormatted, hero: true },
    { k: "相似度", v: r.similarity + "%" },
    { k: "定位精度", v: r.precision === "fine" ? "0.05 秒" : "1 秒" },
    { k: "视频时长", v: r.videoDuration != null ? formatDur(r.videoDuration) : "—" },
  ];
  el.fmResultGrid.innerHTML = "";
  cells.forEach((c) => {
    const div = document.createElement("div");
    div.className = "fm-result-cell" + (c.hero ? " hero" : "");
    div.innerHTML = `<div class="k">${c.k}</div><div class="v">${escapeHtml(String(c.v))}</div>`;
    el.fmResultGrid.appendChild(div);
  });
  if (r.frameDataUrl) {
    el.fmFramePreview.src = r.frameDataUrl;
    el.fmFramePreviewWrap.classList.remove("hidden");
  }
  // 把精确时刻回写到结果卡片中（若存在"片段时刻"卡）
  updateTimestampWithExact(r);
  // 保存帧比对结果并刷新综合结论（影视模式）
  state.frameResult = r;
  if (state.mode === "film" && state._filmParsed) {
    buildFinalConclusion(state._filmParsed, r);
  }
}

function updateTimestampWithExact(r) {
  const cards = el.resultGrid.querySelectorAll(".result-card");
  cards.forEach((card) => {
    const k = card.querySelector(".k");
    if (k && /时刻/.test(k.textContent)) {
      const v = card.querySelector(".v");
      if (v) {
        v.textContent = r.timeFormatted + "  ✓帧比对";
        v.style.color = "#9fe9ff";
      }
    }
  });
}

function formatDur(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function failFrameMatch(msg) {
  el.fmError.textContent = msg;
  el.fmError.classList.remove("hidden");
  restoreFmBtn();
}

function restoreFmBtn() {
  state.fmBusy = false;
  el.fmRunBtn.disabled = false;
  el.fmRunBtnText.textContent = "开始逐帧比对";
}

/* =========================================================
 * 影视兜底链路：搜片源 → 探测可直读 → 帧比对 → 综合结论
 * 目标：时刻推断不精确时，不再只让用户自己去找，而是系统主动
 *       搜片源、能直读就自动逐帧比对，最后汇总三路信息给出最终答案。
 * ========================================================= */

/** 判断时刻是否"不够精确"，需要触发兜底链路 */
function timestampIsVague(data) {
  const ta = data.timestampAnalysis || {};
  if (ta.clueQuality === "low") return true;
  const t = String(data.timestamp || "");
  if (!t || /无法确定|未能确定|未知|约第|中段|前段|后段/.test(t)) return true;
  const range = String(ta.estimateRange || "");
  if (/无法确定|中段|前段|后段/.test(range)) return true;
  // 有 HH:MM:SS 且线索质量 medium/high 视为可接受
  return false;
}

/** 影视模式结果渲染后：初始化兜底卡 */
function initAutoSource(data) {
  el.autoSourceCard.classList.remove("hidden");
  resetAutoSourceUI();
  state._filmParsed = data;

  const vague = timestampIsVague(data);
  if (vague) {
    el.autoSourceDesc.textContent = "当前时刻仅为 AI 粗估（线索不足）。系统会联网搜索该作品的片源，找出可直接读取的视频自动逐帧比对，得到真实时刻后汇总为最终结论。";
    el.autoSourceBtn.classList.add("pulse-btn");
    // 自动启动兜底链路（用户无需操作）；runAutoSource 内部会先确认服务地址
    toast("时刻较模糊，正在自动搜索片源并比对…", 3200);
    setTimeout(() => runAutoSource(true), 500);
  } else {
    el.autoSourceDesc.textContent = "AI 已给出较明确的时刻区间。如需进一步用真实视频验证，可点击下面按钮搜索片源并逐帧比对，随后刷新综合结论。";
    el.autoSourceBtn.classList.remove("pulse-btn");
  }
}

function resetAutoSourceUI() {
  el.asError.classList.add("hidden");
  el.asResult.classList.add("hidden");
  el.asSources.classList.add("hidden");
  el.asProgress.classList.add("hidden");
  el.asSourceList.innerHTML = "";
  state.asSources = [];
  el.autoSourceBtn.disabled = false;
  el.autoSourceBtnText.textContent = "搜索片源并自动比对";
}

function asSetProgress(pct, label) {
  el.asProgress.classList.remove("hidden");
  el.asProgressBar.style.width = pct + "%";
  el.asProgressPct.textContent = pct + "%";
  if (label) el.asProgressLabel.textContent = label;
}

/** 调用后端片源搜索 */
async function callFindSources(queries) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 30000);
  try {
    const resp = await fetch(FM_API_BASE + "/api/find-sources", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries }), signal: controller.signal,
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (_) { return null; }
  finally { clearTimeout(t); }
}

/** 调用后端批量探测可直读性 */
async function callProbeSources(urls) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 60000);
  try {
    const resp = await fetch(FM_API_BASE + "/api/probe-sources", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }), signal: controller.signal,
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (_) { return null; }
  finally { clearTimeout(t); }
}

/** 生成片源搜索关键词 */
function buildSourceQueries(data) {
  const work = data.workTitle && data.workTitle !== "未能确定" ? String(data.workTitle).replace(/[《》]/g, "") : "";
  const ep = data.episode && !/^[—\-]|未知|未能/.test(data.episode) ? String(data.episode) : "";
  const original = data.originalTitle ? String(data.originalTitle) : "";
  const q = [];
  if (work) {
    q.push(`${work} ${ep} 在线观看 完整版`.trim());
    q.push(`${work} ${ep} 第几集 mp4`.trim());
  }
  if (original) q.push(`${original} episode watch`.trim());
  if (!q.length && data.summary) q.push(String(data.summary).slice(0, 30));
  return q.slice(0, 4);
}

/** 兜底主流程 */
async function runAutoSource(auto = false) {
  if (state.asBusy) return;
  const data = state._filmParsed || state.lastResult?.data;
  if (!data) { toast("请先完成一次影视识别"); return; }
  if (!state.file) { el.asError.textContent = "比对需要你的截图，但当前截图已丢失，请重新上传后重试。"; el.asError.classList.remove("hidden"); return; }
  // 等待后端服务地址探测完成（与 initFrameMatch 的 health check 共享）
  if (!FM_API_BASE) {
    el.autoSourceBtnText.textContent = "检测比对服务…";
    await checkFmHealth();
  }
  if (!FM_API_BASE) { el.asError.textContent = "视频帧比对服务未启动，请双击「启动网站.bat」后刷新，再点此按钮。"; el.asError.classList.remove("hidden"); el.autoSourceBtnText.textContent = "服务未启动，重试"; return; }

  state.asBusy = true;
  el.asError.classList.add("hidden");
  el.asResult.classList.add("hidden");
  el.autoSourceBtn.disabled = true;
  el.autoSourceBtnText.textContent = "正在搜索片源…";

  try {
    // 步骤1：联网搜片源
    asSetProgress(12, "正在联网搜索片源…");
    const queries = buildSourceQueries(data);
    const found = await callFindSources(queries);
    const sources = found?.results || [];
    state.asSources = sources;
    if (!sources.length) {
      asSetProgress(100, "未找到片源");
      el.asSources.classList.remove("hidden");
      el.asSourceList.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "as-meta";
      empty.textContent = "联网搜索未返回片源结果，可尝试在下方引擎中手动检索，或用「视频帧精确比对」上传本地视频。";
      el.asSourceList.appendChild(empty);
      el.autoSourceBtnText.textContent = "重新搜索片源";
      state.asBusy = false; el.autoSourceBtn.disabled = false;
      await buildFinalConclusion(data, null);
      return;
    }

    // 步骤2：展示候选 + 探测可直读性
    asSetProgress(38, `找到 ${sources.length} 条片源，正在探测可直读性…`);
    renderSourceCandidates(sources, null);
    const probeUrls = sources.filter((s) => s.kind === "direct" || s.kind === "platform")
      .slice(0, 10).map((s) => s.url);
    let readable = [];
    if (probeUrls.length) {
      const probed = await callProbeSources(probeUrls);
      readable = probed?.readable || [];
      renderSourceCandidates(sources, probed?.probed || []);
    }

    // 步骤3：找到可直读者 → 自动帧比对
    if (readable.length) {
      const pick = readable[0];
      asSetProgress(62, "发现可直读片源，正在逐帧比对…");
      el.asSourcesLabel.textContent = `找到的片源候选（已探测 ${readable.length} 条可直读）`;
      const r = await autoMatchUrl(pick.url, (p, label) => {
        asSetProgress(62 + Math.round(p * 0.35), label || "正在逐帧比对…");
      }, data);
      asSetProgress(100, "比对完成");
      if (r) {
        state.frameResult = r;
        renderAutoFrameResult(r, pick);
        updateTimestampWithExact(r);
        await buildFinalConclusion(data, r);
        toast("已找到真实时刻：" + (r.timeFormatted || "完成"), 3200);
      } else {
        el.asError.textContent = "片源探测可读但实际比对失败，可能视频过大或格式不支持。请下载该片源后用「视频帧精确比对」本地比对。";
        el.asError.classList.remove("hidden");
        await buildFinalConclusion(data, null);
      }
    } else {
      // 步骤4：无可直读片源 → 列出候选供用户处理，仍给综合结论
      asSetProgress(100, "片源需人工处理");
      el.asSourcesLabel.textContent = "找到的片源候选（均不可直读，多为平台页面）";
      el.asResult.classList.remove("hidden");
      el.asResult.innerHTML =
        `<div class="as-result-head">已找到片源线索，但无法直接逐帧比对</div>` +
        `<div class="as-result-line">这些平台页面有防盗链，系统无法直接读取视频。你可以：<br>` +
        `① 点击候选打开页面，在平台内查看该集；② 下载对应视频后，用下方「视频帧精确比对」上传本地文件得到真实时刻。</div>`;
      await buildFinalConclusion(data, null);
    }
  } catch (e) {
    el.asError.textContent = e?.message || "自动找片源流程出错";
    el.asError.classList.remove("hidden");
  } finally {
    state.asBusy = false;
    el.autoSourceBtn.disabled = false;
    el.autoSourceBtnText.textContent = "重新搜索片源并比对";
    el.autoSourceBtn.classList.remove("pulse-btn");
  }
}

/** 用直链 URL 自动做帧比对（复用 /api/match + SSE） */
function autoMatchUrl(videoUrl, onProgress, data) {
  return new Promise(async (resolve) => {
    try {
      const form = new FormData();
      form.append("screenshot", state.file, state.file.name || "screenshot.png");
      form.append("videoUrl", videoUrl);
      const resp = await fetch(FM_API_BASE + "/api/match", { method: "POST", body: form });
      if (!resp.ok) return resolve(null);
      const { jobId } = await resp.json();
      const es = new EventSource(FM_API_BASE + "/api/stream/" + encodeURIComponent(jobId));
      let settled = false;
      es.onmessage = (ev) => {
        let d; try { d = JSON.parse(ev.data); } catch (_) { return; }
        if (typeof d.progress === "number") onProgress?.(d.progress, d.label);
        if (d.status === "done") { settled = true; es.close(); resolve(d.result); }
        else if (d.status === "error") { settled = true; es.close(); resolve(null); }
      };
      es.onerror = () => { if (!settled) { settled = true; es.close(); resolve(null); } };
    } catch (_) { resolve(null); }
  });
}

/** 渲染片源候选列表 */
function renderSourceCandidates(sources, probed) {
  el.asSources.classList.remove("hidden");
  el.asSourceList.innerHTML = "";
  const kindLabel = { direct: "直链", platform: "平台", page: "网页" };
  const probeMap = {};
  (probed || []).forEach((p) => { probeMap[p.url] = p; });
  sources.slice(0, 12).forEach((s) => {
    const a = document.createElement("a");
    a.className = "as-source"; a.href = safeUrl(s.url) || "#"; a.target = "_blank"; a.rel = "noopener,noreferrer";
    const kind = document.createElement("span");
    kind.className = "as-kind " + (s.kind || "page");
    kind.textContent = kindLabel[s.kind] || "网页";
    const body = document.createElement("span");
    body.className = "as-body";
    const title = document.createElement("span"); title.className = "as-title"; title.textContent = s.title || "未命名片源";
    const meta = document.createElement("span"); meta.className = "as-meta";
    meta.textContent = (s.site || hostOf(s.url) || "") + " · " + String(s.url || "").slice(0, 70);
    body.append(title, meta);
    a.append(kind, body);
    const p = probeMap[s.url];
    if (p) {
      const badge = document.createElement("span");
      badge.className = "as-badge " + (p.ok ? "ok" : "no");
      badge.textContent = p.ok ? "可直读 ✓" : "不可直读";
      badge.title = p.reason || "";
      a.appendChild(badge);
    } else if (s.kind === "direct") {
      const badge = document.createElement("span");
      badge.className = "as-badge pending"; badge.textContent = "待探测";
      a.appendChild(badge);
    }
    el.asSourceList.appendChild(a);
  });
}

/** 渲染兜底帧比对结果 */
function renderAutoFrameResult(r, source) {
  el.asResult.classList.remove("hidden");
  el.asResult.innerHTML =
    `<div class="as-result-head">✓ 片源逐帧比对成功</div>` +
    `<div class="as-result-time">${escapeHtml(r.timeFormatted || "—")}</div>` +
    `<div class="as-result-line">相似度 <b>${escapeHtml(String(r.similarity ?? "—"))}%</b> · 定位精度 <b>${r.precision === "fine" ? "0.05 秒" : "1 秒"}</b></div>` +
    `<div class="as-result-line">比对片源：<b>${escapeHtml(source?.title || hostOf(source?.url) || "在线片源")}</b></div>` +
    (source?.url ? `<a class="final-source" href="${safeUrl(source.url) || "#"}" target="_blank" rel="noopener noreferrer"><span class="fs-idx">↗</span><span class="fs-title">${escapeHtml(source.url.slice(0, 80))}</span></a>` : "");
}

/** 综合结论：把三路信息喂给 AI，生成并渲染置顶最终答案 */
async function buildFinalConclusion(data, frameResult) {
  el.finalCard.classList.remove("hidden");
  el.finalTitle.textContent = "综合结论 · 生成中";
  el.finalAnswer.textContent = "正在汇总画面识别、联网来源与帧比对结果…";
  el.finalFacts.innerHTML = "";
  el.finalSources.innerHTML = "";
  el.finalNote.textContent = "";

  const webResults = (data._filmWeb?.results || []).slice(0, 10).map((r) => ({ title: r.title, url: r.url, site: r.site }));
  const material = {
    aiRecognition: {
      workTitle: data.workTitle, originalTitle: data.originalTitle, workType: data.workType,
      episode: data.episode, timestamp: data.timestamp, timestampAnalysis: data.timestampAnalysis,
      sceneDescription: data.sceneDescription, detectedText: data.detectedText, summary: data.summary,
    },
    webSearchResults: webResults,
    frameMatchResult: frameResult ? {
      timeFormatted: frameResult.timeFormatted, similarity: frameResult.similarity,
      precision: frameResult.precision, videoDuration: frameResult.videoDuration, sourceUrl: state.asSources[0]?.url,
    } : null,
  };

  let conclusion = null;
  try {
    conclusion = await askAI(SYSTEM_FINAL, "以下是已经完成的取证材料，请综合成最终结论：\n" + JSON.stringify(material), null);
  } catch (_) { /* 降级为本地拼接 */ }

  if (!conclusion || !conclusion.answer) {
    conclusion = {
      answer: frameResult
        ? `这张截图来自《${data.workTitle || "未能确定"}》${data.episode && data.episode !== "—" ? " " + data.episode : ""}，经视频帧逐帧比对，片段位于 ${frameResult.timeFormatted}。`
        : `这张截图疑似来自《${data.workTitle || "未能确定"}》${data.episode && data.episode !== "—" ? " " + data.episode : ""}，时刻约为 ${data.timestamp || "未能确定"}（AI 推断，未经帧比对验证）。`,
      title: data.workTitle || "未能确定",
      episode: data.episode || "—",
      moment: frameResult?.timeFormatted || data.timestamp || "未能确定",
      momentSource: frameResult ? "帧比对实测" : "AI 推断（未经帧比对验证）",
      confidence: data.confidence || "low",
      sourceUrls: webResults.slice(0, 4).map((r) => ({ title: r.title, url: r.url })),
      note: frameResult ? "" : "未获取到可直接比对的片源，时刻仍为推断值。",
    };
  }

  renderFinalConclusion(conclusion, data, frameResult);
}

function renderFinalConclusion(c, data, frameResult) {
  el.finalCard.classList.remove("hidden");
  el.finalTitle.textContent = "综合结论";
  el.finalSubtitle.textContent = frameResult
    ? "已汇总画面识别、联网来源与视频帧比对，时刻为逐帧实测"
    : "已汇总画面识别与联网来源（未获取到可比对片源）";
  el.finalBadge.textContent = frameResult ? "含帧比对实测" : "AI+联网综合";
  el.finalAnswer.textContent = c.answer || data.summary || "—";

  const msMap = { "帧比对实测": "high", "AI 推断（未经帧比对验证）": "medium" };
  const facts = [
    { k: "作品", v: c.title || data.workTitle || "—", hero: true },
    { k: "集数", v: c.episode || "—" },
    { k: "最终时刻", v: c.moment || "—", hero: !!frameResult },
    { k: "时刻来源", v: c.momentSource || "—", small: true },
  ];
  el.finalFacts.innerHTML = "";
  facts.forEach((f) => {
    const d = document.createElement("div");
    d.className = "final-fact" + (f.hero ? " hero" : "");
    const k = document.createElement("div"); k.className = "k"; k.textContent = f.k;
    const v = document.createElement("div"); v.className = "v" + (f.small ? " small" : ""); v.textContent = f.v || "—";
    d.append(k, v); el.finalFacts.appendChild(d);
  });

  el.finalSources.innerHTML = "";
  const urls = (c.sourceUrls || []).filter((u) => u && /^https?:\/\//.test(u.url || ""));
  urls.slice(0, 5).forEach((u, i) => {
    const a = document.createElement("a");
    a.className = "final-source"; a.href = safeUrl(u.url) || "#"; a.target = "_blank"; a.rel = "noopener,noreferrer";
    a.innerHTML = `<span class="fs-idx">${i + 1}</span><span class="fs-title">${escapeHtml(u.title || u.url)}</span>` +
      `<span class="fs-host">${escapeHtml(hostOf(u.url) || "")}</span>`;
    el.finalSources.appendChild(a);
  });

  const notes = [c.note];
  if (!frameResult) notes.push("提示：点击上方「搜索片源并自动比对」或「视频帧精确比对」上传该集视频，可获得真实精确时刻。");
  el.finalNote.textContent = notes.filter(Boolean).join(" ");
}

function renderEngineActions(data) {
  el.engineActions.innerHTML = "";
  const keywords = (data.searchKeywords || []).join(" ");
  const fallback = state.mode === "film"
    ? [data.workTitle, data.episode && data.episode !== "—" ? data.episode : "", "影视 截图"].filter(Boolean).join(" ")
    : [data.likelySource, ...(data.detectedText || [])].filter(Boolean).join(" ");
  const query = (keywords || fallback || "image source").slice(0, 160);
  const imageUrl = safeUrl(el.imageUrl.value);

  ENGINES.forEach((eng) => {
    const ok = engineAvailable(eng);
    const btn = document.createElement("button");
    btn.className = "engine-action";
    btn.disabled = !ok;
    const b = document.createElement("span"); b.className = "eb"; b.style.background = eng.color; b.textContent = eng.badge;
    const c = document.createElement("div"); c.className = "ec";
    const st = document.createElement("strong"); st.textContent = eng.name;
    const sm = document.createElement("small");
    sm.textContent = !ok ? "当前区域不可用" : (imageUrl && eng.reverse ? "以图搜图 · 打开核验" : "关键词检索 · 打开核验");
    c.append(st, sm);
    const arrow = document.createElement("span"); arrow.className = "arrow"; arrow.textContent = "↗";
    btn.append(b, c, arrow);

    btn.addEventListener("click", () => {
      let url = eng.home;
      if (imageUrl && eng.reverse) {
        url = eng.reverse(imageUrl);
        toast(`正在用 ${eng.name} 以图搜图…`);
      } else {
        url = eng.text(query);
        toast(imageUrl ? `已按关键词在 ${eng.name} 检索` : `正在 ${eng.name} 检索关键词；如需以图搜图可粘贴图片直链`);
      }
      window.open(url, "_blank", "noopener,noreferrer");
    });
    el.engineActions.appendChild(btn);
  });
}

/* =========================================================
 * 本地历史记录
 * ========================================================= */
const HISTORY_KEY = "vistrace_history_v1";
function readHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
}
function saveHistory(item) {
  const list = readHistory();
  const title = state.mode === "film"
    ? (item.data.workTitle || "影视识别")
    : (item.data.earliestRelease?.title || item.data.likelySource || "来源溯源");
  list.unshift({ mode: item.mode, title, time: item.time, thumb: item.thumb.slice(0, 40000), data: item.data });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 12)));
  renderHistory();
}
function renderHistory() {
  const list = readHistory();
  el.historyList.innerHTML = "";
  if (!list.length) {
    const d = document.createElement("div"); d.className = "history-empty"; d.textContent = "暂无记录，完成一次检索后会自动保存在本地。";
    el.historyList.appendChild(d); return;
  }
  list.forEach((h, idx) => {
    const item = document.createElement("div"); item.className = "history-item";
    const img = document.createElement("img"); img.src = h.thumb; img.alt = "历史图片";
    const copy = document.createElement("div"); copy.className = "hi-copy";
    const strong = document.createElement("strong"); strong.textContent = (h.mode === "film" ? "影视 · " : "来源 · ") + h.title;
    const small = document.createElement("small");
    small.textContent = new Date(h.time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    copy.append(strong, small); item.append(img, copy);
    item.title = "点击查看该次结果";
    item.addEventListener("click", () => {
      state.mode = h.mode;
      syncModeUI();
      state.lastResult = { mode: h.mode, data: h.data, time: h.time, thumb: h.thumb };
      renderResult(h.data);
      el.resultView.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    el.historyList.appendChild(item);
  });
}

/* =========================================================
 * 模式切换 / 事件绑定
 * ========================================================= */
function syncModeUI() {
  const isSource = state.mode === "source";
  el.modeSource.classList.toggle("active", isSource);
  el.modeFilm.classList.toggle("active", !isSource);
  el.modeSource.setAttribute("aria-selected", String(isSource));
  el.modeFilm.setAttribute("aria-selected", String(!isSource));
  el.searchBtnText.textContent = "开始智能检索";
}

function bindEvents() {
  [el.modeSource, el.modeFilm].forEach((btn) => {
    btn.addEventListener("click", () => {
      state.mode = btn.dataset.mode;
      state.timestampClues = [];
      state.originalUrlUsed = "";
      syncModeUI();
    });
  });

  el.dropzone.addEventListener("click", () => el.fileInput.click());
  el.dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.fileInput.click(); } });
  el.fileInput.addEventListener("change", (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });
  el.removeImg.addEventListener("click", (e) => { e.stopPropagation(); clearImage(); });

  ["dragenter", "dragover"].forEach((evt) => el.dropzone.addEventListener(evt, (e) => { e.preventDefault(); el.dropzone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((evt) => el.dropzone.addEventListener(evt, (e) => { e.preventDefault(); el.dropzone.classList.remove("dragover"); }));
  el.dropzone.addEventListener("drop", (e) => { const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f); });

  document.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) { handleFile(f); toast("已粘贴剪贴板图片"); }
        break;
      }
    }
  });

  el.searchBtn.addEventListener("click", runSearch);
  el.retryBtn.addEventListener("click", runSearch);
  el.refreshRegion.addEventListener("click", detectRegion);
  el.continueWithOriginal.addEventListener("click", continueWithOriginal);
  el.refineTimestamp.addEventListener("click", refineTimestamp);

  // 视频帧精确比对事件
  [el.fmSwitchLocal, el.fmSwitchUrl].forEach((btn) => {
    btn.addEventListener("click", () => setFmSource(btn.dataset.src));
  });
  el.fmVideoDrop.addEventListener("click", () => el.fmVideoInput.click());
  el.fmVideoDrop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.fmVideoInput.click(); } });
  el.fmVideoInput.addEventListener("change", (e) => { if (e.target.files[0]) setFmVideoFile(e.target.files[0]); });
  ["dragenter", "dragover"].forEach((evt) => el.fmVideoDrop.addEventListener(evt, (e) => { e.preventDefault(); el.fmVideoDrop.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((evt) => el.fmVideoDrop.addEventListener(evt, (e) => { e.preventDefault(); el.fmVideoDrop.classList.remove("dragover"); }));
  el.fmVideoDrop.addEventListener("drop", (e) => {
    e.stopPropagation();
    const f = e.dataTransfer?.files?.[0];
    if (f && (f.type.startsWith("video/") || /\.(mp4|mov|mkv|webm|avi|flv|m4v|ts)$/i.test(f.name))) setFmVideoFile(f);
    else toast("请拖入视频文件");
  });
  el.fmRunBtn.addEventListener("click", runFrameMatch);
  el.autoSourceBtn.addEventListener("click", () => runAutoSource(false));

  el.copySummary.addEventListener("click", async () => {
    const d = state.lastResult?.data;
    if (!d) return;
    const text = [d.summary, state.mode === "film"
      ? `作品：${d.workTitle}\n集数：${d.episode}\n时刻：${d.timestamp}`
      : `来源：${d.likelySource}\n最早发布：${d.earliestRelease?.title || "未知"}\n链接：${d.earliestRelease?.url || "无"}`,
      d.analysis].filter(Boolean).join("\n\n");
    try { await navigator.clipboard.writeText(text); toast("结果已复制"); }
    catch { toast("复制失败，请手动选择文本"); }
  });

  el.clearHistory.addEventListener("click", () => {
    if (!readHistory().length) { toast("暂无记录"); return; }
    localStorage.removeItem(HISTORY_KEY);
    renderHistory(); toast("本地记录已清空");
  });
}

/* =========================================================
 * 启动
 * ========================================================= */
(async function init() {
  bindEvents();
  renderEngineList();
  renderHistory();
  syncModeUI();

  if (typeof WorkBuddyCloud === "undefined") {
    el.cloudChipText.textContent = "SDK 加载失败";
    el.cloudChip.querySelector(".dot").className = "dot err";
    toast("云端 SDK 加载失败，请检查网络");
  } else {
    await initCloud();
  }

  detectRegion();
})();
