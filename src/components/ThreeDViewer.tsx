import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { inspectPreviewModel, repairPreviewNormals, validateObjPreviewSize, validateStlPreviewSize } from "../lib/modelPreview";

type Props = { file: File; color?: string };
type Controls = { rotate: (direction: number) => void; zoom: (factor: number) => void; reset: () => void };
const buttonClass = "rounded-lg border bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50";

/** This module is only downloaded when a customer opens a model preview. */
export default function ThreeDViewer({ file, color = "#10b981" }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const actions = useRef<Controls | null>(null);
  const materials = useRef<THREE.MeshStandardMaterial[]>([]);
  const latestColor = useRef(color);
  latestColor.current = color;
  const [error, setError] = useState("");
  const [dimensions, setDimensions] = useState<number[] | null>(null);

  useEffect(() => {
    for (const material of materials.current) material.color.set(color);
    // A change event redraws the scene; there is no continuous animation loop.
    actions.current?.rotate(0);
  }, [color]);

  useEffect(() => {
    let disposed = false;
    let released = false;
    let renderer: THREE.WebGLRenderer | undefined;
    let controls: OrbitControls | undefined;
    let observer: ResizeObserver | undefined;
    let model: THREE.Object3D | undefined;
    let onResize: (() => void) | undefined;
    let onKey: ((event: KeyboardEvent) => void) | undefined;
    let onContextLost: ((event: Event) => void) | undefined;
    const container = host.current;
    setError("");
    setDimensions(null);

    function teardown() {
      if (released) return;
      released = true;
      actions.current = null;
      observer?.disconnect();
      if (onResize) window.removeEventListener("resize", onResize);
      if (renderer && onKey) renderer.domElement.removeEventListener("keydown", onKey);
      if (renderer && onContextLost) renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      controls?.dispose();
      if (model) {
        const geometries = new Set<THREE.BufferGeometry>();
        const allocatedMaterials = new Set<THREE.Material>();
        model.traverse((object) => {
          if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
            geometries.add(object.geometry);
            (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => allocatedMaterials.add(material));
          }
        });
        geometries.forEach((geometry) => geometry.dispose());
        allocatedMaterials.forEach((material) => material.dispose());
      }
      materials.current = [];
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
      // Release typed arrays and scene closures even while the error message remains open.
      model = undefined;
      renderer = undefined;
      controls = undefined;
      observer = undefined;
      onResize = undefined;
      onKey = undefined;
      onContextLost = undefined;
    }

    async function initialize() {
      try {
        const data = await file.arrayBuffer();
        if (disposed || !container) return;
        if (/\.stl$/i.test(file.name)) {
          validateStlPreviewSize(data);
          const geometry = new STLLoader().parse(data);
          model = new THREE.Mesh(geometry);
        } else if (/\.obj$/i.test(file.name)) {
          const text = new TextDecoder().decode(data);
          validateObjPreviewSize(text);
          model = new OBJLoader().parse(text);
        } else {
          throw new Error("Förhandsvisningen stöder STL och OBJ.");
        }
        const inspection = inspectPreviewModel(model);
        const box = inspection.bounds;
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maximum = Math.max(size.x, size.y, size.z);
        const normalized = new THREE.Group();
        model.position.sub(center);
        normalized.add(model);
        normalized.scale.setScalar(1 / maximum);
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const oldMaterials = Array.isArray(object.material) ? object.material : [object.material];
          oldMaterials.forEach((material) => material.dispose());
          const material = new THREE.MeshStandardMaterial({
            color: latestColor.current, roughness: 0.65, metalness: 0.05, side: THREE.DoubleSide,
          });
          materials.current.push(material);
          object.material = material;
          repairPreviewNormals(object.geometry);
        });
        const scene = new THREE.Scene();
        scene.background = new THREE.Color("#f1f5f9");
        scene.add(normalized);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2.2));
        const light = new THREE.DirectionalLight(0xffffff, 3);
        light.position.set(2, -3, 4);
        scene.add(light);
        const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
        camera.up.set(0, 0, 1);
        const initialPosition = new THREE.Vector3(1.6, -1.6, 1.2);
        camera.position.copy(initialPosition);
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.domElement.tabIndex = 0;
        renderer.domElement.setAttribute("aria-label", "3D-modell av " + file.name + ". Vänster och höger piltangent roterar, upp och ned zoomar, Home återställer.");
        container.appendChild(renderer.domElement);
        const draw = () => {
          if (disposed || released) return;
          try { renderer?.render(scene, camera); }
          catch {
            teardown();
            setError("3D-visningen avbröts. Du kan fortfarande beräkna pris och beställa. Stäng och öppna förhandsvisningen för att försöka igen.");
          }
        };
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = false;
        controls.enablePan = true;
        controls.minDistance = 0.3;
        controls.maxDistance = 8;
        controls.addEventListener("change", draw);
        actions.current = {
          rotate: (direction) => {
            const offset = camera.position.clone().sub(controls!.target);
            offset.applyAxisAngle(camera.up, direction * Math.PI / 8);
            camera.position.copy(controls!.target).add(offset);
            controls!.update();
            draw();
          },
          zoom: (factor) => {
            const offset = camera.position.clone().sub(controls!.target);
            offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, 0.3, 8));
            camera.position.copy(controls!.target).add(offset);
            controls!.update();
            draw();
          },
          reset: () => {
            controls!.target.set(0, 0, 0);
            camera.position.copy(initialPosition);
            controls!.update();
            draw();
          },
        };
        onResize = () => {
          if (disposed || released || !container || !renderer) return;
          const width = Math.max(container.clientWidth, 1);
          const height = Math.max(container.clientHeight, 1);
          renderer.setSize(width, height);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          draw();
        };
        onKey = (event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          if (event.key === "ArrowLeft") actions.current?.rotate(-1);
          else if (event.key === "ArrowRight") actions.current?.rotate(1);
          else if (event.key === "ArrowUp" || event.key === "+") actions.current?.zoom(0.8);
          else if (event.key === "ArrowDown" || event.key === "-") actions.current?.zoom(1.25);
          else if (event.key === "Home") actions.current?.reset();
          else return;
          event.preventDefault();
        };
        onContextLost = (event) => {
          event.preventDefault();
          if (!disposed && !released) {
            teardown();
            setError("3D-visningen avbröts av webbläsaren. Stäng och öppna förhandsvisningen för att försöka igen.");
          }
        };
        renderer.domElement.addEventListener("keydown", onKey);
        renderer.domElement.addEventListener("webglcontextlost", onContextLost);
        if (typeof ResizeObserver !== "undefined") {
          observer = new ResizeObserver(onResize);
          observer.observe(container);
        } else window.addEventListener("resize", onResize);
        controls.update();
        if (released) return;
        onResize();
        if (released) return;
        setDimensions([size.x, size.y, size.z]);
      } catch (cause) {
        if (!disposed) {
          teardown();
          setError(cause instanceof Error && cause.message.startsWith("Modellen")
            ? cause.message
            : "Kunde inte visa modellen i 3D. Filen finns kvar och du kan fortfarande beräkna pris och beställa.");
        }
      }
    }
    initialize();
    return () => {
      disposed = true;
      teardown();
    };
  }, [file]);

  return <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 bg-slate-50">
    {error ? <p role="status" className="p-4 text-sm text-gray-700">{error}</p> : <>
      {!dimensions && <p role="status" className="px-4 pt-4 text-sm text-gray-600">Läser modellen…</p>}
      <div className="p-3">
        <div className="flex flex-wrap gap-2" aria-label="Modellkontroller">
          <button type="button" className={buttonClass} disabled={!dimensions} onClick={() => actions.current?.rotate(-1)} aria-label="Rotera modellen åt vänster">↶ Rotera</button>
          <button type="button" className={buttonClass} disabled={!dimensions} onClick={() => actions.current?.rotate(1)} aria-label="Rotera modellen åt höger">Rotera ↷</button>
          <button type="button" className={buttonClass} disabled={!dimensions} onClick={() => actions.current?.zoom(0.8)}>Zooma in</button>
          <button type="button" className={buttonClass} disabled={!dimensions} onClick={() => actions.current?.zoom(1.25)}>Zooma ut</button>
          <button type="button" className={buttonClass} disabled={!dimensions} onClick={() => actions.current?.reset()}>Återställ vy</button>
        </div>
      </div>
    </>}
    <div ref={host} className={error ? "hidden" : "h-72 w-full"} />
    {!error && dimensions && <div className="space-y-1 border-t bg-white p-3 text-xs text-gray-600">
      <p className="font-medium text-gray-800">Mått (X × Y × Z): {dimensions.map((value) => value.toLocaleString("sv-SE", { maximumFractionDigits: 1 })).join(" × ")} mm</p>
      <p>Måtten förutsätter att modellens enhet är millimeter. Dra för att rotera, rulla eller nyp för att zooma. Färgen är en illustration.</p>
      <p>Förhandsvisningen läses direkt i din webbläsare. Filen skickas först när du beräknar pris eller beställer.</p>
    </div>}
  </div>;
}
