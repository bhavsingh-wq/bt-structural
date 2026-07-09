import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";

// ─────────────────────────────────────────────────────────
// CAD-style dimension annotations: 3D extension lines + dimension
// line + arrowheads (rendered in WebGL), plus a registered "dimension
// point" that the React layer projects to screen space every frame
// and renders as a real, clickable HTML label/input overlay — this is
// what makes dimensions editable, since you can't easily capture
// clicks on text baked into a WebGL canvas.
// `from`/`to` = the two points being dimensioned (THREE.Vector3).
// `offset` = perpendicular distance to push the dimension line out.
// `offsetDir` = THREE.Vector3 direction to offset towards.
// `key` = stable id matching a field in `editableDims` (see Viewer3D).
// ─────────────────────────────────────────────────────────
export function addDimension(group, THREE, { from, to, offsetDir, offset = 0.8, label, color = 0x212529, key, registerPoint }) {
  const dir = offsetDir.clone().normalize();
  const p1 = from.clone().addScaledVector(dir, offset);
  const p2 = to.clone().addScaledVector(dir, offset);

  const mat = new THREE.LineBasicMaterial({ color });

  // Extension lines (from actual geometry edge out to the dimension line)
  [[from, p1], [to, p2]].forEach(([a, b]) => {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    group.add(new THREE.Line(geo, mat));
  });

  // Main dimension line
  const dimGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
  group.add(new THREE.Line(dimGeo, mat));

  // Arrowheads at each end, pointing along the dimension line
  const axis = p2.clone().sub(p1).normalize();
  const arrowLen = Math.max(offset * 0.35, 0.18);
  [{ pos: p1, dir: axis }, { pos: p2, dir: axis.clone().negate() }].forEach(({ pos, dir: d }) => {
    const arrow = new THREE.ArrowHelper(d, pos, arrowLen, color, arrowLen * 0.6, arrowLen * 0.35);
    group.add(arrow);
  });

  // Register the label's 3D position so Viewer3D can project it to screen
  // space and render a real, clickable HTML element there every frame.
  const mid = p1.clone().lerp(p2, 0.5).addScaledVector(dir, offset * 0.25);
  if (registerPoint) {
    registerPoint({ key, label, position: mid, colorHex: "#" + new THREE.Color(color).getHexString() });
  }
}

// ─────────────────────────────────────────────────────────
// Minimal orbit/pan/zoom camera controller (no external deps).
// Left-drag = orbit, right-drag (or shift+drag) = pan, wheel = zoom.
// Mirrors the interaction model of CAD/structural viewers like
// Hilti PROFIS: click-drag to rotate freely around the model.
// ─────────────────────────────────────────────────────────
function attachOrbitControls(camera, domElement, target) {
  let isDragging = false;
  let isPanning = false;
  let prevX = 0, prevY = 0;
  let theta = Math.PI / 4;   // horizontal angle
  let phi = Math.PI / 3;     // vertical angle (from top)
  let radius = camera.position.distanceTo(target);
  let didDrag = false;

  const updateCamera = () => {
    const sinPhi = Math.sin(phi);
    camera.position.x = target.x + radius * sinPhi * Math.sin(theta);
    camera.position.y = target.y + radius * Math.cos(phi);
    camera.position.z = target.z + radius * sinPhi * Math.cos(theta);
    camera.lookAt(target);
  };
  updateCamera();

  const onPointerDown = (e) => {
    if (e.target !== domElement) return; // ignore clicks that originated on HTML overlay elements
    if (e.button === 2 || e.shiftKey) { isPanning = true; }
    else { isDragging = true; }
    didDrag = false;
    prevX = e.clientX; prevY = e.clientY;
    domElement.style.cursor = isPanning ? "move" : "grabbing";
  };
  const onPointerMove = (e) => {
    if (!isDragging && !isPanning) return;
    const dx = e.clientX - prevX, dy = e.clientY - prevY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didDrag = true;
    prevX = e.clientX; prevY = e.clientY;
    if (isDragging) {
      theta -= dx * 0.008;
      phi -= dy * 0.008;
      phi = Math.max(0.12, Math.min(Math.PI - 0.12, phi));
      updateCamera();
    } else if (isPanning) {
      const panSpeed = radius * 0.0015;
      const right = new THREE.Vector3();
      camera.getWorldDirection(right);
      right.cross(camera.up).normalize();
      const up = camera.up.clone();
      target.addScaledVector(right, -dx * panSpeed);
      target.addScaledVector(up, dy * panSpeed);
      updateCamera();
    }
  };
  const onPointerUp = () => { isDragging = false; isPanning = false; domElement.style.cursor = "grab"; };
  const onWheel = (e) => {
    e.preventDefault();
    radius *= (1 + e.deltaY * 0.001);
    radius = Math.max(2, Math.min(200, radius));
    updateCamera();
  };
  const onContextMenu = (e) => e.preventDefault();

  domElement.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  domElement.addEventListener("wheel", onWheel, { passive: false });
  domElement.addEventListener("contextmenu", onContextMenu);
  domElement.style.cursor = "grab";

  return {
    dispose() {
      domElement.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      domElement.removeEventListener("wheel", onWheel);
      domElement.removeEventListener("contextmenu", onContextMenu);
    },
    setRadius(r) { radius = r; updateCamera(); },
    reset(r, th, ph) { radius = r; theta = th ?? theta; phi = ph ?? phi; updateCamera(); },
    didDrag: () => didDrag,
  };
}

