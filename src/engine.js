/* ================= FIT binary layer ================= */
const FIT_EPOCH=631065600;
const CRC_T=[0x0000,0xCC01,0xD801,0x1400,0xF001,0x3C00,0x2800,0xE401,0xA001,0x6C00,0x7800,0xB401,0x5000,0x9C01,0x8801,0x4400];
function fitCrc(b,s,e){let c=0;for(let i=s;i<e;i++){const x=b[i];let t=CRC_T[c&15];c=(c>>4)&0xfff;c^=t^CRC_T[x&15];t=CRC_T[c&15];c=(c>>4)&0xfff;c^=t^CRC_T[(x>>4)&15];}return c;}

// Splits the file into its messages (byte ranges) without decoding anything we don't need.
// lenient: read as far as the file is intact instead of failing (used to repair broken files).
function parseFit(bytes,lenient){
  const b=bytes, dv=new DataView(b.buffer,b.byteOffset,b.byteLength);
  if(b.length<14) throw new Error(t("e_small"));
  const hs=b[0];
  if(String.fromCharCode(b[8],b[9],b[10],b[11])!==".FIT") throw new Error(t("e_notfit"));
  const dataSize=dv.getUint32(4,true); let end=hs+dataSize, broken=null;
  if(dataSize===0||end+2>b.length){ if(!lenient) throw new Error(t("e_cut")); end=b.length; broken="cut"; }
  const defs={}, chunks=[]; let pos=hs, lastTs=0, hasCompressed=false;
  const fail=k=>{ if(!lenient) throw new Error(t("e_corrupt")); broken=broken||k; };
  while(pos<end){
    const s=pos, h=b[pos++];
    if(h&0x80){
      hasCompressed=true;
      const local=(h>>5)&3, d=defs[local]; if(!d||pos+d.dc.d.size>end){fail("corrupt");break;}
      const off=h&31; let ts=(lastTs-(lastTs&31))+off; if(off<(lastTs&31)) ts+=32; lastTs=ts;
      chunks.push({kind:"data",start:s,off:pos,end:pos+d.dc.d.size,g:d.dc.d.g,d:d.dc.d,ts,local,defChunk:d.dc}); pos+=d.dc.d.size;
    } else if(h&0x40){
      const local=h&15, hasDev=h&0x20;
      if(pos+5>end){fail("corrupt");break;}
      pos++; const le=b[pos++]===0, g=dv.getUint16(pos,le); pos+=2;
      const n=b[pos++]; if(pos+n*3>end){fail("corrupt");break;}
      const fields={}; let o=0;
      for(let i=0;i<n;i++){fields[b[pos]]={o,size:b[pos+1],base:b[pos+2]};o+=b[pos+1];pos+=3;}
      const normSize=o;
      if(hasDev){ if(pos+1>end){fail("corrupt");break;} const nd=b[pos++]; if(pos+nd*3>end){fail("corrupt");break;} for(let i=0;i<nd;i++){o+=b[pos+1];pos+=3;} }
      const dc={kind:"def",start:s,end:pos,local,hasDev,n,d:{g,le,fields,size:o,normSize}};
      defs[local]={dc}; chunks.push(dc);
    } else {
      const local=h&15, d=defs[local]; if(!d||pos+d.dc.d.size>end){fail("corrupt");break;}
      const c={kind:"data",start:s,off:pos,end:pos+d.dc.d.size,g:d.dc.d.g,d:d.dc.d,ts:null,local,defChunk:d.dc};
      const v=rd(dv,c,253); if(v!=null){c.ts=v;lastTs=v;}
      chunks.push(c); pos+=d.dc.d.size;
    }
  }
  // drop a trailing definition with nothing after it
  return {bytes:b,dv,hs,end:pos,chunks,msgs:chunks.filter(c=>c.kind==="data"),hasCompressed,broken};
}
function rd(dv,m,num){
  const f=m.d.fields[num]; if(!f) return null; const p=m.off+f.o, le=m.d.le;
  if(f.size===1){const v=dv.getUint8(p);return v===0xFF?null:v;}
  if(f.size===2){const v=dv.getUint16(p,le);return v===0xFFFF?null:v;}
  if(f.size===4){const v=dv.getUint32(p,le);return v===0xFFFFFFFF?null:v;}
  return null;
}
function rdS32(dv,m,num){
  const f=m.d.fields[num]; if(!f||f.size!==4) return null; const v=dv.getInt32(m.off+f.o,m.d.le);
  return v===0x7FFFFFFF?null:v;
}
function wr(dv,m,num,val){
  const f=m.d.fields[num]; if(!f||val==null||!isFinite(val)) return false; const p=m.off+f.o, le=m.d.le;
  const v=Math.max(0,Math.round(val));
  if(f.size===1) dv.setUint8(p,Math.min(v,0xFE));
  else if(f.size===2) dv.setUint16(p,Math.min(v,0xFFFE),le);
  else if(f.size===4) dv.setUint32(p,Math.min(v,0xFFFFFFFE),le);
  else return false;
  return true;
}
// Mark a field as "no value" using the FIT invalid value for its base type.
function wrInvalid(out,m,num){
  const f=m.d.fields[num]; if(!f) return; const p=m.off+f.o, base=f.base;
  if([0x0A,0x8B,0x8C].includes(base)){out.fill(0,p,p+f.size);return;}
  out.fill(0xFF,p,p+f.size);
  if([0x01,0x83,0x85].includes(base)) out[m.d.le?p+f.size-1:p]=0x7F;
}
function copyField(out,dst,src,num){
  const a=dst.d.fields[num], b=src.d.fields[num]; if(!a||!b||a.size!==b.size) return;
  out.copyWithin(dst.off+a.o,src.off+b.o,src.off+b.o+b.size);
}

/* ---- writing new messages and putting a file back together ---- */
const BASE_SIZE={0x00:1,0x02:1,0x84:2,0x86:4,0x85:4,0x83:2,0x8C:4};
// fields: [[num, base]] ; vals: matching values (null = invalid)
function synthEntry(local,global,fields,vals,defKey){
  const def=new Uint8Array(6+3*fields.length); def[0]=0x40|local; def[3]=global&255; def[4]=global>>8; def[5]=fields.length;
  let size=0; fields.forEach(([n,base],i)=>{const s=BASE_SIZE[base]; def[6+i*3]=n; def[7+i*3]=s; def[8+i*3]=base; size+=s;});
  const data=new Uint8Array(1+size), dv=new DataView(data.buffer); data[0]=local; let p=1;
  fields.forEach(([n,base],i)=>{const s=BASE_SIZE[base], v=vals[i];
    if(v==null){ data.fill(0xFF,p,p+s); if(base===0x85) data[p+3]=0x7F; if(base===0x8C) data.fill(0,p,p+s); }
    else if(s===1) data[p]=Math.round(v)&255; else if(s===2) dv.setUint16(p,Math.round(v),true); else if(base===0x85) dv.setInt32(p,Math.round(v),true); else dv.setUint32(p,Math.round(v)>>>0,true);
    p+=s;});
  return {defKey:defKey||{},defBytes:def,local,bytes:data};
}
// Writes chunks back in their original order (so an untouched file comes out byte-identical), re-emitting a
// definition only when an inserted message has replaced it. inserts: Map(chunk|"end" -> entries)
function assemble(src,out,drop,repl,inserts){
  const parts=[], cur={}; let size=0;
  const put=b=>{parts.push(b);size+=b.length;};
  const def=(key,bytes,local)=>{put(bytes);cur[local]=key;};
  const ins=e=>{ if(cur[e.local]!==e.defKey) def(e.defKey,e.defBytes,e.local); put(e.bytes); };
  for(const c of src.chunks){
    if(c.kind==="def") def(c,repl.get(c)||out.subarray(c.start,c.end),c.local);
    else if(!drop.has(c)){
      if(cur[c.local]!==c.defChunk){const dc=c.defChunk; def(dc,repl.get(dc)||out.subarray(dc.start,dc.end),dc.local);}
      put(repl.get(c)||out.subarray(c.start,c.end));
    }
    const list=inserts&&inserts.get(c); if(list) list.forEach(ins);
  }
  const tail=inserts&&inserts.get("end"); if(tail) tail.forEach(ins);
  const hs=src.hs, file=new Uint8Array(hs+size+2), fdv=new DataView(file.buffer);
  file.set(src.bytes.subarray(0,hs),0); fdv.setUint32(4,size,true);
  if(hs>=14&&(src.bytes[12]|src.bytes[13]||src.broken)){const c=fitCrc(file,0,12);file[12]=c&255;file[13]=c>>8;}
  let p=hs; for(const b of parts){file.set(b,p);p+=b.length;}
  const c=fitCrc(file,0,p); file[p]=c&255; file[p+1]=c>>8;
  return file;
}

