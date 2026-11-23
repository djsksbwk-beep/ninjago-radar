// Met à jour data.json : vidéos Ninjago de toutes durées, hors Shorts publiées ces 15 derniers jours, avec score de percée.
import { writeFileSync } from "node:fs";

const KEY = process.env.YT_API_KEY;
if (!KEY) { console.error("Secret YT_API_KEY manquant (Settings > Secrets and variables > Actions)."); process.exit(1); }

const KEYWORDS = ["Ninjago","Lego Ninjago","Ninjago set","Ninjago saison","Ninjago théorie","Ninjago review","Ninjago speed build","Ninjago MOC","Ninjago minifigures"];
const FETCH_DAYS = 15;

async function api(path, params) {
  const u = new URL("https://www.googleapis.com/youtube/v3/" + path);
  Object.entries({ ...params, key: KEY }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const reason = j.error?.errors?.[0]?.reason || "";
    throw new Error("Erreur YouTube " + r.status + " (" + reason + ") : " + (j.error?.message || ""));
  }
  return j;
}
function parseDur(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso) || [];
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

async function main() {
  const after = new Date(Date.now() - FETCH_DAYS * 864e5).toISOString();
  const ids = new Set();
  // On cherche par tranche de durée (courte, moyenne, longue) pour ne rater aucune vidéo, même de 1 à 6 minutes
  for (const q of KEYWORDS) {
    for (const videoDuration of ["short", "medium", "long"]) {
      const j = await api("search", { part: "id", type: "video", q, videoDuration, publishedAfter: after, order: "viewCount", maxResults: 50 });
      (j.items || []).forEach(it => it.id?.videoId && ids.add(it.id.videoId));
    }
  }
  const list = [...ids], raw = [];
  for (let i = 0; i < list.length; i += 50) {
    const j = await api("videos", { part: "snippet,statistics,contentDetails", id: list.slice(i, i + 50).join(",") });
    raw.push(...(j.items || []));
  }
  // Toutes les durées sont gardées (plus de 20 s, pour écarter les directs sans durée), sauf les Shorts déclarés (#shorts)
  const vids = raw.filter(v => {
    const txt = v.snippet.title + " " + (v.snippet.description || "") + " " + (v.snippet.tags || []).join(" ");
    return parseDur(v.contentDetails.duration) >= 20 && /ninjago/i.test(txt) && !/#shorts?\b/i.test(txt);
  });
  const chIds = [...new Set(vids.map(v => v.snippet.channelId))], chans = {};
  for (let i = 0; i < chIds.length; i += 50) {
    const j = await api("channels", { part: "statistics", id: chIds.slice(i, i + 50).join(",") });
    (j.items || []).forEach(c => (chans[c.id] = c.statistics));
  }
  const videos = vids.map(v => {
    const c = chans[v.snippet.channelId] || {};
    const views = +v.statistics.viewCount || 0;
    const subs = c.hiddenSubscriberCount ? 0 : (+c.subscriberCount || 0);
    const avg = +c.videoCount > 0 ? +c.viewCount / +c.videoCount : 0;
    const vsAvg = avg > 0 ? views / avg : 0, vsSubs = subs > 0 ? views / subs : 0;
    const score = subs > 0 && avg > 0 ? vsAvg * 0.6 + vsSubs * 0.4 : (vsAvg || vsSubs);
    return {
      id: v.id, title: v.snippet.title, channel: v.snippet.channelTitle, subs, views,
      likes: +v.statistics.likeCount || 0, dur: parseDur(v.contentDetails.duration), published: v.snippet.publishedAt,
      thumb: (v.snippet.thumbnails.medium || v.snippet.thumbnails.default || {}).url || "",
      score: Math.round(score * 10) / 10
    };
  });
  writeFileSync("data.json", JSON.stringify({ updated: Date.now(), videos }, null, 1));
  console.log(videos.length + " vidéos enregistrées dans data.json");
}
main().catch(e => { console.error(e.message); process.exit(1); });
