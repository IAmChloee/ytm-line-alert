import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const STATE='movies-state.json';
export const SECTIONS=[['cinema','🍿 出門看｜台灣近期院線'],['netflix','🏠 在家看｜1. Netflix'],['disney','🏠 在家看｜2. Disney+'],['hbo','🏠 在家看｜3. HBO／Max'],['other','🏠 在家看｜4. 其他平台']];
export function platform(name) {
  const n=String(name).trim();
  if (/^netflix(?:$|\s)/i.test(n)) return 'netflix';
  if (/^disney(?:\s*\+|\s+plus(?:$|\s))/i.test(n)) return 'disney';
  if (/^(?:hbo(?:$|\s)|max(?:$|\s))/i.test(n)) return 'hbo';
  return 'other';
}
export function list(data,field='results') {
  if (!Array.isArray(data?.[field])) throw new Error('TMDB 回傳格式異常，保留舊紀錄');
  return data[field];
}
export function movies(data) {
  const result=list(data).slice(0,10);
  if(result.some(m=>!Number.isInteger(m.id)||m.id<=0||typeof m.title!=='string'||!m.title.trim())||new Set(result.map(m=>m.id)).size!==result.length) throw new Error('電影清單格式異常');
  return result;
}
export function subscriptions(data) {
  if(!data?.results || typeof data.results!=='object'||Array.isArray(data.results)) throw new Error('觀看平台格式異常');
  const tw=data.results.TW;
  if(!tw) return [];
  if(typeof tw!=='object'||Array.isArray(tw)) throw new Error('台灣平台格式異常');
  if(tw.flatrate!==undefined && !Array.isArray(tw.flatrate)) throw new Error('訂閱平台格式異常');
  const providers=tw.flatrate??[];
  if(providers.some(p=>!Number.isInteger(p.provider_id)||typeof p.provider_name!=='string')) throw new Error('平台欄位異常');
  return providers;
}
async function json(url,options) {
  let r;
  try{r=await fetch(url,{...options,signal:AbortSignal.timeout(10000)});}catch{throw new Error('API 網路失敗或逾時，未更新電影紀錄');}
  if(!r.ok) throw new Error(`API HTTP ${r.status}，未更新電影紀錄`);
  try{return await r.json();}catch{throw new Error('API 回應不是 JSON');}
}
export async function collect(api) {
  const catalog=list(await api('/watch/providers/movie',{watch_region:'TW',language:'en-US'}));
  if(!catalog.length || catalog.some(p=>!Number.isInteger(p.provider_id)||typeof p.provider_name!=='string')) throw new Error('台灣平台清單異常');
  const ids=Object.fromEntries(SECTIONS.slice(1).map(([key])=>[key,catalog.filter(p=>platform(p.provider_name)===key).map(p=>p.provider_id)]));
  const sections={cinema:{available:true,items:movies(await api('/movie/now_playing',{region:'TW',language:'zh-TW'}))}};
  // 分開查各平台熱門片，不只把全球前十名分組，避免某平台永遠沒有片。
  await Promise.all(SECTIONS.slice(1).map(async([key])=>{
    if(!ids[key].length){sections[key]={available:false,items:[]};return;}
    sections[key]={available:true,items:movies(await api('/discover/movie',{
      language:'zh-TW',watch_region:'TW',with_watch_providers:ids[key].join('|'),
      with_watch_monetization_types:'flatrate',sort_by:'popularity.desc',include_adult:'false',include_video:'false'
    }))};
  }));
  const candidates=[...new Set(SECTIONS.slice(1).flatMap(([key])=>sections[key].items.map(m=>m.id)))];
  const providers=new Map();let index=0;
  await Promise.all(Array.from({length:Math.min(5,candidates.length)},async()=>{
    while(index<candidates.length){const id=candidates[index++];providers.set(id,subscriptions(await api(`/movie/${id}/watch/providers`)));}
  }));
  for(const [key] of SECTIONS.slice(1)){
    sections[key].items=sections[key].items.flatMap(m=>{
      const matched=providers.get(m.id).filter(p=>platform(p.provider_name)===key);
      return matched.length ? [{...m,platformNames:[...new Set(matched.map(p=>p.provider_name))]}] : [];
    });
  }
  return Object.fromEntries(SECTIONS.map(([key])=>[key,sections[key]]));
}
export function dateInTaipei(now) {return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function validateState(old) {
  if(old===null) return;
  const validIds=ids=>Array.isArray(ids)&&ids.every(n=>Number.isInteger(n)&&n>0)&&new Set(ids).size===ids.length;
  if(old.version===1){if(!validIds(old.ids))throw new Error('舊電影紀錄損壞');return;}
  if(old.version!==2 || !old.sections || SECTIONS.some(([k])=>!validIds(old.sections[k]))) throw new Error('分類電影紀錄損壞');
  if(old.lastDigestDate!==null && !/^\d{4}-\d{2}-\d{2}$/.test(old.lastDigestDate)) throw new Error('週報日期格式異常');
}
export function plan(sections,old,now,force=false) {
  validateState(old);
  const date=dateInTaipei(now);
  const friday=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',weekday:'short'}).format(now)==='Fri';
  const initial=old?.version!==2;
  const weekly=friday && (initial || old.lastDigestDate!==date);
  const fresh=Object.fromEntries(SECTIONS.map(([k])=>[k,initial?[]:sections[k].items.filter(m=>!old.sections[k].includes(m.id))]));
  const mode=force?'test':initial?'initial':weekly?'weekly':SECTIONS.some(([k])=>fresh[k].length)?'new':'none';
  return {date,mode,selected:Object.fromEntries(SECTIONS.map(([k])=>[k,(mode==='new'?fresh[k]:sections[k].items).slice(0,3)])),counts:Object.fromEntries(SECTIONS.map(([k])=>[k,fresh[k].length])),next:{version:2,sections:Object.fromEntries(SECTIONS.map(([k])=>[k,sections[k].available?sections[k].items.map(m=>m.id):old?.version===2?old.sections[k]:[]])),lastDigestDate:weekly&&mode!=='test'?date:initial?null:old.lastDigestDate}};
}
const cut=(s,n)=>[...String(s).replace(/\s+/g,' ').trim()].slice(0,n).join('');
export function render(p,sections) {
  const headings={initial:'✅ 分類電影雷達已啟動',test:'🧪 分類電影小報測試',weekly:'🎬 週末看什麼？',new:'👀 分類熱門片單有新進榜'};
  const blocks=SECTIONS.map(([key,label])=>{
    const items=p.selected[key];
    const note=!sections[key].available?'TMDB 台灣平台清單未提供此平台，暫無法查詢。':!sections[key].items.length?'本次未查得符合條件的電影。':!items.length?'本次沒有新進榜。':'';
    const lines=items.map(m=>{
      const score=Number.isFinite(m.vote_average)&&m.vote_count>0?`${m.vote_average.toFixed(1)}/10（${m.vote_count}票）`:'暫無評分';
      return `${cut(m.title,50)}｜${score}\n${m.platformNames?`平台：${cut(m.platformNames.join('、'),60)}\n`:''}${cut(m.overview||'暫無中文簡介',65)}\nhttps://www.themoviedb.org/movie/${m.id}${key==='cinema'?'':'/watch?locale=TW'}`;
    });
    return `${label}${p.mode==='new'&&p.counts[key]?`（新進 ${p.counts[key]} 部，最多列 3 部）`:''}\n${note||lines.join('\n\n')}`;
  });
  const text=`${headings[p.mode]}\n${p.date}｜台灣地區｜每類最多 3 部\n\n${blocks.join('\n\n')}\n\n依 TMDB 熱度選片，非各平台官方觀看榜或票房榜。院線狀態請查影城場次；在家看片單僅列訂閱項目，不含單片租借／購買。資料可能延遲或缺漏，請以平台為準。\n資料：TMDB；串流供應資訊：JustWatch。\nThis product uses the TMDB API but is not endorsed or certified by TMDB.`;
  if(text.length>4900) throw new Error('電影小報超過訊息長度，未發送');
  return text;
}
export async function main() {
  const dry=process.argv.includes('--dry-run');
  const {TMDB_READ_ACCESS_TOKEN:tmdb,LINE_CHANNEL_ACCESS_TOKEN:line,LINE_USER_ID:user}=process.env;
  if(!tmdb||(!dry&&(!line||!user)))throw new Error('請確認 TMDB 與 LINE Secrets');
  let old=null;try{old=JSON.parse(await fs.readFile(STATE,'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('電影紀錄讀取失敗');}validateState(old);
  const api=(path,params={})=>json(`https://api.themoviedb.org/3${path}?${new URLSearchParams(params)}`,{headers:{Authorization:`Bearer ${tmdb}`}});
  const sections=await collect(api);
  const p=plan(sections,old,new Date(),process.env.FORCE_NOTIFY==='true');
  console.log(`${p.date} 分類電影雷達：${p.mode}`);
  for(const [k]of SECTIONS)console.log(`${k}: available=${sections[k].available}, total=${sections[k].items.length}, new=${p.counts[k]}`);
  if(dry){if(p.mode!=='none')console.log(render(p,sections));return;}
  if(p.mode!=='none'){
    const result=await json('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${line}`},body:JSON.stringify({to:user,messages:[{type:'text',text:render(p,sections)}]})});
    if(!Array.isArray(result.sentMessages))throw new Error('LINE 回應異常，保留舊紀錄');
  }
  if(JSON.stringify(old)!==JSON.stringify(p.next)){await fs.writeFile(`${STATE}.tmp`,JSON.stringify(p.next,null,2)+'\n');await fs.rename(`${STATE}.tmp`,STATE);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(e=>{console.error(e.message);process.exitCode=1;});