/* ================= Activity model ================= */
const SPORTS=[
  ["sp_run",1,0],["sp_track",1,4],["sp_indoor",1,45],["sp_treadmill",1,1],["sp_trail",1,3],
  ["sp_walk",11,0],["sp_hike",17,0],["sp_bike",2,0],["sp_indoorbike",2,6],["sp_xc",12,0],["sp_row",15,0],["sp_training",4,0]];
function sportName(sp,sub){
  const hit=SPORTS.find(s=>s[1]===sp&&s[2]===(sub??0))||SPORTS.find(s=>s[1]===sp&&s[2]===0);
  return t(hit?hit[0]:"sp_other");
}
const PACE_SPORTS=[1,11,17];
// Garmin product numbers, taken from Garmin's FIT SDK profile.
const DEVICES=[["Forerunner 55",3869],["Forerunner 165",4432],["Forerunner 245",3076],["Forerunner 255",3992],["Forerunner 265",4257],["Forerunner 570",4570],
  ["Forerunner 745",3589],["Forerunner 945",3113],["Forerunner 955",4024],["Forerunner 965",4315],["Forerunner 970",4565],["fēnix 6",3290],["fēnix 7",3906],
  ["fēnix 7 Pro Solar",4375],["fēnix 8",4536],["epix (Gen 2)",3943],["Enduro 2",4341],["Enduro 3",4575],["Venu 2",3703],["Venu 3",4260],["vívoactive 5",4426],
  ["Instinct 2",3888],["Edge 530",3121],["Edge 540",4061],["Edge 830",3122],["Edge 840",4062],["Edge 1040",3843],["Edge 1050",4440]];

function buildModel(fit){
  const {dv}=fit, records=[], laps=[], sessions=[], events=[], acts=[], sports=[], devs=[]; let created=null, fileId=null;
  for(const m of fit.msgs){
    switch(m.g){
      case 20:{const d=rd(dv,m,5), s=rd(dv,m,73)??rd(dv,m,6), a=rd(dv,m,78)??rd(dv,m,2);
        records.push({m,ts:m.ts,dist:d==null?null:d/100,speed:s==null?null:s/1000,hr:rd(dv,m,3),cad:rd(dv,m,4),pwr:rd(dv,m,7),
          alt:a==null?null:a/5-500,lat:rdS32(dv,m,0),lon:rdS32(dv,m,1)});break;}
      case 19: laps.push({m,start:rd(dv,m,2),end:m.ts,elapsed:(rd(dv,m,7)??0)/1000,timer:(rd(dv,m,8)??0)/1000,dist:(rd(dv,m,9)??0)/100,records:[]});break;
      case 18: sessions.push({m,start:rd(dv,m,2),end:m.ts,elapsed:(rd(dv,m,7)??0)/1000,timer:(rd(dv,m,8)??0)/1000,dist:(rd(dv,m,9)??0)/100,sport:rd(dv,m,5),sub:rd(dv,m,6)});break;
      case 21: events.push({m,ts:m.ts,ev:rd(dv,m,0),type:rd(dv,m,1)});break;
      case 23: devs.push(m);break;
      case 34: acts.push({m});break;
      case 12: sports.push({m});break;
      case 0: created=rd(dv,m,4); fileId=m; break;
    }
  }
  if(!laps.length) throw new Error(t("e_nolaps"));
  // Some watches (e.g. Forerunner 265) write the summary messages first, with the activity start time in the
  // timestamp field. So a lap's end comes from its start + elapsed time, and the timestamp field is only
  // rewritten when it really holds the end time (tsIsEnd).
  laps.forEach((L,i)=>{
    if(L.start==null) L.start=i?laps[i-1].end:(records[0]?.ts??L.end);
    L.tsIsEnd=L.end!=null&&L.end>L.start;
    if(L.elapsed>0) L.end=L.start+Math.round(L.elapsed);
    else if(!L.tsIsEnd) L.end=i<laps.length-1&&laps[i+1].start!=null?laps[i+1].start:L.start;
  });
  sessions.forEach(S=>{ S.tsIsEnd=S.end!=null&&S.start!=null&&S.end>S.start; if(S.start!=null&&S.elapsed>0) S.end=S.start+Math.round(S.elapsed); });
  const pauses=[]; let stopAt=null;
  for(const e of events.filter(e=>e.ev===0&&e.ts!=null).sort((a,b)=>a.ts-b.ts)){
    const stop=[1,4,8,9].includes(e.type), go=e.type===0;
    if(stop&&stopAt==null) stopAt=e.ts; else if(go&&stopAt!=null){pauses.push([stopAt,e.ts]);stopAt=null;}
  }
  let mov=0, prev=null;
  for(const r of records){
    if(r.ts==null){r.mov=mov;continue;}
    r.gap=false;
    if(prev!=null){const dt=r.ts-prev; if(dt>0&&dt<=60&&!pauses.some(([s])=>s>=prev&&s<r.ts)) mov+=dt; else r.gap=true;}
    r.mov=mov; prev=r.ts;
  }
  let li=0;
  for(const r of records){ if(r.ts==null) continue; while(li<laps.length-1&&laps[li+1].start!=null&&r.ts>=laps[li+1].start) li++; laps[li].records.push(r); }
  let prevDist=0, prevMov=0;
  for(const L of laps){
    L.origStart=prevDist; L.movStart=prevMov;
    const wd=L.records.filter(r=>r.dist!=null); if(wd.length) prevDist=wd[wd.length-1].dist;
    if(L.records.length) prevMov=L.records[L.records.length-1].mov;
    if(!L.timer) L.timer=Math.max(0,(L.records.length?L.records[L.records.length-1].mov:L.movStart)-L.movStart);
  }
  const S0=sessions[0]||{};
  const t0=laps[0].start??records[0]?.ts, t1=Math.max(laps[laps.length-1].end, records.length?records[records.length-1].ts:0);
  const hrDef=records.length?!!records[0].m.d.fields[3]:false;
  return {fit,records,laps,sessions,events,acts,sports,devs,pauses,created,fileId,t0,t1,sport:S0.sport??null,sub:S0.sub??null,
    product:fileId?rd(dv,fileId,2):null,manufacturer:fileId?rd(dv,fileId,1):null,
    hasRecordDist:records.some(r=>r.dist!=null),hrDef,has:{hr:records.some(r=>r.hr!=null),cad:records.some(r=>r.cad!=null),pwr:records.some(r=>r.pwr!=null),
    gps:records.some(r=>r.lat!=null),alt:records.some(r=>r.alt!=null)}};
}

