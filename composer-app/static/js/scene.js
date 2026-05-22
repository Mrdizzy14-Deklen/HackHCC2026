import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// --- TWEAK: We don't need RoomEnvironment for stage lighting, so we can drop it. ---
// import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111); // Darken background

// --- NEW: Stage Haze (Fog) ---
scene.fog = new THREE.Fog(0x111111, 5, 25);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);

// Example: Trumpet points forward, but maybe needs to be tilted up 15 degrees to look like it's being played
const TRUMPET_ROT = new THREE.Euler(
  THREE.MathUtils.degToRad(15),  // X: Tilt up/down
  THREE.MathUtils.degToRad(-90), // Y: Spin left/right (your original BELL_FIX)
  THREE.MathUtils.degToRad(0)    // Z: Roll (barrel roll)
);

// Example: Flutes are held sideways, so you usually have to rotate them heavily on the Z or X axis depending on the model
const FLUTE_ROT = new THREE.Euler(
  THREE.MathUtils.degToRad(10),
  THREE.MathUtils.degToRad(0),
  THREE.MathUtils.degToRad(100) // Roll it horizontal
);

camera.position.set(0, 3.5, 10); // --- TWEAK: Raised slightly to see tiers better ---
camera.lookAt(0, 0.55, -2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8; // --- TWEAK: Lowered exposure ---

// --- NEW: Enable global shadow mapping ---
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// --- TWEAK: Removed PMREM generator since it floods the scene with white light ---
// const pmrem = new THREE.PMREMGenerator(renderer);
// scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// --- TWEAK: Dimmed base lighting to allow spotlights to stand out ---
scene.add(new THREE.AmbientLight(0xffffff, 0.5));

const keyLight = new THREE.DirectionalLight(0xffffff, 5);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.1);
fillLight.position.set(-3, 2, -2);
scene.add(fillLight);

// --- NEW: Spotlight Helper Function ---
function createStageSpotlight(color, intensity, pos, targetPos) {
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

// 1. Warm Front Wash (Main illumination, light amber)
createStageSpotlight(0xffe5b4, 40, { x: 0, y: 8, z: 5 }, { x: 0, y: 0, z: -2 });

// 2. Cool Backlight (Adds depth/rim light, cyan/blue)
createStageSpotlight(0x87ceeb, 25, { x: 0, y: 8, z: -8 }, { x: 0, y: 0, z: 0 });

// 3. Side Wash Left (Slightly Magenta/Red)
createStageSpotlight(0xffb6c1, 15, { x: -8, y: 5, z: 0 }, { x: -3, y: 0, z: -2 });

// 4. Side Wash Right (Slightly Cyan/Green)
createStageSpotlight(0x00ffff, 15, { x: 8, y: 5, z: 0 }, { x: 3, y: 0, z: -2 });

const VIEWER = new THREE.Vector3(0, 1, 4);

// Orchestra tiers: front (near camera, higher z) = low; back = raised steps.
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
  
  // --- TWEAK: Darkened materials so spotlights look better ---
  const wood = new THREE.MeshStandardMaterial({
    color: 0x2d241c,
    roughness: 0.82,
    metalness: 0.04,
  });
  const lipMat = new THREE.MeshStandardMaterial({
    color: 0x1a130c,
    roughness: 0.9,
    metalness: 0.02,
  });
  const skirtMat = new THREE.MeshStandardMaterial({
    color: 0x0f0a06,
    roughness: 0.95,
  });

  for (const tier of ORCHESTRA_TIERS) {
    const depth = tier.zMax - tier.zMin;
    const centerZ = (tier.zMax + tier.zMin) / 2;
    const topY = tier.y + PLATFORM_THICKNESS / 2;

    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(stageW, PLATFORM_THICKNESS, depth),
      wood,
    );
    deck.position.set(0, topY, centerZ);
    deck.castShadow = true; // NEW
    deck.receiveShadow = true; // NEW
    group.add(deck);

    // Front edge lip (visible "step" face toward audience)
    const lip = new THREE.Mesh(new THREE.BoxGeometry(stageW, 0.14, 0.08), lipMat);
    lip.position.set(0, tier.y + 0.05, tier.zMax + 0.02);
    lip.castShadow = true; // NEW
    lip.receiveShadow = true; // NEW
    group.add(lip);

    // Vertical riser face under the step (except front row)
    if (tier.y > 0) {
      const rise = tier.y;
      const skirt = new THREE.Mesh(
        new THREE.BoxGeometry(stageW, rise, 0.12),
        skirtMat,
      );
      skirt.position.set(0, rise / 2, tier.zMax + 0.06);
      skirt.castShadow = true; // NEW
      skirt.receiveShadow = true; // NEW
      group.add(skirt);
    }
  }

  // Side wing ramps (visual cue that sections sit on stands)
  for (const side of [-1, 1]) {
    const ramp = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.5, 5.5),
      skirtMat,
    );
    ramp.position.set(side * (stageW / 2 - 0.2), 0.25, -2.5);
    ramp.rotation.y = side * 0.08;
    ramp.receiveShadow = true; // NEW
    group.add(ramp);
  }

  scene.add(group);
  return group;
}

buildOrchestraRisers();

