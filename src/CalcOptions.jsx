// ═══════════════════════════════════════════════════════════════
// CALCULATION OPTIONS — matching ConCise Beam's Options dialogs
//
// Three dialogs mirroring ConCise exactly:
//   1. Calculation Options (6 tabs: General/Prestress/Flexure/Shear/Deflection/Stress)
//   2. Deflection Multipliers (PCI table, user-editable, composite/non-composite)
//   3. Load Combinations (SLS + ULS combos with named load factors)
//
// Exported as a React context so any tab can read the flags.
// ═══════════════════════════════════════════════════════════════
import { useState, createContext, useContext } from "react";

const MONO = "'JetBrains Mono','Fira Code','Consolas',monospace";

// ── Default calculation flags (matching ConCise defaults) ──────
export const DEFAULT_CALC_FLAGS = {
  // General
  G1: true,   // Use transformed steel area in uncracked section properties
  G2: true,   // Use PCI Standard Design Practice TR-7-05 (ACI codes only)
  G3: false,  // Strict ULS Design Check Conformance
  G4: false,  // Use Full Section As Effective in Flexure
  G5: false,  // Allow flexural load distribution < beam width
  // Prestress
  P1: true,   // Vary user defined losses along beam
  P2: false,  // Always extend Lt/Ld for debonded strand
  P3: false,  // Use CPCI (Collins-Mitchell) stress-strain curves
  // Flexure
  F1: false,  // Check minimum strength at critical sections only
  F2: false,  // Vary phi linearly in development length (ACI 318-02)
  F3: false,  // Use ACI 318-99 Appendix B
  F7: true,   // Reduce phi in development length of strands (CSA)
  F8: false,  // Use rectangular stress block at concrete ultimate strain
  F9: true,   // Include shear in check for minimum flexural strength
  F10: false, // Use Cracking Moment for Minimum Flexural Strength
  // Shear
  S1: false,  // Use simplified shear method if applicable
  S2: false,  // Take best of detailed and simplified method
  S3: false,  // Calculate crack spacing at mid-height (A23.3/S6 only)
  S4: false,  // Limit crack spacing to min of 300mm or dv
  S5: false,  // Use Zia/Hsu Method for torsion design
  S6: false,  // Show shear and torsion values within short cantilevers
  S7: false,  // Check principal stress for Vcw
  S8: false,  // Calculate pre-tensioned bursting steel requirements
  S9: false,  // Use non-composite section depth for vertical shear
  S10: true,  // Check interface shear for ultimate composite flexural capacity
  S11: false, // Minimum Shear Steel Requirement Waived by User
  S12: false, // Use Full Strength of Filled HC Cores Without Minimum Stirrups
  S13: false, // Allow Reduction in Minimum Al Due to Excess Torsional Stirrups
  // Deflection
  D1: false,  // Use cracked properties near midspan for full length of beam
  D2: false,  // Summary report at midspan / tip of cantilevers
  D3: false,  // Have CB calculate long-term deflection multipliers
  D4: false,  // Maintain prestress camber when shoring beam weight
  D5: false,  // Include wind with live loads in ACI span/deflection check
  // Stress
  C1: false,  // Use prestressed concrete stress limits for non-prestressed beams
  C2: 2,      // End Zone length as multiple of transfer length (numeric, not bool)
};

// ── Default deflection multipliers (PCI Table 4.8.4) ─────────
export const DEFAULT_DEFL_MULTIPLIERS = {
  // rows: SW, Prestress, SDL_before_CIP, CIP_pour, SDL_after_CIP, Sustained_LL
  // cols: erection, completion_noncomp, completion_comp, final_noncomp, final_comp
  SW:           { erection: 1.85, comp_nc: 2.30, comp_c: 2.15, final_nc: 2.70, final_c: 2.40 },
  Prestress:    { erection: 1.80, comp_nc: 2.25, comp_c: 2.10, final_nc: 2.45, final_c: 2.20 },
  SDL_before:   { erection: null, comp_nc: 1.50, comp_c: 1.35, final_nc: 3.00, final_c: 2.30 },
  CIP_pour:     { erection: null, comp_nc: 1.50, comp_c: 1.35, final_nc: 3.00, final_c: 2.30 },
  SDL_after:    { erection: null, comp_nc: null,  comp_c: 1.00, final_nc: null,  final_c: 3.00 },
  Sustained_LL: { erection: null, comp_nc: null,  comp_c: null,  final_nc: 3.00, final_c: 3.00 },
};