/* ================= Repair a broken file ================= */
function needsRepair(bytes){
  try{ const f=parseFit(bytes); if(f.broken) return true; const m=buildModel(f); return !m.sessions.length||!m.acts.length; }catch(e){ return true; }
}
function repairFit(bytes){
  const fit=parseFit(bytes,true), dv=fit.dv, notes=[];
  if(fit.broken==="cut") notes.push("rep_cut"); else if(fit.broken) notes.push("rep_corrupt");
  const msgs=fit.msgs, recs=msgs.filter(m=>m.g===20&&m.ts!=null);
  if(!recs.length) throw new Error(t("e_repair_none"));
  const R=recs.map(m=>({ts:m.ts,dist:rd(dv,m,5),hr:rd(dv,m,3)}));
  const t0=R[0].ts, t1=R[R.length-1].ts;
  let moving=0; for(let i=1;i<R.length;i++){const dt=R[i].ts-R[i-1].ts; if(dt>0&&dt<=60) moving+=dt;}
  const dists=R.filter(r=>r.dist!=null), dist=dists.length?dists[dists.length-1].dist:0;
  const hrs=R.map(r=>r.hr).filter(v=>v!=null), avgHr=hrs.length?hrs.reduce((a,b)=>a+b,0)/hrs.length:null, maxHr=hrs.length?Math.max(...hrs):null;
  const spMsg=msgs.find(m=>m.g===12), sesMsg=msgs.find(m=>m.g===18);
  const sport=(spMsg&&rd(dv,spMsg,0))??(sesMsg&&rd(dv,sesMsg,5))??1, sub=(spMsg&&rd(dv,spMsg,1))??(sesMsg&&rd(dv,sesMsg,6))??0;
  const lapMsgs=msgs.filter(m=>m.g===19), tail=[];
  const E=[[253,0x86],[0,0x00],[1,0x00]];
  const hasStop=msgs.some(m=>m.g===21&&rd(dv,m,0)===0&&[1,4,8,9].includes(rd(dv,m,1))&&m.ts>=t1-2);
  if(!hasStop){ tail.push(synthEntry(15,21,E,[t1,0,4])); notes.push("rep_stop"); }
  const LF=[[253,0x86],[2,0x86],[7,0x86],[8,0x86],[9,0x86],[13,0x84],[15,0x02],[16,0x02],[254,0x84],[0,0x00],[1,0x00],[24,0x00],[25,0x00],[39,0x00]];
  const lapDef={}; let lapEnd=t0, lapCount=lapMsgs.length;
  for(const m of lapMsgs){const s=rd(dv,m,2), el=rd(dv,m,7); lapEnd=Math.max(lapEnd,s!=null&&el!=null?s+Math.round(el/1000):(m.ts??lapEnd));}
  if(!lapMsgs.length||lapEnd<t1-5){
    const st=lapMsgs.length?lapEnd:t0, rs=R.filter(r=>r.ts>=st), d0=lapMsgs.length?(R.filter(r=>r.ts<st&&r.dist!=null).pop()?.dist??0):0;
    const ld=Math.max(0,dist-d0), lt=Math.max(1,t1-st), lh=rs.map(r=>r.hr).filter(v=>v!=null);
    tail.push(synthEntry(14,19,LF,[t1,st,lt*1000,lt*1000,ld,lt?ld*10/lt:0,lh.length?lh.reduce((a,b)=>a+b,0)/lh.length:null,lh.length?Math.max(...lh):null,lapCount,9,1,7,sport,sub],lapDef));
    lapCount++; notes.push(lapMsgs.length?"rep_lastlap":"rep_lap");
  }
  if(!sesMsg){
    const SF=[[253,0x86],[2,0x86],[7,0x86],[8,0x86],[9,0x86],[14,0x84],[16,0x02],[17,0x02],[5,0x00],[6,0x00],[25,0x84],[26,0x84],[0,0x00],[1,0x00],[28,0x00]];
    tail.push(synthEntry(13,18,SF,[t1,t0,(t1-t0)*1000,moving*1000,dist,moving?dist*10/moving:0,avgHr,maxHr,sport,sub,0,lapCount,8,1,0])); notes.push("rep_session");
  }
  if(!msgs.some(m=>m.g===34)){
    tail.push(synthEntry(12,34,[[253,0x86],[0,0x86],[1,0x84],[2,0x00],[3,0x00],[4,0x00]],[t1,moving*1000,1,0,26,1])); notes.push("rep_activity");
  }
  const out=new Uint8Array(fit.bytes);
  return {bytes:assemble(fit,out,new Set(),new Map(),new Map([["end",tail]])),notes};
}

/* ================= Combine two activities into one ================= */
function combineFits(bytesA,bytesB){
  let A=buildModel(parseFit(bytesA)), B=buildModel(parseFit(bytesB));
  if(A.fit.hasCompressed||B.fit.hasCompressed) throw new Error(t("na_compressed"));
  if(B.t0<A.t0) [A,B]=[B,A];
  if(B.t0<A.t1-5) throw new Error(t("e_combine_overlap"));
  const outA=new Uint8Array(A.fit.bytes), dvA=new DataView(outA.buffer), outB=new Uint8Array(B.fit.bytes), dvB=new DataView(outB.buffer);
  const aD=A.records.filter(r=>r.dist!=null), off=aD.length?aD[aD.length-1].dist:(A.sessions[0]?.dist||0);
  for(const r of B.records) if(r.dist!=null) wr(dvB,r.m,5,(r.dist+off)*100);
  B.laps.forEach((L,i)=>wr(dvB,L.m,254,A.laps.length+i));
  const entries=B.fit.msgs.filter(m=>m.g===19||m.g===20||m.g===21).map(m=>({defKey:m.defChunk,defBytes:outB.subarray(m.defChunk.start,m.defChunk.end),local:m.local,bytes:outB.subarray(m.start,m.end)}));
  const anchor=[...A.fit.msgs].reverse().find(m=>m.g===20||m.g===21);
  const bD=B.records.filter(r=>r.dist!=null), dist=off+(bD.length?bD[bD.length-1].dist:(B.sessions[0]?.dist||0));
  const timerA=A.sessions[0]?.timer||A.laps.reduce((a,L)=>a+L.timer,0), timerB=B.sessions[0]?.timer||B.laps.reduce((a,L)=>a+L.timer,0), timer=timerA+timerB;
  const st=statsOf(A.records.concat(B.records)), avg=timer>0?dist/timer:0;
  const SA=A.sessions[0], SB=B.sessions[0];
  if(SA){
    const m=SA.m, sum=n=>{const a=rd(A.fit.dv,m,n), b=SB?rd(B.fit.dv,SB.m,n):null; return a==null&&b==null?null:(a||0)+(b||0);};
    const mx=n=>Math.max(rd(A.fit.dv,m,n)||0,SB?rd(B.fit.dv,SB.m,n)||0:0);
    wr(dvA,m,9,dist*100); wr(dvA,m,7,(B.t1-A.t0)*1000); wr(dvA,m,8,timer*1000);
    wr(dvA,m,14,avg*1000); wr(dvA,m,124,avg*1000); wr(dvA,m,15,mx(15)); wr(dvA,m,125,mx(125));
    wr(dvA,m,16,st.avgHr); wr(dvA,m,17,st.maxHr); wr(dvA,m,26,A.laps.length+B.laps.length);
    for(const n of [11,22,23]){const v=sum(n); if(v!=null) wr(dvA,m,n,v);}
    if(SA.tsIsEnd) wr(dvA,m,253,B.t1);
  }
  for(const a of A.acts){const ts=a.m.ts; wr(dvA,a.m,0,timer*1000); if(ts!=null&&ts>A.t0+1){const lt=rd(A.fit.dv,a.m,5); wr(dvA,a.m,253,B.t1); if(lt!=null) wr(dvA,a.m,5,lt+(B.t1-ts));}}
  return assemble(A.fit,outA,new Set(),new Map(),new Map([[anchor,entries]]));
}

/* ================= Split one lap in two (forgot to press lap) ================= */
function splitLapFit(model,i,Ts){
  const src=model.fit, L=model.laps[i], m=L.m;
  if(src.hasCompressed) throw new Error(t("na_compressed"));
  const a=L.records.filter(r=>r.ts<Ts), b=L.records.filter(r=>r.ts>=Ts);
  if(!a.length||!b.length) throw new Error(t("e_split_lap"));
  const out=new Uint8Array(src.bytes), dv=new DataView(out.buffer,out.byteOffset,out.byteLength);
  const head=m.off-m.start, copy=out.slice(m.start,m.end), cdv=new DataView(copy.buffer), m2={d:m.d,off:head};
  const aD=a.filter(r=>r.dist!=null), e1=Ts-L.start, e2=Math.max(0,L.elapsed-e1);
  const d1=aD.length?Math.min(L.dist,Math.max(0,aD[aD.length-1].dist-L.origStart)):(L.elapsed>0?L.dist*e1/L.elapsed:L.dist/2), d2=Math.max(0,L.dist-d1);
  const t1=Math.min(L.timer,Math.max(0,a[a.length-1].mov-L.movStart)), t2=Math.max(0,L.timer-t1), f=L.timer>0?t1/L.timer:0.5;
  const patch=(d,mx,start,el,tt,dist,rs,first)=>{
    wr(d,mx,2,start); wr(d,mx,7,el*1000); wr(d,mx,8,tt*1000); wr(d,mx,9,dist*100);
    const avg=tt>0?dist/tt:0, sp=rs.map(r=>r.speed).filter(v=>v!=null), top=Math.max(avg,sp.reduce((x,y)=>y>x?y:x,0)), s=statsOf(rs);
    wr(d,mx,13,avg*1000); wr(d,mx,110,avg*1000); wr(d,mx,14,top*1000); wr(d,mx,111,top*1000);
    wr(d,mx,15,s.avgHr); wr(d,mx,16,s.maxHr); wr(d,mx,17,s.avgCad); wr(d,mx,18,s.maxCad); wr(d,mx,19,s.avgPwr); wr(d,mx,20,s.maxPwr);
    for(const n of [10,11,21,22]){ const v=rd(src.dv,m,n); if(v!=null){ const part=Math.round(v*f); wr(d,mx,n,first?part:v-part); } }
  };
  patch(dv,m,L.start,e1,t1,d1,a,true); patch(cdv,m2,Ts,e2,t2,d2,b,false);
  if(L.tsIsEnd) wr(dv,m,253,Ts);
  wr(cdv,m2,254,i+1);
  model.laps.forEach((x,k)=>{ if(k>i) wr(dv,x.m,254,k+1); });
  for(const S of model.sessions) wr(dv,S.m,26,(rd(src.dv,S.m,26)??model.laps.length)+1);
  // per-lap heart-rate zones point at laps by number
  for(const z of src.msgs){ if(z.g!==216||rd(src.dv,z,0)!==19) continue; const idx=rd(src.dv,z,1); if(idx!=null&&idx>i) wr(dv,z,1,idx+1); }
  const dc=m.defChunk;
  return assemble(src,out,new Set(),new Map(),new Map([[m,[{defKey:dc,defBytes:out.subarray(dc.start,dc.end),local:m.local,bytes:copy}]]]));
}
// The moment inside a lap where the pace changes the most: a good guess for a forgotten lap press.
function suggestCut(L){
  const rs=L.records.filter(r=>r.ts!=null), n=rs.length, val=r=>r.cad!=null?r.cad:(r.speed??0);
  if(n<60) return rs[n>>1]?.ts??L.start;
  const pre=[0]; for(const r of rs) pre.push(pre[pre.length-1]+val(r));
  let best=-1, at=n>>1;
  for(let i=20;i<n-20;i++){ const x=Math.abs(pre[i]/i-(pre[n]-pre[i])/(n-i)); if(x>best){best=x;at=i;} }
  return rs[at].ts;
}

