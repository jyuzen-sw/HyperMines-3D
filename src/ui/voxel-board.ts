import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type { ActionMode, CellObservation, PublicObservation } from '../game';

export type BoardIntent = Readonly<{
  type: 'reveal' | 'toggle-flag' | 'chord';
  cellId: number;
}>;

export interface VoxelBoardOptions {
  readonly canvas: HTMLCanvasElement;
  readonly fallback: HTMLElement;
  readonly onIntent: (intent: BoardIntent) => void;
  readonly onHoverCell: (cell: CellObservation | null, point: { x: number; y: number }) => void;
}

interface PointerOrigin {
  readonly x: number;
  readonly y: number;
  readonly button: number;
}

interface PickedCell {
  readonly cellId: number;
  readonly kind: 'cell' | 'flag' | 'clue';
}

const clueColors = [
  '#606060',
  '#0000ff',
  '#008000',
  '#ff0000',
  '#000080',
  '#800000',
  '#008080',
  '#000000',
];

export class VoxelBoard {
  readonly #canvas: HTMLCanvasElement;
  readonly #fallback: HTMLElement;
  readonly #onIntent: VoxelBoardOptions['onIntent'];
  readonly #onHoverCell: VoxelBoardOptions['onHoverCell'];
  readonly #listeners = new AbortController();
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  readonly #raycaster = new THREE.Raycaster();
  readonly #pointer = new THREE.Vector2();
  readonly #boardGroup = new THREE.Group();
  readonly #markerGroup = new THREE.Group();
  readonly #frameGroup = new THREE.Group();
  readonly #pendingHighlight: THREE.LineSegments;
  readonly #renderer: THREE.WebGLRenderer | null;
  readonly #controls: OrbitControls | null;
  readonly #textures = new Map<string, THREE.CanvasTexture>();
  #observation: PublicObservation | null = null;
  #surfaceMesh: THREE.InstancedMesh | null = null;
  #surfaceWireMesh: THREE.LineSegments | null = null;
  #surfaceIds: readonly number[] = [];
  #interactiveMarkers: THREE.Sprite[] = [];
  #actionMode: ActionMode = 'open';
  #pendingId: number | null = null;
  #pointerOrigin: PointerOrigin | null = null;
  #frameHandle = 0;
  #dimensionsKey = '';

  constructor(options: VoxelBoardOptions) {
    this.#canvas = options.canvas;
    this.#fallback = options.fallback;
    this.#onIntent = options.onIntent;
    this.#onHoverCell = options.onHoverCell;
    const pendingMaterial = new THREE.LineBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    const pendingBox = new THREE.BoxGeometry(1.08, 1.08, 1.08);
    this.#pendingHighlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(pendingBox),
      pendingMaterial,
    );
    pendingBox.dispose();
    this.#pendingHighlight.visible = false;
    this.#pendingHighlight.renderOrder = 21;
    this.#scene.add(this.#boardGroup, this.#markerGroup, this.#frameGroup, this.#pendingHighlight);
    this.#scene.add(new THREE.HemisphereLight(0xffffff, 0x4a4a4a, 2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
    keyLight.position.set(7, 9, 12);
    this.#scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x8b8b8b, 1.2);
    rimLight.position.set(-9, -3, -7);
    this.#scene.add(rimLight);

    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: this.#canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.18;
      controls = new OrbitControls(this.#camera, this.#canvas);
      controls.enablePan = true;
      controls.screenSpacePanning = true;
      controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
      controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
      controls.enableDamping = false;
      controls.minDistance = 5;
      controls.maxDistance = 35;
      controls.addEventListener('change', this.#requestRender);
      this.#fallback.hidden = true;
    } catch {
      this.#canvas.hidden = true;
      this.#fallback.hidden = false;
    }
    this.#renderer = renderer;
    this.#controls = controls;

    const signal = this.#listeners.signal;
    this.#canvas.addEventListener('pointerdown', this.#handlePointerDown, { signal });
    this.#canvas.addEventListener('pointermove', this.#handlePointerMove, { signal });
    this.#canvas.addEventListener('pointerup', this.#handlePointerUp, { signal });
    this.#canvas.addEventListener('pointercancel', this.#handlePointerCancel, { signal });
    this.#canvas.addEventListener('pointerleave', this.#handlePointerLeave, { signal });
    this.#canvas.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
    window.addEventListener('resize', this.resize, { signal });
    this.resize();
  }

