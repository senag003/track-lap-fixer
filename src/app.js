/* ================= UI ================= */
const $=id=>document.getElementById(id);
const S={model:null,E:null,name:"",sample:false,metric:"hr",last:null,prev:null,pv:"new"};
const downloadsP=(window.claude&&window.claude.use)?window.claude.use("downloads").catch(()=>null):Promise.resolve(null);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmtTime=s=>{s=Math.max(0,Math.round(s));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return (h?h+":"+String(m).padStart(2,"0"):m)+":"+String(x).padStart(2,"0");};
const fmtDur=s=>{const sg=s<0?"−":"+"; s=Math.abs(Math.round(s)); const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),x=s%60; return sg+[d?d+" d":"",h?h+" h":"",m?m+" min":"",x?x+" s":""].filter(Boolean).join(" ")||"0";};
function curSport(){ const E=S.E; if(E&&E.sport>=0) return [SPORTS[E.sport][1],SPORTS[E.sport][2]]; return [S.model?.sport,S.model?.sub]; }
const paceSport=sp=>PACE_SPORTS.includes(sp??1);
const isPace=()=>paceSport(curSport()[0]);
const fmtSpeedFor=(pace,tt,d)=>{ if(!(d>0)||!(tt>0)) return "–"; return pace?fmtTime(tt/(d/1000)):fmtDec(d/tt*3.6,1); };
const fmtSpeed=(tt,d)=>fmtSpeedFor(isPace(),tt,d);
const unitFor=pace=>pace?"/km":"km/h";
const speedUnit=()=>unitFor(isPace());
const fmtKm=m=>fmtDec(m/1000,2);
const fmtM=m=>{const r=Math.round(m*10)/10;return Number.isInteger(r)?String(r):r.toFixed(1);};
const trackLen=()=>Math.max(1,Number($("trackLen").value)||200);
const cadMulFor=sp=>[1,11,17].includes(sp)?2:1;
const cadMul=()=>cadMulFor(curSport()[0]);
const fitDate=ts=>ts!=null?new Date((ts+FIT_EPOCH)*1000):null;
const pad2=n=>String(n).padStart(2,"0");
const toLocalInput=d=>`${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

function toast(x){const el=$("toast");el.textContent=x;el.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>el.hidden=true,4200);}
function showErr(x){$("err").textContent=x||"";$("err").hidden=!x;}

/* ---- language ---- */
function applyStatic(){
  document.documentElement.lang=LANG;
  document.querySelectorAll("[data-i18n]").forEach(el=>{el.innerHTML=t(el.dataset.i18n);});
  document.querySelectorAll("[data-i18n-title]").forEach(el=>el.title=t(el.dataset.i18nTitle));
  document.querySelectorAll("[data-i18n-aria]").forEach(el=>el.setAttribute("aria-label",t(el.dataset.i18nAria)));
  document.querySelectorAll("[data-i18n-ph]").forEach(el=>el.placeholder=t(el.dataset.i18nPh));
}
$("lang").innerHTML=LANGS.map(([c,n])=>`<option value="${c}">${n}</option>`).join("");
$("lang").value=LANG;
$("lang").addEventListener("change",e=>{
  LANG=e.target.value; try{localStorage.setItem("tlf-lang",LANG);}catch(_){}
  applyStatic(); renderOriginals(); if(S.model){ fillFileInfo(); fillSport(); fillRemove(); fillDevice(); showRepair(); updateCropLabels(); updateShiftUi(); updateSpikeInfo(); updateImportInfo(); updateSplitLabel(); renderAll(); }
});

/* ---- loading ---- */
function fillFileInfo(){
  const m=S.model;
  $("fileName").innerHTML=(S.sample?`<span class="tag">${esc(t("sample_tag"))}</span>`:"")+esc(S.sample?t("sample_name"):S.name);
  const d=fitDate(m.created??m.t0);
  $("fileSub").textContent=(S.sample?t("sample_sub")+" · ":"")+sportName(m.sport,m.sub)+(d?" · "+d.toLocaleDateString(loc(),{weekday:"long",day:"numeric",month:"long",year:"numeric"}):"");
  showErr(m.hasRecordDist?"":t("nodist"));
}
function fillSport(){
  const m=S.model;
  $("sport").innerHTML=`<option value="-1">${esc(t("keep_x",{x:sportName(m.sport,m.sub)}))}</option>`+SPORTS.map((s,i)=>`<option value="${i}">${esc(t(s[0]))}</option>`).join("");
  $("sport").value=String(S.E.sport);
}
function fillRemove(){
  const m=S.model, keys=[["hr","rm_hr"],["cad","rm_cad"],["pwr","rm_pwr"],["gps","rm_gps"],["alt","rm_alt"]];
  $("rmList").innerHTML=keys.map(([k,lab])=>{const has=m.has[k];return `<label class="${has?"":"na"}"><input type="checkbox" data-rm="${k}" ${S.E.remove[k]?"checked":""} ${has?"":"disabled"}><span>${esc(t(lab))}${has?"":` <span class="hint">(${esc(t("rm_missing"))})</span>`}</span></label>`;}).join("");
}
function updateCropLabels(){
  const m=S.model, E=S.E;
  $("cropStartLabel").textContent=fmtTime((E.cropStart??m.t0)-m.t0);
  $("trimLabel").textContent=fmtTime((E.trim??m.t1)-m.t0)+(E.trim==null&&E.cropStart==null?" "+t("whole"):"");
}
function updateShiftUi(){
  const m=S.model, d=fitDate(m.t0+(S.E.shift||0));
  if(d) $("shiftAt").value=toLocalInput(d);
  $("shiftInfo").textContent=S.E.shift?t("shift_by",{x:fmtDur(S.E.shift)}):"";
}
function readSpike(){
  const mode=document.querySelector("input[name=spikeMode]:checked").value;
  $("jumpField").hidden=mode!=="jump"; $("limitField").hidden=mode!=="limit";
  if(mode==="off") return null;
  if(mode==="jump"){const v=parseInt($("hrJump").value,10); return v>=10?{mode,jump:v}:null;}
  const v=parseInt($("hrMax").value,10); return v>=60?{mode,limit:v}:null;
}
function updateSpikeInfo(){
  const m=S.model, E=S.E, maxHr=m.has.hr?m.records.reduce((a,r)=>r.hr!=null&&r.hr>a?r.hr:a,0):null;
  $("hrMaxFile").textContent=m.has.hr?t("spike_maxinfo",{x:maxHr}):t("rm_missing");
  let info="";
  if(E.spike&&m.has.hr){
    const kept=m.records.filter(r=>r.ts!=null), F=editFlags(m,E), ov=hrOverrides(m,E,kept,F);
    info=E.spike.mode==="jump"?t("spike_n_jump",{n:ov?ov.spikes:0}):t("spike_n_hr",{n:ov?ov.spikes:0,x:E.spike.limit});
    if(E.spike.mode==="limit"&&E.spike.limit<maxHr) info+=" "+t("spike_limit_warn",{x:maxHr});
  }
  $("hrMaxInfo").textContent=info;
  $("pwrField").hidden=!m.has.pwr;
  $("pwrMaxInfo").textContent=E.pwrMax>0?t("spike_n_pwr",{n:m.records.filter(r=>r.pwr!=null&&r.pwr>E.pwrMax).length,x:E.pwrMax}):t("spike_none");
}
function fillDevice(){
  const m=S.model, cur=DEVICES.find(d=>d[1]===m.product);
  $("device").innerHTML=`<option value="">${esc(t("dev_keep",{x:cur?cur[0]:t("dev_unknown")}))}</option>`+DEVICES.map(([n,id])=>`<option value="${id}">${esc(n)}</option>`).join("");
  $("device").value=S.E.device?String(S.E.device):"";
}
function updateImportInfo(){
  const E=S.E, imp=E.hrImport;
  $("importClear").hidden=!imp; $("importOffField").hidden=!imp;
  if(!imp){$("importInfo").textContent="";return;}
  const m=S.model, kept=m.records.filter(r=>r.ts!=null), n=matchHr(kept,imp).size;
  $("importInfo").textContent=t("imp_info",{n:fmtInt(n),m:fmtInt(kept.length),x:imp.name});
}
// The split point snaps to a lap boundary: part 2 starts with lap k.
function splitBounds(){ const G=derive(S.model,S.E); return G.slice(1).map((g,i)=>({k:i+2,ts:g.start})); }
function updateSplitLabel(){
  const b=splitBounds(), el=$("splitAt"); el.max=Math.max(0,b.length-1); el.disabled=!b.length||S.model.fit.hasCompressed; $("splitSave").disabled=el.disabled;
  const i=Math.min(+el.value,b.length-1); $("splitLabel").textContent=b.length?t("spl_lap",{n:b[i].k,x:fmtTime(b[i].ts-S.model.t0)}):t("spl_none");
}
function showRepair(){
  const notes=S.repairNotes||[];
  $("repairMsg").hidden=!notes.length;
  if(notes.length) $("repairMsg").textContent=t("rep_banner")+" "+notes.map(n=>t(n)).join(", ")+".";
}
function updateToolChips(){
  const m=S.model, E=S.E, F=editFlags(m,E);
  const on={t_crop:F.cropS||F.cropE,t_shift:!!F.shift,t_mode:E.mode!=="even",t_sport:E.sport>=0,t_spike:!!(F.spike||F.pwrMax),t_remove:F.removed.length>0,
    t_device:!!F.device,t_combine:!!S.combinedWith,t_import:!!F.imp};
  for(const [id,v] of Object.entries(on)){const el=$(id); el.classList.toggle("on",!!v); const c=el.querySelector(".chip-on"); if(c) c.hidden=!v;}
}
function load(bytes,name,sample,keepCombined){
  S.repairNotes=[];
  if(needsRepair(bytes)){ const r=repairFit(bytes); bytes=r.bytes; S.repairNotes=r.notes; }
  const fit=parseFit(bytes), model=buildModel(fit);
  S.model=model; S.name=name; S.sample=sample; S.bytes=bytes; if(!keepCombined) S.combinedWith=null;
  showRepair();
  S.E=freshEdits(model,document.querySelector("input[name=mode]:checked")?.value);
  // a repaired file whose laps reach past the last readable data point is cut there
  const lastRec=[...model.records].reverse().find(r=>r.ts!=null);
  if(S.repairNotes.length&&lastRec&&model.t1>lastRec.ts+5) S.E.trim=lastRec.ts;
  S.prev=null; S.pv="new";
  document.querySelectorAll("[data-pv]").forEach(x=>x.setAttribute("aria-pressed",x.dataset.pv==="new"));
  fillFileInfo(); fillSport(); fillRemove();
  const span=Math.max(1,model.t1-model.t0);
  for(const id of ["cropStart","trim"]){const r=$(id); r.max=span; r.disabled=fit.hasCompressed;}
  $("cropStart").value=0; $("trim").value=S.E.trim!=null?S.E.trim-model.t0:span; $("cropNa").hidden=!fit.hasCompressed;
  $("shiftAt").disabled=fit.hasCompressed; document.querySelectorAll("[data-sh]").forEach(b=>b.disabled=fit.hasCompressed);
  $("totalKm").value=""; resetToolInputs();
  $("splitAt").min=0; $("splitAt").step=1; $("splitAt").value=Math.floor((model.laps.length-1)/2);
  fillDevice(); updateCropLabels(); updateShiftUi(); updateSpikeInfo(); updateImportInfo(); updateSplitLabel();
  $("combineInfo").textContent=S.combinedWith?t("cmb_done",{a:S.combinedWith[0],b:S.combinedWith[1]}):"";
  renderAll();
}
function resetToolInputs(){
  $("hrMax").value=""; $("pwrMax").value=""; $("hrJump").value=30; $("importOff").value=0;
  document.querySelector("input[name=spikeMode][value=off]").checked=true; readSpike();
}

function renderAll(){ renderTable(); renderLive(); }
function renderLive(){ renderStats(); renderCharts(); updateToolChips(); updateSplitLabel(); scheduleCheck(); }

function renderStats(){
  const m=S.model, G=derive(m,S.E), timer=G.reduce((a,g)=>a+g.timer,0), watch=m.laps.reduce((a,L)=>a+L.dist,0), n=G.reduce((a,g)=>a+g.dist,0);
  const origTimer=m.laps.reduce((a,L)=>a+L.timer,0);
  const dch=Math.abs(n-watch)>0.5, tch=Math.abs(timer-origTimer)>0.5;
  const tiles=[
    [t("stat_dist"),fmtKm(n),"km",dch?t("watch_x",{x:fmtKm(watch)+" km"}):t("as_watch"),dch],
    [t("stat_time"),fmtTime(timer),"",tch?t("was",{x:fmtTime(origTimer)}):t("moving"),tch],
    [isPace()?t("stat_pace"):t("stat_speed"),fmtSpeed(timer,n),speedUnit(),dch||tch?t("was",{x:fmtSpeed(origTimer,watch)}):"",dch||tch],
    [t("stat_laps"),String(G.length),"",G.length!==m.laps.length?t("was",{x:m.laps.length}):"",G.length!==m.laps.length]];
  const st=statsOf(G.flatMap(g=>g.recs));
  if(st.avgHr!=null) tiles.push([t("stat_hr"),String(Math.round(st.avgHr)),"bpm",t("max_x",{x:st.maxHr}),false]);
  $("stats").innerHTML=tiles.map(([k,v,u,w,c])=>`<div class="stat${c?" ch":""}"><div class="k">${esc(k)}</div><div class="v">${v}${u?`<small>${u}</small>`:""}</div><div class="was">${w?esc(w):"&nbsp;"}</div></div>`).join("");
}

function renderTable(){
  const m=S.model, E=S.E, G=derive(m,E);
  const visible=new Set(G.map(g=>g.key));
  const rows=E.groups.map((g,gi)=>{
    const key=gkey(g), d=G.find(x=>x.key===key);
    if(!d) return `<tr class="cut"><td class="lap">–<small>${esc(t("cut_row"))}</small></td><td colspan="6" style="text-align:left">${esc(t("cut_row_long"))}</td></tr>`;
    const canMerge=gi<E.groups.length-1&&visible.has(gkey(E.groups[gi+1]))&&!m.fit.hasCompressed;
    const n=G.indexOf(d)+1;
    return `<tr data-k="${key}">
      <td class="lap">${n}${g.length>1?`<small>${esc(t("merged_n",{n:g.length}))}</small>`:(d.clipped||d.clipStart)?`<small>${esc(t("clipped"))}</small>`:""}</td>
      <td>${fmtTime(d.timer)}</td>
      <td class="dim">${fmtM(d.watch)} m</td>
      <td><span class="edit"><button class="step" data-d="-1" aria-label="${esc(t("step_less",{n}))}">−</button><input type="number" id="d_${key}" min="0" step="1" value="${fmtM(d.dist)}" aria-label="${esc(t("real_aria",{n}))}"><button class="step" data-d="1" aria-label="${esc(t("step_more",{n}))}">+</button></span></td>
      <td class="tl"></td><td class="pace"></td>
      <td>${g.length>1?`<button class="icon-btn" data-split="${gi}" title="${esc(t("split_title"))}">${esc(t("split"))}</button>`:""}${canMerge?`<button class="icon-btn" data-merge="${gi}" title="${esc(t("merge_title"))}">${esc(t("merge"))}</button>`:""}</td></tr>`;
  }).join("");
  $("laps").innerHTML=`<thead><tr><th>${t("th_lap")}</th><th>${t("th_time")}</th><th>${t("th_watch")}</th><th>${t("th_real")}</th><th>${t("th_track")}</th><th>${t("th_pace")}</th><th></th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td>${t("total")}</td><td id="ft"></td><td class="dim" id="fo"></td><td id="fn"></td><td></td><td id="fp"></td><td></td></tr></tfoot>`;
  G.forEach(updateRow); updateFoot();
}
function updateRow(g){
  const tr=$("laps").querySelector(`tr[data-k="${g.key}"]`); if(!tr) return; const tl=trackLen();
  tr.classList.toggle("ch",isChanged(g));
  const n=g.dist/tl; tr.querySelector(".tl").textContent=(Math.abs(n-Math.round(n))<0.01?Math.round(n):fmtDec(n,2))+" × "+tl+" m";
  tr.querySelector(".pace").textContent=fmtSpeed(g.timer,g.dist)+" "+speedUnit();
}
function updateFoot(){
  const G=derive(S.model,S.E), tt=G.reduce((a,g)=>a+g.timer,0), n=G.reduce((a,g)=>a+g.dist,0);
  $("ft").textContent=fmtTime(tt); $("fo").textContent=fmtKm(G.reduce((a,g)=>a+g.watch,0))+" km"; $("fn").textContent=fmtKm(n)+" km"; $("fp").textContent=fmtSpeed(tt,n)+" "+speedUnit();
}
function setDist(key,v,sync){
  S.E.dist[key]=Math.max(0,v); if(sync){const el=$("d_"+key); if(el) el.value=fmtM(S.E.dist[key]);}
  const g=derive(S.model,S.E).find(x=>x.key===key); if(g) updateRow(g); updateFoot(); renderLive();
}

/* ---- overview charts (time axis) ---- */
function niceStep(range,target){const raw=range/target, p=Math.pow(10,Math.floor(Math.log10(raw))), n=raw/p; return (n<1.5?1:n<3?2:n<7?5:10)*p;}
function renderCharts(){
  const m=S.model, E=S.E, G=derive(m,E), W=1000, H=190, L=40, R=8, TP=18, B=24, t0=m.t0, span=Math.max(1,m.t1-t0);
  const X=v=>L+(v-t0)/span*(W-L-R);
  const key=S.metric, mul=key==="cad"?cadMul():1;
  const pts=m.records.filter(r=>r.ts!=null&&r[key]!=null&&(key!=="cad"||r.cad>0));
  $("chartTitle").textContent=key==="hr"?t("chart_hr"):(mul===2?t("chart_cad_spm"):t("chart_cad_rpm"));
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(key==="hr"?t("m_hr"):t("m_cad"))}">`;
  if(pts.length){
    const vals=pts.map(r=>r[key]*mul); let lo=vals.reduce((a,b)=>b<a?b:a,Infinity), hi=vals.reduce((a,b)=>b>a?b:a,-Infinity); if(hi-lo<10){lo-=5;hi+=5;}
    const st=niceStep(hi-lo,4); lo=Math.floor(lo/st)*st; hi=Math.ceil(hi/st)*st;
    const Y=v=>TP+(1-(v-lo)/(hi-lo))*(H-TP-B);
    for(let v=lo;v<=hi+1e-9;v+=st) svg+=`<line class="grid" x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L-6}" y="${Y(v)+4}" text-anchor="end">${Math.round(v)}</text>`;
    G.forEach((g,i)=>{const x=X(g.start); if(i>0) svg+=`<line class="lapline" x1="${x}" x2="${x}" y1="${TP}" y2="${H-B}"/>`; if(X(g.end)-x>16) svg+=`<text x="${(x+X(g.end))/2}" y="11" text-anchor="middle">${i+1}</text>`;});
    let d="", prev=null;
    for(const r of pts){ d+=(prev==null||r.ts-prev>60?"M":"L")+X(r.ts).toFixed(1)+" "+Y(r[key]*mul).toFixed(1); prev=r.ts; }
    const col=key==="hr"?"var(--accent)":"var(--blue)";
    svg+=`<path class="series" d="${d}" style="stroke:${col}"/>`;
    const lim=E.spike&&E.spike.mode==="limit"?E.spike.limit:0;
    if(key==="hr"&&lim>0&&lim<hi) svg+=`<line x1="${L}" x2="${W-R}" y1="${Y(lim)}" y2="${Y(lim)}" stroke="var(--warn)" stroke-dasharray="6 4" stroke-width="1.5"/>`;
    const step=niceStep(span/60,6)*60; for(let s=0;s<=span;s+=step) svg+=`<text x="${X(t0+s)}" y="${H-6}" text-anchor="middle">${Math.round(s/60)} min</text>`;
    if(E.trim!=null&&E.trim<m.t1) svg+=`<rect class="cut" x="${X(E.trim)}" y="${TP}" width="${W-R-X(E.trim)}" height="${H-TP-B}"/><line class="cutline" x1="${X(E.trim)}" x2="${X(E.trim)}" y1="${TP-4}" y2="${H-B}"/>`;
    if(E.cropStart!=null&&E.cropStart>m.t0) svg+=`<rect class="cut" x="${L}" y="${TP}" width="${X(E.cropStart)-L}" height="${H-TP-B}"/><line class="cutline" x1="${X(E.cropStart)}" x2="${X(E.cropStart)}" y1="${TP-4}" y2="${H-B}"/>`;
    svg+=`<line class="xh" id="xh" x1="0" x2="0" y1="${TP}" y2="${H-B}" visibility="hidden"/><circle id="xd" r="4" fill="${col}" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>`;
    svg+=`<rect x="${L}" y="0" width="${W-L-R}" height="${H}" fill="transparent"/>`;
    S.chart={X,Y,pts,key,mul,W,L,R,t0,span,H};
  } else { svg+=`<text x="${W/2}" y="${H/2}" text-anchor="middle">${esc(t("no_data",{x:(key==="hr"?t("m_hr"):t("m_cad")).toLowerCase()}))}</text>`; S.chart=null; }
  svg+="</svg>";
  $("plotTop").innerHTML=svg+'<div class="tip" id="tipTop" hidden></div>';
  const H2=130, B2=20, sp=G.map(g=>g.timer>0?g.dist/g.timer:0), mx=Math.max(...sp,0.1);
  let s2=`<svg viewBox="0 0 ${W} ${H2}" role="img" aria-label="${esc(t("chart_laps"))}"><line class="grid" x1="${L}" x2="${W-R}" y1="${H2-B2}" y2="${H2-B2}"/>`;
  G.forEach((g,i)=>{
    const x0=X(g.start)+1, x1=X(g.end)-1, w=Math.max(1,x1-x0), h=(sp[i]/mx)*(H2-B2-18), y=H2-B2-h, rr=Math.min(4,w/2,h);
    s2+=`<path class="bar${isChanged(g)?" ch":""}" d="M${x0} ${H2-B2}V${y+rr}Q${x0} ${y} ${x0+rr} ${y}H${x1-rr}Q${x1} ${y} ${x1} ${y+rr}V${H2-B2}Z"/>`;
    if(w>44&&h>0) s2+=`<text x="${(x0+x1)/2}" y="${y-5}" text-anchor="middle">${fmtSpeed(g.timer,g.dist)}</text>`;
    if(w>14) s2+=`<text x="${(x0+x1)/2}" y="${H2-5}" text-anchor="middle">${i+1}</text>`;
    s2+=`<rect data-i="${i}" x="${X(g.start)}" y="0" width="${Math.max(6,X(g.end)-X(g.start))}" height="${H2}" fill="transparent"/>`;
  });
  $("plotLaps").innerHTML=s2+'</svg><div class="tip" id="tipLaps" hidden></div>';
  S.lapG=G;
}
function svgPoint(svg,evt,W=1000){const r=svg.getBoundingClientRect();return {x:(evt.clientX-r.left)/r.width*W,px:evt.clientX-r.left,py:evt.clientY-r.top,r};}
function nearest(arr,val,get){let lo=0,hi=arr.length-1; if(hi<0) return -1; while(hi-lo>1){const mid=(lo+hi)>>1; if(get(arr[mid])<val) lo=mid; else hi=mid;} return Math.abs(get(arr[lo])-val)<=Math.abs(get(arr[hi])-val)?lo:hi;}
$("plotTop").addEventListener("pointermove",e=>{
  const c=S.chart, svg=$("plotTop").querySelector("svg"); if(!c||!svg) return;
  const p=svgPoint(svg,e); if(p.x<c.L||p.x>c.W-c.R){hideTop();return;}
  const tv=c.t0+(p.x-c.L)/(c.W-c.L-c.R)*c.span, r=c.pts[nearest(c.pts,tv,q=>q.ts)];
  const x=c.X(r.ts), y=c.Y(r[c.key]*c.mul), xh=$("xh"), xd=$("xd");
  xh.setAttribute("x1",x);xh.setAttribute("x2",x);xh.setAttribute("visibility","visible");xd.setAttribute("cx",x);xd.setAttribute("cy",y);xd.setAttribute("visibility","visible");
  const gi=(S.lapG||[]).findIndex(g=>r.ts>=g.start&&r.ts<=g.end);
  const tip=$("tipTop"); tip.hidden=false; tip.style.left=Math.min(Math.max(p.px,70),p.r.width-70)+"px"; tip.style.top=(y/c.H*p.r.height)+"px";
  tip.innerHTML=`<b>${fmtTime(r.ts-c.t0)}</b>${gi>=0?" · "+esc(t("lap_n",{n:gi+1})):""}<br>${r.hr!=null?`${esc(t("m_hr"))} ${r.hr}`:""}${r.cad?` · ${esc(t("m_cad"))} ${r.cad*cadMul()}`:""}`;
});
function hideTop(){const tp=$("tipTop"); if(tp) tp.hidden=true; ["xh","xd"].forEach(id=>$(id)?.setAttribute("visibility","hidden"));}
$("plotTop").addEventListener("pointerleave",hideTop);
$("plotLaps").addEventListener("pointermove",e=>{
  const el=e.target.closest("[data-i]"), tip=$("tipLaps"); if(!el||!S.lapG){if(tip)tip.hidden=true;return;}
  const g=S.lapG[+el.dataset.i], svg=$("plotLaps").querySelector("svg"), p=svgPoint(svg,e);
  tip.hidden=false; tip.style.left=Math.min(Math.max(p.px,80),p.r.width-80)+"px"; tip.style.top=Math.max(40,p.py)+"px";
  tip.innerHTML=`<b>${esc(t("tip_lap",{n:+el.dataset.i+1}))}</b> · ${fmtM(g.dist)} m${isChanged(g)?` (${esc(t("watch_x",{x:fmtM(g.watch)+" m"}))})`:""}<br>${fmtTime(g.timer)} · ${fmtSpeed(g.timer,g.dist)} ${speedUnit()}`;
});
$("plotLaps").addEventListener("pointerleave",()=>{const tp=$("tipLaps"); if(tp) tp.hidden=true;});
document.querySelectorAll("[data-metric]").forEach(b=>b.addEventListener("click",()=>{S.metric=b.dataset.metric;document.querySelectorAll("[data-metric]").forEach(x=>x.setAttribute("aria-pressed",x===b));renderCharts();}));