/* ================= Which laps are intervals and which are rests ================= */
function classifyLaps(G){
  const speed=G.map(g=>g.timer>0?g.watch/g.timer:0), kinds=G.map(()=>"other"), res={kinds,fast:[]};
  if(G.length<3) return res;
  const sorted=[...speed].sort((a,b)=>a-b); let best=0, cut=null;
  for(let i=1;i<sorted.length;i++){const gap=sorted[i]-sorted[i-1]; if(gap>best){best=gap;cut=(sorted[i]+sorted[i-1])/2;}}
  if(cut==null||best<0.4) return res;
  res.fast=G.map((g,i)=>i).filter(i=>speed[i]>cut&&G[i].timer>=15);
  if(res.fast.length<2) return res;
  // strides and the like: fast, but far shorter than the real intervals
  const dur=res.fast.map(i=>G[i].timer).sort((a,b)=>a-b), med=dur[dur.length>>1];
  const work=res.fast.filter(i=>G[i].timer>=med*0.65&&G[i].timer<=med*1.35);
  if(work.length<2) return res;
  work.forEach(i=>kinds[i]="work");
  for(let i=work[0]+1;i<work[work.length-1];i++) if(kinds[i]==="other") kinds[i]="rest";
  return res;
}

/* ================= Heart rate from another recording ================= */
async function readHrSource(file){
  let bytes=new Uint8Array(await file.arrayBuffer()), name=file.name;
  if(bytes[0]===0x50&&bytes[1]===0x4B){const f=await fitFromZip(bytes); bytes=f.bytes; name=f.name;}
  let samples=[];
  if(bytes.length>12&&String.fromCharCode(bytes[8],bytes[9],bytes[10],bytes[11])===".FIT"){
    const f=parseFit(bytes,true); for(const m of f.msgs){ if(m.g!==20||m.ts==null) continue; const h=rd(f.dv,m,3); if(h!=null&&h>0) samples.push([m.ts,h]); }
  } else {
    const doc=new DOMParser().parseFromString(new TextDecoder().decode(bytes),"application/xml");
    const toTs=s=>Math.round(Date.parse(s)/1000)-FIT_EPOCH;
    for(const tp of doc.getElementsByTagName("Trackpoint")){ const tm=tp.getElementsByTagName("Time")[0], hr=tp.getElementsByTagName("HeartRateBpm")[0]; if(tm&&hr){const v=parseInt(hr.textContent,10); if(v>0) samples.push([toTs(tm.textContent),v]);} }
    if(!samples.length) for(const tp of doc.getElementsByTagName("trkpt")){ const tm=tp.getElementsByTagName("time")[0]; const hr=[...tp.getElementsByTagName("*")].find(e=>e.localName==="hr"); if(tm&&hr){const v=parseInt(hr.textContent,10); if(v>0) samples.push([toTs(tm.textContent),v]);} }
  }
  samples=samples.filter(s=>isFinite(s[0])).sort((a,b)=>a[0]-b[0]);
  if(!samples.length) throw new Error(t("e_hr_none"));
  return {name,samples};
}
function matchHr(recs,imp){
  const map=new Map(), s=imp.samples, off=imp.offset||0; if(!s.length) return map;
  for(const r of recs){ if(r.ts==null) continue; const ts=r.ts-off; let lo=0,hi=s.length-1;
    while(hi-lo>1){const mid=(lo+hi)>>1; if(s[mid][0]<ts) lo=mid; else hi=mid;}
    const best=Math.abs(s[lo][0]-ts)<=Math.abs(s[hi][0]-ts)?s[lo]:s[hi]; if(Math.abs(best[0]-ts)<=3) map.set(r,best[1]); }
  return map;
}

/* ================= Edits → derived laps ================= */
// E = { groups, dist, cropStart, trim, sport, mode, shift, spike:{mode:"jump"|"limit",jump,limit}|null, pwrMax,
//       remove:{hr,cad,pwr,gps,alt}, device:productId|null, hrImport:{name,samples,offset}|null, fileCreated }
const gkey=g=>g.join("-");
function freshEdits(model,mode){return {groups:model.laps.map((_,i)=>[i]),dist:{},cropStart:null,trim:null,sport:-1,mode:mode||"even",shift:0,spike:null,pwrMax:null,remove:{},device:null,hrImport:null,fileCreated:null};}
function lastBefore(model,T0){
  let dist=0, mov=0; for(const r of model.records){ if(r.ts==null||r.ts>=T0) break; if(r.dist!=null) dist=r.dist; mov=r.mov; } return {dist,mov};
}
function derive(model,E){
  const T0=E.cropStart??-Infinity, T=E.trim??Infinity, out=[];
  const pre=E.cropStart!=null?lastBefore(model,T0):null;
  E.groups.forEach((g,gi)=>{
    const L0=model.laps[g[0]], Ln=model.laps[g[g.length-1]];
    if(Ln.end<=T0&&gi<E.groups.length-1) return;
    if(out.length&&L0.start>=T) return;
    const clipStart=L0.start<T0, clipped=Ln.end>T, start=Math.max(L0.start,T0===-Infinity?L0.start:T0), end=Math.min(Ln.end,T);
    const recs=[]; let timer=0;
    for(const i of g){
      const L=model.laps[i]; const rs=L.records.filter(r=>r.ts>=T0&&r.ts<=T); recs.push(...rs);
      if(L.start>=T0&&L.end<=T) timer+=L.timer;
      else if(rs.length){ const m0=L.start>=T0?L.movStart:pre.mov; timer+=Math.max(0,Math.min(L.timer,rs[rs.length-1].mov-m0)); }
    }
    const origStart=clipStart?pre.dist:L0.origStart, movStart=clipStart?pre.mov:L0.movStart;
    const wd=recs.filter(r=>r.dist!=null);
    const watch=(clipped||clipStart)?(wd.length?Math.max(0,wd[wd.length-1].dist-origStart):0):g.reduce((a,i)=>a+model.laps[i].dist,0);
    const key=gkey(g);
    const dist=E.dist[key]!=null?E.dist[key]:Math.round(watch*100)/100;
    out.push({gi,key,laps:g,start,end,clipped,clipStart,timer,elapsed:Math.max(0,end-start),watch,dist,
      origStart,movStart,movEnd:recs.length?recs[recs.length-1].mov:movStart,recs,pristine:g.length===1&&!clipped&&!clipStart});
  });
  return out;
}
const isChanged=g=>Math.abs(g.dist-g.watch)>0.005;

