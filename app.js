import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const NASA_TEXTURE = "https://assets.science.nasa.gov/dynamicimage/assets/science/psd/lunar-science/2023/09/colormap.jpg?crop=faces%2Cfocalpoint&fit=clip&h=1200&w=3927";

const root = document.getElementById("moon");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02050a);

const camera = new THREE.PerspectiveCamera(42, root.clientWidth/root.clientHeight, .1, 100);
camera.position.set(0,0,3.2);

const renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(root.clientWidth,root.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
root.appendChild(renderer.domElement);

const controls = new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true; controls.dampingFactor=.06; controls.minDistance=1.65; controls.maxDistance=6;
controls.enablePan=true; controls.zoomSpeed=1.25; controls.rotateSpeed=.65;

const stars = new THREE.BufferGeometry();
const positions=[];
for(let i=0;i<1300;i++){
  const r=20+Math.random()*25, a=Math.random()*Math.PI*2, z=Math.random()*2-1;
  const q=Math.sqrt(1-z*z);
  positions.push(r*q*Math.cos(a),r*q*Math.sin(a),r*z);
}
stars.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
scene.add(new THREE.Points(stars,new THREE.PointsMaterial({color:0x9db5c9,size:.018,transparent:true,opacity:.7})));

const moonGroup=new THREE.Group(); scene.add(moonGroup);
const loader=new THREE.TextureLoader(); loader.setCrossOrigin("anonymous");
const texture=loader.load(NASA_TEXTURE,()=>{document.getElementById("dataStatus").textContent="NASA LRO MOSAIC LOADED";});
const moon=new THREE.Mesh(
  new THREE.SphereGeometry(1,160,160),
  new THREE.MeshStandardMaterial({
    map:texture, bumpMap:texture, bumpScale:.055, roughness:.96, metalness:0,
  })
);
moonGroup.add(moon);

const halo=new THREE.Mesh(
  new THREE.SphereGeometry(1.025,64,64),
  new THREE.MeshBasicMaterial({color:0x6ea9c8,transparent:true,opacity:.025,side:THREE.BackSide})
);
moonGroup.add(halo);

const sun=new THREE.DirectionalLight(0xffffff,2.2); sun.position.set(3,1.5,2.5); scene.add(sun);
scene.add(new THREE.AmbientLight(0x53677c,.12));

let marker=null, selected={lat:-5,lon:20};
const raycaster=new THREE.Raycaster(), pointer=new THREE.Vector2();

function xyzToLatLon(p){
  // Three.js sphere: +Z = 0° longitude, +X = 90°E.
  const lat=Math.asin(THREE.MathUtils.clamp(p.y,-1,1))*180/Math.PI;
  const lon=Math.atan2(p.x,p.z)*180/Math.PI;
  return {lat,lon};
}
function latLonToXYZ(lat,lon,r=1.02){
  const a=lat*Math.PI/180,b=lon*Math.PI/180;
  return new THREE.Vector3(r*Math.cos(a)*Math.sin(b),r*Math.sin(a),r*Math.cos(a)*Math.cos(b));
}
function selectFromPointer(e){
  const rect=renderer.domElement.getBoundingClientRect();
  pointer.x=((e.clientX-rect.left)/rect.width)*2-1;
  pointer.y=-((e.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(pointer,camera);
  const hit=raycaster.intersectObject(moon)[0]; if(!hit)return;
  const ll=xyzToLatLon(hit.point.clone().normalize());
  selected=ll; updateSite(); queryNASA();
  const projected=hit.point.clone().project(camera);
  const cross=document.getElementById("crosshair");
  cross.style.display="block"; cross.style.left=`${(projected.x*.5+.5)*100}%`; cross.style.top=`${(-projected.y*.5+.5)*100}%`;
}
renderer.domElement.addEventListener("click",selectFromPointer);

let nasaSite=null, nasaBusy=false;
function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
function fallbackMetrics(lat,lon){
  const r=Math.PI/180;
  const elevation=650+1850*Math.abs(Math.sin(lat*r))+280*Math.cos((lon-20)*r);
  const slope=1.2+11*Math.abs(Math.sin((lat*1.7+lon)*r));
  const temp=-165+92*Math.max(0,Math.cos(lat*r))*((Math.sin((lon+90)*r)+1)/2)+18*Math.sin(lon*r);
  const sunAlt=42*Math.cos(lat*r)+20*Math.sin((lon-25)*r);
  const sunAz=(180+lon*.8-lat*.2+360)%360;
  const illum=Math.max(0,Math.min(100,Math.round(50+50*Math.cos((lon-25)*r))));
  return {elevation,slope,temp,sunAlt,sunAz,illum,score:50};
}
function metrics(){
  const f=fallbackMetrics(selected.lat,selected.lon);
  if(!nasaSite?.lola && !nasaSite?.diviner) return {...f,source:'PROTOTYPE FALLBACK'};
  const l=nasaSite.lola||{}, d=nasaSite.diviner||{};
  const elevation=Number.isFinite(l.elevation_m)?l.elevation_m:f.elevation;
  const slope=Number.isFinite(l.slope_deg)?l.slope_deg:f.slope;
  const temp=Number.isFinite(d.brightness_temp_K)?d.brightness_temp_K-273.15:f.temp;
  const sunAlt=Number.isFinite(d.solar_incidence_deg)?90-d.solar_incidence_deg:f.sunAlt;
  const sunAz=Number.isFinite(d.solar_azimuth_deg)?d.solar_azimuth_deg:f.sunAz;
  const illum=Number.isFinite(d.solar_incidence_deg)?Math.round(clamp(100*Math.cos(d.solar_incidence_deg*Math.PI/180),0,100)):f.illum;
  const terrain=clamp(Math.round(100-slope*5),20,100);
  const thermal=clamp(Math.round(100-Math.abs(temp+80)*.25),30,100);
  const solar=clamp(Math.round(illum),0,100);
  const score=Math.round(.5*terrain+.3*thermal+.2*solar);
  return {elevation,slope,temp,sunAlt,sunAz,illum,terrain,thermal,solar,score,source:'NASA LIVE / LRO GDS'};
}
function earth(m){
  if(m.temp<-120)return ['Antarctic interior','Thermal/terrain candidate'];
  if(m.temp<-60)return ['High-altitude Andes','Cold, dry terrain candidate'];
  if(m.temp<-20)return ['Atacama Desert','Dry, high-solar terrain candidate'];
  return ['Namib Desert','Dry terrestrial terrain candidate'];
}
function setText(id,v){const el=document.getElementById(id);if(el)el.textContent=v;}
function updateSite(){
  const m=metrics(), e=earth(m);
  const ns=selected.lat>=0?'N':'S', ew=selected.lon>=0?'E':'W';
  setText('location',`${Math.abs(selected.lat).toFixed(2)}° ${ns}  •  ${Math.abs(selected.lon).toFixed(2)}° ${ew}`);
  setText('locationSub',nasaBusy?'Querying NASA LOLA + Diviner…':`Selected on the 3D lunar surface • ${m.source}`);
  setText('elev',`${Math.round(m.elevation)} m`); setText('slope',`${m.slope.toFixed(1)}°`);
  setText('temp',`${Math.round(m.temp)} °C`); setText('sunAlt',`${m.sunAlt.toFixed(1)}°`); setText('illum',`${m.illum}%`);
  setText('riskScore',m.score);\n  setTimeout(refreshSimTerrain,0);
  const cls=m.score>=80?'LOW RELATIVE SCORE':m.score>=60?'MODERATE RELATIVE SCORE':'LOW CONFIDENCE / CHECK SITE';
  setText('siteClass',cls);
  document.getElementById('riskRing').style.borderColor=m.score>=80?'var(--green)':m.score>=60?'var(--amber)':'var(--red)';
  setText('earthName',e[0]); setText('earthDesc',`${e[1]}. This analogue is a prototype candidate, not a NASA-certified Earth match.`);
  const earthScore=Math.round((m.thermal+m.terrain+m.solar)/3); setText('earthScore',`${earthScore}%`);
  setText('aTemp',`${Math.round(m.temp)} °C`);setText('aElev',`${Math.round(m.elevation)} m`);
  setText('aSlope',`${m.slope.toFixed(1)}°`);setText('aSunAlt',`${m.sunAlt.toFixed(1)}°`);
  setText('aSunAz',`${m.sunAz.toFixed(0)}°`);setText('aIllum',`${m.illum}%`);
  setText('hSlope',m.slope<=8?'FAVOURABLE':m.slope<=12?'WATCH':'STEEP');
  setText('hLight',m.illum>=35?'ADEQUATE':'LOW LIGHT');
  setText('hTemp',Math.abs(m.temp)<120?'MEASURED BRIGHTNESS TEMP':'EXTREME / CHECK DATA');
  const thermal=Number.isFinite(m.thermal)?m.thermal:50, terrain=Number.isFinite(m.terrain)?m.terrain:50, solar=Number.isFinite(m.solar)?m.solar:50;
  [['bt',thermal],['bterr',terrain],['bsol',solar]].forEach(([id,v])=>document.getElementById(id).style.width=v+'%');
  setText('btv',thermal+'%');setText('bterrv',terrain+'%');setText('bsolv',solar+'%');
  if(marker)moonGroup.remove(marker);
  marker=new THREE.Mesh(new THREE.SphereGeometry(.018,20,20),new THREE.MeshBasicMaterial({color:0x72f5a5}));
  marker.position.copy(latLonToXYZ(selected.lat,selected.lon,1.025)); moonGroup.add(marker);
}
async function queryNASA(){
  nasaBusy=true; nasaSite=null; updateSite();
  try{
    const r=await fetch(`/api/site?lat=${encodeURIComponent(selected.lat)}&lon=${encodeURIComponent(selected.lon)}`);
    if(!r.ok) throw new Error('NASA backend returned '+r.status);
    nasaSite=await r.json();
    setText('dataStatus','NASA LUNAR DATA CONNECTED');
    setText('pdsStatus','NASA LOLA + DIVINER QUERY READY');
  }catch(err){
    console.warn(err); setText('dataStatus','NASA QUERY UNAVAILABLE — FALLBACK');
    setText('pdsStatus','NASA SERVICE TEMPORARILY UNAVAILABLE');
  }finally{nasaBusy=false; updateSite();}
}
updateSite();
queryNASA();

function resize(){const w=root.clientWidth,h=root.clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);}
window.addEventListener("resize",resize);
function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera);} animate();

