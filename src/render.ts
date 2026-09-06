// Babylon renderer — mirrors SimState, owns all juice (shards, shockwaves,
// shake, hit-stop, glow). The sim never reads anything from here.
//
// Built for phones. Three rules keep the frame cheap and none of them changes
// a pixel:
//  - Anything opaque that repeats (block bodies, spike cones, mines, shards)
//    is a hardware INSTANCE of one template mesh: one draw call per template,
//    not one per block. Glass blocks and the face marks stay individual meshes
//    because they are alpha-blended and Babylon sorts those per mesh — a batch
//    would draw them in one order and the see-through tint would shift.
//  - Effects (shards, rings, lightning, the comet tail) are POOLED and
//    reused, never created and disposed mid-run. Building a mesh is a GPU
//    buffer upload; a chain reaction used to build hundreds in half a second.
//  - Tiers the camera has fallen past are DISPOSED. The scene walks every mesh
//    twice a frame (main pass and glow pass), and a deep run used to carry the
//    whole tower behind it: six thousand meshes at depth 80.
import "@babylonjs/core/Culling/ray"; // side-effect: enables scene.createPickingRay
import "@babylonjs/core/Meshes/instancedMesh"; // side-effect: enables mesh.createInstance
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CONFIG } from "./config.js";
import type { BlockDef, BlockType } from "./levelgen.js";
import type { SimEvent } from "./sim.js";
import { SKINS, drawSkin, skinImage } from "./skins.js";
import { FIXED_BLOCK_RGB, paletteAt } from "./biomes.js";

interface Shard {
  mesh: AbstractMesh;
  tpl: Mesh; // the pool it goes back to
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
  tess: number;
  radius: number;
  life: number;
}

export interface Renderer {
  engine: Engine;
  scene: Scene;
  // Velocity comes along so the ball can ROLL — render-only, the sim never
  // hears about it, so replays are untouched.
  syncBall: (b: { x: number; y: number; z: number; vx: number; vy: number; vz: number }) => void;
  applyEvents: (events: SimEvent[]) => void;
  frame: (frameMs: number, tilt: { x: number; z: number }) => void;
  consumeHitStop: () => number;
  setLayout: (blocks: BlockDef[]) => void; // new run: rebuild all block meshes
  syncLayout: (blocks: BlockDef[]) => void; // streamed tiers: add the new ones
  setSkin: (id: string) => void;
  setBallMode: (mode: "skin" | "lead") => void; // HEAVY booster look
  setTrail: (on: boolean) => void; // AGILITY comet tail
  setShield: (on: boolean) => void; // shield aura around the ball
  jumpFx: (b: { x: number; y: number; z: number }) => void;
  setAim: (
    points: { x: number; y: number; z: number }[] | null,
    disc?: { x: number; y: number; z: number } | null,
    wallHit?: boolean,
  ) => void;
  // Screen (client px) → sim XZ on the horizontal plane at sim height planeY.
  screenToShaft: (clientX: number, clientY: number, planeY: number) => { x: number; z: number } | null;
}

// Emissive is light a surface makes regardless of where the sun is, so it
// erases the shading that tells one cube face from another — and the glow
// layer blurs every emissive pixel. At 0.25 on walls, glass AND stone the
// entire scene was a glow source, which is what read as a permanent haze.
// Kept small: enough to lift the dark layers, not enough to flatten them.
const EMIT_WALL = 0.07;
const EMIT_GLASS = 0.1; // glass may look lit — it is the thing you smash
const EMIT_STONE = 0.05;

const HEMI_BASE = 0.45;
const SUN_BASE = 1.0;

// A tier this far above the ball is above the camera for any screen shape,
// and the highest the ball can be thrown back up (a bumper at top speed) is
// under half of it. Its meshes can go.
const DROP_TIERS_ABOVE = 2;