function statsOf(recs,ov){
  const hrOf=r=>ov&&ov.hr?(ov.hr.has(r)?ov.hr.get(r):r.hr):r.hr, pwOf=r=>ov&&ov.pwr?(ov.pwr.has(r)?ov.pwr.get(r):r.pwr):r.pwr;
  const hr=recs.map(hrOf).filter(v=>v!=null), cad=recs.map(r=>r.cad).filter(v=>v!=null&&v>0), pw=recs.map(pwOf).filter(v=>v!=null);
  const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null, max=a=>a.length?a.reduce((x,y)=>y>x?y:x,-Infinity):null;
  return {avgHr:avg(hr),maxHr:max(hr),avgCad:avg(cad),maxCad:max(cad),avgPwr:avg(pw),maxPwr:max(pw)};
}
// Replace bad values with the straight line between the nearest good values around them.
function fillBad(recs,val,bad){
  const fix=new Map();
  for(let i=0;i<recs.length;i++){
    if(!bad[i]) continue;
    let a=i-1; while(a>=0&&(bad[a]||val[a]==null)) a--;
    let b=i+1; while(b<recs.length&&(bad[b]||val[b]==null)) b++;
    let v;
    if(a>=0&&b<recs.length){const span=recs[b].ts-recs[a].ts; v=span>0?val[a]+(val[b]-val[a])*(recs[i].ts-recs[a].ts)/span:val[a];}
    else if(a>=0) v=val[a]; else if(b<recs.length) v=val[b]; else continue;
    fix.set(recs[i],Math.round(v));
  }
  return fix;
}
function badLimit(val,limit){ return val.map(v=>v!=null&&v>limit); }
// A spike: the value sits well above the running median of the surrounding minute (real high heart rate builds up and stays).
function badJump(recs,val,jump,half=30){
  const bad=new Array(val.length).fill(false); let lo=0, hi=0;
  for(let i=0;i<val.length;i++){
    if(val[i]==null) continue;
    while(lo<i&&recs[i].ts-recs[lo].ts>half) lo++;
    while(hi<val.length-1&&recs[hi+1].ts-recs[i].ts<=half) hi++;
    const w=[]; for(let k=lo;k<=hi;k++) if(val[k]!=null) w.push(val[k]);
    w.sort((a,b)=>a-b); const med=w[w.length>>1];
    if(val[i]-med>jump) bad[i]=true;
  }
  return bad;
}
const REMOVE_FIELDS={
  hr:{rec:[3],lap:[15,16],ses:[16,17]},
  cad:{rec:[4,53],lap:[17,18],ses:[18,19]},
  pwr:{rec:[7,29],lap:[19,20],ses:[20,21]},
  gps:{rec:[0,1],lap:[3,4,5,6],ses:[3,4,29,30,31,32]},
  alt:{rec:[2,78],lap:[21,22],ses:[22,23]}};
const TIME_FIELDS={0:[4],18:[2],19:[2],34:[5],101:[2],142:[2]};
function editFlags(model,E){
  const removed=Object.keys(E.remove||{}).filter(k=>E.remove[k]&&model.has[k]);
  const spike=!removed.includes("hr")&&E.spike&&((E.spike.mode==="jump"&&E.spike.jump>0)||(E.spike.mode==="limit"&&E.spike.limit>0))?E.spike:null;
  const imp=!removed.includes("hr")&&E.hrImport&&E.hrImport.samples.length?E.hrImport:null;
  return {removed,spike,imp,
    cropS:E.cropStart!=null&&E.cropStart>model.t0, cropE:E.trim!=null&&E.trim<model.t1,
    shift:E.shift?Math.round(E.shift):0,
    pwrMax:!removed.includes("pwr")&&E.pwrMax>0?E.pwrMax:null,
    device:E.device&&E.device!==model.product?E.device:null};
}
// The heart-rate values the corrected file will hold (imported and/or despiked); returns Map(record -> bpm) of changes.
function hrOverrides(model,E,kept,F){
  F=F||editFlags(model,E); if(!F.imp&&!F.spike) return null;
  const imp=F.imp?matchHr(kept,F.imp):null;
  const val=kept.map(r=>imp&&imp.has(r)?imp.get(r):r.hr);
  const map=new Map(); if(imp) for(const [r,v] of imp) map.set(r,v);
  if(F.spike){ const bad=F.spike.mode==="jump"?badJump(kept,val,F.spike.jump):badLimit(val,F.spike.limit); const fix=fillBad(kept,val,bad); for(const [r,v] of fix) map.set(r,v); map.spikes=fix.size; }
  map.imported=imp?imp.size:0; map.spikes=map.spikes||0;
  return map;
}