document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".tabpage").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");document.getElementById(btn.dataset.tab).classList.add("active");
}));
document.getElementById("startSim").addEventListener("click",()=>{document.querySelector('[data-tab="sim"]').click();});
document.querySelectorAll("#sources a").forEach(a=>a.addEventListener("click",()=>{}));

const canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d");
function resizeCanvas(){const d=window.devicePixelRatio||1,r=canvas.getBoundingClientRect();canvas.width=r.width*d;canvas.height=r.height*d;ctx.setTransform(d,0,0,d,0,0);}
window.addEventListener("resize",resizeCanvas);resizeCanvas();
let running=false;
function drawLander(y,angle,terrain,status){
  const w=canvas.clientWidth,h=canvas.clientHeight;ctx.clearRect(0,0,w,h);
  const g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,"#01040a");g.addColorStop(1,"#101923");ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
  // stars
  ctx.fillStyle="#9bb4ca";for(let i=0;i<100;i++){ctx.globalAlpha=.2+(i%5)*.12;ctx.fillRect((i*79)%w,(i*43)%(terrain-20),1.2,1.2)}ctx.globalAlpha=1;
  // lunar horizon
  ctx.beginPath();ctx.moveTo(0,terrain);for(let x=0;x<=w;x+=12)ctx.lineTo(x,terrain+9*Math.sin(x*.025)+4*Math.sin(x*.073));ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.closePath();ctx.fillStyle="#575d63";ctx.fill();
  // detailed robotic lunar lander (body, foil, windows, tanks, legs, footpads, antenna)
  ctx.save();ctx.translate(w/2,y);ctx.rotate(angle*Math.PI/180);
  ctx.shadowColor="#67dfff";ctx.shadowBlur=12;
  // descent engine bell
  ctx.fillStyle="#586875";ctx.beginPath();ctx.moveTo(-8,17);ctx.lineTo(8,17);ctx.lineTo(12,27);ctx.lineTo(-12,27);ctx.closePath();ctx.fill();
  ctx.shadowBlur=0;
  // landing struts + feet
  ctx.strokeStyle="#d5e0e8";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-15,8);ctx.lineTo(-29,30);ctx.lineTo(-38,30);ctx.moveTo(15,8);ctx.lineTo(29,30);ctx.lineTo(38,30);ctx.stroke();
  ctx.fillStyle="#9eacb8";ctx.fillRect(-41,29,12,4);ctx.fillRect(29,29,12,4);
  // side propellant tanks
  ctx.fillStyle="#a8b7c4";ctx.fillRect(-25,-8,8,22);ctx.fillRect(17,-8,8,22);
  ctx.fillStyle="#64798b";ctx.fillRect(-23,-5,4,15);ctx.fillRect(19,-5,4,15);
  // central spacecraft bus
  ctx.fillStyle="#dce5ec";ctx.fillRect(-17,-22,34,38);
  ctx.fillStyle="#71889a";ctx.fillRect(-14,-19,28,5);
  // gold thermal blanket panel
  ctx.fillStyle="#c69a42";ctx.fillRect(-15,-12,30,17);
  ctx.strokeStyle="#f4d58b";ctx.lineWidth=1;for(let x=-12;x<=12;x+=6){ctx.beginPath();ctx.moveTo(x,-12);ctx.lineTo(x,5);ctx.stroke();}
  // instrument / cockpit window
  ctx.fillStyle="#143f59";ctx.fillRect(-8,-21,16,7);ctx.strokeStyle="#7ce5ff";ctx.strokeRect(-8,-21,16,7);
  // top antenna mast + dish
  ctx.strokeStyle="#dbe8ef";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-22);ctx.lineTo(0,-34);ctx.stroke();
  ctx.fillStyle="#c9d9e5";ctx.beginPath();ctx.arc(0,-35,5,Math.PI,0);ctx.fill();
  // solar panels on cross booms
  ctx.strokeStyle="#c7d5df";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-17,-3);ctx.lineTo(-39,-3);ctx.moveTo(17,-3);ctx.lineTo(39,-3);ctx.stroke();
  ctx.fillStyle="#174c78";ctx.fillRect(-51,-13,12,20);ctx.fillRect(39,-13,12,20);
  ctx.strokeStyle="#55b8ec";ctx.lineWidth=.7;for(let x=-48;x<=-42;x+=3){ctx.beginPath();ctx.moveTo(x,-13);ctx.lineTo(x,7);ctx.stroke();}for(let x=42;x<=48;x+=3){ctx.beginPath();ctx.moveTo(x,-13);ctx.lineTo(x,7);ctx.stroke();}
  ctx.restore();
  if(status){ctx.font="900 16px system-ui";ctx.fillStyle=status==="success"?"#72f5a5":"#ff6675";ctx.fillText(status==="success"?"SOFT LANDING":"LANDING FAILED",16,25);}
}
// Independent 3D descent scene (Three.js)
const simRoot=document.getElementById("sim3d"),simCanvas=document.getElementById("sim3dCanvas");
const simScene=new THREE.Scene();simScene.background=new THREE.Color(0x02050a);
const simCamera=new THREE.PerspectiveCamera(45,1,.1,100);simCamera.position.set(4,3,7);
const simRenderer=new THREE.WebGLRenderer({canvas:simCanvas,antialias:true});simRenderer.setPixelRatio(Math.min(devicePixelRatio,2));simRenderer.outputColorSpace=THREE.SRGBColorSpace;
const simOrbit=new OrbitControls(simCamera,simRenderer.domElement);simOrbit.enableDamping=true;simOrbit.target.set(0,0,0);
simScene.add(new THREE.HemisphereLight(0xb9d8ff,0x30251b,1.7));const simSun=new THREE.DirectionalLight(0xffffff,2.4);simSun.position.set(5,8,4);simScene.add(simSun);
// Site-specific procedural lunar surface: slope follows selected LOLA/prototype metrics,
 // while seeded craters, ridges and rocks make each selected landing area visibly distinct.
