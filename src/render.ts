// Babylon renderer — mirrors SimState, owns all juice (shards, shockwaves,
// shake, hit-stop, glow). The sim never reads anything from here.
import "@babylonjs/core/Culling/ray"; // side-effect: enables scene.createPickingRay
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CONFIG } from "./config";
import type { BlockDef, BlockType } from "./levelgen";
import type { SimEvent } from "./sim";

interface Shard {
  mesh: Mesh;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  rz: number;
  life: number;
  maxLife: number;
  size: number;
}
interface Ring {
  mesh: Mesh;
  mat: StandardMaterial;
  life: number;
}

export interface Renderer {
  engine: Engine;
  scene: Scene;
  syncBall: (b: { x: number; y: number; z: number }) => void;
  applyEvents: (events: SimEvent[]) => void;
  frame: (frameMs: number, tilt: { x: number; z: number }) => void;
  consumeHitStop: () => number;
  resetBlocks: () => void;
  setAim: (
    points: { x: number; y: number; z: number }[] | null,
    disc?: { x: number; y: number; z: number } | null,
    wallHit?: boolean,
  ) => void;
  // Screen (client px) → sim XZ on the horizontal plane at sim height planeY.
  screenToShaft: (clientX: number, clientY: number, planeY: number) => { x: number; z: number } | null;
}

