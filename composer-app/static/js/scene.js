import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x09080c);  // deep cinematic dark

scene.fog = new THREE.FogExp2(0x09080c, 0.045);

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

scene.add(new THREE.AmbientLight(0xfff5e0, 0.7));

const keyLight = new THREE.DirectionalLight(0xfff0c8, 2.5);
keyLight.position.set(3, 6, 4);
keyLight.castShadow = true;
keyLight.shadow.mapSize.width  = 2048;
keyLight.shadow.mapSize.height = 2048;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x8090ff, 0.25);
fillLight.position.set(-4, 3, -3);
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

createStageWash(0xffa040, 90,  { x: 0,  y: 10, z: 6  }, { x: 0,  y: 0, z: -2 });
createStageWash(0xff4090, 35,  { x: -9, y: 6,  z: 0  }, { x: -3, y: 0, z: -2 });
createStageWash(0x00c8ff, 35,  { x: 9,  y: 6,  z: 0  }, { x: 3,  y: 0, z: -2 });

// Warm footlights — low-angle from pit edge for dramatic uplighting
function createFootlight(x) {
  const fl = new THREE.SpotLight(0xffd580, 60);
  fl.position.set(x, 0.4, 3.5);
  fl.angle   = Math.PI / 5;
  fl.penumbra = 0.6;
  fl.decay   = 1.8;
  fl.distance = 14;
  const ft = new THREE.Object3D();
  ft.position.set(x * 0.4, 0, -1);
  scene.add(ft);
  fl.target = ft;
  scene.add(fl);
}
createFootlight(-3);
createFootlight(3);

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

// Reflective stage floor — shows colored wash reflections
(function addFloor() {
  const geo = new THREE.PlaneGeometry(14, 14);
  const mat = new THREE.MeshStandardMaterial({ color: 0x0c0a0f, roughness: 0.08, metalness: 0.45 });
  const floor = new THREE.Mesh(geo, mat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.05, -3);
  floor.receiveShadow = true;
  scene.add(floor);
})();

// ── Dynamic lights ────────────────────────────────────────────────────────
let _curtainsOpen   = false;
const _revealLights = [];

const _hoverLight = new THREE.PointLight(0xff9040, 0, 4);
_hoverLight.decay = 2;
scene.add(_hoverLight);

const _scanLight = new THREE.SpotLight(0xc8aaff, 80);
_scanLight.position.set(0, 9, 2);
_scanLight.angle    = Math.PI / 14;
_scanLight.penumbra = 0.4;
_scanLight.decay    = 1.8;
_scanLight.distance = 18;
const _scanTarget = new THREE.Object3D();
_scanTarget.position.set(0, 0, -3);
scene.add(_scanTarget);
_scanLight.target = _scanTarget;
scene.add(_scanLight);
let _scanPhase = 0;

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
const instruments  = [];
const _kindLights  = {};   // kind → [SpotLight, ...] for conduct volume visuals

window.addEventListener("conduct:volume", (e) => {
  const lights = _kindLights[e.detail.kind] ?? [];
  for (const l of lights) l.intensity = e.detail.volume * 200;
});

function placeInstrument(
  model, x, y, z, yawDeg = 0, modelRotation = BELL_FIX, sizeTarget = 1.2, spotLight = null, kind = null
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
    spotLight.intensity = _curtainsOpen ? 200 : 0;
    _revealLights.push(spotLight);
  }

  instruments.push({ outer, inner, baseYaw, targetYaw: baseYaw, currentYaw: baseYaw, kind });
  if (kind && spotLight) {
    if (!_kindLights[kind]) _kindLights[kind] = [];
    _kindLights[kind].push(spotLight);
  }
  return outer;
}

const loader = new GLTFLoader();

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
  placeInstrument(violinCache.scene.clone(true), slot.pos[0], slot.pos[1], slot.pos[2], 30, VIOLIN_ROT, 1.2, slot.light, "violin");
  violinCache.count++;
}
loader.load("/static/violon_high/scene.gltf", (gltf) => {
  violinCache.scene = gltf.scene;
  while (violinCache.count < VIOLIN_SLOTS.length) addViolin();
}, undefined, (err) => console.error("violin load failed", err));


