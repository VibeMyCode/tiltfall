import "./style.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

// Scaffold bootstrap: engine + empty scene + render loop.
// Gameplay arrives in M0 (see SPEC.md §11); no game code yet.

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;

const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.08, 0.09, 0.12, 1);

const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.5, 10, Vector3.Zero());
const light = new HemisphericLight("light", new Vector3(0, 1, 0));
// Both self-register into the scene via their constructors; gameplay (M0+) will drive them.
void camera;
void light;

scene.onBeforeRenderObservable.add(() => {
  (window as unknown as { __DSH_READY: boolean }).__DSH_READY = true;
});

engine.runRenderLoop(() => scene.render());

window.addEventListener("resize", () => engine.resize());