// ─────────────────────────────────────────────────────────
// Generic viewer shell: sets up scene/camera/renderer/lights,
// calls buildScene(scene, THREE, helpers) to populate geometry,
// and tears everything down cleanly on unmount or rebuild.
// `deps` controls when the scene rebuilds (pass your live inputs).
//
// `editableDims`: optional map of { key: { value, unit, onChange } }
// — for any dimension point registered with a matching `key` via
// addDimension(), its HTML label becomes clickable and opens an
// inline input that calls onChange(newValue) on submit.
// ─────────────────────────────────────────────────────────
export function Viewer3D({ buildScene, height, initialDistance, deps = [], caption, editableDims }) {
  const mountRef = useRef(null);
  const overlayRef = useRef(null);
  const sceneRef = useRef({});
  const [dimPoints, setDimPoints] = useState([]); // [{key,label,position,colorHex}]
  const [screenPositions, setScreenPositions] = useState({}); // key -> {x,y,visible}
  const lastScreenPosRef = useRef({});
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState("");

  const fill = height === "fill";  // fill the parent flex container instead of fixed px

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || 400;
    const h = fill ? (mount.clientHeight || 400) : (height || 360);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8f9fa);

    const camera = new THREE.PerspectiveCamera(40, width / h, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.innerHTML = "";
    mount.appendChild(renderer.domElement);

    // Lighting: soft ambient + key + fill, gives concrete/steel a believable look
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(8, 12, 8);
    scene.add(key);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
    fillLight.position.set(-8, 4, -6);
    scene.add(fillLight);

    const target = new THREE.Vector3(0, 0, 0);
    const dist = initialDistance || 14;
    camera.position.set(dist, dist, dist);

    const group = new THREE.Group();
    scene.add(group);

    const collectedPoints = [];
    const registerPoint = (pt) => collectedPoints.push(pt);
    buildScene(group, THREE, { registerPoint });
    setDimPoints(collectedPoints);
    lastScreenPosRef.current = {};

    const controls = attachOrbitControls(camera, renderer.domElement, target);

    let raf;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      renderer.render(scene, camera);

      // Project each dimension point to screen space so the HTML overlay
      // labels track the 3D model as it orbits/zooms/pans. Only push a
      // React state update when something actually moved meaningfully —
      // calling setState every animation frame (60/sec) regardless of
      // change starves click events on the overlay buttons, since React
      // keeps re-rendering mid-click and the button can unmount before
      // the click finishes resolving.
      if (collectedPoints.length) {
        const rect = renderer.domElement.getBoundingClientRect();
        const next = {};
        let changed = false;
        const prev = lastScreenPosRef.current;
        collectedPoints.forEach((pt) => {
          const v = pt.position.clone().project(camera);
          const visible = v.z < 1;
          const x = (v.x * 0.5 + 0.5) * rect.width;
          const y = (-v.y * 0.5 + 0.5) * rect.height;
          next[pt.key] = { x, y, visible };
          const p = prev[pt.key];
          if (!p || Math.abs(p.x - x) > 0.5 || Math.abs(p.y - y) > 0.5 || p.visible !== visible) {
            changed = true;
          }
        });
        if (changed) {
          lastScreenPosRef.current = next;
          setScreenPositions(next);
        }
      }
    };
    animate();

    // For fill mode use ResizeObserver so the renderer tracks the flex
    // container size after layout settles. For fixed-height fall back to
    // window resize (width only).
    let resizeObserver = null;
    const onResize = () => {
      const w = mount.clientWidth || 400;
      const newH = fill ? (mount.clientHeight || h) : h;
      camera.aspect = w / newH;
      camera.updateProjectionMatrix();
      renderer.setSize(w, newH);
    };
    if (fill && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => onResize());
      resizeObserver.observe(mount);
    } else {
      window.addEventListener("resize", onResize);
    }
    setTimeout(onResize, 0); // fire after flex layout settles

    sceneRef.current = { renderer, scene, controls };

    return () => {
      cancelAnimationFrame(raf);
      if (resizeObserver) resizeObserver.disconnect();
      else window.removeEventListener("resize", onResize);
      controls.dispose();
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
      renderer.dispose();
      mount.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const openEditor = useCallback((key, currentValue) => {
    setEditingKey(key);
    setEditValue(String(currentValue));
  }, []);

  const commitEdit = useCallback(() => {
    if (editingKey && editableDims && editableDims[editingKey]) {
      const num = parseFloat(editValue);
      if (!isNaN(num)) editableDims[editingKey].onChange(num);
    }
    setEditingKey(null);
  }, [editingKey, editValue, editableDims]);

  return (
    <div style={{display:"flex",flexDirection:"column",height:fill?"100%":undefined}}>
      <div style={{ position: "relative", width: "100%", height: fill ? "100%" : (height || 360), flex: fill ? 1 : undefined, borderRadius: fill?0:6, overflow: "hidden", border: fill?"none":"1px solid #dee2e6" }}>
        <div ref={mountRef} style={{ width: "100%", height: "100%" }} />
        <div ref={overlayRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {dimPoints.map((pt) => {
            const pos = screenPositions[pt.key];
            if (!pos || !pos.visible) return null;
            const editable = editableDims && editableDims[pt.key];
            const isEditing = editingKey === pt.key;
            return (
              <div key={pt.key} onPointerDown={(e)=>e.stopPropagation()} style={{ position: "absolute", left: pos.x, top: pos.y, transform: "translate(-50%,-50%)", pointerEvents: "auto" }}>
                {isEditing ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, background: "#fff", border: `2px solid ${pt.colorHex}`, borderRadius: 6, padding: "4px 6px", boxShadow: "0 4px 14px rgba(0,0,0,0.18)" }}>
                    <input
                      autoFocus
                      type="number"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingKey(null); }}
                      onBlur={() => commitEdit()}
                      style={{ width: 64, padding: "3px 5px", fontSize: 13, fontFamily: "'JetBrains Mono',monospace", border: "1px solid #ced4da", borderRadius: 3 }}
                    />
                    <span style={{ fontSize: 10, color: "#868e96" }}>{editable.unit}</span>
                    <button onMouseDown={(e)=>e.preventDefault()} onClick={commitEdit} style={{ padding: "3px 8px", fontSize: 11, fontWeight: 700, background: pt.colorHex, color: "#fff", border: "none", borderRadius: 3, cursor: "pointer" }}>✓</button>
                  </div>
                ) : (
                  <button
                    onClick={() => editable && openEditor(pt.key, editable.value)}
                    title={editable ? "Click to edit this dimension" : undefined}
                    style={{
                      padding: "5px 10px", fontSize: 12, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace",
                      background: "rgba(255,255,255,0.96)", color: pt.colorHex, border: `2px solid ${pt.colorHex}`, borderRadius: 16,
                      cursor: editable ? "pointer" : "default", boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
                      display: "inline-flex", alignItems: "center", gap: 4,
                    }}
                  >
                    {pt.label}{editable && <span style={{ fontSize: 9, opacity: 0.6 }}>✎</span>}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Dimension input panel — always visible below the 3D view ── */}
      {editableDims && Object.keys(editableDims).length > 0 && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 8, padding: "10px 12px",
          background: "#f8f9fa", border: "1px solid #dee2e6", borderTop: "none",
          borderRadius: "0 0 6px 6px",
        }}>
          {dimPoints.filter(pt => editableDims[pt.key]).map(pt => {
            const dim = editableDims[pt.key];
            return (
              <div key={pt.key} style={{ display: "flex", flexDirection: "column", minWidth: 80 }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, marginBottom: 2,
                  fontFamily: "'JetBrains Mono',monospace",
                  color: pt.colorHex,
                }}>
                  {pt.label.split(" = ")[0]}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <input
                    type="number"
                    value={dim.value}
                    step={dim.step || 1}
                    min={dim.min || 0}
                    onChange={e => {
                      const v = Number(e.target.value);
                      if (!isNaN(v) && v > 0) dim.onChange(v);
                    }}
                    style={{
                      width: 64, padding: "4px 6px", fontSize: 12,
                      fontFamily: "'JetBrains Mono',monospace",
                      border: `1.5px solid ${pt.colorHex}`,
                      borderRadius: 4, background: "#fff8ef",
                      boxSizing: "border-box",
                    }}
                  />
                  {dim.unit && (
                    <span style={{ fontSize: 10, color: "#868e96", whiteSpace: "nowrap" }}>
                      {dim.unit}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ textAlign: "center", marginTop: 4, fontSize: 11, color: "#6c757d" }}>
        {caption || (editableDims ? "Drag to rotate · Scroll to zoom · Edit dimensions above or click labels in 3D" : "Drag to rotate · Shift+drag or right-drag to pan · Scroll to zoom")}
      </div>
    </div>
  );
}