let siteTerrain=null,siteRocks=null;
function refreshSimTerrain(){
 if(siteTerrain){simScene.remove(siteTerrain);siteTerrain.geometry.dispose();siteTerrain.material.dispose();}
 if(siteRocks){simScene.remove(siteRocks);siteRocks.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();});}
 const m=metrics();let seed=Math.abs(Math.sin(selected.lat*12.9898+selected.lon*78.233))*10000;
 const geo=new THREE.PlaneGeometry(14,14,110,110);geo.rotateX(-Math.PI/2);
 const p=geo.attributes.position;
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),z=p.getZ(i),r=Math.sqrt(x*x+z*z);
  const tilt=(x*Math.sin(selected.lat*Math.PI/180)+z*Math.cos(selected.lon*Math.PI/180))*Math.tan(Math.min(m.slope,18)*Math.PI/180)*.16;
  const craters=Math.sin((x+seed*.001)*1.7)*Math.cos((z-seed*.002)*1.35)*.10;
  const fine=Math.sin(x*8.1+seed)*Math.cos(z*7.3-seed)*.025+Math.sin(x*15+z*11)*.012;
  const bowl=-.42*Math.exp(-Math.pow((r-3.1)/1.15,2))+.12*Math.exp(-Math.pow((r-4.2)/.55,2));
  p.setY(i,tilt+craters+fine+bowl);
 }
 geo.computeVertexNormals();
 siteTerrain=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:0x77736c,roughness:1,flatShading:false}));siteTerrain.receiveShadow=true;simScene.add(siteTerrain);
 siteRocks=new THREE.Group();
 let rand=()=>{const v=Math.sin(seed++*12.9898)*43758.5453;return v-Math.floor(v);};
 for(let i=0;i<100;i++){const x=(rand()-.5)*12,z=(rand()-.5)*12,r=.035+rand()*.16;
  const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(r,0),new THREE.MeshStandardMaterial({color:rand()>.5?0x5c5a56:0x918b80,roughness:1}));
  rock.position.set(x,tiltAt(x,z,m),z);rock.rotation.set(rand()*3,rand()*3,rand()*3);siteRocks.add(rock);
 }
 simScene.add(siteRocks);
}
function tiltAt(x,z,m){return (x*Math.sin(selected.lat*Math.PI/180)+z*Math.cos(selected.lon*Math.PI/180))*Math.tan(Math.min(m.slope,18)*Math.PI/180)*.16+Math.sin(x*1.7+selected.lon)*Math.cos(z*1.35+selected.lat)*.1;}