/* ---- preview (distance axis, read back from the built file) ---- */
function renderPreview(){
  const m=S.pv==="old"||!S.prev?S.model:S.prev, sm=summarize(m), pace=paceSport(sm.sport), mul=cadMulFor(sm.sport??1);
  $("pvName").textContent=sportName(sm.sport,sm.sub);
  const d=fitDate(sm.start); $("pvWhen").textContent=d?d.toLocaleString(loc(),{weekday:"long",day:"numeric",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"}):"";
  const tiles=[
    [t("stat_dist"),fmtKm(sm.dist),"km",1],[t("pv_moving"),fmtTime(sm.moving),"",1],[pace?t("stat_pace"):t("stat_speed"),fmtSpeedFor(pace,sm.moving,sm.dist),unitFor(pace),1],
    [t("pv_elapsed"),fmtTime(sm.elapsed),""],[t("pv_elev"),sm.elev!=null?fmtInt(sm.elev):"–",sm.elev!=null?"m":""],
    [t("stat_hr"),sm.avgHr!=null?fmtInt(sm.avgHr):"–",sm.avgHr!=null?"bpm":""],[t("pv_maxhr"),sm.maxHr!=null?fmtInt(sm.maxHr):"–",sm.maxHr!=null?"bpm":""],
    [t("pv_cad"),sm.avgCad!=null?fmtInt(sm.avgCad*mul):"–",sm.avgCad!=null?(mul===2?"spm":"rpm"):""],[t("pv_cal"),sm.cal!=null?fmtInt(sm.cal):"–",sm.cal!=null?"kcal":""]];
  $("pvStats").innerHTML=tiles.map(([k,v,u,big])=>`<div class="${big?"big":""}"><div class="k">${esc(k)}</div><div class="v">${v}${u?`<small>${u}</small>`:""}</div></div>`).join("");
  $("pvPaceLbl").textContent=pace?t("pv_pace")+" (/km)":t("pv_speed");
  const ser=sm.series, maxD=ser.length?ser[ser.length-1].d:0;
  const yPace=r=>{ if(r.v==null||r.v<(pace?0.5:1)) return null; return pace?1000/r.v:r.v*3.6; };
  S.pvCharts=[
    drawDist("pvPace",ser,yPace,{color:"var(--blue)",invert:pace,fmt:pace?v=>fmtTime(v):v=>fmtDec(v,0),maxD,clip:true}),
    drawDist("pvHr",ser,r=>r.hr,{color:"var(--accent)",fmt:v=>Math.round(v),maxD}),
    drawDist("pvCad",ser,r=>r.cad?r.cad*mul:null,{color:"var(--green)",fmt:v=>Math.round(v),maxD})];
  S.pvSeries=ser; S.pvPace=pace; S.pvMul=mul;
  const vmax=Math.max(...sm.splits.map(s=>s.moving>0?s.dist/s.moving:0),0.1);
  $("pvSplits").innerHTML=`<thead><tr><th>${t("th_km")}</th><th>${pace?t("th_pace"):t("stat_speed")}</th><th style="width:35%"></th><th>${t("th_elev")}</th><th>${t("th_hr")}</th></tr></thead><tbody>`+
    (sm.splits.length?sm.splits.map(s=>{const v=s.moving>0?s.dist/s.moving:0;return `<tr><td>${s.partial?fmtDec(s.km,2):s.km}</td><td>${fmtSpeedFor(pace,s.moving,s.dist)}</td><td><span class="pbar" style="width:${(v/vmax*100).toFixed(0)}%"></span></td><td>${s.elev!=null?fmtInt(s.elev):"–"}</td><td>${s.hr!=null?fmtInt(s.hr):"–"}</td></tr>`;}).join(""):`<tr><td colspan="5">–</td></tr>`)+"</tbody>";
  $("pvLaps").innerHTML=`<thead><tr><th>${t("th_lap")}</th><th>${t("stat_dist")}</th><th>${t("th_time")}</th><th>${pace?t("th_pace"):t("stat_speed")}</th><th>${t("th_hr")}</th></tr></thead><tbody>`+
    sm.laps.map((L,i)=>`<tr><td>${i+1}</td><td>${fmtKm(L.dist)} km</td><td>${fmtTime(L.timer)}</td><td>${fmtSpeedFor(pace,L.timer,L.dist)}</td><td>${L.hr??"–"}</td></tr>`).join("")+"</tbody>";
  if(sm.route.length>1){
    const lat0=sm.route.reduce((a,p)=>a+p[0],0)/sm.route.length, k=Math.cos(lat0*Math.PI/180);
    const xs=sm.route.map(p=>p[1]*k), ys=sm.route.map(p=>-p[0]);
    const mn=a=>a.reduce((x,y)=>y<x?y:x,Infinity), mxa=a=>a.reduce((x,y)=>y>x?y:x,-Infinity);
    const x0=mn(xs), x1=mxa(xs), y0=mn(ys), y1=mxa(ys), W=400, H=300, pad=16;
    const sc=Math.min((W-2*pad)/Math.max(1e-9,x1-x0),(H-2*pad)/Math.max(1e-9,y1-y0));
    const ox=(W-(x1-x0)*sc)/2, oy=(H-(y1-y0)*sc)/2, P=i=>[(xs[i]-x0)*sc+ox,(ys[i]-y0)*sc+oy];
    let dd=""; for(let i=0;i<xs.length;i+=Math.max(1,Math.floor(xs.length/1500))){const [x,y]=P(i); dd+=(dd?"L":"M")+x.toFixed(1)+" "+y.toFixed(1);}
    const [sx,sy]=P(0), [ex,ey]=P(xs.length-1);
    $("pvMap").innerHTML=`<svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t("pv_map"))}"><path d="${dd}"/><circle cx="${sx}" cy="${sy}" r="6" fill="var(--good)" stroke="var(--surface)" stroke-width="2"/><circle cx="${ex}" cy="${ey}" r="6" fill="var(--ink)" stroke="var(--surface)" stroke-width="2"/></svg><p class="note" style="margin-top:6px">${esc(t("pv_mapnote"))}</p>`;
  } else $("pvMap").innerHTML=`<div class="nomap">${esc(t("pv_nomap"))}</div>`;
}
function drawDist(id,ser,get,o){
  const W=1000,H=150,L=48,R=8,TP=8,B=20, el=$(id);
  const pts=ser.map((r,i)=>({i,d:r.d,y:get(r)}));
  let vals=pts.map(p=>p.y).filter(v=>v!=null).sort((a,b)=>a-b);
  if(!vals.length||!(o.maxD>0)){el.innerHTML=`<svg viewBox="0 0 ${W} 40"><text x="${W/2}" y="24" text-anchor="middle">–</text></svg>`;return null;}
  let lo=o.clip?vals[Math.floor(vals.length*0.02)]:vals[0], hi=o.clip?vals[Math.ceil(vals.length*0.98)-1]:vals[vals.length-1];
  if(o.invert){ const med=vals[Math.floor(vals.length/2)]; hi=Math.min(hi,med*1.6); }
  if(hi-lo<1e-6){lo-=1;hi+=1;} const padv=(hi-lo)*0.08; lo-=padv; hi+=padv;
  const X=d=>L+d/o.maxD*(W-L-R), Y=v=>{const f=(Math.min(hi,Math.max(lo,v))-lo)/(hi-lo); return TP+(o.invert?f:1-f)*(H-TP-B);};
  let s=`<svg viewBox="0 0 ${W} ${H}">`;
  [lo+(hi-lo)*0.15,(lo+hi)/2,hi-(hi-lo)*0.15].forEach(v=>{s+=`<line class="grid" x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L-6}" y="${Y(v)+4}" text-anchor="end">${o.fmt(v)}</text>`;});
  const km=o.maxD/1000, st=Math.max(1,niceStep(km,8)); for(let k=0;k<=km+1e-9;k+=st) s+=`<text x="${X(k*1000)}" y="${H-5}" text-anchor="middle">${fmtDec(k,st<1?1:0)} km</text>`;
  let d="", open=false; for(const p of pts){ if(p.y==null){open=false;continue;} d+=(open?"L":"M")+X(p.d).toFixed(1)+" "+Y(p.y).toFixed(1); open=true; }
  s+=`<path class="series" d="${d}" style="stroke:${o.color}"/><line class="xh" x1="0" x2="0" y1="${TP}" y2="${H-B}" visibility="hidden"/><circle r="4" fill="${o.color}" stroke="var(--surface)" stroke-width="2" visibility="hidden"/><rect x="${L}" y="0" width="${W-L-R}" height="${H}" fill="transparent"/></svg><div class="tip" hidden></div>`;
  el.innerHTML=s;
  return {el,X,Y,get,L,R,W,H,maxD:o.maxD};
}
function pvMove(e){
  const charts=(S.pvCharts||[]).filter(Boolean); if(!charts.length) return;
  const host=e.currentTarget, c0=charts.find(c=>c.el===host); if(!c0) return;
  const svg=host.querySelector("svg"), p=svgPoint(svg,e);
  if(p.x<c0.L||p.x>c0.W-c0.R){pvHide();return;}
  const dval=(p.x-c0.L)/(c0.W-c0.L-c0.R)*c0.maxD, ser=S.pvSeries, i=nearest(ser,dval,r=>r.d); if(i<0) return; const r=ser[i];
  for(const c of charts){
    const line=c.el.querySelector(".xh"), dot=c.el.querySelector("circle"), v=c.get(r), x=c.X(r.d);
    line.setAttribute("x1",x);line.setAttribute("x2",x);line.setAttribute("visibility","visible");
    if(v!=null){dot.setAttribute("cx",x);dot.setAttribute("cy",c.Y(v));dot.setAttribute("visibility","visible");} else dot.setAttribute("visibility","hidden");
    c.el.querySelector(".tip").hidden=true;
  }
  const tip=host.querySelector(".tip"), pace=S.pvPace;
  const pv=r.v!=null&&r.v>=(pace?0.5:1)?(pace?fmtTime(1000/r.v)+" /km":fmtDec(r.v*3.6,1)+" km/h"):"–";
  tip.innerHTML=`<b>${fmtDec(r.d/1000,2)} km</b> · ${fmtTime(r.ts-ser[0].ts)}<br>${esc(t("pv_pace"))} ${pv}${r.hr!=null?` · ${esc(t("th_hr"))} ${r.hr}`:""}${r.cad?` · ${esc(t("m_cad"))} ${r.cad*S.pvMul}`:""}`;
  tip.hidden=false; tip.style.left=Math.min(Math.max(p.px,90),p.r.width-90)+"px"; tip.style.top="14px"; tip.style.transform="translate(-50%,-100%)";
}
function pvHide(){ for(const c of (S.pvCharts||[]).filter(Boolean)){ c.el.querySelectorAll(".xh,circle").forEach(x=>x.setAttribute("visibility","hidden")); const tp=c.el.querySelector(".tip"); if(tp) tp.hidden=true; } }
["pvPace","pvHr","pvCad"].forEach(id=>{$(id).addEventListener("pointermove",pvMove);$(id).addEventListener("pointerleave",pvHide);});
document.querySelectorAll("[data-pv]").forEach(b=>b.addEventListener("click",()=>{S.pv=b.dataset.pv;document.querySelectorAll("[data-pv]").forEach(x=>x.setAttribute("aria-pressed",x===b));renderPreview();}));

/* ---- check (step 3) ---- */
function scheduleCheck(){clearTimeout(scheduleCheck.h);scheduleCheck.h=setTimeout(runCheck,250);}
function runCheck(){
  const m=S.model, E=S.E; let res, v;
  try{res=build(m,E);v=verify(m,E,res.file,res.G);}catch(err){$("verify").innerHTML=`<li class="bad"><span class="ic">!</span><span>${esc(t("build_err",{x:err.message}))}</span></li>`;$("save").disabled=true;return;}
  S.last=res; S.prev=v.model||null;
  const G=res.G, F=res.F, ch=[], nd=G.filter(isChanged).length;
  if(nd){const a=m.laps.reduce((s,L)=>s+L.dist,0), b=G.reduce((s,g)=>s+g.dist,0); ch.push(t("chg_dist",{n:nd,a:fmtKm(a),b:fmtKm(b)})); ch.push(t(E.mode==="even"?"chg_even":"chg_shape"));}
  if(res.merged) ch.push(t("chg_merge",{n:E.groups.filter(g=>g.length>1).length}));
  if(F.cropS) ch.push(t("chg_crop_start",{a:fmtTime(E.cropStart-m.t0),b:fmtTime(E.cropStart-m.t0)}));
  if(F.cropE) ch.push(t("chg_trim",{a:fmtTime(E.trim-m.t0),b:fmtTime(m.t1-E.trim)}));
  if(F.shift) ch.push(t("chg_shift",{x:fmtDur(F.shift)}));
  if(S.repairNotes&&S.repairNotes.length) ch.unshift(t("chg_repair",{x:S.repairNotes.map(n=>t(n)).join(", ")}));
  if(F.imp) ch.push(t("chg_import",{x:F.imp.name,n:fmtInt(res.importedHr)}));
  if(F.spike) ch.push(F.spike.mode==="jump"?t("chg_spike_jump",{n:res.fixedHr}):t("chg_spike",{n:res.fixedHr,x:F.spike.limit}));
  if(F.device){const cur=DEVICES.find(d=>d[1]===m.product); ch.push(t("chg_device",{a:cur?cur[0]:t("dev_unknown"),b:DEVICES.find(d=>d[1]===F.device)[0]}));}
  if(F.pwrMax) ch.push(t("chg_pwr",{n:res.fixedPwr,x:F.pwrMax}));
  if(F.removed.length) ch.push(t("chg_rm",{x:F.removed.map(k=>t("rm_"+k+(k==="gps"||k==="alt"?"_short":""))).join(", ")}));
  if(E.sport>=0) ch.push(t("chg_sport",{a:sportName(m.sport,m.sub),b:t(SPORTS[E.sport][0])}));
  $("changes").innerHTML=ch.length?ch.map(x=>`<li class="chg"><span class="ic">✎</span><span>${esc(x)}</span></li>`).join(""):`<li class="ok"><span class="ic">–</span><span>${esc(t("nothing"))}</span></li>`;
  $("verify").innerHTML=v.error?`<li class="bad"><span class="ic">!</span><span>${esc(v.error)}</span></li>`:v.items.map(i=>`<li class="${i.ok?"ok":"bad"}"><span class="ic">${i.ok?"✓":"!"}</span><span>${esc(i.t)}</span></li>`).join("");
  const any=ch.length>0;
  $("save").disabled=!any||!v.ok;
  $("saveNote").textContent=t(!any?"save_first":v.ok?"save_ready":"save_bad");
  renderPreview();
}

/* ---- events: lap table ---- */
$("laps").addEventListener("input",e=>{ if(!e.target.matches("input[type=number]")) return; const key=e.target.closest("tr").dataset.k, v=parseFloat(String(e.target.value).replace(",",".")); setDist(key,isFinite(v)?v:0,false); });
$("laps").addEventListener("click",e=>{
  const st=e.target.closest(".step");
  if(st){const key=st.closest("tr").dataset.k, g=derive(S.model,S.E).find(x=>x.key===key), tl=trackLen(), cur=g.dist;
    const nx=st.dataset.d>0?(Math.floor(cur/tl+1e-6)+1)*tl:Math.max(0,(Math.ceil(cur/tl-1e-6)-1)*tl); setDist(key,nx,true); return;}
  const mg=e.target.closest("[data-merge]");
  if(mg){const i=+mg.dataset.merge, E=S.E, G=derive(S.model,E), a=G.find(x=>x.key===gkey(E.groups[i])), b=G.find(x=>x.key===gkey(E.groups[i+1]));
    const edited=E.dist[a.key]!=null||E.dist[b.key]!=null, merged=E.groups[i].concat(E.groups[i+1]);
    delete E.dist[a.key]; delete E.dist[b.key]; E.groups.splice(i,2,merged); if(edited) E.dist[gkey(merged)]=a.dist+b.dist;
    renderAll(); toast(t("toast_merged",{a:G.indexOf(a)+1,b:G.indexOf(b)+1})); return;}
  const sp=e.target.closest("[data-split]");
  if(sp){const i=+sp.dataset.split, E=S.E, g=E.groups[i]; delete E.dist[gkey(g)]; E.groups.splice(i,1,...g.map(x=>[x])); renderAll(); toast(t("toast_split")); }
});
$("trackLen").addEventListener("input",()=>{ if(S.model) derive(S.model,S.E).forEach(updateRow); });
$("bulkApply").addEventListener("click",()=>{const v=Math.max(0,parseFloat($("bulkDist").value)||0); derive(S.model,S.E).forEach(g=>S.E.dist[g.key]=v); renderAll(); toast(t("toast_all",{x:fmtM(v)}));});
$("snap").addEventListener("click",()=>{const tl=trackLen(); derive(S.model,S.E).forEach(g=>S.E.dist[g.key]=Math.round(g.watch/tl)*tl); renderAll(); toast(t("toast_snap",{x:tl}));});
$("resetAll").addEventListener("click",()=>{
  S.E=freshEdits(S.model,"even"); document.querySelector('input[name=mode][value=even]').checked=true;
  $("cropStart").value=0; $("trim").value=$("trim").max; fillSport(); fillRemove(); fillDevice(); $("totalKm").value=""; resetToolInputs();
  updateCropLabels(); updateShiftUi(); updateSpikeInfo(); updateImportInfo(); renderAll(); toast(t("toast_reset"));
});

/* ---- events: more tools ---- */
$("totalApply").addEventListener("click",()=>{
  const km=parseFloat(String($("totalKm").value).replace(",",".")); if(!(km>0)){toast(t("toast_total_need"));return;}
  const G=derive(S.model,S.E), w=G.reduce((a,g)=>a+g.watch,0), tt=G.reduce((a,g)=>a+g.timer,0);
  G.forEach(g=>S.E.dist[g.key]=Math.round(km*1000*(w>0?g.watch/w:g.timer/tt)*100)/100);
  renderAll(); toast(t("toast_total",{x:fmtDec(km,2),n:G.length}));
});
function onCrop(){
  const m=S.model, span=m.t1-m.t0; let a=+$("cropStart").value, b=+$("trim").value;
  if(b-a<60){ if(this&&this.id==="cropStart") a=Math.max(0,b-60); else b=Math.min(span,a+60); $("cropStart").value=a; $("trim").value=b; }
  S.E.cropStart=a<=0?null:m.t0+a; S.E.trim=b>=span?null:m.t0+b;
  updateCropLabels(); renderAll();
}
$("cropStart").addEventListener("input",onCrop); $("trim").addEventListener("input",onCrop);
$("trimReset").addEventListener("click",()=>{$("cropStart").value=0; $("trim").value=$("trim").max; onCrop();});
$("shiftAt").addEventListener("change",e=>{
  const v=new Date(e.target.value); if(isNaN(v)) return; const orig=fitDate(S.model.t0);
  S.E.shift=Math.round((v-orig)/1000); updateShiftUi(); renderLive();
});
document.querySelectorAll("[data-sh]").forEach(b=>b.addEventListener("click",()=>{S.E.shift=(S.E.shift||0)+(+b.dataset.sh); updateShiftUi(); renderLive();}));
$("shiftReset").addEventListener("click",()=>{S.E.shift=0; updateShiftUi(); renderLive();});
const onSpike=()=>{S.E.spike=readSpike(); updateSpikeInfo(); renderLive();};
document.querySelectorAll("input[name=spikeMode]").forEach(r=>r.addEventListener("change",onSpike));
$("hrJump").addEventListener("input",onSpike); $("hrMax").addEventListener("input",onSpike);
$("device").addEventListener("change",e=>{S.E.device=e.target.value?+e.target.value:null; renderLive();});
$("combineInput").addEventListener("change",async e=>{
  const f=e.target.files[0]; e.target.value=""; if(!f) return;
  try{
    let b=new Uint8Array(await f.arrayBuffer()), nm=f.name;
    if(b[0]===0x50&&b[1]===0x4B){const z=await fitFromZip(b); b=z.bytes; nm=z.name;}
    if(needsRepair(b)) b=repairFit(b).bytes;
    const merged=combineFits(S.bytes,b), names=[S.sample?t("sample_tag"):S.name,nm];
    S.combinedWith=names; load(merged,names[0].replace(/\.fit$/i,"")+"+"+nm,false,true);
    toast(t("cmb_done",{a:names[0],b:names[1]}));
  }catch(err){toast(err.message||t("e_read"));}
});
$("splitAt").addEventListener("input",updateSplitLabel);
$("splitSave").addEventListener("click",async()=>{
  const m=S.model, b=splitBounds(), E=S.E; if(!b.length) return;
  const Ts=b[Math.min(+$("splitAt").value,b.length-1)].ts;
  const E1={...E,trim:Math.min(E.trim??Infinity,Ts-1)}, E2={...E,cropStart:Math.max(E.cropStart??-Infinity,Ts),fileCreated:Ts};
  try{
    const parts=[E1,E2].map(x=>{const r=build(m,x), v=verify(m,x,r.file,r.G); if(!v.ok) throw new Error(t("save_bad")); return r.file;});
    const dl=await downloadsP;
    for(let i=0;i<2;i++){ const base=baseName()+"-part"+(i+1); const ok=dl?await offerFile(base+".zip",makeZip(base+".fit",parts[i])):await offerFile(base+".fit",parts[i]); if(!ok) return; }
    toast(t("spl_saved"));
  }catch(err){toast(err.message);}
});
$("importInput").addEventListener("change",async e=>{
  const f=e.target.files[0]; e.target.value=""; if(!f) return;
  try{ const src=await readHrSource(f); S.E.hrImport={...src,offset:+$("importOff").value||0}; updateImportInfo(); updateSpikeInfo(); renderLive(); }
  catch(err){toast(err.message||t("e_read"));}
});
$("importOff").addEventListener("input",e=>{ if(!S.E.hrImport) return; S.E.hrImport.offset=parseInt(e.target.value,10)||0; updateImportInfo(); renderLive(); });
$("importClear").addEventListener("click",()=>{ S.E.hrImport=null; $("importOff").value=0; updateImportInfo(); renderLive(); });
$("expTcx").addEventListener("click",async()=>{ const m=S.prev||S.model, b=baseName(), dl=await downloadsP; if(dl?await offerFile(b+".zip",makeZip(b+".tcx",tcxOf(m))):await offerFile(b+".tcx",tcxOf(m),"application/vnd.garmin.tcx+xml")) toast(t("exp_saved",{x:"TCX"})); });
$("expGpx").addEventListener("click",async()=>{ const m=S.prev||S.model, b=baseName(); if(!m.records.some(r=>r.lat!=null)){toast(t("exp_gpx_nogps"));return;} const dl=await downloadsP; if(dl?await offerFile(b+".zip",makeZip(b+".gpx",gpxOf(m))):await offerFile(b+".gpx",gpxOf(m),"application/gpx+xml")) toast(t("exp_saved",{x:"GPX"})); });
$("pwrMax").addEventListener("input",e=>{const v=parseInt(e.target.value,10); S.E.pwrMax=v>=50?v:null; updateSpikeInfo(); renderLive();});
$("rmList").addEventListener("change",e=>{const k=e.target.dataset.rm; if(!k) return; S.E.remove[k]=e.target.checked; renderLive();});
$("sport").addEventListener("change",e=>{S.E.sport=+e.target.value; renderAll();});
document.querySelectorAll("input[name=mode]").forEach(r=>r.addEventListener("change",()=>{S.E.mode=r.value; renderLive();}));
document.querySelectorAll("[data-jump]").forEach(a=>a.addEventListener("click",e=>{e.preventDefault();$(a.dataset.jump).scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});}));

