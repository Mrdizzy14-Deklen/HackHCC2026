import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
camera.position.set(0, 1.5, 5);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

scene.add(new THREE.AmbientLight(0xffffff, 0.3));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
fillLight.position.set(-3, 2, -2);
scene.add(fillLight);

const VIEWER = new THREE.Vector3(0, 1, 4);

// Tweak if bell points wrong way after first load. Model's bell axis
// rarely matches Three.js convention (-Z forward).
const BELL_FIX = new THREE.Euler(0, -Math.PI / 2, 0);

const instruments = [];

function placeInstrument(model, x, z, yawDeg = 0, modelRotation = BELL_FIX, sizeTarget = 1.2) {
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
  outer.position.set(x, 0, z);
  outer.lookAt(VIEWER);
  scene.add(outer);

  instruments.push({ outer, inner, baseYaw, targetYaw: baseYaw, currentYaw: baseYaw });
  return outer;
}

const TRUMPET_SLOTS = [
  [-2.0, 0.0],
  [-1.2, -1.2],
  [-2.6, -1.5],
  [-0.6, -2.4],
  [-2.0, -2.8],
  [-3.0, 0.2],
  [-1.8, 0.8],
];
const trumpetCache = { scene: null, count: 0, pending: 0 };

function addTrumpet() {
  if (!trumpetCache.scene) {
    trumpetCache.pending++;
    return;
  }
  const slot = TRUMPET_SLOTS[trumpetCache.count % TRUMPET_SLOTS.length];
  const ring = Math.floor(trumpetCache.count / TRUMPET_SLOTS.length);
  placeInstrument(
    trumpetCache.scene.clone(true),
    slot[0] - ring * 0.4,
    slot[1] - ring * 0.4,
    20,
  );
  trumpetCache.count++;
}

const loader = new GLTFLoader();
loader.load(
  "/static/trumpet/scene.gltf",
  (gltf) => {
    trumpetCache.scene = gltf.scene;
    while (trumpetCache.pending > 0) {
      trumpetCache.pending--;
      addTrumpet();
    }
    console.log("trumpet ready");
  },
  undefined,
  (err) => console.error("trumpet load failed", err),
);

const FLUTE_SLOTS = [
  [2.5, -3.2],
  [1.8, -4.2],
  [3.2, -4.0],
  [2.2, -5.2],
  [3.0, -5.4],
  [1.5, -3.0],
  [3.5, -3.0],
];
const fluteCache = { scene: null, count: 0, pending: 0 };

function addFlute() {
  if (!fluteCache.scene) {
    fluteCache.pending++;
    return;
  }
  const slot = FLUTE_SLOTS[fluteCache.count % FLUTE_SLOTS.length];
  const ring = Math.floor(fluteCache.count / FLUTE_SLOTS.length);
  placeInstrument(
    fluteCache.scene.clone(true),
    slot[0] + ring * 0.4,
    slot[1] - ring * 0.4,
    -20,
  );
  fluteCache.count++;
}

loader.load(
  "/static/basic_flute/scene.gltf",
  (gltf) => {
    fluteCache.scene = gltf.scene;
    while (fluteCache.pending > 0) {
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