const lander3d=new THREE.Group();simScene.add(lander3d);
const mat=(color,metalness=0)=>new THREE.MeshStandardMaterial({color,metalness,roughness:.55});
const body=new THREE.Mesh(new THREE.BoxGeometry(.9,.65,.8),mat(0xd9e1e8,.35));lander3d.add(body);
const foil=new THREE.Mesh(new THREE.BoxGeometry(.72,.45,.04),mat(0xc49a43,.4));foil.position.z=.42;lander3d.add(foil);
const window3=new THREE.Mesh(new THREE.BoxGeometry(.28,.14,.04),mat(0x31a8d5,.4));window3.position.set(0,.18,.45);lander3d.add(window3);
const engine=new THREE.Mesh(new THREE.CylinderGeometry(.16,.28,.35,16),mat(0x596875,.6));engine.position.y=-.48;lander3d.add(engine);
for(const x of [-.55,.55])for(const z of [-.45,.45]){const leg=new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,.72,8),mat(0xcbd6df,.6));leg.position.set(x,-.55,z);leg.rotation.z=x*.35;lander3d.add(leg);const foot=new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,.05,12),mat(0x9aa8b4));foot.position.set(x*1.25,-.92,z*1.2);lander3d.add(foot);}
for(const x of [-1.25,1.25]){const panel=new THREE.Mesh(new THREE.BoxGeometry(.85,.04,.55),mat(0x155a91,.5));panel.position.set(x,.05,0);lander3d.add(panel);const boom=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.75,8),mat(0xcbd6df));boom.rotation.z=Math.PI/2;boom.position.x=x*.55;lander3d.add(boom);}
const mast=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.45,8),mat(0xdce5ec));mast.position.y=.58;lander3d.add(mast);
function resizeSim3d(){const w=simRoot.clientWidth||600,h=simRoot.clientHeight||360;simCamera.aspect=w/h;simCamera.updateProjectionMatrix();simRenderer.setSize(w,h,false);}
window.addEventListener("resize",resizeSim3d);resizeSim3d();
(function sim3dLoop(){requestAnimationFrame(sim3dLoop);simOrbit.update();simRenderer.render(simScene,simCamera);})();
function setSim3dAltitude(m){lander3d.position.y=Math.max(.2,m/500);}