/* ---- files in/out ---- */
async function openFile(file){
  try{
    let bytes=new Uint8Array(await file.arrayBuffer()), name=file.name;
    if(bytes[0]===0x50&&bytes[1]===0x4B){const f=await fitFromZip(bytes);bytes=f.bytes;name=f.name;}
    load(bytes,name,false);
    saveOriginal(name,bytes);
    toast(t("toast_loaded",{n:S.model.laps.length})); $("s2").scrollIntoView({behavior:"smooth"});
  }catch(err){showErr(err.message||t("e_read"));}
}
$("fileInput").addEventListener("change",e=>{const f=e.target.files[0]; if(f) openFile(f); e.target.value="";});
const drop=$("drop");
["dragenter","dragover"].forEach(x=>drop.addEventListener(x,e=>{e.preventDefault();drop.classList.add("over");}));
["dragleave","drop"].forEach(x=>drop.addEventListener(x,e=>{e.preventDefault();drop.classList.remove("over");}));
drop.addEventListener("drop",e=>{const f=e.dataTransfer.files[0]; if(f) openFile(f);});

const baseName=()=>(S.sample?"example-run":S.name.replace(/\.fit$/i,""))+"-corrected";
const IS_ARTIFACT=!!(window.claude&&window.claude.use);
const TOUCH=matchMedia("(pointer:coarse)").matches;
async function offerFile(filename,data,mime){
  const dl=await downloadsP;
  if(dl){
    try{await dl.save({filename,data:new Blob([data])}); return true;}
    catch(e){toast(e&&e.code==="declined"?t("toast_cancel"):t("toast_nosave",{x:(e&&e.message)||"?"})); return false;}
  }
  // On a phone, the share sheet is how a file reaches Files ("Save to Files") or another app.
  if(TOUCH&&navigator.canShare){
    try{ const f=new File([data],filename,{type:mime||"application/octet-stream"});
      if(navigator.canShare({files:[f]})){ await navigator.share({files:[f]}); return true; } }
    catch(e){ if(e&&e.name==="AbortError"){toast(t("toast_cancel")); return false;} }
  }
  const url=URL.createObjectURL(new Blob([data],{type:mime||"application/octet-stream"}));
  const a=document.createElement("a"); a.href=url; a.download=filename; document.body.append(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),5000); return true;
}
$("save").addEventListener("click",async()=>{
  runCheck(); const res=S.last; if(!res||$("save").disabled) return;
  const base=baseName(), dl=await downloadsP;
  if(dl){ if(await offerFile(base+".zip",makeZip(base+".fit",res.file))) toast(t("toast_saved_zip")); }
  else if(await offerFile(base+".fit",res.file)) toast(t("toast_saved",{x:base+".fit"}));
});
$("csvLaps").addEventListener("click",async()=>{ const m=S.prev||S.model; if(await offerFile(baseName()+"-laps.csv",csvLaps(m),"text/csv")) toast(t("csv_saved")); });
$("csvPts").addEventListener("click",async()=>{ const m=S.prev||S.model; if(await offerFile(baseName()+"-data.csv",csvPoints(m),"text/csv")) toast(t("csv_saved")); });

