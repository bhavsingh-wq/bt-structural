// Geometry builders for the 3D structural element viewers.
// Units: everything is built in inches (matching the calculator's
// imperial inputs) then scaled down by /6 so models render at a
// reasonable size in the 3D scene regardless of actual member size.
import { addDimension } from "./Viewer3D";

const SCALE = 1 / 6;

function concreteMaterial(THREE) {
  return new THREE.MeshStandardMaterial({
    color: 0xd9dde1,
    transparent: true,
    opacity: 0.35,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}
function rebarMaterial(THREE, color) {
  return new THREE.MeshStandardMaterial({ color: color || 0x3a6ea5, roughness: 0.35, metalness: 0.6 });
}
function strandMaterial(THREE) {
  return new THREE.MeshStandardMaterial({ color: 0xb33b2e, roughness: 0.3, metalness: 0.7 });
}
function tieMaterial(THREE) {
  return new THREE.MeshStandardMaterial({ color: 0x6c757d, roughness: 0.4, metalness: 0.5 });
}

// ─────────────────────────────────────────────────────────
// COLUMN: rectangular concrete column (semi-transparent) with
// longitudinal rebar cage (top + bottom bars) and tie hoops
// stacked along the column height.
// ─────────────────────────────────────────────────────────
// Maps a stress value (ksi) to a diverging red-white-blue colormap, matching the
// convention used by SolidWorks/FEA tools: red = compression (highest magnitude),
// blue = tension (highest magnitude), white = near-zero/neutral axis.
function stressToColor(THREE, sigma, maxAbs) {
  const t = maxAbs > 0 ? Math.max(-1, Math.min(1, sigma / maxAbs)) : 0;
  // t > 0 => compression (red), t < 0 => tension (blue)
  if (t >= 0) {
    // white (t=0) -> red (t=1)
    return new THREE.Color(1, 1 - t, 1 - t);
  } else {
    const a = -t;
    // white (t=0) -> blue (t=-1)
    return new THREE.Color(1 - a, 1 - a, 1);
  }
}

// Computes linear bending+axial stress (σ = P/A ± M·c/I) at each vertex of the
// column's box geometry and paints it as a per-vertex color, producing a
// SolidWorks-style stress contour driven by your real P–M results (not FEA —
// a simplified linear-elastic approximation across the gross section).
function applyStressVertexColors(geo, THREE, { b, h, bS, hS, Pu, Mu }) {
  const A = b * h; // in^2, gross section
  const I = (b * h * h * h) / 12; // in^4, bending about the axis matching "h" dimension
  const cMax = h / 2;
  const MuIn = (Mu || 0) * 12; // kip-ft -> kip-in
  const sigmaAxial = (Pu || 0) / A; // ksi, uniform
  const sigmaBendMax = (MuIn * cMax) / I; // ksi, at extreme fiber
  const maxAbs = Math.max(Math.abs(sigmaAxial) + sigmaBendMax, 0.01);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    // Local Z (in box-geometry space) maps to the section's "h" depth direction,
    // matching how the column is built (h = depth along Z).
    const zLocal = pos.getZ(i); // ranges -hS/2 .. +hS/2 in scaled units
    const zReal = (zLocal / hS) * h; // back to real inches
    const sigma = sigmaAxial + (MuIn * zReal) / I; // compression positive convention
    const c = stressToColor(THREE, sigma, maxAbs);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

export function buildColumnScene(group, THREE, params, helpers) {
  const { b, h, height, cover, nBot, dBot, nTop, dTop, dTie, tieSpacing } = params;
  const registerPoint = helpers && helpers.registerPoint;
  const stress = params.stress; // optional: {Pu, Mu, b, h} in kips/kip-ft -> drives the color contour
  const bS = b * SCALE, hS = h * SCALE, lenS = (height || 96) * SCALE;
  const coverS = cover * SCALE;
  const dBotS = dBot * SCALE, dTopS = dTop * SCALE, dTieS = dTie * SCALE;

  // Concrete body (column runs along Y axis, b = width along X, h = depth along Z)
  const concreteGeo = new THREE.BoxGeometry(bS, lenS, hS);
  let concreteMat;
  if (stress) {
    applyStressVertexColors(concreteGeo, THREE, { b, h, bS, hS, Pu: stress.Pu, Mu: stress.Mu });
    concreteMat = new THREE.MeshStandardMaterial({
      vertexColors: true, transparent: true, opacity: 0.92, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide,
    });
  } else {
    concreteMat = concreteMaterial(THREE);
  }
  const concrete = new THREE.Mesh(concreteGeo, concreteMat);
  group.add(concrete);

  // Wireframe edges for clarity through the transparency
  const edges = new THREE.EdgesGeometry(concreteGeo);
  const edgeLines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x495057, linewidth: 1 }));
  group.add(edgeLines);

  const halfB = bS / 2, halfH = hS / 2, halfLen = lenS / 2;
  const tieDepth = halfH - coverS;
  const tieWidth = halfB - coverS;

  // Longitudinal bars: bottom row (near -Z face) and top row (near +Z face)
  const barLayer = (count, dia, zPos, material) => {
    if (count <= 0) return;
    const xs = count === 1 ? [0] : Array.from({ length: count }, (_, i) => -tieWidth + (2 * tieWidth) * (i / (count - 1)));
    xs.forEach((x) => {
      const barGeo = new THREE.CylinderGeometry(dia / 2, dia / 2, lenS, 12);
      const bar = new THREE.Mesh(barGeo, material); // cylinder's default axis (Y) already matches column length direction
      bar.position.set(x, 0, zPos);
      group.add(bar);
    });
  };
  const matBot = rebarMaterial(THREE, 0xb33b2e);
  const matTop = rebarMaterial(THREE, 0x2563eb);
  barLayer(nBot, dBotS, tieDepth, matBot);
  barLayer(nTop, dTopS, -tieDepth, matTop);

  // Tie hoops stacked along the height
  const spacingS = Math.max((tieSpacing || 12) * SCALE, 0.6);
  const tieCount = Math.max(2, Math.floor(lenS / spacingS));
  const tieMat = tieMaterial(THREE);
  for (let i = 0; i <= tieCount; i++) {
    const y = -halfLen + coverS + (lenS - 2 * coverS) * (i / tieCount);
    const tieShape = new THREE.Shape();
    tieShape.moveTo(-tieWidth, -tieDepth);
    tieShape.lineTo(tieWidth, -tieDepth);
    tieShape.lineTo(tieWidth, tieDepth);
    tieShape.lineTo(-tieWidth, tieDepth);
    tieShape.lineTo(-tieWidth, -tieDepth);
    const points = tieShape.getPoints(32).map((p) => new THREE.Vector3(p.x, 0, p.y));
    const curve = new THREE.CatmullRomCurve3(points, true);
    const tubeGeo = new THREE.TubeGeometry(curve, 64, dTieS / 2, 8, true);
    const tie = new THREE.Mesh(tubeGeo, tieMat);
    tie.position.y = y;
    group.add(tie);
  }

  group.position.set(0, 0, 0);

  // ── Dimension callouts (b, h, height) ──
  const dimOffset = Math.max(bS, hS) * 0.45 + 0.6;
  // Width "b" — along bottom-front edge (X direction), offset toward -Z (front)
  addDimension(group, THREE, {
    from: new THREE.Vector3(-halfB, -halfLen, -halfH),
    to: new THREE.Vector3(halfB, -halfLen, -halfH),
    offsetDir: new THREE.Vector3(0, 0, -1),
    offset: dimOffset,
    label: `b = ${fmtIn(b)}`,
    key: "b",
    registerPoint,
  });
  // Depth "h" — along bottom-side edge (Z direction), offset toward +X (side)
  addDimension(group, THREE, {
    from: new THREE.Vector3(halfB, -halfLen, -halfH),
    to: new THREE.Vector3(halfB, -halfLen, halfH),
    offsetDir: new THREE.Vector3(1, 0, 0),
    offset: dimOffset,
    label: `h = ${fmtIn(h)}`,
    key: "h",
    registerPoint,
  });
  // Height — along vertical edge, offset toward +X +Z (far corner)
  addDimension(group, THREE, {
    from: new THREE.Vector3(halfB, -halfLen, halfH),
    to: new THREE.Vector3(halfB, halfLen, halfH),
    offsetDir: new THREE.Vector3(0.7, 0, 0.7),
    offset: dimOffset * 0.85,
    label: `L = ${fmtIn(height || 96)}`,
    key: "height",
    registerPoint,
  });
}

