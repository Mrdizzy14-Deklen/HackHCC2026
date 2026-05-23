import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

scene.fog = new THREE.Fog(0x111111, 5, 25);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);

// --- INSTRUMENT ROTATIONS ---
const TRUMPET_ROT = new THREE.Euler(
  THREE.MathUtils.degToRad(15), 
  THREE.MathUtils.degToRad(-75),
  THREE.MathUtils.degToRad(0)
);

const FLUTE_ROT = new THREE.Euler(
  THREE.MathUtils.degToRad(10),
  THREE.MathUtils.degToRad(-35),
  THREE.MathUtils.degToRad(0) 
);

const VIOLIN_ROT = new THREE.Euler(
  THREE.MathUtils.degToRad(-45),
  THREE.MathUtils.degToRad(20),
  THREE.MathUtils.degToRad(10) 
);

const OBOE_ROT = new THREE.Euler(
  THREE.MathUtils.degToRad(45), 
  THREE.MathUtils.degToRad(0),
  THREE.MathUtils.degToRad(0)
);

const FRENCH_HORN_ROT = new THREE.Euler(
  THREE.MathUtils.degToRad(0),
  THREE.MathUtils.degToRad(-90), 
  THREE.MathUtils.degToRad(0)
);

const TROMBONE_ROT = new THREE.Euler(
  THREE.MathUtils.degToRad(10), 
  THREE.MathUtils.degToRad(-15),
  THREE.MathUtils.degToRad(0)
);

const DRUM_ROT = new THREE.Euler(
  THREE.MathUtils.degToRad(0),
  THREE.MathUtils.degToRad(0),
  THREE.MathUtils.degToRad(0)
);

camera.position.set(0, 3.5, 10);
camera.lookAt(0, 0.55, -2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8;

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.2));

const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.1);
fillLight.position.set(-3, 2, -2);
scene.add(fillLight);

// The 4 main washes DO cast shadows
function createStageWash(color, intensity, pos, targetPos) {
  const light = new THREE.SpotLight(color, intensity);
  light.position.set(pos.x, pos.y, pos.z);
  
  light.angle = Math.PI / 7;
  light.penumbra = 0.3;
  light.decay = 1.5;
  light.distance = 30;

  light.castShadow = true;
  light.shadow.mapSize.width = 1024;
  light.shadow.mapSize.height = 1024;
  light.shadow.camera.near = 1;
  light.shadow.camera.far = 30;

  const target = new THREE.Object3D();
  target.position.set(targetPos.x, targetPos.y, targetPos.z);
  scene.add(target);
  light.target = target;

  scene.add(light);
  return light;
}

createStageWash(0xffe5b4, 40, { x: 0, y: 8, z: 5 }, { x: 0, y: 0, z: -2 });
createStageWash(0x87ceeb, 25, { x: 0, y: 8, z: -8 }, { x: 0, y: 0, z: 0 });
createStageWash(0xffb6c1, 15, { x: -8, y: 5, z: 0 }, { x: -3, y: 0, z: -2 });
createStageWash(0x00ffff, 15, { x: 8, y: 5, z: 0 }, { x: 3, y: 0, z: -2 });

const VIEWER = new THREE.Vector3(0, 1, 4);

const ORCHESTRA_TIERS = [
  { zMin: -1.0, zMax: 0.9, y: 0.0 },
  { zMin: -2.6, zMax: -1.0, y: 0.24 },
  { zMin: -4.2, zMax: -2.6, y: 0.48 },
  { zMin: -6.5, zMax: -4.2, y: 0.72 },
];
const PLATFORM_THICKNESS = 0.1;

function getTierY(z) {
  for (const tier of ORCHESTRA_TIERS) {
    if (z <= tier.zMax && z > tier.zMin) return tier.y;
  }
  if (z > ORCHESTRA_TIERS[0].zMax) return ORCHESTRA_TIERS[0].y;
  return ORCHESTRA_TIERS[ORCHESTRA_TIERS.length - 1].y;
}

