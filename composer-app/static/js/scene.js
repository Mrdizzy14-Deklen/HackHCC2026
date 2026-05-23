import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0208);  // deep crimson dark

scene.fog = new THREE.FogExp2(0x0a0208, 0.038);

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

const NOTE_TEXTURE_CACHE = new Map();
const ACTIVE_NOTE_SPRITES = [];
const NOTE_SPRITE_POOL = [];   // reused sprite objects
const NOTE_TRACK_COLORS = {
  trumpet: 0xffd166,
  violin:   0x8fd8ff,
  piano:    0xffd1ff,
  drums:    0xffb8a8,
  default:  0xffffff,
};
const NOTE_LIFETIME_MS = 1600;
const NOTE_EMIT_OFFSET = new THREE.Vector3(0, 1.15, 0.25);
const NOTE_ICON_PATH = "/static/pngtree-neon-music-note-icon-png-image_20002866.png";
let notePlaybackQueue = [];
let noteLastFrame = performance.now();
const instrumentRefs = new Map();

let _floorMesh = null;
let _beatDecay = 0;
let _cameraShake = 0;
let _floorPulse = 0;
let _beatInterval = null;
let _notePlaybackList = [];
let _noteLoopTimer = null;

function getInstrumentWorldPosition(kind) {
  const ref = instrumentRefs.get(kind);
  if (!ref) {
    return new THREE.Vector3(0, 1.0, -3.0);
  }
  const pos = new THREE.Vector3();
  ref.getWorldPosition(pos);
  return pos;
}

function prewarmNoteTextures() {
  if (NOTE_TEXTURE_CACHE.has("icon")) return;

  const texture = new THREE.TextureLoader().load(NOTE_ICON_PATH);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  NOTE_TEXTURE_CACHE.set("icon", texture);
}

function _acquireSprite(trackId) {
  if (NOTE_SPRITE_POOL.length > 0) {
    const s = NOTE_SPRITE_POOL.pop();
    s.material.opacity = 1;
    s.material.color.setHex(NOTE_TRACK_COLORS[trackId] ?? NOTE_TRACK_COLORS.default);
    return s;
  }
  return new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: NOTE_TEXTURE_CACHE.get("icon"),
      transparent: true,
      opacity: 1,
      depthWrite: false,
      color: NOTE_TRACK_COLORS[trackId] ?? NOTE_TRACK_COLORS.default,
    }),
  );
}

function _releaseSprite(sprite) {
  scene.remove(sprite);
  NOTE_SPRITE_POOL.push(sprite);
}

function spawnNote(trackId) {
  if (!NOTE_TEXTURE_CACHE.has("icon")) prewarmNoteTextures();

  const sprite = _acquireSprite(trackId);
  const worldPos = getInstrumentWorldPosition(trackId);
  sprite.position.copy(worldPos.clone().add(NOTE_EMIT_OFFSET));
  sprite.scale.set(0.65, 0.65, 1);
  sprite.userData = {
    bornAt: performance.now(),
    driftX: (Math.random() - 0.5) * 0.22,
    driftZ: (Math.random() - 0.5) * 0.22,
  };
  scene.add(sprite);
  ACTIVE_NOTE_SPRITES.push(sprite);
}

function _onBeat(strong) {
  const mult = strong ? 1.5 : 1.0;
  _beatDecay = mult;
  _cameraShake = strong ? 0.06 : 0.03;
  _floorPulse = strong ? 1.0 : 0.65;
  for (const inst of instruments) {
    inst.outer.userData.beatBob = strong ? 0.22 : 0.12;
  }
}

prewarmNoteTextures();
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

createStageWash(0xffa040, 90,  { x: 0,  y: 10, z: 6  }, { x: 0,  y: 1.2, z: -2 });
createStageWash(0xff4090, 35,  { x: -9, y: 6,  z: 0  }, { x: -3, y: 1.2, z: -2 });
createStageWash(0x00c8ff, 35,  { x: 9,  y: 6,  z: 0  }, { x: 3,  y: 1.2, z: -2 });

// Warm footlights — low-angle from pit edge for dramatic uplighting
function createFootlight(x) {
  const fl = new THREE.SpotLight(0xffd580, 60);
  fl.position.set(x, 2.2, 3.5);
  fl.angle   = Math.PI / 5;
  fl.penumbra = 0.6;
  fl.decay   = 1.8;
  fl.distance = 14;
  const ft = new THREE.Object3D();
  ft.position.set(x * 0.4, 1.2, -1);
  scene.add(ft);
  fl.target = ft;
  scene.add(fl);
}
createFootlight(-3);
createFootlight(3);

