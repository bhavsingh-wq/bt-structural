// ═══════════════════════════════════════════════════════════════
// LOADING SYSTEM — Phase 2
// Manages multiple named load cases (DL, SDL, LL, Wind, custom),
// each containing point loads and/or UDL/partial-UDL entries.
// Computes M(x) and V(x) for any load combination (user-defined
// factors per case), then draws live bending moment + shear diagrams.
// ═══════════════════════════════════════════════════════════════
import { useState, useMemo, useCallback } from "react";

const MONO = "'JetBrains Mono','Fira Code','Consolas',monospace";

// ── Default load case names ──
export const DEFAULT_CASES = ["DL", "SDL", "LL", "Wind"];

// ── Default ACI load combinations ──
export const DEFAULT_COMBOS = [
  { name:"Strength I",  factors:{ DL:1.4, SDL:0,   LL:0,   Wind:0   } },
  { name:"Strength II", factors:{ DL:1.2, SDL:1.2, LL:1.6, Wind:0   } },
  { name:"Strength III",factors:{ DL:1.2, SDL:1.2, LL:1.0, Wind:1.0 } },
  { name:"Service",     factors:{ DL:1.0, SDL:1.0, LL:1.0, Wind:0   } },
];

// ── Analysis: compute M and V at n points along span ──
// loads = [{type:"point"|"udl"|"pudl", P, x, w, x1, x2}]
// All in consistent units: loads in kip or kip/ft, span in ft
// Returns {x[], M[], V[], Mmax, Mmin, Vmax, Vmin}
export function analyzeLoads(loads, span, n = 51) {
  const pts = Array.from({ length: n }, (_, i) => (i / (n - 1)) * span);
  const M = new Array(n).fill(0);
  const V = new Array(n).fill(0);

  for (const load of loads) {
    if (load.type === "point") {
      // Point load P at position a from left
      const a = load.x, P = load.P, L = span;
      const Rb = P * a / L, Ra = P - Rb;
      for (let i = 0; i < n; i++) {
        const x = pts[i];
        V[i] += x < a ? Ra : Ra - P;
        M[i] += x <= a ? Ra * x : Ra * x - P * (x - a);
      }
    } else if (load.type === "udl") {
      // Full UDL w (kip/ft)
      const w = load.w, L = span;
      const Ra = w * L / 2;
      for (let i = 0; i < n; i++) {
        const x = pts[i];
        V[i] += Ra - w * x;
        M[i] += Ra * x - w * x * x / 2;
      }
    } else if (load.type === "pudl") {
      // Partial UDL from x1 to x2 at rate w (kip/ft)
      const w = load.w, x1 = load.x1, x2 = load.x2, L = span;
      const wLen = x2 - x1;
      const totalW = w * wLen;
      const centroid = (x1 + x2) / 2;
      const Rb = totalW * centroid / L;
      const Ra = totalW - Rb;
      for (let i = 0; i < n; i++) {
        const x = pts[i];
        let shear = Ra;
        let moment = Ra * x;
        if (x > x1) {
          const overlap = Math.min(x, x2) - x1;
          shear -= w * overlap;
          moment -= w * overlap * (x - x1 - overlap / 2);
        }
        V[i] += shear;
        M[i] += moment;
      }
    }
  }

  return {
    x: pts,
    M,
    V,
    Mmax: Math.max(...M),
    Mmin: Math.min(...M),
    Vmax: Math.max(...V),
    Vmin: Math.min(...V),
  };
}

// ── Build factored load list from cases + combo ──
export function applyCombo(cases, combo, span) {
  const loads = [];
  for (const [caseName, factor] of Object.entries(combo.factors)) {
    if (!factor || !cases[caseName]) continue;
    for (const load of cases[caseName]) {
      loads.push({ ...load, P: (load.P || 0) * factor, w: (load.w || 0) * factor });
    }
  }
  return loads;
}

