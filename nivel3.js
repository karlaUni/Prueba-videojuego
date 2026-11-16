import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
// AJUSTES EDITABLES (unidades del GLB original): X = recorrido izquierda/derecha; Y = altura; Z = profundidad.
const CFG={speed:2.8,foxySpeed:1.65,jump:5.7,gravity:14,bunnyHeight:.72,foxyHeight:.74,groundY:-.68,
 start:{x:-11.6,z:.25}, key:{x:12.05,z:-1.07},chest:{x:11.15,z:.35},
 foxyUnderRamp:{x:3.7,z:-2.8},foxyLever:{x:3.0,z:-1.65},
 checkpoints:[{x:-11.6,z:.25},{x:-7.0,z:.35},{x:1.7,z:.35},{x:5.9,z:.4}],
 towerMotion:.11,debug:false};
const $=id=>document.getElementById(id),clamp=THREE.MathUtils.clamp;
const scene=new THREE.Scene();scene.background=new THREE.Color('#d8e8ed');scene.fog=new THREE.Fog('#d8e8ed',40,90);
const camera=new THREE.PerspectiveCamera(57,innerWidth/innerHeight,.08,160);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.45;$('game').appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff,0x9c927e,2.5));const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(-8,17,12);scene.add(sun);
const loader=new GLTFLoader(),clock=new THREE.Clock(),raycaster=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0);
const keysPressed=new Set(),obstacles=[],towers=[],debugHelpers=[],sparks=[];
let terrain,bunny,foxy,keyMesh,keyMarker,chest,lid,coins,active=false,paused=false,won=false,hasThird=false,vy=0,grounded=true,checkpoint=0,dialogUntil=0,stageNumber=-1,elapsed=0,foxyState=0,foxyTimer=0,foxyCooldown=2,camShift=0,towersActive=false,debugOn=false,oldTowerX=[],supportTower=-1;
function say(t,ms=6500){$('dialogText').textContent=t;$('dialog').classList.remove('hidden');dialogUntil=performance.now()+ms}
function stage(n,t){if(n>stageNumber){stageNumber=n;say(t)}}
function hint(t){$('hint').textContent=t;$('hint').classList.toggle('hidden',!t)}
function load(path){return new Promise((resolve,reject)=>loader.load(path,g=>resolve(g.scene),undefined,reject))}
function fitModel(root,height){root.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(root),sz=box.getSize(new THREE.Vector3());root.scale.multiplyScalar(height/Math.max(.001,sz.y));root.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(root),center=b.getCenter(new THREE.Vector3());root.position.set(-center.x,-b.min.y,-center.z);const group=new THREE.Group();group.add(root);return group}
function bounds(mesh){mesh.updateWorldMatrix(true,false);return new THREE.Box3().setFromObject(mesh)}
function addBox(box,type,mesh=null){const sz=box.getSize(new THREE.Vector3());if(sz.x<.09||sz.z<.09)return;const obj={box,type,mesh};obstacles.push(obj);const h=new THREE.Box3Helper(box,type==='tower'?0xffdd33:0x55bbff);h.visible=false;scene.add(h);debugHelpers.push(h);obj.helper=h;return obj}
function findGeometry(root){root.updateMatrixWorld(true);root.traverse(o=>{if(!o.isMesh)return;const n=o.name.toLowerCase();if(n.includes('wind_up_key')){keyMesh=o;return}if(n.startsWith('greek_column_02')){const col=addBox(bounds(o),'tower',o);if(col)towers.push(col);return}if(n==='cube.001'||n==='cube.002'||n==='cube.005'||n.startsWith('cubo.001')||n.startsWith('cubo.005')){ // escaleras/rampas: superficie transitable, no pared completa
 return}
if(n.startsWith('brick_flemish_bond'))addBox(bounds(o),'wall',o);
});towers.sort((a,b)=>a.box.min.x-b.box.min.x)}
function floorAt(x,z){ // El raycast usa la geometría real del GLB: pies alineados con la superficie visible.
 raycaster.set(new THREE.Vector3(x,8,z),down);
 const hits=raycaster.intersectObject(terrain,true).filter(h=>h.object!==keyMesh&& !h.object.name.toLowerCase().includes('cylinder'));
 // Superficies transitables; no confundir techos o paredes con el suelo.
 const allowed=hits.filter(h=>h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y>.48);
 if(allowed.length)return allowed[0].point.y;
 return CFG.groundY;
}
function supportAt(x,z,currentY,allowStep=.23){let best=CFG.groundY,id=-1;
 // Terreno base + roca inicial + escaleras + columnas + rampa + templo.
 raycaster.set(new THREE.Vector3(x,Math.max(currentY+allowStep,CFG.groundY+.1),z),down);
 const hits=raycaster.intersectObject(terrain,true);
 for(const h of hits){if(h.object===keyMesh||h.object.name.toLowerCase().includes('cylinder'))continue;
 const normal=h.face?.normal.clone().transformDirection(h.object.matrixWorld);if(!normal||normal.y<.42)continue;
 if(h.point.y>best+.015){best=h.point.y;id=towers.findIndex(t=>t.mesh===h.object)} }
 // Las torres pueden ser móviles: detectar su superficie superior de manera independiente.
 for(let i=0;i<towers.length;i++){const b=towers[i].box;if(x>b.min.x+.06&&x<b.max.x-.06&&z>b.min.z+.04&&z<b.max.z-.04&&b.max.y<=currentY+allowStep&&b.max.y>best){best=b.max.y;id=i}}
 return {y:best,tower:id};}
