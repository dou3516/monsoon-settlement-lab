/* Wind & Settlement Lab. Deterministic, dependency-free teaching model. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MonsoonModel=api;})(typeof self!=='undefined'?self:this,function(){
'use strict';
const VERSION='1.1.0';
const DEFAULTS={dx:10,width:800,height:600,duration:900,mixingHeight:10,diffusivity:2,exchangeTime:300,windFactor:.35,treeResistance:150,aeroCoefficient:100,longwave:60,treeMoisture:.8,pavedAlbedo:.15,treeAlbedo:.20,waterAlbedo:.08,pavedStorage:.30,treeStorage:.10,waterStorage:.50};
const WEATHER={temperature:35,humidity:45,windSpeed:3,windDirection:135,solar:700,pressure:1013};
const clone=x=>JSON.parse(JSON.stringify(x));
function directionVector(speed,degrees){const a=degrees*Math.PI/180;return {u:-speed*Math.sin(a),v:speed*Math.cos(a)};} // x east; y south. Direction is FROM.
function validateWeather(w){
 const lim={temperature:[10,48],humidity:[5,100],windSpeed:[.5,12],windDirection:[0,360],solar:[50,1200],pressure:[850,1050]};
 for(const [key,[lo,hi]] of Object.entries(lim))if(!Number.isFinite(w[key])||w[key]<lo||w[key]>hi)throw Error('气象参数超出教学模型范围：'+key+' ['+lo+', '+hi+']');
}
function validateParams(p){
 const limits={dx:[5,40],duration:[60,1800],mixingHeight:[5,30],diffusivity:[.2,10],exchangeTime:[60,1200],windFactor:[.1,1],treeResistance:[50,500],aeroCoefficient:[30,300],longwave:[0,150],treeMoisture:[0,1],pavedAlbedo:[.01,.6],treeAlbedo:[.01,.6],waterAlbedo:[.01,.6],pavedStorage:[0,.8],treeStorage:[0,.8],waterStorage:[0,.8]};
 for(const [key,[lo,hi]]of Object.entries(limits))if(!Number.isFinite(p[key])||p[key]<lo||p[key]>hi)throw Error('模型参数无效：'+key);
 if(p.width!==800||p.height!==600||p.width%p.dx||p.height%p.dx)throw Error('网格须整除800×600米区域。');
}
function overlap(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
function validateLayout(objects){
 if(!Array.isArray(objects)||objects.length>150)throw Error('布局对象数量无效。');
 if(objects.filter(o=>o.type==='target').length!==1)throw Error('每个方案需要一个聚落统计区。');
 const ids=new Set();
 for(const o of objects){
  if(!['tree','water','building','target'].includes(o.type)||ids.has(o.id))throw Error('对象类型或编号无效。');ids.add(o.id);
  if(![o.x,o.y,o.w,o.h].every(Number.isFinite)||o.w<10||o.h<10||o.x<10||o.y<10||o.x+o.w>790||o.y+o.h>590)throw Error('布局对象须位于边界内，尺寸至少10米。');
 }
 for(let i=0;i<objects.length;i++)for(let j=i+1;j<objects.length;j++){
  const a=objects[i],b=objects[j];
  if(a.type==='target'||b.type==='target'){if(overlap(a,b))throw Error('树木、水域和建筑不能占据聚落统计区。');continue;}
  if(overlap(a,b))throw Error('树木、水域和建筑不能互相重叠。');
 }
}
function fluxes(weather,params={}){
 const p={...DEFAULTS,...params},w={...WEATHER,...weather};validateWeather(w);validateParams(p);
 const rho=w.pressure*100/(287.05*(w.temperature+273.15)),cp=1005,Lv=2.45e6;
 const es=.6108*Math.exp(17.27*w.temperature/(w.temperature+237.3));
 const delta=4098*es/Math.pow(w.temperature+237.3,2)*1000; // Pa K^-1
 const vpd=es*(1-w.humidity/100)*1000,gamma=cp*w.pressure*100/(.622*Lv);
 const ra=p.aeroCoefficient/Math.max(.5,w.windSpeed*p.windFactor);
 function surface(albedo,storage,rs,moisture){
  const rn=(1-albedo)*w.solar-p.longwave,g=storage*rn;
  const le=moisture===0?0:Math.max(0,(delta*(rn-g)+rho*cp*vpd/ra)/(delta+gamma*(1+rs/ra)))*moisture;
  return {netRadiation:rn,storage:g,latent:le,sensible:rn-g-le,ra,rs};
 }
 const paved=surface(p.pavedAlbedo,p.pavedStorage,0,0),tree=surface(p.treeAlbedo,p.treeStorage,p.treeResistance,p.treeMoisture),water=surface(p.waterAlbedo,p.waterStorage,0,1);
 return {paved,tree,water,rho,cp,Lv,vpd,delta,gamma};
}
function rasterize(objects,p){
 const nx=p.width/p.dx,ny=p.height/p.dx,n=nx*ny,material=new Uint8Array(n),target=new Uint8Array(n),area={tree:0,water:0,building:0,target:0};
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
  const xx=(x+.5)*p.dx,yy=(y+.5)*p.dx,k=y*nx+x;
  for(const o of objects)if(xx>=o.x&&xx<o.x+o.w&&yy>=o.y&&yy<o.y+o.h){
   if(o.type==='target')target[k]=1;else material[k]=({tree:1,water:2,building:3})[o.type];
  }
  if(material[k]===3)target[k]=0;
  if(target[k])area.target+=p.dx*p.dx;
  if(material[k])area[['','tree','water','building'][material[k]]]+=p.dx*p.dx;
 }
 if(!area.target)throw Error('聚落统计区在当前网格中没有有效单元。请扩大目标区。');
 return {nx,ny,n,material,target,area};
}
function solveFlow(r,p,w){
 const {nx,ny,n,material:m}=r,dx=p.dx,phi=new Float64Array(n),{u:u0,v:v0}=directionVector(w.windSpeed*p.windFactor,w.windDirection);
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)phi[j*nx+i]=u0*(i+.5)*dx+v0*(j+.5)*dx;
 let residual=Infinity,iterations=0;const omega=1.8,tolerance=1e-6;
 function terms(i,j,k){
  let sum=0,count=0;
  if(i===0){sum+=2*v0*(j+.5)*dx;count+=2;}else if(m[k-1]!==3){sum+=phi[k-1];count++;}
  if(i===nx-1){sum+=2*(u0*p.width+v0*(j+.5)*dx);count+=2;}else if(m[k+1]!==3){sum+=phi[k+1];count++;}
  if(j===0){sum+=2*u0*(i+.5)*dx;count+=2;}else if(m[k-nx]!==3){sum+=phi[k-nx];count++;}
  if(j===ny-1){sum+=2*(u0*(i+.5)*dx+v0*p.height);count+=2;}else if(m[k+nx]!==3){sum+=phi[k+nx];count++;}
  return [sum,count];
 }
 for(let it=0;it<6000;it++){
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
   const k=j*nx+i;if(m[k]===3)continue;const [sum,count]=terms(i,j,k);if(count)phi[k]+=omega*(sum/count-phi[k]);
  }
  iterations=it+1;
  if(it%20===0||it===5999){
   residual=0;
   for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const k=j*nx+i;if(m[k]===3)continue;const [sum,count]=terms(i,j,k);residual=Math.max(residual,Math.abs(sum-count*phi[k])/(dx*dx));}
   if(residual<tolerance)break;
  }
 }
 const u=new Float64Array((nx+1)*ny),v=new Float64Array(nx*(ny+1)),uc=new Float64Array(n),vc=new Float64Array(n);
 for(let j=0;j<ny;j++)for(let i=0;i<=nx;i++){
  const k=j*nx+i,f=j*(nx+1)+i;
  if(i===0){if(m[k]!==3)u[f]=2*(phi[k]-v0*(j+.5)*dx)/dx;}
  else if(i===nx){if(m[k-1]!==3)u[f]=2*(u0*p.width+v0*(j+.5)*dx-phi[k-1])/dx;}
  else if(m[k-1]!==3&&m[k]!==3)u[f]=(phi[k]-phi[k-1])/dx;
 }
 for(let j=0;j<=ny;j++)for(let i=0;i<nx;i++){
  const k=j*nx+i,f=j*nx+i;
  if(j===0){if(m[k]!==3)v[f]=2*(phi[k]-u0*(i+.5)*dx)/dx;}
  else if(j===ny){if(m[k-nx]!==3)v[f]=2*(u0*(i+.5)*dx+v0*p.height-phi[k-nx])/dx;}
  else if(m[k-nx]!==3&&m[k]!==3)v[f]=(phi[k]-phi[k-nx])/dx;
 }
 let maxDivergence=0;
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
  const k=j*nx+i;if(m[k]===3)continue;
  uc[k]=(u[j*(nx+1)+i]+u[j*(nx+1)+i+1])/2;vc[k]=(v[k]+v[k+nx])/2;
  maxDivergence=Math.max(maxDivergence,Math.abs(u[j*(nx+1)+i+1]-u[j*(nx+1)+i]+v[k+nx]-v[k])/dx);
 }
 return {u,v,uc,vc,iterations,residual,maxDivergence,converged:residual<tolerance,u0,v0};
}
function solve(objects,weather={},parameters={}){
 validateLayout(objects);const p={...DEFAULTS,...parameters},w={...WEATHER,...weather};validateWeather(w);validateParams(p);
 const r=rasterize(objects,p),f=fluxes(w,p),flow=solveFlow(r,p,w);
 const {nx,ny,n,material:m,target}=r,dx=p.dx,K=p.diffusivity,tau=p.exchangeTime,src=new Float64Array(n);
 let waterLoss=0,heatReduction=0,maxRate=0,totalSource=0;
 const areaCell=dx*dx;
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
  const k=j*nx+i;if(m[k]===3)continue;
  if(m[k]===1||m[k]===2){
   const a=m[k]===1?f.tree:f.water,dh=f.paved.sensible-a.sensible;
   src[k]=dh/(f.rho*f.cp*p.mixingHeight);waterLoss+=a.latent*areaCell*3600/f.Lv;heatReduction+=dh*areaCell;totalSource+=src[k]*areaCell;
  }
  let count=0;
  if(i>0&&m[k-1]!==3)count++;if(i<nx-1&&m[k+1]!==3)count++;if(j>0&&m[k-nx]!==3)count++;if(j<ny-1&&m[k+nx]!==3)count++;
  const left=flow.u[j*(nx+1)+i],right=flow.u[j*(nx+1)+i+1],top=flow.v[k],bottom=flow.v[k+nx];
  const rate=(Math.max(0,right)+Math.max(0,-left)+Math.max(0,bottom)+Math.max(0,-top))/dx+K*count/(dx*dx)+1/tau;
  maxRate=Math.max(maxRate,rate);
 }
 const steps=Math.ceil(p.duration/(.7/maxRate)),dt=p.duration/steps;
 let a=new Float64Array(n),b=new Float64Array(n);const fx=new Float64Array((nx+1)*ny),fy=new Float64Array(nx*(ny+1)),history=[{seconds:0,cooling:0}];
 let sinkTotal=0,outTotal=0,nextRecord=30;
 for(let st=0;st<steps;st++){
  for(let j=0;j<ny;j++)for(let i=0;i<=nx;i++){
   const k=j*nx+i,ff=j*(nx+1)+i,u=flow.u[ff];
   if(i===0)fx[ff]=u*(u>=0?0:a[k]);
   else if(i===nx)fx[ff]=u*(u>=0?a[k-1]:0);
   else if(m[k-1]===3||m[k]===3)fx[ff]=0;
   else fx[ff]=u*(u>=0?a[k-1]:a[k])-K*(a[k]-a[k-1])/dx;
  }
  for(let j=0;j<=ny;j++)for(let i=0;i<nx;i++){
   const k=j*nx+i,v=flow.v[k];
   if(j===0)fy[k]=v*(v>=0?0:a[k]);
   else if(j===ny)fy[k]=v*(v>=0?a[k-nx]:0);
   else if(m[k-nx]===3||m[k]===3)fy[k]=0;
   else fy[k]=v*(v>=0?a[k-nx]:a[k])-K*(a[k]-a[k-nx])/dx;
  }
  let sink=0,outflow=0;
  for(let j=0;j<ny;j++){outflow+=(fx[j*(nx+1)+nx]-fx[j*(nx+1)])*dx;}
  for(let i=0;i<nx;i++)outflow+=(fy[ny*nx+i]-fy[i])*dx;
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
   const k=j*nx+i;if(m[k]===3){b[k]=0;continue;}
   const div=(fx[j*(nx+1)+i+1]-fx[j*(nx+1)+i]+fy[k+nx]-fy[k])/dx;
   b[k]=a[k]+dt*(src[k]-a[k]/tau-div);sink+=a[k]/tau*areaCell;
   if(!Number.isFinite(b[k]))throw Error('数值计算未得到有限值，请检查参数。');
  }
  sinkTotal+=sink*dt;outTotal+=outflow*dt;[a,b]=[b,a];
  const elapsed=(st+1)*dt;
  if(elapsed>=nextRecord||st===steps-1){
   let sum=0,count=0;for(let k=0;k<n;k++)if(target[k]){sum+=a[k];count++;}
   history.push({seconds:elapsed,cooling:sum/count});nextRecord+=30;
  }
 }
 let targetSum=0,targetCount=0,totalInventory=0,maxCooling=-Infinity,minCooling=Infinity,domainSum=0,fluid=0;
 for(let k=0;k<n;k++)if(m[k]!==3){totalInventory+=a[k]*areaCell;maxCooling=Math.max(maxCooling,a[k]);minCooling=Math.min(minCooling,a[k]);domainSum+=a[k];fluid++;if(target[k]){targetSum+=a[k];targetCount++;}}
 const sourceTotal=totalSource*p.duration,imbalance=totalInventory-sourceTotal+sinkTotal+outTotal;
 return {version:VERSION,weather:clone(w),params:clone(p),objects:clone(objects),nx,ny,dx,field:a,material:m,target,flow:{u:flow.uc,v:flow.vc},history,fluxes:f,metrics:{meanCooling:targetSum/targetCount,maxCooling,minCooling,domainMean:domainSum/fluid,waterLossLph:waterLoss,heatReductionKW:heatReduction/1000,area:r.area},diagnostics:{flowConverged:flow.converged,flowIterations:flow.iterations,flowResidual:flow.residual,maxDivergence:flow.maxDivergence,dt,steps,stabilityNumber:dt*maxRate,sourceTotal,sinkTotal,outTotal,totalInventory,budgetResidual:imbalance,relativeBudgetResidual:Math.abs(imbalance)/Math.max(1,Math.abs(sourceTotal))}};
}
function presets(){
 const target={id:'target',type:'target',name:'聚落',x:350,y:250,w:100,h:100,locked:true};
 const trees={id:'trees',type:'tree',name:'树木地块',x:470,y:360,w:120,h:80};
 const water={id:'water',type:'water',name:'水域地块',x:540,y:440,w:120,h:80};
 return {A:[clone(target),trees,water],B:[clone(target),{...trees,x:230,y:180},{...water,x:90,y:90}]};
}
function compareLayouts(A,B){
 const shapeKey=(a,t)=>a.filter(o=>o.type===t).map(o=>[o.x,o.y,o.w,o.h]).sort().map(x=>x.join(',')).join(';');
 const area=(a,t)=>a.filter(o=>o.type===t).reduce((s,o)=>s+o.w*o.h,0);
 return {sameTrees:area(A,'tree')===area(B,'tree'),sameWater:area(A,'water')===area(B,'water'),sameBuildings:shapeKey(A,'building')===shapeKey(B,'building'),sameTarget:shapeKey(A,'target')===shapeKey(B,'target')};
}
return {VERSION,DEFAULTS,WEATHER,clone,fluxes,rasterize,solveFlow,solve,directionVector,validateWeather,validateParams,validateLayout,presets,compareLayouts,overlap};
});
