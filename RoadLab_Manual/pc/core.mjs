export const STATES = ['IDLE', 'CRUISE', 'WARNING', 'AVOID LEFT', 'AVOID RIGHT', 'BRAKING', 'EMERGENCY', 'LINK FAULT', 'ADC FAULT'];
export const LANE_X = [-3.6, 0, 3.6];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const freshSequence = (next, prev) => { const d = (next - prev) & 65535; return d > 0 && d < 32768; };

export function crc16(text) {
  let crc = 0xffff;
  for (const ch of text) {
    crc ^= ch.charCodeAt(0) << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
  }
  return crc;
}
export function frame(payload) { return `@${payload}*${crc16(payload).toString(16).toUpperCase().padStart(4, '0')}\n`; }
export function decode(line, prefix, count) {
  const m = /^@([^*\r\n]+)\*([0-9A-F]{4})$/.exec(line.trim());
  if (!m || crc16(m[1]) !== parseInt(m[2], 16)) return null;
  const parts = m[1].split(',');
  if (parts.shift() !== prefix || parts.length !== count || parts.some(p => !/^-?\d{1,6}$/.test(p))) return null;
  return parts.map(Number);
}
export function sceneFrame(s) {
  return frame(`S1,${s.session},${s.seq},${s.run},${s.reset},${s.estop},${s.speed},${s.x},${s.yaw},${s.front},${s.closing},${s.clear}`);
}
export function commandFrame(c, s) {
  return frame(`C1,${s.session},${s.seq},${c.steer},${c.throttle},${c.brake},${c.state},${c.lane},${c.adc},${c.ttc},${c.fault}`);
}
export function readCommand(line) {
  const a = decode(line, 'C1', 10);
  if (!a) return null;
  const [session, seq, steer, throttle, brake, state, lane, adc, ttc, fault] = a;
  const ranges = [[1,65535],[0,65535],[-240,240],[0,1000],[0,1000],[0,8],[0,2],[0,4095],[0,99999],[0,7]];
  if (a.some((v,i) => v < ranges[i][0] || v > ranges[i][1])) return null;
  return {session, seq, steer, throttle, brake, state, lane, adc, ttc, fault};
}

/* A bounded stream splitter; an oversized frame is discarded through newline. */
export class Lines {
  constructor() { this.text = ''; this.drop = false; }
  push(chunk) {
    const lines = [];
    for (const ch of chunk) {
      if (ch === '\n') { if (!this.drop && this.text) lines.push(this.text); this.text = ''; this.drop = false; }
      else if (ch !== '\r') {
        if (this.text.length >= 191) this.drop = true;
        if (!this.drop) this.text += ch;
      }
    }
    return lines;
  }
}

export const stopCommand = (state = 0) => ({steer:0, throttle:0, brake:1000, state, lane:1, adc:0, ttc:99999, fault:0});

/* Explicit PC demo equivalent of controller.c. Hardware mode never calls it. */
export class DemoController {
  constructor() { this.reset(); }
  reset() { this.target = 1; this.changing = false; this.latched = false; this.fault = 0; this.steering = 0; }
  step(s, adc, linkOK = true, adcOK = true, button = false) {
    const o = {...stopCommand(), adc};
    const v=s.speed/100, x=s.x/100, yaw=s.yaw/1000, d=s.front/100, closing=s.closing/100;
    const lane=x < -1.8 ? 0 : x > 1.8 ? 2 : 1;
    if (s.reset && !s.run && v < .1 && !button && !s.estop && linkOK && adcOK) { this.reset(); this.target=lane; }
    if (button || s.estop) { this.latched=true; this.fault=1; }
    if (!linkOK) { this.latched=true; this.fault |= 2; }
    if (!adcOK) { this.latched=true; this.fault |= 4; }
    o.lane=this.target;
    if (this.latched) { o.fault=this.fault; o.state=this.fault&1 ? 6 : this.fault&2 ? 7 : 8; this.steering=0; return o; }
    if (!s.run) { this.target=lane; this.changing=false; this.steering=0; o.lane=lane; return o; }
    if (s.closing > 5 && s.front < 30000) o.ttc=Math.min(99999,Math.trunc(s.front*1000/s.closing));
    const stopping=Math.trunc((s.speed*3+9)/10)+Math.trunc((s.speed*s.speed+1599)/1600)+300;
    const warning=s.front<30000 && (o.ttc<5000 || s.front<stopping+1400);
    const danger=s.front<30000 && (o.ttc<3200 || s.front<stopping+800);
    if (!this.changing && danger && v>1 && d>6) {
      if (lane>0 && s.clear & (1 << (lane-1))) { this.target=lane-1; this.changing=true; }
      else if (lane<2 && s.clear & (1 << (lane+1))) { this.target=lane+1; this.changing=true; }
    }
    const error=LANE_X[this.target]-x;
    if (this.changing && Math.abs((this.target-1)*360-s.x)<18 && Math.abs(s.yaw)<35) this.changing=false;
    o.state=warning?2:1; o.brake=0;
    if (this.changing) {
      o.state=error<0?3:4;
      if (!(s.clear & (1<<this.target)) || s.front<stopping) o.brake=1000;
      else if (danger) o.brake=180;
    } else if (danger) { o.state=5; o.brake=s.front<stopping?1000:450; }
    if (d<2.5) { o.brake=1000; o.state=5; }
    const desired=clamp(Math.atan2(1.3*error,Math.max(v,3))-1.8*yaw,-.24,.24);
    this.steering+=clamp(desired-this.steering,-.016,.016);
    o.steer=Math.trunc(this.steering*1000);
    const setpoint=adc*18/4095;
    if (!o.brake) {
      o.throttle=Math.trunc(clamp((setpoint-v)*500,0,1000));
      if (v>setpoint+.3) o.brake=Math.trunc(clamp((v-setpoint)*180,0,600));
    }
    o.lane=this.target;
    return o;
  }
}

