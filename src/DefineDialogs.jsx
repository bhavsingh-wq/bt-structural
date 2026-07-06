// ═══════════════════════════════════════════════════════════════
// DEFINE DIALOGS — matching ConCise Beam's Define menu dialogs
//
// Implements all 7 core Define dialogs seen in the tutorial:
//   1. Concrete Material    (Image 1)
//   2. Beam Definition      (Image 2)
//   3. Section Library      (Image 3)
//   4. CIP Pour Definition  (Image 4)
//   5. Reinforcing Steel    (Image 5)
//   6. Prestressing         (Image 6)
//   7. Shear Strengthening  (Image 7)
//   8. Design Parameters    (Image 8)
//
// Each dialog saves to a shared DefineContext so the calculator
// tabs can read and use the user-defined values.
// ═══════════════════════════════════════════════════════════════
import { useState, createContext, useContext } from "react";
import { ModalShell, btnS } from "./CalcOptions";

const MONO = "'JetBrains Mono','Fira Code','Consolas',monospace";

// ── Shared input style ────────────────────────────────────────
const iS = {
  padding:"4px 6px", border:"1px solid #ced4da", borderRadius:3,
  fontSize:12, fontFamily:MONO, background:"#fff", boxSizing:"border-box",
};
const orangeI = { ...iS, background:"#fff8ef", border:"1.5px solid #e8a838" };

// ── Small labeled field helper ────────────────────────────────
function Field({ label, value, onChange, unit, type="number", step, min, options, width=90 }) {
  return (
    <div style={{ display:"inline-flex", flexDirection:"column", marginRight:10, marginBottom:6, minWidth:width }}>
      <span style={{ fontSize:9, color:"#6c757d", marginBottom:2, fontFamily:MONO }}>{label}</span>
      {options
        ? <select value={value} onChange={e=>onChange(e.target.value)} style={{ ...orangeI, width }}>
            {options.map(o=><option key={o.value??o} value={o.value??o}>{o.label??o}</option>)}
          </select>
        : <div style={{ display:"flex", alignItems:"center", gap:3 }}>
            <input type={type} value={value} step={step} min={min}
              onChange={e=>onChange(type==="number"?Number(e.target.value):e.target.value)}
              style={{ ...orangeI, width }}/>
            {unit && <span style={{ fontSize:10, color:"#868e96", whiteSpace:"nowrap" }}>{unit}</span>}
          </div>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom:14 }}>
      <div style={{ fontSize:11, fontWeight:700, color:"#374151", marginBottom:6,
        borderBottom:"1px solid #dee2e6", paddingBottom:4 }}>{title}</div>
      {children}
    </div>
  );
}

function CheckField({ label, checked, onChange }) {
  return (
    <label style={{ display:"flex", alignItems:"flex-start", gap:7, cursor:"pointer", marginBottom:5, fontSize:11 }}>
      <input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}
        style={{ marginTop:1, flexShrink:0 }}/>
      {label}
    </label>
  );
}

function RadioField({ label, checked, onChange }) {
  return (
    <label style={{ display:"flex", alignItems:"center", gap:7, cursor:"pointer", marginBottom:4, fontSize:11 }}>
      <input type="radio" checked={checked} onChange={()=>onChange()} style={{ flexShrink:0 }}/>
      {label}
    </label>
  );
}

const FooterRow = ({ onOK, onCancel, extraLeft }) => (
  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
    paddingTop:12, borderTop:"1px solid #dee2e6", marginTop:12, flexWrap:"wrap", gap:8 }}>
    <div style={{ display:"flex", gap:6 }}>{extraLeft}</div>
    <div style={{ display:"flex", gap:6 }}>
      <button onClick={onOK} style={{ ...btnS, background:"#2563eb", color:"#fff", border:"none", padding:"5px 20px" }}>OK</button>
      <button onClick={onCancel} style={btnS}>Cancel</button>
      <button style={{ ...btnS, marginLeft:8 }}>to US Units</button>
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════
// DEFAULT VALUES (matching ConCise metric defaults)
// ═══════════════════════════════════════════════════════════════
export const DEFAULT_CONCRETE = {
  // Precast beam
  precastDensity: 2400,  // kg/m³
  fc: 48,                // MPa
  fr: 4.1569,            // MPa (auto)
  Ec: 31725,             // MPa (auto)
  // At transfer
  fci: 28,               // MPa
  fri: 3.1749,           // MPa (auto)
  Eci: 25968,            // MPa (auto)
  // During initial lifting
  fcl: 30,               // MPa
  frl: 3.2863,           // MPa
  Ecl: 26621,            // MPa
  // CIP pour
  cipDensity: 2400,
  fcCIP: 30,
  frCIP: 3.2863,
  EcCIP: 26621,
  // Options
  flowable: false,
  steelFibre: false,
  noRecalcFr: false,
  noRecalcEc: false,
  stressStrainModel: "PCA Parabola-Rectangle Curve",
};

export const DEFAULT_BEAM = {
  name: "1048",
  sectionType: "Hollowcore",
  segmentLength: 7,       // m
  verticalOffset: 0,
  lateralOffset: 0,
  // Supports
  storageLeft: 0.3,
  storageRight: 6.7,
  serviceLeft: 0,
  serviceRight: 7,
  bearingLength: 63,      // mm
};

export const DEFAULT_CIP = {
  t1: 0, b1: 0, z1: 0,
  t2: 0, b2: 0, z2: 0,
  y: 0,
  interfaceWidth: 0,
  interfaceOffset: 0,
  noCIP: false,
  notComposite: false,
  checkDuringCIP: false,
  torsionOffset: false,
  topRoughened: true,
};

export const DEFAULT_REBAR = {
  groups: [],
  // Current entry state
  nBars: 0, spacing: 300, weldedWire: false, epoxyCoated: false,
  verticalOffset: 25,
  offsetRef: "Bottom of Precast Beam [BB]",
  barLayout: "Offsets from Each End of Beam [EE]",
  leftEndType: "Straight Embed. [SE]",
  rightEndType: "Straight Embed. [SE]",
  barName: "15M", dia: 16, A: 200, fy: 400, E: 200000,
};

export const DEFAULT_PRESTRESS = {
  groups: [],
  // Current entry state
  nStrands: 0,
  lockOffRatio: 0.75,
  heightLeft: 25,       // mm from bottom
  epoxyCoated: false,
  leftEndType: "Fully Bonded (B)",
  rightEndType: "Fully Bonded (B)",
  leftOffset: 0,
  rightOffset: 0,
  strandName: "12.7 (1/2\")",
  dia: 12.7, A: 98.7, fpu: 1860, E: 200000,
  strandType: "Low-Relaxation Strand",
};