function blocked(x,z,feet){const radius=.16;for(const o of obstacles){if(o.type==='tower')continue;const b=o.box;if(o.type==='wall'&&b.min.x>4&&b.min.x<6&&Math.abs(z)<1.25&&feet>.25)continue;if(x+radius<b.min.x||x-radius>b.max.x||z+radius<b.min.z||z-radius>b.max.z)continue;if(feet+.12<b.max.y&&feet+.68>b.min.y)return true}return false}
function moveSafe(obj,dx,dz,feet){const nx=clamp(obj.position.x+dx,-13.1,15.9),nz=clamp(obj.position.z+dz,-6.9,5.2);if(!blocked(nx,obj.position.z,feet))obj.position.x=nx;if(!blocked(obj.position.x,nz,feet))obj.position.z=nz}
function createChest(){const wood=new THREE.MeshStandardMaterial({color:0x88502b,roughness:.8}),trim=new THREE.MeshStandardMaterial({color:0xf8c64c,metalness:.55,roughness:.28}),gold=new THREE.MeshStandardMaterial({color:0xffd341,metalness:.65,roughness:.2});chest=new THREE.Group();const body=new THREE.Mesh(new THREE.BoxGeometry(.8,.42,.52),wood);body.position.y=.23;chest.add(body);lid=new THREE.Group();lid.position.set(0,.44,-.25);const top=new THREE.Mesh(new THREE.BoxGeometry(.84,.2,.56),wood);top.position.z=.25;lid.add(top);const band=new THREE.Mesh(new THREE.BoxGeometry(.12,.215,.57),trim);band.position.z=.25;lid.add(band);chest.add(lid);for(let i=0;i<12;i++){const c=new THREE.Mesh(new THREE.CylinderGeometry(.085,.085,.025,12),gold);c.rotation.x=Math.PI/2;c.position.set((i%4-1.5)*.15,.43+Math.floor(i/4)*.055,(i%3-1)*.12);chest.add(c)}coins=chest.children.slice(2);chest.position.set(CFG.chest.x,1.03,CFG.chest.z);scene.add(chest);return chest}
function makeMarker(){const g=new THREE.Group(),mat=new THREE.MeshStandardMaterial({color:0xffd52a,metalness:.5,roughness:.24,emissive:0xff9e00,emissiveIntensity:.4});const ring=new THREE.Mesh(new THREE.TorusGeometry(.13,.04,8,22),mat);ring.position.y=.22;g.add(ring);const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,.27,10),mat);shaft.position.y=.02;g.add(shaft);const tooth=new THREE.Mesh(new THREE.BoxGeometry(.12,.055,.06),mat);tooth.position.set(.07,-.09,0);g.add(tooth);g.position.set(CFG.key.x,1.3,CFG.key.z);scene.add(g);return g}
function reset(){active=false;paused=false;won=false;hasThird=false;vy=0;grounded=true;checkpoint=0;stageNumber=-1;elapsed=0;foxyState=0;foxyTimer=0;foxyCooldown=2;towersActive=false;supportTower=-1;keysPressed.clear();$('keys').textContent='2';$('win').classList.add('hidden');$('pausePanel').classList.add('hidden');$('dialog').classList.add('hidden');hint('');$('nextText')?.remove();
 for(let i=0;i<towers.length;i++){towers[i].mesh.position.x=towers[i].mesh.userData.baseX;towers[i].box.copy(bounds(towers[i].mesh));towers[i].helper.box=towers[i].box} 
 const p=CFG.start;bunny.position.set(p.x,floorAt(p.x,p.z)+.02,p.z);bunny.rotation.y=Math.PI/2;foxy.position.set(CFG.foxyUnderRamp.x,CFG.groundY,CFG.foxyUnderRamp.z);foxy.visible=false;keyMarker.visible=true;if(keyMesh)keyMesh.visible=true;lid.rotation.x=0;coins.forEach(c=>c.visible=false);camera.position.set(-15,5.3,9);camera.lookAt(bunny.position.x,1,bunny.position.z)}
