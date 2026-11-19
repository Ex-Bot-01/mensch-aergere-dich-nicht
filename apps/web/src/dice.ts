import * as THREE from 'three';

import type { DieValue } from '@madn/engine';

export type { DieValue };

export type Quaternion = readonly [number, number, number, number];
export type Dice = {
  /** What the widget ended up using, so a screen can explain itself if needed. */
  mode: '3d' | 'text';
  show(value: number): void;
  dispose(): void;
};

const SQRT_HALF = Math.SQRT1_2;

/**
 * How to turn the cube so that one pip value faces up. The pips sit on the box faces in
 * the order three.js builds them (+x, -x, +y, -y, +z, -z), and opposite faces sum to seven.
 */
const FACES: Record<DieValue, Quaternion> = {
  3: [0, 0, 0, 1],
  4: [1, 0, 0, 0],
  1: [0, 0, SQRT_HALF, SQRT_HALF],
  6: [0, 0, -SQRT_HALF, SQRT_HALF],
  2: [-SQRT_HALF, 0, 0, SQRT_HALF],
  5: [SQRT_HALF, 0, 0, SQRT_HALF],
};

const FACE_ORDER: DieValue[] = [1, 6, 3, 4, 2, 5];

export const TOSS_MS = 700;

export function faceQuaternion(value: DieValue): Quaternion {
  return FACES[value];
}

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

/** One die face, drawn here so the app ships no image assets. */
function pipTexture(value: DieValue): THREE.Texture | null {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvasContext(canvas);
  if (!ctx) return null;

  const pips: Record<DieValue, [number, number][]> = {
    1: [[0.5, 0.5]],
    2: [
      [0.28, 0.28],
      [0.72, 0.72],
    ],
    3: [
      [0.26, 0.26],
      [0.5, 0.5],
      [0.74, 0.74],
    ],
    4: [
      [0.3, 0.3],
      [0.7, 0.3],
      [0.3, 0.7],
      [0.7, 0.7],
    ],
    5: [
      [0.28, 0.28],
      [0.72, 0.28],
      [0.28, 0.72],
      [0.72, 0.72],
      [0.5, 0.5],
    ],
    6: [
      [0.3, 0.25],
      [0.7, 0.25],
      [0.3, 0.5],
      [0.7, 0.5],
      [0.3, 0.75],
      [0.7, 0.75],
    ],
  };

  ctx.fillStyle = '#fffdf8';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#1d1a17';
  for (const [px, py] of pips[value]) {
    ctx.beginPath();
    ctx.arc(px * 128, py * 128, 13, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'));
  } catch {
    return false;
  }
}

/** A die that tumbles when a roll arrives, plus a text path for phones without WebGL. */
export function createDice(host: HTMLElement, opts: { forceFallback?: boolean } = {}): Dice {
  const fallback = textDice(host);
  if (opts.forceFallback || !webglAvailable()) return fallback;

  const canvas = document.createElement('canvas');
  canvas.className = 'dice-canvas';
  host.append(canvas);

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    canvas.remove();
    return textDice(host);
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 2.6, 4.2);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const light = new THREE.DirectionalLight(0xffffff, 2.2);
  light.position.set(2, 4, 3);
  scene.add(light);

  const materials = FACE_ORDER.map((value) => {
    const texture = pipTexture(value);
    return texture
      ? new THREE.MeshStandardMaterial({ map: texture, roughness: 0.45 })
      : new THREE.MeshStandardMaterial({ color: 0xffdfb0 });
  });
  const die = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), materials);
  scene.add(die);

  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let target = new THREE.Quaternion();

  const resize = (): void => {
    const size = host.clientWidth || 120;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(size, size, false);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
  };

  const paint = (): void => {
    renderer.render(scene, camera);
  };

  resize();
  paint();

  const stop = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  return {
    mode: '3d',
    show: (value) => {
      stop();
      const from = die.quaternion.clone();
      target.set(...faceQuaternion(value as DieValue));
      const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() + 0.4, Math.random() - 0.5).normalize();
      const turns = 2 + Math.floor(Math.random() * 2);
      const started = Date.now();

      const step = (): void => {
        const progress = Math.min(1, (Date.now() - started) / TOSS_MS);
        const eased = 1 - (1 - progress) ** 3;

        die.quaternion.copy(from).slerp(target, eased);
        die.rotateOnAxis(spin, (1 - eased) * turns * Math.PI * 2 * 0.06);
        die.position.y = Math.sin(progress * Math.PI) * 0.55;
        paint();

        if (progress < 1) frame = requestAnimationFrame(step);
        else {
          die.quaternion.copy(target);
          die.position.y = 0;
          paint();
          frame = 0;
        }
      };

      frame = requestAnimationFrame(step);
    },
    dispose: () => {
      stop();
      die.geometry.dispose();
      for (const material of materials) material.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

/** The no-WebGL path: the same toss in time, just drawn as a numeral. */
function textDice(host: HTMLElement): Dice {
  const element = document.createElement('span');
  element.className = 'dice-text';
  element.textContent = '–';
  host.replaceChildren(element);

  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    mode: 'text',
    show: (value) => {
      if (timer !== null) clearTimeout(timer);
      element.textContent = '–';
      timer = setTimeout(() => {
        element.textContent = String(value);
        timer = null;
      }, TOSS_MS);
    },
    dispose: () => {
      if (timer !== null) clearTimeout(timer);
      element.remove();
    },
  };
}