export class World {
  constructor() { this.reset('left'); }
  reset(scenario='left') {
    this.car={x:0, z:0, yaw:0, v:0, steer:0};
    this.time=0; this.collision=false; this.finished=false; this.scenario=scenario;
    this.obstacles=[];
    if (scenario!=='empty') this.obstacles.push({x:0,z:75,v:0,width:1.9,length:4.4,id:1});
    if (scenario==='left' || scenario==='blocked') this.obstacles.push({x:3.6,z:69,v:0,width:1.9,length:4.4,id:2});
    if (scenario==='right' || scenario==='blocked') this.obstacles.push({x:-3.6,z:69,v:0,width:1.9,length:4.4,id:3});
    if (scenario==='moving') this.obstacles[0].v=4;
  }
  spawn(lane, distance=35) {
    this.obstacles.push({id:Date.now(),x:LANE_X[lane],z:this.car.z+distance,v:0,width:1.9,length:4.4});
  }
  sense() {
    const c=this.car;
    let front=300, closing=0, clear=7;
    const projectedHalfWidth=Math.abs(Math.cos(c.yaw))*.9+Math.abs(Math.sin(c.yaw))*2.2;
    for (const o of this.obstacles) {
      const gap=o.z-c.z-2.2-o.length/2;
      if (o.z+o.length/2>=c.z-2.2 && Math.abs(o.x-c.x)<projectedHalfWidth+o.width/2+.25 && gap<front) {
        front=Math.max(0,gap); closing=c.v*Math.cos(c.yaw)-o.v;
      }
      // Corridor availability is a simulated observation, NOT a steering decision.
      // Conservatively exclude any overlap over the next 3 s, including rear traffic.
      const lane=LANE_X.indexOf(o.x);
      const rear=o.z-c.z;
      const future=rear+(o.v-c.v)*3;
      if (lane>=0 && Math.min(rear,future)<Math.max(20,c.v*2.8+10) && Math.max(rear,future)>-14) clear &= ~(1<<lane);
    }
    return {speed:Math.round(c.v*100),x:Math.round(c.x*100),yaw:Math.round(c.yaw*1000),
      front:Math.round(clamp(front,0,300)*100),closing:Math.round(clamp(closing,-30,30)*100),clear};
  }
  step(command, dt) {
    if (this.collision) return;
    const c=this.car;
    c.steer+=clamp(command.steer/1000-c.steer,-.8*dt,.8*dt);
    c.v=clamp(c.v+(3*command.throttle/1000-8*command.brake/1000-.12*c.v)*dt,0,25);
    c.yaw+=c.v/2.6*Math.tan(c.steer)*dt;
    c.x+=c.v*Math.sin(c.yaw)*dt;
    c.z+=c.v*Math.cos(c.yaw)*dt;
    this.time+=dt;
    for (const o of this.obstacles) o.z+=o.v*dt;
    const ex=Math.abs(Math.cos(c.yaw))*.9+Math.abs(Math.sin(c.yaw))*2.2;
    const ez=Math.abs(Math.cos(c.yaw))*2.2+Math.abs(Math.sin(c.yaw))*.9;
    // Conservative AABB of the rotated ego car; no teleport on lane change.
    if (Math.abs(c.x)+ex>5.4 || this.obstacles.some(o=>Math.abs(o.x-c.x)<ex+o.width/2 && Math.abs(o.z-c.z)<ez+o.length/2)) {
      this.collision=true; c.v=0;
    }
    this.finished=this.obstacles.length>0 && this.obstacles.every(o=>o.z+o.length/2<c.z-3);
  }
}