// --- FLUTES (Tier 0 Right) ---
const FLUTE_SLOTS = initSlotsWithLights([
  [1.5, 0.4, 0.2], [3.0, 0.4, 0.2], [4.5, 0.4, 0.2] 
]);
const fluteCache = { scene: null, count: 0, pending: 0 };
function addFlute() {
  if (fluteCache.count + fluteCache.pending >= FLUTE_SLOTS.length) return;
  if (!fluteCache.scene) { fluteCache.pending++; return; }
  const slot = FLUTE_SLOTS[fluteCache.count];
  placeInstrument(fluteCache.scene.clone(true), slot.pos[0], slot.pos[1], slot.pos[2], -30, FLUTE_ROT, 1.2, slot.light, "flute");
  fluteCache.count++;
}
loader.load("/static/basic_flute/scene.gltf", (gltf) => {
  fluteCache.scene = gltf.scene;
  while (fluteCache.count < FLUTE_SLOTS.length) addFlute();
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
}, undefined, () => { /* oboe model not included */ });


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
}, undefined, () => { /* french horn model not included */ });


// --- TRUMPETS (Tier 2 Right) ---
const TRUMPET_SLOTS = initSlotsWithLights([
  [1.5, 0.4, -3.4], [3.0, 0.4, -3.4], [4.5, 0.4, -3.4] 
]);
const trumpetCache = { scene: null, count: 0, pending: 0 };
function addTrumpet() {
  if (trumpetCache.count + trumpetCache.pending >= TRUMPET_SLOTS.length) return;
  if (!trumpetCache.scene) { trumpetCache.pending++; return; }
  const slot = TRUMPET_SLOTS[trumpetCache.count];
  placeInstrument(trumpetCache.scene.clone(true), slot.pos[0], slot.pos[1], slot.pos[2], -25, TRUMPET_ROT, 1.2, slot.light, "trumpet");
  trumpetCache.count++;
}
loader.load("/static/trumpet/scene.gltf", (gltf) => {
  trumpetCache.scene = gltf.scene;
  while (trumpetCache.count < TRUMPET_SLOTS.length) addTrumpet();
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
}, undefined, () => { /* trombone model not included */ });

// --- DRUMS (Tier 3 Far Edges) ---
const DRUM_SLOTS = initSlotsWithLights([
  [-4.0, 1, -4.5], [4.0, 1, -4.5]
]);
const drumCache = { scene: null, count: 0, pending: 0 };
function addDrum() {
  if (drumCache.count + drumCache.pending >= DRUM_SLOTS.length) return;
  if (!drumCache.scene) { drumCache.pending++; return; }
  const slot = DRUM_SLOTS[drumCache.count];
  placeInstrument(drumCache.scene.clone(true), slot.pos[0], slot.pos[1], slot.pos[2], 0, DRUM_ROT, 1.5, slot.light, "drums");
  drumCache.count++;
}
loader.load("/static/timpani_drum/scene.gltf", (gltf) => {
  drumCache.scene = gltf.scene;
  while (drumCache.count < DRUM_SLOTS.length) addDrum();
}, undefined, (err) => console.error("drum load failed", err));

// --- PIANO (Tier 3 Center) ---
const PIANO_ROT = new THREE.Euler(0, 0, 0);
const pianoLight = createInstrumentSpotlight(0, 0.8, -4.5); 
const pianoCache = { scene: null, placed: false, pending: false };

function addPiano() {
  if (pianoCache.placed) return;
  if (!pianoCache.scene) { pianoCache.pending = true; return; }
  placeInstrument(pianoCache.scene.clone(true), 0, 0.8, -4.5, 5, PIANO_ROT, 2.0, pianoLight, "piano");
  pianoCache.placed = true;
}
loader.load("/static/yamaha_m1a_piano/scene.gltf", (gltf) => {
  pianoCache.scene = gltf.scene;
  addPiano(); // auto-place on load (also drains pending flag)
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
  else if (kind === "drum" || kind === "drums") addDrum();
});

const raycaster = new THREE.Raycaster();
const _cursorNDC = new THREE.Vector2();
let _gestureHovered = null;

function applyHover(ndcX, ndcY) {
  _cursorNDC.set(ndcX, ndcY);
  raycaster.setFromCamera(_cursorNDC, camera);
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
  return hovered;
}

// Mouse hover (fallback / desktop)
window.addEventListener("mousemove", (e) => {
  applyHover(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1,
  );
});