function fmtIn(v) {
  return `${(Math.round(v * 100) / 100).toString()}"`;
}

// ─────────────────────────────────────────────────────────
// HOLLOWCORE SLAB: extruded slab segment with longitudinal
// cylindrical cores cut through, plus prestressing strands
// shown as thin tubes near the bottom of the section.
// ─────────────────────────────────────────────────────────
export function buildHollowcoreScene(group, THREE, params, helpers) {
  const { h, b, length, cores, coreD, nStrands, dp, yb } = params;
  const registerPoint = helpers && helpers.registerPoint;
  const hS = h * SCALE, bS = b * SCALE, lenS = (length || 120) * SCALE;
  const coreRS = (coreD / 2) * SCALE;

  // Build cross-section as a Shape with circular holes (cores), then extrude along length
  const shape = new THREE.Shape();
  const halfB = bS / 2, halfH = hS / 2;
  shape.moveTo(-halfB, -halfH);
  shape.lineTo(halfB, -halfH);
  shape.lineTo(halfB, halfH);
  shape.lineTo(-halfB, halfH);
  shape.lineTo(-halfB, -halfH);

  const coreCount = cores || 4;
  const coreSpacingS = bS / (coreCount + 1);
  for (let i = 0; i < coreCount; i++) {
    const cx = -halfB + coreSpacingS * (i + 1);
    const hole = new THREE.Path();
    hole.absellipse(cx, 0, coreRS, coreRS * 0.85, 0, Math.PI * 2, false, 0);
    shape.holes.push(hole);
  }

  const extrudeSettings = { steps: 1, depth: lenS, bevelEnabled: false };
  const slabGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  slabGeo.center(); // center the extrusion so length runs symmetrically about origin along Z
  const slab = new THREE.Mesh(slabGeo, concreteMaterial(THREE));
  group.add(slab);

  const edges = new THREE.EdgesGeometry(slabGeo, 25);
  const edgeLines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x495057 }));
  group.add(edgeLines);

  // Strands: thin tubes running the full length at depth dp from top (i.e. y = halfH - dp)
  if (nStrands > 0) {
    const dpS = dp * SCALE;
    const yStrand = halfH - dpS;
    const visibleCount = Math.min(nStrands, 8);
    const spread = bS * 0.7;
    const mat = strandMaterial(THREE);
    for (let i = 0; i < visibleCount; i++) {
      const x = visibleCount === 1 ? 0 : -spread / 2 + spread * (i / (visibleCount - 1));
      const strandGeo = new THREE.CylinderGeometry(0.045, 0.045, lenS, 8);
      const strand = new THREE.Mesh(strandGeo, mat);
      strand.rotation.x = Math.PI / 2;
      strand.position.set(x, yStrand, 0);
      group.add(strand);
    }
  }

  group.position.set(0, 0, 0);

  // ── Dimension callouts (b, h, length) ──
  const halfLen = lenS / 2;
  const dimOffset = Math.max(bS, hS) * 0.5 + 0.7;
  // Width "b" — along front-bottom edge, offset toward -Y (below the slab)
  addDimension(group, THREE, {
    from: new THREE.Vector3(-halfB, -halfH, -halfLen),
    to: new THREE.Vector3(halfB, -halfH, -halfLen),
    offsetDir: new THREE.Vector3(0, -1, 0),
    offset: dimOffset,
    label: `b = ${fmtIn(b)}`,
    key: "b",
    registerPoint,
  });
  // Depth "h" — along the front-right vertical edge, offset toward +X
  addDimension(group, THREE, {
    from: new THREE.Vector3(halfB, -halfH, -halfLen),
    to: new THREE.Vector3(halfB, halfH, -halfLen),
    offsetDir: new THREE.Vector3(1, 0, 0),
    offset: dimOffset,
    label: `h = ${fmtIn(h)}`,
    key: "h",
    registerPoint,
  });
  // Length — along the top-right edge running the extrusion direction (Z)
  addDimension(group, THREE, {
    from: new THREE.Vector3(halfB, halfH, -halfLen),
    to: new THREE.Vector3(halfB, halfH, halfLen),
    offsetDir: new THREE.Vector3(0.7, 0.7, 0),
    offset: dimOffset * 0.85,
    label: `L = ${fmtIn(length || 120)}`,
    key: "length",
    registerPoint,
  });
}