export function createRenderer(canvas: HTMLCanvasElement, layout: BlockDef[]): Renderer {
  const C = CONFIG;
  const engine = new Engine(canvas, true);
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.05, 0.06, 0.1, 1);

  const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), scene);
  hemi.intensity = 0.9;
  hemi.groundColor = new Color3(0.15, 0.15, 0.2);
  const sun = new DirectionalLight("sun", new Vector3(-0.35, -1, -0.25), scene);
  sun.intensity = 0.7;

  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = new Color3(0.05, 0.06, 0.1);
  scene.fogStart = C.fogStart;
  scene.fogEnd = C.fogEnd;

  const camera = new TargetCamera("camera", new Vector3(0, 0, 0), scene);
  camera.fov = C.camFov;
  scene.activeCamera = camera;

  const glow = new GlowLayer("glow", scene);
  glow.intensity = 0.55; // screen-space glow halos leak over occluders — keep modest
  const pipeline = new DefaultRenderingPipeline("pp", false, scene, [camera]);
  pipeline.bloomEnabled = true;
  pipeline.bloomWeight = 0.35;
  pipeline.fxaaEnabled = true;

  const tower = new TransformNode("tower", scene);
  tower.position = new Vector3(C.shaftW / 2, 0, C.shaftD / 2);
  const toLocal = (sx: number, sy: number, sz: number) => new Vector3(sx - C.shaftW / 2, -sy, sz - C.shaftD / 2);

  function makeMaterial(name: string, rgb: [number, number, number], emissive: number, alpha = 1): StandardMaterial {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = new Color3(rgb[0], rgb[1], rgb[2]);
    m.specularColor = new Color3(0, 0, 0);
    m.emissiveColor = new Color3(rgb[0] * emissive, rgb[1] * emissive, rgb[2] * emissive);
    if (alpha < 1) m.alpha = alpha;
    return m;
  }

  const floorMesh = MeshBuilder.CreateBox("floor", { width: C.shaftW, height: 80, depth: C.shaftD }, scene);
  floorMesh.position = toLocal(C.shaftW / 2, C.floorY + 40, C.shaftD / 2);
  floorMesh.material = makeMaterial("mFloor", [0.18, 0.22, 0.32], 0.4);
  floorMesh.parent = tower;

  const wallH = C.floorY + 400;
  const wallT = 60;
  const wallMat = makeMaterial("mWall", [0.26, 0.3, 0.46], 0.25, 0.45);
  const mkWall = (name: string, w: number, d: number, px: number, pz: number, visible: boolean) => {
    const wall = MeshBuilder.CreateBox(name, { width: w, height: wallH, depth: d }, scene);
    wall.position = new Vector3(px, -wallH / 2 + 200, pz);
    wall.material = wallMat;
    wall.parent = tower;
    if (!visible) wall.setEnabled(false);
  };
  mkWall("w0", wallT, C.shaftD + wallT, -(C.shaftW / 2 + wallT / 2), 0, true);
  mkWall("w1", wallT, C.shaftD + wallT, C.shaftW / 2 + wallT / 2, 0, true);
  mkWall("w2", C.shaftW + wallT, wallT, 0, -(C.shaftD / 2 + wallT / 2), true);
  mkWall("w3", C.shaftW + wallT, wallT, 0, C.shaftD / 2 + wallT / 2, false); // camera side

  const MATS: Record<BlockType, StandardMaterial> = {
    glass: makeMaterial("mGlass", [0.3, 0.75, 0.95], 0.25, 0.62),
    stone: makeMaterial("mStone", [0.45, 0.47, 0.55], 0.1),
    bomb: makeMaterial("mBomb", [1.0, 0.62, 0.12], 0.7),
    bumper: makeMaterial("mBumper", [0.1, 1.0, 0.45], 0.85), // must scream "launcher"
    spike: makeMaterial("mSpike", [0.85, 0.12, 0.18], 0.5),
  };
  const glassShardMat = makeMaterial("mGlassShard", [0.55, 0.85, 1.0], 0.5, 0.75);
  glassShardMat.backFaceCulling = false;

  const blockInfo = new Map<number, BlockDef>();
  const blockMeshes = new Map<number, Mesh>();
  for (const b of layout) {
    blockInfo.set(b.id, b);
    const mesh = MeshBuilder.CreateBox(
      `b${b.id}`,
      { width: b.hx * 2 - 6, height: b.hy * 2 - 4, depth: b.hz * 2 - 6 },
      scene,
    );
    mesh.position = toLocal(b.cx, b.cy, b.cz);
    mesh.material = MATS[b.type];
    mesh.parent = tower;
    blockMeshes.set(b.id, mesh);
    if (b.type === "spike") {
      // Spikes must LOOK like spikes (owner): a 2×2 bed of cones on the base.
      for (const [ox, oz] of [
        [-22, -22],
        [-22, 22],
        [22, -22],
        [22, 22],
      ]) {
        const cone = MeshBuilder.CreateCylinder(
          `sp${b.id}`,
          { diameterTop: 0, diameterBottom: 34, height: 52, tessellation: 8 },
          scene,
        );
        cone.material = MATS.spike;
        cone.parent = mesh; // hides together with the base
        cone.position = new Vector3(ox, b.hy + 26, oz);
      }
    }
  }

  const ballMat = makeMaterial("mBall", [0.35, 0.9, 1.0], 0.5); // dimmer: the
  // glow halo was overpowering depth cues (owner: can't tell above/below tier)
  const ballMesh = MeshBuilder.CreateSphere("ball", { diameter: C.ballRadius * 2 }, scene);
  ballMesh.material = ballMat;
  ballMesh.parent = tower;

  const shards: Shard[] = [];
  const rings: Ring[] = [];
  let ballPulse = 0; // replaces camera shake (owner: shake reads as a glitch)
  let pendingHitStop = 0;

  function spawnShards(b: BlockDef, e: SimEvent): void {
    const base = toLocal(b.cx, b.cy, b.cz);
    const inherit = C.shardImpactInherit;
    const iv = e.cascade
      ? { x: 0, y: 260, z: 0 }
      : { x: (e.bvx ?? 0) * inherit, y: -(e.bvy ?? 0) * inherit * 0.7, z: (e.bvz ?? 0) * inherit };
    const heavy = b.type !== "glass"; // stone chunks; bombs also burst chunky
    // Bigger segments shed more debris.
    const volumeScale = Math.min(2, (b.hx * b.hz) / (2500 * 1.4));
    const n = Math.round((heavy ? 9 : 12) * Math.max(1, volumeScale));
    for (let i = 0; i < n; i++) {
      const glassy = b.type === "glass";
      let m: Mesh;
      let size: number;
      if (glassy) {
        // Real-glass look: irregular flat triangles (a disc with 3 sides),
        // random proportions, double-sided translucent material.
        size = 16 + Math.random() * 26;
        m = MeshBuilder.CreateDisc("sh", { radius: size, tessellation: 3 }, scene);
        m.material = glassShardMat;
        m.scaling.x = 0.5 + Math.random();
        m.scaling.y = 0.5 + Math.random();
        m.rotation.set(Math.random() * 3.14, Math.random() * 3.14, Math.random() * 3.14);
      } else {
        size = 26 + Math.random() * 18;
        m = MeshBuilder.CreateBox("sh", { size }, scene);
        m.material = MATS[b.type];
      }
      m.parent = tower;
      m.position = base.add(
        new Vector3((Math.random() - 0.5) * b.hx * 1.6, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * b.hz * 1.6),
      );
      const maxLife = 1.4 + Math.random() * 0.8;
      shards.push({
        mesh: m,
        vx: iv.x + (Math.random() - 0.5) * 800,
        vy: iv.y + 120 + Math.random() * 480,
        vz: iv.z + (Math.random() - 0.5) * 800,
        rx: (Math.random() - 0.5) * (glassy ? 14 : 10),
        rz: (Math.random() - 0.5) * (glassy ? 14 : 10),
        life: maxLife,
        maxLife,
        size,
      });
    }
    const ring = MeshBuilder.CreateDisc("ring", { radius: 70, tessellation: 32 }, scene);
    const rmat = makeMaterial(`rm${b.id}-${performance.now()}`, [1, 0.9, 0.6], 1);
    rmat.alpha = 0.55;
    ring.material = rmat;
    ring.rotation.x = Math.PI / 2;
    ring.position = base;
    ring.parent = tower;
    rings.push({ mesh: ring, mat: rmat, life: 0.4 });
  }

  function updateEffects(dtS: number): void {
    const floorTopLocal = -C.floorY;
    for (let i = shards.length - 1; i >= 0; i--) {
      const s = shards[i];
      s.life -= dtS;
      if (s.life <= 0) {
        s.mesh.dispose();
        shards.splice(i, 1);
        continue;
      }
      s.vy -= 2600 * dtS;
      s.mesh.position.x += s.vx * dtS;
      s.mesh.position.y += s.vy * dtS;
      s.mesh.position.z += s.vz * dtS;
      if (s.mesh.position.y < floorTopLocal + s.size / 2 && s.vy < 0) {
        s.mesh.position.y = floorTopLocal + s.size / 2;
        s.vy = -s.vy * 0.45;
        s.vx *= 0.7;
        s.vz *= 0.7;
        s.rx *= 0.5;
        s.rz *= 0.5;
      }
      s.mesh.rotation.x += s.rx * dtS;
      s.mesh.rotation.z += s.rz * dtS;
      s.mesh.scaling.setAll(Math.min(1, (s.life / s.maxLife) * 4));
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.life -= dtS;
      if (r.life <= 0) {
        r.mesh.dispose();
        r.mat.dispose();
        rings.splice(i, 1);
        continue;
      }
      const t = 1 - r.life / 0.4;
      r.mesh.scaling.setAll(0.4 + t * 2.6);
      r.mat.alpha = 0.55 * (1 - t);
    }
  }

  const camPos = new Vector3(C.spawn.x, -C.spawn.y + C.camHeight, C.spawn.z + C.camDist);
  const camAim = new Vector3(C.spawn.x, -C.spawn.y, C.spawn.z);

  // Unified aim beacon (owner design): the dark disc marks the PREDICTED
  // LANDING SPOT under the current steering, and a soft thread runs from the
  // ball along the real trajectory down to the disc. One instrument: where
  // the disc is, that is where you land.
  const N = C.laserPoints;
  const threadPts: Vector3[] = Array.from({ length: N }, () => new Vector3(0, 0, 0));
  const threadColors = Array.from({ length: N }, (_, i) => {
    const t = i / (N - 1);
    return new Color4(0.75, 0.88, 1, 0.5 - 0.38 * t);
  });
  let thread = MeshBuilder.CreateLines("aimThread", { points: threadPts, colors: threadColors, updatable: true }, scene);
  thread.parent = tower;
  thread.setEnabled(false);

  const landDisc = MeshBuilder.CreateDisc("landDisc", { radius: C.ballRadius * 1.05, tessellation: 28 }, scene);
  const landMat = new StandardMaterial("mLand", scene);
  landMat.diffuseColor = new Color3(0, 0, 0);
  landMat.specularColor = new Color3(0, 0, 0);
  landMat.emissiveColor = new Color3(0, 0, 0);
  landMat.alpha = 0.4;
  landDisc.material = landMat;
  landDisc.rotation.x = Math.PI / 2;
  landDisc.parent = tower;
  landDisc.setEnabled(false);

  return {
    engine,
    scene,
    syncBall(b) {
      ballMesh.position = toLocal(b.x, b.y, b.z);
    },
    applyEvents(events) {
      for (const e of events) {
        if (e.kind === "break" && e.id !== undefined) {
          blockMeshes.get(e.id)?.setEnabled(false);
          const info = blockInfo.get(e.id);
          if (info) spawnShards(info, e);
          ballPulse = 1;
          if (e.cascade) pendingHitStop = C.hitStopMs;
        } else if (e.kind === "bumper" && e.id !== undefined) {
          const info = blockInfo.get(e.id);
          if (info) {
            const ring = MeshBuilder.CreateDisc("ring", { radius: 70, tessellation: 32 }, scene);
            const rmat = makeMaterial(`rb${e.id}-${performance.now()}`, [0.3, 1, 0.6], 1);
            rmat.alpha = 0.6;
            ring.material = rmat;
            ring.rotation.x = Math.PI / 2;
            ring.position = toLocal(info.cx, info.cy - info.hy - 4, info.cz);
            ring.parent = tower;
            rings.push({ mesh: ring, mat: rmat, life: 0.35 });
          }
          ballPulse = Math.max(ballPulse, 0.7);
        }
      }
    },
    consumeHitStop() {
      const v = pendingHitStop;
      pendingHitStop = 0;
      return v;
    },
    resetBlocks() {
      for (const [, mesh] of blockMeshes) mesh.setEnabled(true);
    },
    setAim(points, disc, wallHit = false) {
      if (!points || points.length < 2 || !C.laserOn) {
        thread.setEnabled(false);
        landDisc.setEnabled(false);
        return;
      }
      thread.setEnabled(true);
      // A wall-cut path has no honest landing — hide the disc unless the
      // user is actively driving it (then it is a target, not a landing).
      landDisc.setEnabled(Boolean(disc) || !wallHit);
      if (!disc && wallHit) {
        for (let i = 0; i < N; i++) {
          const src = points[Math.round((i * (points.length - 1)) / (N - 1))];
          threadPts[i].set(src.x - C.shaftW / 2, -src.y, src.z - C.shaftD / 2);
        }
        thread = MeshBuilder.CreateLines("aimThread", { points: threadPts, instance: thread });
        return;
      }
      // Resample the (possibly multi-tier) path evenly onto N thread points.
      for (let i = 0; i < N; i++) {
        const src = points[Math.round((i * (points.length - 1)) / (N - 1))];
        threadPts[i].set(src.x - C.shaftW / 2, -src.y, src.z - C.shaftD / 2);
      }
      thread = MeshBuilder.CreateLines("aimThread", { points: threadPts, instance: thread });
      // Disc: the user-driven target when steering, else the predicted landing.
      const land = disc ?? points[points.length - 1];
      landDisc.position = toLocal(land.x, land.y - 3, land.z);
      // Nearer landing → denser disc (height reads for free).
      const dist = Math.max(0, land.y - points[0].y);
      landMat.alpha = 0.2 + 0.3 * (1 - Math.min(1, dist / 2600));
    },
    screenToShaft(clientX, clientY, planeY) {
      const scaleX = engine.getRenderWidth() / Math.max(1, canvas.clientWidth);
      const scaleY = engine.getRenderHeight() / Math.max(1, canvas.clientHeight);
      const ray = scene.createPickingRay(clientX * scaleX, clientY * scaleY, null, camera);
      const targetWorldY = -planeY; // sim y-down → babylon y-up
      if (Math.abs(ray.direction.y) < 1e-6) return null;
      const t = (targetWorldY - ray.origin.y) / ray.direction.y;
      if (t <= 0) return null;
      return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
    },
    frame(frameMs, tilt) {
      updateEffects(frameMs / 1000);
      const maxRad = (C.maxVisualTiltDeg * Math.PI) / 180;
      tower.rotation.z = C.visualTiltSignX * tilt.x * maxRad;
      tower.rotation.x = C.visualTiltSignZ * tilt.z * maxRad;

      // Ball pulse: the impact feedback that replaced camera shake.
      ballPulse *= 0.9;
      const glowK = 0.5 + ballPulse * 0.8;
      ballMat.emissiveColor.set(0.35 * glowK, 0.9 * glowK, 1.0 * glowK);
      ballMesh.scaling.setAll(1 + ballPulse * 0.25);

      ballMesh.computeWorldMatrix(true);
      const p = ballMesh.getAbsolutePosition();
      // Zoom OUT with tilt, plus extra zoom-out on portrait aspect so the
      // shaft width always fits the screen (owner feedback).
      const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
      const aspectZoom = Math.max(1, C.portraitTargetAspect / Math.max(0.2, aspect));
      const tiltMag = Math.max(Math.abs(tilt.x), Math.abs(tilt.z));
      const zoom = (1 + C.camTiltZoom * tiltMag) * aspectZoom;
      // Fog tracks the camera zoom — zooming out must never drown the tower.
      scene.fogStart = C.fogStart * zoom;
      scene.fogEnd = C.fogEnd * zoom;
      const gx = p.x;
      const gy = p.y + C.camHeight * zoom;
      const gz = p.z + C.camDist * zoom;
      camPos.x += (gx - camPos.x) * C.camSmooth;
      camPos.y += (gy - camPos.y) * C.camSmooth;
      camPos.z += (gz - camPos.z) * C.camSmooth;
      // Look AHEAD of the fall (below the ball) — the next tier is the star.
      const aimY = p.y - C.camAimAheadY;
      camAim.x += (p.x - camAim.x) * C.camSmooth;
      camAim.y += (aimY - camAim.y) * C.camSmooth;
      camAim.z += (p.z - camAim.z) * C.camSmooth;
      camera.position.set(camPos.x, camPos.y, camPos.z);
      camera.setTarget(camAim);
    },
  };
}