// Click → yellow emissive glow on the hit instrument
const _clickGlows = new Map(); // inst → { meshes, t }
window.addEventListener("click", (e) => {
  const ndcX = (e.clientX / window.innerWidth) * 2 - 1;
  const ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
  _cursorNDC.set(ndcX, ndcY);
  raycaster.setFromCamera(_cursorNDC, camera);
  const hits = raycaster.intersectObjects(instruments.map((i) => i.outer), true);
  if (!hits.length) return;
  let obj = hits[0].object;
  while (obj && !instruments.find((i) => i.outer === obj)) obj = obj.parent;
  const inst = instruments.find((i) => i.outer === obj);
  if (!inst) return;

  // collect all meshes in this instrument
  const meshes = [];
  inst.outer.traverse((child) => { if (child.isMesh) meshes.push(child); });
  _clickGlows.set(inst, { meshes, t: 1.0 });
});

// Gesture: pointing finger drives the raycaster in real-time
window.addEventListener("gesture:point", (e) => {
  _gestureHovered = applyHover(e.detail.x, e.detail.y);
  if (_gestureHovered?.kind) {
    window.dispatchEvent(new CustomEvent("instrument:hover", {
      detail: { kind: _gestureHovered.kind, y: e.detail.y },
    }));
  }
});

// Gesture: dwell-select confirms whichever instrument the finger is resting on
window.addEventListener("gesture:dwell-select", () => {
  if (_gestureHovered?.kind) {
    window.dispatchEvent(
      new CustomEvent("instrument:gesture-selected", { detail: { kind: _gestureHovered.kind } }),
    );
  }
});

// Shared helper — opens curtains from any source
function openCurtains() {
  if (_curtainsOpen) return;
  _curtainsOpen = true;
  document.querySelectorAll(".curtain").forEach((c) => c.classList.add("open"));
  const hint = document.getElementById("gesture-hint");
  if (hint) {
    hint.classList.add("hidden");
    setTimeout(() => hint.remove(), 1500);
  }
  // Staggered spotlight reveal — one instrument light every 120 ms, starting 400 ms after open
  _revealLights.forEach((light, i) => {
    setTimeout(() => {
      let t = 0;
      const step = () => {
        t = Math.min(t + 0.05, 1);
        light.intensity = t * 200;
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, 400 + i * 120);
  });
}

// Gesture: curtains sweep open
window.addEventListener("gesture:curtain-open", openCurtains);

// Fallback: click the hint overlay
document.getElementById("gesture-hint")?.addEventListener("click", openCurtains);

// Fallback: Space bar
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "Enter") openCurtains();
});

// Fallback: auto-open after 5 s so the stage is never permanently hidden
setTimeout(openCurtains, 5000);

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

  // Click glow — soft gold emissive that fades over ~1.5 s
  for (const [inst, state] of _clickGlows) {
    state.t -= 0.012; // ~1.4 s fade at 60 fps
    if (state.t <= 0) {
      for (const m of state.meshes) {
        if (m.material.emissive) { m.material.emissive.set(0x000000); m.material.emissiveIntensity = 0; }
      }
      _clickGlows.delete(inst);
    } else {
      const strength = state.t * 0.35; // peak emissiveIntensity = 0.35, never blinding
      for (const m of state.meshes) {
        if (!m.material.emissive) continue;
        m.material.emissive.set(0xd4a800); // warm gold, not pure yellow
        m.material.emissiveIntensity = strength;
      }
    }
  }

  // Hover glow follows the instrument under the finger
  if (_gestureHovered) {
    const wp = new THREE.Vector3();
    _gestureHovered.outer.getWorldPosition(wp);
    _hoverLight.position.lerp(new THREE.Vector3(wp.x, wp.y + 1.2, wp.z + 0.5), 0.1);
    _hoverLight.intensity += (3.5 - _hoverLight.intensity) * 0.08;
  } else {
    _hoverLight.intensity *= 0.9;
  }

  // Scan light slowly sweeps the stage after curtains open
  if (_curtainsOpen) {
    _scanPhase += 0.003;
    _scanTarget.position.x = Math.sin(_scanPhase) * 4.5;
    _scanTarget.position.z = -3 + Math.cos(_scanPhase * 0.7) * 1.5;
  }

  renderer.render(scene, camera);
}
animate();


fetch("/api/ping").catch((err) => console.error("ping failed", err));