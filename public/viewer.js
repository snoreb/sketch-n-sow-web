import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

function makeStroke(stroke, coordinates) {
  const points = stroke.points.map(point => new THREE.Vector3(point[0], point[1], point[2] * (coordinates === 'unity-left-handed-y-up' ? -1 : 1)));
  const colors = stroke.colors ?? points.map(() => stroke.color);
  const opacity = colors.reduce((sum, value) => sum + value[3], 0) / colors.length;
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: opacity < 1, opacity });
  if (points.length === 1) {
    material.vertexColors = false;
    material.color.setRGB(...colors[0].slice(0, 3), THREE.SRGBColorSpace);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(stroke.widths[0] / 2, 10, 8), material);
    mesh.position.copy(points[0]);
    return mesh;
  }
  const vertices = [], shades = [], indices = [];
  const ringSize = 8;
  const ringCount = points.length + (stroke.loop ? 1 : 0);
  for (let ring = 0; ring < ringCount; ring++) {
    const pointIndex = ring % points.length;
    const previous = points[stroke.loop ? (pointIndex - 1 + points.length) % points.length : Math.max(0, pointIndex - 1)];
    const next = points[stroke.loop ? (pointIndex + 1) % points.length : Math.min(points.length - 1, pointIndex + 1)];
    const tangent = next.clone().sub(previous).normalize();
    if (tangent.lengthSq() === 0) tangent.set(0, 1, 0);
    const reference = Math.abs(tangent.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const normal = new THREE.Vector3().crossVectors(tangent, reference).normalize();
    const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();
    const shade = new THREE.Color().setRGB(...colors[pointIndex].slice(0, 3), THREE.SRGBColorSpace);
    for (let side = 0; side < ringSize; side++) {
      const angle = side / ringSize * Math.PI * 2;
      const vertex = points[pointIndex].clone().addScaledVector(normal, Math.cos(angle) * stroke.widths[pointIndex] / 2).addScaledVector(binormal, Math.sin(angle) * stroke.widths[pointIndex] / 2);
      vertices.push(vertex.x, vertex.y, vertex.z);
      shades.push(shade.r, shade.g, shade.b);
      if (ring < ringCount - 1) {
        const current = ring * ringSize + side;
        const neighbor = ring * ringSize + (side + 1) % ringSize;
        indices.push(current, neighbor, current + ringSize, neighbor, neighbor + ringSize, current + ringSize);
      }
    }
  }
  if (!stroke.loop) for (let side = 1; side < ringSize - 1; side++) {
    indices.push(0, side + 1, side);
    const end = (ringCount - 1) * ringSize;
    indices.push(end, end + side, end + side + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3));
  geometry.setIndex(indices);
  return new THREE.Mesh(geometry, material);
}

function sceneFor(sketch) {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  sketch.strokes.forEach(stroke => group.add(makeStroke(stroke, sketch.coordinates)));
  const box = new THREE.Box3().setFromObject(group);
  if (!box.isEmpty()) {
    group.position.sub(box.getCenter(new THREE.Vector3()));
    group.scale.setScalar(2.5 / Math.max(box.getSize(new THREE.Vector3()).length(), 0.0001));
    group.position.multiplyScalar(group.scale.x);
  }
  scene.add(group);
  return scene;
}
function dispose(scene) {
  scene.traverse(item => { item.geometry?.dispose(); item.material?.dispose(); });
}
function frame(camera, aspect) {
  camera.aspect = aspect;
  camera.position.set(0.65, 0.4, 1).normalize().multiplyScalar(3.1 / Math.min(aspect, 1));
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}
export class SketchViewer {
  constructor(viewport) {
    this.viewport = viewport;
    this.pendingFrame = null;
    this.width = 0;
    this.height = 0;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setClearColor('#e8eddf');
    this.renderer.setPixelRatio(1);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.001, 1000);
    viewport.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.minDistance = 0.03;
    this.controls.maxDistance = 100;
    this.controls.addEventListener('change', () => this.render());
    this.observer = new ResizeObserver(() => {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      if (!width || !height || (width === this.width && height === this.height)) return;
      this.width = width;
      this.height = height;
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.render();
    });
    this.observer.observe(viewport);
  }
  show(sketch) {
    if (this.scene) dispose(this.scene);
    this.scene = sceneFor(sketch);
    this.reset();
  }
  reset() {
    this.controls.target.set(0, 0, 0);
    frame(this.camera, this.viewport.clientWidth / Math.max(this.viewport.clientHeight, 1));
    this.controls.update();
    this.render();
  }
  render() {
    if (!this.scene || this.pendingFrame !== null) return;
    this.pendingFrame = requestAnimationFrame(() => {
      this.pendingFrame = null;
      if (this.scene) this.renderer.render(this.scene, this.camera);
    });
  }
  clear() {
    if (this.pendingFrame !== null) cancelAnimationFrame(this.pendingFrame);
    this.pendingFrame = null;
    if (this.scene) dispose(this.scene);
    this.scene = null;
    this.renderer.clear();
  }
}

let thumbnailRenderer;
export function thumbnail(sketch, canvas) {
  thumbnailRenderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true });
  thumbnailRenderer.setSize(640, 400, false);
  const scene = sceneFor(sketch);
  const camera = new THREE.PerspectiveCamera(45, 1.6, 0.001, 1000);
  frame(camera, 1.6);
  thumbnailRenderer.render(scene, camera);
  canvas.width = 640;
  canvas.height = 400;
  canvas.getContext('2d').drawImage(thumbnailRenderer.domElement, 0, 0);
  dispose(scene);
}