function runSim(){
  if(running)return;
  let alt=Number(document.getElementById("alt").value),vel=Number(document.getElementById("vel").value),fuel=Number(document.getElementById("fuel").value),angle=Number(document.getElementById("angle").value);
  if(!Number.isFinite(alt)||alt<=0||!Number.isFinite(vel)||vel>=0||!Number.isFinite(fuel)||fuel<=0||fuel>100||!Number.isFinite(angle)){setText("simresult","Check inputs: altitude > 0, vertical speed negative, fuel 1–100%, and a valid approach angle.");setText("status","INVALID INPUT");return;}
  running=true;let t=0;const slope=metrics().slope,terrain=canvas.clientHeight-42,dt=.05;
  setText("status","DESCENDING");setText("simresult","Guidance engaged — braking and throttle are active.");
  function step(){
    // Simplified closed-loop vertical guidance: brake early, then taper descent near touchdown.
    const maxBrake=4.2,desiredVel=-Math.min(55,Math.sqrt(2*maxBrake*Math.max(alt,0)));
    const accel=clamp((desiredVel-vel)*.9,-1.5,maxBrake);
    const thrustAccel=1.62+accel,thrustRatio=clamp(thrustAccel/5.82,0,1);
    if(fuel<=0){vel-=1.62*dt;}else{vel+=accel*dt;fuel=Math.max(0,fuel-thrustRatio*.10*dt);}
    alt+=vel*dt;t+=dt;
    drawLander(terrain-(Math.max(0,alt)/Math.max(2500,alt+1))*(terrain-35),angle,terrain);setSim3dAltitude(alt);
    setText("clock",`T+${t.toFixed(1)} s`);setText("tAlt",`${Math.max(0,Math.round(alt))} m`);
    setText("tVel",`${vel.toFixed(1)} m/s`);setText("tFuel",`${Math.round(fuel)}%`);setText("tSlope",`${slope.toFixed(1)}°`);
    if(alt<=0){
      running=false;const safe=Math.abs(vel)<=6&&slope<=12&&fuel>0;
      setText("status",safe?"TOUCHDOWN":"CRASH");drawLander(terrain-16,0,terrain,safe?"success":"failure");setSim3dAltitude(0);
      setText("simresult",safe?`🟢 Touchdown! Vertical speed ${vel.toFixed(1)} m/s · slope ${slope.toFixed(1)}° · fuel ${fuel.toFixed(1)}%.`:`🔴 Unsafe touchdown. Vertical speed ${vel.toFixed(1)} m/s · slope ${slope.toFixed(1)}° · fuel ${fuel.toFixed(1)}%.`);
      return;
    }
    if(t>180){running=false;setText("status","TIMEOUT");setText("simresult","Simulation timed out at 180 s. Increase starting fuel or reduce initial descent speed.");return;}
    requestAnimationFrame(step);
  }
  step();
}
document.getElementById("run").addEventListener("click",runSim);