// ── Default load combinations (CSA A23.3-14 NBCC 2015) ────────
export const DEFAULT_LOAD_FACTORS = { P:0, D:1.4, D1:1.4, T:1.25, L:0, L1:0, L2:0, C:0, S:0, W:0, E:0 };
export const DEFAULT_ULS_COMBOS = [
  "1.40D + 1.40D1 + 1.25T",
  "1.25D + 1.50D1 + 1.25T + 1.50L + 1.50L1 + 1.25L2 + 1.00C + 1.00S",
  "1.25D + 1.50D1 + 1.25T + 1.50L + 1.50L1 + 1.00L2 + 1.00C + 1.00S",
  "1.25D + 1.50D1 + 1.25T + 1.00L + 1.00L1 + 1.00L2 + 1.50C + 1.00S",
  "1.25D + 1.50D1 + 1.25T + 1.00L + 1.00L1 + 1.00L2 + 1.50C + 0.40W",
  "1.25D + 1.50D1 + 1.25T + 1.50L + 1.50L1 + 0.50L2 + 1.00C + 1.50S",
  "1.25D + 1.50D1 + 1.25T + 1.50S + 0.40W",
  "1.25D + 1.50D1 + 1.25T + 0.50L + 1.00L1 + 0.50L2 + 1.00C + 1.40W",
  "1.25D + 1.50D1 + 1.25T + 0.50S + 1.40W",
  "1.00D + 1.00D1 + 0.50L + 1.00L1 + 0.50L2 + 1.00C + 0.25S + 1.00E",
  "0.90D + 0.90D1 + 1.50L + 1.50L1 + 1.25L2 + 0.50S",
  "0.90D + 0.90D1 + 1.40W",
];
export const DEFAULT_SLS_COMBOS = [
  "SLS Stress :  1.00P + 1.00D + 1.00D1 + 1.00T + 1.00L + 1.00L1 + 1.00L2 + 1.00C + 1.00S + 1.00W",
  "SLS Deflect : 1.00P + 1.00D + 1.00D1 + 1.00T + 1.00L + 1.00L1 + 1.00L2 + 1.00C + 1.00S",
  "FLS Fatigue : 1.00P + 1.00D + 1.00D1 + 1.00L + 1.00C",
];

// ── Global context ─────────────────────────────────────────────
export const CalcOptionsContext = createContext({
  flags: DEFAULT_CALC_FLAGS,
  deflMult: DEFAULT_DEFL_MULTIPLIERS,
  ulsCombos: DEFAULT_ULS_COMBOS,
  slsCombos: DEFAULT_SLS_COMBOS,
  loadFactors: DEFAULT_LOAD_FACTORS,
  designCode: "ACI 318-19",
  units: "imperial",
});
export const useCalcOptions = () => useContext(CalcOptionsContext);

// ── Design codes list ─────────────────────────────────────────
const DESIGN_CODES = [
  "CSA A23.3-94","CSA A23.3-04","CSA A23.3-14","CSA A23.3-19",
  "CSA S6-06-2010","CSA S6-14-2017","CSA S6-19",
  "ACI 318-99","ACI 318-02","ACI 318-05","ACI 318-08",
  "ACI 318-11","ACI 318-14","ACI 318-19",
  "AS 3600-2001","AS 3600-2009","AS 3600-2018 Amdt 2",
  "NZS 3101:2006","Custom Code",
];