function checkpointReset(msg='¡Vuelve a intentarlo desde el último punto seguro!'){const p=CFG.checkpoints[checkpoint];bunny.position.set(p.x,floorAt(p.x,p.z)+.04,p.z);vy=0;grounded=true;foxyCooldown=3;say(msg)}
function particles(at){for(let i=0;i<26;i++){const m=new THREE.Mesh(new THREE.SphereGeometry(.035,5,5),new THREE.MeshBasicMaterial({color:0xffd333}));m.position.copy(at);scene.add(m);const a=Math.random()*6.283;sparks.push({mesh:m,v:new THREE.Vector3(Math.cos(a)*2,Math.random()*2+1,Math.sin(a)*2),life:1.3})}}
function interact(){if(!active||paused)return;const nearKey=Math.hypot(bunny.position.x-CFG.key.x,bunny.position.z-CFG.key.z)<1.15&&Math.abs(bunny.position.y-1.04)<.9;
 const nearChest=Math.hypot(bunny.position.x-CFG.chest.x,bunny.position.z-CFG.chest.z)<1.35&&bunny.position.y>.5;
 if(!hasThird&&nearKey){hasThird=true;keyMarker.visible=false;if(keyMesh)keyMesh.visible=false;$('keys').textContent='3';localStorage.setItem('bunnyTreasureKeys','3');particles(new THREE.Vector3(CFG.key.x,1.5,CFG.key.z));say('¡Lo logramos! ¡Tenemos las tres llaves doradas! ¡Ahora abre el cofre!');return}
 if(hasThird&&nearChest){active=false;won=true;lid.userData.opening=true;coins.forEach(c=>c.visible=true);particles(new THREE.Vector3(CFG.chest.x,1.8,CFG.chest.z));say('¡Felicidades, Bunny! ¡Encontraste el tesoro escondido!');setTimeout(()=>{$('dialog').classList.add('hidden');$('overlay').classList.remove('hidden');$('win').classList.remove('hidden')},1800)}}