const VIEWER = new THREE.Vector3(0, 1, 4);

const ORCHESTRA_TIERS = [
  { zMin: -1.0, zMax: 2.4, y: 0.0 },   // extended to cover crescent front
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

// Builds curved crescent-shaped tier platforms using ExtrudeGeometry.
// After rotation.x = -π/2: shape XY → world XZ (Y negated), extrusion → world +Y.
function buildCrescentRisers() {
  const CURVE = 0.075;
  const xL = -6.2, xR = 6.2;
  const SEGS = 32;
  const T = PLATFORM_THICKNESS;

  const woodMat  = new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 0.80, metalness: 0.04 });
  const lipMat   = new THREE.MeshStandardMaterial({ color: 0x1a130c, roughness: 0.92, metalness: 0.02 });
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x110c06, roughness: 0.97 });

  function arcShape(zBack, zFront) {
    const s = new THREE.Shape();
    for (let i = 0; i <= SEGS; i++) {
      const x = xL + (xR - xL) * (i / SEGS);
      const sy = -(zFront + x * x * CURVE);    // shape Y = -worldZ
      i === 0 ? s.moveTo(x, sy) : s.lineTo(x, sy);
    }
    for (let i = SEGS; i >= 0; i--) {
      const x = xL + (xR - xL) * (i / SEGS);
      s.lineTo(x, -(zBack + x * x * CURVE));
    }
    s.closePath();
    return s;
  }

  for (const tier of ORCHESTRA_TIERS) {
    // Deck
    const deck = new THREE.Mesh(
      new THREE.ExtrudeGeometry(arcShape(tier.zMin, tier.zMax), { depth: T, bevelEnabled: false }),
      woodMat
    );
    deck.rotation.x = -Math.PI / 2;
    deck.position.y  = tier.y - T / 2;
    deck.castShadow = true; deck.receiveShadow = true;
    scene.add(deck);

    // Front lip (thin curved trim at the front edge of each tier)
    const lipS = new THREE.Shape();
    for (let i = 0; i <= SEGS; i++) {
      const x = xL + (xR - xL) * (i / SEGS);
      const sy = -(tier.zMax + x * x * CURVE);
      i === 0 ? lipS.moveTo(x, sy) : lipS.lineTo(x, sy);
    }
    for (let i = SEGS; i >= 0; i--) {
      const x = xL + (xR - xL) * (i / SEGS);
      lipS.lineTo(x, -(tier.zMax + x * x * CURVE) + 0.09);
    }
    lipS.closePath();
    const lip = new THREE.Mesh(
      new THREE.ExtrudeGeometry(lipS, { depth: 0.16, bevelEnabled: false }),
      lipMat
    );
    lip.rotation.x = -Math.PI / 2;
    lip.position.y  = tier.y - 0.16;
    lip.receiveShadow = true;
    scene.add(lip);

    // Vertical skirt face at the front of raised tiers
    if (tier.y > 0) {
      const skirtS = new THREE.Shape();
      for (let i = 0; i <= SEGS; i++) {
        const x = xL + (xR - xL) * (i / SEGS);
        const sy = -(tier.zMax + x * x * CURVE);
        i === 0 ? skirtS.moveTo(x, sy) : skirtS.lineTo(x, sy);
      }
      for (let i = SEGS; i >= 0; i--) {
        const x = xL + (xR - xL) * (i / SEGS);
        skirtS.lineTo(x, -(tier.zMax + x * x * CURVE) + 0.11);
      }
      skirtS.closePath();
      const skirt = new THREE.Mesh(
        new THREE.ExtrudeGeometry(skirtS, { depth: tier.y, bevelEnabled: false }),
        skirtMat
      );
      skirt.rotation.x = -Math.PI / 2;
      skirt.position.y  = -tier.y;
      skirt.receiveShadow = true;
      scene.add(skirt);
    }
  }
}

buildCrescentRisers();