/* ---- originals kept on this device (IndexedDB) ---- */
const ORIG_MAX=30;
function idb(){ return new Promise((res,rej)=>{ try{ const r=indexedDB.open("tlf",1); r.onupgradeneeded=()=>r.result.createObjectStore("originals",{keyPath:"id"}); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);}catch(e){rej(e);} }); }
async function idbAll(){ try{ const db=await idb(); return await new Promise((res,rej)=>{const q=db.transaction("originals").objectStore("originals").getAll(); q.onsuccess=()=>res(q.result||[]); q.onerror=()=>rej(q.error);}); }catch(e){ return []; } }
async function idbPut(v){ try{ const db=await idb(); await new Promise((res,rej)=>{const tx=db.transaction("originals","readwrite"); tx.objectStore("originals").put(v); tx.oncomplete=res; tx.onerror=()=>rej(tx.error);}); }catch(e){} }
async function idbDel(id){ try{ const db=await idb(); await new Promise((res,rej)=>{const tx=db.transaction("originals","readwrite"); tx.objectStore("originals").delete(id); tx.oncomplete=res; tx.onerror=()=>rej(tx.error);}); }catch(e){} }
async function saveOriginal(name,bytes){
  const m=S.model, id=name+"|"+bytes.length;
  await idbPut({id,name,size:bytes.length,added:Date.now(),start:m?m.t0:null,bytes:bytes.slice(0)});
  const all=(await idbAll()).sort((a,b)=>b.added-a.added); for(const x of all.slice(ORIG_MAX)) await idbDel(x.id);
  renderOriginals();
}
async function renderOriginals(){
  const all=(await idbAll()).sort((a,b)=>b.added-a.added);
  $("origCard").hidden=!all.length;
  $("origList").innerHTML=all.map(x=>{const d=fitDate(x.start);return `<div class="orig-row" data-id="${esc(x.id)}"><div style="min-width:0"><b>${esc(x.name)}</b><span class="hint">${d?esc(d.toLocaleString(loc(),{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})):""} · ${fmtDec(x.size/1024,0)} kB</span></div><div class="row"><button class="btn sm" data-oa="open">${esc(t("orig_open"))}</button><button class="btn sm" data-oa="save">${esc(t("orig_save"))}</button><button class="btn sm" data-oa="del">${esc(t("orig_del"))}</button></div></div>`;}).join("");
}
$("origList").addEventListener("click",async e=>{
  const b=e.target.closest("[data-oa]"); if(!b) return; const id=b.closest("[data-id]").dataset.id, x=(await idbAll()).find(o=>o.id===id); if(!x) return;
  if(b.dataset.oa==="open"){ load(new Uint8Array(x.bytes),x.name,false); toast(t("toast_loaded",{n:S.model.laps.length})); $("s2").scrollIntoView({behavior:"smooth"}); }
  else if(b.dataset.oa==="save"){ await offerFile(x.name,new Uint8Array(x.bytes)); }
  else if(b.dataset.oa==="del"){ if(b.dataset.sure){ await idbDel(id); renderOriginals(); } else { b.dataset.sure="1"; b.textContent=t("orig_del_sure"); } }
});