  update(observation: PublicObservation, pendingId: number | null = null): void {
    this.#observation = observation;
    this.#pendingId = pendingId;
    const dimensionsKey = `${observation.dimensions.width}:${observation.dimensions.height}:${observation.dimensions.depth}`;
    if (dimensionsKey !== this.#dimensionsKey) {
      this.#dimensionsKey = dimensionsKey;
      this.#rebuildFrame();
      this.resetCamera();
    }
    this.#rebuildCells();
    this.#positionPendingHighlight();
    this.#requestRender();
  }

  setActionMode(mode: ActionMode): void {
    this.#actionMode = mode;
  }

  resetCamera(): void {
    if (this.#observation === null || this.#controls === null) return;
    const size = Math.max(
      this.#observation.dimensions.width,
      this.#observation.dimensions.height,
      this.#observation.dimensions.depth,
    );
    this.#camera.position.set(size * 1.05, size * 0.86, size * 1.48);
    this.#controls.target.set(0, 0, 0);
    this.#controls.minDistance = Math.max(4, size * 0.7);
    this.#controls.maxDistance = size * 4.2;
    this.#controls.update();
    this.#requestRender();
  }

  resize = (): void => {
    if (this.#renderer === null) return;
    const rect = this.#canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.#renderer.setSize(width, height, false);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
    this.#requestRender();
  };

  destroy(): void {
    this.#listeners.abort();
    if (this.#frameHandle !== 0) cancelAnimationFrame(this.#frameHandle);
    this.#controls?.dispose();
    this.#surfaceMesh?.geometry.dispose();
    const material = this.#surfaceMesh?.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose();
    this.#surfaceWireMesh?.geometry.dispose();
    const wireMaterial = this.#surfaceWireMesh?.material;
    if (Array.isArray(wireMaterial)) wireMaterial.forEach((item) => item.dispose());
    else wireMaterial?.dispose();
    this.#markerGroup.children.forEach((child) => {
      if (child instanceof THREE.Sprite) child.material.dispose();
    });
    this.#textures.forEach((texture) => texture.dispose());
    this.#pendingHighlight.geometry.dispose();
    const pendingMaterial = this.#pendingHighlight.material;
    if (Array.isArray(pendingMaterial)) pendingMaterial.forEach((item) => item.dispose());
    else pendingMaterial.dispose();
    this.#renderer?.dispose();
  }

  #rebuildCells(): void {
    const observation = this.#observation;
    if (observation === null) return;
    this.#boardGroup.clear();
    this.#markerGroup.children.forEach((child) => {
      if (child instanceof THREE.Sprite) child.material.dispose();
    });
    this.#markerGroup.clear();
    this.#interactiveMarkers = [];
    this.#surfaceMesh?.geometry.dispose();
    const previousMaterial = this.#surfaceMesh?.material;
    if (Array.isArray(previousMaterial)) previousMaterial.forEach((material) => material.dispose());
    else previousMaterial?.dispose();
    this.#surfaceWireMesh?.geometry.dispose();
    const previousWireMaterial = this.#surfaceWireMesh?.material;
    if (Array.isArray(previousWireMaterial)) {
      previousWireMaterial.forEach((material) => material.dispose());
    } else {
      previousWireMaterial?.dispose();
    }

    const surfaceCells = observation.cells.filter(
      (cell) => cell.state === 'covered' && cell.isSurface,
    );
    this.#surfaceIds = surfaceCells.map((cell) => cell.id);
    if (surfaceCells.length > 0) {
      const geometry = new THREE.BoxGeometry(0.9, 0.9, 0.9, 1, 1, 1);
      const material = new THREE.MeshBasicMaterial({
        color: 0xc0c0c0,
        toneMapped: false,
      });
      this.#surfaceMesh = new THREE.InstancedMesh(geometry, material, surfaceCells.length);
      this.#surfaceWireMesh = this.#createSurfaceEdges(surfaceCells);
      const matrix = new THREE.Matrix4();
      surfaceCells.forEach((cell, index) => {
        matrix.makeTranslation(...this.#worldTuple(cell));
        this.#surfaceMesh!.setMatrixAt(index, matrix);
      });
      this.#surfaceMesh.instanceMatrix.needsUpdate = true;
      this.#boardGroup.add(this.#surfaceMesh, this.#surfaceWireMesh);
    } else {
      this.#surfaceMesh = null;
      this.#surfaceWireMesh = null;
    }

    for (const cell of observation.cells) {
      if (cell.state === 'revealed' && cell.clue !== null && cell.clue > 0) {
        this.#addMarker(cell, String(cell.clue), clueColors[Math.min(cell.clue, 7)]!, 'clue');
      } else if (cell.state === 'flagged') {
        this.#addMarker(cell, '⚑', '#ff0000', 'flag', 0.8);
      } else if (cell.state === 'detonated') {
        this.#addMarker(cell, '✹', '#ff0000', 'flag', 1.05);
      } else if (cell.state === 'mine') {
        this.#addMarker(cell, '✹', '#000000', 'flag', 0.88);
      } else if (cell.state === 'wrong-flag') {
        this.#addMarker(cell, '×', '#ff0000', 'flag', 0.9);
      }
    }
  }

  #addMarker(
    cell: CellObservation,
    text: string,
    color: string,
    kind: 'flag' | 'clue',
    scale = 0.66,
  ): void {
    const texture = this.#labelTexture(text, color);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(...this.#worldTuple(cell));
    sprite.scale.set(scale, scale, scale);
    sprite.userData.cellId = cell.id;
    sprite.userData.kind = kind;
    this.#markerGroup.add(sprite);
    this.#interactiveMarkers.push(sprite);
  }

  #createSurfaceEdges(cells: readonly CellObservation[]): THREE.LineSegments {
    const half = 0.4575;
    const vertices: readonly [number, number, number][] = [
      [-half, -half, -half],
      [half, -half, -half],
      [half, half, -half],
      [-half, half, -half],
      [-half, -half, half],
      [half, -half, half],
      [half, half, half],
      [-half, half, half],
    ];
    const edges: readonly [number, number][] = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ];
    const positions: number[] = [];
    for (const cell of cells) {
      const world = this.#worldTuple(cell);
      for (const [startIndex, endIndex] of edges) {
        const start = vertices[startIndex]!;
        const end = vertices[endIndex]!;
        positions.push(
          world[0] + start[0],
          world[1] + start[1],
          world[2] + start[2],
          world[0] + end[0],
          world[1] + end[1],
          world[2] + end[2],
        );
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0x202020,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      }),
    );
  }

  #labelTexture(text: string, color: string): THREE.CanvasTexture {
    const key = `${text}:${color}`;
    const cached = this.#textures.get(key);
    if (cached !== undefined) return cached;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d')!;
    context.clearRect(0, 0, 128, 128);
    context.fillStyle = 'rgba(192, 192, 192, 0.96)';
    context.fillRect(12, 12, 104, 104);
    context.lineWidth = 6;
    context.strokeStyle = '#ffffff';
    context.beginPath();
    context.moveTo(114, 14);
    context.lineTo(14, 14);
    context.lineTo(14, 114);
    context.stroke();
    context.strokeStyle = '#404040';
    context.beginPath();
    context.moveTo(14, 114);
    context.lineTo(114, 114);
    context.lineTo(114, 14);
    context.stroke();
    context.fillStyle = color;
    context.font = `700 ${text.length > 1 ? 48 : 66}px Arial, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 64, 66);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    this.#textures.set(key, texture);
    return texture;
  }

  #rebuildFrame(): void {
    this.#frameGroup.children.forEach((child) => {
      if (child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        const material = child.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material.dispose();
      }
    });
    this.#frameGroup.clear();
    const observation = this.#observation;
    if (observation === null) return;
    const geometry = new THREE.BoxGeometry(
      observation.dimensions.width,
      observation.dimensions.height,
      observation.dimensions.depth,
    );
    const edges = new THREE.EdgesGeometry(geometry);
    geometry.dispose();
    const lines = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x202020, transparent: true, opacity: 0.5 }),
    );
    this.#frameGroup.add(lines);
  }

  #positionPendingHighlight(): void {
    const observation = this.#observation;
    const pending =
      observation === null || this.#pendingId === null
        ? undefined
        : observation.cells[this.#pendingId];
    this.#pendingHighlight.visible = pending !== undefined;
    if (pending !== undefined) this.#pendingHighlight.position.set(...this.#worldTuple(pending));
  }

  #worldTuple(cell: CellObservation): [number, number, number] {
    const dimensions = this.#observation!.dimensions;
    return [
      cell.coordinate.x - (dimensions.width - 1) / 2,
      cell.coordinate.y - (dimensions.height - 1) / 2,
      cell.coordinate.z - (dimensions.depth - 1) / 2,
    ];
  }

  #pick(clientX: number, clientY: number): PickedCell | null {
    if (this.#renderer === null || this.#observation === null) return null;
    const rect = this.#canvas.getBoundingClientRect();
    this.#pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.#raycaster.setFromCamera(this.#pointer, this.#camera);
    const targets: THREE.Object3D[] = [...this.#interactiveMarkers];
    if (this.#surfaceMesh !== null) targets.push(this.#surfaceMesh);
    const intersection = this.#raycaster.intersectObjects(targets, false)[0];
    if (intersection === undefined) return null;
    if (intersection.object === this.#surfaceMesh && intersection.instanceId !== undefined) {
      const cellId = this.#surfaceIds[intersection.instanceId];
      return cellId === undefined ? null : { cellId, kind: 'cell' };
    }
    const cellId = intersection.object.userData.cellId;
    const kind = intersection.object.userData.kind;
    return typeof cellId === 'number' && (kind === 'flag' || kind === 'clue')
      ? { cellId, kind }
      : null;
  }

  #handlePointerDown = (event: PointerEvent): void => {
    this.#pointerOrigin = { x: event.clientX, y: event.clientY, button: event.button };
  };

  #handlePointerMove = (event: PointerEvent): void => {
    if (event.buttons !== 0) return;
    const picked = this.#pick(event.clientX, event.clientY);
    const cell = picked === null ? null : (this.#observation?.cells[picked.cellId] ?? null);
    this.#canvas.style.cursor = picked === null ? 'grab' : 'pointer';
    this.#onHoverCell(cell, { x: event.clientX, y: event.clientY });
  };

  #handlePointerUp = (event: PointerEvent): void => {
    const origin = this.#pointerOrigin;
    this.#pointerOrigin = null;
    if (origin === null || origin.button !== event.button) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 6) return;
    const picked = this.#pick(event.clientX, event.clientY);
    if (picked === null) return;
    if (event.button === 2 || this.#actionMode === 'flag') {
      this.#onIntent({ type: 'toggle-flag', cellId: picked.cellId });
    } else if (picked.kind === 'clue') {
      this.#onIntent({ type: 'chord', cellId: picked.cellId });
    } else {
      this.#onIntent({ type: 'reveal', cellId: picked.cellId });
    }
  };

  #handlePointerCancel = (): void => {
    this.#pointerOrigin = null;
  };

  #handlePointerLeave = (): void => {
    this.#pointerOrigin = null;
    this.#onHoverCell(null, { x: 0, y: 0 });
  };

  #requestRender = (): void => {
    if (this.#renderer === null || this.#frameHandle !== 0) return;
    this.#frameHandle = requestAnimationFrame(() => {
      this.#frameHandle = 0;
      this.#renderer!.render(this.#scene, this.#camera);
    });
  };
}