// ═══════════════════════════════════════════════════════════════
// CALCULATION OPTIONS MODAL
// ═══════════════════════════════════════════════════════════════
function CalcOptionsModal({ flags, setFlags, onClose }) {
  const [tab, setTab] = useState("General");
  const [localFlags, setLocalFlags] = useState({ ...flags });
  const tabs = ["General","Prestress","Flexure","Shear","Deflection","Stress"];

  const toggle = (key) => setLocalFlags(f => ({ ...f, [key]: !f[key] }));
  const setNum  = (key, v) => setLocalFlags(f => ({ ...f, [key]: Number(v) }));

  const CheckRow = ({ id, label, desc }) => (
    <div style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"10px 0", borderBottom:"1px solid #f1f3f5" }}>
      <input type="checkbox" id={id} checked={!!localFlags[id]} onChange={()=>toggle(id)}
        style={{ marginTop:2, width:15, height:15, flexShrink:0, cursor:"pointer" }}/>
      <label htmlFor={id} style={{ flex:1, fontSize:12, cursor:"pointer", lineHeight:1.4 }}>
        <b style={{ color:"#2563eb" }}>{id}:</b> {label}
      </label>
      <div style={{ padding:"3px 10px", border:"1px solid #ced4da", borderRadius:3, fontSize:11,
        background:"#f8f9fa", color:"#495057", cursor:"pointer", whiteSpace:"nowrap", flexShrink:0 }}
        title={desc || label}>Explanation</div>
    </div>
  );

  const NumRow = ({ id, label }) => (
    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 0", borderBottom:"1px solid #f1f3f5" }}>
      <span style={{ flex:1, fontSize:12 }}><b style={{ color:"#2563eb" }}>{id}:</b> {label} =</span>
      <input type="number" value={localFlags[id]} min={1} max={10} step={0.5}
        onChange={e=>setNum(id, e.target.value)}
        style={{ width:60, padding:"3px 6px", border:"1px solid #ced4da", borderRadius:3, fontSize:12 }}/>
      <div style={{ padding:"3px 10px", border:"1px solid #ced4da", borderRadius:3, fontSize:11, background:"#f8f9fa", color:"#495057" }}>Explanation</div>
    </div>
  );

  return (
    <ModalShell title="Calculation Options" onClose={onClose} width={620}>
      {/* Tab bar */}
      <div style={{ display:"flex", borderBottom:"1px solid #dee2e6", marginBottom:12 }}>
        {tabs.map(t => (
          <button key={t} onClick={()=>setTab(t)} style={{
            padding:"6px 14px", border:"none", background:"none", cursor:"pointer", fontSize:12,
            fontWeight: tab===t ? 700 : 400, color: tab===t ? "#212529" : "#868e96",
            borderBottom: tab===t ? "2px solid #2563eb" : "2px solid transparent", marginBottom:-1,
          }}>{t}</button>
        ))}
      </div>

      <div style={{ minHeight:300, padding:"0 4px" }}>
        {tab==="General" && (<>
          <CheckRow id="G1" label="Use transformed steel area in uncracked section properties"/>
          <CheckRow id="G2" label="Use PCI Standard Design Practice, TR-7-05 (ACI codes only)"/>
          <CheckRow id="G3" label="Strict ULS Design Check Conformance"/>
          <CheckRow id="G4" label="Use Full Section As Effective in Flexure"/>
          <CheckRow id="G5" label="Allow a flexural load distribution to be less than the beam width (amplified flexural effect)"/>
        </>)}
        {tab==="Prestress" && (<>
          <CheckRow id="P1" label="Vary user defined losses along beam"/>
          <CheckRow id="P2" label="Always extend Lt/Ld for debonded strand"/>
          <CheckRow id="P3" label="Use the CPCI (Collins-Mitchell) stress-strain curves for prestressing steel"/>
        </>)}
        {tab==="Flexure" && (<>
          <CheckRow id="F1" label="Check minimum strength at critical sections only"/>
          <CheckRow id="F2" label="Vary the strength reduction factor, Φ, linearly in the development length under ACI 318-02"/>
          <CheckRow id="F3" label="Use ACI 318-99 Appendix B"/>
          <div style={{ height:8 }}/>
          <CheckRow id="F7" label="Reduce phi in the development length of strands (CSA A23.3 only)"/>
          <CheckRow id="F8" label="Use a rectangular stress block at concrete ultimate strain"/>
          <CheckRow id="F9" label="Include shear in check for minimum flexural strength (ACI code for prestressed beams and slabs only)"/>
          <CheckRow id="F10" label="Use the Cracking Moment for Minimum Flexural Strength (ACI and NZ codes for non-prestressed beams and slabs only)"/>
        </>)}
        {tab==="Shear" && (<>
          <CheckRow id="S1" label="Use the simplified shear method if applicable"/>
          <CheckRow id="S2" label="Take the best of the detailed and simplified method"/>
          <CheckRow id="S3" label="Calculate crack spacing at the mid-height of the section (A23.3 and S6 only)"/>
          <CheckRow id="S4" label="Limit crack spacing to minimum of 300 mm or dv (A23.3 and S6 only)"/>
          <CheckRow id="S5" label="Use the Zia/Hsu Method for torsion design as recommended in the PCI Standard Practice guidelines (ACI Codes Only)"/>
          <CheckRow id="S6" label="Show the shear and torsion values within short cantilevers"/>
          <CheckRow id="S7" label="Check principal stress for Vcw (ACI and NZ codes only)"/>
          <CheckRow id="S8" label="Calculate pre-tensioned bursting steel requirements"/>
          <CheckRow id="S9" label="Use the non-composite section depth for vertical shear strength check"/>
          <CheckRow id="S10" label="Check interface shear for the ultimate composite flexural capacity (moment region check)"/>
          <CheckRow id="S11" label="Minimum Shear Steel Requirement Waived by User (if allowed by code based on testing)"/>
          <CheckRow id="S12" label="Use the Full Strength of Filled HC Cores Without Minimum Stirrups"/>
          <CheckRow id="S13" label="Allow Reduction in Minimum Al Due to Excess Torsional Stirrups, At/s (ACI codes only)"/>
        </>)}
        {tab==="Deflection" && (<>
          <CheckRow id="D1" label="Use cracked properties near midspan for full length of beam"/>
          <CheckRow id="D2" label="Summary report at midspan / tip of cantilevers"/>
          <CheckRow id="D3" label="Have the calculator calculate the long-term deflection multipliers for prestressed beams"/>
          <CheckRow id="D4" label="Maintain prestress camber when shoring beam weight"/>
          <CheckRow id="D5" label="Include wind with live loads in ACI span/deflection check"/>
        </>)}
        {tab==="Stress" && (<>
          <CheckRow id="C1" label="Use prestressed concrete stress limits for non-prestressed concrete beams"/>
          <NumRow  id="C2" label="End Zone length as multiple of transfer length"/>
        </>)}
      </div>

      {/* Footer buttons */}
      <div style={{ display:"flex", gap:8, justifyContent:"center", paddingTop:16, borderTop:"1px solid #dee2e6", marginTop:12 }}>
        <button onClick={()=>setLocalFlags({...DEFAULT_CALC_FLAGS})} style={btnS}>Restore the Default Options</button>
        <button onClick={()=>{ setFlags(localFlags); onClose(); }} style={{...btnS, background:"#2563eb", color:"#fff", border:"none"}}>OK</button>
        <button onClick={onClose} style={btnS}>Cancel</button>
      </div>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════════
// DEFLECTION MULTIPLIERS MODAL
// ═══════════════════════════════════════════════════════════════
function DeflMultipliersModal({ mult, setMult, onClose }) {
  const [local, setLocal] = useState(JSON.parse(JSON.stringify(mult)));
  const rows = [
    { key:"SW",           label:"Beam Self-Weight" },
    { key:"Prestress",    label:"Prestressing" },
    { key:"SDL_before",   label:"SDL Before CIP Pour" },
    { key:"CIP_pour",     label:"Cast-In-Place Pour" },
    { key:"SDL_after",    label:"SDL After CIP Pour" },
    { key:"Sustained_LL", label:"Sustained Live Load and Future Dead Load" },
  ];
  const cols = [
    { key:"erection",  label:"At Erection" },
    { key:"comp_nc",   label:"Non-Composite", group:"Completion of Construction" },
    { key:"comp_c",    label:"Composite",     group:"Completion of Construction" },
    { key:"final_nc",  label:"Non-Composite", group:"Final Service" },
    { key:"final_c",   label:"Composite",     group:"Final Service" },
  ];
  const setVal = (row, col, v) => setLocal(l => ({ ...l, [row]: { ...l[row], [col]: v==="" ? null : Number(v) } }));
  const cellS = { padding:"4px 6px", border:"1px solid #dee2e6", textAlign:"center", fontSize:11 };
  const inpS  = { width:52, padding:"2px 4px", border:"1px solid #ced4da", borderRadius:2, fontSize:11, textAlign:"center" };

  return (
    <ModalShell title="Deflection Multipliers for Prestressed Beams" onClose={onClose} width={720}>
      <p style={{ fontSize:11, color:"#2563eb", lineHeight:1.5, marginBottom:12 }}>
        These long-term prestressed deflection multipliers are based on the PCI recommended multipliers.
        They will be further modified by accounting for the amount of non-prestressed steel and multiplied
        by the instantaneous deflection of each load group.
      </p>
      <p style={{ fontSize:11, fontWeight:700, marginBottom:8 }}>Predefined Multipliers</p>
      <p style={{ fontSize:10, color:"#6c757d", marginBottom:12 }}>
        The default values for the following multipliers at erection and final are the values published by
        PCI in their Design Handbook. These values may be overwritten by the user.
      </p>

      <div style={{ overflowX:"auto" }}>
        <table style={{ borderCollapse:"collapse", width:"100%", fontSize:11 }}>
          <thead>
            <tr>
              <th rowSpan={2} style={{ ...cellS, background:"#f8f9fa", textAlign:"left", minWidth:160, padding:"6px 10px" }}></th>
              <th rowSpan={2} style={{ ...cellS, background:"#f8f9fa" }}>At Erection</th>
              <th colSpan={2} style={{ ...cellS, background:"#f0f9ff", color:"#0369a1" }}>Completion of Construction</th>
              <th colSpan={2} style={{ ...cellS, background:"#f0fdf4", color:"#15803d" }}>Final Service</th>
            </tr>
            <tr>
              <th style={{ ...cellS, background:"#f0f9ff" }}>Non-Composite</th>
              <th style={{ ...cellS, background:"#f0f9ff" }}>Composite</th>
              <th style={{ ...cellS, background:"#f0fdf4" }}>Non-Composite</th>
              <th style={{ ...cellS, background:"#f0fdf4" }}>Composite</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.key}>
                <td style={{ ...cellS, textAlign:"left", padding:"6px 10px", fontWeight:500 }}>{row.label}</td>
                {cols.map(col => (
                  <td key={col.key} style={cellS}>
                    {local[row.key][col.key] === null
                      ? <span style={{ color:"#adb5bd" }}>—</span>
                      : <input type="number" value={local[row.key][col.key]} step={0.05}
                          onChange={e => setVal(row.key, col.key, e.target.value)}
                          style={inpS}/>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display:"flex", gap:8, justifyContent:"center", paddingTop:16, borderTop:"1px solid #dee2e6", marginTop:16 }}>
        <button onClick={()=>setLocal(JSON.parse(JSON.stringify(DEFAULT_DEFL_MULTIPLIERS)))} style={btnS}>Restore to the PCI Defaults</button>
        <button onClick={()=>{ setMult(local); onClose(); }} style={{...btnS, background:"#2563eb", color:"#fff", border:"none"}}>OK</button>
        <button onClick={onClose} style={btnS}>Cancel</button>
      </div>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════════
// LOAD COMBINATIONS MODAL
// ═══════════════════════════════════════════════════════════════
function LoadCombosModal({ loadFactors, setLoadFactors, ulsCombos, setUlsCombos, slsCombos, onClose }) {
  const [localFactors, setLocalFactors] = useState({ ...loadFactors });
  const [localULS, setLocalULS] = useState([...ulsCombos]);
  const [selectedULS, setSelectedULS] = useState(0);
  const [editingULS, setEditingULS] = useState(null); // null or index
  const [editText, setEditText] = useState("");
  const [activeName, setActiveName] = useState("ULS Combo 1");

  const LOAD_TYPES = [
    { key:"P",  label:"Primary Prestress (inverted for minimum effect)" },
    { key:"D",  label:"Dead Load" },
    { key:"D1", label:"Dead Load - Earth and Vegetation Weight" },
    { key:"T",  label:"Temperature, Creep, Shrinkage" },
    { key:"L",  label:"Live Load" },
    { key:"L1", label:"Live Load - Storage, Equipment and Service" },
    { key:"L2", label:"Live Load - Liquid in Tanks" },
    { key:"C",  label:"Live Load - Crane Load including Self-Weight" },
    { key:"S",  label:"Snow, Ice, Rain" },
    { key:"W",  label:"Wind" },
    { key:"E",  label:"Earthquake" },
  ];

  const inpS = { width:60, padding:"3px 6px", border:"1px solid #ced4da", borderRadius:3, fontSize:12, textAlign:"center" };
  const labelColor = { P:"#7c3aed", D:"#374151", D1:"#374151", T:"#0891b2", L:"#16a34a", L1:"#16a34a", L2:"#16a34a", C:"#dc2626", S:"#0891b2", W:"#9333ea", E:"#ef4444" };

  return (
    <ModalShell title="Load Combinations in Problem File" onClose={onClose} width={900}>
      <div style={{ display:"flex", gap:16 }}>
        {/* Left: Load factors */}
        <div style={{ width:260, flexShrink:0 }}>
          <div style={{ fontSize:12, fontWeight:700, marginBottom:8, color:"#374151" }}>Load Factors for Selected Load Combination</div>
          <div style={{ marginBottom:8 }}>
            <div style={{ fontSize:10, color:"#6c757d", marginBottom:3 }}>Name</div>
            <input value={activeName} onChange={e=>setActiveName(e.target.value)}
              style={{ width:"100%", boxSizing:"border-box", padding:"4px 6px", border:"1.5px solid #e8a838", borderRadius:3, fontSize:12, background:"#fff8ef" }}/>
          </div>
          {LOAD_TYPES.map(lt => (
            <div key={lt.key} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
              <input type="number" value={localFactors[lt.key] ?? 0} step={0.05} min={0}
                onChange={e=>setLocalFactors(f=>({...f, [lt.key]:Number(e.target.value)}))}
                style={inpS}/>
              <span style={{ fontSize:11, color:labelColor[lt.key]||"#374151", fontWeight:700, minWidth:18 }}>{lt.key}</span>
              <span style={{ fontSize:11, color:"#495057" }}>{lt.label}</span>
            </div>
          ))}
          <button onClick={()=>setLocalFactors({...DEFAULT_LOAD_FACTORS})}
            style={{ ...btnS, marginTop:10, width:"100%", fontSize:10 }}>Reset to Selected Design Code</button>
        </div>

        {/* Right: SLS + ULS combos */}
        <div style={{ flex:1 }}>
          {/* SLS panel */}
          <div style={{ border:"1px solid #dee2e6", borderRadius:4, marginBottom:12, padding:10 }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#2563eb", marginBottom:6 }}>
              Serviceability (SLS) and Fatigue (FLS) Limit State Load Combinations (used individually)
            </div>
            {slsCombos.map((c,i) => (
              <div key={i} style={{ fontSize:10, fontFamily: MONO, color:"#374151", padding:"2px 0" }}>{c}</div>
            ))}
          </div>

          {/* ULS panel */}
          <div style={{ border:"1px solid #dee2e6", borderRadius:4, padding:10 }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#374151", marginBottom:8 }}>
              Ultimate Limit State (ULS) Load Combinations (searched collectively for envelope)
            </div>
            <div style={{ maxHeight:280, overflowY:"auto", marginBottom:8 }}>
              {localULS.map((combo, i) => (
                <div key={i} onClick={()=>setSelectedULS(i)} style={{
                  display:"flex", alignItems:"center", gap:6, padding:"3px 6px", cursor:"pointer",
                  background: selectedULS===i ? "#eff6ff" : "transparent",
                  borderRadius:3, marginBottom:2,
                }}>
                  <input type="checkbox" defaultChecked readOnly style={{ width:13, height:13 }}/>
                  <span style={{ fontSize:10, fontFamily:MONO, color:"#374151" }}>
                    {editingULS===i
                      ? <input value={editText} onChange={e=>setEditText(e.target.value)}
                          onBlur={()=>{ const u=[...localULS]; u[i]=editText; setLocalULS(u); setEditingULS(null); }}
                          autoFocus style={{ width:"100%", fontSize:10, fontFamily:MONO, border:"1px solid #2563eb", borderRadius:2 }}/>
                      : `ULS Combo ${i+1}: ${combo}`}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {["Add","Modify","Delete","Move Up","Move Down"].map(action => (
                <button key={action} onClick={()=>{
                  if(action==="Add") { setLocalULS(u=>[...u, "1.00D + 1.00L"]); setSelectedULS(localULS.length); }
                  if(action==="Delete" && localULS.length>1) setLocalULS(u=>u.filter((_,i)=>i!==selectedULS));
                  if(action==="Modify") { setEditingULS(selectedULS); setEditText(localULS[selectedULS]); }
                  if(action==="Move Up" && selectedULS>0) {
                    const u=[...localULS]; [u[selectedULS-1],u[selectedULS]]=[u[selectedULS],u[selectedULS-1]];
                    setLocalULS(u); setSelectedULS(selectedULS-1);
                  }
                  if(action==="Move Down" && selectedULS<localULS.length-1) {
                    const u=[...localULS]; [u[selectedULS],u[selectedULS+1]]=[u[selectedULS+1],u[selectedULS]];
                    setLocalULS(u); setSelectedULS(selectedULS+1);
                  }
                }} style={btnS}>{action}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display:"flex", gap:8, justifyContent:"flex-end", paddingTop:16, borderTop:"1px solid #dee2e6", marginTop:12 }}>
        <button onClick={()=>{ setLoadFactors(localFactors); setUlsCombos(localULS); onClose(); }}
          style={{...btnS, background:"#2563eb", color:"#fff", border:"none"}}>OK</button>
        <button onClick={onClose} style={btnS}>Cancel</button>
      </div>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════════
// DESIGN CODE SELECTOR MODAL
// ═══════════════════════════════════════════════════════════════
function DesignCodeModal({ designCode, setDesignCode, onClose }) {
  const [local, setLocal] = useState(designCode);
  return (
    <ModalShell title="Design Code" onClose={onClose} width={280}>
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:12, fontWeight:600, marginBottom:6 }}>Select a Design Code</div>
        <select value={local} onChange={e=>setLocal(e.target.value)}
          size={12} style={{ width:"100%", fontSize:12, padding:"2px 4px", border:"1px solid #ced4da", borderRadius:3 }}>
          {DESIGN_CODES.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
        <button onClick={()=>{ setDesignCode(local); onClose(); }} style={{...btnS, background:"#2563eb", color:"#fff", border:"none"}}>OK</button>
        <button onClick={onClose} style={btnS}>Cancel</button>
      </div>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════════
// SHARED MODAL SHELL (exported for use in DefineDialogs)
// ═══════════════════════════════════════════════════════════════
export function ModalShell({ title, onClose, width=600, children }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center" }}
      onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={{ background:"#fff", borderRadius:6, width:Math.min(width, window.innerWidth-32), maxHeight:"90vh", overflow:"auto",
        boxShadow:"0 20px 60px rgba(0,0,0,0.3)", display:"flex", flexDirection:"column" }}>
        {/* Title bar */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 16px",
          borderBottom:"1px solid #dee2e6", background:"#f8f9fa", borderRadius:"6px 6px 0 0" }}>
          <span style={{ fontSize:13, fontWeight:700 }}>{title}</span>
          <button onClick={onClose} style={{ border:"none", background:"none", fontSize:16, cursor:"pointer", color:"#6c757d", padding:"0 4px" }}>✕</button>
        </div>
        <div style={{ padding:16, flex:1, overflow:"auto" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// Shared button style (exported for use in DefineDialogs)
export const btnS = {
  padding:"5px 16px", border:"1px solid #ced4da", borderRadius:3, background:"#f8f9fa",
  fontSize:11, cursor:"pointer", color:"#495057", fontFamily:"inherit",
};

// ═══════════════════════════════════════════════════════════════
// MAIN OPTIONS MENU BAR — rendered in the app toolbar
// Mirrors ConCise's "Options" and "Define" menus
// ═══════════════════════════════════════════════════════════════
export function OptionsMenuBar({ state, setState }) {
  const [openMenu, setOpenMenu] = useState(null);
  const [modal, setModal] = useState(null);
  const [menuBarRef, setMenuBarRef] = useState(null);
  const close = () => { setOpenMenu(null); setModal(null); };

  const { flags, setFlags, deflMult, setDeflMult, ulsCombos, setUlsCombos,
          slsCombos, loadFactors, setLoadFactors, designCode, setDesignCode,
          units, setUnits, defineModal, setDefineModal,
          onNew, onOpen, onSave, onSaveAs, onPrint, onPrintPreview,
          onTextReports, onGraphs, recentFiles = [] } = state;

  const openDefine = (key) => { setOpenMenu(null); setDefineModal(key); };

  // ── Menu positioning — track button positions so dropdowns align ──
  const [btnPositions, setBtnPositions] = useState({});
  const registerBtn = (key, el) => {
    if (el && !btnPositions[key]) {
      const rect = el.getBoundingClientRect();
      setBtnPositions(p => ({ ...p, [key]: rect.left }));
    }
  };

  const MENUS = ["File","Edit","Options","Define","Solution","View","Window","Help"];

  const menuBtn = (key) => (
    <button
      key={key}
      ref={el => registerBtn(key, el)}
      onClick={() => setOpenMenu(openMenu === key ? null : key)}
      style={{
        padding:"4px 10px", border:"none", cursor:"pointer", fontSize:12,
        background: openMenu===key ? "#e9ecef" : "transparent",
        color:"#212529", borderBottom: openMenu===key?"2px solid #2563eb":"2px solid transparent",
      }}
    >{key}</button>
  );

  const miS = (disabled=false) => ({
    padding:"6px 20px", fontSize:12, cursor:disabled?"default":"pointer",
    color:disabled?"#adb5bd":"#212529", whiteSpace:"nowrap", background:"transparent",
    userSelect:"none", display:"block", width:"100%", textAlign:"left", border:"none",
  });

  const MI = ({ label, action, disabled=false, shortcut }) => (
    <div
      onClick={()=>{ if(!disabled){ action(); setOpenMenu(null); } }}
      onMouseEnter={e=>{ if(!disabled) e.currentTarget.style.background="#e7f0fd"; }}
      onMouseLeave={e=>{ e.currentTarget.style.background="transparent"; }}
      style={miS(disabled)}
    >
      <span style={{ flex:1 }}>{label}</span>
      {shortcut && <span style={{ float:"right", marginLeft:40, color:"#868e96", fontSize:11 }}>{shortcut}</span>}
    </div>
  );
  const Divider = () => <div style={{ borderTop:"1px solid #dee2e6", margin:"3px 0" }}/>;

  const dropPos = (key) => {
    const keys = MENUS;
    const idx = keys.indexOf(key);
    return (idx * 58) + 90; // approximate left offset based on menu position
  };

  const DropDown = ({ menuKey, children }) => openMenu !== menuKey ? null : (
    <div style={{
      position:"fixed", top:56, left:dropPos(menuKey), background:"#fff",
      border:"1px solid #c0c8d4", borderTop:"none",
      boxShadow:"2px 4px 12px rgba(0,0,0,0.18)", zIndex:9000, minWidth:200,
      borderRadius:"0 0 4px 4px", padding:"4px 0",
    }}>
      {children}
    </div>
  );

  return (
    <>
      {/* ── Full ConCise-style menu bar ── */}
      <div ref={setMenuBarRef} style={{
        display:"flex", alignItems:"center", background:"#f0f0f0",
        borderBottom:"1px solid #bbb", padding:"0 8px", height:28,
        fontSize:12, userSelect:"none", position:"relative", zIndex:200,
      }}>
        {/* App title / icon area */}
        <span style={{ fontWeight:800, fontSize:11, fontFamily:MONO, color:"#1a3c6e",
          marginRight:12, letterSpacing:0.3, padding:"0 8px 0 0", borderRight:"1px solid #ccc" }}>
          BT STRUCTURAL
        </span>

        {MENUS.map(key => menuBtn(key))}

        {/* Right: design code + units status bar (ConCise bottom-right info) */}
        <div style={{ marginLeft:"auto", display:"flex", gap:12, alignItems:"center" }}>
          <span style={{ fontSize:10, color:"#555", fontFamily:MONO }}>{designCode}</span>
          <span style={{ fontSize:10, color:"#555", fontFamily:MONO, textTransform:"uppercase",
            background:"#e8e8e8", padding:"1px 6px", border:"1px solid #ccc", borderRadius:2 }}>
            {units==="metric"?"METRIC":"IMPERIAL"}
          </span>
        </div>
      </div>

      {/* ── FILE ── */}
      <DropDown menuKey="File">
        <MI label="New" shortcut="Ctrl+N" action={()=>onNew?.()}/>
        <MI label="Open..." shortcut="Ctrl+O" action={()=>onOpen?.()}/>
        <MI label="Close" action={()=>{}} disabled/>
        <Divider/>
        <MI label="Save" shortcut="Ctrl+S" action={()=>onSave?.()}/>
        <MI label="Save As..." action={()=>onSaveAs?.()}/>
        <MI label="Export Details..." action={()=>{}} disabled/>
        <Divider/>
        <MI label="Print..." shortcut="Ctrl+P" action={()=>onPrint?.()}/>
        <MI label="Print Preview" action={()=>onPrintPreview?.()}/>
        <MI label="Print Setup..." action={()=>{}} disabled/>
        {recentFiles.length > 0 && <Divider/>}
        {recentFiles.map((f,i)=>(<MI key={i} label={`${i+1} ${f}`} action={()=>{}}/>))}
        <Divider/>
        <MI label="Exit" action={()=>{}} disabled/>
      </DropDown>

      {/* ── EDIT ── */}
      <DropDown menuKey="Edit">
        <MI label="Undo" shortcut="Ctrl+Z" action={()=>{}} disabled/>
        <Divider/>
        <MI label="Cut" shortcut="Ctrl+X" action={()=>{}} disabled/>
        <MI label="Copy" shortcut="Ctrl+C" action={()=>{}} disabled/>
        <MI label="Paste" shortcut="Ctrl+V" action={()=>{}} disabled/>
        <Divider/>
        <MI label="Select All" shortcut="Ctrl+A" action={()=>{}} disabled/>
      </DropDown>

      {/* ── OPTIONS ── */}
      <DropDown menuKey="Options">
        <MI label="Design Code..." action={()=>setModal("designCode")}/>
        <MI label="Libraries..." action={()=>{}} disabled/>
        <MI label="Units of Measure..." action={()=>setUnits(u=>u==="metric"?"imperial":"metric")}/>
        <MI label={`Switch to ${units==="metric"?"US (Imperial)":"Metric"} Units`} shortcut="Ctrl+U" action={()=>setUnits(u=>u==="metric"?"imperial":"metric")}/>
        <Divider/>
        <MI label="Calculation Options..." action={()=>setModal("calcOptions")}/>
        <MI label="Deflection Multipliers..." action={()=>setModal("deflMult")}/>
        <MI label="Load Combinations..." action={()=>setModal("loadCombos")}/>
        <Divider/>
        <MI label="Auto Save" shortcut="Ctrl+B" action={()=>{}} disabled/>
      </DropDown>

      {/* ── DEFINE ── */}
      <DropDown menuKey="Define">
        <MI label="Problem Identification..." action={()=>{}} disabled/>
        <Divider/>
        <MI label="Concrete Material..." action={()=>openDefine("concrete")}/>
        <MI label="Beam Definition..." action={()=>openDefine("beam")}/>
        <MI label="CIP Pour Definition..." action={()=>openDefine("cip")}/>
        <MI label="Torsion Parameters..." action={()=>{}} disabled/>
        <Divider/>
        <MI label="Load Definition..." action={()=>setModal("loadCombos")}/>
        <Divider/>
        <MI label="Reinforcing Steel..." action={()=>openDefine("rebar")}/>
        <MI label="Prestressing..." action={()=>openDefine("prestress")}/>
        <MI label="Shear Strengthening..." action={()=>openDefine("shear")}/>
        <MI label="Design Parameters..." action={()=>openDefine("designParams")}/>
      </DropDown>

      {/* ── SOLUTION ── */}
      <DropDown menuKey="Solution">
        <MI label="Load Analysis Parameters" action={()=>setModal("calcOptions")}/>
        <MI label="Vibration Analysis Parameters" action={()=>{}} disabled/>
        <Divider/>
        <MI label="Text Reports..." action={()=>onTextReports?.()}/>
        <MI label="Graphs..." action={()=>onGraphs?.()}/>
        <MI label="Update Results in Open Windows" action={()=>{}} disabled/>
      </DropDown>

      {/* ── VIEW ── */}
      <DropDown menuKey="View">
        <MI label="Show 3D Beam Image" action={()=>{}} disabled/>
        <MI label="Image and Graph Reset" shortcut="Ctrl+R" action={()=>{}}/>
        <MI label="Refresh Windows" action={()=>window.location.reload()}/>
        <Divider/>
        <MI label="✓ Toolbar" action={()=>{}}/>
        <MI label="✓ Status Bar" action={()=>{}}/>
        <Divider/>
        <MI label="Display Preferences..." action={()=>setModal("calcOptions")}/>
        <MI label="Set Screen Font..." action={()=>{}} disabled/>
        <MI label="Set Printer Font..." action={()=>{}} disabled/>
      </DropDown>

      {/* ── WINDOW ── */}
      <DropDown menuKey="Window">
        <MI label="Cascade" action={()=>{}} disabled/>
        <MI label="Tile Side by Side" action={()=>{}} disabled/>
        <MI label="Tile Top to Bottom" action={()=>{}} disabled/>
        <MI label="Arrange Icons" action={()=>{}} disabled/>
        <Divider/>
        <MI label="✓ 1 BT Structural" action={()=>{}}/>
      </DropDown>

      {/* ── HELP ── */}
      <DropDown menuKey="Help">
        <MI label="Help Topics" action={()=>{}} disabled/>
        <MI label="F1 Key for Help" action={()=>{}} disabled/>
        <Divider/>
        <MI label="About BT Structural Calculator..." action={()=>setModal("about")}/>
      </DropDown>

      {/* Backdrop to close menus */}
      {openMenu && (
        <div style={{ position:"fixed", inset:0, zIndex:8999 }} onClick={()=>setOpenMenu(null)}/>
      )}

      {/* ── Modals ── */}
      {modal==="designCode"  && <DesignCodeModal    designCode={designCode} setDesignCode={setDesignCode} onClose={close}/>}
      {modal==="calcOptions" && <CalcOptionsModal   flags={flags} setFlags={setFlags} onClose={close}/>}
      {modal==="deflMult"    && <DeflMultipliersModal mult={deflMult} setMult={setDeflMult} onClose={close}/>}
      {modal==="loadCombos"  && <LoadCombosModal    loadFactors={loadFactors} setLoadFactors={setLoadFactors}
                                  ulsCombos={ulsCombos} setUlsCombos={setUlsCombos} slsCombos={slsCombos} onClose={close}/>}
      {modal==="about"       && (
        <ModalShell title="About BT Structural Calculator" onClose={close} width={360}>
          <div style={{ textAlign:"center", padding:"12px 0" }}>
            <div style={{ fontSize:20, fontWeight:800, fontFamily:MONO, color:"#1a3c6e", marginBottom:8 }}>BT Structural</div>
            <div style={{ fontSize:12, color:"#495057", marginBottom:4 }}>Hollowcore & Beam Design Calculator</div>
            <div style={{ fontSize:11, color:"#868e96" }}>Building Theory — Miami, FL</div>
            <div style={{ fontSize:11, color:"#868e96", marginTop:4 }}>
              Ref: PCI 8th Ed. · ACI 318-19 · CSA A23.3-19 · CPCI 5th Ed.
            </div>
            <div style={{ marginTop:16 }}>
              <button onClick={close} style={{ ...btnS, padding:"5px 24px" }}>OK</button>
            </div>
          </div>
        </ModalShell>
      )}
    </>
  );
}