/* ================= Build the corrected file ================= */
function build(model,E){
  const G=derive(model,E), src=model.fit, F=editFlags(model,E);
  const T0=F.cropS?E.cropStart:-Infinity, T=F.cropE?E.trim:Infinity;
  const out=new Uint8Array(src.bytes), dv=new DataView(out.buffer,out.byteOffset,out.byteLength);
  const drop=new Set(), repl=new Map(), recNew=new Map(), info=[];
  const sp=E.sport>=0?SPORTS[E.sport]:null;
  const anyDist=G.some(isChanged), merged=E.groups.some(g=>g.length>1), cropped=F.cropS||F.cropE;
  const kept=model.records.filter(r=>r.ts==null||(r.ts>=T0&&r.ts<=T));
  const ov={hr:hrOverrides(model,E,kept,F), pwr:null};
  if(F.pwrMax){const val=kept.map(r=>r.pwr); ov.pwr=fillBad(kept,val,badLimit(val,F.pwrMax));}
  const statsDirty=cropped||!!ov.hr||!!ov.pwr;
  let shift=F.cropS&&G.length?-G[0].origStart:0, prevD=0;
  for(const g of G){
    const D=g.dist, wd=g.recs.filter(r=>r.dist!=null);
    const od=(wd.length?wd[wd.length-1].dist:g.origStart)-g.origStart;
    const how=!isChanged(g)&&od>=0?"shift":(E.mode==="shape"&&od>0?"shape":"even");
    const movSpan=g.movEnd-g.movStart, vEven=g.timer>0?D/g.timer:0, base=g.origStart+shift; let maxV=0;
    for(const r of g.recs){
      if(r.dist==null&&how!=="even"){ if(r.speed!=null) maxV=Math.max(maxV,r.speed); continue; }
      let d, v=null;
      if(how==="shift") d=r.dist+shift;
      else if(how==="shape"){ d=base+D*Math.min(1,Math.max(0,(r.dist-g.origStart)/od)); if(r.speed!=null) v=r.speed*D/od; }
      else { const f=movSpan>0?Math.min(1,Math.max(0,(r.mov-g.movStart)/movSpan)):(g.end>g.start?Math.min(1,Math.max(0,(r.ts-g.start)/(g.end-g.start))):1); d=base+D*f; v=vEven; }
      if(d<prevD) d=prevD; prevD=d;
      recNew.set(r,{d,v});
      const vv=v!=null?v:r.speed; if(vv!=null) maxV=Math.max(maxV,vv);
    }
    info.push({g,maxV,how}); if(how!=="shift") shift+=D-Math.max(0,od);
  }
  for(const r of model.records){
    if(r.ts!=null&&(r.ts<T0||r.ts>T)){drop.add(r.m);continue;}
    const n=recNew.get(r);
    if(n){ if(Math.abs(n.d-(r.dist??-1))>0.004) wr(dv,r.m,5,n.d*100); if(n.v!=null){wr(dv,r.m,6,n.v*1000);wr(dv,r.m,73,n.v*1000);} }
    if(ov.hr&&ov.hr.has(r)) wr(dv,r.m,3,ov.hr.get(r));
    if(ov.pwr&&ov.pwr.has(r)) wr(dv,r.m,7,ov.pwr.get(r));
  }
  const first=new Map(G.map((g,k)=>[g.laps[0],k]));
  model.laps.forEach((L,i)=>{
    const k=first.get(i); if(k==null){drop.add(L.m);return;}
    const {g,maxV}=info[k], m=L.m, D=g.dist, tt=g.timer, avg=tt>0?D/tt:0, mx=Math.max(maxV,avg);
    if(isChanged(g)||!g.pristine){wr(dv,m,9,D*100);wr(dv,m,13,avg*1000);wr(dv,m,110,avg*1000);wr(dv,m,14,mx*1000);wr(dv,m,111,mx*1000);}
    const s=statsOf(g.recs,ov);
    if(!g.pristine){
      if(model.laps[g.laps[g.laps.length-1]].tsIsEnd) wr(dv,m,253,g.end);
      if(g.clipStart) wr(dv,m,2,g.start);
      wr(dv,m,7,g.elapsed*1000); wr(dv,m,8,tt*1000);
      wr(dv,m,17,s.avgCad); wr(dv,m,18,s.maxCad);
      if(g.laps.length>1){
        for(const num of [10,11,21,22]){let sum=0,any=false;for(const j of g.laps){const v=rd(src.dv,model.laps[j].m,num);if(v!=null){sum+=v;any=true;}}if(any)wr(dv,m,num,sum);}
        const last=model.laps[g.laps[g.laps.length-1]].m; copyField(out,m,last,5); copyField(out,m,last,6);
      }
    }
    if(!g.pristine||ov.hr){wr(dv,m,15,s.avgHr); wr(dv,m,16,s.maxHr);}
    if(!g.pristine||ov.pwr){wr(dv,m,19,s.avgPwr); wr(dv,m,20,s.maxPwr);}
    if(merged||cropped) wr(dv,m,254,k);
    if(sp){wr(dv,m,25,sp[1]);wr(dv,m,39,sp[2]);}
  });
  model.sessions.forEach((S,si)=>{
    if(si>0&&S.start!=null&&(S.start>=T||S.end<=T0)){drop.add(S.m);return;}
    const inS=g=>model.sessions.length===1||(g.start>=S.start&&g.start<S.end);
    const gs=G.filter(inS), dist=gs.reduce((a,g)=>a+g.dist,0);
    if(anyDist||merged||cropped){
      const timer=cropped?gs.reduce((a,g)=>a+g.timer,0):S.timer, avg=timer>0?dist/timer:0;
      const mx=Math.max(avg,...info.filter(x=>inS(x.g)).map(x=>Math.max(x.maxV,x.g.timer>0?x.g.dist/x.g.timer:0)));
      wr(dv,S.m,9,dist*100); wr(dv,S.m,14,avg*1000); wr(dv,S.m,124,avg*1000); wr(dv,S.m,15,mx*1000); wr(dv,S.m,125,mx*1000);
      if(cropped){
        const st=Math.max(S.start,T0), end=Math.min(S.end,T);
        if(F.cropS) wr(dv,S.m,2,st);
        if(S.tsIsEnd&&F.cropE) wr(dv,S.m,253,end);
        wr(dv,S.m,7,(end-st)*1000); wr(dv,S.m,8,Math.min(timer,end-st)*1000);
        const s=statsOf(gs.flatMap(g=>g.recs),ov); wr(dv,S.m,18,s.avgCad); wr(dv,S.m,19,s.maxCad);
      }
      if(merged||cropped) wr(dv,S.m,26,gs.length);
    }
    if(statsDirty){const s=statsOf(gs.flatMap(g=>g.recs),ov); wr(dv,S.m,16,s.avgHr); wr(dv,S.m,17,s.maxHr); if(ov.pwr||cropped){wr(dv,S.m,20,s.avgPwr); wr(dv,S.m,21,s.maxPwr);}}
    if(sp){wr(dv,S.m,5,sp[1]);wr(dv,S.m,6,sp[2]);}
  });
  if(sp) for(const s of model.sports){wr(dv,s.m,0,sp[1]);wr(dv,s.m,1,sp[2]);}
  if(cropped){
    let keptStop=false, keptStart=false;
    for(const e of model.events){
      if(e.ts==null) continue;
      if(e.ts>T){ if(e.ev===0&&[1,4,8,9].includes(e.type)&&!keptStop){keptStop=true;wr(dv,e.m,253,T);} else drop.add(e.m); }
      else if(e.ts<T0){ if(e.ev===0&&e.type===0&&!keptStart){keptStart=true;wr(dv,e.m,253,T0);} else drop.add(e.m); }
    }
    const timer=G.reduce((a,g)=>a+g.timer,0);
    for(const a of model.acts){const ts=a.m.ts; if(F.cropE&&ts!=null&&ts>T){const lt=rd(src.dv,a.m,5); wr(dv,a.m,253,T); if(lt!=null) wr(dv,a.m,5,lt-(ts-T));} wr(dv,a.m,0,timer*1000);}
    for(const m of src.msgs){
      if(m.g===20||m.g===21||drop.has(m)) continue;
      const ts=rd(dv,m,253); if(ts==null) continue;
      if(ts>T&&m.g!==34) wr(dv,m,253,T); else if(ts<T0) wr(dv,m,253,T0);
    }
  }
  for(const k of F.removed){
    const R=REMOVE_FIELDS[k];
    for(const r of model.records) if(!drop.has(r.m)) for(const n of R.rec) wrInvalid(out,r.m,n);
    for(const L of model.laps) if(!drop.has(L.m)) for(const n of R.lap) wrInvalid(out,L.m,n);
    for(const S of model.sessions) if(!drop.has(S.m)) for(const n of R.ses) wrInvalid(out,S.m,n);
  }
  if(F.device&&model.fileId){
    wr(dv,model.fileId,1,1); wr(dv,model.fileId,2,F.device);
    for(const m of model.devs) if(rd(src.dv,m,0)===0){ wr(dv,m,2,1); wr(dv,m,4,F.device); }
  }
  if(E.fileCreated!=null&&model.fileId) wr(dv,model.fileId,4,E.fileCreated);
  if(F.shift){
    for(const m of src.msgs){
      if(drop.has(m)) continue;
      for(const n of [253,...(TIME_FIELDS[m.g]||[])]){ const v=rd(dv,m,n); if(v!=null&&v>0x10000000) wr(dv,m,n,v+F.shift); }
    }
  }
  // records without a heart-rate field get one when heart rate is imported
  if(ov.hr&&ov.hr.size){
    for(const c of src.chunks){
      if(c.kind!=="def"||c.d.g!==20||c.d.fields[3]) continue;
      const ob=out.subarray(c.start,c.end), nb=new Uint8Array(ob.length+3), fe=6+c.n*3;
      nb.set(ob.subarray(0,fe)); nb[5]=c.n+1; nb[fe]=3; nb[fe+1]=1; nb[fe+2]=2; nb.set(ob.subarray(fe),fe+3); repl.set(c,nb);
    }
    for(const r of model.records){
      const dc=r.m.defChunk; if(drop.has(r.m)||!repl.has(dc)) continue;
      const head=r.m.off-r.m.start, ns=r.m.d.normSize, ob=out.subarray(r.m.start,r.m.end), nb=new Uint8Array(ob.length+1);
      nb.set(ob.subarray(0,head+ns)); const v=ov.hr.get(r); nb[head+ns]=v==null?0xFF:Math.min(254,v); nb.set(ob.subarray(head+ns),head+ns+1); repl.set(r.m,nb);
    }
  }
  const file=assemble(src,out,drop,repl,null);
  return {file,G,anyDist,merged,cropped,F,fixedHr:ov.hr?ov.hr.spikes:0,importedHr:ov.hr?ov.hr.imported:0,fixedPwr:ov.pwr?ov.pwr.size:0};
}

