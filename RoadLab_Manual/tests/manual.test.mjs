import test from 'node:test';
import assert from 'node:assert/strict';
import {ManualWorld,driverCommand,advise} from '../pc/manual.mjs';

test('brake overrides throttle; steering is driver controlled',()=>{
  assert.equal(driverCommand(0,100,true,10).throttle,0);
  assert.equal(driverCommand(0,100,true,10).brake,1000);
  assert.equal(driverCommand(0,100,false,10).steer,0);
  assert.ok(driverCommand(-1,0,false,10).steer<0);
  assert.ok(driverCommand(1,0,false,10).steer>0);
});
test('no automatic braking or steering even when advisor detects danger',()=>{
  const w=new ManualWorld();w.reset('blocked');w.car.v=15;w.car.z=55;
  assert.equal(advise(w).level,'critical');
  const cmd=driverCommand(0,100,false,15);w.step(cmd,.01);
  assert.equal(w.car.steer,0);assert.ok(w.car.v>15);
});
test('braking stops within conservative distance estimate',()=>{
  const w=new ManualWorld();w.reset('empty');w.car.v=18;
  const stop=advise(w).stopping;
  for(let i=0;i<500;i++)w.step(driverCommand(0,100,true,w.car.v),.01);
  assert.equal(w.car.v,0);assert.ok(w.car.z<stop);
});
test('rear vehicle closes left lane; blocked lanes never recommended',()=>{
  const w=new ManualWorld();w.reset('rear');w.car.v=12;
  const a=advise(w);assert.equal(a.clearance[0],false);
  w.reset('blocked');w.car.v=18;w.car.z=50;
  assert.equal(advise(w).recommended,null);
});
test('advice can recommend left/right only with enough maneuver time',()=>{
  for(const [scenario,expected] of [['left',0],['right',2]]){
    const w=new ManualWorld();w.reset(scenario);w.car.v=25;w.car.z=11;
    assert.equal(advise(w).recommended,expected);
    w.car.z=64;assert.equal(advise(w).recommended,null);
  }
});
test('steering changes heading; collision ends movement',()=>{
  const w=new ManualWorld();w.reset('empty');w.car.v=10;
  for(let i=0;i<40;i++)w.step(driverCommand(.4,0,false,w.car.v),.01);
  assert.ok(w.car.x>0);assert.ok(w.car.yaw>0);
  w.reset('empty');w.spawn(1,6);w.car.v=15;
  for(let i=0;i<50;i++)w.step(driverCommand(0,0,false,w.car.v),.01);
  assert.equal(w.collision,true);assert.equal(w.car.v,0);
});
test('unique spawn IDs and bounded objects',()=>{
  const w=new ManualWorld();w.reset('empty');for(let i=0;i<100;i++)w.spawn(0,35);
  assert.equal(w.obstacles.length,80);assert.equal(new Set(w.obstacles.map(o=>o.id)).size,80);
});
test('non-closing object has no finite TTC and larger reaction gives larger stopping estimate',()=>{
  const w=new ManualWorld();w.reset('moving');w.car.v=2;
  assert.equal(advise(w).ttc,Infinity);
  assert.ok(advise(w,1.5).stopping>advise(w,.7).stopping);
});
