import * as THREE from './vendor/three.module.js';
import {LANE_X} from './core.mjs';

export class RoadView {
  constructor(container) {
    this.container=container;
    this.scene=new THREE.Scene(); this.scene.background=new THREE.Color('#9cbcc6');
    this.scene.fog=new THREE.Fog('#9cbcc6',65,220);
    this.camera=new THREE.PerspectiveCamera(53,1,.1,420);
    this.renderer=new THREE.WebGLRenderer({antialias:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    container.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight('#d7f4ff','#5c715a',2.5));
    this.sun=new THREE.DirectionalLight('#fff0d8',3.0); this.sun.castShadow=true;
    this.sun.shadow.mapSize.set(2048,2048);
    Object.assign(this.sun.shadow.camera,{left:-35,right:35,top:45,bottom:-30,near:.1,far:160});
    this.sun.shadow.bias=-.001;
    this.scene.add(this.sun,this.sun.target);
    this.road=new THREE.Group(); this.scene.add(this.road);
    this.box(this.road,400,.15,440,0,-.2,80,'#647867');
    this.box(this.road,13,.10,360,0,-.04,90,'#343e48');
    this.box(this.road,10.8,.03,360,0,.03,90,'#303b47');
    for(const x of [-5.55,5.55]) this.box(this.road,.12,.02,360,x,.07,90,'#eedfc2');
    for(const x of [-1.8,1.8]) for(let z=-80;z<280;z+=9) this.box(this.road,.09,.02,4,x,.08,z,'#d3dbd5');
    for(const x of [-6.5,6.5]) {
      this.box(this.road,.16,.18,360,x,.85,90,'#94a5a5');
      for(let z=-80;z<280;z+=12) this.box(this.road,.13,.8,.15,x,.40,z,'#76878a');
    }
    for(let i=0;i<42;i++) {
      const side=i%2?1:-1, x=side*(10+(i*7%15)), z=-60+i*8;
      this.box(this.road,.35,1.7,.35,x,.7,z,'#666952');
      const tree=new THREE.Mesh(new THREE.ConeGeometry(1.3+(i%3)*.3,4,6),new THREE.MeshStandardMaterial({color:i%2?'#315b51':'#456d59',roughness:1}));
      tree.position.set(x,3,z); tree.castShadow=true; this.road.add(tree);
    }
    for(let i=0;i<16;i++) {
      const x=(i%2?1:-1)*(35+(i%4)*10), z=-40+i*19, h=5+(i*13%25);
      this.box(this.road,7,h,9,x,h/2,z,i%2?'#849698':'#73898d');
    }
    this.ego=this.car('#50dcbf'); this.scene.add(this.ego);
    this.objects=new Map();
    this.targetStrip=this.box(this.scene,2.5,.015,19,0,.095,12,'#66dcc3');
    this.targetStrip.material.transparent=true; this.targetStrip.material.opacity=.16;
    this.trace=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#97ffe3',transparent:true,opacity:.8}));
    this.scene.add(this.trace);
    this.resizeObserver=new ResizeObserver(()=>this.resize()); this.resizeObserver.observe(container);
    this.resize();
  }
  box(parent,w,h,d,x,y,z,color) {
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.78}));
    mesh.position.set(x,y,z); mesh.castShadow=true; mesh.receiveShadow=true; parent.add(mesh); return mesh;
  }
  car(color) {
    const g=new THREE.Group();
    this.box(g,1.8,.65,4.4,0,.65,0,color);
    this.box(g,1.58,.62,2.0,0,1.25,-.15,color);
    this.box(g,1.50,.44,.04,0,1.30,.88,'#203c4c');
    this.box(g,1.50,.42,.04,0,1.30,-1.18,'#203c4c');
    for(const x of [-.797,.797]) this.box(g,.025,.42,1.68,x,1.30,-.15,'#294757');
    const fronts=[], wheels=[];
    for(const x of [-.93,.93]) for(const z of [-1.4,1.4]) {
      const pivot=new THREE.Group(); pivot.position.set(x,.45,z);
      const tire=new THREE.Mesh(new THREE.CylinderGeometry(.40,.40,.25,16),new THREE.MeshStandardMaterial({color:'#15212b',roughness:1}));
      tire.rotation.z=Math.PI/2; tire.castShadow=true; pivot.add(tire); g.add(pivot); wheels.push(tire);
      if(z>0) fronts.push(pivot);
    }
    const brakeMat=new THREE.MeshStandardMaterial({color:'#9d2635',emissive:'#ff253b',emissiveIntensity:.1});
    for(const x of [-.63,.63]) {
      this.box(g,.43,.16,.04,x,.78,2.22,'#fff6d9');
      const lamp=this.box(g,.45,.18,.04,x,.8,-2.22,'#9d2635'); lamp.material=brakeMat;
    }
    g.userData={fronts,wheels,brakeMat}; return g;
  }
  resize() {
    const {width,height}=this.container.getBoundingClientRect();
    this.renderer.setSize(width,height); this.camera.aspect=width/height; this.camera.updateProjectionMatrix();
  }
  update(world,command,dt) {
    const c=world.car;
    this.ego.position.set(c.x,0,c.z); this.ego.rotation.y=c.yaw;
    for(const w of this.ego.userData.fronts) w.rotation.y=c.steer;
    for(const w of this.ego.userData.wheels) w.rotation.x+=c.v*dt/.4;
    this.ego.userData.brakeMat.emissiveIntensity=command.brake>0?2:.1;
    this.road.position.z=Math.floor(c.z/36)*36;
    const keys=new Set(world.obstacles.map(o=>o.id));
    for(const [id,mesh] of this.objects) if(!keys.has(id)) {
      this.scene.remove(mesh); mesh.traverse(node=>{if(node.isMesh){node.geometry.dispose();node.material.dispose();}}); this.objects.delete(id);
    }
    for(const o of world.obstacles) {
      if(!this.objects.has(o.id)) {const mesh=this.car(o.v?'#e7b35f':'#d96858');this.scene.add(mesh);this.objects.set(o.id,mesh);}
      this.objects.get(o.id).position.set(o.x,0,o.z);
    }
    this.targetStrip.position.set(LANE_X[command.lane],.095,c.z+14);
    const points=[];
    let x=c.x,z=c.z,yaw=c.yaw;
    for(let i=0;i<30;i++) {
      points.push(new THREE.Vector3(x,.15,z));
      yaw+=Math.tan(c.steer)/2.6*.7; x+=Math.sin(yaw)*.7; z+=Math.cos(yaw)*.7;
    }
    this.trace.geometry.dispose(); this.trace.geometry=new THREE.BufferGeometry().setFromPoints(points);
    // Chase camera follows actual pose; the scene is rendered in 3D world units.
    this.camera.position.set(c.x*.35+8,8.6,c.z-17);
    this.camera.lookAt(c.x*.2,.5,c.z+18);
    this.sun.position.set(c.x-24,48,c.z-12); this.sun.target.position.set(c.x,0,c.z+18);
    this.renderer.render(this.scene,this.camera);
  }
}