function buildOrchestraRisers() {
  const group = new THREE.Group();
  const stageW = 10;
  
  const wood = new THREE.MeshStandardMaterial({ color: 0x2d241c, roughness: 0.82, metalness: 0.04 });
  const lipMat = new THREE.MeshStandardMaterial({ color: 0x1a130c, roughness: 0.9, metalness: 0.02 });
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x0f0a06, roughness: 0.95 });

  for (const tier of ORCHESTRA_TIERS) {
    const depth = tier.zMax - tier.zMin;
    const centerZ = (tier.zMax + tier.zMin) / 2;
    const topY = tier.y + PLATFORM_THICKNESS / 2;

    const deck = new THREE.Mesh(new THREE.BoxGeometry(stageW, PLATFORM_THICKNESS, depth), wood);
    deck.position.set(0, topY, centerZ);
    deck.castShadow = true; 
    deck.receiveShadow = true; 
    group.add(deck);

    const lip = new THREE.Mesh(new THREE.BoxGeometry(stageW, 0.14, 0.08), lipMat);
    lip.position.set(0, tier.y + 0.05, tier.zMax + 0.02);
    lip.castShadow = true; 
    lip.receiveShadow = true; 
    group.add(lip);

    if (tier.y > 0) {
      const rise = tier.y;
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(stageW, rise, 0.12), skirtMat);
      skirt.position.set(0, rise / 2, tier.zMax + 0.06);
      skirt.castShadow = true; 
      skirt.receiveShadow = true; 
      group.add(skirt);
    }
  }

  for (const side of [-1, 1]) {
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 5.5), skirtMat);
    ramp.position.set(side * (stageW / 2 - 0.2), 0.25, -2.5);
    ramp.rotation.y = side * 0.08;
    ramp.receiveShadow = true; 
    group.add(ramp);
  }

  scene.add(group);
  return group;
}

buildOrchestraRisers();

// --- Pre-spawn logic for performance ---
function createInstrumentSpotlight(x, y, z) {
  const instrumentY = getTierY(z) + (PLATFORM_THICKNESS / 2) + y;
  const light = new THREE.SpotLight(0xffffff, 0); // Intensity 0 (Off by default)
  light.position.set(x, instrumentY + 4, z + 1);
  light.angle = Math.PI / 8;
  light.penumbra = 0.5;
  light.decay = 2;
  light.distance = 15;
  
  light.castShadow = false; 

  const target = new THREE.Object3D();
  target.position.set(x, instrumentY, z);
  scene.add(target);
  light.target = target;
  
  scene.add(light);
  return light;
}

function initSlotsWithLights(coords) {
  return coords.map(pos => ({
    pos: pos,
    light: createInstrumentSpotlight(pos[0], pos[1], pos[2])
  }));
}

const BELL_FIX = new THREE.Euler(0, -Math.PI / 2, 0);
const instruments = [];

function placeInstrument(
  model, x, y, z, yawDeg = 0, modelRotation = BELL_FIX, sizeTarget = 1.2, spotLight = null
) {
  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) child.material.depthWrite = true;
    }
  });

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = sizeTarget / Math.max(size.x, size.y, size.z);
  model.scale.setScalar(scale);
  model.position.sub(center.multiplyScalar(scale));
  model.rotation.copy(modelRotation);

  const inner = new THREE.Group();
  inner.add(model);
  const baseYaw = THREE.MathUtils.degToRad(yawDeg);
  inner.rotation.y = baseYaw;

  const outer = new THREE.Group();
  outer.add(inner);
  
  const instrumentY = getTierY(z) + (PLATFORM_THICKNESS / 2) + y;
  outer.position.set(x, instrumentY, z);
  
  scene.add(outer);

  if (spotLight) {
    spotLight.target = outer;
    spotLight.intensity = 200; // Super bright
  }

  instruments.push({ outer, inner, baseYaw, targetYaw: baseYaw, currentYaw: baseYaw });
  return outer;
}

const loader = new GLTFLoader();

function precompile(model) {
  scene.add(model);
  renderer.compile(scene, camera);
  scene.remove(model);
}

// --- VIOLINS (Tier 0 & 1 Left) ---
const VIOLIN_SLOTS = initSlotsWithLights([
  [-1.5, 0.6, 0.2], [-3.0, 0.6, 0.2], [-4.5, 0.6, 0.2], 
  [-2.0, 0.8, -1.8], [-3.5, 0.8, -1.8]                  
]);
const violinCache = { scene: null, count: 0, pending: 0 };
function addViolin() {
  if (violinCache.count + violinCache.pending >= VIOLIN_SLOTS.length) return;
  if (!violinCache.scene) { violinCache.pending++; return; }
  const slot = VIOLIN_SLOTS[violinCache.count];
  placeInstrument(violinCache.scene.clone(true), slot.pos[0], slot.pos[1], slot.pos[2], 30, VIOLIN_ROT, 1.2, slot.light);
  violinCache.count++;
}
// FIXED PATH HERE
loader.load("/static/violon_high/scene.gltf", (gltf) => {
  violinCache.scene = gltf.scene;
  precompile(gltf.scene.clone(true));
  while (violinCache.pending > 0 && violinCache.count < VIOLIN_SLOTS.length) { violinCache.pending--; addViolin(); }
}, undefined, (err) => console.error("violon load failed", err));