// V6 presentation/demo mode
const demoOverlay=document.getElementById('demoOverlay');
const showDemo=()=>{demoOverlay.hidden=false;};
document.getElementById('demoMode')?.addEventListener('click',showDemo);
document.getElementById('demoClose')?.addEventListener('click',()=>demoOverlay.hidden=true);
document.getElementById('demoStart')?.addEventListener('click',()=>{
  demoOverlay.hidden=true;
  document.querySelector('[data-tab="analysis"]').click();
  setTimeout(()=>{ document.querySelector('[data-tab="sim"]').click(); setTimeout(()=>document.getElementById('run').click(),500); },1600);
});


// AI mission copilot chat
const chatLog=document.getElementById('chatLog'), aiForm=document.getElementById('aiForm'), aiInput=document.getElementById('aiInput');
let chatHistory=[];
function addChat(role,text){const node=document.createElement('div');node.className='chat-msg '+role;const title=document.createElement('b');title.textContent=role==='user'?'YOU':'SELENE COPILOT';const p=document.createElement('p');p.textContent=text;node.append(title,p);chatLog.append(node);chatLog.scrollTop=chatLog.scrollHeight;}
function copilotContext(){const m=metrics();return {selected_site:{latitude:+selected.lat.toFixed(5),longitude:+selected.lon.toFixed(5),metrics:m,nasa_observations:nasaSite||'No NASA response available; current values may be fallback estimates.'},lander:{type:document.getElementById('lander').value,altitude_m:+document.getElementById('alt').value,vertical_speed_m_s:+document.getElementById('vel').value,approach_angle_deg:+document.getElementById('angle').value,fuel_percent:+document.getElementById('fuel').value,guidance:document.getElementById('guidance').value},simulation:{status:document.getElementById('status').textContent,altitude:document.getElementById('tAlt').textContent,vertical_speed:document.getElementById('tVel').textContent,fuel:document.getElementById('tFuel').textContent,result:document.getElementById('simresult').textContent}};}
aiForm?.addEventListener('submit',async e=>{e.preventDefault();const text=aiInput.value.trim();if(!text)return;aiInput.value='';addChat('user',text);chatHistory.push({role:'user',content:text});const send=document.getElementById('aiSend');send.disabled=true;send.textContent='THINKING…';setText('aiStatus','CONNECTING · GROQ');const waiting=document.createElement('div');waiting.className='chat-msg assistant';waiting.textContent='Analyzing mission context…';chatLog.append(waiting);try{const res=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:chatHistory,context:copilotContext()})});const data=await res.json();waiting.remove();if(!res.ok)throw new Error(data.error||'Copilot request failed');chatHistory.push({role:'assistant',content:data.answer});addChat('assistant',data.answer);setText('aiStatus','ONLINE · GROQ');}catch(err){waiting.remove();addChat('assistant',err.message);setText('aiStatus','REQUEST FAILED');}finally{send.disabled=false;send.textContent='SEND TO COPILOT →';}});
document.querySelectorAll('[data-prompt]').forEach(b=>b.addEventListener('click',()=>{aiInput.value=b.dataset.prompt;aiInput.focus();}));
document.getElementById('clearChat')?.addEventListener('click',()=>{chatHistory=[];chatLog.innerHTML='';addChat('assistant','Conversation cleared. Ask me about the selected lunar site or mission.');});