function updateTowers(dt){if(!towersActive)return;for(let i=0;i<towers.length;i++){const t=towers[i],m=t.mesh,old=t.box.getCenter(new THREE.Vector3()).x;const cycle=Math.sin(elapsed*1.25+i*.65);m.position.x=m.userData.baseX+CFG.towerMotion*cycle;m.updateMatrixWorld(true);t.box.copy(bounds(m));const dx=t.box.getCenter(new THREE.Vector3()).x-old;if(grounded&&supportTower===i)bunny.position.x+=dx}}
function updateFoxy(dt){if(foxyState===0)return;foxyTimer+=dt;foxy.visible=true;let tx=CFG.foxyUnderRamp.x,tz=CFG.foxyUnderRamp.z;
 if(foxyState===1){tx=CFG.foxyLever.x;tz=CFG.foxyLever.z;if(foxyTimer>3){foxyState=2;foxyTimer=0;towersActive=true;say('¡Cuidado! ¡Foxy está moviendo las torres!')}}
 if(foxyState===2){tx=CFG.foxyLever.x;tz=CFG.foxyLever.z}
 if(foxyState===3){tx=bunny.position.x;tz=bunny.position.z;if(bunny.position.x>6.2){foxyState=4;foxy.visible=false;return}}
 const dx=tx-foxy.position.x,dz=tz-foxy.position.z,d=Math.hypot(dx,dz);if(d>.09){const step=Math.min(d,CFG.foxySpeed*dt);moveSafe(foxy,dx/d*step,dz/d*step,foxy.position.y);foxy.rotation.y=Math.atan2(dx,dz)}foxy.position.y=floorAt(foxy.position.x,foxy.position.z);
 if(foxyState===3&&foxyCooldown<=0&&Math.hypot(foxy.position.x-bunny.position.x,foxy.position.z-bunny.position.z)<.52&&Math.abs(foxy.position.y-bunny.position.y)<.8)checkpointReset('¡Foxy te encontró! ¡Inténtalo otra vez!')}
function update(dt){elapsed+=dt;foxyCooldown=Math.max(0,foxyCooldown-dt);if(dialogUntil&&performance.now()>dialogUntil){$('dialog').classList.add('hidden');dialogUntil=0}
 if(active&&!paused){updateTowers(dt);let dx=(keysPressed.has('KeyW')||keysPressed.has('ArrowUp')?1:0)-(keysPressed.has('KeyS')||keysPressed.has('ArrowDown')?1:0),dz=(keysPressed.has('KeyD')||keysPressed.has('ArrowRight')?1:0)-(keysPressed.has('KeyA')||keysPressed.has('ArrowLeft')?1:0);const d=Math.hypot(dx,dz);if(d){dx/=d;dz/=d;bunny.rotation.y=Math.atan2(dx,dz);moveSafe(bunny,dx*CFG.speed*dt,dz*CFG.speed*dt,bunny.position.y)}
 if(keysPressed.has('Space')&&grounded){vy=CFG.jump;grounded=false;supportTower=-1}vy-=CFG.gravity*dt;const oldY=bunny.position.y;bunny.position.y+=vy*dt;
 const ground=supportAt(bunny.position.x,bunny.position.z,oldY,vy<=0?.25:.08);
 if(vy<=0&&bunny.position.y<=ground.y+.025){bunny.position.y=ground.y;vy=0;grounded=true;supportTower=ground.tower}else{grounded=false;supportTower=-1}
 if(bunny.position.y<-2.8)checkpointReset('¡Cuidado con las caídas! Regresa al último punto seguro.');
 const x=bunny.position.x;if(x>-8.2){checkpoint=Math.max(checkpoint,1);stage(1,'¡Muy bien! Baja las escaleras y dirígete hacia las tres torres.')}if(x>-5.2)stage(2,'¡Salta de una torre a otra para continuar!');if(x>-4.4&&foxyState===0){foxyState=1;foxyTimer=0;stage(3,'¡Cuidado! Foxy ha salido debajo de la rampa. ¡Va a mover las torres!')}
 if(x>1.4){checkpoint=Math.max(checkpoint,2);stage(4,'¡Excelente! Ahora baja la rampa y busca las escaleras del templo.')}if(x>2.7&&foxyState===2){foxyState=3;foxyTimer=0;stage(5,'¡Corre, Bunny! ¡Foxy viene detrás de ti!')}
 if(x>5.7){checkpoint=Math.max(checkpoint,3);if(foxyState===3){foxyState=4;foxy.visible=false}}
 const keyNear=!hasThird&&Math.hypot(x-CFG.key.x,bunny.position.z-CFG.key.z)<1.15&&bunny.position.y>.45;
 const chestNear=hasThird&&Math.hypot(x-CFG.chest.x,bunny.position.z-CFG.chest.z)<1.35&&bunny.position.y>.5;
 if(keyNear){stage(6,'¡Encontramos la última llave dorada!');hint('🗝️ Presiona E para recoger la tercera llave')}else if(chestNear){stage(7,'¡Tenemos las tres llaves! ¡Abre el cofre y descubre el tesoro!');hint('🎁 Presiona E para abrir el cofre')}else hint(x>-4.5&&x<1.5?'ESPACIO: salta entre las tres torres':'');
 updateFoxy(dt)}
 if(keyMarker?.visible){keyMarker.rotation.y+=dt*1.3;keyMarker.position.y=1.3+Math.sin(elapsed*3)*.09}
 if(lid?.userData.opening)lid.rotation.x=Math.max(-1.55,lid.rotation.x-dt*1.9);
 for(let i=sparks.length-1;i>=0;i--){const p=sparks[i];p.life-=dt;p.mesh.position.addScaledVector(p.v,dt);p.v.y-=dt*3;if(p.life<=0){scene.remove(p.mesh);p.mesh.geometry.dispose();p.mesh.material.dispose();sparks.splice(i,1)}}
 if(bunny){const target=new THREE.Vector3(bunny.position.x-4.6,bunny.position.y+3.0,bunny.position.z+7.5+camShift);camera.position.lerp(target,Math.min(1,dt*3.4));camera.lookAt(bunny.position.x+1.5,bunny.position.y+.5,bunny.position.z)}}