// --- FLUTES (Tier 0 Right) ---
const FLUTE_SLOTS = initSlotsWithLights([
  [1.5, 0.4, 0.2], [3.0, 0.4, 0.2], [4.5, 0.4, 0.2] 
]);
const fluteCache = { scene: null, count: 0, pending: 0 };
function addFlute() {
  if (fluteCache.count + fluteCache.pending >= FLUTE_SLOTS.length) return;
  if (!fluteCache.scene) { fluteCache.pending++; return; }
  const slot = FLUTE_SLOTS[fluteCache.count];
  placeInstrument(fluteCache.scene.clone(true), slot.pos[0], slot.pos[1], slot.pos[2], -30, FLUTE_ROT, 1.2, slot.light);
  fluteCache.count++;
}
loader.load("/static/basic_flute/scene.gltf", (gltf) => {
  fluteCache.scene = gltf.scene;
  precompile(gltf.scene.clone(true));
  while (fluteCache.pending > 0 && fluteCache.count < FLUTE_SLOTS.length) { fluteCache.pending--; addFlute(); }
}, undefined, (err) => console.error("flute load failed", err));


// --- OBOES (Tier 1 Right) ---
const OBOE_SLOTS = initSlotsWithLights([
  [2.0, 0.4, -1.8], [3.5, 0.4, -1.8] 
]);
const oboeCache = { scene: null, count: 0, pending: 0 };
function addOboe() {
  if (oboeCache.count + oboeCache.pending >= OBOE_SLOTS.length) return;
  if (!oboeCache.scene) { oboeCache.pending++; return; }
  const slot = OBOE_SLOTS[oboeCache.count];
  placeInstrument(oboeCache.scene.clone(true), slot.pos[0], slot.pos[1], slot.pos[2], -20, OBOE_ROT, 1.2, slot.light);
  oboeCache.count++;
}
loader.load("/static/oboe/scene.gltf", (gltf) => {
  oboeCache.scene = gltf.scene;
  while (oboeCache.pending > 0 && oboeCache.count < OBOE_SLOTS.length) { oboeCache.pending--; addOboe(); }
}, undefined, (err) => console.error("oboe load failed", err));


// --- FRENCH HORNS (Tier 2 Left) ---
const HORN_SLOTS = initSlotsWithLights([
  [-1.5, 0.4, -3.4], [-3.0, 0.4, -3.4], [-4.5, 0.4, -3.4] 
]);
const hornCache = { scene: null, count: 0, pending: 0 };
function addFrenchHorn() {
  if (hornCache.count + hornCache.pending >= HORN_SLOTS.length) return;
  if (!hornCache.scene) { hornCache.pending++; return; }
  const slot = HORN_SLOTS[hornCache.count];
  placeInstrument(hornCache.scene.clone(true), slot.pos[0], slot.pos[1], slot.pos[2], 25, FRENCH_HORN_ROT, 1.2, slot.light);
  hornCache.count++;
}
loader.load("/static/french_horn/scene.gltf", (gltf) => {
  hornCache.scene = gltf.scene;
  while (hornCache.pending > 0 && hornCache.count < HORN_SLOTS.length) { hornCache.pending--; addFrenchHorn(); }
}, undefined, (err) => console.error("french horn load failed", err));


// --- TRUMPETS (Tier 2 Right) ---
const TRUMPET_SLOTS = initSlotsWithLights([
  [1.5, 0.4, -3.4], [3.0, 0.4, -3.4], [4.5, 0.4, -3.4] 
]);
const trumpetCache = { scene: null, count: 0, pending: 0 };
function addTrumpet() {
  if (trumpetCache.count + trumpetCache.pending >= TRUMPET_SLOTS.length) return;
  if (!trumpetCache.scene) { trumpetCache.pending++; return; }
  const slot = TRUMPET_SLOTS[trumpetCache.count];
  placeInstrument(trumpetCache.scene.clone(true), slot.pos[0], slot.pos[1], slot.pos[2], -25, TRUMPET_ROT, 1.2, slot.light);
  trumpetCache.count++;
}
loader.load("/static/trumpet/scene.gltf", (gltf) => {
  trumpetCache.scene = gltf.scene;
  precompile(gltf.scene.clone(true));
  while (trumpetCache.pending > 0 && trumpetCache.count < TRUMPET_SLOTS.length) { trumpetCache.pending--; addTrumpet(); }
}, undefined, (err) => console.error("trumpet load failed", err));