/* ---- Strava: one-tap upload with the person's own API app (keys stay on this device) ---- */
const SV_KEY="tlf-strava";
const svGet=()=>{try{return JSON.parse(localStorage.getItem(SV_KEY)||"{}");}catch(e){return {};}};
const svSet=v=>{try{localStorage.setItem(SV_KEY,JSON.stringify(v));}catch(e){}};
const redirectUri=()=>location.origin+location.pathname;
function renderStrava(){
  if(IS_ARTIFACT||location.protocol!=="https:"&&location.hostname!=="127.0.0.1"&&location.hostname!=="localhost") return;
  $("stravaBox").hidden=false; const sv=svGet();
  $("stravaDomain").textContent=location.hostname;
  $("svId").value=sv.id||""; $("svSecret").value=sv.secret||"";
  $("stravaOn").hidden=!sv.refresh; $("stravaSetup").hidden=!!sv.refresh;
  $("stravaWho").textContent=sv.who||"";
}
async function svToken(){
  const sv=svGet(); if(!sv.refresh) throw new Error(t("sv_not_connected"));
  if(sv.access&&sv.exp>Date.now()/1000+60) return sv.access;
  const r=await fetch("https://www.strava.com/oauth/token",{method:"POST",body:new URLSearchParams({client_id:sv.id,client_secret:sv.secret,grant_type:"refresh_token",refresh_token:sv.refresh})});
  const j=await r.json(); if(!r.ok) throw new Error(j.message||("Strava "+r.status));
  svSet({...sv,access:j.access_token,refresh:j.refresh_token,exp:j.expires_at}); return j.access_token;
}
$("stravaLogin").addEventListener("click",()=>{
  const id=String($("svId").value).trim(), secret=String($("svSecret").value).trim();
  if(!id||!secret){toast(t("sv_need_keys"));return;}
  svSet({...svGet(),id,secret});
  location.href="https://www.strava.com/oauth/authorize?"+new URLSearchParams({client_id:id,response_type:"code",redirect_uri:redirectUri(),approval_prompt:"auto",scope:"activity:write,read"});
});
$("stravaOff").addEventListener("click",()=>{const sv=svGet(); svSet({id:sv.id,secret:sv.secret}); renderStrava(); toast(t("sv_disconnected"));});
async function svFinishLogin(){
  const q=new URLSearchParams(location.search); if(!q.get("code")&&!q.get("error")) return;
  history.replaceState(null,"",location.pathname);
  if(q.get("error")){toast(t("sv_denied"));return;}
  const sv=svGet();
  try{
    const r=await fetch("https://www.strava.com/oauth/token",{method:"POST",body:new URLSearchParams({client_id:sv.id,client_secret:sv.secret,code:q.get("code"),grant_type:"authorization_code"})});
    const j=await r.json(); if(!r.ok) throw new Error(j.message||("Strava "+r.status));
    svSet({...sv,access:j.access_token,refresh:j.refresh_token,exp:j.expires_at,who:j.athlete?[j.athlete.firstname,j.athlete.lastname].filter(Boolean).join(" "):""});
    renderStrava(); toast(t("sv_connected_toast")); $("s4").scrollIntoView();
  }catch(e){toast(t("sv_login_fail",{x:e.message}));}
}
$("stravaUpload").addEventListener("click",async()=>{
  runCheck(); const res=S.last; if(!res||$("save").disabled){toast(t("save_first"));return;}
  const st=$("stravaStatus"), btn=$("stravaUpload"); btn.disabled=true; st.textContent=t("sv_uploading");
  try{
    const tok=await svToken(), fd=new FormData();
    fd.append("file",new Blob([res.file],{type:"application/octet-stream"}),baseName()+".fit"); fd.append("data_type","fit");
    let r=await fetch("https://www.strava.com/api/v3/uploads",{method:"POST",headers:{Authorization:"Bearer "+tok},body:fd}), j=await r.json();
    if(!r.ok) throw new Error(j.message||("Strava "+r.status));
    for(let i=0;i<30&&!j.activity_id&&!j.error;i++){ await new Promise(z=>setTimeout(z,2000)); r=await fetch("https://www.strava.com/api/v3/uploads/"+j.id,{headers:{Authorization:"Bearer "+tok}}); j=await r.json(); }
    if(j.error) throw new Error(/duplicate/i.test(j.error)?t("sv_duplicate"):j.error);
    if(!j.activity_id) throw new Error(t("sv_slow"));
    st.innerHTML=esc(t("sv_done"))+` <a href="https://www.strava.com/activities/${encodeURIComponent(j.activity_id)}" target="_blank" rel="noopener">${esc(t("sv_open"))}</a>`;
  }catch(e){ st.textContent=t("sv_fail",{x:e.message}); }
  finally{ btn.disabled=false; }
});
if("serviceWorker" in navigator&&!IS_ARTIFACT&&location.protocol==="https:") navigator.serviceWorker.register("sw.js").catch(()=>{});

window.__lapFixer={parseFit,buildModel,build,verify,derive,summarize,fitFromZip,makeZip,csvLaps,csvPoints,tcxOf,gpxOf,repairFit,needsRepair,combineFits,readHrSource,hrOverrides,editFlags,S,load,freshEdits};
applyStatic();
try{load(Uint8Array.from(atob(SAMPLE_B64),c=>c.charCodeAt(0)),"example.fit",true);}catch(err){showErr(err.message);}
renderOriginals(); renderStrava(); svFinishLogin();