// Tweak if bell points wrong way after first load. Model's bell axis
// rarely matches Three.js convention (-Z forward).
const BELL_FIX = new THREE.Euler(0, -Math.PI / 2, 0);

const instruments = [];

function placeInstrument(
  model,
  x,
  z,
  yawDeg = 0,
  modelRotation = BELL_FIX,
  sizeTarget = 1.2
) {
  // --- NEW: Tell the loaded 3D model to cast and receive shadows ---
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
  
  // Get the step height, add platform thickness, and add a float offset
  const FLOAT_OFFSET = 0.4; // Adjust this to make them float higher or lower
  const instrumentY = getTierY(z) + (PLATFORM_THICKNESS / 2) + FLOAT_OFFSET;
  
  outer.position.set(x, instrumentY, z);
  
  scene.add(outer);

  instruments.push({ outer, inner, baseYaw, targetYaw: baseYaw, currentYaw: baseYaw });
  return outer;
}

// --- TRUMPETS ---
// Spreading them out across the left side (-X) and different tier depths (-Z)
const TRUMPET_SLOTS = [
  [-1.5, 0.2], [-3.0, 0.2], [-4.5, 0.2],    // Tier 0
  [-2.0, -1.8], [-3.5, -1.8],               // Tier 1
  [-1.5, -3.4], [-3.0, -3.4], [-4.5, -3.4], // Tier 2
  [-2.0, -5.0], [-3.5, -5.0]                // Tier 3
];
const MAX_TRUMPETS = TRUMPET_SLOTS.length;
const trumpetCache = { scene: null, count: 0, pending: 0 };

function addTrumpet() {
  // Cap the total number of trumpets
  if (trumpetCache.count + trumpetCache.pending >= MAX_TRUMPETS) return;

  if (!trumpetCache.scene) {
    trumpetCache.pending++;
    return;
  }
  
  const slot = TRUMPET_SLOTS[trumpetCache.count];
  placeInstrument(
    trumpetCache.scene.clone(true),
    slot[0],
    slot[1],
    20,
    TRUMPET_ROT
  );
  trumpetCache.count++;
}

const loader = new GLTFLoader();
loader.load(
  "/static/trumpet/scene.gltf",
  (gltf) => {
    trumpetCache.scene = gltf.scene;
    while (trumpetCache.pending > 0 && trumpetCache.count < MAX_TRUMPETS) {
      trumpetCache.pending--;
      addTrumpet();
    }
    console.log("trumpet ready");
  },
  undefined,
  (err) => console.error("trumpet load failed", err),
);

// --- FLUTES ---
// Spreading them out across the right side (+X) and different tier depths (-Z)
const FLUTE_SLOTS = [
  [1.5, 0.2], [3.0, 0.2], [4.5, 0.2],       // Tier 0
  [2.0, -1.8], [3.5, -1.8],                 // Tier 1
  [1.5, -3.4], [3.0, -3.4], [4.5, -3.4],    // Tier 2
  [2.0, -5.0], [3.5, -5.0]                  // Tier 3
];
const MAX_FLUTES = FLUTE_SLOTS.length;
const fluteCache = { scene: null, count: 0, pending: 0 };

function addFlute() {
  // Cap the total number of flutes
  if (fluteCache.count + fluteCache.pending >= MAX_FLUTES) return;

  if (!fluteCache.scene) {
    fluteCache.pending++;
    return;
  }
  
  const slot = FLUTE_SLOTS[fluteCache.count];
  placeInstrument(
    fluteCache.scene.clone(true),
    slot[0],
    slot[1],
    -20,
    FLUTE_ROT
  );
  fluteCache.count++;
}

loader.load(
  "/static/basic_flute/scene.gltf",
  (gltf) => {
    fluteCache.scene = gltf.scene;
    while (fluteCache.pending > 0 && fluteCache.count < MAX_FLUTES) {
      fluteCache.pending--;
      addFlute();
    }
    console.log("flute ready");
  },
  undefined,
  (err) => console.error("flute load failed", err),
);

const PIANO_ROT = new THREE.Euler(0, 0, 0);
const pianoCache = { scene: null, placed: false, pending: false };

function addPiano() {
  if (pianoCache.placed) return;
  if (!pianoCache.scene) {
    pianoCache.pending = true;
    return;
  }
  placeInstrument(pianoCache.scene.clone(true), 0, -4.5, 0, PIANO_ROT, 2.0);
  pianoCache.placed = true;
}

loader.load(
  "/static/yamaha_m1a_piano/scene.gltf",
  (gltf) => {
    pianoCache.scene = gltf.scene;
    if (pianoCache.pending) {
      pianoCache.pending = false;
      addPiano();
    }
    console.log("piano ready");
  },
  undefined,
  (err) => console.error("piano load failed", err),
);

window.addEventListener("instrument:add", (e) => {
  const kind = (e.detail?.kind ?? "trumpet").toLowerCase();
  if (kind === "trumpet") addTrumpet();
  else if (kind === "piano") addPiano();
  else if (kind === "flute") addFlute();
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
  const HOVER_SWING = THREE.MathUtils.degToRad(6);
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

fetch("/api/ping")
  .then((r) => r.json())
  .then((data) => console.log("ping", data.status))
  .catch((err) => console.error("ping failed", err));