// SELENE mission-site finder + illustrative temperature overlays
const recommendationBox=document.getElementById('siteRecommendations');
function prototypeSiteScore(lat,lon){const m=fallbackMetrics(lat,lon);return Math.round(Math.max(0,100-m.slope*4)*.55+m.illum*.25+Math.max(0,100-Math.abs(m.temp+80))*.2);}
document.getElementById('recommendSite')?.addEventListener('click',()=>{
 const candidates=[];
 for(let lat=-80;lat<=80;lat+=5)for(let lon=-180;lon<180;lon+=5){const m=fallbackMetrics(lat,lon);if(m.slope<=10)candidates.push({lat,lon,score:prototypeSiteScore(lat,lon),slope:m.slope,illum:m.illum,temp:m.temp});}
 candidates.sort((a,b)=>b.score-a.score);
 const top=candidates.slice(0,5);recommendationBox.innerHTML='<b>TOP 5 PROTOTYPE CANDIDATES (ESTIMATED)</b>'+top.map((x,i)=>'<button class="site-candidate" data-lat="'+x.lat+'" data-lon="'+x.lon+'"><strong>#'+(i+1)+' · '+x.lat+'°, '+x.lon+'°</strong><span>Score '+x.score+' · slope '+x.slope.toFixed(1)+'° · light '+x.illum+'%</span></button>').join('');
 recommendationBox.querySelectorAll('[data-lat]').forEach(b=>b.addEventListener('click',()=>{selected={lat:+b.dataset.lat,lon:+b.dataset.lon};updateSite();queryNASA();}));
 setText('mapNote','Candidates are ranked by an illustrative prototype model, not a NASA-certified safety map. Verify each with live LOLA data.');
});
function mapOverlay(mode){
 moonGroup.children.filter(o=>o.userData.mapDot).forEach(o=>moonGroup.remove(o));
 for(let lat=-75;lat<=75;lat+=15)for(let lon=-180;lon<180;lon+=15){
 const m=fallbackMetrics(lat,lon);const val=mode==='hot'?m.temp:(-m.temp);
 const color=mode==='hot'?new THREE.Color(0xff4b20):new THREE.Color(0x39aaff);
 const dot=new THREE.Mesh(new THREE.SphereGeometry(.012,8,8),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.45+Math.min(1,val/220)*.5}));
 dot.position.copy(latLonToXYZ(lat,lon,1.012));dot.userData.mapDot=true;moonGroup.add(dot);
 }
 setText('mapNote',mode==='hot'?'HOT MAP · illustrative warm-region proxy (not measured NASA thermal map).':'COLD MAP · illustrative cold-region proxy (not measured NASA thermal map).');
}
document.getElementById('hotMap')?.addEventListener('click',()=>mapOverlay('hot'));
document.getElementById('coldMap')?.addEventListener('click',()=>mapOverlay('cold'));
document.getElementById('clearMap')?.addEventListener('click',()=>{moonGroup.children.filter(o=>o.userData.mapDot).forEach(o=>moonGroup.remove(o));setText('mapNote','Overlay cleared. NASA observations and prototype metrics are shown separately.');});