// Wood stage floor
(function addFloor() {
  const geo = new THREE.PlaneGeometry(24, 22);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x4a2e0e,
    roughness: 0.80,
    metalness: 0.03,
    emissive: 0x180a03,
    emissiveIntensity: 0.18,
  });
  _floorMesh = new THREE.Mesh(geo, mat);
  const floor = _floorMesh;
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.05, -1);
  floor.receiveShadow = true;
  scene.add(floor);

  // Plank lines for wood grain feel
  const plankMat = new THREE.MeshStandardMaterial({ color: 0x2e1a07, roughness: 0.9, metalness: 0.0 });
  for (let i = -6; i <= 6; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(24, 0.008, 0.025), plankMat);
    plank.position.set(0, -0.04, i * 1.75 - 1);
    scene.add(plank);
  }
})();

// Red velvet curtain backdrop
function buildCurtainBackdrop() {
  const group = new THREE.Group();
  const totalWidth = 26;
  const height = 15;
  const numFolds = 22;
  const foldW = totalWidth / numFolds;
  const backZ = -8.8;

  const frontMat = new THREE.MeshStandardMaterial({
    color: 0x7a0c18, roughness: 0.97, metalness: 0.0,
    emissive: 0x2a0206, emissiveIntensity: 0.35,
    side: THREE.FrontSide,
  });
  const foldMat = new THREE.MeshStandardMaterial({
    color: 0x3a0408, roughness: 1.0, metalness: 0.0,
    side: THREE.FrontSide,
  });

  for (let i = 0; i < numFolds; i++) {
    const x = -totalWidth / 2 + (i + 0.5) * foldW;
    const zOff = (i % 2 === 0) ? 0 : 0.32;
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(foldW + 0.02, height, 0.06),
      i % 2 === 0 ? frontMat : foldMat
    );
    panel.position.set(x, height / 2 - 1.8, backZ + zOff);
    panel.receiveShadow = true;
    group.add(panel);
  }

  // Top valance
  const valanceMat = new THREE.MeshStandardMaterial({ color: 0x4a0508, roughness: 0.92, metalness: 0.02 });
  const valance = new THREE.Mesh(new THREE.BoxGeometry(totalWidth + 2, 2.2, 0.9), valanceMat);
  valance.position.set(0, height - 1.8, backZ + 0.12);
  group.add(valance);

  scene.add(group);
}
buildCurtainBackdrop();

// Colored section floor markers (strings / woodwinds / brass / percussion)
function buildSectionMarkers() {
  const sections = [
    { color: 0x0e0820, xC: -2.8, zC:  0.0, w: 7.0, d: 4.2 },  // strings (left)
    { color: 0x03140a, xC:  2.8, zC:  0.0, w: 7.0, d: 4.2 },  // woodwinds (right)
    { color: 0x140e02, xC:  0.0, zC: -3.2, w: 13,  d: 3.2 },  // brass (mid)
    { color: 0x14030a, xC:  0.0, zC: -5.2, w: 13,  d: 3.0 },  // percussion (back)
  ];
  for (const s of sections) {
    const mat = new THREE.MeshStandardMaterial({
      color: s.color,
      roughness: 0.92,
      metalness: 0.0,
      emissive: s.color,
      emissiveIntensity: 0.55,
      transparent: true,
      opacity: 0.82,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.d), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(s.xC, 0.01, s.zC);
    scene.add(mesh);
  }
}
buildSectionMarkers();

// Conductor's stand — at z=9 so it appears at the very bottom of the camera view.
// Camera is at (0,3.5,10); bottom-of-screen at z=9 intersects world Y≈2.8.
// The lectern top is placed at world Y≈2.9 so it just peeks into frame.
function buildConductorsStand() {
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x2c1505, roughness: 0.72, metalness: 0.07 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x160b02, roughness: 0.88, metalness: 0.03 });
  const group = new THREE.Group();

  // Conductor's podium step (wide base)
  const podium = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.28, 1.6), woodMat);
  podium.position.y = 0.14;
  podium.castShadow = true; podium.receiveShadow = true;
  group.add(podium);

  // Decorative front panel
  const panel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.26, 0.06), darkMat);
  panel.position.set(0, 0.13, 0.83);
  group.add(panel);

  // Tall central post — must reach y≈2.5 locally
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 2.3, 10), woodMat);
  post.position.set(0, 0.28 + 1.15, -0.06);
  post.castShadow = true;
  group.add(post);

  // Angled lectern reading surface
  const lectern = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.65), darkMat);
  lectern.position.set(0, 0.28 + 2.3 + 0.03, 0.12);
  lectern.rotation.x = THREE.MathUtils.degToRad(-20);
  lectern.castShadow = true;
  group.add(lectern);

  // Bottom lip (holds sheet music)
  const lip = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.055, 0.055), woodMat);
  lip.position.set(0, 0.28 + 2.3 - 0.04, 0.42);
  group.add(lip);

  // Side wings on the lectern
  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.55), darkMat);
    wing.position.set(sx * 0.58, 0.28 + 2.3 + 0.15, 0.08);
    group.add(wing);
  }

  // Warm reading light
  const light = new THREE.PointLight(0xffc060, 2.0, 3.5);
  light.position.set(0, 0.28 + 2.3 + 0.5, 0.3);
  group.add(light);

  // Place so world Y=0 is the floor; group.position.y=0 means podium base is on floor
  group.position.set(0, 0, 9.0);
  scene.add(group);
}
buildConductorsStand();

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

