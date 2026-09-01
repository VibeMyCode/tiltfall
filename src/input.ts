// Pointer + keyboard → per-tick tilt sample (§3.1). One code path for touch
// and mouse via pointer events; keyboard eases toward ±1 so both feel alike.
import { CONFIG } from "./config";

const clamp = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);

export interface InputState {
  sample: (nowMs: number) => { x: number; z: number };
  current: (nowMs: number) => { x: number; z: number };
  setForced: (t: { x: number; z: number } | null) => void;
  invertY: () => boolean;
  toggleInvertY: () => boolean;
}

// Player preference (render/input-side only — the sim just consumes tilt).
function loadInvertY(): boolean {
  try {
    const v = localStorage.getItem("tf.invertY");
    return v === null ? true : v === "1"; // owner default: inverted
  } catch {
    return true;
  }
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
  let invY = loadInvertY(); // pointer Y only — keyboard W/S stays standard
  const held = new Set<string>();
  const pzSign = () => CONFIG.inputSignZ * (invY ? -1 : 1);

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
    releaseTiltX = CONFIG.inputSignX * clamp((lastX - originX) / CONFIG.tiltFullDragPx);
    releaseTiltZ = pzSign() * clamp((lastY - originY) / CONFIG.tiltFullDragPx);
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
        x: CONFIG.inputSignX * clamp((lastX - originX) / CONFIG.tiltFullDragPx),
        z: pzSign() * clamp((lastY - originY) / CONFIG.tiltFullDragPx),
      };
    }
    const k = Math.max(0, 1 - (nowMs - releaseTime) / CONFIG.tiltReleaseEaseMs);
    return { x: releaseTiltX * k, z: releaseTiltZ * k };
  }

  function keyTarget(): { x: number; z: number } {
    const x = (held.has("ArrowRight") || held.has("KeyD") ? 1 : 0) - (held.has("ArrowLeft") || held.has("KeyA") ? 1 : 0);
    const z = (held.has("ArrowDown") || held.has("KeyS") ? 1 : 0) - (held.has("ArrowUp") || held.has("KeyW") ? 1 : 0);
    return { x: CONFIG.inputSignX * x, z: CONFIG.inputSignZ * z };
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
    invertY: () => invY,
    toggleInvertY() {
      invY = !invY;
      try {
        localStorage.setItem("tf.invertY", invY ? "1" : "0");
      } catch {
        // storage unavailable (private mode) — the toggle still works this session
      }
      return invY;
    },
  };
}
