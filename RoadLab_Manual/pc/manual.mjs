import {World, clamp, LANE_X} from './core.mjs';

export class ManualWorld extends World {
  reset(scenario='empty') {
    super.reset(scenario);
    this.nextId=10;
    if(scenario==='rear') {
      this.obstacles.push({id:4,x:-3.6,z:-32,v:23,width:1.9,length:4.4});
      this.obstacles.push({id:5,x:3.6,z:65,v:0,width:1.9,length:4.4});
    }
  }
  spawn(lane,distance=35) {
    if(this.obstacles.length>=80) return false;
    this.obstacles.push({id:this.nextId++,x:LANE_X[lane],z:this.car.z+distance,v:0,width:1.9,length:4.4});
    return true;
  }
  step(command,dt) {
    super.step(command,dt);
    this.obstacles=this.obstacles.filter(o=>o.z>this.car.z-150);
  }
}

// Driver commands only. The advisor never supplies steering or braking here.
export function driverCommand(axis, throttle, brake, speed) {
  const maxAngle=clamp(.32/(1+Math.max(0,speed)/12),.10,.32);
  return {steer:clamp(axis,-1,1)*maxAngle*1000,
    throttle:brake?0:clamp(throttle,0,100)*10,brake:brake?1000:0,lane:1};
}

export function advise(world,reaction=1,sensitivity=1) {
  const c=world.car, deceleration=8, margin=3;
  const stopping=c.v*reaction+c.v*c.v/(2*deceleration)+margin;
  const lane=clamp(Math.round(c.x/3.6)+1,0,2);
  let front=Infinity, closing=0, ttc=Infinity;
  // Project the current heading; inspect the swept corridor over five seconds.
  // This is an advisory estimate, not a guarantee about a future driver action.
  for(const o of world.obstacles) {
    const gap=o.z-c.z-2.2-o.length/2;
    if(o.z+o.length/2<c.z-2.2) continue;
    const approach=c.v*Math.cos(c.yaw)-o.v;
    const hitTime=approach>.05?Math.max(0,gap)/approach:Infinity;
    const nowOverlap=Math.abs(o.x-c.x)<.9+o.width/2+.25;
    const futureX=c.x+c.v*Math.sin(c.yaw)*Math.min(hitTime,5);
    const projected=hitTime<5 && Math.abs(o.x-futureX)<.9+o.width/2+.35;
    if((nowOverlap||projected) && gap<front) {
      front=Math.max(0,gap);closing=approach;ttc=hitTime;
    }
  }
  // Check target-lane swept longitudinal gaps, including fast rear traffic.
  const clearance=LANE_X.map(x=>!world.obstacles.some(o=>{
    if(Math.abs(o.x-x)>1.8) return false;
    const gap=o.z-c.z, future=gap+(o.v-c.v)*3;
    return Math.min(gap,future)<Math.max(12,c.v*1.5) && Math.max(gap,future)>-12;
  }));
  // Budget reaction + estimated lane traversal time using this steering limit.
  const maxAngle=driverCommand(clamp(sensitivity,.1,1),0,false,c.v).steer/1000;
  const lateralAccel=c.v*c.v/2.6*Math.tan(maxAngle);
  const turnTime=2*Math.sqrt(3.6/Math.max(.1,lateralAccel));
  const canTurn=c.v>2 && front>6 && ttc>reaction+turnTime;
  const choices=[lane-1,lane+1].filter(i=>i>=0&&i<=2&&clearance[i]);
  let level='normal',title='ขับปกติ',hint='รักษาระยะห่าง และควบคุมรถด้วยตัวเอง',recommended=null;
  const risk=front<Infinity && (ttc<6 || front<stopping+15);
  if(risk) {
    level='warning';title='ระวังรถด้านหน้า';hint='ลดคันเร่ง เตรียมเบรก และตรวจเลนข้าง';
    if(front<=stopping+8 || ttc<4) {
      level='brake';title='เบรกเพื่อลดความเสี่ยง';hint='แบบจำลองประเมินว่ายังมีระยะสำหรับหยุด — กด Space ค้าง';
      if(front<stopping) {
        level='critical';title='เบรกเต็มที่';
        hint='เบรกอย่างเดียวอาจไม่ทัน / ไม่มีช่องทางหลบพร้อมใช้';
        if(choices.length && canTurn) {
          recommended=choices[0];title=`เบรกและพิจารณาหลบ${recommended<lane?'ซ้าย':'ขวา'}`;
          hint='พื้นที่และเวลาผ่านเกณฑ์จำลองขณะนี้ — คุณเป็นผู้ตัดสินใจเลี้ยว';
        } else if(choices.length) hint='เลนข้างมีพื้นที่ แต่เวลาที่เหลืออาจไม่พอเปลี่ยนเลน — เบรกเต็มที่';
      }
    }
  }
  if(c.v<.1 && front>margin) {level='normal';title='รถหยุดอยู่';hint='เพิ่มคันเร่งเมื่อพร้อม และตรวจถนนก่อนออกตัว';}
  return {level,title,hint,front,closing,ttc,stopping,clearance,recommended,lane,turnTime};
}
