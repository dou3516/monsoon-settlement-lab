(function(){
'use strict';
const M=window.MonsoonModel,$=s=>document.querySelector(s),$$=s=>Array.from(document.querySelectorAll(s)),copy=M.clone;
const initial={schema:'monsoon-lab-v2',scene:'settlement',active:'A',plans:M.presets(),weather:{...M.WEATHER},params:{...M.DEFAULTS},source:{type:'custom',label:'自定义情境'}};
let state=copy(initial),results=null,revision=0,running=false,tool='select',selected='target',drag=null,history=[],toastTimer;
const canvas=$('#mapCanvas'),ctx=canvas.getContext('2d');
const weatherKeys=['temperature','humidity','windSpeed','solar','windDirection'];
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmt(n,d=0){return Number(n).toLocaleString('zh-CN',{minimumFractionDigits:d,maximumFractionDigits:d});}
function delta(n){const v=-n;return Math.abs(v)<.005?'0.00':(v>0?'+':'−')+Math.abs(v).toFixed(2);}
function toast(t){$('#toast').textContent=t;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3400);}
function windName(d){return ['北','东北','东','东南','南','西南','西','西北'][Math.round(((d%360)+360)%360/45)%8];}
function persist(){try{localStorage.setItem('monsoon-lab-state-v2',JSON.stringify(state));}catch(e){/* optional persistence */}}
function validateState(s){
 if(!s||s.schema!=='monsoon-lab-v2'||s.scene!=='settlement'||!['A','B'].includes(s.active))throw Error('请导入统一聚落版实验文件；旧城镇／村落文件请使用旧版应用。');
 M.validateWeather(s.weather);M.validateParams({...M.DEFAULTS,...s.params});
 M.validateLayout(s.plans.A);M.validateLayout(s.plans.B);
 for(const list of [s.plans.A,s.plans.B]){
 const t=list.find(o=>o.type==='target');
 if(list.some(o=>o.type==='building')||t.x!==350||t.y!==250||t.w!==100||t.h!==100)throw Error('本版仅允许中央固定聚落与周边树木、水域。');
 t.locked=true;t.name='聚落';
 }
 for(const list of [s.plans.A,s.plans.B])for(const o of list){o.name=String(o.name||o.type).slice(0,50);o.id=String(o.id).slice(0,50);}
 if(!s.source||typeof s.source.label!=='string')s.source={type:'custom',label:'导入的自定义情境'};
 return s;
}
try{const old=localStorage.getItem('monsoon-lab-state-v2');if(old)state=validateState(JSON.parse(old));}catch(e){state=copy(initial);}
function saveUndo(){history.push({scene:state.scene,plans:copy(state.plans)});if(history.length>40)history.shift();}
function invalidate(message){
 revision++;results=null;$('#status').className='status dirty';$('#status').innerHTML='<i></i>待重新计算';
 $('#staleOverlay').hidden=false;$('#resultsBody').hidden=true;$('#resultEmpty').hidden=false;
 $('#resultEmpty').innerHTML='布局或气象条件已更新。<br>重新运行，比较两个方案。';
 $('#paperBtn').disabled=true;$('#csvBtn').disabled=true;$('#sensitivityBtn').disabled=true;
 persist();draw();drawHistory();if(message)toast(message);
}
function syncWeather(){
 for(const k of weatherKeys)$('#'+k).value=state.weather[k];
 $('#tempHero').textContent=fmt(state.weather.temperature,1).replace(/\.0$/,'');
 $('#windLabel').textContent=windName(state.weather.windDirection)+'风 · '+state.weather.windDirection+'°';
 $('#windNeedle').style.transform='rotate('+(state.weather.windDirection+180)+'deg)';
 $$('.wind-presets button').forEach(b=>b.classList.toggle('active',Number(b.dataset.wind)===state.weather.windDirection));
 $('#sourceBadge').innerHTML='<i></i>'+esc(state.source.label);
 $('#weatherCaption').textContent=state.source.type==='era5'?state.source.time.replace('T',' ')+' · 北京时间':'白天 · 恒定气象实验';
 $('#footerSource').textContent=state.source.type==='era5'?'ERA5 / '+state.source.time.replace('T',' ')+' / 概化聚落':state.source.label+' / 概化聚落';
 $('#durationLabel').textContent=fmt(state.params.duration/60);
 $('.grid-info').textContent='网格 '+state.params.dx+' m · 示意底图';
}
function syncPlans(){
 for(const id of ['A','B']){
  $('#tab'+id).classList.toggle('active',state.active===id);$('#tab'+id).setAttribute('aria-selected',String(state.active===id));
  $('#result'+id).classList.toggle('active',state.active===id);
 }
 $$('[data-scene]').forEach(b=>b.classList.toggle('active',b.dataset.scene===state.scene));
 $('#mapSceneLabel').textContent='聚落与周边环境';
 syncInspector();renderResults();draw();
}
function setActive(id){state.active=id;selected='target';syncPlans();persist();}
function syncInspector(){
 const o=state.plans[state.active].find(x=>x.id===selected);
 $('#objectInspector').hidden=!o;if(!o)return;
 $('#objectName').textContent=o.name+(o.locked?' · 固定':'');
 $('#objectW').value=o.w;$('#objectH').value=o.h;
 $('#objectW').disabled=!!o.locked;$('#objectH').disabled=!!o.locked;
 $('#objectArea').textContent=fmt(o.w*o.h)+' m²';
 $('#deleteObject').disabled=o.type==='target'||!!o.locked;
}
function rounded(c,x,y,w,h,r=5){c.beginPath();c.roundRect(x,y,w,h,r);}
function color(c){
 const stops=[[-2,[215,181,109]],[0,[236,240,225]],[1,[172,207,186]],[2,[113,174,163]],[4,[50,123,133]]];
 c=Math.max(-2,Math.min(4,c));for(let j=1;j<stops.length;j++)if(c<=stops[j][0]){const [x,a]=stops[j-1],[y,b]=stops[j],t=(c-x)/(y-x);return 'rgb('+a.map((v,i)=>Math.round(v+(b[i]-v)*t)).join(',')+')';}
 return 'rgb(50,123,133)';
}
function arrow(c,x,y,u,v,len=15){
 const mag=Math.hypot(u,v);if(mag<.015)return;const ux=u/mag,vy=v/mag,xx=x+ux*len/2,yy=y+vy*len/2;
 c.beginPath();c.moveTo(x-ux*len/2,y-vy*len/2);c.lineTo(xx,yy);c.stroke();
 c.beginPath();c.moveTo(xx,yy);c.lineTo(xx-ux*4-vy*2.6,yy-vy*4+ux*2.6);c.lineTo(xx-ux*4+vy*2.6,yy-vy*4-ux*2.6);c.closePath();c.fill();
}
function drawMap(c,width,height,objects,result,{selectedId=null,grid=false,heat=true,flow=true,labels=true,paper=false,scene=state.scene}={}){
 c.save();c.clearRect(0,0,width,height);c.scale(width/800,height/600);c.fillStyle='#edf0e4';c.fillRect(0,0,800,600);
 // Quiet parcel texture; schematic roads are visual context, not additional obstacles.
 c.strokeStyle='#e3e8d9';c.lineWidth=.6;
 for(let x=0;x<800;x+=40){c.beginPath();c.moveTo(x,0);c.lineTo(x,600);c.stroke();}
 for(let y=0;y<600;y+=40){c.beginPath();c.moveTo(0,y);c.lineTo(800,y);c.stroke();}
 if(scene==='village'){
  for(const x of [45,105,165,225]){c.fillStyle='#dfe7d3';rounded(c,x,55,48,60,4);c.fill();c.strokeStyle='#c2d0b7';for(let j=0;j<4;j++){c.beginPath();c.moveTo(x+7,65+j*12);c.lineTo(x+40,65+j*12);c.stroke();}}
 }
 c.strokeStyle='#f9f9f1';c.lineWidth=16;c.lineCap='butt';
 for(const y of [210,390]){c.beginPath();c.moveTo(0,y);c.lineTo(800,y);c.stroke();}
 for(const x of [260,540]){c.beginPath();c.moveTo(x,0);c.lineTo(x,600);c.stroke();}
 c.strokeStyle='#dfe4d5';c.lineWidth=.65;
 if(result&&heat){
  c.globalAlpha=.8;
  for(let j=0;j<result.ny;j++)for(let i=0;i<result.nx;i++){const k=j*result.nx+i;if(result.material[k]===3)continue;c.fillStyle=color(result.field[k]);c.fillRect(i*result.dx,j*result.dx,result.dx+.2,result.dx+.2);}
  c.globalAlpha=1;
 }
 if(grid){c.strokeStyle='#a3b39a50';c.lineWidth=.45;for(let x=0;x<800;x+=state.params.dx){c.beginPath();c.moveTo(x,0);c.lineTo(x,600);c.stroke();}for(let y=0;y<600;y+=state.params.dx){c.beginPath();c.moveTo(0,y);c.lineTo(800,y);c.stroke();}}
 if(flow){
  c.strokeStyle='#53796c80';c.fillStyle='#53796c80';c.lineWidth=1;
  const vv=M.directionVector(state.weather.windSpeed*state.params.windFactor,state.weather.windDirection);
  for(let y=40;y<580;y+=40)for(let x=40;x<780;x+=40){
   if(objects.some(o=>o.type==='building'&&x>=o.x&&x<o.x+o.w&&y>=o.y&&y<o.y+o.h))continue;
   let u=vv.u,v=vv.v;
   if(result){const k=Math.min(result.ny-1,Math.floor(y/result.dx))*result.nx+Math.min(result.nx-1,Math.floor(x/result.dx));u=result.flow.u[k];v=result.flow.v[k];}
   arrow(c,x,y,u,v,Math.max(10,Math.min(23,12+Math.hypot(u,v)*3)));
  }
 }
 for(const o of objects.filter(o=>o.type==='water')){
  c.fillStyle='#98bdc3';c.strokeStyle='#6a969f';c.lineWidth=1.2;rounded(c,o.x,o.y,o.w,o.h,Math.min(12,o.w/4,o.h/4));c.fill();c.stroke();
  c.save();rounded(c,o.x+2,o.y+2,o.w-4,o.h-4,9);c.clip();c.strokeStyle='#c2dadd';c.lineWidth=1;
  for(let y=o.y+12;y<o.y+o.h;y+=14){c.beginPath();for(let x=o.x-8;x<=o.x+o.w+8;x+=3){const yy=y+Math.sin((x-o.x)/9)*1.6;if(x===o.x-8)c.moveTo(x,yy);else c.lineTo(x,yy);}c.stroke();}
  c.restore();
  if(o.locked&&labels){c.fillStyle='#547b83';c.font='9px Microsoft YaHei';c.textAlign='center';c.fillText('已有池塘',o.x+o.w/2,o.y+o.h+14);}
 }
 for(const o of objects.filter(o=>o.type==='tree')){
  c.fillStyle='#b0c7a05c';c.strokeStyle='#8ba77b';c.lineWidth=.8;rounded(c,o.x,o.y,o.w,o.h,5);c.fill();c.stroke();
  for(let y=o.y+10;y<o.y+o.h-4;y+=17)for(let x=o.x+10;x<o.x+o.w-4;x+=17){
   const rr=Math.min(8,(o.w-4)/2,(o.h-4)/2);c.fillStyle='#89aa77';c.strokeStyle='#6f9261';c.lineWidth=.7;
   c.beginPath();c.arc(x+1,y+2,rr,0,Math.PI*2);c.fill();c.stroke();c.fillStyle='#a4bf8e';c.beginPath();c.arc(x-1.8,y-1.8,rr*.64,0,Math.PI*2);c.fill();
  }
 }
 for(const o of objects.filter(o=>o.type==='building')){
  c.fillStyle='#a1b09128';rounded(c,o.x+4,o.y+5,o.w,o.h,4);c.fill();
  c.fillStyle='#d3d8c9';c.strokeStyle='#a7b39a';c.lineWidth=1;rounded(c,o.x,o.y,o.w,o.h,3);c.fill();c.stroke();
  c.fillStyle='#e1e4d8';rounded(c,o.x+4,o.y+4,o.w-8,o.h-9,2);c.fill();
  c.strokeStyle='#bdc6b2';c.beginPath();c.moveTo(o.x+5,o.y+o.h/2);c.lineTo(o.x+o.w-5,o.y+o.h/2);c.stroke();
  c.fillStyle='#c1ccba';c.fillRect(o.x+o.w*.6,o.y+o.h*.25,o.w*.18,o.h*.16);
 }
 for(const o of objects.filter(o=>o.type==='target')){
  c.fillStyle='#fff6d631';c.strokeStyle='#b58c46';c.lineWidth=2.2;c.setLineDash([]);rounded(c,o.x,o.y,o.w,o.h,3);c.fill();c.stroke();c.setLineDash([]);
  if(labels){c.font='500 10px Microsoft YaHei';const name=o.name;const tw=c.measureText(name).width;c.fillStyle='#fffdf1ed';rounded(c,o.x+o.w/2-tw/2-6,o.y+o.h/2-10,tw+12,20,4);c.fill();c.textAlign='center';c.fillStyle='#8c783d';c.fillText(name,o.x+o.w/2,o.y+o.h/2+3);}
 }
 const sel=objects.find(o=>o.id===selectedId);
 if(sel){c.strokeStyle='#356e57';c.lineWidth=1.3;c.setLineDash([4,3]);rounded(c,sel.x-4,sel.y-4,sel.w+8,sel.h+8,5);c.stroke();c.setLineDash([]);for(const [x,y]of [[sel.x-4,sel.y-4],[sel.x+sel.w+4,sel.y-4],[sel.x-4,sel.y+sel.h+4],[sel.x+sel.w+4,sel.y+sel.h+4]]){c.fillStyle='#fffefa';c.strokeStyle='#356e57';c.fillRect(x-2.5,y-2.5,5,5);c.strokeRect(x-2.5,y-2.5,5,5);}}
 if(paper){
  c.fillStyle='#516c55';c.textAlign='left';c.font='12px Microsoft YaHei';c.fillText('聚落与周边环境',20,29);
  c.font='9px Arial';c.fillStyle='#7c8c72';c.fillText('800 × 600 m · '+state.params.dx+' m grid',20,45);
  c.textAlign='center';c.font='11px Arial';c.fillStyle='#56745a';c.fillText('N',765,25);arrow(c,765,46,0,-1,23);
  c.strokeStyle='#607c5d';c.fillStyle='#607c5d';c.lineWidth=2;const vv=M.directionVector(1,state.weather.windDirection);arrow(c,735,535,vv.u,vv.v,40);
  c.textAlign='right';c.font='10px Microsoft YaHei';c.fillText(windName(state.weather.windDirection)+'来流 '+state.weather.windDirection+'°',775,577);
  c.strokeStyle='#829277';c.lineWidth=1;c.beginPath();c.moveTo(22,554);c.lineTo(22,560);c.lineTo(122,560);c.lineTo(122,554);c.stroke();c.textAlign='center';c.font='9px Arial';c.fillText('100 m',72,576);
 }
 c.restore();
}
function draw(){drawMap(ctx,canvas.width,canvas.height,state.plans[state.active],drag?null:results?.[state.active],{selectedId:selected,heat:$('#showHeat').checked,flow:$('#showFlow').checked,grid:$('#showGrid').checked});}
function drawHistory(){
 const cc=$('#historyCanvas'),c=cc.getContext('2d'),w=cc.width,h=cc.height;c.clearRect(0,0,w,h);
 c.strokeStyle='#e4eadb';c.lineWidth=1;c.font='16px Arial';c.fillStyle='#8b9980';c.textAlign='left';
 for(let y=24;y<=130;y+=53){c.beginPath();c.moveTo(57,y);c.lineTo(w-15,y);c.stroke();}
 if(!results){c.font='18px Microsoft YaHei';c.fillText('运行后显示聚落区域的模拟温差',65,85);return;}
 const max=Math.max(.5,...results.A.history.map(x=>x.cooling),...results.B.history.map(x=>x.cooling)),min=Math.min(0,...results.A.history.map(x=>x.cooling),...results.B.history.map(x=>x.cooling));
 const scale=(max-min)*1.1||1;
 c.fillText(delta(max),2,31);c.fillText(delta((max+min)/2),2,82);c.fillText(delta(min),2,135);
 for(const [id,col]of [['A','#357d6c'],['B','#b69358']]){
  c.beginPath();c.strokeStyle=col;c.lineWidth=3;
  results[id].history.forEach((p,i)=>{const x=57+p.seconds/state.params.duration*(w-72),y=130-(p.cooling-min)/scale*106;i?c.lineTo(x,y):c.moveTo(x,y);});c.stroke();
 }
 c.fillStyle='#8c9a81';c.textAlign='center';for(let k=0;k<=3;k++)c.fillText(fmt(state.params.duration/60*k/3,0)+' min',57+(w-72)*k/3,155);
}
function renderResults(){
 if(!results)return;
 $('#resultEmpty').hidden=true;$('#resultsBody').hidden=false;
 const r=results[state.active],a=results.A.metrics,b=results.B.metrics;
 $('#mainCooling').textContent=delta(r.metrics.meanCooling);
 $('#metricSub').textContent='方案 '+state.active+' · '+fmt(state.params.duration/60)+'分钟时的模型结果';
 $('#coolA').textContent=delta(a.meanCooling);$('#coolB').textContent=delta(b.meanCooling);
 const diff=a.meanCooling-b.meanCooling;
 $('#resultInsight').textContent=Math.abs(diff)<.005?'两方案聚落区域的平均温差接近。可尝试调整位置或来流方向。':'在当前条件下，方案 '+(diff>0?'A':'B')+' 的聚落区域平均温度比另一方案低 '+fmt(Math.abs(diff),2)+' ℃。';
 $('#treeArea').textContent=fmt(r.metrics.area.tree)+' m²';$('#waterArea').textContent=fmt(r.metrics.area.water)+' m²';
 $('#waterUse').textContent=fmt(r.metrics.waterLossLph/1000,2)+' m³/h';$('#heatFlux').textContent=fmt(r.metrics.heatReductionKW,0)+' kW';
 const fair=M.compareLayouts(state.plans.A,state.plans.B),bad=[];
 if(!fair.sameTrees)bad.push('树木面积');if(!fair.sameWater)bad.push('水域面积');if(!fair.sameBuildings)bad.push('建筑格局');if(!fair.sameTarget)bad.push('聚落区域');
 const note=$('#comparisonNote');note.classList.toggle('warning',bad.length>0);
 note.textContent=bad.length?'注意：两方案的'+bad.join('、')+'不同，不能只归因于位置变化。':'✓ 等量树木与水域 · 相同中央聚落';
 if(!results.A.diagnostics.flowConverged||!results.B.diagnostics.flowConverged){note.classList.add('warning');note.textContent+=' 风场残差未达到预设标准，请检查布局。';}
 for(const id of ['A','B'])$('#result'+id).classList.toggle('active',state.active===id);
}
async function run(){
 if(running)return;const rv=revision,ss=copy(state);running=true;$('#runBtn').disabled=true;$('#runBtn').textContent='正在计算…';$('#status').className='status running';$('#status').innerHTML='<i></i>求解风场与热量输送';
 try{
  M.validateWeather(ss.weather);M.validateParams(ss.params);M.validateLayout(ss.plans.A);M.validateLayout(ss.plans.B);
  const areas=['A','B'].flatMap(id=>['tree','water'].map(type=>ss.plans[id].filter(o=>o.type===type).reduce((n,o)=>n+o.w*o.h,0)));
  if(areas.some(a=>a!==areas[0]))throw Error('请保持等面积：A树木 '+areas[0]+'、A水域 '+areas[1]+'、B树木 '+areas[2]+'、B水域 '+areas[3]+' m²。调整尺寸或复制方案后再运行。');

  await new Promise(r=>setTimeout(r,40));const A=M.solve(ss.plans.A,ss.weather,ss.params);
  await new Promise(r=>setTimeout(r,20));const B=M.solve(ss.plans.B,ss.weather,ss.params);
  if(rv!==revision){toast('条件在计算中发生变化，请重新运行。');return;}
  results={A,B};$('#status').className='status ready';$('#status').innerHTML='<i></i>计算完成 · '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
  $('#staleOverlay').hidden=true;$('#paperBtn').disabled=false;$('#csvBtn').disabled=false;$('#sensitivityBtn').disabled=false;
  renderResults();draw();drawHistory();persist();
 }catch(e){toast(e.message);$('#status').className='status dirty';$('#status').innerHTML='<i></i>请检查输入';}
 finally{running=false;$('#runBtn').disabled=false;$('#runBtn').innerHTML='<span class="play-icon">▶</span>运行对照实验';}
}
function setTool(t){tool=t;$$('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));$('#mapHint').textContent=t==='select'?'点击对象可拖动，或选择工具添加地块':'在空白处点击添加'+({tree:'树木地块',water:'水域',building:'建筑'})[t];canvas.style.cursor=t==='select'?'grab':'crosshair';}
const snap=x=>Math.round(x/10)*10;
function point(e){const box=canvas.getBoundingClientRect();return {x:(e.clientX-box.left)/box.width*800,y:(e.clientY-box.top)/box.height*600};}
function hit(pt){const a=state.plans[state.active];return [...a.filter(x=>x.type!=='target').reverse(),...a.filter(x=>x.type==='target')].find(o=>pt.x>=o.x&&pt.x<=o.x+o.w&&pt.y>=o.y&&pt.y<=o.y+o.h);}
function layoutEdit(callback){
 const old=copy(state.plans);
 try{callback();M.validateLayout(state.plans.A);M.validateLayout(state.plans.B);history.push({scene:state.scene,plans:old});invalidate();syncInspector();}
 catch(e){state.plans=old;toast(e.message);syncInspector();draw();}
}
canvas.addEventListener('pointerdown',e=>{
 if(running)return;const pt=point(e);canvas.focus();
 if(tool!=='select'){
  const sizes={tree:[80,60],water:[80,60],building:[60,50]},[w,h]=sizes[tool],id=tool+'-'+Date.now();
  layoutEdit(()=>{state.plans[state.active].push({id,type:tool,name:({tree:'树木地块',water:'水域地块',building:'建筑'})[tool],x:Math.max(10,Math.min(790-w,snap(pt.x-w/2))),y:Math.max(10,Math.min(590-h,snap(pt.y-h/2))),w,h});selected=id;});
  return;
 }
 const o=hit(pt);selected=o?.id||null;syncInspector();draw();
 if(o){if(o.locked){toast('中央方格代表整个聚落，位置与范围固定；请调整周边树木或水域。');return;}drag={start:pt,original:copy(o),before:copy(state.plans),moved:false};canvas.setPointerCapture(e.pointerId);}
});
canvas.addEventListener('pointermove',e=>{
 if(!drag)return;const pt=point(e),o=state.plans[state.active].find(x=>x.id===selected);if(!o)return;
 const x=Math.max(10,Math.min(790-o.w,snap(drag.original.x+pt.x-drag.start.x))),y=Math.max(10,Math.min(590-o.h,snap(drag.original.y+pt.y-drag.start.y)));
 const old={x:o.x,y:o.y};o.x=x;o.y=y;
 try{M.validateLayout(state.plans[state.active]);drag.moved=x!==drag.original.x||y!==drag.original.y;}catch(e){o.x=old.x;o.y=old.y;}
 draw();syncInspector();
});
function endDrag(){if(!drag)return;const d=drag;drag=null;if(d.moved){history.push({scene:state.scene,plans:d.before});invalidate();}else draw();}
canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',()=>{if(drag){state.plans=drag.before;drag=null;draw();syncInspector();}});
canvas.addEventListener('keydown',e=>{
 const o=state.plans[state.active].find(x=>x.id===selected);if(!o||o.locked)return;
 if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
  e.preventDefault();layoutEdit(()=>{const dx=e.key==='ArrowRight'?10:e.key==='ArrowLeft'?-10:0,dy=e.key==='ArrowDown'?10:e.key==='ArrowUp'?-10:0;o.x+=dx;o.y+=dy;});
 }else if(e.key==='Delete')$('#deleteObject').click();
});
$$('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
$('#targetBtn').onclick=()=>{setTool('select');selected='target';syncInspector();draw();};
for(const id of ['A','B']){$('#tab'+id).onclick=()=>setActive(id);$('#result'+id).onclick=()=>setActive(id);}
for(const k of weatherKeys){
 $('#'+k).addEventListener(k==='windDirection'?'input':'change',e=>{
  const val=Number(e.target.value);if(!Number.isFinite(val))return;state.weather[k]=val;
  state.source={type:'custom',label:state.source.type==='era5'||state.source.origin==='era5'?'自定义（基于 ERA5）':'自定义情境',origin:state.source.type==='era5'?'era5':state.source.origin};
  syncWeather();invalidate();
 });
}
$$('[data-wind]').forEach(b=>b.onclick=()=>{$('#windDirection').value=b.dataset.wind;$('#windDirection').dispatchEvent(new Event('input'));});
$('#copyBtn').onclick=()=>{const other=state.active==='A'?'B':'A';saveUndo();state.plans[other]=copy(state.plans[state.active]);invalidate('已复制到方案 '+other+'，可切换后调整位置。');};
$('#undoBtn').onclick=()=>{const old=history.pop();if(!old){toast('暂无可撤销的布局修改。');return;}state.plans=old.plans;state.scene=old.scene;selected='target';invalidate();syncPlans();};
$('#resetBtn').onclick=()=>{saveUndo();state.plans=M.presets(state.scene);selected='target';invalidate('已恢复当前情境的示例布局。');syncPlans();};
for(const [id,k]of [['objectW','w'],['objectH','h']])$('#'+id).onchange=e=>{const o=state.plans[state.active].find(x=>x.id===selected);if(!o||o.locked)return;layoutEdit(()=>{o[k]=snap(Number(e.target.value));});};
$('#deleteObject').onclick=()=>{const o=state.plans[state.active].find(x=>x.id===selected);if(!o||o.type==='target'||o.locked)return;layoutEdit(()=>{state.plans[state.active]=state.plans[state.active].filter(x=>x.id!==selected);selected='target';});};
for(const id of ['showHeat','showFlow','showGrid'])$('#'+id).onchange=draw;
$('#runBtn').onclick=run;
function showModal(title,html,eyebrow='实验设置'){$('#modalTitle').textContent=title;$('#modalEyebrow').textContent=eyebrow;$('#modalBody').innerHTML=html;$('#modal').hidden=false;$('#closeModal').focus();}
function closeModal(){$('#modal').hidden=true;}
$('#closeModal').onclick=closeModal;$('.modal-backdrop').onclick=closeModal;
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();$('#paperView').hidden=true;}});
$('#eraBtn').onclick=()=>{
 const sample=window.ERA5_SAMPLE;
 if(!sample){toast('ERA5样例文件未载入，请检查 weather.js。');return;}
 const d=sample.data,h=d.hourly;
 const options=h.time.map((t,i)=>({t,i})).filter(x=>{const hh=Number(x.t.slice(11,13));return hh>=9&&hh<=17;});
 showModal('载入示例时期的 ERA5 气象', '<p>选取一个时刻，载入其气温、湿度、10 m 风速与风向、短波辐射和气压。载入后仍可自由修改。</p><label class="input-row"><span>示例时刻</span><select id="eraTime">'+options.map(x=>'<option value="'+x.i+'" '+(x.t==='2023-06-23T14:00'?'selected':'')+'>'+x.t.replace('T',' ')+' · '+h.temperature_2m[x.i]+' ℃</option>').join('')+'</select></label><div id="eraSummary" class="source-detail"></div><p>这是约0.25°网格的背景气象，不是聚落观测。短波辐射为前一小时均值；实验中将所选条件保持不变，不重建当天天气过程。</p><div class="modal-actions"><button id="useEra" class="btn primary">载入这一时刻</button></div>','ERA5 · OPEN-METEO');
 const summarize=()=>{const i=Number($('#eraTime').value);$('#eraSummary').textContent='返回网格 '+d.latitude+'°N / '+d.longitude+'°E；气温 '+h.temperature_2m[i]+' ℃，湿度 '+h.relative_humidity_2m[i]+'%，风速 '+h.wind_speed_10m[i]+' m/s，'+windName(h.wind_direction_10m[i])+'来流 '+h.wind_direction_10m[i]+'°，短波 '+h.shortwave_radiation[i]+' W/m²。';};summarize();$('#eraTime').onchange=summarize;
 $('#useEra').onclick=()=>{const i=Number($('#eraTime').value);state.weather={temperature:h.temperature_2m[i],humidity:h.relative_humidity_2m[i],windSpeed:h.wind_speed_10m[i],windDirection:h.wind_direction_10m[i],solar:h.shortwave_radiation[i],pressure:h.surface_pressure[i]};state.source={type:'era5',label:'ERA5 · 示例气象',time:h.time[i],latitude:d.latitude,longitude:d.longitude,url:sample.request_url};closeModal();syncWeather();invalidate('已载入 ERA5；可继续调整输入。');};
};
const paramFields=[
 ['mixingHeight','有效混合层厚度','m',5,30,1],['diffusivity','水平扩散系数','m²/s',.2,10,.2],['exchangeTime','背景交换时间','s',60,1200,30],['windFactor','风速衰减系数','',.1,1,.05],
 ['treeResistance','冠层表面阻力','s/m',50,500,25],['aeroCoefficient','空气动力阻力系数','',30,300,10],['treeMoisture','树木水分供应系数','',0,1,.1],['longwave','净长波散失','W/m²',0,150,10],
 ['pavedAlbedo','铺装反照率','',.01,.6,.01],['treeAlbedo','树木反照率','',.01,.6,.01],['waterAlbedo','水面反照率','',.01,.6,.01],
 ['pavedStorage','铺装储热比例','',0,.8,.05],['treeStorage','树木储热比例','',0,.8,.05],['waterStorage','水域储热比例','',0,.8,.05]
];
$('#paramsBtn').onclick=()=>{
 showModal('模型参数', '<p>这些是简化教学模型的参数，尚未对当地聚落实地校准。应先确定参数，再比较布局；可通过敏感性检验了解结论是否依赖某一设定。</p><div class="param-grid"><label class="input-row"><span>模拟时长</span><select id="pDuration">'+[300,600,900,1200,1800].map(x=>'<option value="'+x+'" '+(x===state.params.duration?'selected':'')+'>'+x/60+' 分钟</option>').join('')+'</select></label><label class="input-row"><span>网格尺度</span><select id="pDx">'+[5,10,20].map(x=>'<option '+(x===state.params.dx?'selected':'')+'>'+x+'</option>').join('')+'</select></label>'+paramFields.map(([k,label,unit,min,max,step])=>'<label class="input-row"><span>'+label+'</span><div><input id="p-'+k+'" type="number" min="'+min+'" max="'+max+'" step="'+step+'" value="'+state.params[k]+'"><span>'+unit+'</span></div></label>').join('')+'<label class="input-row"><span>背景气压</span><div><input id="pPressure" type="number" min="850" max="1050" value="'+state.weather.pressure+'"><span>hPa</span></div></label></div><p>中央聚落不设建筑障碍；树冠不参与风阻计算。输出为有效混合层温差，不等于实测2 m气温或人体热舒适。</p><div class="modal-actions"><button id="defaultsParams" class="btn light">恢复主参数</button><button id="applyParams" class="btn primary">应用参数</button></div>');
 $('#defaultsParams').onclick=()=>{for(const [k]of paramFields)$('#p-'+k).value=M.DEFAULTS[k];$('#pDuration').value=900;$('#pDx').value=10;};
 $('#applyParams').onclick=()=>{try{const next={...state.params};for(const [k]of paramFields)next[k]=Number($('#p-'+k).value);next.duration=Number($('#pDuration').value);next.dx=Number($('#pDx').value);M.validateParams(next);const ww={...state.weather,pressure:Number($('#pPressure').value)};M.validateWeather(ww);if(ww.pressure!==state.weather.pressure)state.source={type:'custom',label:'自定义情境'};state.params=next;state.weather=ww;closeModal();syncWeather();invalidate('模型参数已更新。');}catch(e){toast(e.message);}};
};
$('#methodBtn').onclick=()=>{
 showModal('结果是怎样算出来的？','<div class="source-detail">地表能量平衡 → 背景气流输送 → 聚落平均温差</div><p>先用广义 Penman–Monteith 关系估算树木和水面的潜热通量，再计算它们相对铺装的显热差。简化风场决定输送方向，有限体积方法计算平流、扩散和背景交换。</p><p><code>ΔT = T方案 − T基准</code>，负值表示相对降温。将所有树木、水域地块替换为铺装。中央方格代表聚落统计区，气流可以穿过，不按实体建筑处理。</p><p>本模型可用于提出、检验布局假设，不能代替实地测量或规划级微气候模拟。未计算树荫辐射舒适度、树冠风阻、真实湍流尾流及水温演变。</p><p>示例 ERA5 来自 Open-Meteo；自定义模式不使用实测标签。所有实验可导出输入、布局、模型参数和计算结果，便于复核。</p><div class="modal-actions"><a class="btn light" href="methods.html" target="_blank" rel="noopener">完整方程、参数与来源 ↗</a></div>','MODEL / 物理过程驱动');
};
function conditionText(){return state.weather.temperature+' ℃ · RH '+state.weather.humidity+'% · '+windName(state.weather.windDirection)+'来流 '+state.weather.windDirection+'° · 10 m风速 '+state.weather.windSpeed+' m/s · 短波 '+state.weather.solar+' W/m² · '+state.params.duration/60+' min';}
function sourceText(){return state.source.type==='era5'?'背景气象：ERA5 / Open-Meteo，'+state.source.time.replace('T',' ')+'（Asia/Shanghai），网格 '+state.source.latitude+'°N '+state.source.longitude+'°E。':'气象输入：'+state.source.label+'；聚落布局为教学设定。';}
function showPaper(){
 if(!results){toast('请先运行实验。');return;}
 const fair=M.compareLayouts(state.plans.A,state.plans.B),same=Object.values(fair).every(Boolean);
 $('#paperTitle').textContent=(same?'相同投入，不同位置':'不同布局的模拟比较');
 $('#paperConditions').textContent=conditionText();
 for(const id of ['A','B']){const ca=$('#paper'+id);drawMap(ca.getContext('2d'),ca.width,ca.height,state.plans[id],results[id],{paper:true,selectedId:null,heat:true,flow:true});$('#paperMetric'+id).textContent='聚落区域平均 ΔT '+delta(results[id].metrics.meanCooling)+' ℃';}
 const a=results.A.metrics.area,b=results.B.metrics.area;
 $('#paperCaption').textContent='树木冠层 A/B：'+fmt(a.tree)+' / '+fmt(b.tree)+' m²；水域 A/B：'+fmt(a.water)+' / '+fmt(b.water)+' m²。'+(same?'两个方案的中央聚落范围及气象条件相同。':'聚落范围或地表面积等条件不同，不能只将结果归因于位置。');
 $('#paperSource').textContent=sourceText()+' 模型 '+M.VERSION+'；网格 '+state.params.dx+' m；有效混合层 '+state.params.mixingHeight+' m；K='+state.params.diffusivity+' m²/s；τ='+state.params.exchangeTime+' s。';
 $('#paperView').hidden=false;
}
$('#paperBtn').onclick=showPaper;$('#compareBtn').onclick=showPaper;$('#closePaper').onclick=()=>{$('#paperView').hidden=true;};
function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);}
function serialResult(r){return {version:r.version,metrics:r.metrics,diagnostics:r.diagnostics,fluxes:r.fluxes,history:r.history,grid:{nx:r.nx,ny:r.ny,dx:r.dx,cooling:Array.from(r.field),material:Array.from(r.material),target:Array.from(r.target)}};}
function experiment(){return {...copy(state),application:'风与聚落',modelVersion:M.VERSION,savedAt:new Date().toISOString(),sourceNote:sourceText(),results:results?{A:serialResult(results.A),B:serialResult(results.B)}:null};}
$('#exportJsonBtn').onclick=()=>{download(new Blob([JSON.stringify(experiment(),null,2)],{type:'application/json'}),'风与聚落_实验.json');toast('已导出布局、气象与模型参数'+(results?'及结果。':'。'));};
$('#csvBtn').onclick=()=>{
 if(!results)return;const lines=['scenario,x_m,y_m,material,target,delta_T_C,u_m_s,v_m_s'];
 for(const id of ['A','B']){const r=results[id];for(let j=0;j<r.ny;j++)for(let i=0;i<r.nx;i++){const k=j*r.nx+i;lines.push([id,(i+.5)*r.dx,(j+.5)*r.dx,['paved','tree','water','building'][r.material[k]],r.target[k],r.material[k]===3?'':(-r.field[k]).toFixed(7),r.flow.u[k].toFixed(6),r.flow.v[k].toFixed(6)].join(','));}}
 download(new Blob(['\uFEFF'+lines.join('\n')],{type:'text/csv;charset=utf-8'}),'风与聚落_温差网格.csv');
};
$('#importBtn').onclick=()=>$('#importFile').click();
$('#importFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>5e6)throw Error('文件过大，请使用本应用导出的实验JSON。');const s=validateState(JSON.parse(await file.text()));saveUndo();state={schema:s.schema,scene:s.scene,active:s.active,plans:s.plans,weather:s.weather,params:{...M.DEFAULTS,...s.params},source:s.source};selected='target';invalidate('实验已载入，请重新计算以核验结果。');syncWeather();syncPlans();}catch(err){toast(err.message);}e.target.value='';};
$('#downloadPng').onclick=()=>{
 if(!results)return;
 const c=document.createElement('canvas');c.width=3200;c.height=1660;const g=c.getContext('2d');g.fillStyle='#fbfcf7';g.fillRect(0,0,c.width,c.height);
 g.fillStyle='#294d3d';g.font='500 50px Microsoft YaHei';g.fillText('风与聚落 · '+'聚落布局对照',65,85);
 g.font='26px Microsoft YaHei';g.fillStyle='#7b8c6d';g.fillText(conditionText(),65,143);
 for(const [id,x]of [['A',60],['B',1640]]){g.fillStyle='#355f43';g.font='36px Microsoft YaHei';g.fillText('方案 '+id+'   聚落区域平均 ΔT '+delta(results[id].metrics.meanCooling)+' ℃',x,218);const tmp=document.createElement('canvas');tmp.width=1500;tmp.height=1125;drawMap(tmp.getContext('2d'),1500,1125,state.plans[id],results[id],{paper:true,selectedId:null,heat:true,flow:true});g.drawImage(tmp,x,253);}
 g.font='24px Microsoft YaHei';g.fillStyle='#6f8060';g.fillText('ΔT = 方案 − 树木、水域均替换为铺装的基准；混合层温差模拟，未经实地校准。',65,1433);
 const grad=g.createLinearGradient(2300,0,3050,0);grad.addColorStop(0,'#327b85');grad.addColorStop(.667,'#ecf0e1');grad.addColorStop(1,'#d7b56d');g.fillStyle=grad;g.fillRect(2300,1411,750,15);g.fillStyle='#6f8060';g.font='23px Arial';g.fillText('−4 ℃',2300,1461);g.fillText('0',2785,1461);g.fillText('+2 ℃',3000,1461);
 g.font='23px Microsoft YaHei';g.fillText(sourceText(),65,1492);g.fillText('网格 '+state.params.dx+' m · 有效混合层 '+state.params.mixingHeight+' m · 扩散 '+state.params.diffusivity+' m²/s · 背景交换 '+state.params.exchangeTime+' s',65,1540);g.fillText('树木冠层与水域符号表示设定地块，中央方格为聚落，气流按背景来流计算。模型版本 '+M.VERSION,65,1588);
 c.toBlob(b=>download(b,'风与聚落_'+state.scene+'_对照图.png'),'image/png');
};
$('#sensitivityBtn').onclick=async()=>{
 if(!results)return;const ss=copy(state),base=results;
 showModal('结论依赖哪些参数？','<p>保持布局和气象不变，每次仅改变一个探索性参数。下表是情境敏感性检验，不是统计置信区间，也不是参数校准。</p><table><thead><tr><th>参数情境</th><th>A 平均 ΔT</th><th>B 平均 ΔT</th></tr></thead><tbody id="sensRows"></tbody></table><p id="sensProgress" class="run-progress">正在逐项计算…</p>','SENSITIVITY / 单因素比较');
 const cases=[['当前主参数',null,null],['混合层厚度 5 m','mixingHeight',5],['混合层厚度 20 m','mixingHeight',20],['扩散系数 1 m²/s','diffusivity',1],['扩散系数 4 m²/s','diffusivity',4],['树木表面阻力 75 s/m','treeResistance',75],['树木表面阻力 300 s/m','treeResistance',300]];
 const rows=[];
 for(const [label,k,v]of cases){
  await new Promise(r=>setTimeout(r,20));if($('#modal').hidden||!$('#sensRows'))break;
  const p={...ss.params};if(k)p[k]=v;const A=k?M.solve(ss.plans.A,ss.weather,p):base.A,B=k?M.solve(ss.plans.B,ss.weather,p):base.B;
  rows.push({label,A:A.metrics.meanCooling,B:B.metrics.meanCooling});
  const tr=document.createElement('tr');tr.innerHTML='<td>'+esc(label)+'</td><td>'+delta(A.metrics.meanCooling)+' ℃</td><td>'+delta(B.metrics.meanCooling)+' ℃</td>';$('#sensRows').append(tr);
 }
 if($('#sensProgress'))$('#sensProgress').textContent='比较完成。主实验参数保持不变。';
 window.Lab.lastSensitivity=rows;
};
window.Lab={get state(){return state;},get results(){return results;},get revision(){return revision;},run,showPaper,draw,setActive,experiment,setWeather(w){state.weather={...state.weather,...w};state.source={type:'custom',label:'自定义情境'};syncWeather();invalidate();},reset(){state=copy(initial);selected='target';history=[];syncWeather();invalidate();syncPlans();},setScene(){return;}};
syncWeather();syncPlans();drawHistory();$('#sensitivityBtn').disabled=true;$('#paperBtn').disabled=true;$('#csvBtn').disabled=true;
setTimeout(run,100);
})();
