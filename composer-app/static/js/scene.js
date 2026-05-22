import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

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
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
fillLight.position.set(-3, 2, -2);
scene.add(fillLight);

const VIEWER = new THREE.Vector3(0, 1, 4);

// Tweak if bell points wrong way after first load. Model's bell axis
// rarely matches Three.js convention (-Z forward).
const BELL_FIX = new THREE.Euler(0, Math.PI / 2, 0);

function placeInstrument(model, x, z, yawDeg = 0) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = 1.2 / Math.max(size.x, size.y, size.z);
  model.scale.setScalar(scale);
  model.position.sub(center.multiplyScalar(scale));
  model.rotation.copy(BELL_FIX);

  const pivot = new THREE.Group();
  pivot.add(model);
  pivot.position.set(x, 0, z);
  pivot.lookAt(VIEWER);
  pivot.rotateY(THREE.MathUtils.degToRad(yawDeg));
  scene.add(pivot);
  return pivot;
}

const loader = new GLTFLoader();
loader.load(
  "/static/trumpet/scene.gltf",
  (gltf) => {
    placeInstrument(gltf.scene.clone(true), -2.0, 0, 20);
    placeInstrument(gltf.scene.clone(true), -1.2, -1.2, 20);
    console.log("trumpets placed");
  },
  undefined,
  (err) => console.error("trumpet load failed", err),
);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();

fetch("/api/ping")
  .then((r) => r.json())
  .then((data) => console.log("ping", data.status))
  .catch((err) => console.error("ping failed", err));
