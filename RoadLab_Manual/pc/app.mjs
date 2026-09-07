import {ManualWorld, driverCommand, advise} from './manual.mjs';
import {clamp} from './core.mjs';
import {RoadView} from './view3d.mjs';

const $=id=>document.getElementById(id);
$('throttle').step='0.1';
const world=new ManualWorld(),keys=new Set(),pointers=new Map(),logs=[];
let status='ready',axis=0,lastLevel='',elapsed=0,previous=performance.now(),lastUI=0,accumulator=0;
let command=driverCommand(0,0,false,0),assessment=advise(world),view;
function log(message){
  const item={time:Number(world.time.toFixed(2)),message};logs.push(item);if(logs.length>1000)logs.shift();
  const li=document.createElement('li');li.textContent=`${item.time.toFixed(2)} s   ${message}`;$('log').prepend(li);
  while($('log').children.length>80)$('log').lastChild.remove();
}
function clearInput(){keys.clear();pointers.clear();axis=0;}
function pause(reason='พักการขับ'){
  if(status==='running'){status='paused';clearInput();log(reason);}
}
function reset(){
  clearInput();world.reset($('scenario').value);status='ready';lastLevel='';accumulator=0;
  $('throttle').value='0';command=driverCommand(0,0,false,0);log('Reset — ตั้งคันเร่งเป็นศูนย์');
}
function emergency(){
  clearInput();status='emergency';world.car.v=0;$('throttle').value='0';command=driverCommand(0,0,true,0);
  log('Emergency Stop — กด Reset ก่อนเริ่มใหม่');
}
try{view=new RoadView($('viewport'));$('boot').remove();}
catch(error){$('boot').textContent=`เปิด 3D ไม่สำเร็จ: ${error.message} — ลองเปิดใน Chrome/Edge ที่รองรับ WebGL`;for(const id of ['start','pause'])$(id).disabled=true;throw error;}