async function init(){try{const [world,b,f]=await Promise.all([load('assets/escenario3.glb'),load('assets/bunny.glb'),load('assets/foxy.glb')]);terrain=world;scene.add(terrain);findGeometry(terrain);for(const t of towers)t.mesh.userData.baseX=t.mesh.position.x;bunny=fitModel(b,CFG.bunnyHeight);foxy=fitModel(f,CFG.foxyHeight);scene.add(bunny,foxy);keyMarker=makeMarker();createChest();reset();$('start').disabled=false;$('start').textContent='COMENZAR NIVEL';}catch(e){console.error(e);$('menu').classList.add('hidden');$('error').classList.remove('hidden');$('errorText').textContent=e.message+' — Revisa assets/escenario3.glb, assets/bunny.glb y assets/foxy.glb. Abre el proyecto mediante Live Server o GitHub Pages.'}}
$('start').onclick=()=>{$('overlay').classList.add('hidden');$('hud').classList.remove('hidden');$('controls').classList.remove('hidden');$('debug').classList.remove('hidden');active=true;say('¡Bunny, ya casi llegamos al tesoro! Tenemos dos llaves. Baja las escaleras, cruza las tres torres y encuentra la última. ¡Cuidado con Foxy!')};
$('continue').onclick=()=>{$('dialog').classList.add('hidden');dialogUntil=0};$('resume').onclick=()=>{paused=false;$('pausePanel').classList.add('hidden')};$('restartPause').onclick=()=>{reset();active=true;say('¡Comencemos de nuevo el nivel 3!')};
$('toggleDebug').onclick=()=>{debugOn=!debugOn;debugHelpers.forEach(h=>h.visible=debugOn);$('toggleDebug').textContent=debugOn?'Ocultar colisiones':'Ver colisiones (depuración)'};
$('replay').onclick=()=>{localStorage.removeItem('bunnyTreasureKeys');window.parent.gotoLevel(1)};$('mainMenu').onclick=()=>{localStorage.removeItem('bunnyTreasureKeys');window.parent.gotoLevel(1)};
window.addEventListener('keydown',e=>{if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();keysPressed.add(e.code);if(e.code==='KeyE'&&!e.repeat)interact();if(e.code==='Escape'&&active){paused=!paused;$('pausePanel').classList.toggle('hidden',!paused);keysPressed.clear()}});
window.addEventListener('keyup',e=>keysPressed.delete(e.code));window.addEventListener('blur',()=>keysPressed.clear());window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
let drag=false,lastX=0;renderer.domElement.addEventListener('pointerdown',e=>{drag=true;lastX=e.clientX});window.addEventListener('pointerup',()=>drag=false);window.addEventListener('pointermove',e=>{if(drag){camShift=clamp(camShift+(e.clientX-lastX)*.015,-3,4);lastX=e.clientX}});
function loop(){requestAnimationFrame(loop);const dt=Math.min(clock.getDelta(),.045);if(bunny)update(dt);renderer.render(scene,camera)}init();loop();