export function createRenderer(canvas: HTMLCanvasElement, layout: BlockDef[]): Renderer {
  const C = CONFIG;
  // No MSAA on the backbuffer: the scene renders into the post-process
  // chain and FXAA is the anti-aliasing. Multisampling the final full-screen
  // quad resolved to the same pixels and cost bandwidth every frame.
  const engine = new Engine(canvas, false);
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.05, 0.06, 0.1, 1);
  // Nothing here is picked with the pointer; steering is a ray against a
  // plane in screenToShaft. Without these the scene ray-casts every pickable
  // mesh on every pointer move — a finger drag is a hundred moves a second.
  scene.skipPointerMovePicking = true;
  scene.skipPointerDownPicking = true;
  scene.skipPointerUpPicking = true;

  // A hemispheric light hits every face of a cube almost equally, so when it
  // outweighs the sun the tower flattens into silhouettes and the only way to
  // get blocks back is to add light — which is how the biomes ended up above
  // 1.0 ambient. Keeping the sun dominant buys that readability from CONTRAST
  // instead, at less total light. Both bases are named because the per-frame
  // biome update below rescales them and the two must not drift apart.
  const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), scene);
  hemi.intensity = HEMI_BASE;
  hemi.groundColor = new Color3(0.15, 0.15, 0.2);
  const sun = new DirectionalLight("sun", new Vector3(-0.35, -1, -0.25), scene);
  sun.intensity = SUN_BASE;

  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = new Color3(0.05, 0.06, 0.1);
  scene.fogStart = C.fogStart;
  scene.fogEnd = C.fogEnd;

  const camera = new TargetCamera("camera", new Vector3(0, 0, 0), scene);
  camera.fov = C.camFov;
  scene.activeCamera = camera;

  const glow = new GlowLayer("glow", scene);
  glow.intensity = 0.28; // screen-space glow halos leak over occluders — keep modest
  const pipeline = new DefaultRenderingPipeline("pp", false, scene, [camera]);
  // Bloom sits on top of the glow layer, so the two stack. Threshold keeps it
  // to genuine highlights instead of veiling the whole frame.
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.9;
  pipeline.bloomWeight = 0.08;
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

  // A template is the one mesh its instances share geometry and material
  // with. Invisible itself, enabled so Babylon still walks it; the instances
  // are what get drawn. Parented to the tower and parked at the ball each
  // frame, so a translucent template's batch sorts among the other
  // transparent meshes where its shards actually are.
  const templates: Mesh[] = [];
  function template(m: Mesh, mat: StandardMaterial): Mesh {
    m.material = mat;
    m.isVisible = false;
    m.isPickable = false;
    m.parent = tower;
    templates.push(m);
    return m;
  }

  // Endless tower: no floor. Walls are long boxes repositioned to follow the
  // ball so the shaft never visually ends.
  const wallH = 30000;
  const wallT = 60;
  const wallMat = makeMaterial("mWall", [0.26, 0.3, 0.46], 0.25, 0.45);
  const walls: Mesh[] = [];
  const mkWall = (name: string, w: number, d: number, px: number, pz: number, visible: boolean) => {
    const wall = MeshBuilder.CreateBox(name, { width: w, height: wallH, depth: d }, scene);
    wall.position = new Vector3(px, 0, pz);
    wall.material = wallMat;
    wall.parent = tower;
    if (!visible) wall.setEnabled(false);
    walls.push(wall);
  };
  mkWall("w0", wallT, C.shaftD + wallT, -(C.shaftW / 2 + wallT / 2), 0, true);
  mkWall("w1", wallT, C.shaftD + wallT, C.shaftW / 2 + wallT / 2, 0, true);
  mkWall("w2", C.shaftW + wallT, wallT, 0, -(C.shaftD / 2 + wallT / 2), true);
  mkWall("w3", C.shaftW + wallT, wallT, 0, C.shaftD / 2 + wallT / 2, false); // camera side

  const MATS: Record<BlockType, StandardMaterial> = {
    glass: makeMaterial("mGlass", [0.3, 0.75, 0.95], 0.25, 0.62),
    // Stone must read as STONE (owner): matte earthy brown, zero glow.
    stone: makeMaterial("mStone", [0.42, 0.33, 0.24], 0),
    // Emissive kept low enough that the glow layer cannot bleed over the mark
    // drawn on the face — these two were the brightest things in the scene.
    bomb: makeMaterial("mBomb", FIXED_BLOCK_RGB.bomb, 0.35),
    bumper: makeMaterial("mBumper", FIXED_BLOCK_RGB.bumper, 0.4), // must scream "launcher"
    spike: makeMaterial("mSpike", FIXED_BLOCK_RGB.spike, 0.5),
    mine: makeMaterial("mMine", FIXED_BLOCK_RGB.mine, 0.9), // pulsing danger red
  };
  const glassShardMat = makeMaterial("mGlassShard", [0.55, 0.85, 1.0], 0.5, 0.75);
  glassShardMat.backFaceCulling = false;
  // Ball-death debris: plain bright colors, never the skin texture (owner).
  const deathMats = [
    makeMaterial("mDeath0", [1, 0.85, 0.4], 0.9),
    makeMaterial("mDeath1", [1, 0.45, 0.25], 0.9),
    makeMaterial("mDeath2", [0.6, 0.9, 1], 0.9),
    makeMaterial("mDeath3", [1, 1, 1], 0.8),
  ];

  // Opaque block bodies: a unit cube per material, scaled per instance.
  const unitBox = (name: string, mat: StandardMaterial) =>
    template(MeshBuilder.CreateBox(name, { size: 1 }, scene), mat);
  const BODY: Partial<Record<BlockType, Mesh>> = {
    stone: unitBox("tplStone", MATS.stone),
    bomb: unitBox("tplBomb", MATS.bomb),
    bumper: unitBox("tplBumper", MATS.bumper),
    spike: unitBox("tplSpike", MATS.spike),
  };
  const coneTemplate = template(
    MeshBuilder.CreateCylinder("tplCone", { diameterTop: 0, diameterBottom: 34, height: 52, tessellation: 8 }, scene),
    MATS.spike,
  );
  // Debris: a unit shape per material, scaled to the shard's size.
  const SHARD_BOX: Partial<Record<BlockType, Mesh>> = {
    stone: unitBox("tplShStone", MATS.stone),
    bomb: unitBox("tplShBomb", MATS.bomb),
    mine: unitBox("tplShMine", MATS.mine),
  };
  const shardDisc = template(MeshBuilder.CreateDisc("tplShGlass", { radius: 1, tessellation: 3 }, scene), glassShardMat);
  const deathBox = deathMats.map((m, i) => unitBox(`tplDeath${i}`, m));

  // Top-face marks. A bomb is the thing worth aiming at and a bumper is a
  // launcher, but both read as "a coloured block" until something on the face
  // says otherwise. Drawn once into a shared material rather than per block.
  function markMaterial(name: string, draw: (c: CanvasRenderingContext2D, s: number) => void): StandardMaterial {
    const S = 128;
    const tex = new DynamicTexture(name, { width: S, height: S }, scene, false);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, S, S);
    draw(ctx, S);
    tex.update();
    tex.hasAlpha = true;
    const m = new StandardMaterial(`${name}Mat`, scene);
    m.diffuseTexture = tex;
    m.opacityTexture = tex;
    m.emissiveColor = new Color3(1, 1, 1);
    m.specularColor = new Color3(0, 0, 0);
    // Unlit: the mark must stay legible on a face the sun has turned away from.
    m.disableLighting = true;
    m.backFaceCulling = false;
    return m;
  }

  const MARK_MATS: Partial<Record<BlockType, StandardMaterial>> = {
    // A target: what you want to hit.
    bomb: markMaterial("markBomb", (c, S) => {
      const r = S / 2;
      c.strokeStyle = "rgba(12,10,6,0.88)";
      c.lineCap = "round";
      c.lineWidth = S * 0.085;
      c.beginPath();
      c.arc(r, r, S * 0.3, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.arc(r, r, S * 0.1, 0, Math.PI * 2);
      c.fillStyle = "rgba(12,10,6,0.88)";
      c.fill();
      for (const [dx, dy] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        c.beginPath();
        c.moveTo(r + dx * S * 0.22, r + dy * S * 0.22);
        c.lineTo(r + dx * S * 0.45, r + dy * S * 0.45);
        c.stroke();
      }
    }),
    // A ring with an upward chevron: it throws you back up.
    bumper: markMaterial("markBumper", (c, S) => {
      const r = S / 2;
      c.strokeStyle = "rgba(8,20,12,0.8)";
      c.lineCap = "round";
      c.lineJoin = "round";
      c.lineWidth = S * 0.08;
      c.beginPath();
      c.arc(r, r, S * 0.33, 0, Math.PI * 2);
      c.stroke();
      c.lineWidth = S * 0.1;
      c.beginPath();
      c.moveTo(r - S * 0.16, r + S * 0.1);
      c.lineTo(r, r - S * 0.11);
      c.lineTo(r + S * 0.16, r + S * 0.1);
      c.stroke();
    }),
  };

  // A MINE is built once and instanced. Spiky is fifteen meshes a mine if
  // built naively, and there are dozens on screen deep down; merged and
  // instanced, every mine on screen is one draw.
  // Reach stays 30 as before, so a mine is still caught where it always was —
  // the sphere shrinks and the spikes take up the difference.
  const mineTemplate = (() => {
    const core = MeshBuilder.CreateSphere("mineCore", { diameter: 26, segments: 10 }, scene);
    const parts = [core];
    // Six axes plus the eight cube diagonals: enough to read as a mine from any
    // angle without turning into a pincushion.
    const dirs: [number, number, number][] = [];
    for (const a of [-1, 0, 1]) {
      for (const b of [-1, 0, 1]) {
        for (const c of [-1, 0, 1]) {
          const nz = Math.abs(a) + Math.abs(b) + Math.abs(c);
          if (nz === 1 || nz === 3) dirs.push([a, b, c]);
        }
      }
    }
    for (const d of dirs) {
      const dir = new Vector3(d[0], d[1], d[2]).normalize();
      const spike = MeshBuilder.CreateCylinder(
        "mineSpike",
        { diameterTop: 0, diameterBottom: 8, height: 22, tessellation: 6 },
        scene,
      );
      // A cylinder points along +Y; turn it to face outward. Straight up needs
      // no turn, straight down needs a flip — the cross product is zero for
      // both and cannot be normalised.
      const up = Vector3.Up();
      const dot = Vector3.Dot(up, dir);
      spike.rotationQuaternion =
        dot > 0.9999
          ? Quaternion.Identity()
          : dot < -0.9999
            ? Quaternion.RotationAxis(Vector3.Right(), Math.PI)
            : Quaternion.RotationAxis(Vector3.Cross(up, dir).normalize(), Math.acos(dot));
      spike.position = dir.scale(19); // 19 + half of 22 = 30 at the tip, as before
      parts.push(spike);
    }
    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
    return template(merged, MATS.mine);
  })();

  const blockInfo = new Map<number, BlockDef>();
  // Every mesh a block owns: its body plus the mark or the cones on it. Marks
  // and cones hang off the tower, not the body — a body is a scaled instance
  // and a child would inherit the scale.
  const blockMeshes = new Map<number, AbstractMesh[]>();
  const tierIds = new Map<number, number[]>(); // block ids per tier, for disposal
  const tierOf = (id: number) => Math.floor(id / 1000); // levelgen: id = tier * 1000 + n
  let lowestLiveTier = 0;
  let synced = 0; // how much of the sim's block list has meshes

  function addBlockMesh(b: BlockDef): void {
    blockInfo.set(b.id, b);
    const parts: AbstractMesh[] = [];
    let body: AbstractMesh;
    if (b.type === "mine") {
      // A MINE must read as lethal: a spiked ball, not a berry.
      body = mineTemplate.createInstance(`b${b.id}`);
    } else if (b.type === "glass") {
      // Translucent, so it stays its own mesh and sorts by its own distance.
      body = MeshBuilder.CreateBox(
        `b${b.id}`,
        { width: b.hx * 2 - 6, height: b.hy * 2 - 4, depth: b.hz * 2 - 6 },
        scene,
      );
      body.material = MATS.glass;
    } else {
      body = BODY[b.type]!.createInstance(`b${b.id}`);
      body.scaling.set(b.hx * 2 - 6, b.hy * 2 - 4, b.hz * 2 - 6);
    }
    body.position = toLocal(b.cx, b.cy, b.cz);
    body.parent = tower;
    parts.push(body);
    const mark = MARK_MATS[b.type];
    if (mark) {
      // Fixed size, so it stays an icon on a wide block instead of stretching
      // into wallpaper.
      const size = Math.min(Math.min(b.hx, b.hz) * 1.5, 96);
      const face = MeshBuilder.CreatePlane(`mk${b.id}`, { size }, scene);
      face.material = mark;
      face.parent = tower;
      face.rotation.x = -Math.PI / 2; // lie flat on the top face
      face.position = toLocal(b.cx, b.cy - (b.hy - 1), b.cz);
      face.isPickable = false;
      parts.push(face);
    }
    if (b.type === "spike") {
      for (const [ox, oz] of [
        [-22, -22],
        [-22, 22],
        [22, -22],
        [22, 22],
      ]) {
        const cone = coneTemplate.createInstance(`sp${b.id}`);
        cone.parent = tower;
        cone.position = toLocal(b.cx + ox, b.cy - (b.hy + 26), b.cz + oz);
        parts.push(cone);
      }
    }
    blockMeshes.set(b.id, parts);
    const t = tierOf(b.id);
    const ids = tierIds.get(t);
    if (ids) ids.push(b.id);
    else tierIds.set(t, [b.id]);
  }
  function disposeTier(t: number): void {
    for (const id of tierIds.get(t) ?? []) {
      for (const m of blockMeshes.get(id) ?? []) m.dispose();
      blockMeshes.delete(id);
      blockInfo.delete(id);
    }
    tierIds.delete(t);
  }
  for (const b of layout) addBlockMesh(b);
  synced = layout.length;

  let skinBase = SKINS.core;
  const ballMat = makeMaterial("mBall", skinBase.rgb, skinBase.emissive);
  const leadMat = new StandardMaterial("mLead", scene);
  leadMat.diffuseColor = new Color3(0.42, 0.44, 0.5);
  leadMat.specularColor = new Color3(0.6, 0.6, 0.65);
  leadMat.emissiveColor = new Color3(0.06, 0.06, 0.08);
  // Shield aura mesh: follows the ball each frame.
  const shieldMesh = MeshBuilder.CreateSphere("shield", { diameter: C.ballRadius * 3.1, segments: 14 }, scene);
  shieldMesh.parent = tower;
  const shieldMat = new StandardMaterial("mShield", scene);
  shieldMat.emissiveColor = new Color3(0.35, 0.95, 0.6);
  shieldMat.diffuseColor = new Color3(0, 0, 0);
  shieldMat.specularColor = new Color3(0, 0, 0);
  shieldMat.alpha = 0.14;
  shieldMat.backFaceCulling = false;
  shieldMesh.material = shieldMat;
  shieldMesh.setEnabled(false);

  const skinTextures = new Map<string, BaseTexture>();
  // Procedural skins are drawn once into a canvas; shop skins are a painted
  // file. Either way the texture is cached, because setSkin runs on every boot
  // and on every purchase.
  function skinTexture(id: string): BaseTexture | null {
    const cached = skinTextures.get(id);
    if (cached) return cached;

    const url = skinImage(id);
    if (url) {
      // Only the WORN skin is fetched — the shop shows thumbnails, so opening
      // it does not pull a megabyte of full-size textures.
      const t = new Texture(url, scene);
      t.wrapU = Texture.WRAP_ADDRESSMODE; // the seam runs down the back
      skinTextures.set(id, t);
      return t;
    }

    if (!SKINS[id]?.pattern) return null;
    const t = new DynamicTexture(`skin-${id}`, 256, scene, false);
    drawSkin(t.getContext() as unknown as CanvasRenderingContext2D, id, 256);
    t.update();
    skinTextures.set(id, t);
    return t;
  }

  const ballMesh = MeshBuilder.CreateSphere("ball", { diameter: C.ballRadius * 2 }, scene);
  ballMesh.material = ballMat;
  ballMesh.parent = tower;

  const shards: Shard[] = [];
  const rings: Ring[] = [];
  let ballSimY = 0; // sim-space depth, drives the biome palette
  let ballPulse = 0; // replaces camera shake (owner: shake reads as a glitch)
  let pendingHitStop = 0;
  // AGILITY comet tail: a hand-built ribbon over the ball's recent positions
  // with PER-VERTEX alpha — opaque at the ball, fading to zero at the tip
  // (owner: TrailMesh's flat alpha cut off too abruptly).
  const TRAIL_SEGMENTS = 26;
  let trailOn = false;
  let trailRibbon: Mesh | null = null;
  let trailMat: StandardMaterial | null = null;
  const trailHistory: Vector3[] = [];
  // Fixed-capacity buffers, updated in place. The ribbon used to be rebuilt as
  // a new mesh every frame the tail was on.
  const trailPos = new Float32Array(TRAIL_SEGMENTS * 2 * 3);
  const trailCol = new Float32Array(TRAIL_SEGMENTS * 2 * 4);
  // SHIELD aura: an ethereal breathing sphere around the ball while shields
  // are up (owner).
  let shieldOn = false;
  let shieldPhase = 0;

  // Shard pool: spent instances go back to their template's free list.
  const shardFree = new Map<Mesh, AbstractMesh[]>();
  function takeShard(tpl: Mesh): AbstractMesh {
    const free = shardFree.get(tpl);
    const m = free?.pop();
    if (m) {
      m.setEnabled(true);
      m.rotation.set(0, 0, 0);
      return m;
    }
    const inst = tpl.createInstance("sh");
    inst.parent = tower;
    inst.isPickable = false;
    return inst;
  }
  function dropShard(s: Shard): void {
    s.mesh.setEnabled(false);
    const free = shardFree.get(s.tpl);
    if (free) free.push(s.mesh);
    else shardFree.set(s.tpl, [s.mesh]);
  }

  // Ring pool. Each ring fades on its own, so it keeps its own material; the
  // disc is unit-sized and scaled to the radius asked for.
  const ringFree: Ring[] = [];
  function takeRing(radius: number, tess: number, rgb: [number, number, number], alpha: number, life: number): Ring {
    const i = ringFree.findIndex((r) => r.tess === tess);
    let r: Ring;
    if (i >= 0) {
      r = ringFree.splice(i, 1)[0];
      r.mesh.setEnabled(true);
    } else {
      const mesh = MeshBuilder.CreateDisc("ring", { radius: 1, tessellation: tess }, scene);
      const mat = makeMaterial("mRing", rgb, 1);
      mesh.material = mat;
      mesh.rotation.x = Math.PI / 2;
      mesh.parent = tower;
      mesh.isPickable = false;
      r = { mesh, mat, tess, radius, life };
    }
    r.mat.diffuseColor.set(rgb[0], rgb[1], rgb[2]);
    r.mat.emissiveColor.set(rgb[0], rgb[1], rgb[2]);
    r.mat.alpha = alpha;
    r.radius = radius;
    r.life = life;
    rings.push(r);
    return r;
  }

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
      let m: AbstractMesh;
      let tpl: Mesh;
      let size: number;
      if (glassy) {
        // Real-glass look: irregular flat triangles (a disc with 3 sides),
        // double-sided translucent material.
        size = 16 + Math.random() * 26;
        tpl = shardDisc;
        m = takeShard(tpl);
        m.scaling.set(size * (0.5 + Math.random()), size * (0.5 + Math.random()), size);
        m.rotation.set(Math.random() * 3.14, Math.random() * 3.14, Math.random() * 3.14);
      } else {
        size = 26 + Math.random() * 18;
        tpl = SHARD_BOX[b.type]!;
        m = takeShard(tpl);
        m.scaling.setAll(size);
      }
      m.position.set(
        base.x + (Math.random() - 0.5) * b.hx * 1.6,
        base.y + (Math.random() - 0.5) * 80,
        base.z + (Math.random() - 0.5) * b.hz * 1.6,
      );
      const maxLife = 1.4 + Math.random() * 0.8;
      shards.push({
        mesh: m,
        tpl,
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
    takeRing(70, 32, [1, 0.9, 0.6], 0.55, 0.4).mesh.position.copyFrom(base);
  }

  // Lightning between one detonation and the next it triggers, so a CHAIN
  // visibly propagates instead of just going off everywhere at once.
  const arcs: { mesh: LinesMesh; life: number }[] = [];
  const arcFree: LinesMesh[] = [];
  let shakeMs = 0;

  function spawnArc(from: Vector3, to: Vector3): void {
    const n = CONFIG.arcSegments;
    const pts: Vector3[] = [from];
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const p = Vector3.Lerp(from, to, t);
      // Jitter fades out at both ends so the bolt still starts and lands on
      // the two explosions rather than near them.
      const k = Math.sin(t * Math.PI) * CONFIG.arcJitter;
      pts.push(
        new Vector3(
          p.x + (Math.random() - 0.5) * k,
          p.y + (Math.random() - 0.5) * k,
          p.z + (Math.random() - 0.5) * k,
        ),
      );
    }
    pts.push(to);
    let line = arcFree.pop();
    if (line) {
      line = MeshBuilder.CreateLines("arc", { points: pts, instance: line });
      line.setEnabled(true);
    } else {
      line = MeshBuilder.CreateLines("arc", { points: pts, updatable: true }, scene);
      line.color = new Color3(0.75, 0.92, 1);
      line.parent = tower;
      line.isPickable = false;
      line.alwaysSelectAsActiveMesh = true; // its bounds move with every reuse
    }
    arcs.push({ mesh: line, life: CONFIG.arcLifeS });
  }

  // syncBall runs outside frame(), so the last frame's length is kept for it.
  let lastFrameS = 1 / 60;

  function updateEffects(dtS: number): void {
    lastFrameS = dtS;
    for (let i = arcs.length - 1; i >= 0; i--) {
      const a = arcs[i];
      a.life -= dtS;
      if (a.life <= 0) {
        a.mesh.setEnabled(false);
        arcFree.push(a.mesh);
        arcs.splice(i, 1);
        continue;
      }
      a.mesh.alpha = a.life / CONFIG.arcLifeS;
    }
    for (let i = shards.length - 1; i >= 0; i--) {
      const s = shards[i];
      s.life -= dtS;
      if (s.life <= 0) {
        dropShard(s);
        shards.splice(i, 1);
        continue;
      }
      s.vy -= 2600 * dtS;
      s.mesh.position.x += s.vx * dtS;
      s.mesh.position.y += s.vy * dtS;
      s.mesh.position.z += s.vz * dtS;
      // No floor in the endless tower — debris tumbles into the abyss.
      s.mesh.rotation.x += s.rx * dtS;
      s.mesh.rotation.z += s.rz * dtS;
      s.mesh.scaling.setAll(s.size * Math.min(1, (s.life / s.maxLife) * 4));
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.life -= dtS;
      if (r.life <= 0) {
        r.mesh.setEnabled(false);
        ringFree.push(r);
        rings.splice(i, 1);
        continue;
      }
      const t = 1 - r.life / 0.4;
      r.mesh.scaling.setAll(r.radius * (0.4 + t * 2.6));
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

  const restY = (tier: number) => C.firstTierTopY + tier * C.tierSpacing + C.blockH;

  return {
    engine,
    scene,
    syncBall(b) {
      ballSimY = b.y;
      ballMesh.position.set(b.x - C.shaftW / 2, -b.y, b.z - C.shaftD / 2);

      // Rolling, so the whole skin comes past instead of one frozen face.
      //
      // A ball falling straight down has no rolling axis of its own — the
      // cross product of velocity and up is zero — so the fall drives a tumble
      // about a fixed horizontal axis, and steering rolls it sideways the way
      // a real ball would. Purely cosmetic: the sim has no angular anything.
      const r = C.ballRadius;
      const ax = b.vz / r + (b.vy / r) * C.ballTumble; // sideways + the fall
      const az = -b.vx / r;
      const rate = Math.sqrt(ax * ax + az * az);
      if (rate > 1e-4) {
        // Capped, because terminal velocity would otherwise spin it into a
        // blur and the texture would read as a grey smear.
        const step = Math.min(rate, C.ballSpinMax) * lastFrameS;
        const spin = Quaternion.RotationAxis(new Vector3(ax / rate, 0, az / rate), step);
        // Pre-multiplied: the axis is in the tower's frame, not the ball's, so
        // the roll stays put as the ball turns.
        ballMesh.rotationQuaternion = spin.multiply(ballMesh.rotationQuaternion ?? Quaternion.Identity());
      }
    },
    applyEvents(events) {
      for (const e of events) {
        if (e.kind === "arc" && e.from && e.to) {
          spawnArc(toLocal(e.from.x, e.from.y, e.from.z), toLocal(e.to.x, e.to.y, e.to.z));
        } else if (e.kind === "shake") {
          shakeMs = CONFIG.quakeShakeMs;
        } else if (e.kind === "break" && e.id !== undefined) {
          for (const m of blockMeshes.get(e.id) ?? []) m.setEnabled(false);
          const info = blockInfo.get(e.id);
          if (info) spawnShards(info, e);
          ballPulse = 1;
          // No hit-stop on explosions (owner: repeated freezes read as
          // jitter). Time effects are the sim-side slow-mo showcase only.
        } else if ((e.kind === "mine" || e.kind === "shield" || e.kind === "mineblast") && e.id !== undefined) {
          // Mine detonation: violent red burst; on a shield hit you survive it.
          const info = blockInfo.get(e.id);
          for (const m of blockMeshes.get(e.id) ?? []) m.setEnabled(false);
          if (info) {
            const at = toLocal(info.cx, info.cy, info.cz);
            for (let i = 0; i < 22; i++) {
              const size = 18 + Math.random() * 26;
              const m = takeShard(SHARD_BOX.mine!);
              m.scaling.setAll(size);
              m.position.set(
                at.x + (Math.random() - 0.5) * 90,
                at.y + (Math.random() - 0.5) * 90,
                at.z + (Math.random() - 0.5) * 90,
              );
              const maxLife = 1.2 + Math.random() * 0.9;
              shards.push({
                mesh: m,
                tpl: SHARD_BOX.mine!,
                vx: (Math.random() - 0.5) * 1600,
                vy: 200 + Math.random() * 900,
                vz: (Math.random() - 0.5) * 1600,
                rx: (Math.random() - 0.5) * 14,
                rz: (Math.random() - 0.5) * 14,
                life: maxLife,
                maxLife,
                size,
              });
            }
            for (let ri = 0; ri < 3; ri++) {
              const ring = takeRing(60 + ri * 30, 32, [1, 0.25, 0.15], 0.6, 0.5 + ri * 0.12);
              ring.mesh.position.set(at.x, at.y + 10 + ri * 8, at.z);
            }
          }
          ballPulse = 1;
          if (e.kind === "mine") {
            pendingHitStop = 220; // the death beat — never on ordinary blasts
            // Death scene (owner): the BALL itself shatters before the
            // overlay fades in.
            ballMesh.computeWorldMatrix(true);
            const bp = ballMesh.position;
            ballMesh.setEnabled(false);
            for (let i = 0; i < 64; i++) {
              // Small plain-colored debris, no skin texture (owner).
              const size = 7 + Math.random() * 13;
              const tpl = deathBox[i % deathBox.length];
              const m = takeShard(tpl);
              m.scaling.setAll(size);
              m.position.set(
                bp.x + (Math.random() - 0.5) * 70,
                bp.y + (Math.random() - 0.5) * 70,
                bp.z + (Math.random() - 0.5) * 70,
              );
              const maxLife = 1.5 + Math.random() * 1.0;
              shards.push({
                mesh: m,
                tpl,
                vx: (Math.random() - 0.5) * 2000,
                vy: 300 + Math.random() * 1100,
                vz: (Math.random() - 0.5) * 2000,
                rx: (Math.random() - 0.5) * 16,
                rz: (Math.random() - 0.5) * 16,
                life: maxLife,
                maxLife,
                size,
              });
            }
          }
        } else if (e.kind === "bumper" && e.id !== undefined) {
          const info = blockInfo.get(e.id);
          if (info) {
            const ring = takeRing(70, 32, [0.3, 1, 0.6], 0.6, 0.35);
            ring.mesh.position = toLocal(info.cx, info.cy - info.hy - 4, info.cz);
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
    setLayout(blocks) {
      for (const [, parts] of blockMeshes) for (const m of parts) m.dispose();
      blockMeshes.clear();
      blockInfo.clear();
      tierIds.clear();
      lowestLiveTier = 0;
      for (const b of blocks) addBlockMesh(b);
      synced = blocks.length;
      ballMesh.setEnabled(true); // the ball is reborn with the new tower
    },
    syncLayout(blocks) {
      // The sim only ever appends, so everything before `synced` is known.
      for (let i = synced; i < blocks.length; i++) addBlockMesh(blocks[i]);
      synced = blocks.length;
    },
    setSkin(id) {
      skinBase = SKINS[id] ?? SKINS.core;
      ballMat.diffuseColor.set(skinBase.rgb[0], skinBase.rgb[1], skinBase.rgb[2]);
      const tex = skinTexture(id);
      ballMat.diffuseTexture = tex;
      // The pattern must also drive the GLOW, otherwise the white emissive
      // color washes it out to a solid ball (owner: "where are the patterns?").
      ballMat.emissiveTexture = tex;
    },
    setBallMode(mode) {
      ballMesh.material = mode === "lead" ? leadMat : ballMat;
    },
    setTrail(on) {
      if (on === trailOn) return;
      trailOn = on;
      if (!on) {
        trailRibbon?.setEnabled(false);
        trailHistory.length = 0;
        return;
      }
      if (!trailMat) {
        trailMat = new StandardMaterial("mTrail", scene);
        trailMat.diffuseColor = new Color3(0, 0, 0);
        trailMat.specularColor = new Color3(0, 0, 0);
        trailMat.backFaceCulling = false;
        trailMat.disableLighting = true;
        trailMat.alpha = 0.999; // < 1 so the mesh renders in the alpha pass
      }
      trailMat.emissiveColor.set(skinBase.rgb[0], skinBase.rgb[1], skinBase.rgb[2]);
      if (!trailRibbon) {
        trailRibbon = new Mesh("agility-ribbon", scene);
        const indices: number[] = [];
        for (let i = 1; i < TRAIL_SEGMENTS; i++) {
          const b = (i - 1) * 2;
          indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
        const vd = new VertexData();
        vd.positions = trailPos;
        vd.colors = trailCol;
        vd.indices = indices;
        vd.applyToMesh(trailRibbon, true);
        trailRibbon.material = trailMat;
        trailRibbon.parent = tower;
        trailRibbon.hasVertexAlpha = true;
        trailRibbon.isPickable = false;
        trailRibbon.alwaysSelectAsActiveMesh = true; // its bounds change every frame
      }
    },
    setShield(on) {
      shieldOn = on;
    },
    jumpFx(b) {
      const ring = takeRing(55, 28, [0.6, 0.95, 1], 0.5, 0.3);
      ring.mesh.position = toLocal(b.x, b.y + 30, b.z);
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
      // Tiers the fall has left far behind are gone for good: above the
      // camera whatever the aspect, and out of reach of any bounce.
      while (ballSimY - restY(lowestLiveTier) > DROP_TIERS_ABOVE * C.tierSpacing) {
        disposeTier(lowestLiveTier);
        lowestLiveTier++;
      }
      // BIOME palette by depth: sky, fog, walls and block tints crossfade
      // as the ball descends through the layers.
      const tierNow = Math.max(0, (ballSimY - C.firstTierTopY) / C.tierSpacing);
      const pal = paletteAt(tierNow);
      scene.clearColor.set(pal.sky[0], pal.sky[1], pal.sky[2], 1);
      scene.fogColor.set(pal.sky[0], pal.sky[1], pal.sky[2]);
      wallMat.diffuseColor.set(pal.wall[0], pal.wall[1], pal.wall[2]);
      wallMat.emissiveColor.set(pal.wall[0] * EMIT_WALL, pal.wall[1] * EMIT_WALL, pal.wall[2] * EMIT_WALL);
      MATS.glass.diffuseColor.set(pal.glass[0], pal.glass[1], pal.glass[2]);
      MATS.glass.emissiveColor.set(pal.glass[0] * EMIT_GLASS, pal.glass[1] * EMIT_GLASS, pal.glass[2] * EMIT_GLASS);
      MATS.stone.diffuseColor.set(pal.stone[0], pal.stone[1], pal.stone[2]);
      // A little self-lit stone keeps it visible in the dark layers.
      MATS.stone.emissiveColor.set(pal.stone[0] * EMIT_STONE, pal.stone[1] * EMIT_STONE, pal.stone[2] * EMIT_STONE);
      hemi.intensity = HEMI_BASE * pal.ambient;
      sun.intensity = SUN_BASE * pal.ambient;
      const palFog = pal.fogNear;

      const maxRad = (C.maxVisualTiltDeg * Math.PI) / 180;
      tower.rotation.z = C.visualTiltSignX * tilt.x * maxRad;
      tower.rotation.x = C.visualTiltSignZ * tilt.z * maxRad;

      // Ball pulse: the impact feedback that replaced camera shake.
      ballPulse *= 0.9;
      const glowK = skinBase.emissive + ballPulse * 0.5;
      ballMat.emissiveColor.set(skinBase.rgb[0] * glowK, skinBase.rgb[1] * glowK, skinBase.rgb[2] * glowK);
      // AGILITY ribbon: refilled each frame from the position history, with a
      // linear alpha ramp (1 at the ball → 0 at the tip). Slots past the
      // history collapse onto its last point at zero alpha — no area, no pixel.
      if (trailOn && trailRibbon) {
        trailHistory.unshift(ballMesh.position.clone());
        if (trailHistory.length > TRAIL_SEGMENTS) trailHistory.length = TRAIL_SEGMENTS;
        const len = trailHistory.length;
        if (len > 3) {
          const half = C.ballRadius * 0.8;
          for (let i = 0; i < TRAIL_SEGMENTS; i++) {
            const j = Math.min(i, len - 1);
            const p = trailHistory[j];
            const prev = trailHistory[Math.max(0, j - 1)];
            const next = trailHistory[Math.min(len - 1, j + 1)];
            let dx = next.x - prev.x;
            let dz = next.z - prev.z;
            const l = Math.sqrt(dx * dx + dz * dz) || 1;
            dx /= l;
            dz /= l;
            const k = i < len ? 1 - i / (len - 1) : 0; // 1 at ball → 0 at tip
            const w = half * k;
            const o = i * 6;
            trailPos[o] = p.x - dz * w;
            trailPos[o + 1] = p.y;
            trailPos[o + 2] = p.z + dx * w;
            trailPos[o + 3] = p.x + dz * w;
            trailPos[o + 4] = p.y;
            trailPos[o + 5] = p.z - dx * w;
            const a = k * k * 0.85; // smooth quadratic fade
            const c = i * 8;
            for (let s = 0; s < 2; s++) {
              trailCol[c + s * 4] = skinBase.rgb[0];
              trailCol[c + s * 4 + 1] = skinBase.rgb[1];
              trailCol[c + s * 4 + 2] = skinBase.rgb[2];
              trailCol[c + s * 4 + 3] = a;
            }
          }
          trailRibbon.updateVerticesData(VertexBuffer.PositionKind, trailPos);
          trailRibbon.updateVerticesData(VertexBuffer.ColorKind, trailCol);
          trailRibbon.setEnabled(true);
        } else {
          trailRibbon.setEnabled(false);
        }
      }

      // SHIELD aura: gentle breathing.
      shieldPhase += frameMs / 420;
      const breath = 1 + 0.06 * Math.sin(shieldPhase);
      shieldMesh.setEnabled(shieldOn && ballMesh.isEnabled());
      shieldMesh.position.copyFrom(ballMesh.position);
      shieldMesh.scaling.setAll(breath);
      // Mines pulse with menace; walls follow the endless fall.
      const menace = 0.6 + 0.35 * Math.sin(performance.now() / 180);
      MATS.mine.emissiveColor.set(0.9 * menace, 0.08 * menace, 0.1 * menace);
      ballMesh.scaling.setAll(1 + ballPulse * 0.25);
      // Templates ride along with the ball — see template().
      for (const t of templates) t.position.copyFrom(ballMesh.position);

      ballMesh.computeWorldMatrix(true);
      const p = ballMesh.getAbsolutePosition();
      // Zoom OUT with tilt, plus extra zoom-out on portrait aspect so the
      // shaft width always fits the screen (owner feedback).
      const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
      const aspectZoom = Math.max(1, C.portraitTargetAspect / Math.max(0.2, aspect));
      const tiltMag = Math.max(Math.abs(tilt.x), Math.abs(tilt.z));
      const zoom = (1 + C.camTiltZoom * tiltMag) * aspectZoom;
      // Fog tracks the camera zoom — zooming out must never drown the tower.
      scene.fogStart = C.fogStart * zoom * palFog;
      scene.fogEnd = C.fogEnd * zoom * palFog;
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
      // QUAKE shake: applied after smoothing so it never fights the follow,
      // and decaying, so it reads as one jolt rather than a wobble.
      if (shakeMs > 0) {
        shakeMs = Math.max(0, shakeMs - frameMs);
        const k = (shakeMs / C.quakeShakeMs) ** 2 * C.quakeShakeAmp;
        camera.position.set(
          camPos.x + (Math.random() - 0.5) * k,
          camPos.y + (Math.random() - 0.5) * k,
          camPos.z + (Math.random() - 0.5) * k,
        );
      } else {
        camera.position.set(camPos.x, camPos.y, camPos.z);
      }
      camera.setTarget(camAim);
      for (const w of walls) w.position.y = p.y; // endless shaft follows the fall
    },
  };
}