// Drop-in spawn animation state
const _spawning = []; // { outer, finalY, t }

function _startDropIn(outer) {
  const finalY = outer.position.y;
  outer.position.y = finalY + 7; // start above stage
  outer.scale.setScalar(0.001);  // start micro-tiny to avoid pop-in
  _spawning.push({ outer, finalY, t: 0 });
}

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
  outer.userData.baseY = instrumentY;
  outer.userData.beatBob = 0;

  scene.add(outer);

  if (spotLight) {
    spotLight.target = outer;
    spotLight.intensity = _curtainsOpen ? 200 : 0;
    _revealLights.push(spotLight);
  }

  instruments.push({ outer, inner, baseYaw, targetYaw: baseYaw, currentYaw: baseYaw, kind });
  if (kind) instrumentRefs.set(kind, outer);
  if (kind && spotLight) {
    if (!_kindLights[kind]) _kindLights[kind] = [];
    _kindLights[kind].push(spotLight);
  }
  return outer;
}

const loader = new GLTFLoader();

// --- VIOLINS: 2 columns (x=-2, x=-3.8) × 2 rows (tier0 front, tier1 back) ---
// crescent z = zBase + x²*0.075
const VIOLIN_SLOTS = initSlotsWithLights([
  [-2.4, 0.6,  0.50], [-2.6, 0.6, -1.50],
  [-4.2, 0.6,  1.28], [-4.2, 0.8, -0.70]                  // column 3 front only
]);
const violinCache = { scene: null, count: 0, pending: 0 };
function addViolin() {
  if (violinCache.count >= VIOLIN_SLOTS.length) return;
  if (!violinCache.scene) { violinCache.pending = true; return; }
  const slots = VIOLIN_SLOTS.slice(violinCache.count);
  violinCache.count = VIOLIN_SLOTS.length;
  slots.forEach((slot, i) => setTimeout(() => {
    const outer = placeInstrument(violinCache.scene.clone(true), slot.pos[0], slot.pos[1], slot.pos[2], 30, VIOLIN_ROT, 1.2, slot.light, "violin");
    _startDropIn(outer);
  }, i * 100));
}
loader.load("/static/violon_high/scene.gltf", (gltf) => {
  violinCache.scene = gltf.scene;
  if (violinCache.pending) { violinCache.pending = false; addViolin(); }
}, undefined, (err) => console.error("violin load failed", err));




