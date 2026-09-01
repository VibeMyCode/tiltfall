// Pointer + keyboard → per-tick tilt sample (§3.1). One code path for touch
// and mouse via pointer events; keyboard eases toward ±1 so both feel alike.
import { CONFIG } from "./config";

const clamp = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);

export interface InputState {
  sample: (nowMs: number) => { x: number; z: number };
  current: (nowMs: number) => { x: number; z: number };
  setForced: (t: { x: number; z: number } | null) => void;
}

export function attachInput(canvas: HTMLCanvasElement): InputState {
  let dragging = false;
  let originX = 0;
  let originY = 0;
  let lastX = 0;
  let lastY = 0;
  let releaseTiltX = 0;
  let releaseTiltZ = 0;
  let releaseTime = -1e9;
  let forced: { x: number; z: number } | null = null;
  let keyX = 0; // eased keyboard tilt
  let keyZ = 0;
  const held = new Set<string>();

  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    originX = e.clientX;
    originY = e.clientY;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (dragging) {
      lastX = e.clientX;
      lastY = e.clientY;
    }
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    releaseTiltX = clamp((lastX - originX) / CONFIG.tiltFullDragPx);
    releaseTiltZ = clamp((lastY - originY) / CONFIG.tiltFullDragPx);
    releaseTime = performance.now();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  window.addEventListener("keydown", (e) => held.add(e.code));
  window.addEventListener("keyup", (e) => held.delete(e.code));
  window.addEventListener("blur", () => held.clear());

  function pointerTilt(nowMs: number): { x: number; z: number } {
    if (dragging) {
      return {
        x: clamp((lastX - originX) / CONFIG.tiltFullDragPx),
        z: clamp((lastY - originY) / CONFIG.tiltFullDragPx),
      };
    }
    const k = Math.max(0, 1 - (nowMs - releaseTime) / CONFIG.tiltReleaseEaseMs);
    return { x: releaseTiltX * k, z: releaseTiltZ * k };
  }

  function keyTarget(): { x: number; z: number } {
    const x = (held.has("ArrowRight") || held.has("KeyD") ? 1 : 0) - (held.has("ArrowLeft") || held.has("KeyA") ? 1 : 0);
    const z = (held.has("ArrowDown") || held.has("KeyS") ? 1 : 0) - (held.has("ArrowUp") || held.has("KeyW") ? 1 : 0);
    return { x, z };
  }

  function current(nowMs: number): { x: number; z: number } {
    if (forced) return forced;
    const p = pointerTilt(nowMs);
    return { x: clamp(p.x + keyX), z: clamp(p.z + keyZ) };
  }

  return {
    current,
    // Called once per sim tick: eases keyboard tilt with the fixed dt, then
    // quantizes to integer millitilts (§3.1 — the sim sees only this).
    sample(nowMs: number) {
      const target = keyTarget();
      const maxStep = CONFIG.keyTiltRate * CONFIG.dt;
      const dx = target.x - keyX;
      const dz = target.z - keyZ;
      keyX += Math.abs(dx) <= maxStep ? dx : Math.sign(dx) * maxStep;
      keyZ += Math.abs(dz) <= maxStep ? dz : Math.sign(dz) * maxStep;
      const t = current(nowMs);
      return { x: Math.round(t.x * 1000) / 1000, z: Math.round(t.z * 1000) / 1000 };
    },
    setForced(t) {
      forced = t;
    },
  };
}
