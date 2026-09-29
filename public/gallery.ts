// Dev-only: every landmark model side by side, one city per row (?city=bamberg shows one city up close).
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LANDMARK_MODELS } from "./landmarks";
import { bake } from "./toykit";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.NeutralToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color("#cfe6f5");
scene.add(new THREE.HemisphereLight(0xdfeeff, 0x8a9a6a, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(80, 140, 120); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -260, right: 260, top: 260, bottom: -260, far: 600 });
scene.add(sun);
const qs = new URLSearchParams(location.search);
const only = qs.get("city"), oneId = qs.get("id");
const cities = Object.keys(LANDMARK_MODELS).filter((c) => !only || c === only);
const labels: { el: HTMLDivElement; p: THREE.Vector3 }[] = [];
cities.forEach((city, row) => {
  Object.entries(LANDMARK_MODELS[city]!).filter(([id]) => !oneId || id === oneId).forEach(([id, build], col) => {
    const m = bake(build(0, 0));
    if (only) m.position.set((col % 4) * 62 - 93, 0, Math.floor(col / 4) * 66 - 33);
    else m.position.set(col * 60 - 180, 0, row * 70 - (cities.length - 1) * 35);
    if (oneId) m.position.set(0, 0, 0);
    scene.add(m);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(27, 32), new THREE.MeshStandardMaterial({ color: "#8fd27a" }));
    ground.rotation.x = -Math.PI / 2; ground.position.copy(m.position); ground.position.y = -0.02; ground.receiveShadow = true; scene.add(ground);
    const el = document.createElement("div"); el.className = "l"; el.textContent = city + ":" + id;
    document.getElementById("lab")!.appendChild(el);
    labels.push({ el, p: m.position.clone().add(new THREE.Vector3(0, -2, 28)) });
  });
});
const camera = new THREE.PerspectiveCamera(40, 1, 1, 3000);
if (oneId) camera.position.set(34, 30, 56); else camera.position.set(0, only ? 150 : 260, only ? 230 : 380);
const controls = new OrbitControls(camera, canvas);
function frame() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  controls.update(); renderer.render(scene, camera);
  for (const { el, p } of labels) { const v = p.clone().project(camera); el.style.left = ((v.x + 1) / 2) * w + "px"; el.style.top = ((1 - v.y) / 2) * h + "px"; }
  requestAnimationFrame(frame);
}
frame();