// ═══════════════════════════════════════════════════════════════
// BEAM DIAGRAM SVG: draws the beam with all loads, then M and V below
// ═══════════════════════════════════════════════════════════════
function BeamLoadDiagram({ cases, activeCaseName, span, result }) {
  const W = 540, padX = 48, padY = 16;
  const beamY = 60, beamH = 14;
  const beamW = W - 2 * padX;
  const toX = (pos) => padX + (pos / span) * beamW;

  // Draw loads for the active case only
  const loads = (cases[activeCaseName] || []);
  const maxLoadVal = Math.max(1, ...loads.map(l => Math.abs(l.P || l.w || 0)));
  const arrowScale = 36 / maxLoadVal;

  // M diagram bounds
  const Mabs = result ? Math.max(Math.abs(result.Mmax), Math.abs(result.Mmin), 0.001) : 1;
  const Vabs = result ? Math.max(Math.abs(result.Vmax), Math.abs(result.Vmin), 0.001) : 1;
  const diagH = 70;
  const mY0 = beamY + beamH + 24;
  const vY0 = mY0 + diagH + 28;
  const svgH = vY0 + diagH + 36;

  const mScale = diagH / Mabs;
  const vScale = diagH / Vabs;

  const pathFromValues = (ys, scale, y0, flip = false) => {
    if (!ys || !ys.length) return "";
    return ys.map((v, i) => {
      const x = padX + (i / (ys.length - 1)) * beamW;
      const y = y0 + diagH / 2 - v * scale * (flip ? -1 : 1);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  };

  return (
    <svg viewBox={`0 0 ${W} ${svgH}`} style={{ width: "100%", maxWidth: W, display: "block", margin: "0 auto" }}>
      <rect width={W} height={svgH} fill="#fff" />

      {/* ── Beam ── */}
      <rect x={padX} y={beamY} width={beamW} height={beamH} fill="#d1d5db" stroke="#374151" strokeWidth={1.5} rx={2} />
      {/* Supports */}
      {[[padX, beamY + beamH], [padX + beamW, beamY + beamH]].map(([x, y], i) => (
        <polygon key={i} points={`${x},${y} ${x - 9},${y + 14} ${x + 9},${y + 14}`} fill="#374151" />
      ))}
      <line x1={padX - 10} y1={beamY + beamH + 14} x2={padX + beamW + 10} y2={beamY + beamH + 14} stroke="#374151" strokeWidth={1.5} />

      {/* ── Loads on the beam ── */}
      {loads.map((load, idx) => {
        if (load.type === "point") {
          const x = toX(load.x);
          const arrowLen = Math.min(Math.abs(load.P) * arrowScale, 44);
          const dir = load.P >= 0 ? 1 : -1;
          const y1 = beamY - arrowLen * dir;
          return (
            <g key={idx}>
              <line x1={x} y1={y1} x2={x} y2={beamY} stroke="#dc2626" strokeWidth={2} markerEnd="url(#arrow-r)" />
              <text x={x} y={y1 - 4} textAnchor="middle" fontSize={9} fill="#dc2626" fontFamily={MONO}>{load.P > 0 ? "↓" : "↑"}{Math.abs(load.P).toFixed(1)}k</text>
            </g>
          );
        }
        if (load.type === "udl" || load.type === "pudl") {
          const x1 = toX(load.type === "pudl" ? load.x1 : 0);
          const x2 = toX(load.type === "pudl" ? load.x2 : span);
          const arrowH = Math.min(Math.abs(load.w) * arrowScale, 36);
          const color = "#2563eb";
          const yt = beamY - arrowH;
          const arrows = [];
          const steps = Math.max(3, Math.floor((x2 - x1) / 18));
          for (let i = 0; i <= steps; i++) {
            const ax = x1 + (x2 - x1) * (i / steps);
            arrows.push(<line key={i} x1={ax} y1={yt} x2={ax} y2={beamY - 2} stroke={color} strokeWidth={1.5} markerEnd="url(#arrow-b)" />);
          }
          return (
            <g key={idx}>
              <line x1={x1} y1={yt} x2={x2} y2={yt} stroke={color} strokeWidth={1.5} />
              {arrows}
              <text x={(x1 + x2) / 2} y={yt - 5} textAnchor="middle" fontSize={9} fill={color} fontFamily={MONO}>{Math.abs(load.w).toFixed(2)} k/ft</text>
            </g>
          );
        }
        return null;
      })}

      {/* ── Bending moment diagram ── */}
      {result && (<>
        <text x={padX} y={mY0 - 6} fontSize={9} fontWeight={700} fill="#374151" fontFamily={MONO}>BENDING MOMENT (kip-ft)</text>
        <line x1={padX} y1={mY0 + diagH / 2} x2={padX + beamW} y2={mY0 + diagH / 2} stroke="#e5e7eb" strokeWidth={0.8} />
        <path d={pathFromValues(result.M, mScale, mY0)} fill="#bfdbfe" fillOpacity={0.5} stroke="#2563eb" strokeWidth={1.5} />
        <text x={padX - 4} y={mY0 + diagH / 2 + 4} textAnchor="end" fontSize={8} fill="#374151" fontFamily={MONO}>0</text>
        <text x={padX - 4} y={mY0 + 4} textAnchor="end" fontSize={8} fill="#2563eb" fontFamily={MONO}>{result.Mmax.toFixed(1)}</text>
      </>)}

      {/* ── Shear diagram ── */}
      {result && (<>
        <text x={padX} y={vY0 - 6} fontSize={9} fontWeight={700} fill="#374151" fontFamily={MONO}>SHEAR FORCE (kips)</text>
        <line x1={padX} y1={vY0 + diagH / 2} x2={padX + beamW} y2={vY0 + diagH / 2} stroke="#e5e7eb" strokeWidth={0.8} />
        <path d={pathFromValues(result.V, vScale, vY0)} fill="#bbf7d0" fillOpacity={0.5} stroke="#16a34a" strokeWidth={1.5} />
        <text x={padX - 4} y={vY0 + diagH / 2 + 4} textAnchor="end" fontSize={8} fill="#374151" fontFamily={MONO}>0</text>
        <text x={padX - 4} y={vY0 + 4} textAnchor="end" fontSize={8} fill="#16a34a" fontFamily={MONO}>{result.Vmax.toFixed(1)}</text>
        <text x={padX - 4} y={vY0 + diagH - 2} textAnchor="end" fontSize={8} fill="#16a34a" fontFamily={MONO}>{result.Vmin.toFixed(1)}</text>
      </>)}

      {/* Span label */}
      <text x={padX + beamW / 2} y={svgH - 6} textAnchor="middle" fontSize={9} fill="#374151" fontFamily={MONO}>Span = {span} ft</text>

      <defs>
        <marker id="arrow-r" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#dc2626" />
        </marker>
        <marker id="arrow-b" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#2563eb" />
        </marker>
      </defs>
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════
// LOAD ENTRY FORM — for adding a single load to a case
// ═══════════════════════════════════════════════════════════════
function AddLoadForm({ span, onAdd }) {
  const [type, setType] = useState("udl");
  const [P, setP] = useState(10);
  const [x, setX] = useState(span / 2);
  const [w, setW] = useState(1.0);
  const [x1, setX1] = useState(0);
  const [x2, setX2] = useState(span);

  const iS = { padding: "4px 6px", border: "1.5px solid #e8a838", borderRadius: 3, fontSize: 11, fontFamily: MONO, background: "#fff8ef", width: "100%", boxSizing: "border-box" };

  const handleAdd = () => {
    if (type === "point") onAdd({ type: "point", P, x });
    else if (type === "udl") onAdd({ type: "udl", w });
    else if (type === "pudl") onAdd({ type: "pudl", w, x1, x2 });
  };

  return (
    <div style={{ background: "#f8f9fa", border: "1px solid #dee2e6", borderRadius: 6, padding: 10, marginBottom: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {["point", "udl", "pudl"].map(t => (
          <button key={t} onClick={() => setType(t)} style={{
            padding: "4px 10px", borderRadius: 14, fontSize: 10, fontFamily: MONO, cursor: "pointer", fontWeight: type === t ? 700 : 400,
            border: type === t ? "2px solid #2563eb" : "1px solid #ced4da",
            background: type === t ? "#eff6ff" : "#fff", color: type === t ? "#1d4ed8" : "#495057",
          }}>
            {t === "point" ? "Point Load" : t === "udl" ? "Full UDL" : "Partial UDL"}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "flex-end" }}>
        {type === "point" && (<>
          <div style={{ flex: 1, minWidth: 90 }}>
            <div style={{ fontSize: 9, color: "#6c757d", marginBottom: 2, fontFamily: MONO }}>P (kips) ↓+</div>
            <input type="number" value={P} step={0.5} onChange={e => setP(Number(e.target.value))} style={iS} />
          </div>
          <div style={{ flex: 1, minWidth: 90 }}>
            <div style={{ fontSize: 9, color: "#6c757d", marginBottom: 2, fontFamily: MONO }}>Position x (ft)</div>
            <input type="number" value={x} step={0.5} min={0} max={span} onChange={e => setX(Number(e.target.value))} style={iS} />
          </div>
        </>)}

        {type === "udl" && (
          <div style={{ flex: 1, minWidth: 120 }}>
            <div style={{ fontSize: 9, color: "#6c757d", marginBottom: 2, fontFamily: MONO }}>w (kip/ft) full span</div>
            <input type="number" value={w} step={0.05} onChange={e => setW(Number(e.target.value))} style={iS} />
          </div>
        )}

        {type === "pudl" && (<>
          <div style={{ flex: 1, minWidth: 80 }}>
            <div style={{ fontSize: 9, color: "#6c757d", marginBottom: 2, fontFamily: MONO }}>w (kip/ft)</div>
            <input type="number" value={w} step={0.05} onChange={e => setW(Number(e.target.value))} style={iS} />
          </div>
          <div style={{ flex: 1, minWidth: 70 }}>
            <div style={{ fontSize: 9, color: "#6c757d", marginBottom: 2, fontFamily: MONO }}>x₁ (ft)</div>
            <input type="number" value={x1} step={0.5} min={0} max={span} onChange={e => setX1(Number(e.target.value))} style={iS} />
          </div>
          <div style={{ flex: 1, minWidth: 70 }}>
            <div style={{ fontSize: 9, color: "#6c757d", marginBottom: 2, fontFamily: MONO }}>x₂ (ft)</div>
            <input type="number" value={x2} step={0.5} min={0} max={span} onChange={e => setX2(Number(e.target.value))} style={iS} />
          </div>
        </>)}

        <button onClick={handleAdd} style={{ padding: "5px 12px", borderRadius: 4, border: "none", background: "#212529", color: "#fff", fontFamily: MONO, fontWeight: 700, fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>
          + Add Load
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// COMBO EDITOR — lets user define/edit load combinations
// ═══════════════════════════════════════════════════════════════
function ComboEditor({ combos, setCombos, caseNames }) {
  const [editIdx, setEditIdx] = useState(null);

  const addCombo = () => {
    const newCombo = { name: `Combo ${combos.length + 1}`, factors: Object.fromEntries(caseNames.map(n => [n, 0])) };
    setCombos(prev => [...prev, newCombo]);
    setEditIdx(combos.length);
  };

  const updateFactor = (comboIdx, caseName, val) => {
    setCombos(prev => prev.map((c, i) => i !== comboIdx ? c : { ...c, factors: { ...c.factors, [caseName]: Number(val) } }));
  };

  const updateName = (idx, name) => {
    setCombos(prev => prev.map((c, i) => i !== idx ? c : { ...c, name }));
  };

  return (
    <div>
      {combos.map((combo, idx) => (
        <div key={idx} style={{ marginBottom: 6, background: "#f8f9fa", border: "1px solid #dee2e6", borderRadius: 6, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "6px 10px", gap: 8, background: "#fff", borderBottom: editIdx === idx ? "1px solid #dee2e6" : "none" }}>
            <span style={{ fontSize: 11, fontWeight: 700, fontFamily: MONO, flex: 1 }}>{combo.name}</span>
            <span style={{ fontSize: 10, color: "#868e96", fontFamily: MONO }}>
              {caseNames.filter(n => combo.factors[n]).map(n => `${combo.factors[n]}×${n}`).join(" + ")}
            </span>
            <button onClick={() => setEditIdx(editIdx === idx ? null : idx)} style={{ padding: "2px 8px", fontSize: 10, borderRadius: 3, border: "1px solid #ced4da", background: "#fff", cursor: "pointer" }}>
              {editIdx === idx ? "Done" : "Edit"}
            </button>
            <button onClick={() => setCombos(prev => prev.filter((_, i) => i !== idx))} style={{ padding: "2px 6px", fontSize: 10, borderRadius: 3, border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", cursor: "pointer" }}>✕</button>
          </div>
          {editIdx === idx && (
            <div style={{ padding: 10 }}>
              <div style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 9, color: "#6c757d", fontFamily: MONO }}>Combination Name</span>
                <input value={combo.name} onChange={e => updateName(idx, e.target.value)} style={{ display: "block", width: "100%", boxSizing: "border-box", padding: "4px 6px", border: "1.5px solid #e8a838", borderRadius: 3, fontSize: 11, fontFamily: MONO, background: "#fff8ef", marginTop: 2 }} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {caseNames.map(name => (
                  <div key={name} style={{ minWidth: 70 }}>
                    <div style={{ fontSize: 9, color: "#6c757d", fontFamily: MONO, marginBottom: 2 }}>γ×{name}</div>
                    <input type="number" value={combo.factors[name] ?? 0} step={0.1} min={0}
                      onChange={e => updateFactor(idx, name, e.target.value)}
                      style={{ padding: "4px 6px", border: "1.5px solid #e8a838", borderRadius: 3, fontSize: 11, fontFamily: MONO, background: "#fff8ef", width: "100%", boxSizing: "border-box" }} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
      <button onClick={addCombo} style={{ padding: "5px 12px", border: "1px dashed #ced4da", borderRadius: 4, background: "#fff", fontFamily: MONO, fontSize: 11, cursor: "pointer", width: "100%", color: "#495057" }}>
        + New Combination
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN HOOK — useLoadingSystem
// Returns everything a tab needs: load state, combo state,
// active results, and the rendered UI components.
// Usage:
//   const ls = useLoadingSystem({ span });
//   // then show ls.LoadManagerUI somewhere in the tab
//   // and read ls.result.Mmax, ls.result.Vmax etc. in calcs
// ═══════════════════════════════════════════════════════════════
export function useLoadingSystem({ span }) {
  // Load cases: { "DL": [{type,P,x,...}], "LL": [...], ... }
  const [cases, setCases] = useState(() => {
    const init = {};
    DEFAULT_CASES.forEach(name => { init[name] = []; });
    // Pre-populate with a typical self-weight guess
    init["DL"] = [{ type: "udl", w: 0.3 }];
    init["LL"] = [{ type: "udl", w: 0.5 }];
    return init;
  });

  const [combos, setCombos] = useState(DEFAULT_COMBOS.map(c => ({ ...c, factors: { ...c.factors } })));
  const [activeCase, setActiveCase] = useState("DL");
  const [activeCombo, setActiveCombo] = useState(0);
  const [showCombos, setShowCombos] = useState(false);

  const caseNames = Object.keys(cases);

  const addCase = (name) => {
    if (!name.trim() || cases[name]) return;
    setCases(prev => ({ ...prev, [name.trim()]: [] }));
    // Add this case to all existing combos with factor 0
    setCombos(prev => prev.map(c => ({ ...c, factors: { ...c.factors, [name.trim()]: 0 } })));
  };

  const removeCase = (name) => {
    if (DEFAULT_CASES.includes(name)) return; // protect defaults
    setCases(prev => { const n = { ...prev }; delete n[name]; return n; });
  };

  const addLoad = useCallback((caseName, load) => {
    setCases(prev => ({ ...prev, [caseName]: [...(prev[caseName] || []), load] }));
  }, []);

  const removeLoad = useCallback((caseName, idx) => {
    setCases(prev => ({ ...prev, [caseName]: prev[caseName].filter((_, i) => i !== idx) }));
  }, []);

  // Build the factored loads for the active combo
  const factoredLoads = useMemo(() => {
    const combo = combos[activeCombo];
    if (!combo) return [];
    const loads = [];
    for (const [caseName, factor] of Object.entries(combo.factors)) {
      if (!factor || !cases[caseName]) continue;
      for (const load of cases[caseName]) {
        loads.push({ ...load, P: (load.P || 0) * factor, w: (load.w || 0) * factor });
      }
    }
    return loads;
  }, [cases, combos, activeCombo]);

  // Run analysis on factored loads
  const result = useMemo(() => analyzeLoads(factoredLoads, span), [factoredLoads, span]);

  // ── The rendered UI that tabs embed ──
  const [newCaseName, setNewCaseName] = useState("");
  const MONO = "'JetBrains Mono','Fira Code','Consolas',monospace";
  const caseColors = { DL:"#374151", SDL:"#0284c7", LL:"#16a34a", Wind:"#9333ea" };
  const getColor = (name) => caseColors[name] || "#374151";

  const LoadManagerUI = (
    <div>
      {/* Load case tabs */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
        {caseNames.map(name => (
          <button key={name} onClick={() => setActiveCase(name)} style={{
            padding: "5px 12px", borderRadius: 14, fontSize: 11, fontFamily: MONO, cursor: "pointer",
            border: activeCase === name ? `2px solid ${getColor(name)}` : "1px solid #ced4da",
            background: activeCase === name ? "#fff" : "#f9fafb",
            color: activeCase === name ? getColor(name) : "#495057",
            fontWeight: activeCase === name ? 700 : 400,
          }}>
            {name}
            {cases[name]?.length > 0 && <span style={{ marginLeft: 4, fontSize: 10, background: getColor(name), color: "#fff", borderRadius: 8, padding: "1px 5px" }}>{cases[name].length}</span>}
          </button>
        ))}
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input placeholder="+ New case" value={newCaseName} onChange={e => setNewCaseName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { addCase(newCaseName); setNewCaseName(""); } }}
            style={{ padding: "4px 8px", border: "1px dashed #ced4da", borderRadius: 12, fontSize: 10, fontFamily: MONO, width: 90 }} />
        </div>
      </div>

      {/* Add load form for active case */}
      <AddLoadForm span={span} onAdd={load => addLoad(activeCase, load)} />

      {/* Load list for active case */}
      {(cases[activeCase] || []).length > 0 ? (
        <div style={{ marginBottom: 8 }}>
          {cases[activeCase].map((load, idx) => (
            <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 10px", background: "#f8f9fa", border: "1px solid #dee2e6", borderRadius: 4, marginBottom: 4, fontSize: 11, fontFamily: MONO }}>
              <span>
                {load.type === "point" && <><b>↓{load.P > 0 ? "" : "↑"}{Math.abs(load.P)} kip</b> at x={load.x} ft</>}
                {load.type === "udl" && <><b>{load.w} kip/ft</b> full span UDL</>}
                {load.type === "pudl" && <><b>{load.w} kip/ft</b> from {load.x1}→{load.x2} ft</>}
              </span>
              <button onClick={() => removeLoad(activeCase, idx)} style={{ padding: "2px 7px", border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", borderRadius: 3, fontSize: 10, cursor: "pointer" }}>✕</button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: "#9ca3af", fontSize: 11, fontFamily: MONO, marginBottom: 8, padding: "6px 10px", background: "#f9fafb", borderRadius: 4 }}>No loads in {activeCase} case yet — add one above.</div>
      )}

      {/* Beam diagram */}
      <div style={{ border: "1px solid #dee2e6", borderRadius: 6, padding: "8px 4px", marginBottom: 10, background: "#fafafa" }}>
        <BeamLoadDiagram cases={cases} activeCaseName={activeCase} span={span} result={null} />
      </div>

      {/* Combo selector + envelope result */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, fontFamily: MONO, color: "#374151" }}>Active Combination:</span>
        <select value={activeCombo} onChange={e => setActiveCombo(Number(e.target.value))}
          style={{ padding: "4px 8px", border: "1.5px solid #e8a838", borderRadius: 4, fontSize: 11, fontFamily: MONO, background: "#fff8ef" }}>
          {combos.map((c, i) => <option key={i} value={i}>{c.name}</option>)}
        </select>
        <button onClick={() => setShowCombos(s => !s)} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #ced4da", background: "#fff", fontSize: 10, fontFamily: MONO, cursor: "pointer" }}>
          {showCombos ? "▲ Hide" : "▼ Edit Combos"}
        </button>
      </div>

      {showCombos && (
        <div style={{ marginBottom: 10, padding: 10, background: "#f8f9fa", border: "1px solid #dee2e6", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, fontFamily: MONO, marginBottom: 8, color: "#374151" }}>Load Combinations</div>
          <ComboEditor combos={combos} setCombos={setCombos} caseNames={caseNames} />
        </div>
      )}

      {/* Envelope diagrams */}
      <div style={{ border: "1px solid #dee2e6", borderRadius: 6, padding: "8px 4px", background: "#fafafa" }}>
        <div style={{ fontSize: 10, fontWeight: 700, fontFamily: MONO, color: "#374151", padding: "0 8px 4px" }}>
          ENVELOPE — {combos[activeCombo]?.name || ""}
        </div>
        <BeamLoadDiagram cases={cases} activeCaseName={activeCase} span={span} result={result} />
        <div style={{ display: "flex", gap: 16, padding: "4px 12px", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontFamily: MONO, color: "#2563eb" }}>Mmax = <b>{result.Mmax.toFixed(2)}</b> kip-ft</span>
          <span style={{ fontSize: 11, fontFamily: MONO, color: "#2563eb" }}>Mmin = <b>{result.Mmin.toFixed(2)}</b> kip-ft</span>
          <span style={{ fontSize: 11, fontFamily: MONO, color: "#16a34a" }}>Vmax = <b>{result.Vmax.toFixed(2)}</b> kips</span>
          <span style={{ fontSize: 11, fontFamily: MONO, color: "#16a34a" }}>Vmin = <b>{result.Vmin.toFixed(2)}</b> kips</span>
        </div>
      </div>
    </div>
  );

  return {
    result,
    Mu: result.Mmax, // factored Mu for design (kip-ft)
    Vu: result.Vmax, // factored Vu for design (kips)
    LoadManagerUI,
    cases,
    combos,
    activeCombo,
  };
}