$('start').onclick=()=>{if(!['ready','paused'].includes(status))return;clearInput();status='running';log('เริ่มขับ — ผู้ใช้ควบคุมรถเอง');};
$('pause').onclick=()=>pause();$('reset').onclick=reset;$('scenario').onchange=reset;$('emergency').onclick=emergency;
const editable=target=>['INPUT','SELECT','TEXTAREA'].includes(target.tagName);
const drivingKeys=new Set(['KeyA','KeyD','ArrowLeft','ArrowRight','Space','KeyW','KeyS','ArrowUp','ArrowDown']);
document.addEventListener('keydown',e=>{
  if(e.code==='Escape'){e.preventDefault();pause();return;}
  if(!drivingKeys.has(e.code)||editable(e.target))return;
  e.preventDefault();if(status==='running')keys.add(e.code);
});
document.addEventListener('keyup',e=>{keys.delete(e.code);});
window.addEventListener('blur',()=>pause('พักอัตโนมัติเมื่อออกจากหน้าต่าง'));
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause('พักอัตโนมัติเมื่อเปลี่ยนแท็บ');});
for(const [id,value] of [['left',-1],['right',1],['brake',2]]){
  const button=$(id);
  button.addEventListener('pointerdown',e=>{if(status!=='running')return;e.preventDefault();button.setPointerCapture(e.pointerId);pointers.set(e.pointerId,value);});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,e=>pointers.delete(e.pointerId));
}
// Release focus after a mouse/touch change so Space remains a driving key.
for(const id of ['throttle','sensitivity','reaction','spawn-distance','scenario'])$(id).addEventListener('pointerup',()=>$(id).blur());
for(const b of document.querySelectorAll('[data-spawn]'))b.onclick=()=>{
  if(['collision','emergency'].includes(status)){log('กด Reset ก่อนเพิ่มเหตุการณ์ใหม่');return;}
  const lane=Number(b.dataset.spawn),distance=Number($('spawn-distance').value);
  log(world.spawn(lane,distance)?`เพิ่มรถเลน ${['ซ้าย','กลาง','ขวา'][lane]} ที่ ${distance} m`:'ครบ 80 วัตถุแล้ว — Reset เพื่อเริ่มใหม่');
};
$('export').onclick=()=>{
  const blob=new Blob([JSON.stringify({mode:'manual-pc',scenario:world.scenario,reactionSeconds:Number($('reaction').value),logs},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='roadlab-manual-events.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
function inputs(dt){
  const held=[...pointers.values()];
  const left=keys.has('KeyA')||keys.has('ArrowLeft')||held.includes(-1);
  const right=keys.has('KeyD')||keys.has('ArrowRight')||held.includes(1);
  const braking=keys.has('Space')||held.includes(2);
  const target=(Number(right)-Number(left))*Number($('sensitivity').value);
  axis+=clamp(target-axis,-2*dt,2*dt);
  const gasUp=keys.has('KeyW')||keys.has('ArrowUp'),gasDown=keys.has('KeyS')||keys.has('ArrowDown');
  if(gasUp||gasDown)$('throttle').value=String(clamp(Number($('throttle').value)+(Number(gasUp)-Number(gasDown))*40*dt,0,100));
  command=driverCommand(axis,Number($('throttle').value),braking,world.car.v);
  return {left,right,braking};
}
function updateUI(){
  const a=assessment;
  let title=a.title,hint=a.hint;
  if(status==='ready'){title='พร้อมทดลอง';hint='กดเริ่มขับ แล้วใช้ W เพิ่มคันเร่ง · A/D เลี้ยว · Space เบรก';}
  if(status==='paused'){title='พักการขับ';hint='กดเริ่มขับเพื่อทำต่อจากตำแหน่งเดิม';}
  if(status==='emergency'){title='EMERGENCY STOP';hint='กด Reset เพื่อเริ่มใหม่';}
  if(status==='collision'){title='ชน / ออกจากถนน';hint='การทดลองสิ้นสุด — กด Reset แล้วลองใหม่';}
  $('state').textContent=title;$('hint').textContent=hint;document.querySelector('.overlay').dataset.level=status==='collision'?'critical':a.level;
  $('speed').textContent=(world.car.v*3.6).toFixed(1);
  $('distance').textContent=Number.isFinite(a.front)?a.front.toFixed(1):'—';
  $('ttc').textContent=Number.isFinite(a.ttc)?a.ttc.toFixed(1):'—';$('stopping').textContent=a.stopping.toFixed(1);
  $('throttle-value').textContent=`${Math.round(Number($('throttle').value))}%`;
  $('power').textContent=status==='running'?`${Math.round(command.throttle/10)}%`:'0%';
  const deg=world.car.steer*180/Math.PI;$('angle').textContent=`${Math.abs(deg)<.05?'ล้อตรง':deg<0?'เลี้ยวซ้าย':'เลี้ยวขวา'} · ${Math.abs(deg).toFixed(1)}°`;
  $('wheel').style.transform=`rotate(${deg*10}deg)`;
  for(let i=0;i<3;i++){ $('lane'+i).classList.toggle('clear',a.clearance[i]);$('lane'+i).classList.toggle('recommended',a.recommended===i);}
  const flags={blue:a.level==='normal',yellow:a.level==='warning',red:['brake','critical'].includes(a.level),green:a.recommended!==null};
  for(const [color,on] of Object.entries(flags))$('led-'+color).style.background=on?{blue:'#63baff',yellow:'#ffd472',red:'#ff696e',green:'#63e6a5'}[color]:'#354050';
  $('start').disabled=!['ready','paused'].includes(status);$('start').textContent=status==='paused'?'▶ ขับต่อ':'▶ เริ่มขับ';$('pause').disabled=status!=='running';
  $('clock').textContent=`${String(Math.floor(world.time/60)).padStart(2,'0')}:${(world.time%60).toFixed(1).padStart(4,'0')}`;
  for(const [id,on] of [['left',axis<-.02],['right',axis>.02],['brake',status==='running'&&command.brake>0]])$(id).classList.toggle('active',on);
}
function animate(now){
  elapsed=(now-previous)/1000;previous=now;
  if(elapsed>.3)pause('พักอัตโนมัติ: การแสดงผลหยุดชั่วคราว');
  if(status==='running'){
    accumulator+=Math.min(elapsed,.1);
    while(accumulator>=.01){
      inputs(.01);world.step(command,.01);accumulator-=.01;
      if(world.collision){status='collision';clearInput();log('ชนหรือออกนอกถนน — จบการทดลอง');break;}
    }
  }else accumulator=0;
  assessment=advise(world,Number($('reaction').value),Number($('sensitivity').value));
  const signature=`${assessment.level}:${assessment.recommended}`;
  if(status==='running'&&signature!==lastLevel){log(assessment.title);lastLevel=signature;}
  view.targetStrip.visible=assessment.recommended!==null;
  view.update(world,{...command,lane:assessment.recommended??assessment.lane},status==='running'?Math.min(elapsed,.05):0);
  if(now-lastUI>80){updateUI();lastUI=now;}
  requestAnimationFrame(animate);
}
reset();requestAnimationFrame(animate);