/* ================= Re-read the new file and compare ================= */
function verify(model,E,file,G){
  const res={ok:true,items:[]}; let fit2, m2;
  try{fit2=parseFit(file);m2=buildModel(fit2);}catch(e){return {ok:false,error:e.message};}
  res.model=m2;
  const F=editFlags(model,E), T0=F.cropS?E.cropStart:-Infinity, T=F.cropE?E.trim:Infinity;
  const crcOk=fitCrc(file,0,fit2.end)===(file[fit2.end]|file[fit2.end+1]<<8);
  const a=model.records.filter(r=>r.ts==null||(r.ts>=T0&&r.ts<=T)), b=m2.records;
  const SKIP=new Set([5,6,73]); if(F.shift) SKIP.add(253); if(F.spike||F.imp) SKIP.add(3); if(F.pwrMax) SKIP.add(7);
  for(const k of F.removed) for(const n of REMOVE_FIELDS[k].rec) SKIP.add(n);
  const hov=hrOverrides(model,E,a,F);
  let identical=0, hrN=0, hrSame=0, hrChanged=0, cadN=0, cadSame=0, tsSame=0, posN=0, posSame=0;
  const n=Math.min(a.length,b.length), A=model.fit.bytes, B=file;
  for(let k=0;k<n;k++){
    const x=a[k], y=b[k], fx=x.m.d.fields, fy=y.m.d.fields; let same=true;
    for(const num in fx){ if(SKIP.has(+num)) continue; const f=fx[num], g=fy[num]; if(!g||g.size!==f.size){same=false;break;}
      for(let i=0;i<f.size;i++) if(A[x.m.off+f.o+i]!==B[y.m.off+g.o+i]){same=false;break;} if(!same) break; }
    if(same){ const dx=x.m.d.size-x.m.d.normSize; if(dx!==y.m.d.size-y.m.d.normSize) same=false; else for(let i=0;i<dx;i++) if(A[x.m.off+x.m.d.normSize+i]!==B[y.m.off+y.m.d.normSize+i]){same=false;break;} }
    if(same) identical++;
    if(hov&&hov.has(x)){ hrChanged++; if(y.hr===hov.get(x)) hrSame++; hrN++; }
    else if(x.hr!=null){hrN++; if(x.hr===y.hr) hrSame++;}
    if(x.cad!=null){cadN++; if(x.cad===y.cad) cadSame++;}
    if(x.ts===null||y.ts===x.ts+F.shift) tsSame++;
    if(x.lat!=null){posN++; if(x.lat===y.lat&&x.lon===y.lon) posSame++;}
  }
  let mono=true, prevD=-1, maxV=0;
  for(const r of b){ if(r.dist!=null){ if(r.dist<prevD-0.001) mono=false; prevD=r.dist;} if(r.speed!=null) maxV=Math.max(maxV,r.speed); }
  const f=x=>fmtInt(x), rm=F.removed;
  res.items.push({ok:crcOk,t:t(crcOk?"v_crc_ok":"v_crc_bad")});
  res.items.push({ok:a.length===b.length,t:t("v_pts",{a:f(b.length),b:f(a.length),c:(F.cropS||F.cropE)?t("v_pts_trim"):""})});
  if(rm.includes("hr")) res.items.push({ok:b.every(r=>r.hr==null),t:t("v_removed",{x:t("rm_hr")})});
  else if(hov) res.items.push({ok:hrSame===hrN,t:t("v_hr_changed",{a:f(hrChanged),b:f(hrN-hrChanged)})});
  else if(hrN) res.items.push({ok:hrSame===hrN,t:t("v_hr",{a:f(hrSame),b:f(hrN)})});
  if(rm.includes("cad")) res.items.push({ok:b.every(r=>r.cad==null),t:t("v_removed",{x:t("rm_cad")})});
  else if(cadN) res.items.push({ok:cadSame===cadN,t:t("v_cad",{a:f(cadSame),b:f(cadN)})});
  if(rm.includes("pwr")) res.items.push({ok:b.every(r=>r.pwr==null),t:t("v_removed",{x:t("rm_pwr")})});
  if(rm.includes("alt")) res.items.push({ok:b.every(r=>r.alt==null),t:t("v_removed",{x:t("rm_alt_short")})});
  res.items.push({ok:tsSame===n,t:F.shift?t("v_ts_shift",{n:f(tsSame)}):t("v_ts",{a:f(tsSame),b:f(n)})});
  if(rm.includes("gps")) res.items.push({ok:b.every(r=>r.lat==null),t:t("v_removed",{x:t("rm_gps_short")})});
  else res.items.push({ok:posSame===posN,t:posN?t("v_pos",{a:f(posSame),b:f(posN)}):t("v_nopos")});
  res.items.push({ok:identical===n,t:t("v_rest",{a:f(identical),b:f(n)})});
  res.items.push({ok:mono,t:t(mono?"v_mono_ok":"v_mono_bad")});
  if(G){
    let bad=0, n2=0;
    G.forEach((g,k)=>{ if(!isChanged(g)||!m2.laps[k]) return; const L2=m2.laps[k], wd=L2.records.filter(r=>r.dist!=null); if(!wd.length) return; n2++;
      const span=wd[wd.length-1].dist-L2.origStart; if(Math.abs(span-g.dist)>Math.max(1,0.01*g.dist)) bad++; });
    if(n2) res.items.push({ok:bad===0,t:bad?t("v_span_bad",{n:bad}):t("v_span_ok",{n:n2})});
  }
  if(F.device) res.items.push({ok:m2.product===F.device,t:t("v_device",{x:(DEVICES.find(d=>d[1]===F.device)||["?"])[0]})});
  const plaus=PACE_SPORTS.includes(model.sport??1)?maxV<11:maxV<40;
  res.items.push({ok:plaus,warn:true,t:t(plaus?"v_speed_ok":"v_speed_bad",{x:fmtDec(maxV*3.6,1)})});
  res.ok=res.items.every(i=>i.ok||i.warn);
  return res;
}

/* ================= What Strava-style apps will show (from a parsed file) ================= */
function summarize(model){
  const recs=model.records.filter(r=>r.ts!=null), S=model.sessions[0], dv=model.fit.dv;
  const pace=PACE_SPORTS.includes(model.sport??1), minV=pace?0.5:1;
  const withD=recs.filter(r=>r.dist!=null);
  const d0=withD.length&&withD[0].dist>50?withD[0].dist:0;
  const dist=withD.length?withD[withD.length-1].dist-d0:(S?S.dist:model.laps.reduce((a,L)=>a+L.dist,0));
  let moving=0;
  for(let i=1;i<recs.length;i++){
    const a=recs[i-1], b=recs[i], dt=b.ts-a.ts; if(b.gap||dt<=0) continue;
    if(a.dist!=null&&b.dist!=null){ if((b.dist-a.dist)/dt>=minV) moving+=dt; } else moving+=dt;
  }
  if(!withD.length) moving=S?S.timer:moving;
  const elapsed=S&&S.elapsed?S.elapsed:(model.t1-model.t0);
  let elev=S?rd(dv,S.m,22):null;
  if(elev==null){ let g=0, ref=null; for(const r of recs){ if(r.alt==null) continue; if(ref==null) ref=r.alt; else if(r.alt-ref>=1){g+=r.alt-ref;ref=r.alt;} else if(r.alt<ref) ref=r.alt; } elev=recs.some(r=>r.alt!=null)?g:null; }
  const cal=S?rd(dv,S.m,11):null;
  const st=statsOf(recs);
  const avgHr=(S&&rd(dv,S.m,16))??st.avgHr, maxHr=(S&&rd(dv,S.m,17))??st.maxHr;
  const avgCad=(S&&rd(dv,S.m,18))??st.avgCad;
  const splits=[];
  if(withD.length){
    let mv=0, hrs=[], altStart=null, lastAlt=null, started=false, next=d0+1000;
    for(let i=0;i<recs.length;i++){
      const r=recs[i]; if(r.dist==null) continue;
      if(!started){started=true; altStart=r.alt;}
      if(i>0&&!r.gap){const p=recs[i-1]; if(p.dist!=null){const dt=r.ts-p.ts; if(dt>0&&(r.dist-p.dist)/dt>=minV) mv+=dt;}}
      if(r.hr!=null) hrs.push(r.hr); if(r.alt!=null) lastAlt=r.alt;
      while(r.dist>=next){
        splits.push({km:(next-d0)/1000,dist:1000,moving:mv,hr:hrs.length?hrs.reduce((a,b)=>a+b,0)/hrs.length:null,elev:altStart!=null&&lastAlt!=null?lastAlt-altStart:null});
        mv=0; hrs=[]; altStart=lastAlt; next+=1000;
      }
    }
    const rest=dist-(next-1000-d0);
    if(rest>=50) splits.push({km:dist/1000,dist:rest,moving:mv,hr:hrs.length?hrs.reduce((a,b)=>a+b,0)/hrs.length:null,elev:altStart!=null&&lastAlt!=null?lastAlt-altStart:null,partial:true});
  }
  const series=[]; let j=0;
  for(let i=0;i<recs.length;i++){
    const r=recs[i]; if(r.dist==null) continue;
    while(j<i&&r.ts-recs[j].ts>15) j++;
    const a=recs[j]; let v=null;
    if(a&&a!==r&&a.dist!=null&&r.ts>a.ts) v=(r.dist-a.dist)/(r.ts-a.ts); else if(r.speed!=null) v=r.speed;
    series.push({d:r.dist-d0,v,hr:r.hr,cad:r.cad,ts:r.ts});
  }
  const route=recs.filter(r=>r.lat!=null&&r.lon!=null).map(r=>[r.lat*180/2**31,r.lon*180/2**31]);
  const laps=model.laps.map(L=>{const m=L.m;return {dist:L.dist,timer:L.timer,hr:rd(dv,m,15)};});
  return {dist,moving,elapsed,elev,cal,avgHr,maxHr,avgCad,splits,series,route,laps,sport:model.sport,sub:model.sub,start:model.t0};
}