const OBOE_SLOTS = initSlotsWithLights([
  [3.8, 0.4, -0.70],
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


// --- FRENCH HORNS: column at x=-2 and x=-3.8, tier2 ---
const HORN_SLOTS = initSlotsWithLights([
  [-2.0, 0.4, -3.10], [-3.8, 0.4, -2.32],
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


// --- TRUMPETS: column at x=2 and x=3.8, tier2 (mirror of horns) ---
const TRUMPET_SLOTS = initSlotsWithLights([
  [2.0, 0.4,  0.50], [2.0, 0.4, -1.50],  
  [3.8, 0.4,  1.28], [4.2, 0.8, -0.70]  
]);
const trumpetCache = { scene: null, count: 0, pending: 0 };
function addTrumpet() {
  if (trumpetCache.count >= TRUMPET_SLOTS.length) return;
  if (!trumpetCache.scene) { trumpetCache.pending = true; return; }
  const slots = TRUMPET_SLOTS.slice(trumpetCache.count);
  trumpetCache.count = TRUMPET_SLOTS.length;
  slots.forEach((slot, i) => setTimeout(() => {
    const outer = placeInstrument(trumpetCache.scene.clone(true), slot.pos[0], slot.pos[1], slot.pos[2], -25, TRUMPET_ROT, 1.2, slot.light, "trumpet");
    _startDropIn(outer);
  }, i * 100));
}
loader.load("/static/trumpet/scene.gltf", (gltf) => {
  trumpetCache.scene = gltf.scene;
  if (trumpetCache.pending) { trumpetCache.pending = false; addTrumpet(); }
}, undefined, (err) => console.error("trumpet load failed", err));


// --- TROMBONES: columns at x=±2 and x=±3.8, tier3 ---
const TROMBONE_SLOTS = initSlotsWithLights([
  [-2.0, 0.4, -4.70], [-3.8, 0.4, -4.08],
  [ 2.0, 0.4, -4.70], [ 3.8, 0.4, -4.08],
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

// --- DRUMS: outer edges of brass arc, slightly back ---
const DRUM_SLOTS = initSlotsWithLights([
  [-1.7, 0.8, -5],
]);
const drumCache = { scene: null, count: 0, pending: 0 };
function addDrum() {
  if (drumCache.count >= DRUM_SLOTS.length) return;
  if (!drumCache.scene) { drumCache.pending = true; return; }
  const slots = DRUM_SLOTS.slice(drumCache.count);
  drumCache.count = DRUM_SLOTS.length;
  slots.forEach((slot, i) => setTimeout(() => {
    const outer = placeInstrument(drumCache.scene.clone(true), slot.pos[0], slot.pos[1], slot.pos[2], 0, DRUM_ROT, 1.5, slot.light, "drums");
    _startDropIn(outer);
  }, i * 100));
}
loader.load("/static/timpani_drum/scene.gltf", (gltf) => {
  drumCache.scene = gltf.scene;
  if (drumCache.pending) { drumCache.pending = false; addDrum(); }
}, undefined, (err) => console.error("drum load failed", err));

// --- PIANO (Tier 3 Center) ---
const PIANO_ROT = new THREE.Euler(0, -0.5, 0);
const pianoLight = createInstrumentSpotlight(0, 0.8, -5.5);
const pianoCache = { scene: null, placed: false, pending: false };

function addPiano() {
  if (pianoCache.placed) return;
  if (!pianoCache.scene) { pianoCache.pending = true; return; }
  pianoCache.placed = true;
  const outer = placeInstrument(pianoCache.scene.clone(true), 0, 0.8, -4.5, 5, PIANO_ROT, 2.0, pianoLight, "piano");
  _startDropIn(outer);
}
loader.load("/static/yamaha_m1a_piano/scene.gltf", (gltf) => {
  pianoCache.scene = gltf.scene;
  if (pianoCache.pending) { pianoCache.pending = false; addPiano(); }
}, undefined, (err) => console.error("piano load failed", err));


// --- EVENT LISTENER ---
window.addEventListener("notes:track-ready", (e) => {
  prewarmNoteTextures(e.detail?.notes ?? []);
});

function _fillNoteQueue() {
  if (!_notePlaybackList.length) return;
  const t0 = performance.now();
  notePlaybackQueue = _notePlaybackList.map((note) => {
    const startMs = Number(note.startMs ?? 0);
    return {
      trackId: note.trackId,
      midi: Number(note.midi),
      dueAt: t0 + startMs,
    };
  });
}

function _scheduleNoteLoop() {
  clearTimeout(_noteLoopTimer);
  if (!_notePlaybackList.length) return;
  const maxStartMs = _notePlaybackList.reduce((m, n) => Math.max(m, Number(n.startMs ?? 0)), 0);
  const loopMs = maxStartMs + 600;
  _noteLoopTimer = setTimeout(() => {
    _fillNoteQueue();
    _scheduleNoteLoop();
  }, loopMs);
}

window.addEventListener("notes:playback-start", (e) => {
  clearTimeout(_noteLoopTimer);
  const notes = Array.isArray(e.detail?.notes) ? e.detail.notes : [];
  _notePlaybackList = notes.filter((note) => Number.isFinite(Number(note.midi)));
  _fillNoteQueue();
  _scheduleNoteLoop();

  const bpm = e.detail?.bpm;
  if (bpm > 0) {
    clearInterval(_beatInterval);
    _beatInterval = setInterval(() => _onBeat(false), Math.round(60000 / bpm));
  }
});

window.addEventListener("notes:playback-stop", () => {
  clearTimeout(_noteLoopTimer);
  clearInterval(_beatInterval);
  _beatInterval = null;
  _notePlaybackList = [];
  notePlaybackQueue = [];
});

window.addEventListener("song:final-start", (e) => {
  clearTimeout(_noteLoopTimer);
  _notePlaybackList = [];
  notePlaybackQueue = [];
  clearInterval(_beatInterval);
  const bpm = e.detail?.bpm || 120;
  _beatInterval = setInterval(() => _onBeat(false), Math.round(60000 / bpm));
});

window.addEventListener("song:final-stop", () => {
  clearInterval(_beatInterval);
  _beatInterval = null;
});

window.addEventListener("instrument:add", (e) => {
  const kind = (e.detail?.kind ?? "trumpet").toLowerCase();
  if (kind === "trumpet") addTrumpet();
  else if (kind === "piano") addPiano();
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

  const now = performance.now();
  const dt = Math.min(0.033, (now - noteLastFrame) / 1000);
  noteLastFrame = now;

  for (const inst of instruments) {
    inst.currentYaw += (inst.targetYaw - inst.currentYaw) * 0.06;
    inst.inner.rotation.y = inst.currentYaw;
  }

  // Drop-in spawn: fall from above + scale up with ease-out cubic
  for (let i = _spawning.length - 1; i >= 0; i--) {
    const s = _spawning[i];
    s.t = Math.min(1, s.t + 0.022); // ~0.75 s total
    const ease = 1 - Math.pow(1 - s.t, 3);
    s.outer.position.y = s.finalY + (1 - ease) * 7;
    s.outer.scale.setScalar(0.001 + ease * 0.999);
    if (s.t >= 1) _spawning.splice(i, 1);
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

  while (notePlaybackQueue.length && notePlaybackQueue[0].dueAt <= now) {
    const queued = notePlaybackQueue.shift();
    spawnNote(queued.trackId);
  }

  for (let i = ACTIVE_NOTE_SPRITES.length - 1; i >= 0; i--) {
    const sprite = ACTIVE_NOTE_SPRITES[i];
    const age = now - sprite.userData.bornAt;
    const progress = Math.min(1, age / NOTE_LIFETIME_MS);

    if (progress >= 1) {
      _releaseSprite(sprite);
      ACTIVE_NOTE_SPRITES.splice(i, 1);
      continue;
    }

    sprite.position.y += dt * 1.2;
    sprite.position.x += sprite.userData.driftX * dt * 1.4;
    sprite.position.z += sprite.userData.driftZ * dt * 1.4;
    sprite.material.opacity = 1 - progress;
    sprite.scale.setScalar(0.85 + progress * 0.25);
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

  // Beat decay effects
  if (_beatDecay > 0.005) {
    _beatDecay  *= 0.84;
    _cameraShake *= 0.80;
    _floorPulse  *= 0.88;

    if (_curtainsOpen) {
      for (const l of _revealLights) l.intensity = 200 + _beatDecay * 420;
      _scanLight.intensity = 80 + _beatDecay * 200;
    }
    camera.position.y = 3.5 + Math.sin(now * 0.05) * _cameraShake;
    if (_floorMesh) _floorMesh.material.emissiveIntensity = 0.18 + _floorPulse * 0.38;
    for (const inst of instruments) {
      if (inst.outer.userData.beatBob > 0.002) {
        inst.outer.userData.beatBob *= 0.80;
        inst.outer.position.y = inst.outer.userData.baseY + inst.outer.userData.beatBob;
      }
    }
  } else if (_beatDecay > 0) {
    _beatDecay = 0;
    camera.position.y = 3.5;
    if (_floorMesh) _floorMesh.material.emissiveIntensity = 0.18;
    if (_curtainsOpen) {
      for (const l of _revealLights) l.intensity = 200;
      _scanLight.intensity = 80;
    }
    for (const inst of instruments) {
      inst.outer.position.y = inst.outer.userData.baseY;
      inst.outer.userData.beatBob = 0;
    }
  }

  renderer.render(scene, camera);
}
animate();


function makeWhite(model) {
  model.traverse(child => {
    if (child.isMesh) {
      child.material = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.3, metalness: 0.0,
      });
    }
  });
}

function mirrorX(model) {
  model.traverse(child => {
    if (child.isMesh && child.geometry) {
      const geo = child.geometry.clone();
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setX(i, -pos.getX(i));
      pos.needsUpdate = true;
      if (geo.attributes.normal) {
        const norm = geo.attributes.normal;
        for (let i = 0; i < norm.count; i++) norm.setX(i, -norm.getX(i));
        norm.needsUpdate = true;
      }
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      child.geometry = geo;
    }
  });
}


fetch("/api/ping").catch((err) => console.error("ping failed", err));