// SELENE personalized mission recommendation powered by the configured Groq endpoint
document.getElementById('seleneRecommend')?.addEventListener('click',async()=>{
 const out=document.getElementById('seleneResult'),btn=document.getElementById('seleneRecommend');
 const prefs={objective:document.getElementById('missionObjective').value,risk_tolerance:document.getElementById('missionRisk').value,sunlight_priority:document.getElementById('missionSun').value,ice_priority:document.getElementById('missionIce').value};
 const m=metrics(),siteContext={coordinates:{latitude:selected.lat,longitude:selected.lon},display_metrics:m,nasa_observations:nasaSite||'Unavailable; do not treat fallback estimates as measured NASA data',preferences:prefs};
 out.textContent='SELENE is evaluating your selected site and mission priorities…';btn.disabled=true;
 try{
  const prompt='Give a PERSONALIZED landing-site recommendation for this mission. Priorities: '+JSON.stringify(prefs)+'. Selected lunar site and data: '+JSON.stringify(siteContext)+'. Provide concise GO/CAUTION/NO-GO, explain fit to priorities, identify evidence vs unavailable data, 2-3 risks/tradeoffs, and a better alternative/next step if appropriate. Do not invent measurements or claim actual ice detection from coordinates alone.';
  const res=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:prompt}],context:siteContext})});
  const data=await res.json();if(!res.ok)throw new Error(data.error||'AI request failed');
  out.textContent=data.answer;document.getElementById('aiStatus')&&(document.getElementById('aiStatus').textContent='ONLINE · GROQ');
 }catch(e){out.textContent='Recommendation failed: '+e.message+' — check GROQ_API_KEY and Render logs.'}
 finally{btn.disabled=false;}
});
