import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const STATE = 'movies-state.json';
export function parseMovies(data) {
  if (!Array.isArray(data?.results) || data.results.length < 10) throw new Error('TMDB 回傳不足 10 部，保留原紀錄');
  const movies = data.results.slice(0, 10);
  if (movies.some(m => !Number.isInteger(m.id) || m.id <= 0 || typeof m.title !== 'string' || !m.title.trim()) || new Set(movies.map(m=>m.id)).size !== 10) throw new Error('電影資料格式異常');
  return movies;
}
export function taipeiDate(now) {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(now);
  const p = Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function plan(movies, old, now, force=false) {
  const date = taipeiDate(now);
  const friday = new Date(`${date}T00:00:00+08:00`).getUTCDay() === 4; // 台灣週五零時對應 UTC 週四
  const weekly = friday && old?.lastDigestDate !== date;
  const fresh = old ? movies.filter(m=>!old.ids.includes(m.id)) : [];
  const mode = force ? 'test' : !old ? 'initial' : weekly ? 'weekly' : fresh.length ? 'new' : 'none';
  return {mode, selected: mode === 'new' ? fresh : movies.slice(0,5), date, weekly};
}
const compact = (s,n) => [...String(s).replace(/\s+/g,' ').trim()].slice(0,n).join('');
export function message(p, movies) {
  const headings = {test:'🧪 電影小報測試',initial:'✅ 電影雷達啟動｜本週熱門前 5 名',weekly:'🎬 週末電影小報｜本週熱門前 5 名',new:'👀 有電影新進本週熱門前 10 名'};
  const lines = p.selected.map(m=>{
    const rank = movies.findIndex(x=>x.id===m.id)+1;
    const score = Number.isFinite(m.vote_average) && m.vote_count > 0 ? `${m.vote_average.toFixed(1)}/10（${m.vote_count} 票）` : '暫無評分';
    return `第 ${rank} 名｜${compact(m.title,100)}\n評分：${score}\n${compact(m.overview || '暫無中文簡介',180)}\nhttps://www.themoviedb.org/movie/${m.id}`;
  });
  return `${headings[p.mode]}\n${p.date}（台灣日期）\n\n${lines.join('\n\n')}\n\n資料：TMDB 全球趨勢榜；非台灣票房榜，部分片名／簡介可能無繁中翻譯。\nThis product uses the TMDB API but is not endorsed or certified by TMDB.`;
}
async function request(url, options) {
  let r;
  try { r = await fetch(url,{...options,signal:AbortSignal.timeout(20000)}); }
  catch { throw new Error('API 連線失敗或逾時，未保存新紀錄'); }
  if (!r.ok) throw new Error(`API HTTP ${r.status}，未保存新紀錄`);
  try { return await r.json(); } catch { throw new Error('API 回應不是 JSON'); }
}
export async function main() {
  const dry = process.argv.includes('--dry-run');
  const {TMDB_READ_ACCESS_TOKEN:tmdb,LINE_CHANNEL_ACCESS_TOKEN:line,LINE_USER_ID:user} = process.env;
  if (!tmdb || (!dry && (!line || !user))) throw new Error('請設定 TMDB_READ_ACCESS_TOKEN、LINE_CHANNEL_ACCESS_TOKEN、LINE_USER_ID');
  let old = null;
  try { old=JSON.parse(await fs.readFile(STATE,'utf8')); }
  catch(e) { if(e.code!=='ENOENT') throw new Error('movies-state.json 損壞'); }
  if (old && (old.version !== 1 || !Array.isArray(old.ids) || old.ids.length !== 10 || old.ids.some(id=>!Number.isInteger(id)) || (old.lastDigestDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(old.lastDigestDate)))) throw new Error('電影狀態格式異常');
  const data = await request('https://api.themoviedb.org/3/trending/movie/week?language=zh-TW', {headers:{Authorization:`Bearer ${tmdb}`}});
  const movies = parseMovies(data);
  const p = plan(movies,old,new Date(),process.env.FORCE_NOTIFY === 'true');
  console.log(`電影雷達：${p.date}；模式=${p.mode}；本次新進榜=${old ? movies.filter(m=>!old.ids.includes(m.id)).length : 0}`);
  if (dry) { console.log(p.mode==='none' ? '沒有需要通知的變動' : message(p,movies)); return; }
  if (p.mode !== 'none') {
    const sent=await request('https://api.line.me/v2/bot/message/push', {
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${line}`},
      body:JSON.stringify({to:user,messages:[{type:'text',text:message(p,movies)}]})
    });
    if (!Array.isArray(sent.sentMessages)) throw new Error('LINE 回應異常，未保存新紀錄');
  }
  const next={version:1,ids:movies.map(m=>m.id),lastDigestDate:p.weekly && p.mode!=='test' ? p.date : old?.lastDigestDate ?? null};
  const content=JSON.stringify(next,null,2)+'\n';
  if (JSON.stringify(old)!==JSON.stringify(next)) {
    await fs.writeFile(`${STATE}.tmp`,content);
    await fs.rename(`${STATE}.tmp`,STATE);
  }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(e=>{console.error(e.message);process.exitCode=1;});