export const DEFAULT_SHEAR = {
  // Vertical stirrups
  stirrupFrom: 0, stirrupTo: 7,
  stirrupSymmetric: false,
  notReinforcedShear: false,
  stirrupFy: 400, stirrupE: 200000,
  stirrupName: "15M", stirrupDia: 16, stirrupArea: 200,
  stirrupLegs: 2, stirrupSpacing: 0,
  // Interface ties
  tieFrom: 0, tieTo: 7,
  tieSymmetric: false,
  notReinforcedInterface: false,
  tieFy: 400, tieE: 200000,
  tieName: "15M", tieDia: 16, tieArea: 200,
  tieLegs: 0, tieSpacing: 0,
  // Options
  calcRequiredShear: true,
  calcRequiredInterface: true,
  fillCores: true,
  burstingSteel: false,
  partOfSlab: false,
  supportedFromBottom: true,
  nonCompForVertical: false,
};

export const DEFAULT_DESIGN_PARAMS = {
  lossMethod: "ACI 209 Detailed Method (CPCI)",
  usePredefinedLosses: false,
  initialLoss: 18,
  totalLoss: 21,
  varyLossesAlongBeam: true,
  // Precast concrete parameters
  slump: 50, cement: 410, air: 5,
  fineAggregate: 0.4, aggregateSize: 20,
  hydrationRate: "Normal", shrinkageStrain: 780,
  curingMethod: "Moist Cured",
  // Construction schedule (days)
  transferDay: 0.75, initialLiftDay: 1,
  erectionDay: 40, cipDay: 50, compositeDay: 53, completionDay: 143,
  // Service environment
  RH: 70, ambientTemp: 20,
  exposure: "Interior",
};

// ── Global Define context ──────────────────────────────────────
export const DefineContext = createContext({
  concrete: DEFAULT_CONCRETE,
  beam: DEFAULT_BEAM,
  cip: DEFAULT_CIP,
  rebar: DEFAULT_REBAR,
  prestress: DEFAULT_PRESTRESS,
  shear: DEFAULT_SHEAR,
  designParams: DEFAULT_DESIGN_PARAMS,
});
export const useDefine = () => useContext(DefineContext);