// --- TROMBONES (Tier 3 Flanking Piano) ---
const TROMBONE_SLOTS = initSlotsWithLights([
  [-2.0, 0.4, -5.0], [-3.5, 0.4, -5.0], 
  [2.0, 0.4, -5.0], [3.5, 0.4, -5.0]    
]);
const tromboneCache = { scene: null, count: 0, pending: 0 };
function addTrombone() {
  if (tromboneCache.count + tromboneCache.pending >= TROMBONE_SLOTS.length) return;
  if (!tromboneCache.scene) { tromboneCache.pending++; return; }
  const slot = TROMBONE_SLOTS[tromboneCache.count];
  const yaw = slot.pos[0] < 0 ? 15 : -15; 
  placeInstrument(tromboneCache.scene.clone(true), slot.pos[0], slot.pos[1], slot.pos[2], yaw, TROMBONE_ROT, 1.2, slot.light);
  tromboneCache.count++;
}
loader.load("/static/trombone/scene.gltf", (gltf) => {
  tromboneCache.scene = gltf.scene;
  while (tromboneCache.pending > 0 && tromboneCache.count < TROMBONE_SLOTS.length) { tromboneCache.pending--; addTrombone(); }
}, undefined, (err) => console.error("trombone load failed", err));

// --- DRUMS (Tier 3 Far Edges) ---
const DRUM_SLOTS = initSlotsWithLights([
  [-4.0, 1, -4.5], [4.0, 1, -4.5]
]);
const drumCache = { scene: null, count: 0, pending: 0 };
function addDrum() {
  if (drumCache.count + drumCache.pending >= DRUM_SLOTS.length) return;
  if (!drumCache.scene) { drumCache.pending++; return; }
  const slot = DRUM_SLOTS[drumCache.count];
  placeInstrument(drumCache.scene.clone(true), slot.pos[0], slot.pos[1], slot.pos[2], 0, DRUM_ROT, 1.5, slot.light);
  drumCache.count++;
}
loader.load("/static/timpani_drum/scene.gltf", (gltf) => {
  drumCache.scene = gltf.scene;
  precompile(gltf.scene.clone(true));
  while (drumCache.pending > 0 && drumCache.count < DRUM_SLOTS.length) { drumCache.pending--; addDrum(); }
}, undefined, (err) => console.error("drum load failed", err));

// --- PIANO (Tier 3 Center) ---
const PIANO_ROT = new THREE.Euler(0, 0, 0);
const pianoLight = createInstrumentSpotlight(0, 0.8, -4.5); 
const pianoCache = { scene: null, placed: false, pending: false };

function addPiano() {
  if (pianoCache.placed) return;
  if (!pianoCache.scene) { pianoCache.pending = true; return; }
  placeInstrument(pianoCache.scene.clone(true), 0, 0.8, -4.5, 5, PIANO_ROT, 2.0, pianoLight);
  pianoCache.placed = true;
}
loader.load("/static/yamaha_m1a_piano/scene.gltf", (gltf) => {
  pianoCache.scene = gltf.scene;
  precompile(gltf.scene.clone(true));
  if (pianoCache.pending) { pianoCache.pending = false; addPiano(); }
}, undefined, (err) => console.error("piano load failed", err));


// --- EVENT LISTENER ---
window.addEventListener("instrument:add", (e) => {
  const kind = (e.detail?.kind ?? "trumpet").toLowerCase();
  if (kind === "trumpet") addTrumpet();
  else if (kind === "piano") addPiano();
  else if (kind === "flute") addFlute();
  else if (kind === "violin") addViolin();
  else if (kind === "obo soprano" || kind === "oboe") addOboe();
  else if (kind === "french horn" || kind === "french_horn") addFrenchHorn();
  else if (kind === "trombone") addTrombone();
  else if (kind === "drum") addDrum();
});

const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();

window.addEventListener("mousemove", (e) => {
  mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouseNDC, camera);
  const hits = raycaster.intersectObjects(instruments.map((i) => i.outer), true);

  let hovered = null;
  if (hits.length) {
    let obj = hits[0].object;
    while (obj && !instruments.find((i) => i.outer === obj)) obj = obj.parent;
    hovered = instruments.find((i) => i.outer === obj) || null;
  }
  const HOVER_SWING = THREE.MathUtils.degToRad(10);
  for (const inst of instruments) {
    inst.targetYaw = inst === hovered
      ? inst.baseYaw - Math.sign(inst.baseYaw || 1) * HOVER_SWING
      : inst.baseYaw;
  }
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  for (const inst of instruments) {
    inst.currentYaw += (inst.targetYaw - inst.currentYaw) * 0.06;
    inst.inner.rotation.y = inst.currentYaw;
  }
  renderer.render(scene, camera);
}
animate();

fetch("/api/ping").catch((err) => console.error("ping failed", err));