/* ================= Exports: CSV, TCX, GPX ================= */
const iso=ts=>new Date((ts+FIT_EPOCH)*1000).toISOString().replace(".000Z","Z");
function csvLaps(model){
  const dv=model.fit.dv, rows=[["lap","start_utc","time_s","distance_m","avg_speed_m_s","avg_hr","max_hr","avg_cadence"]];
  model.laps.forEach((L,i)=>rows.push([i+1,iso(L.start),L.timer.toFixed(1),L.dist.toFixed(2),L.timer>0?(L.dist/L.timer).toFixed(3):"",rd(dv,L.m,15)??"",rd(dv,L.m,16)??"",rd(dv,L.m,17)??""]));
  return rows.map(r=>r.join(",")).join("\n");
}
function csvPoints(model){
  const rows=[["time_utc","elapsed_s","distance_m","speed_m_s","heart_rate","cadence","power","altitude_m","lat","lon"]], t0=model.records.find(r=>r.ts!=null)?.ts;
  for(const r of model.records){ if(r.ts==null) continue;
    rows.push([iso(r.ts),r.ts-t0,r.dist??"",r.speed??"",r.hr??"",r.cad??"",r.pwr??"",r.alt!=null?r.alt.toFixed(1):"",r.lat!=null?(r.lat*180/2**31).toFixed(7):"",r.lon!=null?(r.lon*180/2**31).toFixed(7):""]); }
  return rows.map(r=>r.join(",")).join("\n");
}
function tcxOf(model){
  const dv=model.fit.dv, run=PACE_SPORTS.includes(model.sport??1), sport=model.sport===1?"Running":model.sport===2?"Biking":"Other";
  let x=`<?xml version="1.0" encoding="UTF-8"?>\n<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">\n<Activities><Activity Sport="${sport}"><Id>${iso(model.t0)}</Id>\n`;
  for(const L of model.laps){
    const ah=rd(dv,L.m,15), mh=rd(dv,L.m,16), cal=rd(dv,L.m,11)||0, ms=rd(dv,L.m,111)??rd(dv,L.m,14);
    x+=`<Lap StartTime="${iso(L.start)}"><TotalTimeSeconds>${L.timer.toFixed(1)}</TotalTimeSeconds><DistanceMeters>${L.dist.toFixed(2)}</DistanceMeters>${ms!=null?`<MaximumSpeed>${(ms/1000).toFixed(3)}</MaximumSpeed>`:""}<Calories>${cal}</Calories>${ah!=null?`<AverageHeartRateBpm><Value>${ah}</Value></AverageHeartRateBpm>`:""}${mh!=null?`<MaximumHeartRateBpm><Value>${mh}</Value></MaximumHeartRateBpm>`:""}<Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod><Track>\n`;
    for(const r of L.records){
      if(r.ts==null) continue;
      x+=`<Trackpoint><Time>${iso(r.ts)}</Time>${r.lat!=null?`<Position><LatitudeDegrees>${(r.lat*180/2**31).toFixed(7)}</LatitudeDegrees><LongitudeDegrees>${(r.lon*180/2**31).toFixed(7)}</LongitudeDegrees></Position>`:""}${r.alt!=null?`<AltitudeMeters>${r.alt.toFixed(1)}</AltitudeMeters>`:""}${r.dist!=null?`<DistanceMeters>${r.dist.toFixed(2)}</DistanceMeters>`:""}${r.hr!=null?`<HeartRateBpm><Value>${r.hr}</Value></HeartRateBpm>`:""}${!run&&r.cad!=null?`<Cadence>${r.cad}</Cadence>`:""}${r.speed!=null||(run&&r.cad!=null)?`<Extensions><ns3:TPX>${r.speed!=null?`<ns3:Speed>${r.speed.toFixed(3)}</ns3:Speed>`:""}${run&&r.cad!=null?`<ns3:RunCadence>${r.cad}</ns3:RunCadence>`:""}</ns3:TPX></Extensions>`:""}</Trackpoint>\n`;
    }
    x+=`</Track></Lap>\n`;
  }
  return x+`</Activity></Activities>\n</TrainingCenterDatabase>\n`;
}
function gpxOf(model){
  let x=`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Track Lap Fixer" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">\n<metadata><time>${iso(model.t0)}</time></metadata>\n<trk><name>${esc0(sportName(model.sport,model.sub))}</name><trkseg>\n`;
  for(const r of model.records){
    if(r.ts==null||r.lat==null) continue;
    const ext=r.hr!=null||r.cad!=null?`<extensions><gpxtpx:TrackPointExtension>${r.hr!=null?`<gpxtpx:hr>${r.hr}</gpxtpx:hr>`:""}${r.cad!=null?`<gpxtpx:cad>${r.cad}</gpxtpx:cad>`:""}</gpxtpx:TrackPointExtension></extensions>`:"";
    x+=`<trkpt lat="${(r.lat*180/2**31).toFixed(7)}" lon="${(r.lon*180/2**31).toFixed(7)}">${r.alt!=null?`<ele>${r.alt.toFixed(1)}</ele>`:""}<time>${iso(r.ts)}</time>${ext}</trkpt>\n`;
  }
  return x+`</trkseg></trk>\n</gpx>\n`;
}
const esc0=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

/* ================= ZIP in/out ================= */
async function fitFromZip(u8){
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  let e=-1; for(let i=u8.length-22;i>=Math.max(0,u8.length-66000);i--){if(dv.getUint32(i,true)===0x06054b50){e=i;break;}}
  if(e<0) throw new Error(t("e_zip"));
  const count=dv.getUint16(e+10,true); let p=dv.getUint32(e+16,true);
  for(let k=0;k<count;k++){
    if(dv.getUint32(p,true)!==0x02014b50) break;
    const method=dv.getUint16(p+10,true), csize=dv.getUint32(p+20,true), nl=dv.getUint16(p+28,true), xl=dv.getUint16(p+30,true), cl=dv.getUint16(p+32,true), lo=dv.getUint32(p+42,true);
    const name=new TextDecoder().decode(u8.subarray(p+46,p+46+nl)); p+=46+nl+xl+cl;
    if(!/\.(fit|tcx|gpx)$/i.test(name)) continue;
    const st=lo+30+dv.getUint16(lo+26,true)+dv.getUint16(lo+28,true), raw=u8.slice(st,st+csize);
    if(method===0) return {name:name.split("/").pop(),bytes:raw};
    if(method===8){
      if(typeof DecompressionStream==="undefined") throw new Error(t("e_unzip_browser"));
      const ab=await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
      return {name:name.split("/").pop(),bytes:new Uint8Array(ab)};
    }
    throw new Error(t("e_zip_method"));
  }
  throw new Error(t("e_zip_nofit"));
}
const CRC32=(()=>{const tb=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;tb[n]=c>>>0;}return tb;})();
function crc32(b){let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=CRC32[(c^b[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
function makeZip(name,data){
  if(typeof data==="string") data=new TextEncoder().encode(data);
  const nb=new TextEncoder().encode(name), crc=crc32(data), n=nb.length;
  const out=new Uint8Array(30+n+data.length+46+n+22), dv=new DataView(out.buffer); let p=0;
  dv.setUint32(p,0x04034b50,true);dv.setUint16(p+4,20,true);dv.setUint32(p+14,crc,true);dv.setUint32(p+18,data.length,true);dv.setUint32(p+22,data.length,true);dv.setUint16(p+26,n,true);out.set(nb,p+30);p+=30+n;
  out.set(data,p);p+=data.length; const cd=p;
  dv.setUint32(p,0x02014b50,true);dv.setUint16(p+4,20,true);dv.setUint16(p+6,20,true);dv.setUint32(p+16,crc,true);dv.setUint32(p+20,data.length,true);dv.setUint32(p+24,data.length,true);dv.setUint16(p+28,n,true);out.set(nb,p+46);p+=46+n;
  dv.setUint32(p,0x06054b50,true);dv.setUint16(p+8,1,true);dv.setUint16(p+10,1,true);dv.setUint32(p+12,46+n,true);dv.setUint32(p+16,cd,true);
  return out;
}