// ═══════════════════════════════════════════════════════════════
// 1. CONCRETE MATERIAL DIALOG
// ═══════════════════════════════════════════════════════════════
export function ConcreteMaterialModal({ data, setData, onClose }) {
  const [local, setLocal] = useState({ ...data });
  const set = (k, v) => setLocal(l => ({ ...l, [k]: v }));

  // Auto-compute fr = 0.6√fc (MPa) when fc changes, if not locked
  const autoFr  = (fc)  => +(0.6 * Math.sqrt(fc)).toFixed(4);
  const autoEc  = (fc, density) => Math.round(density ** 1.5 * 0.043 * Math.sqrt(fc));

  const handleFcChange = (v) => {
    const newFc = Number(v);
    set("fc", newFc);
    if (!local.noRecalcFr) set("fr",  autoFr(newFc));
    if (!local.noRecalcEc) set("Ec",  autoEc(newFc, local.precastDensity));
  };
  const handleFciChange = (v) => {
    const n = Number(v);
    set("fci", n);
    if (!local.noRecalcFr) set("fri", autoFr(n));
    if (!local.noRecalcEc) set("Eci", autoEc(n, local.precastDensity));
  };
  const handleFclChange = (v) => {
    const n = Number(v);
    set("fcl", n);
    if (!local.noRecalcFr) set("frl", autoFr(n));
    if (!local.noRecalcEc) set("Ecl", autoEc(n, local.precastDensity));
  };
  const handleFcCIPChange = (v) => {
    const n = Number(v);
    set("fcCIP", n);
    if (!local.noRecalcFr) set("frCIP", autoFr(n));
    if (!local.noRecalcEc) set("EcCIP", autoEc(n, local.cipDensity));
  };

  const SS_MODELS = ["PCA Parabola-Rectangle Curve","Collins-Mitchell Non-Linear Curve","Yang-Mun-Cho-Kang Non-Linear Curve"];

  return (
    <ModalShell title="Concrete Material" onClose={onClose} width={700}>
      <div style={{ display:"flex", gap:24 }}>
        {/* Left: Precast */}
        <div style={{ flex:1 }}>
          <Section title="Precast Beam">
            <Field label="Density" value={local.precastDensity} onChange={v=>set("precastDensity",v)} unit="kg/m³" width={80}/>
            <Field label="f′c" value={local.fc} onChange={handleFcChange} unit="MPa" step={1} width={80}/>
            <Field label="fr *" value={local.fr} onChange={v=>set("fr",v)} unit="MPa" step={0.001} width={90}/>
            <Field label="Ec" value={local.Ec} onChange={v=>set("Ec",v)} unit="MPa" step={100} width={80}/>
          </Section>
          <Section title="At Transfer (prestressed beams)">
            <Field label="fci" value={local.fci} onChange={handleFciChange} unit="MPa" step={1} width={80}/>
            <Field label="fri *" value={local.fri} onChange={v=>set("fri",v)} unit="MPa" step={0.001} width={90}/>
            <Field label="Eci" value={local.Eci} onChange={v=>set("Eci",v)} unit="MPa" step={100} width={80}/>
          </Section>
          <Section title="During Initial Lifting">
            <Field label="fci" value={local.fcl} onChange={handleFclChange} unit="MPa" step={1} width={80}/>
            <Field label="fri *" value={local.frl} onChange={v=>set("frl",v)} unit="MPa" step={0.001} width={90}/>
            <Field label="Eci" value={local.Ecl} onChange={v=>set("Ecl",v)} unit="MPa" step={100} width={80}/>
          </Section>
          <div style={{ marginTop:6 }}>
            <CheckField label="Flow-able Concrete (i.e. SCC)" checked={local.flowable} onChange={v=>set("flowable",v)}/>
            <CheckField label="Steel-Fibre Reinforced" checked={local.steelFibre} onChange={v=>set("steelFibre",v)}/>
          </div>
        </div>

        {/* Right: CIP + options */}
        <div style={{ flex:1 }}>
          <Section title="Cast-in-Place Pour">
            <Field label="Density" value={local.cipDensity} onChange={v=>set("cipDensity",v)} unit="kg/m³" width={80}/>
            <Field label="f′c" value={local.fcCIP} onChange={handleFcCIPChange} unit="MPa" step={1} width={80}/>
            <Field label="fr *" value={local.frCIP} onChange={v=>set("frCIP",v)} unit="MPa" step={0.001} width={90}/>
            <Field label="Ec" value={local.EcCIP} onChange={v=>set("EcCIP",v)} unit="MPa" step={100} width={80}/>
          </Section>

          <Section title="Automatic Calculation of fr or Ec">
            <CheckField label="Do Not Recalculate fr and fri (user-defined value)" checked={local.noRecalcFr} onChange={v=>set("noRecalcFr",v)}/>
            <CheckField label="Do Not Recalculate Ec and Eci (user-defined value)" checked={local.noRecalcEc} onChange={v=>set("noRecalcEc",v)}/>
          </Section>

          <Section title="Stress-Strain Model">
            <select value={local.stressStrainModel} onChange={e=>set("stressStrainModel",e.target.value)}
              style={{ ...orangeI, width:"100%", padding:"5px 8px" }}>
              {SS_MODELS.map(m=><option key={m} value={m}>{m}</option>)}
            </select>
          </Section>

          <div style={{ marginTop:10, fontSize:10, color:"#6c757d", lineHeight:1.5 }}>
            * fr or fri are the modulus of rupture for flexure based on the associated concrete strength, fc or fci
          </div>
        </div>
      </div>

      <FooterRow
        onOK={()=>{ setData(local); onClose(); }}
        onCancel={onClose}
        extraLeft={[
          <button key="save" style={btnS}>Save as the Default Properties</button>,
          <button key="rest" style={btnS} onClick={()=>setLocal({...DEFAULT_CONCRETE})}>Restore the Default Properties</button>,
        ]}
      />
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════════
// 2. BEAM DEFINITION DIALOG
// ═══════════════════════════════════════════════════════════════
export function BeamDefinitionModal({ data, setData, onClose }) {
  const [local, setLocal] = useState({ ...data });
  const set = (k, v) => setLocal(l => ({ ...l, [k]: v }));
  const SECTION_TYPES = ["Hollowcore","IT Beam","Ledger Beam","Double Tee","Box Beam","Rectangular","T-Beam","Custom"];

  return (
    <ModalShell title="Beam Definition" onClose={onClose} width={760}>
      <div style={{ display:"flex", gap:16 }}>
        {/* Left: inputs */}
        <div style={{ flex:1 }}>
          <Section title="Segment Details">
            <div style={{ display:"flex", gap:8, marginBottom:8 }}>
              <button style={btnS}>Select Section from Library</button>
              <button style={btnS}>Create a New Section</button>
            </div>
            <div style={{ display:"flex", gap:8, marginBottom:8 }}>
              <button style={btnS}>Section Properties</button>
              <button style={btnS}>Trim or Edit Section</button>
            </div>
            <Field label="Name" value={local.name} onChange={v=>set("name",v)} type="text" width={120}/>
            <Field label="Section Type" value={local.sectionType} onChange={v=>set("sectionType",v)} options={SECTION_TYPES} width={160}/>
            <Field label="Segment Length" value={local.segmentLength} onChange={v=>set("segmentLength",v)} unit="m" step={0.1} width={80}/>
            <Field label="Vertical Bottom Offset" value={local.verticalOffset} onChange={v=>set("verticalOffset",v)} unit="mm" step={1} width={80}/>
            <Field label="Lateral Offset from Left Edge" value={local.lateralOffset} onChange={v=>set("lateralOffset",v)} unit="mm" step={1} width={80}/>
            <button style={{ ...btnS, marginTop:6 }}>Define Openings</button>
          </Section>

          <Section title="User-Defined Beam Segment List">
            <div style={{ display:"flex", gap:6, marginBottom:8 }}>
              {["Add","Modify","Delete","Move Up","Move Down"].map(a=>(
                <button key={a} style={{ ...btnS, padding:"3px 8px", fontSize:10 }}>{a}</button>
              ))}
            </div>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
              <thead>
                <tr style={{ background:"#f8f9fa" }}>
                  {["#","Section Name","Length","Offset Z","Offset Y","Openings?"].map(h=>(
                    <th key={h} style={{ padding:"4px 8px", border:"1px solid #dee2e6", textAlign:"left", fontWeight:600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding:"4px 8px", border:"1px solid #dee2e6" }}>1</td>
                  <td style={{ padding:"4px 8px", border:"1px solid #dee2e6" }}>{local.name}</td>
                  <td style={{ padding:"4px 8px", border:"1px solid #dee2e6" }}>{local.segmentLength} m</td>
                  <td style={{ padding:"4px 8px", border:"1px solid #dee2e6" }}>0 mm</td>
                  <td style={{ padding:"4px 8px", border:"1px solid #dee2e6" }}>0 mm</td>
                  <td style={{ padding:"4px 8px", border:"1px solid #dee2e6" }}>—</td>
                </tr>
              </tbody>
            </table>
            <div style={{ fontSize:10, color:"#868e96", marginTop:4 }}>* additional segments may be automatically generated at openings</div>
            <div style={{ marginTop:4, fontSize:11 }}><b>Total Beam Length:</b> {local.segmentLength} m</div>
          </Section>

          <Section title="Supports">
            <table style={{ fontSize:11, borderCollapse:"collapse" }}>
              <thead>
                <tr>
                  <td></td>
                  <td style={{ padding:"3px 8px", fontWeight:600 }}></td>
                  <td style={{ padding:"3px 8px", fontWeight:600, color:"#2563eb" }}>Left Support</td>
                  <td style={{ padding:"3px 8px", fontWeight:600, color:"#2563eb" }}>Right Support</td>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding:"4px 6px", fontSize:10 }}>Support Center in Storage from</td>
                  <td><select style={{ ...orangeI, fontSize:10 }}><option>Left End of Beam</option></select></td>
                  <td style={{ padding:"4px 8px" }}>
                    <input type="number" value={local.storageLeft} step={0.1}
                      onChange={e=>set("storageLeft",Number(e.target.value))}
                      style={{ ...orangeI, width:60 }}/>
                  </td>
                  <td style={{ padding:"4px 8px" }}>
                    <input type="number" value={local.storageRight} step={0.1}
                      onChange={e=>set("storageRight",Number(e.target.value))}
                      style={{ ...orangeI, width:60 }}/>
                    <span style={{ fontSize:10, color:"#868e96", marginLeft:3 }}>m</span>
                  </td>
                </tr>
                <tr>
                  <td style={{ padding:"4px 6px", fontSize:10 }}>Support Center in Service from</td>
                  <td><select style={{ ...orangeI, fontSize:10 }}><option>Left End of Beam</option></select></td>
                  <td style={{ padding:"4px 8px" }}>
                    <input type="number" value={local.serviceLeft} step={0.1}
                      onChange={e=>set("serviceLeft",Number(e.target.value))}
                      style={{ ...orangeI, width:60 }}/>
                  </td>
                  <td style={{ padding:"4px 8px" }}>
                    <input type="number" value={local.serviceRight} step={0.1}
                      onChange={e=>set("serviceRight",Number(e.target.value))}
                      style={{ ...orangeI, width:60 }}/>
                    <span style={{ fontSize:10, color:"#868e96", marginLeft:3 }}>m</span>
                  </td>
                </tr>
                <tr>
                  <td colSpan={2} style={{ padding:"4px 6px", fontSize:10 }}>Bearing Length in Service (centered on support)</td>
                  <td style={{ padding:"4px 8px" }}>
                    <input type="number" value={local.bearingLength} step={1}
                      onChange={e=>set("bearingLength",Number(e.target.value))}
                      style={{ ...orangeI, width:60 }}/>
                  </td>
                  <td style={{ padding:"4px 8px" }}>
                    <input type="number" value={local.bearingLength} readOnly style={{ ...iS, width:60 }}/>
                    <span style={{ fontSize:10, color:"#868e96", marginLeft:3 }}>mm</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <button style={{ ...btnS, marginTop:8 }}>Beam Handling Parameters</button>
          </Section>
        </div>

        {/* Right: cross-section preview */}
        <div style={{ width:200, flexShrink:0 }}>
          <div style={{ border:"1px solid #dee2e6", borderRadius:4, padding:8, background:"#fafafa", textAlign:"center" }}>
            <div style={{ fontSize:10, color:"#868e96", marginBottom:8 }}>Section Preview</div>
            {/* Simple hollowcore cross-section sketch */}
            <svg viewBox="0 0 200 100" style={{ width:"100%", border:"1px solid #e5e7eb", background:"#fff" }}>
              <rect x={10} y={20} width={180} height={65} fill="#d1d5db" stroke="#374151" strokeWidth={2} rx={2}/>
              {[35,65,95,125,155].map((cx,i)=>(
                <ellipse key={i} cx={cx} cy={52} rx={16} ry={18} fill="#fff" stroke="#374151" strokeWidth={1.5}/>
              ))}
              <text x={100} y={14} textAnchor="middle" fontSize={9} fill="#374151" fontFamily={MONO}>
                {local.sectionType} · {local.segmentLength}m
              </text>
            </svg>
          </div>
          <div style={{ marginTop:8, fontSize:10, color:"#6c757d" }}>
            Width: 1219 mm<br/>
            Height: 254 mm
          </div>
        </div>
      </div>

      <div style={{ display:"flex", gap:8, marginTop:10, paddingTop:8, borderTop:"1px solid #dee2e6" }}>
        <span style={{ fontSize:11, fontWeight:600, color:"#374151", alignSelf:"center" }}>Go To Next …</span>
        <button style={btnS}>Define CIP Pour</button>
        <button style={btnS}>Torsion Parameters</button>
        <button style={btnS}>Define Loading</button>
      </div>

      <FooterRow onOK={()=>{ setData(local); onClose(); }} onCancel={onClose}/>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════════
// 4. CIP POUR DEFINITION
// ═══════════════════════════════════════════════════════════════
export function CIPPourModal({ data, setData, onClose }) {
  const [local, setLocal] = useState({ ...data });
  const [schematic, setSchematic] = useState("A");
  const set = (k, v) => setLocal(l => ({ ...l, [k]: v }));

  return (
    <ModalShell title="Cast-In-Place (CIP) Pour Definition" onClose={onClose} width={900}>
      <div style={{ display:"flex", gap:16 }}>
        {/* Left: inputs */}
        <div style={{ minWidth:320 }}>
          <Section title="Segment Cast-In-Place Pour Details">
            {[
              ["Topping/Slab Thickness, t1","t1","mm"],["Topping/Slab Width, b1","b1","mm"],
              ["Topping/Slab Lateral Offset (±), z1","z1","mm"],["Haunch Height (±), t2","t2","mm"],
              ["Haunch Width, b2","b2","mm"],["Haunch Lateral Offset (±), z2","z2","mm"],
              ["Vertical Offset (±), y *","y","mm"],["Width of Composite Interface","interfaceWidth","mm"],
              ["Offset of Composite Interface (±)","interfaceOffset","mm"],
            ].map(([label, key, unit]) => (
              <div key={key} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                <span style={{ fontSize:11, flex:1, color:"#374151" }}>{label}</span>
                <input type="number" value={local[key]} step={1}
                  onChange={e=>set(key,Number(e.target.value))}
                  style={{ ...orangeI, width:70 }}/>
                <span style={{ fontSize:10, color:"#868e96", width:24 }}>{unit}</span>
              </div>
            ))}
            <div style={{ fontSize:10, color:"#6c757d", marginTop:4 }}>* from top of precast beam</div>
          </Section>
        </div>

        {/* Right: schematic */}
        <div style={{ flex:1 }}>
          <div style={{ display:"flex", gap:0, marginBottom:8 }}>
            {["Schematic A","Schematic B","Schematic C","Actual"].map(s=>(
              <button key={s} onClick={()=>setSchematic(s.replace("Schematic ","").replace("tual","tual"))}
                style={{ ...btnS, borderRadius:0, background:schematic===s.replace("Schematic ","")?"#e9ecef":"#fff",
                  fontWeight:schematic===s.replace("Schematic ","")?"700":"400", fontSize:10, padding:"4px 10px" }}>
                {s}
              </button>
            ))}
          </div>
          {/* Schematic diagram */}
          <svg viewBox="0 0 400 220" style={{ width:"100%", border:"1px solid #dee2e6", background:"#fafafa" }}>
            {/* Top slab */}
            <rect x={60} y={30} width={300} height={30} fill="#c8d8e8" stroke="#374151" strokeWidth={1.5}/>
            <text x={175} y={50} textAnchor="middle" fontSize={11} fill="#374151">Slab</text>
            {/* Haunch (right) */}
            <rect x={320} y={60} width={40} height={30} fill="#b8d0e4" stroke="#374151" strokeWidth={1}/>
            <text x={340} y={80} textAnchor="middle" fontSize={10} fill="#374151">Haunch</text>
            {/* Precast beam */}
            <rect x={80} y={90} width={200} height={70} fill="#d1d5db" stroke="#374151" strokeWidth={2}/>
            <text x={180} y={130} textAnchor="middle" fontSize={11} fill="#374151">Precast</text>
            {/* Dimension labels */}
            <text x={175} y={22} textAnchor="middle" fontSize={9} fill="#374151" fontFamily={MONO}>b1</text>
            <text x={380} y={48} fontSize={9} fill="#374151" fontFamily={MONO}>t1</text>
            <text x={380} y={80} fontSize={9} fill="#374151" fontFamily={MONO}>t2</text>
            <text x={340} y={115} textAnchor="middle" fontSize={9} fill="#374151" fontFamily={MONO}>b2</text>
          </svg>
        </div>
      </div>

      {/* Segment list */}
      <Section title="Cast-in-Place Pour Segment List">
        <div style={{ display:"flex", gap:6, marginBottom:6 }}>
          <button style={btnS}>Add/Modify</button>
          <button style={btnS}>Clear</button>
        </div>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
          <thead>
            <tr style={{ background:"#f8f9fa" }}>
              {["#","Beam Segment","t1 (mm)","b1 (mm)","z1 (mm)","t2 (mm)","b2 (mm)","z2 (mm)","y (mm)"].map(h=>(
                <th key={h} style={{ padding:"3px 6px", border:"1px solid #dee2e6", fontWeight:600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {[1,"Beam 1",local.t1,local.b1,local.z1,local.t2,local.b2,local.z2,local.y].map((v,i)=>(
                <td key={i} style={{ padding:"3px 6px", border:"1px solid #dee2e6", textAlign:"center" }}>{v}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="Cast-in-Place Pour Options">
        <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
          <CheckField label="Do Not Include Cast-in-Place Pour" checked={local.noCIP} onChange={v=>set("noCIP",v)}/>
          <CheckField label="Cast-in-Place Pour Is Not Composite" checked={local.notComposite} onChange={v=>set("notComposite",v)}/>
          <CheckField label="Check Flexural and Shear Strength during CIP Pour" checked={local.checkDuringCIP} onChange={v=>set("checkDuringCIP",v)}/>
          <CheckField label="Account for Torsion due to Offsets" checked={local.torsionOffset} onChange={v=>set("torsionOffset",v)}/>
          <CheckField label="Top of Precast is Considered Intentionally Roughened" checked={local.topRoughened} onChange={v=>set("topRoughened",v)}/>
        </div>
      </Section>

      <div style={{ display:"flex", gap:8, marginBottom:8 }}>
        <span style={{ fontSize:11, fontWeight:600, color:"#374151", alignSelf:"center" }}>Go To Next …</span>
        <button style={btnS}>Define Loading</button>
        <button style={btnS}>Define Rebar</button>
        <button style={btnS}>Define Prestressing</button>
      </div>
      <FooterRow onOK={()=>{ setData(local); onClose(); }} onCancel={onClose}/>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════════
// 5. REINFORCING STEEL DIALOG
// ═══════════════════════════════════════════════════════════════
export function ReinforcingModal({ data, setData, onClose }) {
  const [local, setLocal] = useState({ ...data });
  const set = (k, v) => setLocal(l => ({ ...l, [k]: v }));
  const OFFSET_REFS = ["Bottom of Precast Beam [BB]","Top of CIP Pour [TC]","Top of Precast Beam [TP]","Center of Precast Beam [CP]"];
  const LAYOUTS = ["Offsets from Each End of Beam [EE]","Full Length [FL]","Offsets from Left End [LE]","Offsets from Right End [RE]"];
  const END_TYPES = ["Straight Embed. [SE]","Standard Hook [SH]","Extended Past Support [EP]","Not Embedded [NE]"];

  return (
    <ModalShell title="Reinforcing Steel" onClose={onClose} width={680}>
      <Section title="Reinforcing Steel Group Details">
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, alignItems:"flex-end" }}>
          <Field label="Number of Bars/Wires" value={local.nBars} onChange={v=>set("nBars",v)} step={1} min={0} width={60}/>
          <CheckField label="Welded Wire Reinforcement?" checked={local.weldedWire} onChange={v=>set("weldedWire",v)}/>
          <CheckField label="Epoxy Coated" checked={local.epoxyCoated} onChange={v=>set("epoxyCoated",v)}/>
        </div>
        <div style={{ marginTop:6 }}>
          <Field label="Spacing of Bars/Wires *" value={local.spacing} onChange={v=>set("spacing",v)} unit="mm" width={80}/>
        </div>
        <div style={{ fontSize:10, color:"#6c757d", marginBottom:6 }}>
          * Center/center of bars. If spacing variable specify minimum spacing. Use side cover for single bars.
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
          <Field label="Vertical Offset **" value={local.verticalOffset} onChange={v=>set("verticalOffset",v)} unit="mm" width={70}/>
          <Field label="" value={local.offsetRef} onChange={v=>set("offsetRef",v)} options={OFFSET_REFS} width={220}/>
        </div>
        <div style={{ fontSize:10, color:"#6c757d", marginBottom:8 }}>
          ** If measured from top of CIP pour then embedded in CIP pour else embedded in precast beam. Offset to center of bar.
        </div>
        <div style={{ display:"flex", gap:12, alignItems:"flex-end", flexWrap:"wrap" }}>
          <Field label="Bar Layout" value={local.barLayout} onChange={v=>set("barLayout",v)} options={LAYOUTS} width={240}/>
          <div style={{ fontSize:11 }}>Beam Length <b>{local.beamLength||7} m</b></div>
        </div>
        <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginTop:6 }}>
          <Field label="Left End of Beam to Left End of Bar" value={0} onChange={()=>{}} unit="m" width={70}/>
          <Field label="Right End of Beam to Right End of Bar" value={0} onChange={()=>{}} unit="m" width={70}/>
        </div>
        <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginTop:6, alignItems:"center" }}>
          <span style={{ fontSize:11 }}>Bar End Type:</span>
          <div>
            <div style={{ fontSize:10, color:"#6c757d", marginBottom:2 }}>Left End</div>
            <Field label="" value={local.leftEndType} onChange={v=>set("leftEndType",v)} options={END_TYPES} width={180}/>
          </div>
          <div>
            <div style={{ fontSize:10, color:"#6c757d", marginBottom:2 }}>Right End</div>
            <Field label="" value={local.rightEndType} onChange={v=>set("rightEndType",v)} options={END_TYPES} width={180}/>
          </div>
        </div>
      </Section>

      <Section title="Reinforcing Bar/Wire Type">
        <div style={{ display:"flex", gap:8, alignItems:"flex-end", flexWrap:"wrap" }}>
          <button style={btnS}>Select from Library</button>
          <Field label="Name" value={local.barName} onChange={v=>set("barName",v)} type="text" width={80}/>
          <Field label="dia." value={local.dia} onChange={v=>set("dia",v)} unit="mm" step={1} width={60}/>
          <Field label="fy" value={local.fy} onChange={v=>set("fy",v)} unit="MPa" step={5} width={70}/>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"flex-end", flexWrap:"wrap", marginTop:6 }}>
          <select style={{ ...orangeI, width:180 }}><option>Deformed Bar</option><option>Plain Bar</option><option>Welded Wire</option></select>
          <Field label="A" value={local.A} onChange={v=>set("A",v)} unit="mm²" step={10} width={70}/>
          <Field label="E" value={local.E} onChange={v=>set("E",v)} unit="MPa" step={1000} width={80}/>
        </div>
        <div style={{ display:"flex", gap:6, marginTop:8 }}>
          <button style={btnS}>Save as the Default Reinforcing</button>
          <button style={btnS}>Restore to the Default Reinforcing</button>
        </div>
      </Section>

      <div style={{ display:"flex", gap:6, marginBottom:8 }}>
        {["Add","Modify","Delete","Move Up","Move Down"].map(a=>(
          <button key={a} style={{ ...btnS, padding:"3px 8px", fontSize:10 }}>{a}</button>
        ))}
      </div>

      {/* Bar list */}
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11, marginBottom:8 }}>
        <thead>
          <tr style={{ background:"#f8f9fa" }}>
            {["Name","Grade (fy)","Num","Spacing","V Offset","from","End Type: Offset (Layout)"].map(h=>(
              <th key={h} style={{ padding:"4px 8px", border:"1px solid #dee2e6", fontWeight:600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(local.groups||[]).length===0 && (
            <tr><td colSpan={7} style={{ padding:"12px", textAlign:"center", color:"#adb5bd", fontSize:11 }}>No reinforcing steel groups defined</td></tr>
          )}
          {(local.groups||[]).map((g,i)=>(
            <tr key={i}>
              <td style={{ padding:"4px 8px", border:"1px solid #dee2e6" }}>{g.name}</td>
              <td style={{ padding:"4px 8px", border:"1px solid #dee2e6" }}>{g.fy}</td>
              <td style={{ padding:"4px 8px", border:"1px solid #dee2e6" }}>{g.nBars}</td>
              <td style={{ padding:"4px 8px", border:"1px solid #dee2e6" }}>{g.spacing}</td>
              <td style={{ padding:"4px 8px", border:"1px solid #dee2e6" }}>{g.verticalOffset}</td>
              <td style={{ padding:"4px 8px", border:"1px solid #dee2e6" }}>{g.offsetRef}</td>
              <td style={{ padding:"4px 8px", border:"1px solid #dee2e6" }}>{g.endType}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display:"flex", gap:8, marginTop:8 }}>
        <span style={{ fontSize:11, fontWeight:600, color:"#374151", alignSelf:"center" }}>Go To Next …</span>
        <button style={btnS}>Define Prestressing</button>
        <button style={btnS}>Shear Strengthening</button>
        <button style={btnS}>View Reports</button>
        <button style={btnS}>View Graphs</button>
      </div>
      <FooterRow onOK={()=>{ setData(local); onClose(); }} onCancel={onClose}/>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════════
// 6. PRESTRESSING DIALOG
// ═══════════════════════════════════════════════════════════════
export function PrestressingModal({ data, setData, onClose }) {
  const [local, setLocal] = useState({ ...data });
  const set = (k, v) => setLocal(l => ({ ...l, [k]: v }));
  const END_TYPES = ["Fully Bonded (B)","Debonded from Left End [DL]","Debonded from Right End [DR]","Debonded Both Ends [DB]","Partial Length [PL]"];
  const STRAND_TYPES = ["Low-Relaxation Strand","Stress-Relieved Strand","Bar"];

  return (
    <ModalShell title="Prestressing" onClose={onClose} width={660}>
      <Section title="Strand Group Details">
        <div style={{ display:"flex", flexWrap:"wrap", gap:12 }}>
          <div>
            <Field label="Number of Strands" value={local.nStrands} onChange={v=>set("nStrands",v)} step={1} min={0} width={70}/>
            <div style={{ marginTop:6 }}>
              <CheckField label="Epoxy Coated" checked={local.epoxyCoated} onChange={v=>set("epoxyCoated",v)}/>
            </div>
            <Field label="Stress Ratio at Lock-off" value={local.lockOffRatio} onChange={v=>set("lockOffRatio",v)} step={0.01} unit="(fpj / fpu)" width={70}/>
            <Field label="Height of Strand (center) at Left End" value={local.heightLeft} onChange={v=>set("heightLeft",v)} unit="mm" step={1} width={70}/>
            <div style={{ display:"flex", gap:6, marginTop:6 }}>
              <button style={btnS}>Edit Profile</button>
              <button style={btnS}>Generate or Edit a Harp Profile</button>
            </div>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:11, fontWeight:600, marginBottom:6 }}>Strand End Type and Offset from End of Beam</div>
            <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6 }}>
              <span style={{ fontSize:11, width:40 }}>Left</span>
              <Field label="" value={local.leftEndType} onChange={v=>set("leftEndType",v)} options={END_TYPES} width={200}/>
              <Field label="" value={local.leftOffset} onChange={v=>set("leftOffset",v)} unit="m" step={0.1} width={60}/>
            </div>
            <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:8 }}>
              <span style={{ fontSize:11, width:40 }}>Right</span>
              <Field label="" value={local.rightEndType} onChange={v=>set("rightEndType",v)} options={END_TYPES} width={200}/>
              <Field label="" value={local.rightOffset} onChange={v=>set("rightOffset",v)} unit="m" step={0.1} width={60}/>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <button style={btnS}>Transfer and Development</button>
              <button style={btnS}>Option 1: Code</button>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Strand Type">
        <div style={{ display:"flex", gap:8, alignItems:"flex-end", flexWrap:"wrap" }}>
          <button style={btnS}>Select from Library</button>
          <Field label="Name" value={local.strandName} onChange={v=>set("strandName",v)} type="text" width={100}/>
          <Field label="dia." value={local.dia} onChange={v=>set("dia",v)} unit="mm" step={0.1} width={60}/>
          <Field label="fpu" value={local.fpu} onChange={v=>set("fpu",v)} unit="MPa" step={10} width={70}/>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"flex-end", flexWrap:"wrap", marginTop:6 }}>
          <Field label="" value={local.strandType} onChange={v=>set("strandType",v)} options={STRAND_TYPES} width={200}/>
          <Field label="A" value={local.A} onChange={v=>set("A",v)} unit="mm²" step={0.5} width={70}/>
          <Field label="E" value={local.E} onChange={v=>set("E",v)} unit="MPa" step={1000} width={80}/>
        </div>
        <div style={{ display:"flex", gap:6, marginTop:8 }}>
          <button style={btnS}>Save as the Default Strand</button>
          <button style={btnS}>Restore to the Default Strand</button>
        </div>
      </Section>

      <div style={{ display:"flex", gap:6, marginBottom:8 }}>
        {["Add","Modify","Delete","Move Up","Move Down"].map(a=>(
          <button key={a} style={{ ...btnS, padding:"3px 8px", fontSize:10 }}>{a}</button>
        ))}
      </div>

      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11, marginBottom:8 }}>
        <thead>
          <tr style={{ background:"#f8f9fa" }}>
            {["Name","Grade (fpu)","Lock-Off","Num","Height of Strand","End Type: Offset (L/R)","Lt & Ld"].map(h=>(
              <th key={h} style={{ padding:"4px 8px", border:"1px solid #dee2e6", fontWeight:600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(local.groups||[]).length===0 && (
            <tr><td colSpan={7} style={{ padding:"12px", textAlign:"center", color:"#adb5bd", fontSize:11 }}>No strand groups defined</td></tr>
          )}
        </tbody>
      </table>

      <div style={{ display:"flex", gap:8, marginTop:8 }}>
        <span style={{ fontSize:11, fontWeight:600, color:"#374151", alignSelf:"center" }}>Go To Next …</span>
        <button style={btnS}>Define Rebar</button>
        <button style={btnS}>Shear Strengthening</button>
        <button style={btnS}>Design Parameters</button>
        <button style={btnS}>View Reports</button>
        <button style={btnS}>View Graphs</button>
      </div>
      <FooterRow onOK={()=>{ setData(local); onClose(); }} onCancel={onClose}/>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════════
// 7. SHEAR STRENGTHENING
// ═══════════════════════════════════════════════════════════════
export function ShearStrengtheningModal({ data, setData, onClose }) {
  const [local, setLocal] = useState({ ...data });
  const set = (k, v) => setLocal(l => ({ ...l, [k]: v }));

  const StirrupPanel = ({ prefix, title }) => (
    <div style={{ flex:1 }}>
      <div style={{ fontSize:12, fontWeight:700, marginBottom:8, color:"#374151" }}>{title}</div>
      <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:4 }}>
        <span style={{ fontSize:11 }}>From</span>
        <input type="number" value={local[`${prefix}From`]} step={0.5}
          onChange={e=>set(`${prefix}From`,Number(e.target.value))}
          style={{ ...orangeI, width:55 }}/>
        <span style={{ fontSize:11 }}>to</span>
        <input type="number" value={local[`${prefix}To`]} step={0.5}
          onChange={e=>set(`${prefix}To`,Number(e.target.value))}
          style={{ ...orangeI, width:55 }}/>
        <span style={{ fontSize:11 }}>m</span>
        <CheckField label="Symmetrical about Center of Beam" checked={local[`${prefix}Symmetric`]} onChange={v=>set(`${prefix}Symmetric`,v)}/>
      </div>
      <CheckField label={`Not Reinforced For ${prefix==="stirrup"?"Shear":"Interface Shear"}`}
        checked={local[`${prefix==="stirrup"?"notReinforcedShear":"notReinforcedInterface"}`]}
        onChange={v=>set(prefix==="stirrup"?"notReinforcedShear":"notReinforcedInterface",v)}/>
      <div style={{ fontSize:11, fontWeight:600, margin:"6px 0 4px" }}>Steel Material Properties (required)</div>
      <Field label="fy" value={local[`${prefix}Fy`]} onChange={v=>set(`${prefix}Fy`,v)} unit="MPa" step={5} width={70}/>
      <Field label="E" value={local[`${prefix}E`]} onChange={v=>set(`${prefix}E`,v)} unit="MPa" step={1000} width={80}/>
      <div style={{ fontSize:11, fontWeight:600, margin:"6px 0 4px" }}>
        {prefix==="stirrup"?"Stirrup Size (optional)":"Tie Size (optional)"}
      </div>
      <Field label="dia." value={local[`${prefix}Dia`]} onChange={v=>set(`${prefix}Dia`,v)} unit="mm" step={1} width={60}/>
      <Field label="Area" value={local[`${prefix}Area`]} onChange={v=>set(`${prefix}Area`,v)} unit="mm²" step={10} width={70}/>
      <Field label={`Number of ${prefix==="stirrup"?"Stirrup":"Tie"} Legs`} value={local[`${prefix}Legs`]}
        onChange={v=>set(`${prefix}Legs`,v)} step={1} min={0} width={50}/>
      <Field label={`${prefix==="stirrup"?"Stirrup":"Tie"} Spacing (optional)`} value={local[`${prefix}Spacing`]}
        onChange={v=>set(`${prefix}Spacing`,v)} unit="mm" step={25} width={70}/>
      <div style={{ display:"flex", gap:6, marginTop:6 }}>
        <button style={btnS}>Add/Modify</button>
        <button style={btnS}>Delete</button>
      </div>
    </div>
  );

  return (
    <ModalShell title="Shear Strengthening" onClose={onClose} width={800}>
      <div style={{ display:"flex", gap:20 }}>
        <StirrupPanel prefix="stirrup" title="Vertical Shear Stirrup Specification"/>
        <div style={{ width:1, background:"#dee2e6" }}/>
        <StirrupPanel prefix="tie" title="Interface Shear Tie Specification"/>
      </div>

      <Section title="Shear Calculation Options">
        <div style={{ display:"flex", gap:24, flexWrap:"wrap" }}>
          <div>
            <CheckField label="Allow Calculator to Calculate Required Shear Strengthening" checked={local.calcRequiredShear} onChange={v=>set("calcRequiredShear",v)}/>
            <CheckField label="Include Bursting Steel Requirement (Calculation Option S8)" checked={local.burstingSteel} onChange={v=>set("burstingSteel",v)}/>
            <CheckField label="Fill Cores for Shear Strengthening (Hollowcore Beams Only)" checked={local.fillCores} onChange={v=>set("fillCores",v)}/>
            <button style={{ ...btnS, marginTop:8 }}>Define Hollowcore Filled Core Parameters</button>
          </div>
          <div>
            <CheckField label="Allow Calculator to Calculate Required Interface Strengthening" checked={local.calcRequiredInterface} onChange={v=>set("calcRequiredInterface",v)}/>
            <CheckField label="Beam Is Part of a Slab" checked={local.partOfSlab} onChange={v=>set("partOfSlab",v)}/>
            <CheckField label="Beam Is Supported from the Bottom" checked={local.supportedFromBottom} onChange={v=>set("supportedFromBottom",v)}/>
            <CheckField label="Use Non-Composite Section Only for Vertical Shear (Calculation Option S9)" checked={local.nonCompForVertical} onChange={v=>set("nonCompForVertical",v)}/>
          </div>
        </div>
      </Section>

      <div style={{ display:"flex", gap:8, marginTop:8 }}>
        <span style={{ fontSize:11, fontWeight:600, color:"#374151", alignSelf:"center" }}>Go To Next …</span>
        <button style={btnS}>Define Rebar</button>
        <button style={btnS}>Define Prestressing</button>
        <button style={btnS}>View Reports</button>
        <button style={btnS}>View Graphs</button>
      </div>
      <FooterRow onOK={()=>{ setData(local); onClose(); }} onCancel={onClose}/>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════════
// 8. DESIGN PARAMETERS
// ═══════════════════════════════════════════════════════════════
export function DesignParamsModal({ data, setData, onClose }) {
  const [local, setLocal] = useState({ ...data });
  const set = (k, v) => setLocal(l => ({ ...l, [k]: v }));
  const LOSS_METHODS = [
    "ACI 209 Detailed Method (CPCI)","PCI Simplified Method (Zia)","AS3600 Method","S6 Simplified Method"
  ];
  const HYDRATION = ["Normal","Rapid","Slow"];
  const EXPOSURES = ["Interior","Exterior","Aggressive","Marine"];

  return (
    <ModalShell title="Design Parameters" onClose={onClose} width={750}>
      <div style={{ display:"flex", gap:20, flexWrap:"wrap" }}>
        {/* Left: Loss method + curing */}
        <div style={{ minWidth:220 }}>
          <Section title="Prestress Loss Calculation Method">
            {LOSS_METHODS.map(m=>(
              <RadioField key={m} label={m} checked={local.lossMethod===m} onChange={()=>set("lossMethod",m)}/>
            ))}
          </Section>
          <Section title="Predefined Losses">
            <CheckField label="Use Predefined Losses" checked={local.usePredefinedLosses} onChange={v=>set("usePredefinedLosses",v)}/>
            {local.usePredefinedLosses && (<>
              <Field label="Initial Losses" value={local.initialLoss} onChange={v=>set("initialLoss",v)} unit="%" step={0.5} width={60}/>
              <Field label="Total Losses" value={local.totalLoss} onChange={v=>set("totalLoss",v)} unit="%" step={0.5} width={60}/>
            </>)}
            <CheckField label="Vary Losses Along Beam (Calculation Option P1)" checked={local.varyLossesAlongBeam} onChange={v=>set("varyLossesAlongBeam",v)}/>
          </Section>
          <Section title="Precast Curing Method">
            <RadioField label="Moist Cured" checked={local.curingMethod==="Moist Cured"} onChange={()=>set("curingMethod","Moist Cured")}/>
            <RadioField label="Heat Cured (i.e. Steam)" checked={local.curingMethod==="Heat Cured (i.e. Steam)"} onChange={()=>set("curingMethod","Heat Cured (i.e. Steam)")}/>
          </Section>
        </div>

        {/* Middle: Precast concrete parameters */}
        <div style={{ minWidth:200 }}>
          <Section title="Precast Concrete Parameters">
            <Field label="Slump" value={local.slump} onChange={v=>set("slump",v)} unit="mm" step={5} width={70}/>
            <Field label="Cement" value={local.cement} onChange={v=>set("cement",v)} unit="kg/m³" step={10} width={70}/>
            <Field label="Air" value={local.air} onChange={v=>set("air",v)} unit="%" step={0.5} width={60}/>
            <Field label="Fine/Total Aggregate" value={local.fineAggregate} onChange={v=>set("fineAggregate",v)} step={0.05} width={60}/>
            <Field label="Aggregate Size" value={local.aggregateSize} onChange={v=>set("aggregateSize",v)} unit="mm" step={5} width={60}/>
            <Field label="Hydration Rate" value={local.hydrationRate} onChange={v=>set("hydrationRate",v)} options={HYDRATION} width={110}/>
            <Field label="Basic Shrinkage Strain" value={local.shrinkageStrain} onChange={v=>set("shrinkageStrain",v)} unit="×10⁻⁶" step={10} width={70}/>
          </Section>
        </div>

        {/* Right: Schedule + Environment */}
        <div style={{ minWidth:210 }}>
          <Section title="Construction Schedule">
            <p style={{ fontSize:10, color:"#6c757d", marginBottom:6 }}>Precast Concrete is Placed at day 0.</p>
            {[
              ["Transfer/Stripping","transferDay","days"],
              ["Initial Lift","initialLiftDay","days"],
              ["Transport/Erection Lift","erectionDay","days"],
              ["Cast-in-Place Pour","cipDay","days"],
              ["Composite Action","compositeDay","days"],
              ["Completion","completionDay","days"],
            ].map(([label, key, unit])=>(
              <div key={key} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                <span style={{ fontSize:11, flex:1 }}>{label}</span>
                <input type="number" value={local[key]} step={0.25}
                  onChange={e=>set(key,Number(e.target.value))}
                  style={{ ...orangeI, width:60 }}/>
                <span style={{ fontSize:10, color:"#868e96", marginLeft:4, width:30 }}>{unit}</span>
              </div>
            ))}
          </Section>

          <Section title="Service Environment">
            <Field label="Relative Humidity" value={local.RH} onChange={v=>set("RH",v)} unit="%" step={5} width={60}/>
            <Field label="Ambient Temp." value={local.ambientTemp} onChange={v=>set("ambientTemp",v)} unit="°C" step={1} width={60}/>
            <Field label="Exposure" value={local.exposure} onChange={v=>set("exposure",v)} options={EXPOSURES} width={120}/>
          </Section>
        </div>
      </div>

      <FooterRow
        onOK={()=>{ setData(local); onClose(); }}
        onCancel={onClose}
        extraLeft={[
          <button key="save" style={btnS}>Save the Settings as Default</button>,
          <button key="rest" style={btnS} onClick={()=>setLocal({...DEFAULT_DESIGN_PARAMS})}>Restore the Default Settings</button>,
          <button key="fact" style={btnS}>Restore to the Factory Settings</button>,
        ]}
      />
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════════
// DEFINE MENU CONTROLLER — manages all 8 dialogs
// Wire into OptionsMenuBar's Define dropdown
// ═══════════════════════════════════════════════════════════════
export function DefineDialogsController({ openModal, setOpenModal, defineState }) {
  const { concrete, setConcrete, beam, setBeam, cip, setCIP,
          rebar, setRebar, prestress, setPrestress,
          shear, setShear, designParams, setDesignParams } = defineState;

  const close = () => setOpenModal(null);

  return (<>
    {openModal==="concrete"    && <ConcreteMaterialModal  data={concrete}     setData={setConcrete}     onClose={close}/>}
    {openModal==="beam"        && <BeamDefinitionModal    data={beam}          setData={setBeam}          onClose={close}/>}
    {openModal==="cip"         && <CIPPourModal           data={cip}           setData={setCIP}           onClose={close}/>}
    {openModal==="rebar"       && <ReinforcingModal       data={rebar}         setData={setRebar}         onClose={close}/>}
    {openModal==="prestress"   && <PrestressingModal      data={prestress}     setData={setPrestress}     onClose={close}/>}
    {openModal==="shear"       && <ShearStrengtheningModal data={shear}        setData={setShear}         onClose={close}/>}
    {openModal==="designParams"&& <DesignParamsModal      data={designParams}  setData={setDesignParams}  onClose={close}/>}
  </>);
}
