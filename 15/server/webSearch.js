/* =========================================================
 * webSearch.js — 真实联网搜索
 *
 * 数据源实测结论（中国大陆 IP，2026-11）：
 *  - 360 搜索(so.com)：中文关键词效果最好，能精准命中花瓣网/壁纸站/
 *    BoBoPic 等具体图源，返回 data-mdurl 直达真实 URL。作为主数据源。
 *  - Bing RSS(cn.bing.com?format=rss)：结果稳定但偏角色百科，作补充。
 *  - Google 超时、百度反爬、Yandex 302、Brave/DDG 超时 —— 均不可用。
 * ========================================================= */
const https = require("https");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function fetchText(url, timeout = 12000, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 3) return reject(new Error("重定向过多"));
    const req = https.get(url, { headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchText(new URL(res.headers.location, url).href, timeout, redirects + 1).then(resolve, reject);
      }
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { data += c; if (data.length > 2_000_000) req.destroy(); });
      res.on("end", () => resolve({ status: res.statusCode, text: data }));
    });
    req.on("error", reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error("请求超时")); });
  });
}

function decode(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}

/** 解析 360 搜索 HTML */
function parse360(html) {
  const blocks = [...html.matchAll(/<h3[^>]*class="[^"]*res-title[^"]*"[^>]*>[\s\S]*?<a[^>]*data-mdurl="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const out = [];
  for (const m of blocks) {
    let url = decode(m[1]);
    const title = decode(m[2]);
    // 摘要：取结果块后一段文本（粗略）
    if (!/^https?:\/\//.test(url) || !title) continue;
    let site = "";
    try { site = new URL(url).hostname.replace(/^www\./, ""); } catch (_) {}
    out.push({ title, url, snippet: "", site });
  }
  return out;
}

/** 解析 Bing RSS */
function parseRss(xml) {
  const out = [];
  for (const m of [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]) {
    const b = m[1];
    const tm = b.match(/<title>([\s\S]*?)<\/title>/i), lm = b.match(/<link>([\s\S]*?)<\/link>/i), dm = b.match(/<description>([\s\S]*?)<\/description>/i);
    if (!tm || !lm) continue;
    const url = decode(lm[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
    const title = decode(tm[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
    if (!/^https?:\/\//.test(url) || !title) continue;
    let site = ""; try { site = new URL(url).hostname.replace(/^www\./, ""); } catch (_) {}
    out.push({ title, url, snippet: dm ? decode(dm[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).slice(0, 300) : "", site });
  }
  return out;
}

/**
 * 真实联网搜索：360(中文) + Bing(RSS) 双源合并去重
 * @param {string[]} queries 关键词数组
 */
async function webSearch(queries, opts = {}) {
  const maxQueries = opts.maxQueries || 4;
  const maxResults = opts.maxResults || 20;
  const qs = (Array.isArray(queries) ? queries : [queries])
    .map((q) => String(q).trim()).filter(Boolean).slice(0, maxQueries);
  if (!qs.length) return { ok: false, results: [], queries: qs, error: "没有搜索词" };

  const jobs = [];
  for (const q of qs) {
    jobs.push(fetchText("https://www.so.com/s?q=" + encodeURIComponent(q) + "&src=3600w").then(({ text }) => parse360(text)).catch(() => []));
    jobs.push(fetchText("https://cn.bing.com/search?q=" + encodeURIComponent(q) + "&format=rss").then(({ text }) => parseRss(text)).catch(() => []));
    // 国际 Bing RSS：日文/英文关键词（官方 PV、官网、YouTube）命中率更高
    jobs.push(fetchText("https://www.bing.com/search?q=" + encodeURIComponent(q) + "&format=rss&setlang=ja").then(({ text }) => parseRss(text)).catch(() => []));
  }
  const settled = await Promise.allSettled(jobs);

  const seen = new Set();
  const merged = [];
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value) {
      const key = item.url.replace(/[?#].*$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  if (!merged.length) return { ok: false, results: [], queries: qs, error: "未获取到搜索结果，请稍后重试" };
  return { ok: true, results: merged.slice(0, maxResults), queries: qs };
}

/* =========================================================
 * 片源定向搜索（影视兜底链路第一步）
 * 把搜索结果按"能否用于视频帧比对 / 是否公开可访问"分类：
 *   direct   —— 直链视频文件(.mp4/.m3u8...)，ffmpeg 可直接读取，最适合比对
 *   official —— 官方/公开短片源页（官网 PV、YouTube 官方频道、B站官方账号剪辑、预告/特辑），
 *               多为公开可访问、无强鉴权，最可能抓到画面做比对
 *   free     —— 免费动漫片源站页面（樱花动漫/AGE/哔哩哔哩动漫等），公开可访问但内容站性质，
 *               作为"公开页面候选"列出，用户自行点开查看；系统不自动登录/抓取其内容
 *   platform —— 需登录/DRM 的大型视频平台播放页(B站/爱奇艺/腾讯/优酷等)，用户下载后本地比对
 *   page     —— 其它网页(百科/讨论/资讯)，用于辅助确认作品与时刻
 * 仅做公开信息检索与分类，是否可直读由 /api/probe-sources 用 ffmpeg 实测决定。
 * 注意：不做任何绕过登录/防盗链/DRM 的行为，不抓取受保护内容。
 * ========================================================= */
const DIRECT_VIDEO_RE = /\.(mp4|m3u8|mkv|webm|avi|flv|ts|m4v)(\?|#|$)/i;
const PLATFORM_RE = /(bilibili\.com|b23\.tv|iqiyi\.com|youku\.com|v\.qq\.com|mgtv\.com|le\.com|sohu\.com\/v|acfun\.cn|douyin\.com|kuaishou\.com|pptv\.com|1905\.com|m\.?time\.com)/i;
// 官方域名（明确可公开访问的官方站）：优先判为 official
const OFFICIAL_DOMAIN_RE = /(youtube\.com|youtu\.be|kamen-rider|toei\.co\.jp|tv-asahi\.co\.jp|bandai|asc\.co\.jp)/i;
// 官方短片源标题标志（收紧：去掉"初登场"这类会把无关作品误判为官方的泛词）
const OFFICIAL_TITLE_RE = /(pv|予告|预告|trailer|official|公式|特辑|\bcm\b|\bspot\b)/i;
// 免费动漫片源站（仅作为公开页面候选列出，供用户手动打开）
const FREE_SITE_RE = /(yuc\.wiki|樱花动漫|yinghuacd|agefans|agemv|dilidili|moutv|bt4g|ddys\.tv|omofun|nipic|动漫花园|dmhy\.org)/i;

function classifySource(item) {
  const url = item.url || "";
  const title = item.title || "";
  let kind = "page";
  if (DIRECT_VIDEO_RE.test(url)) kind = "direct";
  else if (OFFICIAL_DOMAIN_RE.test(url)) kind = "official";
  else if (FREE_SITE_RE.test(url) || FREE_SITE_RE.test(title)) kind = "free";
  else if (PLATFORM_RE.test(url)) kind = "platform";   // 平台判定在标题标志之前，避免 B站"初登场"被泛词误判为官方
  else if (OFFICIAL_TITLE_RE.test(title)) kind = "official";
  return { ...item, kind };
}

/**
 * 片源搜索：调用真实联网搜索后，对结果按可比对性分类并排序
 * @param {string[]} queries 片源导向的搜索词（前端基于作品名/集数生成）
 */
async function searchVideoSources(queries) {
  // 片源搜索放宽限制：最多 6 组多语言关键词，保留更多候选
  const base = await webSearch(queries, { maxQueries: 6, maxResults: 40 });
  const results = (base.results || []).map(classifySource);
  // 可比对优先级：直链 > 官方短片源 > 免费片源站页面 > 大平台 > 普通页面
  const rank = { direct: 0, official: 1, free: 2, platform: 3, page: 4 };
  results.sort((a, b) => (rank[a.kind] ?? 5) - (rank[b.kind] ?? 5));
  const counts = {
    direct: results.filter((r) => r.kind === "direct").length,
    official: results.filter((r) => r.kind === "official").length,
    free: results.filter((r) => r.kind === "free").length,
    platform: results.filter((r) => r.kind === "platform").length,
    page: results.filter((r) => r.kind === "page").length,
  };
  return {
    ok: base.ok && results.length > 0,
    queries: base.queries,
    counts,
    results: results.slice(0, 30),
    error: base.error,
  };
}

module.exports = { webSearch, searchVideoSources, classifySource, parse360, parseRss, fetchText };
