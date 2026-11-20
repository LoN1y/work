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
async function webSearch(queries) {
  const qs = (Array.isArray(queries) ? queries : [queries])
    .map((q) => String(q).trim()).filter(Boolean).slice(0, 4);
  if (!qs.length) return { ok: false, results: [], queries: qs, error: "没有搜索词" };

  const jobs = [];
  for (const q of qs) {
    jobs.push(fetchText("https://www.so.com/s?q=" + encodeURIComponent(q) + "&src=3600w").then(({ text }) => parse360(text)).catch(() => []));
    jobs.push(fetchText("https://cn.bing.com/search?q=" + encodeURIComponent(q) + "&format=rss").then(({ text }) => parseRss(text)).catch(() => []));
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
  return { ok: true, results: merged.slice(0, 20), queries: qs };
}

/* =========================================================
 * 片源定向搜索（影视兜底链路第一步）
 * 把搜索结果按"能否用于视频帧比对"分类：
 *   direct   —— 直链视频文件(.mp4/.m3u8...)，ffmpeg 可直接读取，最适合比对
 *   platform —— 正规视频平台播放页(B站/爱奇艺/腾讯等)，多数需鉴权，需用户下载后本地比对
 *   page     —— 其它网页(百科/讨论/资讯)，用于辅助确认作品与时刻
 * 仅做公开信息检索与分类，是否可直读由 /api/probe-sources 用 ffmpeg 实测决定。
 * ========================================================= */
const DIRECT_VIDEO_RE = /\.(mp4|m3u8|mkv|webm|avi|flv|ts|m4v)(\?|#|$)/i;
const PLATFORM_RE = /(bilibili\.com|b23\.tv|iqiyi\.com|youku\.com|v\.qq\.com|mgtv\.com|le\.com|sohu\.com\/v|acfun\.cn|douyin\.com|kuaishou\.com|pptv\.com|1905\.com|m\.?time\.com)/i;

function classifySource(item) {
  const url = item.url || "";
  let kind = "page";
  if (DIRECT_VIDEO_RE.test(url)) kind = "direct";
  else if (PLATFORM_RE.test(url)) kind = "platform";
  return { ...item, kind };
}

/**
 * 片源搜索：调用真实联网搜索后，对结果按可比对性分类并排序
 * @param {string[]} queries 片源导向的搜索词（前端基于作品名/集数生成）
 */
async function searchVideoSources(queries) {
  const base = await webSearch(queries);
  const results = (base.results || []).map(classifySource);
  const rank = { direct: 0, platform: 1, page: 2 };
  results.sort((a, b) => (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3));
  const counts = {
    direct: results.filter((r) => r.kind === "direct").length,
    platform: results.filter((r) => r.kind === "platform").length,
    page: results.filter((r) => r.kind === "page").length,
  };
  return {
    ok: base.ok && results.length > 0,
    queries: base.queries,
    counts,
    results: results.slice(0, 24),
    error: base.error,
  };
}

module.exports = { webSearch, searchVideoSources, classifySource, parse360, parseRss, fetchText };
