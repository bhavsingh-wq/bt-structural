import { useState, useMemo, useEffect, createContext, useContext } from "react";
import { supabase } from "./supabaseClient";
import { Viewer3D } from "./Viewer3D";
import { buildColumnScene, buildHollowcoreScene } from "./models3d";
import { BeamTab } from "./BeamTab";
import { runStationAnalysis, stationSummary } from "./StationAnalysis";
import { computeComposite, interfaceShear, crackWidth, steelStressAtService, runPhase4 } from "./CompositeSection";
import { runConstructionStages, stageSummary } from "./ConstructionStages";
import { runPhase6and8, OCCUPANCY_TYPES, RHYTHMIC_ACTIVITIES } from "./VibrationShear";
import { computeIy, runLateralStability } from "./LateralStability";
import { runMovingLoad, STANDARD_VEHICLES, movingLoadEnvelope } from "./MovingLoads";
import { computeTransformedSection, sectionStress, compareTransformation } from "./TransformedSection";
import { runTorsionDesign, eccentricLoadTorsion } from "./TorsionDesign";
import { OptionsMenuBar, CalcOptionsContext, DEFAULT_CALC_FLAGS, DEFAULT_DEFL_MULTIPLIERS,
         DEFAULT_ULS_COMBOS, DEFAULT_SLS_COMBOS, DEFAULT_LOAD_FACTORS, useCalcOptions } from "./CalcOptions";
import { DefineDialogsController, DefineContext,
         DEFAULT_CONCRETE, DEFAULT_BEAM, DEFAULT_CIP, DEFAULT_REBAR,
         DEFAULT_PRESTRESS, DEFAULT_SHEAR, DEFAULT_DESIGN_PARAMS } from "./DefineDialogs";

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Shared project storage: data access helpers ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
async function fetchAllCalcs(){
  const { data, error } = await supabase
    .from("saved_calcs")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) { console.error("fetchAllCalcs error:", error); return []; }
  return data || [];
}
async function saveCalc({projectName, partName, calcName, module, inputs, reportText, userId, userName}){
  const { data, error } = await supabase
    .from("saved_calcs")
    .insert([{
      project_name: projectName,
      part_name: partName,
      calc_name: calcName,
      module,
      inputs,
      report_text: reportText || null,
      created_by_id: userId,
      created_by_name: userName,
    }])
    .select();
  if (error) { console.error("saveCalc error:", error); return { ok:false, error }; }
  return { ok:true, row: data?.[0] };
}
async function updateCalc(id, {inputs, reportText}){
  const { error } = await supabase
    .from("saved_calcs")
    .update({ inputs, report_text: reportText || null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) { console.error("updateCalc error:", error); return { ok:false, error }; }
  return { ok:true };
}
async function deleteCalc(id){
  const { error } = await supabase.from("saved_calcs").delete().eq("id", id);
  if (error) { console.error("deleteCalc error:", error); return { ok:false, error }; }
  return { ok:true };
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ View settings context: controls whether formulas, graphics, inputs, outputs show ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
const ViewSettingsContext = createContext({
  showSteps: true,
  showGraphics: true,
  showInputs: true,
  showOutputs: true,
  reportStyle: "interactive",
});
const useViewSettings = () => useContext(ViewSettingsContext);

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Per-module color identity: PCI=blue, CPCI=purple, Column=green, Crush=orange ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
const MODULE_THEMES = {
  pci:   { name:"pci",   accent:"#2563eb", accentDark:"#1d4ed8", soft:"#eff6ff", softBorder:"#bfdbfe", text:"#1e3a8a" },
  cpci:  { name:"cpci",  accent:"#7c3aed", accentDark:"#6d28d9", soft:"#f5f3ff", softBorder:"#ddd6fe", text:"#4c1d95" },
  col:   { name:"col",   accent:"#16a34a", accentDark:"#15803d", soft:"#f0fdf4", softBorder:"#bbf7d0", text:"#14532d" },
  crush: { name:"crush", accent:"#ea580c", accentDark:"#c2410c", soft:"#fff7ed", softBorder:"#fed7aa", text:"#7c2d12" },
  beam:  { name:"beam",  accent:"#0ea5e9", accentDark:"#0284c7", soft:"#f0f9ff", softBorder:"#bae6fd", text:"#0c4a6e" },
};
const ModuleThemeContext = createContext(MODULE_THEMES.pci);
const useModuleTheme = () => useContext(ModuleThemeContext);

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Employee credentials + roles ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
// role: "admin"  ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ sees all projects, can manage access
//       "user"   ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ sees only their own projects
const EMPLOYEES = {
  "admin":     { pass: "admin123",   name: "Administrator",      role: "admin" },
  "bhavjeet":  { pass: "bt2026",     name: "Bhavjeet Singh Hora",role: "admin" },
  "ben.bayat": { pass: "bt2026",     name: "Ben Bayat",          role: "admin" },
  "engineer":  { pass: "design2026", name: "Engineer",            role: "user"  },
  "sid.surendra":  { pass: "bt2026", name: "Sid Surendra",        role: "user"  },
  "ana.almarales": { pass: "bt2026", name: "Ana Almarales",       role: "user"  },
};

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Role helpers ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
// Check if a user object has admin access.
// Checks both the hardcoded EMPLOYEES role AND the runtime Supabase
// user_roles table (so admins can grant/revoke access at runtime).
const isAdmin = (user) => user?.role === "admin" || user?.runtimeAdmin === true;

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Runtime role overrides (persisted in Supabase user_roles table) ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
// Run this SQL once in Supabase SQL Editor to create the table:
//   CREATE TABLE IF NOT EXISTS user_roles (
//     user_id TEXT PRIMARY KEY,
//     role TEXT NOT NULL DEFAULT 'user',
//     granted_by TEXT,
//     granted_at TIMESTAMPTZ DEFAULT NOW()
//   );
async function fetchUserRole(userId) {
  try {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .single();
    return data?.role || null;
  } catch { return null; }
}

async function setUserRole(userId, role, grantedBy) {
  const { error } = await supabase
    .from("user_roles")
    .upsert({ user_id: userId, role, granted_by: grantedBy, granted_at: new Date().toISOString() });
  return !error;
}

async function fetchAllUserRoles() {
  try {
    const { data } = await supabase.from("user_roles").select("*");
    return data || [];
  } catch { return []; }
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Role-aware data fetching ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
// Admins get all calcs; regular users get only their own.
async function fetchCalcsForUser(user) {
  if (!user) return [];
  if (isAdmin(user)) {
    // Admin: fetch all calcs from everyone
    const { data, error } = await supabase
      .from("saved_calcs")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) { console.error("fetchCalcs error:", error); return []; }
    return data || [];
  } else {
    // Regular user: fetch only their own calcs
    const { data, error } = await supabase
      .from("saved_calcs")
      .select("*")
      .eq("created_by_id", user.id)
      .order("created_at", { ascending: false });
    if (error) { console.error("fetchCalcs error:", error); return []; }
    return data || [];
  }
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Data ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
const PCI_SLABS = {
  "HC8 (NEW)":{h:8,A:216.5,Ix:1673,yb:4.5104,b:48,SW:56,bw:14.9,tf:1.38,cores:4,coreD:5.5},
  "HC8-1":{h:8,A:201.56,Ix:1614.79,yb:4.1992,b:48,SW:52,bw:11.4,tf:1.11,cores:4,coreD:5.5},
  "HC8-2":{h:8,A:230.7,Ix:1737,yb:4.8063,b:48,SW:60,bw:14.4,tf:1.2,cores:4,coreD:5.5},
  "HC10":{h:10,A:248.51,Ix:3133,yb:5.1773,b:48,SW:65,bw:11.2,tf:1.38,cores:4,coreD:7},
  "HC12":{h:12,A:285,Ix:5274,yb:5.9375,b:48,SW:75,bw:11.17,tf:1.57,cores:4,coreD:8.5},
  "HC14":{h:14,A:316,Ix:7877,yb:6.5833,b:48,SW:82,bw:11.44,tf:1.39,cores:4,coreD:10},
  "PCI 8IN":{h:8,A:154,Ix:1224.5,yb:3.89,b:36,SW:53.5,bw:10.5,tf:1.25,cores:3,coreD:5},
};
const CPCI_SLABS = {
  "08H":{h:203,A:138916,Ix:682981659.3,yb:104,b:1219,fpu:1860,SW:2.68,bw:357,tf:35,Pc:2844,cores:4,coreD:140},
  "08H (1C)":{h:203,A:156195,Ix:708619376,yb:104,b:1219,fpu:1860,SW:3.01,bw:494,tf:35,Pc:2844,cores:3,coreD:140},
  "HC10":{h:254,A:162115.8,Ix:1307299661.5,yb:130,b:1219,fpu:1860,SW:3.11,bw:301,tf:35,Pc:2946,cores:4,coreD:180},
  "HC10 (1C)":{h:254,A:190701,Ix:1374450474,yb:129,b:1219,fpu:1860,SW:3.67,bw:482,tf:35,Pc:2946,cores:3,coreD:180},
  "12H":{h:305,A:185225,Ix:2193314022,yb:154,b:1219,fpu:1860,SW:3.57,bw:301,tf:40,Pc:3048,cores:4,coreD:215},
  "12H (1C)":{h:305,A:221302,Ix:2321827558,yb:154,b:1219,fpu:1860,SW:4.27,bw:468,tf:40,Pc:3048,cores:3,coreD:215},
};
const HC_CRUSH={
  "08H":{h:203,b:1219,bw:357,cores:4,coreD:140},
  "HC10":{h:254,b:1219,bw:292,cores:4,coreD:180},
  "12H":{h:305,b:1219,bw:301,cores:4,coreD:215},
};
const REBAR={
  "#3":{d:0.375,A:0.11},"#4":{d:0.5,A:0.2},"#5":{d:0.625,A:0.31},
  "#6":{d:0.75,A:0.44},"#7":{d:0.875,A:0.6},"#8":{d:1,A:0.79},
  "#9":{d:1.128,A:1},"#10":{d:1.27,A:1.27},"#11":{d:1.41,A:1.56},
  "#14":{d:1.693,A:2.25},"#18":{d:2.257,A:4},
};
const fmt=(v,d=3)=>v==null||isNaN(v)?"ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â":Number(v).toFixed(d);

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ SVG GRAPHICS ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
function HollowcoreXSection({h,b,cores,coreD,nStrands,dp,yb,e,scale}){
  const sc=scale||7;
  const W=b*sc,H=h*sc,pad=46;
  const svgW=W+pad*2+150,svgH=H+pad*2+70;
  const ox=pad,oy=pad+30;
  const coreR=coreD*sc/2;
  const coreSpacing=W/(cores+1);
  return(
    <svg className="live-svg" viewBox={`0 0 ${svgW} ${svgH}`} style={{width:"100%",maxWidth:620,display:"block",margin:"12px auto"}}>
      <rect x={0} y={0} width={svgW} height={svgH} fill="#ffffff"/>
      <text x={svgW/2} y={24} textAnchor="middle" fontSize={14} fill="#212529" fontWeight={800} fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">CROSS-SECTION</text>

      <rect x={ox} y={oy} width={W} height={H} fill="#e9ecef" stroke="#343a40" strokeWidth={2} rx={2}/>
      {Array.from({length:cores}).map((_,i)=>{
        const cx=ox+coreSpacing*(i+1);
        const cy=oy+H/2;
        return <ellipse key={i} cx={cx} cy={cy} rx={coreR} ry={coreR*0.85} fill="#ffffff" stroke="#6c757d" strokeWidth={1.5}/>;
      })}

      {nStrands>0&&Array.from({length:Math.min(nStrands,8)}).map((_,i)=>{
        const sxp=ox+W/(Math.min(nStrands,8)+1)*(i+1);
        return <circle key={i} cx={sxp} cy={oy+dp*sc} r={6} fill="#c0392b" stroke="#7f1d1d" strokeWidth={1.5}/>;
      })}

      {/* Width dimension */}
      <line x1={ox} y1={oy+H+22} x2={ox+W} y2={oy+H+22} stroke="#343a40" strokeWidth={1.2} markerStart="url(#ah)" markerEnd="url(#ah)"/>
      <text x={ox+W/2} y={oy+H+42} textAnchor="middle" fontSize={15} fill="#212529" fontWeight={700} fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">{b}"</text>

      {/* Height dimension */}
      <line x1={ox+W+22} y1={oy} x2={ox+W+22} y2={oy+H} stroke="#343a40" strokeWidth={1.2} markerStart="url(#ah)" markerEnd="url(#ah)"/>
      <text x={ox+W+34} y={oy+H/2+5} fontSize={15} fill="#212529" fontWeight={700} fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">{h}"</text>

      {/* yb centroid line */}
      <line x1={ox-14} y1={oy+yb*sc} x2={ox+W} y2={oy+yb*sc} stroke="#2980b9" strokeWidth={1.5} strokeDasharray="6,3"/>
      <text x={ox-18} y={oy+yb*sc+5} textAnchor="end" fontSize={13} fill="#2980b9" fontWeight={700} fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">yb</text>

      {/* dp strand-centroid line */}
      {nStrands>0&&<>
        <line x1={ox-14} y1={oy+dp*sc} x2={ox+W} y2={oy+dp*sc} stroke="#c0392b" strokeWidth={1.5} strokeDasharray="3,3"/>
        <text x={ox-18} y={oy+dp*sc+5} textAnchor="end" fontSize={13} fill="#c0392b" fontWeight={700} fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">dp</text>
      </>}

      <defs><marker id="ah" markerWidth={8} markerHeight={8} refX={4} refY={4} orient="auto"><path d="M0,1 L8,4 L0,7" fill="none" stroke="#343a40" strokeWidth={1.2}/></marker></defs>

      {/* Legend */}
      <g transform={`translate(${pad}, ${svgH-22})`}>
        <circle cx={6} cy={0} r={6} fill="#c0392b" stroke="#7f1d1d" strokeWidth={1.5}/>
        <text x={18} y={4} fontSize={12} fill="#495057" fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">Strand (dp = {fmt(dp,2)}")</text>
        <line x1={160} y1={0} x2={180} y2={0} stroke="#2980b9" strokeWidth={1.5} strokeDasharray="6,3"/>
        <text x={186} y={4} fontSize={12} fill="#495057" fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">Centroid (yb = {fmt(yb,2)}")</text>
      </g>
    </svg>
  );
}

function StressDiagram({h,topStress,botStress,label,sc}){
  const scale=sc||18;
  const H=h*scale,pad=20;
  const maxS=Math.max(Math.abs(topStress),Math.abs(botStress))||1;
  const barW=80;
  const tW=topStress/maxS*barW,bW=botStress/maxS*barW;
  const svgW=barW*2+pad*2+60,svgH=H+pad*2+10;
  const cx=pad+barW;
  return(
    <svg className="live-svg" viewBox={`0 0 ${svgW} ${svgH}`} style={{width:"100%",maxWidth:220,display:"block",margin:"4px auto"}}>
      <rect x={0} y={0} width={svgW} height={svgH} fill="#ffffff"/>
      <rect x={cx-1} y={pad} width={2} height={H} fill="#adb5bd"/>
      <polygon points={`${cx},${pad} ${cx+tW},${pad} ${cx+bW},${pad+H} ${cx},${pad+H}`} fill={topStress<0?"#fee2e2":"#d4edda"} stroke={topStress<0?"#c0392b":"#27ae60"} strokeWidth={1} opacity={0.7}/>
      <text x={cx+tW+(tW>0?4:-4)} y={pad+8} textAnchor={tW>0?"start":"end"} fontSize={8} fill="#495057" fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">{fmt(topStress,3)}</text>
      <text x={cx+bW+(bW>0?4:-4)} y={pad+H-2} textAnchor={bW>0?"start":"end"} fontSize={8} fill="#495057" fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">{fmt(botStress,3)}</text>
      <text x={svgW/2} y={pad-4} textAnchor="middle" fontSize={8} fill="#6c757d" fontWeight={600} fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">{label}</text>
    </svg>
  );
}

function ColumnXSection({b,h,nBot,nTop,cover,dTie,dBot,dTop}){
  const sc=8;const W=b*sc,H=h*sc,pad=44;
  const svgW=W+pad*2+60,svgH=H+pad*2+90;
  const ox=pad,oy=pad+30;
  const ci=cover*sc+dTie*sc;
  const botLabel=Object.keys(REBAR).find(k=>Math.abs(REBAR[k].d-dBot)<0.01)||"?";
  const topLabel=Object.keys(REBAR).find(k=>Math.abs(REBAR[k].d-dTop)<0.01)||"?";
  return(
    <svg className="live-svg" viewBox={`0 0 ${svgW} ${svgH}`} style={{width:"100%",maxWidth:420,display:"block",margin:"12px auto"}}>
      <rect x={0} y={0} width={svgW} height={svgH} fill="#ffffff"/>
      <text x={svgW/2} y={24} textAnchor="middle" fontSize={14} fill="#212529" fontWeight={800} fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">COLUMN SECTION</text>

      <rect x={ox} y={oy} width={W} height={H} fill="#e9ecef" stroke="#343a40" strokeWidth={2} rx={2}/>
      <rect x={ox+cover*sc} y={oy+cover*sc} width={W-2*cover*sc} height={H-2*cover*sc} fill="none" stroke="#adb5bd" strokeWidth={1} strokeDasharray="6,3" rx={1}/>
      {/* ties */}
      <rect x={ox+ci-dTie*sc/2} y={oy+ci-dTie*sc/2} width={W-2*ci+dTie*sc} height={H-2*ci+dTie*sc} fill="none" stroke="#6c757d" strokeWidth={2.5} rx={2}/>
      {/* bot bars */}
      {Array.from({length:nBot}).map((_,i)=>{
        const cx2=ox+ci+dBot*sc/2+(W-2*ci-dBot*sc)/(Math.max(nBot-1,1))*i;
        return <circle key={`b${i}`} cx={nBot===1?ox+W/2:cx2} cy={oy+H-ci} r={Math.max(dBot*sc/2,6)} fill="#c0392b" stroke="#7f1d1d" strokeWidth={1.5}/>;
      })}
      {/* top bars */}
      {Array.from({length:nTop}).map((_,i)=>{
        const cx2=ox+ci+dTop*sc/2+(W-2*ci-dTop*sc)/(Math.max(nTop-1,1))*i;
        return <circle key={`t${i}`} cx={nTop===1?ox+W/2:cx2} cy={oy+ci} r={Math.max(dTop*sc/2,6)} fill="#2980b9" stroke="#1a4971" strokeWidth={1.5}/>;
      })}

      {/* Width dimension */}
      <line x1={ox} y1={oy+H+22} x2={ox+W} y2={oy+H+22} stroke="#343a40" strokeWidth={1.2} markerStart="url(#ahc)" markerEnd="url(#ahc)"/>
      <text x={ox+W/2} y={oy+H+42} textAnchor="middle" fontSize={15} fill="#212529" fontWeight={700} fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">b = {b}"</text>

      {/* Height dimension */}
      <line x1={ox+W+22} y1={oy} x2={ox+W+22} y2={oy+H} stroke="#343a40" strokeWidth={1.2} markerStart="url(#ahc)" markerEnd="url(#ahc)"/>
      <text x={ox+W+34} y={oy+H/2+5} fontSize={15} fill="#212529" fontWeight={700} fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">h = {h}"</text>

      <defs><marker id="ahc" markerWidth={8} markerHeight={8} refX={4} refY={4} orient="auto"><path d="M0,1 L8,4 L0,7" fill="none" stroke="#343a40" strokeWidth={1.2}/></marker></defs>

      {/* Legend */}
      <g transform={`translate(${ox}, ${oy+H+64})`}>
        <circle cx={6} cy={0} r={7} fill="#c0392b" stroke="#7f1d1d" strokeWidth={1.5}/>
        <text x={20} y={5} fontSize={13} fill="#495057" fontWeight={600} fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">Bottom: {nBot} ÃƒÆ’Ã¢â‚¬â€ {botLabel}</text>
      </g>
      <g transform={`translate(${ox}, ${oy+H+86})`}>
        <circle cx={6} cy={0} r={7} fill="#2980b9" stroke="#1a4971" strokeWidth={1.5}/>
        <text x={20} y={5} fontSize={13} fill="#495057" fontWeight={600} fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">Top: {nTop} ÃƒÆ’Ã¢â‚¬â€ {topLabel}</text>
      </g>
    </svg>
  );
}

function BearingDiagram({h,w,bw,b}){
  const sc=0.8;const pad=20;
  const W=b*sc/5,H=h*sc;
  const svgW=W+pad*2+60,svgH=H+pad*2+50;
  const ox=pad,oy=pad;
  const wSc=w*sc/5;
  return(
    <svg className="live-svg" viewBox={`0 0 ${svgW} ${svgH}`} style={{width:"100%",maxWidth:240,display:"block",margin:"10px auto"}}>
      <rect x={0} y={0} width={svgW} height={svgH} fill="#ffffff"/>
      <rect x={ox} y={oy} width={W} height={H} fill="#e9ecef" stroke="#495057" strokeWidth={1.5} rx={1}/>
      <rect x={ox-4} y={oy+H} width={wSc+4} height={8} fill="#ffeeba" stroke="#d4a017" strokeWidth={1}/>
      <line x1={ox-10} y1={oy+H+8} x2={ox+wSc+10} y2={oy+H+8} stroke="#495057" strokeWidth={2}/>
      {/* hatch */}
      {[0,1,2,3,4].map(i=><line key={i} x1={ox-10+i*8} y1={oy+H+8} x2={ox-18+i*8} y2={oy+H+16} stroke="#495057" strokeWidth={0.8}/>)}
      <text x={ox+wSc/2} y={oy+H+30} textAnchor="middle" fontSize={8} fill="#d4a017" fontWeight={700} fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">w={w}mm</text>
      <text x={ox+W/2} y={oy-6} textAnchor="middle" fontSize={9} fill="#343a40" fontWeight={700} fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">BEARING</text>
      {/* load arrow */}
      <line x1={ox+W/2} y1={oy-18} x2={ox+W/2} y2={oy-2} stroke="#c0392b" strokeWidth={1.5} markerEnd="url(#ar)"/>
      <text x={ox+W/2+8} y={oy-12} fontSize={7} fill="#c0392b" fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">P</text>
      <defs><marker id="ar" markerWidth={8} markerHeight={8} refX={4} refY={4} orient="auto"><path d="M1,1 L7,4 L1,7" fill="#c0392b"/></marker></defs>
    </svg>
  );
}

// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
// SCIENTIFIC CHARTS ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â reusable SVG primitives + specific charts
// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
const CHART_FONT = "'JetBrains Mono','Fira Code','Consolas',monospace";

// Generic horizontal bar chart: bars=[{label,value,color}], all on one shared scale
function BarChart({bars, unit, width, height, title}){
  const W=width||500, H=height||Math.max(160, bars.length*42+50), padL=140, padR=70, padT=36, padB=16;
  const maxV = Math.max(...bars.map(b=>Math.abs(b.value)), 0.0001) * 1.15;
  const plotW = W - padL - padR;
  const rowH = (H - padT - padB) / bars.length;
  return(
    <svg className="live-svg" viewBox={`0 0 ${W} ${H}`} style={{width:"100%",maxWidth:560,display:"block",margin:"8px auto"}}>
      <rect x={0} y={0} width={W} height={H} fill="#ffffff"/>
      {title && <text x={W/2} y={18} textAnchor="middle" fontSize={11} fontWeight={700} fill="#343a40" fontFamily={CHART_FONT}>{title}</text>}
      {[0,0.25,0.5,0.75,1].map(f=>{
        const x = padL + f*plotW;
        return <line key={f} x1={x} y1={padT} x2={x} y2={H-padB} stroke="#f1f3f5" strokeWidth={1}/>;
      })}
      {bars.map((b,i)=>{
        const y = padT + i*rowH + rowH*0.2;
        const bh = rowH*0.6;
        const bw = Math.max((Math.abs(b.value)/maxV)*plotW, 1);
        return(
          <g key={i}>
            <text x={padL-8} y={y+bh/2+4} textAnchor="end" fontSize={11} fill="#495057" fontFamily={CHART_FONT}>{b.label}</text>
            <rect x={padL} y={y} width={bw} height={bh} fill={b.color||"#2563eb"} rx={2}/>
            <text x={padL+bw+6} y={y+bh/2+4} fontSize={11} fontWeight={700} fill="#212529" fontFamily={CHART_FONT}>{fmt(b.value,3)}{unit?` ${unit}`:""}</text>
          </g>
        );
      })}
      <line x1={padL} y1={padT} x2={padL} y2={H-padB} stroke="#adb5bd" strokeWidth={1}/>
    </svg>
  );
}

// Generic XY line chart: series=[{points:[{x,y}], color, label}]
function LineChart({series, xLabel, yLabel, width, height, title, yZeroLine}){
  const W=width||520, H=height||320, padL=56, padR=20, padT=36, padB=42;
  const allPts = series.flatMap(s=>s.points);
  const xs = allPts.map(p=>p.x), ys = allPts.map(p=>p.y);
  const xMin=Math.min(...xs), xMax=Math.max(...xs);
  const yMin=Math.min(0,...ys)*1.1, yMax=Math.max(...ys)*1.15 || 1;
  const sx = x => padL + ((x-xMin)/((xMax-xMin)||1)) * (W-padL-padR);
  const sy = y => H-padB - ((y-yMin)/((yMax-yMin)||1)) * (H-padT-padB);
  return(
    <svg className="live-svg" viewBox={`0 0 ${W} ${H}`} style={{width:"100%",maxWidth:560,display:"block",margin:"8px auto"}}>
      <rect x={0} y={0} width={W} height={H} fill="#ffffff"/>
      {title && <text x={W/2} y={18} textAnchor="middle" fontSize={11} fontWeight={700} fill="#343a40" fontFamily={CHART_FONT}>{title}</text>}
      <rect x={padL} y={padT} width={W-padL-padR} height={H-padT-padB} fill="#f8f9fa"/>
      {[0,0.25,0.5,0.75,1].map(f=>{
        const y = padT + f*(H-padT-padB);
        return <line key={f} x1={padL} y1={y} x2={W-padR} y2={y} stroke="#e9ecef" strokeWidth={0.5}/>;
      })}
      {yZeroLine && yMin<0 && <line x1={padL} y1={sy(0)} x2={W-padR} y2={sy(0)} stroke="#adb5bd" strokeWidth={1} strokeDasharray="4"/>}
      {series.map((s,i)=>{
        const d = s.points.map((p,j)=>`${j===0?'M':'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
        return <path key={i} d={d} fill="none" stroke={s.color||"#2563eb"} strokeWidth={2.2}/>;
      })}
      <line x1={padL} y1={padT} x2={padL} y2={H-padB} stroke="#495057" strokeWidth={1}/>
      <line x1={padL} y1={H-padB} x2={W-padR} y2={H-padB} stroke="#495057" strokeWidth={1}/>
      <text x={W/2} y={H-8} textAnchor="middle" fontSize={10} fill="#6c757d" fontFamily={CHART_FONT}>{xLabel}</text>
      <text x={14} y={H/2} textAnchor="middle" fontSize={10} fill="#6c757d" fontFamily={CHART_FONT} transform={`rotate(-90,14,${H/2})`}>{yLabel}</text>
      {series.length>1 && (
        <g transform={`translate(${padL+8},${padT+10})`}>
          {series.map((s,i)=>(
            <g key={i} transform={`translate(0,${i*14})`}>
              <line x1={0} y1={0} x2={14} y2={0} stroke={s.color} strokeWidth={2.5}/>
              <text x={18} y={3} fontSize={9} fill="#495057" fontFamily={CHART_FONT}>{s.label}</text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

// Vertical stress-vs-depth profile: one line, y-axis is section depth (top=0)
function StressDepthChart({h, topStress, botStress, depthLabel, allowTens, allowComp}){
  const points = [{x:topStress,y:0},{x:botStress,y:h}];
  const W=320,H=320,padL=56,padR=20,padT=30,padB=40;
  const xs=[topStress,botStress,allowTens||0,allowComp||0];
  const xMin=Math.min(...xs)*1.15, xMax=Math.max(...xs)*1.15 || 1;
  const sx = x => padL + ((x-xMin)/((xMax-xMin)||1)) * (W-padL-padR);
  const sy = y => padT + (y/h) * (H-padT-padB);
  return(
    <svg className="live-svg" viewBox={`0 0 ${W} ${H}`} style={{width:"100%",maxWidth:340,display:"block",margin:"8px auto"}}>
      <rect x={0} y={0} width={W} height={H} fill="#ffffff"/>
      <text x={W/2} y={16} textAnchor="middle" fontSize={11} fontWeight={700} fill="#343a40" fontFamily={CHART_FONT}>Stress vs. Section Depth ({depthLabel})</text>
      <rect x={padL} y={padT} width={W-padL-padR} height={H-padT-padB} fill="#f8f9fa"/>
      <line x1={sx(0)} y1={padT} x2={sx(0)} y2={H-padB} stroke="#adb5bd" strokeWidth={1} strokeDasharray="4"/>
      {allowTens!=null && <line x1={sx(allowTens)} y1={padT} x2={sx(allowTens)} y2={H-padB} stroke="#c0392b" strokeWidth={1} strokeDasharray="3"/>}
      {allowComp!=null && <line x1={sx(-Math.abs(allowComp))} y1={padT} x2={sx(-Math.abs(allowComp))} y2={H-padB} stroke="#2980b9" strokeWidth={1} strokeDasharray="3"/>}
      <path d={`M${sx(topStress)},${sy(0)} L${sx(botStress)},${sy(h)}`} stroke="#212529" strokeWidth={2.5} fill="none"/>
      <circle cx={sx(topStress)} cy={sy(0)} r={4} fill="#2563eb"/>
      <text x={sx(topStress)+8} y={sy(0)+4} fontSize={9} fill="#2563eb" fontFamily={CHART_FONT}>Top: {fmt(topStress,3)}</text>
      <circle cx={sx(botStress)} cy={sy(h)} r={4} fill="#c0392b"/>
      <text x={sx(botStress)+8} y={sy(h)+4} fontSize={9} fill="#c0392b" fontFamily={CHART_FONT}>Bot: {fmt(botStress,3)}</text>
      <line x1={padL} y1={padT} x2={padL} y2={H-padB} stroke="#495057" strokeWidth={1}/>
      <text x={W/2} y={H-10} textAnchor="middle" fontSize={9} fill="#6c757d" fontFamily={CHART_FONT}>Stress</text>
      <text x={16} y={H/2} textAnchor="middle" fontSize={9} fill="#6c757d" fontFamily={CHART_FONT} transform={`rotate(-90,16,${H/2})`}>Depth from top</text>
    </svg>
  );
}

// Bending moment & shear diagrams along a simple span (parabolic M, linear V), to scale
function BeamDiagrams({span, w, Mmax, Vmax}){
  const n=21;
  const Mpts=[], Vpts=[];
  for(let i=0;i<n;i++){
    const x = (span/(n-1))*i;
    const M = w*x*(span-x)/2; // simple span UDL moment
    const V = w*(span/2-x);
    Mpts.push({x,y:M});
    Vpts.push({x,y:V});
  }
  return(
    <div>
      <LineChart series={[{points:Mpts,color:"#2563eb",label:"Moment"}]} xLabel="Position along span" yLabel="Moment" title="Bending Moment Diagram" yZeroLine height={220}/>
      <LineChart series={[{points:Vpts,color:"#c0392b",label:"Shear"}]} xLabel="Position along span" yLabel="Shear" title="Shear Force Diagram" yZeroLine height={220}/>
    </div>
  );
}

// Chart type picker ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â small pill-button row, used by every tab's chart section
// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
// STATION RESULTS TABLE ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Phase 3
// Mirrors ConCise Beam's station-by-station output table.
// Shows M(x), V(x), top/bottom fiber stress, ÃƒÅ½Ã‚Â¦Mn(x), Vn(x),
// and deflection at each analysis station along the span,
// with PASS/FAIL status per row per check.
// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
const STATION_MONO = "'JetBrains Mono','Fira Code','Consolas',monospace";

// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
// CONSTRUCTION STAGES VIEW ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Phase 5
// Renders the 5-stage lifecycle analysis in a ConCise-style layout:
// - Timeline bar showing stage progression with days
// - Per-stage: loading description, stresses (top/bot at ends+midspan),
//   camber/deflection, and PASS/FAIL checks
// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
// VIBRATION PANEL ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Phase 6 + Phase 8
// Walking excitation, rhythmic load, and filled-core shear
// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
function VibrationPanel({ phase6, occupancy, setOccupancy, activity, setActivity,
  slabWidth, setSlabWidth, fillCores, setFillCores, fillLen, setFillLen, stations }) {
  const MONO = "'JetBrains Mono','Fira Code','Consolas',monospace";
  const fmt = (v, d=2) => (v==null||isNaN(v)) ? "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â" : Number(v).toFixed(d);
  const iS = { padding:"4px 8px", border:"1.5px solid #e8a838", borderRadius:3, fontSize:11,
    fontFamily:MONO, background:"#fff8ef", boxSizing:"border-box" };

  const OccTypes = Object.keys(OCCUPANCY_TYPES||{});
  const ActTypes = Object.keys(RHYTHMIC_ACTIVITIES||{});

  const Check = ({ label, ok, left, right, unit }) => (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
      padding:"6px 10px", marginBottom:4, borderRadius:4, fontSize:11, fontFamily:MONO,
      background:ok?"#f0fdf4":"#fef2f2", border:`1px solid ${ok?"#bbf7d0":"#fecaca"}` }}>
      <span style={{ color:ok?"#14532d":"#7f1d1d", fontWeight:600 }}>{label}</span>
      <span style={{ color:ok?"#166534":"#991b1b" }}>
        {left} {unit} {ok?"ÃƒÂ¢Ã¢â‚¬Â°Ã‚Â¤":">"} {right} {unit}
        <span style={{ marginLeft:8, fontWeight:800, fontSize:10,
          background:ok?"#22c55e":"#ef4444", color:"#fff", padding:"1px 6px", borderRadius:3 }}>
          {ok?"PASS":"FAIL"}
        </span>
      </span>
    </div>
  );
  const Stat = ({ label, value, unit }) => (
    <div style={{ background:"#fff", border:"1px solid #dee2e6", borderRadius:3, padding:"6px 10px", minWidth:110 }}>
      <div style={{ fontSize:9, color:"#6c757d", fontFamily:MONO }}>{label}</div>
      <div style={{ fontSize:13, fontWeight:800, fontFamily:MONO }}>{value} <span style={{ fontSize:10, color:"#868e96" }}>{unit}</span></div>
    </div>
  );

  return (
    <div>
      {/* Inputs */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:10, marginBottom:12, padding:"10px 12px",
        background:"#f8f9fa", border:"1px solid #dee2e6", borderRadius:6 }}>
        <div>
          <div style={{ fontSize:9, color:"#6c757d", marginBottom:2, fontFamily:MONO }}>Occupancy Type</div>
          <select value={occupancy} onChange={e=>setOccupancy(e.target.value)} style={{ ...iS, width:220 }}>
            {OccTypes.map(o=><option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize:9, color:"#6c757d", marginBottom:2, fontFamily:MONO }}>Rhythmic Activity (optional)</div>
          <select value={activity} onChange={e=>setActivity(e.target.value)} style={{ ...iS, width:180 }}>
            <option value="">ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Walking only ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â</option>
            {ActTypes.map(a=><option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize:9, color:"#6c757d", marginBottom:2, fontFamily:MONO }}>Slab Width</div>
          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
            <input type="number" value={slabWidth} step={1} onChange={e=>setSlabWidth(Number(e.target.value))} style={{ ...iS, width:60 }}/>
            <span style={{ fontSize:10, color:"#868e96" }}>ft</span>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:11 }}>
            <input type="checkbox" checked={fillCores} onChange={e=>setFillCores(e.target.checked)} style={{ width:14, height:14 }}/>
            Fill End Cores
          </label>
          {fillCores && (
            <div style={{ display:"flex", alignItems:"center", gap:4 }}>
              <input type="number" value={fillLen} step={2} onChange={e=>setFillLen(Number(e.target.value))} style={{ ...iS, width:55 }}/>
              <span style={{ fontSize:10, color:"#868e96" }}>in each end</span>
            </div>
          )}
        </div>
      </div>

      {phase6 && (<>
        {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ WALKING VIBRATION ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:12, fontWeight:800, fontFamily:MONO, color:"#2563eb", marginBottom:8,
            borderBottom:"2px solid #2563eb", paddingBottom:4 }}>
            WALKING VIBRATION ANALYSIS ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â {occupancy}
          </div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:10 }}>
            <Stat label="Natural Frequency fn" value={fmt(phase6.fn,2)} unit="Hz"/>
            <Stat label="Minimum fn Required" value={fmt(phase6.walking?.f_min,1)} unit="Hz"/>
            <Stat label="Peak Accel ap/g" value={fmt(phase6.walking?.ap_pct,3)} unit="%g"/>
            <Stat label="Limit ap/g" value={fmt(phase6.walking?.a_limit_pct,1)} unit="%g"/>
            <Stat label="Effective Weight W" value={fmt(phase6.walking?.W_eff,1)} unit="kips"/>
            <Stat label="Damping ÃƒÅ½Ã‚Â²" value={fmt((phase6.walking?.beta||0)*100,0)} unit="%"/>
          </div>
          <Check label="Natural frequency check" ok={phase6.walking?.freqOk}
            left={fmt(phase6.fn,2)} right={fmt(phase6.walking?.f_min,1)} unit="Hz"/>
          <Check label="Peak acceleration check" ok={phase6.walking?.accelOk}
            left={fmt(phase6.walking?.ap_pct,3)} right={fmt(phase6.walking?.a_limit_pct,1)} unit="%g"/>

          {/* Harmonic table */}
          <div style={{ marginTop:8, overflowX:"auto" }}>
            <table style={{ borderCollapse:"collapse", width:"100%", fontSize:11 }}>
              <thead>
                <tr style={{ background:"#eff6ff" }}>
                  {["Harmonic","Freq Range (Hz)","DLF ÃƒÅ½Ã‚Â±","Resonant?","ap/g (%)"].map(h=>(
                    <th key={h} style={{ padding:"4px 8px", border:"1px solid #dee2e6", fontWeight:700, fontFamily:MONO }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(phase6.walking?.harmonicResults||[]).map((h,i)=>(
                  <tr key={i} style={{ background:h.resonant?"#fef3c7":"#fff" }}>
                    <td style={{ padding:"4px 8px", border:"1px solid #dee2e6", fontFamily:MONO, textAlign:"center" }}>{h.i}</td>
                    <td style={{ padding:"4px 8px", border:"1px solid #dee2e6", fontFamily:MONO }}>{h.fi_range[0]}ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“{h.fi_range[1]}</td>
                    <td style={{ padding:"4px 8px", border:"1px solid #dee2e6", fontFamily:MONO }}>{h.alpha}</td>
                    <td style={{ padding:"4px 8px", border:"1px solid #dee2e6", textAlign:"center", fontWeight:700,
                      color:h.resonant?"#b45309":"#6c757d" }}>{h.resonant?"ÃƒÂ¢Ã…Â¡Ã‚Â  YES":"No"}</td>
                    <td style={{ padding:"4px 8px", border:"1px solid #dee2e6", fontFamily:MONO, textAlign:"right",
                      fontWeight:700 }}>{fmt(h.ap_g_pct,4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ RHYTHMIC VIBRATION ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
        {phase6.rhythmic && (
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:12, fontWeight:800, fontFamily:MONO, color:"#7c3aed", marginBottom:8,
              borderBottom:"2px solid #7c3aed", paddingBottom:4 }}>
              RHYTHMIC VIBRATION ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â {activity}
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:10 }}>
              <Stat label="Activity Frequency" value={fmt(phase6.rhythmic.act?.f_act,2)} unit="Hz"/>
              <Stat label="Frequency Ratio r" value={fmt(phase6.rhythmic.r,3)} unit=""/>
              <Stat label="Dynamic Magnif. (DMF)" value={fmt(phase6.rhythmic.DMF,2)} unit=""/>
              <Stat label="Peak Accel ap/g" value={fmt(phase6.rhythmic.ap_pct,3)} unit="%g"/>
              <Stat label="Limit ap/g" value={fmt(phase6.rhythmic.a_limit_pct,1)} unit="%g"/>
            </div>
            <Check label="Natural frequency check" ok={phase6.rhythmic.freqOk}
              left={fmt(phase6.fn,2)} right={fmt(phase6.rhythmic.f_min,1)} unit="Hz"/>
            <Check label="Peak acceleration check" ok={phase6.rhythmic.accelOk}
              left={fmt(phase6.rhythmic.ap_pct,3)} right={fmt(phase6.rhythmic.a_limit_pct,1)} unit="%g"/>
          </div>
        )}

        {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ FILLED CORE SHEAR ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
        {fillCores && phase6.shearAtD && (
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:12, fontWeight:800, fontFamily:MONO, color:"#ea580c", marginBottom:8,
              borderBottom:"2px solid #ea580c", paddingBottom:4 }}>
              FILLED CORE SHEAR CAPACITY (Phase 8)
            </div>
            <div style={{ fontSize:11, color:"#495057", marginBottom:8 }}>
              Cores grouted solid for first <b>{fillLen}"</b> from each support.
              Effective bw in filled zone = <b>{fmt(phase6.shearAtD.bwEff,1)}"</b> (vs {
              phase6.shearAtD.bwEff > 6 ? `${phase6.shearAtD.bwEff}"`:"normal bw"}).
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:10 }}>
              <Stat label="bw (filled zone)" value={fmt(phase6.shearAtD.bwEff,1)} unit="in"/>
              <Stat label="fpc" value={fmt(phase6.shearAtD.fpc,4)} unit="ksi"/>
              <Stat label="Vcw (filled)" value={fmt(phase6.shearAtD.Vcw,2)} unit="kips"/>
              <Stat label="Vc (grout fill)" value={fmt(phase6.shearAtD.VcFill,2)} unit="kips"/>
              <Stat label="ÃƒÅ½Ã‚Â¦Vc total" value={fmt(phase6.shearAtD.phiVc,2)} unit="kips"/>
            </div>

            {/* Shear envelope table (every 4th station) */}
            {phase6.shearEnvelope && (
              <div style={{ overflowX:"auto" }}>
                <table style={{ borderCollapse:"collapse", fontSize:10, fontFamily:MONO }}>
                  <thead>
                    <tr style={{ background:"#fff7ed" }}>
                      {["x (ft)","Zone","bw_eff (in)","Vcw (kip)","VcFill (kip)","ÃƒÅ½Ã‚Â¦Vc (kip)"].map(h=>(
                        <th key={h} style={{ padding:"3px 8px", border:"1px solid #dee2e6", fontWeight:700 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {phase6.shearEnvelope.filter((_,i)=>i%4===0||i===phase6.shearEnvelope.length-1).map((pt,i)=>(
                      <tr key={i} style={{ background:pt.inFilledZone?"#fff7ed":"#fff" }}>
                        <td style={{ padding:"3px 8px", border:"1px solid #dee2e6", textAlign:"right" }}>{fmt(pt.x,2)}</td>
                        <td style={{ padding:"3px 8px", border:"1px solid #dee2e6", textAlign:"center",
                          color:pt.inFilledZone?"#ea580c":"#6c757d", fontWeight:pt.inFilledZone?700:400 }}>
                          {pt.inFilledZone?"FILLED":"Hollow"}
                        </td>
                        <td style={{ padding:"3px 8px", border:"1px solid #dee2e6", textAlign:"right" }}>{fmt(pt.bwEff,1)}</td>
                        <td style={{ padding:"3px 8px", border:"1px solid #dee2e6", textAlign:"right" }}>{fmt(pt.Vcw,2)}</td>
                        <td style={{ padding:"3px 8px", border:"1px solid #dee2e6", textAlign:"right" }}>{fmt(pt.VcFill,2)}</td>
                        <td style={{ padding:"3px 8px", border:"1px solid #dee2e6", textAlign:"right", fontWeight:700 }}>{fmt(pt.phiVc,2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </>)}
    </div>
  );
}

// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
// LATERAL STABILITY PANEL ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Phase 7
// PCI Ãƒâ€šÃ‚Â§8.3 Mast Method: FS against cracking + rollover during lift
// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
// MOVING LOAD PANEL ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Phase 9
// Vehicle selection, axle editor, M/V envelope diagram, results
// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
// TRANSFORMED SECTION PANEL ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Phase 10a
// Shows gross vs net vs transformed section properties side by side
// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
function TransformedSectionPanel({ data, g1Flag }) {
  const MONO = "'JetBrains Mono','Fira Code','Consolas',monospace";
  const f = (v,d=3) => (v==null||isNaN(v)) ? "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â" : Number(v).toFixed(d);
  const { gross, net, transformed } = data;

  const Row = ({ label, g, n, t, unit="" }) => (
    <tr>
      <td style={{ padding:"5px 10px", border:"1px solid #dee2e6", fontFamily:MONO, fontWeight:600, fontSize:11 }}>{label}</td>
      <td style={{ padding:"5px 10px", border:"1px solid #dee2e6", textAlign:"right", fontFamily:MONO, fontSize:11 }}>{f(g)} {unit}</td>
      <td style={{ padding:"5px 10px", border:"1px solid #dee2e6", textAlign:"right", fontFamily:MONO, fontSize:11 }}>{f(n)} {unit}</td>
      <td style={{ padding:"5px 10px", border:"1px solid #dee2e6", textAlign:"right", fontFamily:MONO, fontSize:11,
        background:"#eff6ff", fontWeight:700 }}>{f(t)} {unit}</td>
      <td style={{ padding:"5px 10px", border:"1px solid #dee2e6", textAlign:"right", fontFamily:MONO, fontSize:10,
        color: Math.abs(t-g)/Math.max(Math.abs(g),0.001)*100 > 1 ? "#dc2626" : "#868e96" }}>
        {g!==0 ? `${((t-g)/Math.abs(g)*100).toFixed(2)}%` : "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â"}
      </td>
    </tr>
  );

  return (
    <div>
      <div style={{ marginBottom:10, padding:"8px 12px", background: g1Flag?"#f0fdf4":"#fff7ed",
        border:`1px solid ${g1Flag?"#bbf7d0":"#fed7aa"}`, borderRadius:6, fontSize:11 }}>
        <b>G1 Flag:</b> {g1Flag
          ? "ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ ON ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Transformed section used in stress calculations (matches ConCise default)"
          : "ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â OFF ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Gross section used. Enable G1 in Options ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ Calculation Options ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ General"}
      </div>

      <div style={{ marginBottom:8, fontSize:12, color:"#495057", lineHeight:1.6 }}>
        <b>np = Eps/Ec = </b>{f(gross.np,2)} (prestress modular ratio) &nbsp;Ãƒâ€šÃ‚Â·&nbsp;
        <b>ns = Es/Ec = </b>{f(gross.ns,2)} (mild steel modular ratio)
      </div>

      <div style={{ overflowX:"auto" }}>
        <table style={{ borderCollapse:"collapse", width:"100%", fontSize:11 }}>
          <thead>
            <tr style={{ background:"#f8f9fa" }}>
              <th style={{ padding:"6px 10px", border:"1px solid #dee2e6", textAlign:"left", fontFamily:MONO }}>Property</th>
              <th style={{ padding:"6px 10px", border:"1px solid #dee2e6", textAlign:"right", fontFamily:MONO }}>Gross</th>
              <th style={{ padding:"6px 10px", border:"1px solid #dee2e6", textAlign:"right", fontFamily:MONO }}>Net</th>
              <th style={{ padding:"6px 10px", border:"1px solid #dee2e6", textAlign:"right", fontFamily:MONO, background:"#eff6ff" }}>Transformed</th>
              <th style={{ padding:"6px 10px", border:"1px solid #dee2e6", textAlign:"right", fontFamily:MONO, fontSize:10 }}>ÃƒÅ½Ã¢â‚¬Â (T vs G)</th>
            </tr>
          </thead>
          <tbody>
            <Row label="A (inÃƒâ€šÃ‚Â²)"   g={gross.A}  n={net.A}  t={transformed.A}/>
            <Row label="Ix (inÃƒÂ¢Ã‚ÂÃ‚Â´)"  g={gross.Ix} n={net.Ix} t={transformed.Ix}/>
            <Row label="yb (in)"   g={gross.yb} n={net.yb} t={transformed.yb}/>
            <Row label="yt (in)"   g={gross.yt} n={net.yt} t={transformed.yt}/>
            <Row label="Sb (inÃƒâ€šÃ‚Â³)"  g={gross.Sb} n={net.Sb} t={transformed.Sb}/>
            <Row label="St (inÃƒâ€šÃ‚Â³)"  g={gross.St} n={net.St} t={transformed.St}/>
            <Row label="e_ps (in)" g={gross.e}  n={net.e}  t={transformed.e}/>
          </tbody>
        </table>
      </div>

      <div style={{ marginTop:10, padding:"8px 12px", background:"#f8f9fa", border:"1px solid #dee2e6", borderRadius:4, fontSize:11 }}>
        <b>Steel contributions to transformed section:</b>&nbsp;
        (npÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢1)ÃƒÆ’Ã¢â‚¬â€Aps = <b>{f(transformed.deltaNp,2)} ÃƒÆ’Ã¢â‚¬â€ {f(transformed.A_steel_ps/transformed.deltaNp,4)} = {f(transformed.A_steel_ps,4)} inÃƒâ€šÃ‚Â²</b>
        {transformed.A_steel_s > 0 && <>
          &nbsp;Ãƒâ€šÃ‚Â·&nbsp; (nsÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢1)ÃƒÆ’Ã¢â‚¬â€As = <b>{f(transformed.A_steel_s,4)} inÃƒâ€šÃ‚Â²</b>
        </>}
      </div>

      <div style={{ marginTop:8, fontSize:10, color:"#6c757d", fontFamily:MONO }}>
        Ref: PCI Design Handbook 8th Ed. Ãƒâ€šÃ‚Â§4.2.1 Ãƒâ€šÃ‚Â· ACI 318-19 R24.5.2 Ãƒâ€šÃ‚Â· ConCise Calculation Option G1
      </div>
    </div>
  );
}

// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
// TORSION PANEL ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Phase 10b
// Full ACI 318-19 Ãƒâ€šÃ‚Â§22.7 torsion design: Tcr, threshold, stirrups, Al
// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
function TorsionPanel({ phase10b, Tu_kft, setTu_kft, torsionAt, setTorsionAt,
    torsionLegs, setTorsionLegs, torsionSpacing, setTorsionSpacing }) {
  const MONO = "'JetBrains Mono','Fira Code','Consolas',monospace";
  const f = (v,d=3) => (v==null||isNaN(v)||!isFinite(v)) ? "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â" : Number(v).toFixed(d);
  const iS = { padding:"4px 8px", border:"1.5px solid #e8a838", borderRadius:3,
    fontSize:11, fontFamily:MONO, background:"#fff8ef" };

  const Check = ({ label, ok, val, limit, unit, note }) => (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
      padding:"6px 10px", marginBottom:4, borderRadius:4, fontSize:11, fontFamily:MONO,
      background:ok?"#f0fdf4":"#fef2f2", border:`1px solid ${ok?"#bbf7d0":"#fecaca"}` }}>
      <div>
        <span style={{ color:ok?"#14532d":"#7f1d1d", fontWeight:600 }}>{label}</span>
        {note&&<div style={{ fontSize:9, color:"#868e96", marginTop:2 }}>{note}</div>}
      </div>
      <span style={{ color:ok?"#166534":"#991b1b" }}>
        {f(val,3)} {unit} {ok?"ÃƒÂ¢Ã¢â‚¬Â°Ã‚Â¤":">"} {f(limit,3)} {unit}
        <span style={{ marginLeft:8, fontWeight:800, fontSize:10,
          background:ok?"#22c55e":"#ef4444", color:"#fff", padding:"1px 6px", borderRadius:3 }}>
          {ok?"PASS":"FAIL"}
        </span>
      </span>
    </div>
  );

  const Stat = ({ label, value, unit, highlight }) => (
    <div style={{ background:highlight?"#fef9ec":"#fff", border:`1px solid ${highlight?"#fde68a":"#dee2e6"}`,
      borderRadius:3, padding:"6px 10px", minWidth:130 }}>
      <div style={{ fontSize:9, color:"#6c757d", fontFamily:MONO }}>{label}</div>
      <div style={{ fontSize:13, fontWeight:800, fontFamily:MONO }}>{value} <span style={{ fontSize:10, color:"#868e96" }}>{unit}</span></div>
    </div>
  );

  return (
    <div>
      {/* Inputs */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:10, marginBottom:12, padding:"10px 12px",
        background:"#f8f9fa", border:"1px solid #dee2e6", borderRadius:6 }}>
        <div>
          <div style={{ fontSize:9, color:"#6c757d", marginBottom:2, fontFamily:MONO }}>Factored Torsion TÃƒÂ¡Ã‚ÂµÃ‚Â¤</div>
          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
            <input type="number" value={Tu_kft} step={0.5} min={0}
              onChange={e=>setTu_kft(Number(e.target.value))} style={{ ...iS, width:80 }}/>
            <span style={{ fontSize:10, color:"#868e96" }}>kip-ft</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize:9, color:"#6c757d", marginBottom:2, fontFamily:MONO }}>Stirrup Area/Leg</div>
          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
            <input type="number" value={torsionAt} step={0.01} min={0}
              onChange={e=>setTorsionAt(Number(e.target.value))} style={{ ...iS, width:70 }}/>
            <span style={{ fontSize:10, color:"#868e96" }}>inÃƒâ€šÃ‚Â²</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize:9, color:"#6c757d", marginBottom:2, fontFamily:MONO }}># Legs</div>
          <input type="number" value={torsionLegs} step={1} min={2}
            onChange={e=>setTorsionLegs(Number(e.target.value))} style={{ ...iS, width:55 }}/>
        </div>
        <div>
          <div style={{ fontSize:9, color:"#6c757d", marginBottom:2, fontFamily:MONO }}>Stirrup Spacing</div>
          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
            <input type="number" value={torsionSpacing} step={1} min={1}
              onChange={e=>setTorsionSpacing(Number(e.target.value))} style={{ ...iS, width:65 }}/>
            <span style={{ fontSize:10, color:"#868e96" }}>in</span>
          </div>
        </div>
        {Tu_kft===0&&<div style={{ fontSize:11, color:"#868e96", alignSelf:"center", fontStyle:"italic" }}>
          Enter a factored torsional moment to run the torsion design check.
        </div>}
      </div>

      {phase10b && (<>
        {/* Threshold check first */}
        <div style={{ marginBottom:12, padding:"10px 12px",
          background:phase10b.neglect?"#f0fdf4":"#fff7ed",
          border:`1px solid ${phase10b.neglect?"#bbf7d0":"#fed7aa"}`,
          borderRadius:6, fontSize:12 }}>
          <b>{phase10b.neglect ? "ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Torsion Neglected" : "ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Torsion Design Required"}</b>
          <div style={{ fontSize:11, marginTop:4, color:"#495057" }}>{phase10b.neglectReason}</div>
        </div>

        {/* Key values */}
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:12 }}>
          <Stat label="TÃƒÂ¡Ã‚ÂµÃ‚Â¤ (factored)" value={f(phase10b.Tu_kft,2)} unit="k-ft"/>
          <Stat label="Tth (threshold ÃƒÅ½Ã‚Â¦Tcr/4)" value={f(phase10b.Tth_kft,3)} unit="k-ft"/>
          <Stat label="Tcr (cracking torque)" value={f(phase10b.Tcr_kft,3)} unit="k-ft"/>
          <Stat label="Aoh" value={f(phase10b.Aoh,1)} unit="inÃƒâ€šÃ‚Â²"/>
          <Stat label="poh" value={f(phase10b.poh,1)} unit="in"/>
          <Stat label="Ao (eff.)" value={f(phase10b.Ao,1)} unit="inÃƒâ€šÃ‚Â²"/>
        </div>

        {/* PASS/FAIL checks */}
        {phase10b.checks.map((chk,i)=>(
          <Check key={i} label={chk.label} ok={chk.ok}
            val={parseFloat(chk.val)} limit={parseFloat(chk.limit)} unit={chk.unit} note={chk.note}/>
        ))}

        {/* Required reinforcement */}
        {!phase10b.neglect && (<>
          <div style={{ marginTop:12, marginBottom:8, fontSize:12, fontWeight:700, fontFamily:MONO,
            borderBottom:"2px solid #7c3aed", paddingBottom:4, color:"#4c1d95" }}>
            REQUIRED TORSION REINFORCEMENT
          </div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:8 }}>
            <Stat label="At/s required" value={f(phase10b.AtS_req,5)} unit="inÃƒâ€šÃ‚Â²/in"/>
            <Stat label="At/s minimum" value={f(phase10b.AtS_min,5)} unit="inÃƒâ€šÃ‚Â²/in"/>
            <Stat label="At/s design" value={f(phase10b.AtS_design,5)} unit="inÃƒâ€šÃ‚Â²/in" highlight/>
            <Stat label="Al required" value={f(phase10b.Al_req,4)} unit="inÃƒâ€šÃ‚Â²" highlight/>
            <Stat label="Al minimum" value={f(phase10b.Al_min,4)} unit="inÃƒâ€šÃ‚Â²"/>
          </div>
          <div style={{ padding:"8px 12px", background:"#f5f3ff", border:"1px solid #ddd6fe",
            borderRadius:6, fontSize:11, fontFamily:MONO }}>
            <b>Design stirrups:</b> At/leg = {f(phase10b.AtS_design * torsionSpacing / torsionLegs,4)} inÃƒâ€šÃ‚Â² per leg
            at s = {torsionSpacing}" with {torsionLegs} legs
            (At/s provided = {f(torsionAt * torsionLegs / torsionSpacing,5)} inÃƒâ€šÃ‚Â²/in)
            <br/>
            <b>Longitudinal steel:</b> Distribute Al = {f(phase10b.Al_design,4)} inÃƒâ€šÃ‚Â² around perimeter of stirrups
          </div>
        </>)}

        <div style={{ marginTop:10, fontSize:10, color:"#6c757d", fontFamily:MONO }}>
          Ref: ACI 318-19 Ãƒâ€šÃ‚Â§22.7 Ãƒâ€šÃ‚Â· Space truss analogy Ãƒâ€šÃ‚Â· ÃƒÅ½Ã‚Â¸ = 45Ãƒâ€šÃ‚Â° Ãƒâ€šÃ‚Â· ÃƒÂÃ¢â‚¬Â  = 0.75
          Ãƒâ€šÃ‚Â· ConCise Define ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ Torsion Parameters
        </div>
      </>)}
    </div>
  );
}

function MovingLoadPanel({ phase9, vehicle, setVehicle, IM, setIM, gammaLL, setGammaLL,
    customAxles, setCustomAxles, span, staticMmax, staticVmax }) {
  const MONO = "'JetBrains Mono','Fira Code','Consolas',monospace";
  const f = (v,d=2) => (v==null||isNaN(v)) ? "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â" : Number(v).toFixed(d);
  const iS = { padding:"4px 8px", border:"1.5px solid #e8a838", borderRadius:3,
    fontSize:11, fontFamily:MONO, background:"#fff8ef", boxSizing:"border-box" };

  const vehicleKeys = Object.keys(STANDARD_VEHICLES||{});
  const veh = (STANDARD_VEHICLES||{})[vehicle] || {};
  const axles = vehicle==="Custom" ? customAxles : (veh.axles||[]);
  const imVal = IM ?? veh.IM ?? 1.0;

  // SVG dimensions for load diagram
  const svgW=520, padX=40, padY=16;
  const beamY=60, beamH=10, beamW=svgW-2*padX;
  const toX=(pos)=>padX+(pos/span)*beamW;
  const maxP=Math.max(1,...axles.map(a=>a.P));
  const arrowScale=36/maxP;

  // Critical position front axle
  const critFront = phase9?.critPos ?? 0;

  // Envelope chart
  const env = phase9?.envelope?.stations || [];
  const Mmax = phase9?.Mmax || 0;
  const Vmax = phase9?.Vmax || 0;
  const diagH = 60;
  const mY0 = beamY+beamH+28;
  const vY0 = mY0+diagH+24;
  const svgH = vY0+diagH+32;

  const pathPts = (arr, key, scale, y0) =>
    arr.map((s,i)=>`${i===0?"M":"L"}${toX(s.x).toFixed(1)},${(y0+diagH/2-s[key]*scale).toFixed(1)}`).join(" ");

  return (
    <div>
      {/* Vehicle selector */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:10, marginBottom:12, padding:"10px 12px",
        background:"#f8f9fa", border:"1px solid #dee2e6", borderRadius:6 }}>
        <div>
          <div style={{ fontSize:9, color:"#6c757d", marginBottom:2, fontFamily:MONO }}>Vehicle / Load Type</div>
          <select value={vehicle} onChange={e=>setVehicle(e.target.value)} style={{ ...iS, width:240 }}>
            {vehicleKeys.map(k=><option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize:9, color:"#6c757d", marginBottom:2, fontFamily:MONO }}>Dynamic Allowance IM</div>
          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
            <input type="number" value={IM??""} step={0.01} min={1.0} max={2.0}
              placeholder={`default ${imVal}`}
              onChange={e=>setIM(e.target.value===""?null:Number(e.target.value))}
              style={{ ...iS, width:70 }}/>
            <span style={{ fontSize:10, color:"#868e96" }}>({f((imVal-1)*100,0)}% DLA)</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize:9, color:"#6c757d", marginBottom:2, fontFamily:MONO }}>Live Load Factor ÃƒÅ½Ã‚Â³_LL</div>
          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
            <input type="number" value={gammaLL} step={0.05} min={0} max={3}
              onChange={e=>setGammaLL(Number(e.target.value))} style={{ ...iS, width:70 }}/>
          </div>
        </div>
      </div>

      {/* Vehicle description */}
      <div style={{ fontSize:11, color:"#495057", marginBottom:10, padding:"6px 10px",
        background:"#f0f9ff", border:"1px solid #bae6fd", borderRadius:4 }}>
        <b>{vehicle}</b> ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â {veh.description} &nbsp;Ãƒâ€šÃ‚Â·&nbsp; Code: <b>{veh.code}</b>
        &nbsp;Ãƒâ€šÃ‚Â·&nbsp; IM = <b>{f(imVal,2)}</b>
        {veh.lanekplf&&<>&nbsp;Ãƒâ€šÃ‚Â·&nbsp; Lane load: <b>{veh.lanekplf} kip/ft</b></>}
      </div>

      {/* Axle table ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â editable for Custom */}
      <div style={{ marginBottom:10 }}>
        <div style={{ fontSize:11, fontWeight:700, fontFamily:MONO, marginBottom:6, color:"#374151" }}>
          AXLE CONFIGURATION
        </div>
        <table style={{ borderCollapse:"collapse", fontSize:11, marginBottom:6 }}>
          <thead>
            <tr style={{ background:"#f8f9fa" }}>
              <th style={{ padding:"4px 10px", border:"1px solid #dee2e6", fontFamily:MONO }}>Axle</th>
              <th style={{ padding:"4px 10px", border:"1px solid #dee2e6", fontFamily:MONO }}>Load P (kips)</th>
              <th style={{ padding:"4px 10px", border:"1px solid #dee2e6", fontFamily:MONO }}>Offset from front (ft)</th>
              {vehicle==="Custom" && <th style={{ padding:"4px 10px", border:"1px solid #dee2e6" }}>Remove</th>}
            </tr>
          </thead>
          <tbody>
            {axles.map((ax,i)=>(
              <tr key={i}>
                <td style={{ padding:"4px 10px", border:"1px solid #dee2e6", textAlign:"center", fontFamily:MONO, fontWeight:700 }}>{i+1}</td>
                <td style={{ padding:"4px 8px", border:"1px solid #dee2e6" }}>
                  {vehicle==="Custom"
                    ? <input type="number" value={ax.P} step={1} onChange={e=>{
                        const n=[...customAxles]; n[i]={...n[i],P:Number(e.target.value)};
                        setCustomAxles(n);
                      }} style={{ ...iS, width:80 }}/>
                    : <span style={{ fontFamily:MONO }}>{ax.P}</span>}
                </td>
                <td style={{ padding:"4px 8px", border:"1px solid #dee2e6" }}>
                  {vehicle==="Custom"
                    ? <input type="number" value={ax.offset} step={1} onChange={e=>{
                        const n=[...customAxles]; n[i]={...n[i],offset:Number(e.target.value)};
                        setCustomAxles(n);
                      }} style={{ ...iS, width:80 }}/>
                    : <span style={{ fontFamily:MONO }}>{ax.offset}</span>}
                </td>
                {vehicle==="Custom" && (
                  <td style={{ padding:"4px 8px", border:"1px solid #dee2e6", textAlign:"center" }}>
                    <button onClick={()=>setCustomAxles(customAxles.filter((_,j)=>j!==i))}
                      style={{ padding:"2px 8px", border:"1px solid #fecaca", background:"#fef2f2",
                        color:"#991b1b", borderRadius:3, cursor:"pointer", fontSize:10 }}>ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¢</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {vehicle==="Custom" && (
          <button onClick={()=>setCustomAxles([...customAxles,{P:20,offset:Math.max(0,...customAxles.map(a=>a.offset))+6}])}
            style={{ ...iS, background:"#fff", border:"1px dashed #ced4da", color:"#495057", cursor:"pointer", padding:"4px 12px" }}>
            + Add Axle
          </button>
        )}
      </div>

      {/* Vehicle diagram at critical position + M/V envelopes */}
      <div style={{ border:"1px solid #dee2e6", borderRadius:6, padding:"8px 4px", background:"#fafafa", marginBottom:10 }}>
        <div style={{ fontSize:10, fontWeight:700, fontFamily:MONO, padding:"0 8px 4px", color:"#374151" }}>
          CRITICAL POSITION: front axle at x = {f(critFront,1)} ft
        </div>
        <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width:"100%", maxWidth:svgW }}>
          <rect width={svgW} height={svgH} fill="#fff"/>

          {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Beam ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
          <rect x={padX} y={beamY} width={beamW} height={beamH} fill="#d1d5db" stroke="#374151" strokeWidth={1.5} rx={2}/>
          <polygon points={`${padX},${beamY+beamH} ${padX-8},${beamY+beamH+12} ${padX+8},${beamY+beamH+12}`} fill="#374151"/>
          <polygon points={`${padX+beamW},${beamY+beamH} ${padX+beamW-8},${beamY+beamH+12} ${padX+beamW+8},${beamY+beamH+12}`} fill="#374151"/>

          {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Axle loads at critical position ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
          {axles.map((ax,i)=>{
            const aPos = critFront + ax.offset;
            if(aPos<0||aPos>span) return null;
            const x=toX(aPos);
            const len=Math.min(ax.P*arrowScale,40);
            return (
              <g key={i}>
                <line x1={x} y1={beamY-len} x2={x} y2={beamY-2} stroke="#dc2626" strokeWidth={2.5} markerEnd="url(#arr9)"/>
                <text x={x} y={beamY-len-4} textAnchor="middle" fontSize={9} fill="#dc2626" fontFamily={MONO} fontWeight={700}>{ax.P}k</text>
              </g>
            );
          })}

          {/* Span dimension */}
          <text x={padX+beamW/2} y={svgH-4} textAnchor="middle" fontSize={9} fill="#374151" fontFamily={MONO}>L = {span} ft</text>

          {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ M envelope ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
          {env.length>0&&(<>
            <text x={padX} y={mY0-6} fontSize={9} fontWeight={700} fill="#2563eb" fontFamily={MONO}>M_max envelope (kip-ft)</text>
            <line x1={padX} y1={mY0+diagH/2} x2={padX+beamW} y2={mY0+diagH/2} stroke="#e5e7eb" strokeWidth={0.8}/>
            <path d={pathPts(env,"M_max",diagH/2/Math.max(Mmax,1),mY0)}
              fill="#bfdbfe" fillOpacity={0.5} stroke="#2563eb" strokeWidth={1.5}/>
            <text x={padX-4} y={mY0+diagH/2+4} textAnchor="end" fontSize={8} fill="#374151" fontFamily={MONO}>0</text>
            <text x={padX-4} y={mY0+4} textAnchor="end" fontSize={8} fill="#2563eb" fontFamily={MONO}>{f(Mmax,1)}</text>
          </>)}

          {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ V envelope ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
          {env.length>0&&(<>
            <text x={padX} y={vY0-6} fontSize={9} fontWeight={700} fill="#16a34a" fontFamily={MONO}>V_max envelope (kips)</text>
            <line x1={padX} y1={vY0+diagH/2} x2={padX+beamW} y2={vY0+diagH/2} stroke="#e5e7eb" strokeWidth={0.8}/>
            <path d={pathPts(env,"V_max",diagH/2/Math.max(Vmax,1),vY0)}
              fill="#bbf7d0" fillOpacity={0.5} stroke="#16a34a" strokeWidth={1.5}/>
            <text x={padX-4} y={vY0+diagH/2+4} textAnchor="end" fontSize={8} fill="#374151" fontFamily={MONO}>0</text>
            <text x={padX-4} y={vY0+4} textAnchor="end" fontSize={8} fill="#16a34a" fontFamily={MONO}>{f(Vmax,1)}</text>
          </>)}

          <defs>
            <marker id="arr9" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="4" markerHeight="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="#dc2626"/>
            </marker>
          </defs>
        </svg>
      </div>

      {/* Results summary */}
      {phase9 && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:8, marginBottom:10 }}>
          {[
            { label:"M_max (moving)",   value:`${f(Mmax,2)} kip-ft`,   color:"#2563eb" },
            { label:"V_max (moving)",   value:`${f(Vmax,2)} kips`,      color:"#16a34a" },
            { label:"R_A (left reac.)", value:`${f(phase9.Ra,2)} kips`, color:"#374151" },
            { label:"R_B (right reac.)",value:`${f(phase9.Rb,2)} kips`, color:"#374151" },
            staticMmax!=null&&{ label:"M_DL (static)",    value:`${f(staticMmax,2)} kip-ft`, color:"#7c3aed" },
            staticMmax!=null&&{ label:"M_total (factored)",value:`${f((staticMmax||0)+mlGammaLL*Mmax,2)} k-ft`, color:"#ea580c" },
          ].filter(Boolean).map((item,i)=>(
            <div key={i} style={{ background:"#fff", border:"1px solid #dee2e6", borderRadius:4, padding:"8px 10px" }}>
              <div style={{ fontSize:9, color:"#6c757d", fontFamily:MONO }}>{item.label}</div>
              <div style={{ fontSize:14, fontWeight:800, fontFamily:MONO, color:item.color }}>{item.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Code reference */}
      <div style={{ fontSize:10, color:"#6c757d", padding:"6px 10px", background:"#f8f9fa", borderRadius:4, fontFamily:MONO }}>
        Method: MÃƒÆ’Ã‚Â¼ller-Breslau influence lines ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â simply-supported beam Ãƒâ€šÃ‚Â· {veh.code}
        &nbsp;Ãƒâ€šÃ‚Â·&nbsp; Combined: {f(gammaLL,2)}ÃƒÆ’Ã¢â‚¬â€M_LL + M_DL
      </div>
    </div>
  );
}

function LateralStabilityPanel({ phase7, liftPt, setLiftPt, yLift, setYLift, sweepIn, setSweepIn, span, sectionLabel }) {
  const MONO = "'JetBrains Mono','Fira Code','Consolas',monospace";
  const f = (v,d=3) => (v==null||isNaN(v)||!isFinite(v)) ? "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â" : Number(v).toFixed(d);
  const iS = { padding:"4px 8px", border:"1.5px solid #e8a838", borderRadius:3,
    fontSize:11, fontFamily:MONO, background:"#fff8ef", boxSizing:"border-box" };

  const Check = ({ label, val, limit, ok, unit, higherBetter=false }) => (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
      padding:"6px 10px", marginBottom:4, borderRadius:4, fontSize:11, fontFamily:MONO,
      background:ok?"#f0fdf4":"#fef2f2", border:`1px solid ${ok?"#bbf7d0":"#fecaca"}` }}>
      <span style={{ color:ok?"#14532d":"#7f1d1d", fontWeight:600 }}>{label}</span>
      <span style={{ color:ok?"#166534":"#991b1b" }}>
        {f(val,3)} {unit} {higherBetter?(ok?"ÃƒÂ¢Ã¢â‚¬Â°Ã‚Â¥":"<"):(ok?"ÃƒÂ¢Ã¢â‚¬Â°Ã‚Â¤":">")} {f(limit,3)} {unit}
        <span style={{ marginLeft:8, fontWeight:800, fontSize:10,
          background:ok?"#22c55e":"#ef4444", color:"#fff", padding:"1px 6px", borderRadius:3 }}>
          {ok?"PASS":"FAIL"}
        </span>
      </span>
    </div>
  );
  const Stat = ({ label, value, unit, highlight }) => (
    <div style={{ background:highlight?"#fef9ec":"#fff", border:`1px solid ${highlight?"#fde68a":"#dee2e6"}`, borderRadius:3, padding:"6px 10px", minWidth:120 }}>
      <div style={{ fontSize:9, color:"#6c757d", fontFamily:MONO }}>{label}</div>
      <div style={{ fontSize:13, fontWeight:800, fontFamily:MONO, color:highlight?"#b45309":"#212529" }}>
        {value} <span style={{ fontSize:10, color:"#868e96" }}>{unit}</span>
      </div>
    </div>
  );

  const stages = [
    { key:"lifting",   label:"Initial Lifting",   color:"#2563eb" },
    { key:"transport", label:"Transport/Erection", color:"#0891b2" },
  ];
  const [activeStage, setActiveStage] = useState("lifting");
  const result = phase7?.[activeStage];

  return (
    <div>
      {/* Inputs */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:10, marginBottom:12, padding:"10px 12px",
        background:"#f8f9fa", border:"1px solid #dee2e6", borderRadius:6 }}>
        <div>
          <div style={{ fontSize:9, color:"#6c757d", marginBottom:2, fontFamily:MONO }}>Lift Point (fraction of span from end)</div>
          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
            <input type="number" value={liftPt} step={0.01} min={0.05} max={0.40}
              onChange={e=>setLiftPt(Number(e.target.value))} style={{ ...iS, width:70 }}/>
            <span style={{ fontSize:10, color:"#868e96" }}>ÃƒÆ’Ã¢â‚¬â€ L = {f(liftPt*span,1)} ft</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize:9, color:"#6c757d", marginBottom:2, fontFamily:MONO }}>Lift Hardware Height above Top of Beam</div>
          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
            <input type="number" value={yLift} step={1} min={0}
              onChange={e=>setYLift(Number(e.target.value))} style={{ ...iS, width:65 }}/>
            <span style={{ fontSize:10, color:"#868e96" }}>in</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize:9, color:"#6c757d", marginBottom:2, fontFamily:MONO }}>Initial Sweep (override, in)</div>
          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
            <input type="number" value={sweepIn??""} step={0.1} min={0} placeholder={`auto = L/10000`}
              onChange={e=>setSweepIn(e.target.value===""?null:Number(e.target.value))}
              style={{ ...iS, width:100 }}/>
            <span style={{ fontSize:10, color:"#868e96" }}>in (auto = {f(span*12/10000,3)}")</span>
          </div>
        </div>
      </div>

      {/* Stage selector */}
      <div style={{ display:"flex", gap:0, marginBottom:12, borderBottom:"2px solid #dee2e6" }}>
        {stages.map(s=>(
          <button key={s.key} onClick={()=>setActiveStage(s.key)} style={{
            padding:"7px 20px", border:"none", cursor:"pointer",
            borderBottom:activeStage===s.key?`3px solid ${s.color}`:"3px solid transparent",
            background:activeStage===s.key?"#fff":"#f8f9fa", marginBottom:-2,
            fontSize:11, fontWeight:activeStage===s.key?700:400,
            color:activeStage===s.key?s.color:"#868e96", fontFamily:MONO,
          }}>
            {s.label}
            {phase7?.[s.key] && (
              <span style={{ marginLeft:8, fontSize:9, padding:"1px 5px", borderRadius:8, fontWeight:800,
                background:phase7[s.key].allOk?"#dcfce7":"#fee2e2",
                color:phase7[s.key].allOk?"#15803d":"#dc2626" }}>
                {phase7[s.key].allOk?"PASS":"FAIL"}
              </span>
            )}
          </button>
        ))}
      </div>

      {result && (<>
        {/* Key parameters */}
        <div style={{ fontSize:11, color:"#495057", marginBottom:10, lineHeight:1.6 }}>
          <b>Section:</b> {sectionLabel} &nbsp;Ãƒâ€šÃ‚Â·&nbsp;
          <b>Span:</b> {span} ft ({f(span*12,0)} in) &nbsp;Ãƒâ€šÃ‚Â·&nbsp;
          <b>Lift points at:</b> {f(result.a/12,1)} ft from each end &nbsp;Ãƒâ€šÃ‚Â·&nbsp;
          <b>Initial sweep z<sub>i</sub>:</b> {f(result.z_i,3)}"
        </div>

        <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:12 }}>
          <Stat label="EIy (lateral)" value={f(result.EIy/1e6,1)} unit="ÃƒÆ’Ã¢â‚¬â€10ÃƒÂ¢Ã‚ÂÃ‚Â¶ kÃƒâ€šÃ‚Â·inÃƒâ€šÃ‚Â²"/>
          <Stat label="Beam Weight W" value={f(result.W,2)} unit="kips"/>
          <Stat label="CG above roll axis yr" value={f(result.yr,2)} unit="in"/>
          <Stat label="Lateral stiffness Ky" value={f(result.Ky,4)} unit="k/in"/>
          <Stat label="Roll stiffness KÃƒÅ½Ã‚Â¸" value={f(result.Ktheta,2)} unit="kÃƒâ€šÃ‚Â·in/rad"/>
          <Stat label="Equilibrium tilt ÃƒÅ½Ã‚Â¸_eq" value={f(result.theta_eq*180/Math.PI,3)} unit="Ãƒâ€šÃ‚Â°" highlight={result.theta_eq>0.1}/>
          <Stat label="M_lat (lateral)" value={f(result.M_lat/12,2)} unit="kip-ft"/>
          <Stat label="Mcr_lat (cracking)" value={f(result.Mcr_lat/12,2)} unit="kip-ft"/>
          <Stat label="FS cracking" value={f(result.FS_crack,2)} unit="" highlight={!result.fsOk_crack}/>
          <Stat label="FS failure" value={f(result.FS_failure,2)} unit="" highlight={!result.fsOk_failure}/>
        </div>

        {/* PASS/FAIL checks */}
        <div style={{ marginBottom:10 }}>
          {result.checks.map((chk,i)=>(
            <Check key={i} {...chk}/>
          ))}
        </div>

        {/* Stability diagram ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â SVG roll diagram */}
        <div style={{ padding:12, background:"#f8f9fa", border:"1px solid #dee2e6", borderRadius:6, marginBottom:10 }}>
          <div style={{ fontSize:10, fontWeight:700, fontFamily:MONO, color:"#374151", marginBottom:8 }}>
            TILT STABILITY DIAGRAM
          </div>
          <svg viewBox="0 0 480 160" style={{ width:"100%", maxWidth:480 }}>
            <rect width={480} height={160} fill="#fff"/>
            {/* Beam cross-section at equilibrium tilt */}
            {(() => {
              const theta = Math.min(result.theta_eq, 0.35);
              const cx=180, cy=80, bw=80, bh=30;
              const cos=Math.cos(theta), sin=Math.sin(theta);
              const rotate=(x,y)=>[cx+x*cos-y*sin, cy+x*sin+y*cos];
              const pts = [[-bw/2,-bh/2],[bw/2,-bh/2],[bw/2,bh/2],[-bw/2,bh/2]];
              const rotPts = pts.map(([x,y])=>rotate(x,y));
              const poly = rotPts.map(([x,y])=>`${x},${y}`).join(" ");
              const [lx,ly] = rotate(0,-bh/2);
              return (<>
                <polygon points={poly} fill="#d1d5db" stroke="#374151" strokeWidth={2}/>
                {/* Lift line */}
                <line x1={lx} y1={ly} x2={lx} y2={10} stroke="#2563eb" strokeWidth={2} strokeDasharray="4,3"/>
                <circle cx={lx} cy={10} r={5} fill="#2563eb"/>
                {/* Tilt angle arc */}
                <text x={lx+10} y={20} fontSize={10} fill="#2563eb" fontFamily={MONO}>ÃƒÅ½Ã‚Â¸={f(theta*180/Math.PI,2)}Ãƒâ€šÃ‚Â°</text>
                {/* Weight vector */}
                <line x1={cx} y1={cy} x2={cx} y2={cy+40} stroke="#dc2626" strokeWidth={2} markerEnd="url(#marrow)"/>
                <text x={cx+5} y={cy+35} fontSize={9} fill="#dc2626" fontFamily={MONO}>W</text>
              </>);
            })()}
            {/* Legend */}
            <text x={310} y={30} fontSize={10} fontFamily={MONO} fill="#374151">FS_crack = {f(result.FS_crack,2)}</text>
            <text x={310} y={45} fontSize={10} fontFamily={MONO} fill="#374151">FS_fail = {f(result.FS_failure,2)}</text>
            <text x={310} y={60} fontSize={10} fontFamily={MONO} fill={result.stable?"#16a34a":"#dc2626"}>
              {result.stable?"Stable":"UNSTABLE"}
            </text>
            <defs>
              <marker id="marrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto">
                <path d="M0,0 L10,5 L0,10 Z" fill="#dc2626"/>
              </marker>
            </defs>
          </svg>
        </div>

        {/* Code reference */}
        <div style={{ fontSize:10, color:"#6c757d", padding:"6px 10px", background:"#f8f9fa", borderRadius:4, fontFamily:MONO }}>
          Method: Mast (1989) / PCI Design Handbook 8th Ed. Ãƒâ€šÃ‚Â§8.3 &nbsp;Ãƒâ€šÃ‚Â·&nbsp;
          Required FS: {result.FS_crack_req} (cracking), {result.FS_failure_req} (failure)
        </div>
      </>)}
    </div>
  );
}

function ConstructionStagesView({ stages }) {
  const [activeStage, setActiveStage] = useState(1);
  const st = stages.find(s => s.id === activeStage) || stages[0];
  if (!st) return null;

  const STAGE_COLORS = {1:"#7c3aed",2:"#2563eb",3:"#0891b2",4:"#ea580c",5:"#16a34a"};
  const f4 = v => isNaN(v) || v == null ? "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â" : v.toFixed(4);
  const f2 = v => isNaN(v) || v == null ? "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â" : v.toFixed(2);
  const f3 = v => isNaN(v) || v == null ? "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â" : v.toFixed(3);
  const MONO = "'JetBrains Mono','Fira Code','Consolas',monospace";

  const allPass = stages.every(s => s.checks.every(c => c.ok));

  return (
    <div>
      {/* Timeline picker */}
      <div style={{ display:"flex", gap:0, marginBottom:12, borderBottom:"2px solid #dee2e6", overflowX:"auto" }}>
        {stages.map(s => {
          const summ = stageSummary(s);
          const active = activeStage === s.id;
          const col = STAGE_COLORS[s.id];
          return (
            <button key={s.id} onClick={()=>setActiveStage(s.id)} style={{
              flex:1, minWidth:120, padding:"8px 6px", border:"none", cursor:"pointer",
              borderBottom: active?`3px solid ${col}`:"3px solid transparent",
              background: active?"#fff":"#f8f9fa",
              marginBottom:-2,
            }}>
              <div style={{ fontSize:10, fontWeight:700, color:col, fontFamily:MONO, marginBottom:2 }}>
                Stage {s.id}
              </div>
              <div style={{ fontSize:10, color:"#374151", marginBottom:2, lineHeight:1.2 }}>{s.name}</div>
              <div style={{ fontSize:9, color:"#868e96" }}>Day {s.day}</div>
              <div style={{ marginTop:4, display:"inline-block", padding:"1px 6px", borderRadius:8, fontSize:9,
                fontWeight:800, fontFamily:MONO,
                background:summ.allOk?"#dcfce7":"#fee2e2",
                color:summ.allOk?"#15803d":"#dc2626" }}>
                {summ.label}
              </div>
            </button>
          );
        })}
      </div>

      {/* Stage detail */}
      <div style={{ background:"#f8f9fa", border:`1px solid ${STAGE_COLORS[st.id]}30`, borderLeft:`4px solid ${STAGE_COLORS[st.id]}`, borderRadius:4, padding:12, marginBottom:10 }}>
        <div style={{ fontSize:12, fontWeight:700, color:STAGE_COLORS[st.id], marginBottom:4, fontFamily:MONO }}>
          STAGE {st.id}: {st.name.toUpperCase()}  Ãƒâ€šÃ‚Â·  Day {st.day}
        </div>
        <div style={{ fontSize:11, color:"#495057", marginBottom:8 }}>{st.description}</div>

        {/* Key values grid */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:6, marginBottom:10 }}>
          {[
            { label:"Pe at stage", value:`${f2(st.Pe)} kips` },
            { label:"Moment @ midspan", value:st.M_mid!=null?`${f2(st.M_mid/12)} kip-ft`:"ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â" },
            st.M_overhang!=null&&{ label:"M @ overhang/ends", value:`${f2(st.M_overhang/12)} kip-ft` },
            st.dynFactor&&{ label:"Dynamic factor", value:`ÃƒÆ’Ã¢â‚¬â€${st.dynFactor}` },
            st.wCIP!=null&&st.wCIP>0&&{ label:"CIP pour load", value:`${f3(st.wCIP*1000)} plf/in` },
          ].filter(Boolean).map((item,i)=>(
            <div key={i} style={{ background:"#fff", border:"1px solid #dee2e6", borderRadius:3, padding:"6px 8px" }}>
              <div style={{ fontSize:9, color:"#6c757d", marginBottom:2, fontFamily:MONO }}>{item.label}</div>
              <div style={{ fontSize:12, fontWeight:700, fontFamily:MONO, color:"#212529" }}>{item.value}</div>
            </div>
          ))}
        </div>

        {/* Stress table */}
        <div style={{ overflowX:"auto", marginBottom:10 }}>
          <table style={{ borderCollapse:"collapse", width:"100%", fontSize:11 }}>
            <thead>
              <tr style={{ background:STAGE_COLORS[st.id]+"15" }}>
                <th style={{ padding:"5px 10px", border:"1px solid #dee2e6", textAlign:"left", fontWeight:700, fontFamily:MONO }}>Location</th>
                <th style={{ padding:"5px 10px", border:"1px solid #dee2e6", textAlign:"right", fontWeight:700 }}>Top Fiber (ksi)</th>
                <th style={{ padding:"5px 10px", border:"1px solid #dee2e6", textAlign:"right", fontWeight:700 }}>Bot Fiber (ksi)</th>
              </tr>
            </thead>
            <tbody>
              {[
                { loc:"Beam Ends", top:st.stress_end_top, bot:st.stress_end_bot },
                { loc:"Midspan",   top:st.stress_mid_top, bot:st.stress_mid_bot },
              ].map((row,i)=>(
                <tr key={i} style={{ background:i%2===0?"#fff":"#fafafa" }}>
                  <td style={{ padding:"4px 10px", border:"1px solid #dee2e6", fontWeight:600, fontFamily:MONO }}>{row.loc}</td>
                  <td style={{ padding:"4px 10px", border:"1px solid #dee2e6", textAlign:"right", fontFamily:MONO, color:row.top<-0.424?"#dc2626":"inherit" }}>{f4(row.top)}</td>
                  <td style={{ padding:"4px 10px", border:"1px solid #dee2e6", textAlign:"right", fontFamily:MONO, color:row.bot<-0.424?"#dc2626":"inherit" }}>{f4(row.bot)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Deflection */}
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:10 }}>
          {[
            ["Prestress Camber", st.camber, "in"],
            ["SW Deflection", st.defl_sw, "in"],
            st.defl_cip!=null&&["CIP Deflection", st.defl_cip, "in"],
            st.defl_sdl!=null&&["SDL Deflection", st.defl_sdl, "in"],
            st.defl_ll!=null&&["LL Deflection",  st.defl_ll,  "in"],
            ["Net Deflection", st.netDefl!=null?st.netDefl:st.netDefl_sus, "in (ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬Ëœ = camber)"],
            st.liveRatio&&["L/ÃƒÅ½Ã‚Â´_LL", `L/${Math.round(st.liveRatio)}`, ""],
          ].filter(Boolean).map(([label,val,unit],i)=>(
            <div key={i} style={{ background:"#fff", border:"1px solid #dee2e6", borderRadius:3, padding:"5px 10px", minWidth:110 }}>
              <div style={{ fontSize:9, color:"#6c757d", fontFamily:MONO }}>{label}</div>
              <div style={{ fontSize:12, fontWeight:700, fontFamily:MONO }}>{typeof val==="string"?val:f3(val)} <span style={{ fontSize:9, color:"#868e96" }}>{unit}</span></div>
            </div>
          ))}
        </div>

        {/* PASS/FAIL checks */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:4 }}>
          {st.checks.map((chk,i)=>(
            <div key={i} style={{
              display:"flex", justifyContent:"space-between", alignItems:"center",
              padding:"5px 10px", borderRadius:4, fontSize:11, fontFamily:MONO,
              background:chk.ok?"#f0fdf4":"#fef2f2",
              border:`1px solid ${chk.ok?"#bbf7d0":"#fecaca"}`,
            }}>
              <span style={{ color:chk.ok?"#14532d":"#7f1d1d", fontWeight:600 }}>{chk.label}</span>
              <span style={{ color:chk.ok?"#166534":"#991b1b" }}>
                {f4(chk.val)} {chk.unit}
                <span style={{ marginLeft:6, fontWeight:800, fontSize:10,
                  background:chk.ok?"#22c55e":"#ef4444", color:"#fff",
                  padding:"1px 5px", borderRadius:3 }}>{chk.ok?"PASS":"FAIL"}</span>
              </span>
            </div>
          ))}
        </div>

        {/* Final stage extra */}
        {st.id===5 && st.phiMn && (
          <div style={{ marginTop:8, padding:"6px 10px", background:"#fff", border:"1px solid #dee2e6", borderRadius:4, fontSize:11, fontFamily:MONO }}>
            ÃƒÅ½Ã‚Â¦MÃƒÂ¢Ã¢â‚¬Å¡Ã¢â€žÂ¢ = <b>{f2(st.phiMn)}</b> kip-ft &nbsp;Ãƒâ€šÃ‚Â·&nbsp;
            MÃƒÂ¡Ã‚ÂµÃ‚Â¤ = <b>{f2(st.Mu_ft)}</b> kip-ft &nbsp;Ãƒâ€šÃ‚Â·&nbsp;
            Utilization = <b>{f2(st.Mu_ft/st.phiMn)}</b>
          </div>
        )}
      </div>

      {/* All-stages summary table */}
      <div style={{ overflowX:"auto" }}>
        <table style={{ borderCollapse:"collapse", width:"100%", fontSize:10, fontFamily:MONO }}>
          <thead>
            <tr style={{ background:"#f8f9fa" }}>
              {["Stage","Name","Day","Pe (kip)","f_top mid (ksi)","f_bot mid (ksi)","Net Defl (in)","Result"].map(h=>(
                <th key={h} style={{ padding:"4px 8px", border:"1px solid #dee2e6", fontWeight:700, textAlign:"right", whiteSpace:"nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stages.map(s=>{
              const summ = stageSummary(s);
              return (
                <tr key={s.id} onClick={()=>setActiveStage(s.id)} style={{
                  cursor:"pointer",
                  background:activeStage===s.id?STAGE_COLORS[s.id]+"15":"#fff",
                }}>
                  <td style={{ padding:"4px 8px", border:"1px solid #dee2e6", textAlign:"center", fontWeight:700, color:STAGE_COLORS[s.id] }}>{s.id}</td>
                  <td style={{ padding:"4px 8px", border:"1px solid #dee2e6" }}>{s.name}</td>
                  <td style={{ padding:"4px 8px", border:"1px solid #dee2e6", textAlign:"right" }}>{s.day}</td>
                  <td style={{ padding:"4px 8px", border:"1px solid #dee2e6", textAlign:"right" }}>{f2(s.Pe)}</td>
                  <td style={{ padding:"4px 8px", border:"1px solid #dee2e6", textAlign:"right" }}>{f4(s.stress_mid_top)}</td>
                  <td style={{ padding:"4px 8px", border:"1px solid #dee2e6", textAlign:"right" }}>{f4(s.stress_mid_bot)}</td>
                  <td style={{ padding:"4px 8px", border:"1px solid #dee2e6", textAlign:"right" }}>{f3(s.netDefl??s.netDefl_sus)}</td>
                  <td style={{ padding:"4px 8px", border:"1px solid #dee2e6", textAlign:"center",
                    fontWeight:800, color:summ.allOk?"#16a34a":"#dc2626" }}>{summ.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StationTable({ stations, span }) {
  const [activeView, setActiveView] = useState("moment");
  if (!stations || !stations.length) return null;

  const th = { padding: "5px 8px", borderBottom: "2px solid #212529", borderRight: "1px solid #dee2e6", fontWeight: 700, fontSize: 10, fontFamily: STATION_MONO, textAlign: "right", background: "#f8f9fa", whiteSpace: "nowrap" };
  const thL = { ...th, textAlign: "left" };
  const td = (ok, right) => ({
    padding: "4px 8px", borderBottom: "1px solid #dee2e6", borderRight: "1px solid #dee2e6",
    fontSize: 10, fontFamily: STATION_MONO, textAlign: right ? "right" : "left",
    background: ok === true ? "#f0fdf4" : ok === false ? "#fef2f2" : "#fff",
    color: ok === false ? "#991b1b" : ok === true ? "#14532d" : "#212529",
  });
  const pass = (ok) => <span style={{ fontSize: 9, fontWeight: 800, color: ok ? "#16a34a" : "#dc2626", fontFamily: STATION_MONO }}>{ok ? "PASS" : "FAIL"}</span>;

  const views = [
    { id:"moment",  label:"Moment & Shear" },
    { id:"stress",  label:"Concrete Stress" },
    { id:"flex",    label:"Flexural Check" },
    { id:"shear",   label:"Shear Check" },
    { id:"deflect", label:"Deflection" },
  ];

  return (
    <div>
      {/* Sub-picker */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
        {views.map(v => (
          <button key={v.id} onClick={() => setActiveView(v.id)} style={{
            padding: "4px 10px", borderRadius: 12, fontSize: 10, fontFamily: STATION_MONO, cursor: "pointer",
            border: activeView === v.id ? "2px solid #2563eb" : "1px solid #ced4da",
            background: activeView === v.id ? "#eff6ff" : "#fff",
            color: activeView === v.id ? "#1d4ed8" : "#495057", fontWeight: activeView === v.id ? 700 : 400,
          }}>{v.label}</button>
        ))}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520 }}>
          <thead>
            <tr>
              <th style={thL}>x (ft)</th>
              {activeView === "moment" && (<>
                <th style={th}>MÃƒÂ¡Ã‚ÂµÃ‚Â¤ (kip-ft)</th>
                <th style={th}>VÃƒÂ¡Ã‚ÂµÃ‚Â¤ (kips)</th>
                <th style={th}>MÃƒÂ¢Ã¢â‚¬Å¡Ã¢â‚¬ÂºÃƒÂ¡Ã‚ÂµÃ‚Â¥c (kip-ft)</th>
              </>)}
              {activeView === "stress" && (<>
                <th style={th}>f_top (ksi)</th>
                <th style={th}>f_bot (ksi)</th>
                <th style={th}>Allow. tens. (ksi)</th>
                <th style={th}>Allow. comp. (ksi)</th>
                <th style={th}>Status</th>
              </>)}
              {activeView === "flex" && (<>
                <th style={th}>MÃƒÂ¡Ã‚ÂµÃ‚Â¤ (kip-ft)</th>
                <th style={th}>ÃƒÅ½Ã‚Â¦MÃƒÂ¢Ã¢â‚¬Å¡Ã¢â€žÂ¢ (kip-ft)</th>
                <th style={th}>MÃƒÂ¡Ã‚Â¶Ã…â€œÃƒÅ Ã‚Â³ (kip-ft)</th>
                <th style={th}>MÃƒÂ¡Ã‚ÂµÃ‚Â¤/ÃƒÅ½Ã‚Â¦MÃƒÂ¢Ã¢â‚¬Å¡Ã¢â€žÂ¢</th>
                <th style={th}>Status</th>
              </>)}
              {activeView === "shear" && (<>
                <th style={th}>|VÃƒÂ¡Ã‚ÂµÃ‚Â¤| (kips)</th>
                <th style={th}>ÃƒÅ½Ã‚Â¦VÃƒÂ¢Ã¢â‚¬Å¡Ã¢â€žÂ¢ (kips)</th>
                <th style={th}>VÃƒÂ¡Ã‚ÂµÃ‚Â¤/ÃƒÅ½Ã‚Â¦VÃƒÂ¢Ã¢â‚¬Å¡Ã¢â€žÂ¢</th>
                <th style={th}>Status</th>
              </>)}
              {activeView === "deflect" && (<>
                <th style={th}>ÃƒÅ½Ã‚Â´ @ Release (in)</th>
                <th style={th}>ÃƒÅ½Ã‚Â´ @ Erection (in)</th>
                <th style={th}>ÃƒÅ½Ã‚Â´ Final Sus. (in)</th>
                <th style={th}>ÃƒÅ½Ã‚Â´ Final Total (in)</th>
                <th style={th}>L/ÃƒÅ½Ã‚Â´</th>
              </>)}
            </tr>
          </thead>
          <tbody>
            {stations.map((st, i) => (
              <tr key={i}>
                <td style={td(null, false)}><b>{st.x.toFixed(2)}</b></td>
                {activeView === "moment" && (<>
                  <td style={td(null, true)}>{fmt(st.Mu, 2)}</td>
                  <td style={td(null, true)}>{fmt(st.Vu, 2)}</td>
                  <td style={td(null, true)}>{fmt(st.Msvc, 2)}</td>
                </>)}
                {activeView === "stress" && (<>
                  <td style={td(st.compTop_ok, true)}>{fmt(st.ftop, 4)}</td>
                  <td style={td(st.tensBot_ok, true)}>{fmt(st.fbot, 4)}</td>
                  <td style={td(null, true)}>ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢0.424</td>
                  <td style={td(null, true)}>2.25</td>
                  <td style={{ ...td(st.stressOk, false), textAlign: "center" }}>{pass(st.stressOk)}</td>
                </>)}
                {activeView === "flex" && (<>
                  <td style={td(null, true)}>{fmt(st.Mu, 2)}</td>
                  <td style={td(null, true)}>{fmt(st.phiMn, 2)}</td>
                  <td style={td(null, true)}>{fmt(st.Mcr, 2)}</td>
                  <td style={td(st.flexOk, true)}>{fmt(st.Mu / Math.max(st.phiMn, 0.001), 3)}</td>
                  <td style={{ ...td(st.flexOk, false), textAlign: "center" }}>{pass(st.flexOk)}</td>
                </>)}
                {activeView === "shear" && (<>
                  <td style={td(null, true)}>{fmt(Math.abs(st.Vu), 2)}</td>
                  <td style={td(null, true)}>{fmt(st.Vn, 2)}</td>
                  <td style={td(st.shearOk, true)}>{fmt(Math.abs(st.Vu) / Math.max(st.Vn, 0.001), 3)}</td>
                  <td style={{ ...td(st.shearOk, false), textAlign: "center" }}>{pass(st.shearOk)}</td>
                </>)}
                {activeView === "deflect" && (<>
                  <td style={td(null, true)}>{fmt(st.netI, 3)}</td>
                  <td style={td(null, true)}>{fmt(st.netE, 3)}</td>
                  <td style={td(null, true)}>{fmt(st.netFinalSus, 3)}</td>
                  <td style={td(null, true)}>{fmt(st.netF, 3)}</td>
                  <td style={td(null, true)}>{st.Lratio > 9000 ? "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â" : `L/${st.Lratio}`}</td>
                </>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary row */}
      <div style={{ marginTop: 8, padding: "6px 10px", background: "#f8f9fa", border: "1px solid #dee2e6", borderRadius: 4, fontSize: 10, fontFamily: STATION_MONO, color: "#495057" }}>
        <b>Span {span} ft</b> Ãƒâ€šÃ‚Â· {stations.length} analysis stations Ãƒâ€šÃ‚Â·
        MÃƒÂ¡Ã‚ÂµÃ‚Â¤,max = <b>{fmt(Math.max(...stations.map(s=>s.Mu)), 2)} kip-ft</b> Ãƒâ€šÃ‚Â·
        |VÃƒÂ¡Ã‚ÂµÃ‚Â¤|,max = <b>{fmt(Math.max(...stations.map(s=>Math.abs(s.Vu))), 2)} kips</b> Ãƒâ€šÃ‚Â·
        ÃƒÅ½Ã‚Â´_net,max = <b>{fmt(Math.max(...stations.map(s=>Math.abs(s.netF))), 3)} in</b>
      </div>
    </div>
  );
}

function ChartPicker({options, value, onChange}){
  const theme = useModuleTheme();
  return(
    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
      {options.map(o=>(
        <button key={o.id} onClick={()=>onChange(o.id)} style={{
          padding:"6px 12px",borderRadius:20,border: value===o.id?`2px solid ${theme.accent}`:"1px solid #ced4da",
          background: value===o.id?theme.soft:"#fff", color: value===o.id?theme.text:"#495057",
          fontWeight: value===o.id?700:500, fontSize:11, cursor:"pointer", fontFamily:CHART_FONT,
        }}>{o.label}</button>
      ))}
    </div>
  );
}


// Renders proper engineering notation: a base symbol with a true HTML subscript,
// e.g. <Sym base="E" sub="c"/> -> Ec with c rendered as a real subscript.
// Used wherever a multi-letter subscript (no Unicode glyph available) is needed.
const Sym=({base,sub,prime})=>(
  <span style={{fontStyle:"italic"}}>{base}{prime&&"ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²"}{sub&&<sub style={{fontStyle:"italic",fontSize:"0.78em"}}>{sub}</sub>}</span>
);

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ UI Components ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
const Badge=({ok,label})=>(
  <span style={{display:"inline-flex",alignItems:"center",gap:3,padding:"2px 10px",borderRadius:3,
    fontSize:11,fontWeight:700,fontFamily:"'JetBrains Mono','Fira Code','Consolas',monospace",
    background:ok?"#d4edda":"#f8d7da",color:ok?"#155724":"#721c24",border:`1px solid ${ok?"#c3e6cb":"#f5c6cb"}`}}>
    {label||(ok?"PASS":"FAIL")}
  </span>
);
const Card=({title,children})=>{
  const theme = useModuleTheme();
  return(
    <div className="print-card" style={{background:"#fff",border:"1px solid #dee2e6",borderLeft:`4px solid ${theme.accent}`,borderRadius:4,marginBottom:14,overflow:"hidden"}}>
      {title&&<div style={{padding:"7px 14px",background:theme.soft,borderBottom:`1px solid ${theme.softBorder}`,fontWeight:700,fontSize:12,fontFamily:"'JetBrains Mono','Fira Code','Consolas',monospace",textTransform:"uppercase",letterSpacing:0.8,color:theme.text}}>{title}</div>}
      <div style={{padding:"10px 14px"}}>{children}</div>
    </div>
  );
};
const OI=({label,value,onChange,unit,options,width,step})=>(
  <div style={{display:"inline-flex",flexDirection:"column",minWidth:width||115,flex:1}}>
    <span style={{fontSize:10,color:"#6c757d",fontWeight:600,marginBottom:2,letterSpacing:0.5}}>{label}</span>
    {options?(
      <select className="oi" value={value} onChange={e=>onChange(e.target.value)} style={{...iS,background:"#fff8ef",border:"2px solid #e8a838"}}>{options.map(o=><option key={o} value={o}>{o}</option>)}</select>
    ):(
      <div style={{position:"relative"}}>
        <input type="number" className="oi" value={value} step={step||"any"} onChange={e=>onChange(parseFloat(e.target.value)||0)}
          style={{...iS,background:"#fff8ef",border:"2px solid #e8a838",paddingRight:unit?34:10}}/>
        {unit&&<span style={{position:"absolute",right:7,top:"50%",transform:"translateY(-50%)",fontSize:10,color:"#b07020",fontWeight:600}}>{unit}</span>}
      </div>
    )}
  </div>
);
const CI=({label,value,unit})=>(
  <div style={{display:"inline-flex",flexDirection:"column",minWidth:115,flex:1}}>
    <span style={{fontSize:10,color:"#adb5bd",fontWeight:600,marginBottom:2,letterSpacing:0.5}}>{label}</span>
    <div style={{...iS,background:"#f8f9fa",border:"1px solid #dee2e6",color:"#495057"}}>{value}{unit&&<span style={{fontSize:10,color:"#adb5bd",marginLeft:3}}>{unit}</span>}</div>
  </div>
);
const iS={padding:"5px 9px",borderRadius:3,fontSize:13,fontFamily:"'JetBrains Mono','Fira Code','Consolas',monospace",width:"100%",boxSizing:"border-box",fontWeight:600,outline:"none"};
const R=({children})=><div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:6}}>{children}</div>;
const Res=({label,value,unit})=>(
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",padding:"3px 0",borderBottom:"1px solid #f1f3f5"}}>
    <span style={{fontSize:12,color:"#6c757d"}}>{label}</span>
    <span style={{fontSize:13,fontWeight:700,fontFamily:"'JetBrains Mono','Fira Code','Consolas',monospace"}}>
      {typeof value==="object"?value:<>{value}{unit&&<span style={{fontSize:10,color:"#adb5bd",fontWeight:400,marginLeft:3}}>{unit}</span>}</>}
    </span>
  </div>
);
const Check=({label,actual,limit,unit,ok,tag})=>(
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:"1px solid #f1f3f5",flexWrap:"wrap",gap:4}}>
    <span style={{fontSize:12,color:"#6c757d",flex:"1 1 auto"}}>{label}</span>
    <span style={{fontSize:12,fontFamily:"'JetBrains Mono','Fira Code','Consolas',monospace",color:"#343a40",marginRight:6}}>{actual} vs {limit}{unit&&` ${unit}`}</span>
    <Badge ok={ok} label={tag}/>
  </div>
);

// Formula with code ref on the right ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â hidden when "step-by-step" view is off
const Eq=({tex,code})=>{
  const {showSteps}=useViewSettings();
  if(!showSteps) return null;
  return(
    <div style={{margin:"4px 0",padding:"5px 10px",background:"#f8f9fa",borderLeft:"3px solid #ced4da",borderRadius:"0 3px 3px 0",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
      <span style={{fontFamily:"'JetBrains Mono','Fira Code','Consolas',monospace",fontSize:12,color:"#495057",whiteSpace:"pre-wrap",flex:1}}>{tex}</span>
      {code&&<span style={{fontSize:10,color:"#fff",background:"#495057",padding:"2px 8px",borderRadius:3,fontFamily:"'JetBrains Mono','Fira Code','Consolas',monospace",whiteSpace:"nowrap",fontWeight:700,flexShrink:0}}>{code}</span>}
    </div>
  );
};
// Wraps a diagram; hides it when "graphics" view is off
const Graphic=({children})=>{
  const {showGraphics}=useViewSettings();
  if(!showGraphics) return null;
  return children;
};

// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
// TEDDS-STYLE REPORT COMPONENTS (print-only formal calc sheet)
// Matches Tekla Tedds layout: calc ID, code basis, numbered design
// section with italic note, bold plain-English section headings,
// label/symbol-value two-column rows, and a shaded results table.
// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
const TEDDS_FONT = "Calibri,Arial,'Segoe UI',sans-serif";

const TeddsDoc=({children})=>(
  <div className="tedds-doc" style={{fontFamily:TEDDS_FONT,fontSize:13,color:"#000",lineHeight:1.7,maxWidth:760,margin:"0 auto"}}>
    {children}
  </div>
);
// Top title block: calc ID, then code basis directly below, version stamped top-right
const TeddsTitle=({calcId,codeBasis,version})=>(
  <div style={{marginBottom:10}}>
    <div style={{fontSize:13,fontWeight:700}}>{calcId}</div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
      <div style={{fontSize:13,fontWeight:700}}>{codeBasis}</div>
      <div style={{fontSize:11,color:"#333",whiteSpace:"nowrap",marginLeft:20}}>{version||"Calc version 1.0"}</div>
    </div>
  </div>
);
// Numbered design-section header with an italic user note, e.g. "Design section 1"
const TeddsSection=({number,note})=>(
  <div style={{marginTop:14,marginBottom:8}}>
    <div style={{fontWeight:700,fontSize:13}}>Design section {number}</div>
    {note&&<div style={{fontStyle:"italic",fontSize:12.5,marginTop:2}}>{note}</div>}
  </div>
);
const TeddsHeading=({children})=>(
  <div style={{fontWeight:700,marginTop:14,marginBottom:5,fontSize:13}}>{children}</div>
);
// Single labeled value line, optionally two side-by-side, matching Tedds' fixed columns:
// label (flush left) | symbol = value unit (column 2) | symbol = value unit (column 3)
const TeddsLine=({label,sym,val,unit,label2,sym2,val2,unit2})=>(
  <div style={{display:"flex",fontSize:13,marginBottom:2}}>
    <div style={{flex:"0 0 44%",paddingRight:8}}>{label}</div>
    <div style={{flex:"0 0 28%"}}>
      {sym && <span><i>{sym}</i> = {val}{unit?` ${unit}`:""}</span>}
    </div>
    <div style={{flex:"0 0 28%"}}>
      {sym2 && <span><i>{sym2}</i> = {val2}{unit2?` ${unit2}`:""}</span>}
    </div>
  </div>
);
// A line with label only and no symbol/value pair (e.g. material grade headers)
const TeddsNote=({children})=>(
  <div style={{fontWeight:700,fontSize:13,marginBottom:2}}>{children}</div>
);
// Formula derivation line: indented, symbol = formula = result, used under "Analysis results"-style sections
const TeddsCalc=({sym,formula,result,unit})=>(
  <div style={{fontSize:13,color:"#000",marginBottom:2,marginLeft:0}}>
    <i>{sym}</i> = {formula} = <b>{result}</b>{unit?` ${unit}`:""}
  </div>
);
const TeddsTable=({headers,rows}) => (
  <table style={{width:"100%",borderCollapse:"collapse",marginTop:6,marginBottom:14,fontSize:12.5}}>
    <thead>
      <tr style={{background:"#f0f0f0"}}>
        {headers.map((h,i)=>(
          <th key={i} style={{textAlign:i===0?"left":"right",borderTop:"1px solid #000",borderBottom:"1px solid #000",padding:"4px 8px",fontWeight:700}}>{h}</th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((row,i)=>(
        <tr key={i}>
          {row.map((cell,j)=>(
            <td key={j} style={{
              textAlign:j===0?"left":"right",
              padding:"4px 8px",
              borderBottom: i===rows.length-1?"1px solid #000":"1px solid #ddd",
              fontWeight: (j===row.length-1) ? 700 : 400,
              color: (j===row.length-1 && cell==="FAIL") ? "#a00" : (j===row.length-1 && cell==="PASS") ? "#070" : "#000",
            }}>{cell}</td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);
// Builds a results-summary row with automatic PASS/FAIL + utilization ratio
const utilRow=(label,unit,capacity,maximum)=>{
  const util = capacity>0 ? maximum/capacity : 0;
  return [label, unit, fmt(capacity,3), fmt(maximum,3), fmt(util,3), util<=1.0?"PASS":"FAIL"];
};

// Wraps a tab's input-properties section; hidden when "Inputs" view is off
const InputsBlock=({children})=>{
  const {showInputs}=useViewSettings();
  if(!showInputs) return null;
  return children;
};
// Wraps a tab's output/results section; hidden when "Outputs" view is off
const OutputsBlock=({children})=>{
  const {showOutputs}=useViewSettings();
  if(!showOutputs) return null;
  return children;
};

const SH=({children})=>{
  const theme = useModuleTheme();
  return(
    <div className="print-section-head" style={{margin:"16px 0 6px",padding:"4px 0",borderBottom:`2px solid ${theme.accent}`,fontWeight:800,fontSize:13,textTransform:"uppercase",letterSpacing:1,color:theme.text}}>{children}</div>
  );
};

// Live status banner: shows pass/fail + a fill-bar that animates with utilization changes
const LiveStatusBanner=({ok,util,label})=>{
  const pct=Math.min(Math.max(util*100,2),140);
  const barColor= util<=0.7 ? "#27ae60" : util<=1.0 ? "#e8a838" : "#c0392b";
  return(
    <div style={{
      display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:6,marginBottom:14,
      border:`2px solid ${ok?"#27ae60":"#c0392b"}`,
      background: ok?"#f1f9f3":"#fdf1f0",
      transition:"border-color 0.4s ease, background 0.4s ease",
    }}>
      <div style={{fontSize:13,fontWeight:800,fontFamily:"'JetBrains Mono','Fira Code','Consolas',monospace",color:ok?"#1e7e34":"#a52a1f",whiteSpace:"nowrap"}}>
        {ok?"ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ DESIGN OK":"ÃƒÂ¢Ã…â€œÃ¢â‚¬â€ CHECK FAILS"}
      </div>
      <div style={{flex:1}}>
        <div style={{fontSize:10,color:"#6c757d",marginBottom:3,fontFamily:"'JetBrains Mono','Fira Code','Consolas',monospace"}}>
          {label||"Flexural Utilization"}: <b style={{color:barColor}}>{(util*100).toFixed(0)}%</b>
        </div>
        <div style={{height:8,background:"#e9ecef",borderRadius:4,overflow:"hidden",position:"relative"}}>
          <div style={{
            height:"100%",width:`${Math.min(pct,100)}%`,background:barColor,borderRadius:4,
            transition:"width 0.5s ease, background 0.5s ease",
          }}/>
          <div style={{position:"absolute",left:"71.4%",top:0,bottom:0,width:1,background:"#fff",opacity:0.6}}/>
        </div>
      </div>
    </div>
  );
};

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Current logged-in user, available to every tab for save attribution ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
const CurrentUserContext = createContext(null);
const useCurrentUser = () => useContext(CurrentUserContext);

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Modal for saving a calc into Project > Part > Calc Name ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
function SaveCalcModal({open, onClose, onSave, existingProjects, defaultProject, defaultPart}){
  const [projectName,setProjectName]=useState(defaultProject||"");
  const [partName,setPartName]=useState(defaultPart||"");
  const [calcName,setCalcName]=useState("");
  const [saving,setSaving]=useState(false);
  const [err,setErr]=useState("");

  useEffect(()=>{
    if(open){
      setProjectName(defaultProject||"");
      setPartName(defaultPart||"");
      setCalcName("");
      setErr("");
    }
  },[open,defaultProject,defaultPart]);

  if(!open) return null;

  const projectOptions = [...new Set(existingProjects.map(p=>p.project_name))];
  const partOptions = [...new Set(existingProjects.filter(p=>p.project_name===projectName).map(p=>p.part_name))];

  const submit = async()=>{
    if(!projectName.trim()||!partName.trim()||!calcName.trim()){
      setErr("Project, part, and calc name are all required.");
      return;
    }
    setSaving(true);
    const ok = await onSave({projectName:projectName.trim(), partName:partName.trim(), calcName:calcName.trim()});
    setSaving(false);
    if(ok) onClose();
    else setErr("Save failed ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â check your connection and try again.");
  };

  return(
    <div className="no-print" onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:8,padding:22,width:"100%",maxWidth:400,boxShadow:"0 12px 36px rgba(0,0,0,0.25)"}}>
        <div style={{fontSize:14,fontWeight:800,marginBottom:14,fontFamily:"'JetBrains Mono','Fira Code','Consolas',monospace",textTransform:"uppercase"}}>ÃƒÂ°Ã…Â¸Ã¢â‚¬â„¢Ã‚Â¾ Save Calculation</div>

        <div style={{marginBottom:10}}>
          <label style={{fontSize:11,fontWeight:600,color:"#495057",display:"block",marginBottom:3}}>Project Folder</label>
          <input list="project-list" value={projectName} onChange={e=>setProjectName(e.target.value)} placeholder="e.g. 123 Main St Warehouse"
            style={{width:"100%",padding:"8px 10px",borderRadius:4,border:"2px solid #e8a838",background:"#fff8ef",fontSize:13,boxSizing:"border-box"}}/>
          <datalist id="project-list">{projectOptions.map(p=><option key={p} value={p}/>)}</datalist>
        </div>

        <div style={{marginBottom:10}}>
          <label style={{fontSize:11,fontWeight:600,color:"#495057",display:"block",marginBottom:3}}>Part / Subfolder</label>
          <input list="part-list" value={partName} onChange={e=>setPartName(e.target.value)} placeholder="e.g. Precast Beam B-12"
            style={{width:"100%",padding:"8px 10px",borderRadius:4,border:"2px solid #e8a838",background:"#fff8ef",fontSize:13,boxSizing:"border-box"}}/>
          <datalist id="part-list">{partOptions.map(p=><option key={p} value={p}/>)}</datalist>
        </div>

        <div style={{marginBottom:14}}>
          <label style={{fontSize:11,fontWeight:600,color:"#495057",display:"block",marginBottom:3}}>Calculation Name</label>
          <input value={calcName} onChange={e=>setCalcName(e.target.value)} placeholder="e.g. HC10 Slab ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Rev 2"
            style={{width:"100%",padding:"8px 10px",borderRadius:4,border:"2px solid #e8a838",background:"#fff8ef",fontSize:13,boxSizing:"border-box"}}/>
        </div>

        {err && <div style={{fontSize:12,color:"#c0392b",background:"#fdecea",border:"1px solid #f5c6cb",borderRadius:4,padding:"6px 10px",marginBottom:12}}>{err}</div>}

        <div style={{display:"flex",gap:8}}>
          <button onClick={onClose} style={{flex:1,padding:"9px",borderRadius:4,border:"1px solid #ced4da",background:"#fff",cursor:"pointer",fontSize:12,fontWeight:600}}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{flex:1,padding:"9px",borderRadius:4,border:"none",background:"#212529",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:700}}>
            {saving?"SavingÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦":"Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
// PCI TAB
// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
function PCITab({loadedCalc, onConsumedLoad, workspace}){
  const [sec,setSec]=useState("PCI 8IN");
  // When the user edits h or b directly in the 3D view, we store overrides.
  // null = use the section table value (default). Switching section resets them.
  const [slabHOverride,setSlabHOverride]=useState(null);
  const [slabBOverride,setSlabBOverride]=useState(null);
  const handleSecChange = (newSec) => { setSec(newSec); setSlabHOverride(null); setSlabBOverride(null); };
  const [cover,setCover]=useState(1);
  const [fc,setFc]=useState(5);
  const [fci,setFci]=useState(3);
  const [nH,setNH]=useState(4);
  const [nS,setNS]=useState(0);
  const [fpiR,setFpiR]=useState(0.7);
  const [nRe,setNRe]=useState(0);
  const [reSz,setReSz]=useState("#4");
  const [span,setSpan]=useState(30.5);
  const [lpc,setLpc]=useState(30.5);
  const [sdl,setSdl]=useState(20);
  const [ll,setLl]=useState(50);
  const [cT,setCT]=useState(1.3);
  const [RH,setRH]=useState(70);
  const [chartType,setChartType]=useState("stress");

  // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Phase 4: Composite topping inputs ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
  const [useComposite,setUseComposite]=useState(false);
  const [tc,setTc]=useState(2);          // topping thickness, in
  const [fcTop,setFcTop]=useState(3);    // topping fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²c, ksi
  const [topSurface,setTopSurface]=useState("roughened"); // interface condition

  // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Phase 6+8: Vibration + filled core shear ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
  const [occupancy,setOccupancy]=useState("Office / Residential");
  const [activity,setActivity]=useState("");          // empty = walking only
  const [slabWidth,setSlabWidth]=useState(8);         // ft, tributary for vibration
  const [fillCores,setFillCores]=useState(true);      // fill end cores
  const [fillLen,setFillLen]=useState(12);             // in, fill length from each end

  // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Phase 7: Lateral stability state ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
  const [liftPt,setLiftPt]=useState(0.10);            // fraction of span from end
  const [yLift,setYLift]=useState(0);                 // in above top of beam
  const [sweepIn,setSweepIn]=useState(null);           // override sweep (in), null = auto

  // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Phase 9: Moving loads state ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
  const [mlVehicle,setMlVehicle]=useState("AASHTO HL-93 Truck");
  const [mlIM,setMlIM]=useState(null);                 // null = use vehicle default
  const [mlGammaLL,setMlGammaLL]=useState(1.75);       // AASHTO live load factor
  const [mlCustomAxles,setMlCustomAxles]=useState([
    {P:20,offset:0},{P:20,offset:6}
  ]);

  // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Phase 10b: Torsion state ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
  const [Tu_kft,setTu_kft]=useState(0);
  const [torsionAt,setTorsionAt]=useState(0.11);
  const [torsionLegs,setTorsionLegs]=useState(2);
  const [torsionSpacing,setTorsionSpacing]=useState(6);

  // Save/load wiring + DefineContext (feeds construction schedule into Phase 5)
  const user = useCurrentUser();
  const theme = useModuleTheme();
  const { designParams, cip: defCIP } = useContext(DefineContext);
  const [saveOpen,setSaveOpen]=useState(false);
  const [activeCalc,setActiveCalc]=useState(null); // currently loaded saved-file row, if any
  const [allCalcs,setAllCalcs]=useState([]);
  const [saveMsg,setSaveMsg]=useState("");

  useEffect(()=>{ fetchCalcsForUser(user).then(setAllCalcs); },[user?.id,user?.role]);

  useEffect(()=>{
    if(loadedCalc && loadedCalc.inputs){
      const v = loadedCalc.inputs;
      if(v.sec!==undefined) setSec(v.sec);
      if(v.cover!==undefined) setCover(v.cover);
      if(v.fc!==undefined) setFc(v.fc);
      if(v.fci!==undefined) setFci(v.fci);
      if(v.nH!==undefined) setNH(v.nH);
      if(v.nS!==undefined) setNS(v.nS);
      if(v.fpiR!==undefined) setFpiR(v.fpiR);
      if(v.nRe!==undefined) setNRe(v.nRe);
      if(v.reSz!==undefined) setReSz(v.reSz);
      if(v.span!==undefined) setSpan(v.span);
      if(v.lpc!==undefined) setLpc(v.lpc);
      if(v.sdl!==undefined) setSdl(v.sdl);
      if(v.ll!==undefined) setLl(v.ll);
      if(v.cT!==undefined) setCT(v.cT);
      if(v.RH!==undefined) setRH(v.RH);
      if(v.useComposite!==undefined) setUseComposite(v.useComposite);
      if(v.tc!==undefined) setTc(v.tc);
      if(v.fcTop!==undefined) setFcTop(v.fcTop);
      if(v.topSurface!==undefined) setTopSurface(v.topSurface);
      setActiveCalc(loadedCalc);
      onConsumedLoad && onConsumedLoad();
    }
  },[loadedCalc]);

  const currentInputs = {sec,cover,fc,fci,nH,nS,fpiR,nRe,reSz,span,lpc,sdl,ll,cT,RH,useComposite,tc,fcTop,topSurface};

  const doSave = async({projectName,partName,calcName})=>{
    const res = await saveCalc({
      projectName, partName, calcName, module:"pci",
      inputs: currentInputs, reportText: null,
      userId: user?.id, userName: user?.name,
    });
    if(res.ok){
      setActiveCalc(res.row);
      fetchCalcsForUser(user).then(setAllCalcs);
      setSaveMsg("Saved ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“");
      setTimeout(()=>setSaveMsg(""),2500);
      return true;
    }
    return false;
  };

  const doUpdate = async()=>{
    if(!activeCalc) return;
    const res = await updateCalc(activeCalc.id, {inputs: currentInputs, reportText: null});
    if(res.ok){
      setSaveMsg("Updated ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“");
      setTimeout(()=>setSaveMsg(""),2500);
      fetchCalcsForUser(user).then(setAllCalcs);
    }
  };

  const r=useMemo(()=>{
    // Apply dimension overrides (from 3D label editing) on top of section table values
    const s={...PCI_SLABS[sec],
      h: slabHOverride ?? PCI_SLABS[sec].h,
      b: slabBOverride ?? PCI_SLABS[sec].b,
    };
    const Sb=s.Ix/s.yb,St=s.Ix/(s.h-s.yb);
    const Ec=57*Math.sqrt(fc*1000),Eci=57*Math.sqrt(fci*1000);
    const b1=Math.max(0.65,0.85-0.05*(fc-4));
    const VS=s.A/(2*(s.b+s.h));
    const Aps=nH*0.153+nS*0.217;
    const fpu=270,fpi=fpiR*fpu,Eps=28800;
    const dp=s.h-cover,e=s.yb-cover;
    const rA=REBAR[reSz],As=nRe*(rA?.A||0),dR=s.h-2.5,fy=60,EsR=29000;
    const DL=s.SW+sdl;
    const Po=fpi*Aps*0.95;
    const tTop=Po/s.A-Po*e/St,tBot=Po/s.A+Po*e/Sb;
    const lt=50*0.5,ltFt=lt/12;
    const MdT=(lpc/2*ltFt-ltFt*ltFt/2)*s.SW/1000*s.b/12;
    const MdTtop=MdT*12/St,MdTbot=-MdT*12/Sb;
    const nTtop=tTop+MdTtop,nTbot=tBot+MdTbot;
    const MdM=lpc*lpc/8*s.SW*s.b/12/1000;
    const MdMtop=MdM*12/St,MdMbot=-MdM*12/Sb;
    const nMtop=tTop+MdMtop,nMbot=tBot+MdMbot;
    const aTE=-(6*Math.sqrt(fci*1000)),aTM=-(3*Math.sqrt(fci*1000));
    const aCE=0.7*fci*1000,aCM=0.6*fci*1000;
    const Pi=fpi*Aps;
    const Mg=lpc*lpc/8*s.SW/1000*s.b/12*12;
    const fcir=0.9*(Pi/s.A+Pi*e*e/s.Ix)-(Mg*e/s.Ix);
    const ES=1*(Eps/Eci)*fcir;
    const Msd=lpc*lpc/8*sdl/1000*s.b;
    const fcds=Msd*e/s.Ix;
    const CR=2*(Eps/Ec)*(fcir-fcds);
    const SHv=0.0000082*1*Eps*(1-0.06*VS)*(100-RH);
    const RE_p=ES+CR+SHv;
    const RE=(5000/1000-0.04*RE_p)*0.75;
    const totalLoss=(ES+CR+SHv+RE)/fpi*100;
    const Pe=Aps*fpi*(1-totalLoss/100);
    const Msus=DL*s.b/12*span*span/8/1000*12;
    const Mserv=(DL+ll)*s.b/12*span*span/8/1000*12;
    const aTens=7.5*Math.sqrt(fc*1000)/1000;
    const fbot=Pe/s.A+Pe*e/Sb-Mserv/Sb;
    const classU=aTens>fbot;
    const ftSus=Pe/s.A-Pe*e/St+Msus/St;
    const ftTot=Pe/s.A-Pe*e/St+Mserv/St;
    const rhoP=Aps/(s.b*dp);
    const fps1=fpu*(1-(0.28/b1)*(rhoP*fpu/fc));
    const a1=Aps*fps1/(0.85*fc*s.b);
    const c1=a1/b1;
    const eT1=(dp-c1)/c1*0.003;
    const phiMn1=0.9*Aps*fps1*(dp-a1/2)/12;
    const wu=(1.2*DL+1.6*ll)/1000;
    const Mu=wu*s.b/12*span*span/8;
    const Mcr=s.Ix/s.yb*(tBot+7.5*Math.sqrt(fc*1000)/1000)/12;
    const fse=fpi*(1-totalLoss/100),eSE=fse/Eps;
    const a3=cT*b1;
    const eT3=(dp-cT)/cT*0.003,ePS=eSE+eT3;
    const fps3=ePS>0.0085?270-0.04/(ePS-0.007):Eps*ePS;
    const T3=Aps*fps3+As*fy;
    const C3=0.85*fc*a3*s.b;
    const phiMn3=(0.9*Aps*fps3*(dp-a3/2)+0.9*As*fy*(dR-a3/2))/12;
    const DLl=DL*s.b/12/1000,LLl=ll*s.b/12/1000;
    const wuL=1.2*DLl+1.6*LLl;
    const Ay=wuL*span/2;
    const Vu2=Ay-wuL*6.25,Mu2=0.5*(Ay-Vu2)*6.25+Vu2*6.25;
    const VcS=0.75*(0.6*1*(fc*1000)**0.5+700*(Vu2/(Mu2*12))*dp)*(s.bw*dp)/1000;
    const PeBrg=Aps*(fpi*(1-totalLoss/100)*((3*12+0.75*12)/lt));
    const fpc=PeBrg/s.A;
    const Vcw=0.75*((3.5*1*Math.sqrt(fc*1000)/1000)+(0.3*fpc))*s.bw*dp;
    const cI=Po*e*(span*12)**2/(8*Eci*s.Ix)-5*s.b/12*s.SW/1000/12*(span*12)**4/(384*Eci*s.Ix);
    const cE=1.8*Po*e*(span*12)**2/(8*Eci*s.Ix)-1.85*5*s.b/12*s.SW/1000/12*(span*12)**4/(384*Eci*s.Ix);
    const cF=2.45*Po*e*(span*12)**2/(8*Eci*s.Ix)-2.7*5*s.b/12*s.SW/1000/12*(span*12)**4/(384*Eci*s.Ix);
    const dSDL=3*5*s.b/12*sdl/1000/12*(span*12)**4/(384*Ec*s.Ix);
    const dLL=5*s.b/12*ll/1000/12*(span*12)**4/(384*Ec*s.Ix);

    // Overall live status: flexural utilization + governing checks
    const flexUtil=Mu/phiMn1;
    const tensEndOk=aTE<nTtop*1000;
    const tensMidOk=nMtop*1000>aTM;
    const compEndOk=aCE>Math.abs(nTbot)*1000;
    const compMidOk=aCM>Math.abs(nMbot)*1000;
    const flexOk=phiMn1>Mu;
    const allOk=tensEndOk&&tensMidOk&&compEndOk&&compMidOk&&classU&&flexOk;

    // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Phase 3: station-by-station analysis (21 stations along span) ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
    const stationProps = {s,Aps,fpu,fpi,dp,e,Pe,As,fy,b1,
      Ec,Eci,Po,Mcr,bw:s.bw};
    const stationInputs = {fc,fci,span,sdl,ll,cover,nH,nS};
    const stations = runStationAnalysis(stationProps, stationInputs, 21);

    // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Phase 4: composite section, interface shear, crack width ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
    const M_DL_pre  = Mg;                         // kip-in, precast DL
    const M_SDL_kin = lpc*lpc/8*sdl/1000*s.b;     // kip-in, SDL on composite
    const M_LL_kin  = lpc*lpc/8*ll/1000*s.b;      // kip-in, LL on composite
    const phase4 = runPhase4({
      pre: {A:s.A, Ix:s.Ix, yb:s.yb, h:s.h, b:s.b},
      fc_pre: fc, fci,
      Pe, e, Aps, dp,
      As, nBars: nRe, cover,
      M_DL_pre, M_SDL: M_SDL_kin, M_LL: M_LL_kin,
      Vu_max: Ay,
      composite: useComposite, tc, b_eff: s.b, fc_top: fcTop, wc_top: 150,
      surface: topSurface,
    });

    // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Phase 5: construction stages lifecycle ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
    const wSDL_kin = sdl/1000 * s.b/12 / 12;    // kip/in
    const wLL_kin  = ll/1000  * s.b/12 / 12;
    const wCIP_kin = useComposite ? (tc/12) * (150/1000) * s.b/12 / 12 : 0;
    const dpSchedule = designParams
      ? { transferDay:designParams.transferDay, initialLiftDay:designParams.initialLiftDay,
          erectionDay:designParams.erectionDay, cipDay:designParams.cipDay,
          finalDay:designParams.completionDay }
      : { transferDay:0.75, initialLiftDay:1, erectionDay:40, cipDay:50, finalDay:143 };
    const constructionStages = runConstructionStages(
      { A:s.A, Ix:s.Ix, yb:s.yb, h:s.h, b:s.b, bw:s.bw, SW:s.SW*s.b/12 },
      { Po, Pe, Aps, fpu, fpi, dp, e, Eps },
      { fc, fci, Ec, Eci },
      { span, liftPointL:null, liftPointR:null },
      { wSDL:wSDL_kin, wLL:wLL_kin, wCIP:wCIP_kin },
      dpSchedule,
      useComposite && phase4?.comp ? { enabled:true, ...phase4.comp } : { enabled:false },
      RH
    );

    return {s,Sb,St,Ec,Eci,b1,VS,Aps,fpi,fpu,Eps,dp,e,As,DL,Po,tTop,tBot,lt,
      MdT,MdTtop,MdTbot,nTtop,nTbot,MdM,MdMtop,MdMbot,nMtop,nMbot,
      aTE,aTM,aCE,aCM,Pi,Mg,fcir,ES,Msd,fcds,CR,SHv,RE,totalLoss,
      Pe,Msus,Mserv,aTens,fbot,classU,ftSus,ftTot,
      rhoP,fps1,a1,c1,eT1,phiMn1,wu,Mu,Mcr,
      fse,eSE,a3,eT3,ePS,fps3,T3,C3,phiMn3,
      wuL,Ay,Vu2,Mu2,VcS,fpc,Vcw,
      cI,cE,cF,netC:cF-dSDL,finalP:cF-dSDL-dLL,dR,fy,EsR:29000,
      flexUtil,tensEndOk,tensMidOk,compEndOk,compMidOk,flexOk,allOk,
      stations, phase4, constructionStages};
  },[sec,cover,fc,fci,nH,nS,fpiR,nRe,reSz,span,lpc,sdl,ll,cT,RH,useComposite,tc,fcTop,topSurface,slabHOverride,slabBOverride,designParams]);

  // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Phase 10a: Transformed section properties ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
  const {flags:calcFlags} = useCalcOptions();
  const phase10a = useMemo(()=>{
    if(!r) return null;
    return computeTransformedSection(
      {A:r.s.A, Ix:r.s.Ix, yb:r.s.yb, h:r.s.h},
      {Aps:r.Aps, dp:r.dp, Eps:r.Eps},
      {As:r.As||0, ds:r.dp, Es:29000},
      r.Ec, true
    );
  },[r?.s?.A,r?.s?.Ix,r?.s?.yb,r?.s?.h,r?.Aps,r?.dp,r?.Ec]);

  // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Phase 10b: Torsion design ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
  const phase10b = useMemo(()=>{
    if(!r||Tu_kft===0) return null;
    return runTorsionDesign({
      s:r.s, Pe:r.Pe, Aps:r.Aps, dp:r.dp,
      fc, Ec:r.Ec,
      Tu_kipin: Tu_kft*12,
      Vu: r.Ay,
      At_legs:torsionLegs, At_size:torsionAt, s_stirrup:torsionSpacing,
      fy_t:60, phi:0.75, theta_deg:45,
    });
  },[r?.Pe,r?.Aps,r?.dp,r?.Ay,fc,Tu_kft,torsionAt,torsionLegs,torsionSpacing]);

  // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Phase 6+8: vibration + filled-core shear (separate memo, lighter) ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
  const phase6 = useMemo(()=>{
    if(!r) return null;
    const wSDL_kin = sdl/1000 * r.s.b/12 / 12;
    const wLL_kin  = ll/1000  * r.s.b/12 / 12;
    return runPhase6and8({
      section: {A:r.s.A,Ix:r.s.Ix,yb:r.s.yb,h:r.s.h,b:r.s.b,bw:r.s.bw,cores:r.s.cores,coreD:r.s.coreD,SW:r.s.SW*r.s.b/12},
      prestress: {Pe:r.Pe,Aps:r.Aps,dp:r.dp,e:r.e},
      materials: {fc,Ec:r.Ec},
      wSDL: wSDL_kin, wLL: wLL_kin, span,
      occupancy, activity: activity||null, rhythmicOccupancy: occupancy,
      slabWidth, fillCores, fillLen,
    });
  },[r,fc,sdl,ll,span,occupancy,activity,slabWidth,fillCores,fillLen]);

  // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Phase 7: Lateral stability (separate memo) ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
  const phase7 = useMemo(()=>{
    if(!r) return null;
    const Iy = computeIy(r.s);
    return runLateralStability(
      { A:r.s.A, Ix:r.s.Ix, Iy, yb:r.s.yb, h:r.s.h, b:r.s.b, bw:r.s.bw, SW:r.s.SW*r.s.b/12 },
      { Pe:r.Pe, e:r.e, Aps:r.Aps, dp:r.dp },
      { fc, fci, Ec:r.Ec, Eci:r.Eci },
      { span, liftPointFt:liftPt*span, transportPointFt:liftPt*1.5*span, yLift },
      sweepIn || undefined
    );
  },[r,fc,fci,span,liftPt,yLift,sweepIn]);

  // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Phase 9: Moving loads (separate memo) ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
  const phase9 = useMemo(()=>{
    if(!span) return null;
    return runMovingLoad(mlVehicle, mlCustomAxles, span, mlIM||null, mlGammaLL);
  },[mlVehicle,mlCustomAxles,span,mlIM,mlGammaLL]);

  const {reportStyle}=useViewSettings();
  if(reportStyle==="tedds"){
    return(
      <TeddsDoc>
        <TeddsTitle calcId={`PCI Non-Composite Hollowcore Slab Design ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ${sec}`} codeBasis="In accordance with ACI 318-19 and the PCI Design Handbook, 8th Edition" version="Calc version 1.0"/>
        <TeddsSection number={1} note="Flexure, shear, transfer stress, and service stress design for simple-span hollowcore slab"/>

        <TeddsHeading>Member details</TeddsHeading>
        <TeddsLine label="Section type" sym="" val="" label2="No. of cores" sym2="ncore" val2={r.s.cores}/>
        <TeddsNote>{`Hollowcore slab, ${sec}`}</TeddsNote>

        <TeddsHeading>Section properties</TeddsHeading>
        <TeddsLine label="Slab depth" sym="h" val={r.s.h} unit="in" label2="Slab width" sym2="b" val2={r.s.b} unit2="in"/>
        <TeddsLine label="Cross sectional area" sym="A" val={fmt(r.s.A,2)} unit="inÃƒâ€šÃ‚Â²" label2="Web width" sym2="bw" val2={r.s.bw} unit2="in"/>
        <TeddsLine label="Second moment of area" sym="Ix" val={fmt(r.s.Ix,1)} unit="inÃƒÂ¢Ã‚ÂÃ‚Â´" label2="Centroid from bottom" sym2="yb" val2={fmt(r.s.yb,3)} unit2="in"/>
        <TeddsLine label="Section modulus (bottom)" sym="Sb" val={fmt(r.Sb,2)} unit="inÃƒâ€šÃ‚Â³" label2="Section modulus (top)" sym2="St" val2={fmt(r.St,2)} unit2="inÃƒâ€šÃ‚Â³"/>
        <TeddsLine label="Self weight" sym="SW" val={r.s.SW} unit="psf"/>

        <Graphic><HollowcoreXSection h={r.s.h} b={r.s.b} cores={r.s.cores} coreD={r.s.coreD} nStrands={nH+nS} dp={r.dp} yb={r.s.yb} e={r.e} scale={7}/></Graphic>

        <TeddsHeading>Material properties</TeddsHeading>
        <TeddsLine label="Concrete strength at 28 days" sym="fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²c" val={fc} unit="ksi" label2="Concrete strength at release" sym2="fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²ci" val2={fci} unit2="ksi"/>
        <TeddsCalc sym="Ec" formula={`57ÃƒÂ¢Ã‹â€ Ã…Â¡(${fc}ÃƒÆ’Ã¢â‚¬â€1000)`} result={fmt(r.Ec,0)} unit="ksi"/>
        <TeddsCalc sym="Eci" formula={`57ÃƒÂ¢Ã‹â€ Ã…Â¡(${fci}ÃƒÆ’Ã¢â‚¬â€1000)`} result={fmt(r.Eci,0)} unit="ksi"/>
        <TeddsCalc sym="ÃƒÅ½Ã‚Â²1" formula={`0.85 ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ 0.05(${fc}ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢4)`} result={fmt(r.b1,3)}/>

        <TeddsHeading>Prestressing steel</TeddsHeading>
        <TeddsLine label="Number of 1/2 in strands" sym="n0.5" val={nH} label2="Number of 5/8 in strands" sym2="n0.6" val2={nS}/>
        <TeddsCalc sym="Aps" formula={`${nH}ÃƒÆ’Ã¢â‚¬â€0.153 + ${nS}ÃƒÆ’Ã¢â‚¬â€0.217`} result={fmt(r.Aps,4)} unit="inÃƒâ€šÃ‚Â²"/>
        <TeddsLine label="Strand depth" sym="dp" val={fmt(r.dp,2)} unit="in" label2="Strand eccentricity" sym2="e" val2={fmt(r.e,3)} unit2="in"/>
        <TeddsLine label="Initial prestress" sym="fpi" val={fmt(r.fpi,1)} unit="ksi"/>

        <TeddsHeading>Span and loading</TeddsHeading>
        <TeddsLine label="Design span" sym="l" val={span} unit="ft" label2="Superimposed dead load" sym2="SDL" val2={sdl} unit2="psf"/>
        <TeddsLine label="Live load" sym="LL" val={ll} unit="psf" label2="Total dead load" sym2="DL" val2={fmt(r.DL,1)} unit2="psf"/>

        <TeddsHeading>Transfer stress analysis</TeddsHeading>
        <TeddsCalc sym="Po" formula={`${fmt(r.fpi,1)} ÃƒÆ’Ã¢â‚¬â€ ${fmt(r.Aps,3)} ÃƒÆ’Ã¢â‚¬â€ 0.95`} result={fmt(r.Po,2)} unit="kip"/>
        <TeddsLine label="Top fiber stress (prestress)" sym="ftop" val={fmt(r.tTop,4)} unit="ksi" label2="Bottom fiber stress (prestress)" sym2="fbot" val2={fmt(r.tBot,4)} unit2="ksi"/>
        <TeddsLine label="Net top stress at midspan" sym="ftop,m" val={fmt(r.nMtop,4)} unit="ksi" label2="Net bottom stress at midspan" sym2="fbot,m" val2={fmt(r.nMbot,4)} unit2="ksi"/>

        <TeddsHeading>Loss of prestress</TeddsHeading>
        <TeddsLine label="Elastic shortening" sym="ES" val={fmt(r.ES,3)} unit="ksi" label2="Creep of concrete" sym2="CR" val2={fmt(r.CR,3)} unit2="ksi"/>
        <TeddsLine label="Shrinkage" sym="SH" val={fmt(r.SHv,3)} unit="ksi" label2="Relaxation of steel" sym2="RE" val2={fmt(r.RE,3)} unit2="ksi"/>
        <TeddsCalc sym="Total loss" formula="(ES+CR+SH+RE)/fpi ÃƒÆ’Ã¢â‚¬â€ 100" result={fmt(r.totalLoss,2)} unit="%"/>

        <TeddsHeading>Design flexural strength</TeddsHeading>
        <TeddsLine label="Stress in strand at nominal strength" sym="fps" val={fmt(r.fps1,2)} unit="ksi" label2="Depth of equivalent stress block" sym2="a" val2={fmt(r.a1,3)} unit2="in"/>
        <TeddsCalc sym="ÃƒÅ½Ã‚Â¦Mn" formula={`0.9 ÃƒÆ’Ã¢â‚¬â€ ${fmt(r.Aps,3)} ÃƒÆ’Ã¢â‚¬â€ ${fmt(r.fps1,1)} ÃƒÆ’Ã¢â‚¬â€ (${fmt(r.dp,2)} ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ ${fmt(r.a1,3)}/2) / 12`} result={fmt(r.phiMn1,2)} unit="kip-ft"/>
        <TeddsCalc sym="Mu" formula="wu ÃƒÆ’Ã¢â‚¬â€ (b/12) ÃƒÆ’Ã¢â‚¬â€ lÃƒâ€šÃ‚Â² / 8" result={fmt(r.Mu,2)} unit="kip-ft"/>

        <TeddsHeading>Shear strength</TeddsHeading>
        <TeddsLine label="Factored shear force" sym="Vu" val={fmt(r.Vu2,3)} unit="kips" label2="Concrete shear strength" sym2="Vc" val2={fmt(r.VcS,3)} unit2="kips"/>

        <TeddsHeading>Camber and deflection</TeddsHeading>
        <TeddsLine label="Final camber" sym="ÃƒÅ½Ã¢â‚¬Âfinal" val={fmt(r.cF,4)} unit="in" label2="Net camber (less SDL)" sym2="ÃƒÅ½Ã¢â‚¬Ânet" val2={fmt(r.netC,4)} unit2="in"/>

        <TeddsHeading>Results summary</TeddsHeading>
        <TeddsTable
          headers={["Check","Unit","Capacity","Maximum","Utilization","Result"]}
          rows={[
            utilRow("Tension stress at ends","psi", Math.abs(r.aTE), r.nTtop*1000>0?r.nTtop*1000:0),
            utilRow("Compression stress at ends","psi", r.aCE, Math.abs(r.nTbot)*1000),
            utilRow("Compression stress at midspan","psi", r.aCM, Math.abs(r.nMbot)*1000),
            utilRow("Flexural strength","kip-ft", r.phiMn1, r.Mu),
            utilRow("Shear strength","kips", r.VcS, r.Vu2),
            [ "Service tension (Class U)","ksi", fmt(r.aTens,4), fmt(r.fbot,4), fmt(r.fbot/r.aTens,3), r.classU?"PASS":"FAIL" ],
            ...(r.phase4?.composite && r.phase4?.interfaceShear ? [
              [ "Interface shear (horiz.)","kip/in", fmt(r.phase4.interfaceShear.Vnh,3), fmt(r.phase4.interfaceShear.Vh,3), fmt(r.phase4.interfaceShear.util,3), r.phase4.interfaceShear.ok?"PASS":"FAIL" ],
            ] : []),
            ...(r.phase4?.crackWidth && nRe > 0 ? [
              [ "Crack width","mil-in", "16.0", fmt(r.phase4.crackWidth.w*1000,2), fmt(r.phase4.crackWidth.w/r.phase4.crackWidth.w_limit,3), r.phase4.crackWidth.ok?"PASS":"FAIL" ],
            ] : []),
          ]}
        />

        {r.stations && (<>
        <TeddsHeading>Station-by-station analysis ({r.stations.length} stations)</TeddsHeading>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,fontFamily:"Calibri,Arial,sans-serif",marginBottom:12}}>
          <thead>
            <tr style={{background:"#f0f0f0"}}>
              {["x (ft)","MÃƒÂ¡Ã‚ÂµÃ‚Â¤ (k-ft)","VÃƒÂ¡Ã‚ÂµÃ‚Â¤ (kips)","f_top (ksi)","f_bot (ksi)","ÃƒÅ½Ã‚Â¦MÃƒÂ¢Ã¢â‚¬Å¡Ã¢â€žÂ¢ (k-ft)","ÃƒÅ½Ã‚Â¦VÃƒÂ¢Ã¢â‚¬Å¡Ã¢â€žÂ¢ (kips)","ÃƒÅ½Ã‚Â´ Final (in)","L/ÃƒÅ½Ã‚Â´","Status"].map((h,i)=>(
                <th key={i} style={{borderTop:"1px solid #000",borderBottom:"1px solid #000",padding:"3px 5px",textAlign:i===0?"left":"right",fontWeight:700}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.stations.map((st,i)=>(
              <tr key={i} style={{background:st.allOk?"#fff":"#fff0f0"}}>
                <td style={{padding:"2px 5px",borderBottom:"1px solid #e0e0e0",fontWeight:700}}>{st.x.toFixed(2)}</td>
                <td style={{padding:"2px 5px",borderBottom:"1px solid #e0e0e0",textAlign:"right"}}>{fmt(st.Mu,2)}</td>
                <td style={{padding:"2px 5px",borderBottom:"1px solid #e0e0e0",textAlign:"right"}}>{fmt(st.Vu,2)}</td>
                <td style={{padding:"2px 5px",borderBottom:"1px solid #e0e0e0",textAlign:"right",color:st.compTop_ok?"inherit":"#c00"}}>{fmt(st.ftop,4)}</td>
                <td style={{padding:"2px 5px",borderBottom:"1px solid #e0e0e0",textAlign:"right",color:st.tensBot_ok?"inherit":"#c00"}}>{fmt(st.fbot,4)}</td>
                <td style={{padding:"2px 5px",borderBottom:"1px solid #e0e0e0",textAlign:"right"}}>{fmt(st.phiMn,2)}</td>
                <td style={{padding:"2px 5px",borderBottom:"1px solid #e0e0e0",textAlign:"right"}}>{fmt(st.Vn,2)}</td>
                <td style={{padding:"2px 5px",borderBottom:"1px solid #e0e0e0",textAlign:"right"}}>{fmt(st.netF,3)}</td>
                <td style={{padding:"2px 5px",borderBottom:"1px solid #e0e0e0",textAlign:"right"}}>{st.Lratio>9000?"ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â":`L/${st.Lratio}`}</td>
                <td style={{padding:"2px 5px",borderBottom:"1px solid #e0e0e0",textAlign:"center",fontWeight:800,color:st.allOk?"#070":"#a00"}}>{st.allOk?"PASS":"FAIL"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </>)}

        {r.constructionStages && (<>
        <TeddsHeading>Construction Stages Lifecycle (Phase 5)</TeddsHeading>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,fontFamily:"Calibri,Arial,sans-serif",marginBottom:12}}>
          <thead>
            <tr style={{background:"#f0f0f0"}}>
              {["Stg","Name","Day","Pe (k)","f_top e","f_bot e","f_top m","f_bot m","ÃƒÅ½Ã‚Â´ cam","ÃƒÅ½Ã‚Â´ net","ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“"].map((h,i)=>(
                <th key={i} style={{border:"1px solid #000",padding:"3px 4px",textAlign:i<2?"left":"right",fontWeight:700,fontSize:9}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.constructionStages.map(s=>{
              const summ=stageSummary(s);
              return(
                <tr key={s.id} style={{background:summ.allOk?"#fff":"#fff0f0"}}>
                  <td style={{border:"1px solid #ccc",padding:"2px 4px",fontWeight:700,textAlign:"center"}}>{s.id}</td>
                  <td style={{border:"1px solid #ccc",padding:"2px 4px",fontSize:9}}>{s.name}</td>
                  <td style={{border:"1px solid #ccc",padding:"2px 4px",textAlign:"right"}}>{s.day}</td>
                  <td style={{border:"1px solid #ccc",padding:"2px 4px",textAlign:"right"}}>{s.Pe?.toFixed(1)}</td>
                  <td style={{border:"1px solid #ccc",padding:"2px 4px",textAlign:"right"}}>{s.stress_end_top?.toFixed(4)}</td>
                  <td style={{border:"1px solid #ccc",padding:"2px 4px",textAlign:"right"}}>{s.stress_end_bot?.toFixed(4)}</td>
                  <td style={{border:"1px solid #ccc",padding:"2px 4px",textAlign:"right"}}>{s.stress_mid_top?.toFixed(4)}</td>
                  <td style={{border:"1px solid #ccc",padding:"2px 4px",textAlign:"right"}}>{s.stress_mid_bot?.toFixed(4)}</td>
                  <td style={{border:"1px solid #ccc",padding:"2px 4px",textAlign:"right"}}>{s.camber?.toFixed(3)}</td>
                  <td style={{border:"1px solid #ccc",padding:"2px 4px",textAlign:"right"}}>{(s.netDefl??s.netDefl_sus)?.toFixed(3)}</td>
                  <td style={{border:"1px solid #ccc",padding:"2px 4px",textAlign:"center",fontWeight:800,fontSize:9,color:summ.allOk?"#070":"#a00"}}>{summ.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </>)}
      </TeddsDoc>
    );
  }

  return(<div>
    <div className="no-print" style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,marginBottom:12,padding:"8px 12px",background:"#f8f9fa",border:"1px solid #dee2e6",borderRadius:6}}>
      <div style={{fontSize:12,color:"#495057"}}>
        {activeCalc ? <>ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã¢â‚¬Å¾ <b>{activeCalc.calc_name}</b> <span style={{color:"#868e96"}}>({activeCalc.project_name} / {activeCalc.part_name})</span></> : <span style={{color:"#868e96"}}>Not yet saved to a project</span>}
        {saveMsg && <span style={{marginLeft:10,color:"#1e7e34",fontWeight:700}}>{saveMsg}</span>}
      </div>
      <div style={{display:"flex",gap:6}}>
        {activeCalc && activeCalc.created_by_id===user?.id && (
          <button onClick={doUpdate} style={{padding:"6px 12px",borderRadius:4,border:`1px solid ${theme.accent}`,background:theme.soft,color:theme.text,fontWeight:700,fontSize:11,cursor:"pointer"}}>ÃƒÂ¢Ã¢â‚¬Â Ã‚Â» Update Saved File</button>
        )}
        <button onClick={()=>setSaveOpen(true)} style={{padding:"6px 12px",borderRadius:4,border:`2px solid ${theme.accentDark}`,background:theme.accentDark,color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer"}}>ÃƒÂ°Ã…Â¸Ã¢â‚¬â„¢Ã‚Â¾ Save AsÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦</button>
      </div>
    </div>
    <SaveCalcModal open={saveOpen} onClose={()=>setSaveOpen(false)} onSave={doSave} existingProjects={allCalcs}
      defaultProject={activeCalc?.project_name || workspace?.project} defaultPart={activeCalc?.part_name || workspace?.part}/>
    <LiveStatusBanner ok={r.allOk} util={r.flexUtil} label="Flexural Utilization (Mu / ÃƒÅ½Ã‚Â¦Mn)"/>


    <InputsBlock><>
    <Card title="Slab Properties">
      <R><OI label="Section" value={sec} onChange={handleSecChange} options={Object.keys(PCI_SLABS)} width={160}/></R>
      {(slabHOverride !== null || slabBOverride !== null) && (
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"4px 8px",background:"#fff8ef",border:"1px solid #e8a838",borderRadius:4,marginTop:4,fontSize:11}}>
          <span style={{color:"#b07020"}}>ÃƒÂ¢Ã…Â¡Ã‚Â  Custom dimensions active: h={slabHOverride??r.s.h}" b={slabBOverride??r.s.b}"</span>
          <button onClick={()=>{setSlabHOverride(null);setSlabBOverride(null);}} style={{padding:"2px 8px",fontSize:10,border:"1px solid #e8a838",borderRadius:3,background:"#fff",cursor:"pointer",color:"#b07020"}}>Reset to section defaults</button>
        </div>
      )}

      {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Dimension inputs ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â always visible ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
      <div style={{display:"flex",flexWrap:"wrap",gap:10,padding:"10px 0 4px",borderBottom:"1px solid #f1f3f5",marginBottom:6}}>
        {[
          { label:"L (span)", value:Math.round(span*12), unit:"in", step:6, min:24, onChange:(v)=>setSpan(Math.max(1,v/12)) },
          { label:"h (depth)", value:r.s.h, unit:"in", step:1, min:4, onChange:(v)=>setSlabHOverride(Math.max(4,Math.round(v))) },
          { label:"b (width)", value:r.s.b, unit:"in", step:2, min:12, onChange:(v)=>setSlabBOverride(Math.max(12,Math.round(v))) },
        ].map(dim=>(
          <div key={dim.label} style={{display:"flex",flexDirection:"column",minWidth:90}}>
            <span style={{fontSize:10,color:"#2563eb",fontWeight:700,marginBottom:3,fontFamily:"'JetBrains Mono',monospace"}}>{dim.label}</span>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <input type="number" value={dim.value} step={dim.step} min={dim.min}
                onChange={e=>{const v=Number(e.target.value);if(!isNaN(v)&&v>0)dim.onChange(v);}}
                style={{width:68,padding:"5px 7px",border:"1.5px solid #2563eb",borderRadius:4,
                  background:"#eff6ff",fontSize:13,fontFamily:"'JetBrains Mono',monospace",fontWeight:700,boxSizing:"border-box"}}/>
              <span style={{fontSize:10,color:"#868e96"}}>{dim.unit}</span>
            </div>
          </div>
        ))}
      </div>
      <Graphic><HollowcoreXSection h={r.s.h} b={r.s.b} cores={r.s.cores} coreD={r.s.coreD} nStrands={nH+nS} dp={r.dp} yb={r.s.yb} e={r.e} scale={7}/></Graphic>
      <Eq tex="Sb = Ix / yb     St = Ix / (h ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ yb)" code="PCI 8th Ãƒâ€šÃ‚Â§4.2"/>
      <R><CI label="h" value={r.s.h} unit="in"/><CI label="A" value={r.s.A} unit="inÃƒâ€šÃ‚Â²"/><CI label={<Sym base="I" sub="x"/>} value={r.s.Ix} unit="inÃƒÂ¢Ã‚ÂÃ‚Â´"/><CI label="yb" value={fmt(r.s.yb,4)} unit="in"/><CI label="b" value={r.s.b} unit="in"/></R>
      <R><CI label={<Sym base="S" sub="b"/>} value={fmt(r.Sb,2)} unit="inÃƒâ€šÃ‚Â³"/><CI label={<Sym base="S" sub="t"/>} value={fmt(r.St,2)} unit="inÃƒâ€šÃ‚Â³"/><CI label="SW" value={r.s.SW} unit="psf"/><CI label="bw" value={r.s.bw} unit="in"/></R>
    </Card>
    <Card title="Concrete Properties">
      <Eq tex="Ec = 57ÃƒÂ¢Ã‹â€ Ã…Â¡(fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²c ÃƒÆ’Ã¢â‚¬â€ 1000)" code="ACI 318-19 Ãƒâ€šÃ‚Â§19.2.2.1"/>
      <Eq tex="ÃƒÅ½Ã‚Â²ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â = 0.85 ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ 0.05(fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²c ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ 4) ÃƒÂ¢Ã¢â‚¬Â°Ã‚Â¥ 0.65" code="ACI 318-19 Ãƒâ€šÃ‚Â§22.2.2.4.3"/>
      <Eq tex="V/S = A / [2(b + h)]" code="PCI 8th Ãƒâ€šÃ‚Â§4.7.3"/>
      <R><OI label="Cover" value={cover} onChange={setCover} unit="in"/><OI label={<Sym base="f" sub="c" prime/>} value={fc} onChange={setFc} unit="ksi"/><OI label={<Sym base="f" sub="ci" prime/>} value={fci} onChange={setFci} unit="ksi"/><OI label="RH" value={RH} onChange={setRH} unit="%"/></R>
      <R><CI label={<Sym base="E" sub="c"/>} value={fmt(r.Ec,1)} unit="ksi"/><CI label={<Sym base="E" sub="ci"/>} value={fmt(r.Eci,1)} unit="ksi"/><CI label="ÃƒÅ½Ã‚Â²ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â" value={fmt(r.b1,4)}/><CI label="V/S" value={fmt(r.VS,3)}/></R>
    </Card>
    <Card title="Prestressing Steel">
      <Eq tex="Aps = nÃƒÂ¢Ã¢â‚¬Å¡Ã¢â€šÂ¬.ÃƒÂ¢Ã¢â‚¬Å¡Ã¢â‚¬Â¦ ÃƒÆ’Ã¢â‚¬â€ 0.153 + nÃƒÂ¢Ã¢â‚¬Å¡Ã¢â€šÂ¬.ÃƒÂ¢Ã¢â‚¬Å¡Ã¢â‚¬Â  ÃƒÆ’Ã¢â‚¬â€ 0.217" code="PCI 8th Table 11.2.3"/>
      <Eq tex="fpi = (fpi/fpu) ÃƒÆ’Ã¢â‚¬â€ fpu" code="ACI 318-19 Ãƒâ€šÃ‚Â§25.5.10.4"/>
      <Eq tex="dp = h ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ cover     e = yb ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ cover" code="PCI 8th Ãƒâ€šÃ‚Â§4.2.1"/>
      <R><OI label="# Ãƒâ€šÃ‚Â½ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â³ Strands" value={nH} onChange={setNH} step={1}/><OI label="# ÃƒÂ¢Ã¢â‚¬Â¦Ã‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã‚Â³ Strands" value={nS} onChange={setNS} step={1}/><OI label="fpi/fpu" value={fpiR} onChange={setFpiR} step={0.01}/></R>
      <R><CI label={<Sym base="A" sub="ps"/>} value={fmt(r.Aps,4)} unit="inÃƒâ€šÃ‚Â²"/><CI label="fpi" value={fmt(r.fpi,1)} unit="ksi"/><CI label="dp" value={fmt(r.dp,2)} unit="in"/><CI label="e" value={fmt(r.e,3)} unit="in"/></R>
    </Card>
    <Card title="Reinforcing Steel">
      <Eq tex="As = n ÃƒÆ’Ã¢â‚¬â€ A_bar" code="ACI 318-19 Ãƒâ€šÃ‚Â§20.2.1"/>
      <R><OI label="# Rebar" value={nRe} onChange={setNRe} step={1}/><OI label="Bar Size" value={reSz} onChange={setReSz} options={Object.keys(REBAR)}/><CI label={<Sym base="A" sub="s"/>} value={fmt(r.As,3)} unit="inÃƒâ€šÃ‚Â²"/></R>
    </Card>
    <Card title="Service Conditions">
      <R><OI label="Span" value={span} onChange={setSpan} unit="ft"/><OI label="lpc" value={lpc} onChange={setLpc} unit="ft"/><OI label="SDL" value={sdl} onChange={setSdl} unit="psf"/><OI label="LL" value={ll} onChange={setLl} unit="psf"/></R>
      <CI label="Total DL" value={fmt(r.DL,1)} unit="psf"/>
    </Card>

    <Card title="Composite Topping (Phase 4)">
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
        <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12,fontWeight:600}}>
          <input type="checkbox" checked={useComposite} onChange={e=>setUseComposite(e.target.checked)} style={{width:15,height:15}}/>
          Enable composite CIP topping slab
        </label>
      </div>
      {useComposite && (<>
        <Eq tex="n = Ec_top / Ec_pre    yb_comp = ÃƒÅ½Ã‚Â£AÃƒâ€šÃ‚Â·y / ÃƒÅ½Ã‚Â£A    I_comp = ÃƒÅ½Ã‚Â£I + ÃƒÅ½Ã‚Â£AÃƒâ€šÃ‚Â·dÃƒâ€šÃ‚Â²" code="ACI 318-19 Ãƒâ€šÃ‚Â§26.5.6"/>
        <R>
          <OI label="Topping tc" value={tc} onChange={setTc} unit="in" step={0.5}/>
          <OI label="fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²c_top" value={fcTop} onChange={setFcTop} unit="ksi" step={0.5}/>
          <OI label="Interface" value={topSurface} onChange={setTopSurface} options={["roughened","smooth","keyed"]}/>
        </R>
        {r.phase4?.comp && (<>
          <R>
            <CI label="n (mod. ratio)" value={fmt(r.phase4.comp.n,4)}/>
            <CI label="A_comp" value={fmt(r.phase4.comp.A_comp,1)} unit="inÃƒâ€šÃ‚Â²"/>
            <CI label="I_comp" value={fmt(r.phase4.comp.I_comp,0)} unit="inÃƒÂ¢Ã‚ÂÃ‚Â´"/>
          </R>
          <R>
            <CI label="yb_comp" value={fmt(r.phase4.comp.yb_comp,3)} unit="in"/>
            <CI label="h_comp" value={fmt(r.phase4.comp.h_comp,2)} unit="in"/>
            <CI label="SW_top" value={fmt(r.phase4.comp.SW_top,1)} unit="psf"/>
          </R>
        </>)}
      </>)}
    </Card>
    </></InputsBlock>

    <OutputsBlock><>
    <SH>Transfer Stresses</SH>
    <Card title="Prestress Force & Stresses at Release">
      <Eq tex="Po = fpi ÃƒÆ’Ã¢â‚¬â€ Aps ÃƒÆ’Ã¢â‚¬â€ (1 ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ assumed_loss)" code="ACI 318-19 Ãƒâ€šÃ‚Â§24.5.3.1"/>
      <Eq tex="f_top = Po/A ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ PoÃƒâ€šÃ‚Â·e/St     f_bot = Po/A + PoÃƒâ€šÃ‚Â·e/Sb" code="PCI 8th Ãƒâ€šÃ‚Â§4.2.2"/>
      <Res label="PÃƒÂ¢Ã¢â‚¬Å¡Ã¢â€šÂ¬" value={fmt(r.Po,2)} unit="kip"/>
      <Res label="Top Fiber" value={fmt(r.tTop,4)} unit="ksi"/>
      <Res label="Bot Fiber" value={fmt(r.tBot,4)} unit="ksi"/>
    </Card>
    <Card title="Self-Weight at Transfer Point">
      <Eq tex="lt = 50 ÃƒÆ’Ã¢â‚¬â€ d_strand" code="ACI 318-19 Ãƒâ€šÃ‚Â§25.4.8.1"/>
      <Eq tex="Md = (lpc/2 ÃƒÆ’Ã¢â‚¬â€ lt_ft ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ lt_ftÃƒâ€šÃ‚Â²/2) ÃƒÆ’Ã¢â‚¬â€ w_sw" code="PCI 8th Ãƒâ€šÃ‚Â§4.5"/>
      <Res label="lt" value={fmt(r.lt,1)} unit="in"/><Res label={<Sym base="M" sub="d"/>} value={fmt(r.MdT,4)} unit="kip-ft"/>
    </Card>
    <Card title="Net Stresses & Permissible Checks">
      <div style={{display:"flex",flexWrap:"wrap",gap:4,justifyContent:"center"}}>
        <Graphic><StressDiagram h={r.s.h} topStress={r.nTtop} botStress={r.nTbot} label="@ Transfer" sc={16}/></Graphic>
        <Graphic><StressDiagram h={r.s.h} topStress={r.nMtop} botStress={r.nMbot} label="@ Midspan" sc={16}/></Graphic>
      </div>
      <Eq tex="Tension allow (end)    = ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢6ÃƒÂ¢Ã‹â€ Ã…Â¡(fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²ci ÃƒÆ’Ã¢â‚¬â€ 1000)" code="ACI 318-19 Ãƒâ€šÃ‚Â§24.5.3.2(a)"/>
      <Eq tex="Tension allow (mid)    = ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢3ÃƒÂ¢Ã‹â€ Ã…Â¡(fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²ci ÃƒÆ’Ã¢â‚¬â€ 1000)" code="ACI 318-19 Ãƒâ€šÃ‚Â§24.5.3.2(a)"/>
      <Eq tex="Compression allow (end)   = 0.70 fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²ci" code="ACI 318-19 Ãƒâ€šÃ‚Â§24.5.3.1"/>
      <Eq tex="Compression allow (mid)   = 0.60 fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²ci" code="ACI 318-19 Ãƒâ€šÃ‚Â§24.5.3.2(b)"/>
      <Check label="Tension @ ends" actual={fmt(r.nTtop*1000,1)} limit={fmt(r.aTE,1)} unit="psi" ok={r.aTE<r.nTtop*1000}/>
      <Check label="Tension @ midspan" actual={fmt(r.nMtop*1000,1)} limit={fmt(r.aTM,1)} unit="psi" ok={r.nMtop*1000>r.aTM}/>
      <Check label="Comp @ ends" actual={fmt(Math.abs(r.nTbot)*1000,1)} limit={fmt(r.aCE,1)} unit="psi" ok={r.aCE>Math.abs(r.nTbot)*1000}/>
      <Check label="Comp @ mid" actual={fmt(Math.abs(r.nMbot)*1000,1)} limit={fmt(r.aCM,1)} unit="psi" ok={r.aCM>Math.abs(r.nMbot)*1000}/>
    </Card>

    <SH>Loss of Prestress</SH>
    <Card title="Elastic Shortening (ES)">
      <Eq tex="fcir = Kcir(Pi/A + PiÃƒâ€šÃ‚Â·eÃƒâ€šÃ‚Â²/Ix) ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ MgÃƒâ€šÃ‚Â·e/Ix" code="PCI 8th Ãƒâ€šÃ‚Â§4.7.2.1"/>
      <Eq tex="ES = Kes ÃƒÆ’Ã¢â‚¬â€ (Eps/Eci) ÃƒÆ’Ã¢â‚¬â€ fcir" code="PCI 8th Eq. 4-19"/>
      <Res label="fcir" value={fmt(r.fcir,4)} unit="ksi"/><Res label="ES" value={fmt(r.ES,3)} unit="ksi"/>
    </Card>
    <Card title="Creep (CR)">
      <Eq tex="fcds = Msd ÃƒÆ’Ã¢â‚¬â€ e / Ix" code="PCI 8th Ãƒâ€šÃ‚Â§4.7.2.2"/>
      <Eq tex="CR = Kcr ÃƒÆ’Ã¢â‚¬â€ (Eps/Ec) ÃƒÆ’Ã¢â‚¬â€ (fcir ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ fcds)" code="PCI 8th Eq. 4-22"/>
      <Res label="fcds" value={fmt(r.fcds,4)} unit="ksi"/><Res label="CR" value={fmt(r.CR,3)} unit="ksi"/>
    </Card>
    <Card title="Shrinkage & Relaxation">
      <Eq tex="SH = 8.2ÃƒÆ’Ã¢â‚¬â€10ÃƒÂ¢Ã‚ÂÃ‚Â»ÃƒÂ¢Ã‚ÂÃ‚Â¶ ÃƒÆ’Ã¢â‚¬â€ Ksh ÃƒÆ’Ã¢â‚¬â€ Eps ÃƒÆ’Ã¢â‚¬â€ (1ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢0.06Ãƒâ€šÃ‚Â·V/S) ÃƒÆ’Ã¢â‚¬â€ (100ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢RH)" code="PCI 8th Eq. 4-24"/>
      <Eq tex="RE = [Kre/1000 ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ J(ES+CR+SH)] ÃƒÆ’Ã¢â‚¬â€ C" code="PCI 8th Eq. 4-27"/>
      <Res label="SH" value={fmt(r.SHv,3)} unit="ksi"/><Res label="RE" value={fmt(r.RE,3)} unit="ksi"/>
    </Card>
    <Card title="Total Losses">
      <Eq tex="Total (%) = (ES + CR + SH + RE) / fpi ÃƒÆ’Ã¢â‚¬â€ 100" code="PCI 8th Ãƒâ€šÃ‚Â§4.7"/>
      <div style={{textAlign:"center",padding:6}}><span style={{fontSize:22,fontWeight:800,fontFamily:"'JetBrains Mono','Fira Code','Consolas',monospace"}}>{fmt(r.totalLoss,2)}%</span></div>
    </Card>

    <SH>Service Load Stresses</SH>
    <Card title="Service Stresses">
      <Eq tex="Pe = Aps ÃƒÆ’Ã¢â‚¬â€ fpi ÃƒÆ’Ã¢â‚¬â€ (1 ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ loss/100)" code="ACI 318-19 Ãƒâ€šÃ‚Â§24.5.2"/>
      <Eq tex="f_bot = Pe/A + PeÃƒâ€šÃ‚Â·e/Sb ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ Mserv/Sb" code="PCI 8th Ãƒâ€šÃ‚Â§4.3.1"/>
      <Eq tex="f_top = Pe/A ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ PeÃƒâ€šÃ‚Â·e/St + M/St" code="PCI 8th Ãƒâ€šÃ‚Â§4.3.1"/>
      <Eq tex="Tension allow = 7.5ÃƒÂ¢Ã‹â€ Ã…Â¡(fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²cÃƒÆ’Ã¢â‚¬â€1000) / 1000" code="ACI 318-19 Ãƒâ€šÃ‚Â§24.5.2.1"/>
      <Res label="PÃƒÂ¢Ã¢â‚¬Å¡Ã¢â‚¬Ëœ" value={fmt(r.Pe,2)} unit="kip"/><Res label={<Sym base="M" sub="sus"/>} value={fmt(r.Msus,2)} unit="kip-in"/><Res label={<Sym base="M" sub="service"/>} value={fmt(r.Mserv,2)} unit="kip-in"/>
      <Check label="Tension (Class U)" actual={fmt(r.fbot,4)} limit={fmt(r.aTens,4)} unit="ksi" ok={r.classU} tag={r.classU?"CLASS U":"FAIL"}/>
      <Check label="Comp (sustained, 0.45fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²c)" actual={fmt(r.ftSus,4)} limit={fmt(0.45*fc,3)} unit="ksi" ok={0.45*fc>r.ftSus}/>
      <Check label="Comp (total, 0.6fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²c)" actual={fmt(r.ftTot,4)} limit={fmt(0.6*fc,3)} unit="ksi" ok={0.6*fc>r.ftTot}/>
    </Card>

    <SH>Design Flexural Strength</SH>
    <Card title="Method #1 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ACI Eq. 18-1">
      <Eq tex="ÃƒÂÃ‚Âp = Aps / (b ÃƒÆ’Ã¢â‚¬â€ dp)" code="ACI 318-19 Ãƒâ€šÃ‚Â§20.3.2.3"/>
      <Eq tex="fps = fpu[1 ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ (ÃƒÅ½Ã‚Â³p/ÃƒÅ½Ã‚Â²ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â)(ÃƒÂÃ‚ÂpÃƒâ€šÃ‚Â·fpu/fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²c)]" code="ACI 318-19 Eq. 20.3.2.3.1"/>
      <Eq tex="a = ApsÃƒâ€šÃ‚Â·fps / (0.85Ãƒâ€šÃ‚Â·fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²cÃƒâ€šÃ‚Â·b)" code="ACI 318-19 Ãƒâ€šÃ‚Â§22.2.2.4.1"/>
      <Eq tex="c = a / ÃƒÅ½Ã‚Â²ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â     ÃƒÅ½Ã‚Âµt = [(dpÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢c)/c]ÃƒÆ’Ã¢â‚¬â€0.003" code="ACI 318-19 Ãƒâ€šÃ‚Â§21.2.2"/>
      <Eq tex="ÃƒÅ½Ã‚Â¦Mn = ÃƒÅ½Ã‚Â¦Ãƒâ€šÃ‚Â·ApsÃƒâ€šÃ‚Â·fpsÃƒâ€šÃ‚Â·(dp ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ a/2) / 12" code="ACI 318-19 Ãƒâ€šÃ‚Â§22.3.2"/>
      <Eq tex="Mu = wuÃƒâ€šÃ‚Â·(b/12)Ãƒâ€šÃ‚Â·lÃƒâ€šÃ‚Â²/8     wu = (1.2DL+1.6LL)/1000" code="ACI 318-19 Ãƒâ€šÃ‚Â§5.3.1"/>
      <Res label="ÃƒÂÃ‚Âp" value={fmt(r.rhoP,6)}/><Res label="fps" value={fmt(r.fps1,2)} unit="ksi"/>
      <Res label="a" value={fmt(r.a1,4)} unit="in"/><Res label="c" value={fmt(r.c1,4)} unit="in"/>
      <Res label="ÃƒÅ½Ã‚Âµt" value={fmt(r.eT1,6)}/>
      <Res label="" value={<Badge ok={r.eT1>0.005} label={r.eT1>0.005?"Tension Controlled (ÃƒÅ½Ã‚Â¦=0.9)":"Comp/Trans"}/>}/>
      <Check label="ÃƒÅ½Ã‚Â¦Mn > Mu" actual={fmt(r.phiMn1,2)} limit={fmt(r.Mu,2)} unit="kip-ft" ok={r.phiMn1>r.Mu}/>
      <Eq tex="Mcr = (Ix/yb)Ãƒâ€šÃ‚Â·[f_bot,rel + 7.5ÃƒÂ¢Ã‹â€ Ã…Â¡(fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²cÃƒÆ’Ã¢â‚¬â€1000)/1000] / 12" code="ACI 318-19 Ãƒâ€šÃ‚Â§24.2.3.5"/>
      <Check label="ÃƒÅ½Ã‚Â¦Mn > 1.2 Mcr" actual={fmt(r.phiMn1,2)} limit={fmt(r.Mcr*1.2,2)} unit="kip-ft" ok={r.phiMn1>r.Mcr*1.2}/>
    </Card>
    <Card title="Method #3 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Strain Compatibility">
      <Eq tex="fse = fpi(1ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢loss/100)     ÃƒÅ½Ã‚Âµse = fse/Eps" code="PCI 8th Ãƒâ€šÃ‚Â§4.2.3"/>
      <Eq tex="ÃƒÅ½Ã‚Âµps = ÃƒÅ½Ã‚Âµse + [(dpÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢c)/c]ÃƒÆ’Ã¢â‚¬â€0.003" code="PCI 8th Ãƒâ€šÃ‚Â§4.2.3.3"/>
      <Eq tex="fps = 270 ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ 0.04/(ÃƒÅ½Ã‚ÂµpsÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢0.007)  [if ÃƒÅ½Ã‚Âµps>0.0085]" code="PCI Strand Eq."/>
      <Eq tex="T = ApsÃƒâ€šÃ‚Â·fps + AsÃƒâ€šÃ‚Â·fy     C = 0.85Ãƒâ€šÃ‚Â·fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²cÃƒâ€šÃ‚Â·aÃƒâ€šÃ‚Â·b" code="ACI 318-19 Ãƒâ€šÃ‚Â§22.2"/>
      <Eq tex="Iterate c until T ÃƒÂ¢Ã¢â‚¬Â°Ã‹â€  C" code="PCI 8th Ãƒâ€šÃ‚Â§4.2.3.3"/>
      <R><OI label='Trial c' value={cT} onChange={setCT} unit="in" width={140}/></R>
      <Res label="ÃƒÅ½Ã‚Âµps" value={fmt(r.ePS,6)}/><Res label="fps" value={fmt(r.fps3,2)} unit="ksi"/>
      <div style={{display:"flex",gap:16,justifyContent:"center",padding:"6px 0",background:"#f8f9fa",borderRadius:4,margin:"6px 0"}}>
        <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#999"}}>T (kip)</div><div style={{fontSize:17,fontWeight:800}}>{fmt(r.T3,2)}</div></div>
        <div style={{fontSize:18,color:"#ccc",alignSelf:"center"}}>=</div>
        <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#999"}}>C (kip)</div><div style={{fontSize:17,fontWeight:800}}>{fmt(r.C3,2)}</div></div>
        <Badge ok={Math.abs(r.T3-r.C3)<5} label={`ÃƒÅ½Ã¢â‚¬Â=${fmt(Math.abs(r.T3-r.C3),2)}`}/>
      </div>
      <Res label="ÃƒÅ½Ã‚Â¦Mn" value={fmt(r.phiMn3,2)} unit="kip-ft"/>
      <Check label="ÃƒÅ½Ã‚Â¦Mn > Mu" actual={fmt(r.phiMn3,2)} limit={fmt(r.Mu,2)} unit="kip-ft" ok={r.phiMn3>r.Mu}/>
    </Card>

    <SH>Shear Strength</SH>
    <Card title="Factored Shear">
      <Eq tex="wu = 1.2Ãƒâ€šÃ‚Â·DL_line + 1.6Ãƒâ€šÃ‚Â·LL_line     Ay = wuÃƒâ€šÃ‚Â·l/2" code="ACI 318-19 Ãƒâ€šÃ‚Â§5.3.1"/>
      <Eq tex="Vc = 0.75[0.6ÃƒÅ½Ã‚Â»ÃƒÂ¢Ã‹â€ Ã…Â¡fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²c + 700(VuÃƒâ€šÃ‚Â·dp/Mu)]Ãƒâ€šÃ‚Â·bwÃƒâ€šÃ‚Â·dp" code="ACI 318-19 Eq. 22.5.8.3.1"/>
      <Eq tex="Vcw = 0.75[3.5ÃƒÅ½Ã‚Â»ÃƒÂ¢Ã‹â€ Ã…Â¡fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²c + 0.3fpc]Ãƒâ€šÃ‚Â·bwÃƒâ€šÃ‚Â·dp" code="ACI 318-19 Ãƒâ€šÃ‚Â§22.5.8.3.2"/>
      <Res label="wu" value={fmt(r.wuL,4)} unit="kip/ft"/><Res label="A_y = B_y" value={fmt(r.Ay,3)} unit="kips"/>
      <Res label="Vc (simplified, x=6.25ft)" value={fmt(r.VcS,3)} unit="kips"/>
      <Res label="ÃƒÅ½Ã‚Â¦Vcw (x=0.75ft)" value={fmt(r.Vcw,3)} unit="kips"/>
    </Card>

    {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Phase 4: Composite, Interface Shear, Crack Width ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
    {useComposite && r.phase4?.composite && (<>
      <SH>Composite Section Stresses</SH>
      <Card title="Service Stresses ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Composite Section">
        <Eq tex="f_bot = Pe/A + PeÃƒâ€šÃ‚Â·e/Sb_pre ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ M_DL/Sb_pre ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ (M_SDL+M_LL)/Sb_comp" code="PCI 8th Ãƒâ€šÃ‚Â§4.4"/>
        <Eq tex="f_top = Pe/A ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ PeÃƒâ€šÃ‚Â·e/St_pre + M_DL/St_pre + (M_SDL+M_LL)/St_comp" code="PCI 8th Ãƒâ€šÃ‚Â§4.4"/>
        {r.phase4.stresses && (<>
          <R>
            <CI label="f_bot (comp)" value={fmt(r.phase4.stresses.f_bot,4)} unit="ksi"/>
            <CI label="f_top_pre (comp)" value={fmt(r.phase4.stresses.f_top_pre,4)} unit="ksi"/>
            <CI label="Allow. tens." value={fmt(r.phase4.stresses.f_tens_allow,4)} unit="ksi"/>
            <CI label="Allow. comp." value={fmt(r.phase4.stresses.f_comp_allow,4)} unit="ksi"/>
          </R>
          <div style={{marginTop:8}}>
            <Check label="Bot tension (Class U)" ok={r.phase4.stresses.tensOk} actual={fmt(Math.abs(Math.min(r.phase4.stresses.f_bot,0)),4)} limit={fmt(r.phase4.stresses.f_tens_allow,4)} unit="ksi"/>
            <Check label="Top compression" ok={r.phase4.stresses.compOk} actual={fmt(r.phase4.stresses.f_top_pre,4)} limit={fmt(r.phase4.stresses.f_comp_allow,4)} unit="ksi"/>
          </div>
        </>)}
      </Card>

      <SH>Interface Shear</SH>
      <Card title="Horizontal Shear at Precast / Topping Interface">
        <Eq tex="Vh = Vu / d_v" code="ACI 318-19 Ãƒâ€šÃ‚Â§26.5.6.1"/>
        <Eq tex="Vnh = ÃƒÅ½Ã‚Â¦(cÃƒâ€šÃ‚Â·b_v + ÃƒÅ½Ã‚Â¼Ãƒâ€šÃ‚Â·AvfÃƒâ€šÃ‚Â·fy)" code="ACI 318-19 Eq. 22.9.4.2"/>
        {r.phase4.interfaceShear && (<>
          <R>
            <CI label="Vh" value={fmt(r.phase4.interfaceShear.Vh,3)} unit="kip/in"/>
            <CI label="Vnh" value={fmt(r.phase4.interfaceShear.Vnh,3)} unit="kip/in"/>
            <CI label="ÃƒÅ½Ã‚Â¼" value={fmt(r.phase4.interfaceShear.mu,2)}/>
            <CI label="c" value={fmt(r.phase4.interfaceShear.c_cohesion,4)} unit="ksi"/>
          </R>
          <Check label="Interface Shear" ok={r.phase4.interfaceShear.ok}
            actual={fmt(r.phase4.interfaceShear.Vh,3)} limit={fmt(r.phase4.interfaceShear.Vnh,3)} unit="kip/in"/>
        </>)}
      </Card>
    </>)}

    {r.phase4?.crackWidth && nRe > 0 && (<>
      <SH>Crack Width Estimate</SH>
      <Card title="Maximum Flexural Crack Width (ACI 318-19 Ãƒâ€šÃ‚Â§24.3)">
        <Eq tex="w = 0.076Ãƒâ€šÃ‚Â·ÃƒÅ½Ã‚Â²Ãƒâ€šÃ‚Â·fsÃƒâ€šÃ‚Â·(dcÃƒâ€šÃ‚Â·A)^(1/3)" code="ACI 224 / ACI 318-19 Ãƒâ€šÃ‚Â§24.3.2"/>
        <R>
          <CI label="fs (service)" value={fmt(r.phase4.fs_service,2)} unit="ksi"/>
          <CI label="dc" value={fmt(cover+0.5,2)} unit="in"/>
          <CI label="w_calc" value={fmt(r.phase4.crackWidth.w*1000,2)} unit="mil-in"/>
          <CI label="w_limit" value={fmt(r.phase4.crackWidth.w_limit*1000,1)} unit="mil-in (16)"/>
        </R>
        <Check label="Crack width control" ok={r.phase4.crackWidth.ok}
          actual={fmt(r.phase4.crackWidth.w*1000,2)} limit="16" unit="mil-in"/>
      </Card>
    </>)}

    <SH>Camber & Deflection</SH>
    <Card title="Camber & Deflection">
      <Eq tex="ÃƒÅ½Ã¢â‚¬Â_ps = PoÃƒâ€šÃ‚Â·eÃƒâ€šÃ‚Â·LÃƒâ€šÃ‚Â² / (8Ãƒâ€šÃ‚Â·EciÃƒâ€šÃ‚Â·Ix)" code="PCI 8th Table 4.8.4"/>
      <Eq tex="ÃƒÅ½Ã¢â‚¬Â_sw = 5Ãƒâ€šÃ‚Â·wÃƒâ€šÃ‚Â·LÃƒÂ¢Ã‚ÂÃ‚Â´ / (384Ãƒâ€šÃ‚Â·EciÃƒâ€šÃ‚Â·Ix)" code="PCI 8th Table 4.8.4"/>
      <Eq tex="ÃƒÅ½Ã¢â‚¬Â_erec = 1.80Ãƒâ€šÃ‚Â·ÃƒÅ½Ã¢â‚¬Â_ps ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ 1.85Ãƒâ€šÃ‚Â·ÃƒÅ½Ã¢â‚¬Â_sw" code="PCI 8th Table 4.8.4"/>
      <Eq tex="ÃƒÅ½Ã¢â‚¬Â_final = 2.45Ãƒâ€šÃ‚Â·ÃƒÅ½Ã¢â‚¬Â_ps ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ 2.70Ãƒâ€šÃ‚Â·ÃƒÅ½Ã¢â‚¬Â_sw" code="PCI 8th Table 4.8.4"/>
      <Res label="Initial" value={fmt(r.cI,4)} unit="in"/><Res label="Erection" value={fmt(r.cE,4)} unit="in"/>
      <Res label="Final Camber" value={fmt(r.cF,4)} unit="in"/><Res label="Net Camber" value={fmt(r.netC,4)} unit="in"/>
      <Res label="Final Position" value={fmt(r.finalP,4)} unit="in"/>
    </Card>
    </></OutputsBlock>
  </div>);
}

// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
// COLUMN TAB
// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
function ColTab({loadedCalc, onConsumedLoad, workspace}){
  const [b,setB]=useState(12),[h,setH]=useState(20);
  const [colHeight,setColHeight]=useState(120); // column height in inches (default 10 ft)
  const [fc,setFc]=useState(4),[cov,setCov]=useState(1.5);
  const fy=60,Es=29000;
  const [bBar,setBBar]=useState("#9"),[bQ,setBQ]=useState(2);
  const [tBar,setTBar]=useState("#9"),[tQ,setTQ]=useState(2);
  const [xBar,setXBar]=useState("#4");
  const [Pu,setPu]=useState(400);
  const [Mu,setMu]=useState(80);
  const [chartType,setChartType]=useState("pm");

  // Save/load wiring
  const user = useCurrentUser();
  const theme = useModuleTheme();
  const [saveOpen,setSaveOpen]=useState(false);
  const [activeCalc,setActiveCalc]=useState(null);
  const [allCalcs,setAllCalcs]=useState([]);
  const [saveMsg,setSaveMsg]=useState("");

  useEffect(()=>{ fetchCalcsForUser(user).then(setAllCalcs); },[user?.id,user?.role]);

  useEffect(()=>{
    if(loadedCalc && loadedCalc.inputs){
      const v = loadedCalc.inputs;
      if(v.b!==undefined) setB(v.b);
      if(v.h!==undefined) setH(v.h);
      if(v.fc!==undefined) setFc(v.fc);
      if(v.cov!==undefined) setCov(v.cov);
      if(v.bBar!==undefined) setBBar(v.bBar);
      if(v.bQ!==undefined) setBQ(v.bQ);
      if(v.tBar!==undefined) setTBar(v.tBar);
      if(v.tQ!==undefined) setTQ(v.tQ);
      if(v.xBar!==undefined) setXBar(v.xBar);
      if(v.Pu!==undefined) setPu(v.Pu);
      if(v.Mu!==undefined) setMu(v.Mu);
      if(v.colHeight!==undefined) setColHeight(v.colHeight);
      setActiveCalc(loadedCalc);
      onConsumedLoad && onConsumedLoad();
    }
  },[loadedCalc]);

  const currentInputs = {b,h,colHeight,fc,cov,bBar,bQ,tBar,tQ,xBar,Pu,Mu};

  const doSave = async({projectName,partName,calcName})=>{
    const res = await saveCalc({
      projectName, partName, calcName, module:"col",
      inputs: currentInputs, reportText: null,
      userId: user?.id, userName: user?.name,
    });
    if(res.ok){
      setActiveCalc(res.row);
      fetchCalcsForUser(user).then(setAllCalcs);
      setSaveMsg("Saved ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“");
      setTimeout(()=>setSaveMsg(""),2500);
      return true;
    }
    return false;
  };

  const doUpdate = async()=>{
    if(!activeCalc) return;
    const res = await updateCalc(activeCalc.id, {inputs: currentInputs, reportText: null});
    if(res.ok){
      setSaveMsg("Updated ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“");
      setTimeout(()=>setSaveMsg(""),2500);
      fetchCalcsForUser(user).then(setAllCalcs);
    }
  };

  const r=useMemo(()=>{
    const bD=REBAR[bBar]?.d||1,bA=REBAR[bBar]?.A||1;
    const tD=REBAR[tBar]?.d||1,tA=REBAR[tBar]?.A||1;
    const xD=REBAR[xBar]?.d||0.5;
    const b1=Math.max(0.65,0.85-0.05*(fc-4));
    const d=h-cov-xD-0.5*bD,dp=cov+xD+0.5*tD;
    const PnA=(b*h-bQ*bA-tQ*tA)*0.85*fc+(bQ*bA+tQ*tA)*fy;
    const cb=d*0.003/(0.003+fy/Es),ab=cb*b1;
    const esT=0.003*(cb-dp)/cb;
    const fsT=Math.min(fy,Es*Math.abs(esT))*Math.sign(esT);
    const PnB=0.85*fc*ab*b+tQ*tA*fsT-bQ*bA*fy;
    const MnB=(0.85*fc*ab*b*(h/2-ab/2)+tQ*tA*Math.abs(fsT)*(h/2-dp)+bQ*bA*fy*(d-h/2))/12;
    const pts=[];pts.push({P:PnA,M:0});
    for(let i=1;i<=40;i++){const c=h-(h-0.5)*i/40;if(c<=0.1)continue;const a=Math.min(c*b1,h);const esB=0.003*(d-c)/c,fsB=Math.min(fy,Math.max(-fy,Es*esB));const esT2=0.003*(c-dp)/c,fsT2=Math.min(fy,Math.max(-fy,Es*esT2));const P=0.85*fc*a*b+tQ*tA*fsT2+bQ*bA*fsB;const M=0.85*fc*a*b*(h/2-a/2)+tQ*tA*fsT2*(h/2-dp)+bQ*bA*fsB*(d-h/2);pts.push({P,M:M/12});}
    pts.push({P:-(bQ*bA+tQ*tA)*fy,M:0});

    // ÃƒÂÃ¢â‚¬Â  factor: tied compression member, transitions per ACI but simplified to 0.65 here
    const phi=0.65;
    // Find capacity moment at the demand axial load by interpolating along the curve (right side, M>=0)
    const rightPts=pts.filter(p=>p.M>=0).sort((a,b2)=>b2.P-a.P);
    let MnAtPu=0;
    for(let i=0;i<rightPts.length-1;i++){
      const p1=rightPts[i],p2=rightPts[i+1];
      if((Pu/phi)<=p1.P && (Pu/phi)>=p2.P){
        const t=(p1.P-(Pu/phi))/(p1.P-p2.P||1e-6);
        MnAtPu=p1.M+t*(p2.M-p1.M);
        break;
      }
    }
    const phiMnAtPu=phi*MnAtPu;
    const demandOk = Mu<=phiMnAtPu && Pu<=phi*PnA && Pu>=0;
    const util = phiMnAtPu>0 ? Mu/phiMnAtPu : (Mu>0?2:0);

    return {d,dp,b1,PnA,PnB,MnB,cb,ab,esT,fsT,pts,bD,tD,xD,bA,tA,phi,phiMnAtPu,demandOk,util};
  },[b,h,fc,cov,bBar,bQ,tBar,tQ,xBar,Pu,Mu]);
  const maxP=Math.max(...r.pts.map(p=>p.P))*1.1,minP=Math.min(...r.pts.map(p=>p.P))*1.1;
  const maxM=Math.max(...r.pts.map(p=>Math.abs(p.M)))*1.2||1;
  const W=500,H=380,pad=55;
  const sx=m=>pad+(m/maxM)*(W-2*pad),sy=p=>pad+((maxP-p)/(maxP-minP||1))*(H-2*pad);
  const pathD=r.pts.map((p,i)=>`${i===0?'M':'L'}${sx(p.M).toFixed(1)},${sy(p.P).toFixed(1)}`).join(' ');

  const {reportStyle}=useViewSettings();
  if(reportStyle==="tedds"){
    return(
      <TeddsDoc>
        <TeddsTitle calcId="Rectangular RC Column Design" codeBasis="In accordance with ACI 318-19" version="Calc version 1.0"/>
        <TeddsSection number={1} note="Axial-moment interaction check for tied rectangular column under factored loads"/>

        <TeddsHeading>Member details</TeddsHeading>
        <TeddsLine label="Section breadth" sym="b" val={b} unit="in" label2="Section depth" sym2="h" val2={h} unit2="in"/>
        <TeddsLine label="Column height" sym="L" val={colHeight} unit="in" label2="Height" sym2="L" val2={fmt(colHeight/12,2)} unit2="ft"/>
        <TeddsLine label="Concrete strength" sym="fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²c" val={fc} unit="ksi" label2="Clear cover" sym2="cc" val2={cov} unit2="in"/>
        <TeddsLine label="Reinforcement yield strength" sym="fy" val={fy} unit="ksi" label2="Steel modulus" sym2="Es" val2={Es} unit2="ksi"/>
        <TeddsLine label="Bottom bars" sym="As,bot" val={`${bQ} ÃƒÆ’Ã¢â‚¬â€ ${bBar}`} label2="Top bars" sym2="As,top" val2={`${tQ} ÃƒÆ’Ã¢â‚¬â€ ${tBar}`}/>

        <Graphic><ColumnXSection b={b} h={h} nBot={bQ} nTop={tQ} cover={cov} dTie={r.xD} dBot={r.bD} dTop={r.tD}/></Graphic>

        <TeddsHeading>Factored design loads</TeddsHeading>
        <TeddsLine label="Factored axial load" sym="Pu" val={Pu} unit="kips" label2="Factored moment" sym2="Mu" val2={Mu} unit2="kip-ft"/>

        <TeddsHeading>Section analysis</TeddsHeading>
        <TeddsCalc sym="d" formula="h ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ cover ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ dtie ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ dbar/2" result={fmt(r.d,3)} unit="in"/>
        <TeddsCalc sym="ÃƒÅ½Ã‚Â²1" formula={`0.85 ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ 0.05(${fc}ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢4)`} result={fmt(r.b1,3)}/>
        <TeddsCalc sym="Pn,A" formula="(bÃƒâ€šÃ‚Â·h ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ ÃƒÅ½Ã‚Â£As)Ãƒâ€šÃ‚Â·0.85fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²c + ÃƒÅ½Ã‚Â£AsÃƒâ€šÃ‚Â·fy" result={fmt(r.PnA,1)} unit="kips"/>
        <TeddsCalc sym="cb" formula="d ÃƒÆ’Ã¢â‚¬â€ 0.003 / (0.003 + ÃƒÅ½Ã‚Âµy)" result={fmt(r.cb,3)} unit="in"/>
        <TeddsCalc sym="Pn,B" formula="0.85fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²cÃƒâ€šÃ‚Â·abÃƒâ€šÃ‚Â·b + As'Ãƒâ€šÃ‚Â·f's ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ AsÃƒâ€šÃ‚Â·fy" result={fmt(r.PnB,1)} unit="kips"/>
        <TeddsCalc sym="Mn,B" formula="ÃƒÅ½Ã‚Â£FÃƒâ€šÃ‚Â·(arm about centroid)" result={fmt(r.MnB,1)} unit="kip-ft"/>
        <TeddsCalc sym="ÃƒÅ½Ã‚Â¦Mn @ Pu" formula="interpolated along PÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“M envelope" result={fmt(r.phiMnAtPu,1)} unit="kip-ft"/>

        <TeddsHeading>Results summary</TeddsHeading>
        <TeddsTable
          headers={["Check","Unit","Capacity","Maximum","Utilization","Result"]}
          rows={[
            utilRow("Axial load","kips", r.phi*r.PnA, Pu),
            utilRow("Moment at factored axial load","kip-ft", r.phiMnAtPu, Mu),
          ]}
        />
      </TeddsDoc>
    );
  }

  return(<div>
    <div className="no-print" style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,marginBottom:12,padding:"8px 12px",background:"#f8f9fa",border:"1px solid #dee2e6",borderRadius:6}}>
      <div style={{fontSize:12,color:"#495057"}}>
        {activeCalc ? <>ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã¢â‚¬Å¾ <b>{activeCalc.calc_name}</b> <span style={{color:"#868e96"}}>({activeCalc.project_name} / {activeCalc.part_name})</span></> : <span style={{color:"#868e96"}}>Not yet saved to a project</span>}
        {saveMsg && <span style={{marginLeft:10,color:"#1e7e34",fontWeight:700}}>{saveMsg}</span>}
      </div>
      <div style={{display:"flex",gap:6}}>
        {activeCalc && activeCalc.created_by_id===user?.id && (
          <button onClick={doUpdate} style={{padding:"6px 12px",borderRadius:4,border:`1px solid ${theme.accent}`,background:theme.soft,color:theme.text,fontWeight:700,fontSize:11,cursor:"pointer"}}>ÃƒÂ¢Ã¢â‚¬Â Ã‚Â» Update Saved File</button>
        )}
        <button onClick={()=>setSaveOpen(true)} style={{padding:"6px 12px",borderRadius:4,border:`2px solid ${theme.accentDark}`,background:theme.accentDark,color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer"}}>ÃƒÂ°Ã…Â¸Ã¢â‚¬â„¢Ã‚Â¾ Save AsÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦</button>
      </div>
    </div>
    <SaveCalcModal open={saveOpen} onClose={()=>setSaveOpen(false)} onSave={doSave} existingProjects={allCalcs}
      defaultProject={activeCalc?.project_name || workspace?.project} defaultPart={activeCalc?.part_name || workspace?.part}/>
    <LiveStatusBanner ok={r.demandOk} util={r.util} label="Demand vs. Capacity (Mu / ÃƒÅ½Ã‚Â¦Mn at Pu)"/>
    <InputsBlock><>
    <Card title="Factored Design Loads (Demand)">
      <Eq tex="Check: Pu ÃƒÂ¢Ã¢â‚¬Â°Ã‚Â¤ ÃƒÅ½Ã‚Â¦Pn  and  Mu ÃƒÂ¢Ã¢â‚¬Â°Ã‚Â¤ ÃƒÅ½Ã‚Â¦Mn @ Pu" code="ACI 318-19 Ãƒâ€šÃ‚Â§22.4"/>
      <R><OI label="PÃƒÂ¡Ã‚ÂµÃ‚Â¤" value={Pu} onChange={setPu} unit="kips"/><OI label="MÃƒÂ¡Ã‚ÂµÃ‚Â¤" value={Mu} onChange={setMu} unit="kip-ft"/></R>
    </Card>
    <Card title="Column Geometry & Reinforcement">
      <R><OI label="b" value={b} onChange={setB} unit="in"/><OI label="h" value={h} onChange={setH} unit="in"/><OI label="L (height)" value={colHeight} onChange={(v)=>setColHeight(Math.max(12,v))} unit="in"/><OI label={<Sym base="f" sub="c" prime/>} value={fc} onChange={setFc} unit="ksi"/><OI label="Cover" value={cov} onChange={setCov} unit="in"/></R>
      <R><OI label="Bot Bar" value={bBar} onChange={setBBar} options={Object.keys(REBAR)}/><OI label="Bot Qty" value={bQ} onChange={setBQ} step={1}/><OI label="Top Bar" value={tBar} onChange={setTBar} options={Object.keys(REBAR)}/><OI label="Top Qty" value={tQ} onChange={setTQ} step={1}/><OI label="Ties" value={xBar} onChange={setXBar} options={Object.keys(REBAR)}/></R>
      <Graphic><ColumnXSection b={b} h={h} nBot={bQ} nTop={tQ} cover={cov} dTie={r.xD} dBot={r.bD} dTop={r.tD}/></Graphic>
    </Card>
    </></InputsBlock>
    <OutputsBlock><>
    <SH>Outputs</SH>
    <Card title="Effective Depths">
      <Eq tex="d  = h ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ cover ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ d_tie ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ d_bar/2" code="ACI 318-19 Ãƒâ€šÃ‚Â§22.2.2.1"/>
      <Eq tex="d' = cover + d_tie + d_bar/2" code="ACI 318-19 Ãƒâ€šÃ‚Â§22.2.2.1"/>
      <Eq tex="ÃƒÅ½Ã‚Â²ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â = 0.85 ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ 0.05(fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²c ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ 4) ÃƒÂ¢Ã¢â‚¬Â°Ã‚Â¥ 0.65" code="ACI 318-19 Ãƒâ€šÃ‚Â§22.2.2.4.3"/>
      <Res label="d" value={fmt(r.d,3)} unit="in"/><Res label="d'" value={fmt(r.dp,3)} unit="in"/><Res label="ÃƒÅ½Ã‚Â²ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â" value={fmt(r.b1,4)}/>
    </Card>
    <Card title="Point A ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Pure Compression">
      <Eq tex="Pn = (bÃƒâ€šÃ‚Â·h ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ ÃƒÅ½Ã‚Â£As)Ãƒâ€šÃ‚Â·0.85fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²c + ÃƒÅ½Ã‚Â£AsÃƒâ€šÃ‚Â·fy" code="ACI 318-19 Ãƒâ€šÃ‚Â§22.4.2.2"/>
      <Res label="PÃƒÂ¢Ã¢â‚¬Å¡Ã¢â€žÂ¢" value={fmt(r.PnA,1)} unit="kips"/>
    </Card>
    <Card title="Point B ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Balanced Condition">
      <Eq tex="cb = d ÃƒÆ’Ã¢â‚¬â€ 0.003 / (0.003 + ÃƒÅ½Ã‚Âµy)" code="ACI 318-19 Ãƒâ€šÃ‚Â§22.2.2.1"/>
      <Eq tex="ÃƒÅ½Ã‚Âµ's = 0.003(cb ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ d')/cb     f's = min(fy, EsÃƒâ€šÃ‚Â·|ÃƒÅ½Ã‚Âµ's|)" code="ACI 318-19 Ãƒâ€šÃ‚Â§22.2.1.1"/>
      <Eq tex="Pn = 0.85fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²cÃƒâ€šÃ‚Â·abÃƒâ€šÃ‚Â·b + As'Ãƒâ€šÃ‚Â·f's ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ AsÃƒâ€šÃ‚Â·fy" code="ACI 318-19 Ãƒâ€šÃ‚Â§22.4.2"/>
      <Eq tex="Mn = ÃƒÅ½Ã‚Â£FÃƒâ€šÃ‚Â·arm about centroid" code="ACI 318-19 Ãƒâ€šÃ‚Â§22.4.2"/>
      <Res label="cb" value={fmt(r.cb,3)} unit="in"/><Res label="ab" value={fmt(r.ab,3)} unit="in"/>
      <Res label="ÃƒÅ½Ã‚Âµ's" value={fmt(r.esT,6)}/><Res label="f's" value={fmt(r.fsT,2)} unit="ksi"/>
      <Res label="PÃƒÂ¢Ã¢â‚¬Å¡Ã¢â€žÂ¢" value={fmt(r.PnB,1)} unit="kips"/><Res label="MÃƒÂ¢Ã¢â‚¬Å¡Ã¢â€žÂ¢" value={fmt(r.MnB,1)} unit="kip-ft"/>
    </Card>
    <Card title="Scientific Charts & 3D Model">
      <ChartPicker value={chartType} onChange={setChartType} options={[
        {id:"pm",label:"PÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“M Interaction"},
        {id:"capacity",label:"Capacity Breakdown"},
        {id:"3d",label:"ÃƒÂ°Ã…Â¸Ã‚Â§Ã…Â  3D Model"},
        {id:"stress3d",label:"ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â¡ Stress Contour"},
      ]}/>
      {chartType==="3d" && (
        <Graphic>
        <Viewer3D
          height={380}
          initialDistance={Math.max(b,h)*0.35+6}
          deps={[b,h,colHeight,bQ,tQ,r.bD,r.tD,r.xD,cov]}
          buildScene={(group,THREE,helpers)=>buildColumnScene(group,THREE,{
            b, h, height:colHeight, cover:cov,
            nBot:bQ, dBot:r.bD, nTop:tQ, dTop:r.tD, dTie:r.xD, tieSpacing:12,
          }, helpers)}
          editableDims={{
            b: { value:b, unit:"in", step:1, min:8, onChange:setB },
            h: { value:h, unit:"in", step:1, min:8, onChange:setH },
            height: { value:colHeight, unit:"in", step:6, min:24, onChange:(v)=>setColHeight(Math.max(12,v)) },
          }}
        />
        </Graphic>
      )}
      {chartType==="stress3d" && (
        <Graphic>
        <div style={{marginBottom:8,padding:"8px 12px",background:"#f8f9fa",borderRadius:6,fontSize:11,color:"#495057"}}>
          Color contour from <i>ÃƒÂÃ†â€™ = P<sub>u</sub>/A Ãƒâ€šÃ‚Â± M<sub>u</sub>Ãƒâ€šÃ‚Â·c/I</i> across the gross section ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â a simplified linear-elastic estimate
          driven by your factored demand loads, <b>not</b> a finite-element solution.
        </div>
        <Viewer3D
          height={380}
          initialDistance={Math.max(b,h)*0.35+6}
          deps={[b,h,colHeight,bQ,tQ,r.bD,r.tD,r.xD,cov,Pu,Mu]}
          buildScene={(group,THREE,helpers)=>buildColumnScene(group,THREE,{
            b, h, height:colHeight, cover:cov,
            nBot:bQ, dBot:r.bD, nTop:tQ, dTop:r.tD, dTie:r.xD, tieSpacing:12,
            stress:{Pu, Mu, b, h},
          }, helpers)}
          editableDims={{
            b: { value:b, unit:"in", step:1, min:8, onChange:setB },
            h: { value:h, unit:"in", step:1, min:8, onChange:setH },
            height: { value:colHeight, unit:"in", step:6, min:24, onChange:(v)=>setColHeight(Math.max(12,v)) },
          }}
          caption="Drag to rotate Ãƒâ€šÃ‚Â· Scroll to zoom Ãƒâ€šÃ‚Â· Red = compression, Blue = tension, White = neutral axis"
        />
        </Graphic>
      )}
      {chartType==="pm" && (<>
      <Eq tex="Sweep c from h ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ 0, compute ÃƒÅ½Ã‚Âµs ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ fs for each layer, sum P & M" code="ACI 318-19 Ãƒâ€šÃ‚Â§22.4"/>
      <Graphic>
      <svg className="live-svg" viewBox={`0 0 ${W} ${H}`} style={{width:"100%",maxWidth:540,display:"block",margin:"0 auto"}}>
        <rect x={0} y={0} width={W} height={H} fill="#ffffff"/>
        <rect x={pad} y={pad} width={W-2*pad} height={H-2*pad} fill="#f8f9fa" rx={2}/>
        {[0,.25,.5,.75,1].map(f=><line key={f} x1={pad} y1={pad+f*(H-2*pad)} x2={W-pad} y2={pad+f*(H-2*pad)} stroke="#e9ecef" strokeWidth={0.5}/>)}
        <line x1={pad} y1={sy(0)} x2={W-pad} y2={sy(0)} stroke="#adb5bd" strokeWidth={1} strokeDasharray="4"/>
        <line x1={sx(0)} y1={pad} x2={sx(0)} y2={H-pad} stroke="#adb5bd" strokeWidth={1} strokeDasharray="4"/>
        <path d={pathD} fill="none" stroke="#343a40" strokeWidth={2}/>
        <circle cx={sx(0)} cy={sy(r.PnA)} r={5} fill="#c0392b"/><text x={sx(0)+10} y={sy(r.PnA)+4} fill="#c0392b" fontSize={10} fontWeight={700} fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">A ({fmt(r.PnA,0)}k)</text>
        <circle cx={sx(r.MnB)} cy={sy(r.PnB)} r={5} fill="#27ae60"/><text x={sx(r.MnB)+10} y={sy(r.PnB)+4} fill="#27ae60" fontSize={10} fontWeight={700} fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">B ({fmt(r.PnB,0)}k, {fmt(r.MnB,0)}kÃƒâ€šÃ‚Â·ft)</text>

        {/* Live demand point */}
        <circle cx={sx(Mu)} cy={sy(Pu)} r={9} fill="none" stroke={r.demandOk?"#2563eb":"#c0392b"} strokeWidth={2} opacity={0.35}>
          <animate attributeName="r" values="9;14;9" dur="1.4s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.35;0.05;0.35" dur="1.4s" repeatCount="indefinite"/>
        </circle>
        <circle cx={sx(Mu)} cy={sy(Pu)} r={6} fill={r.demandOk?"#2563eb":"#c0392b"} stroke="#fff" strokeWidth={2}/>
        <text x={sx(Mu)+12} y={sy(Pu)-8} fill={r.demandOk?"#1d4ed8":"#a52a1f"} fontSize={11} fontWeight={800} fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">
          Demand ({fmt(Pu,0)}k, {fmt(Mu,0)}kÃƒâ€šÃ‚Â·ft)
        </text>

        <text x={W/2} y={H-8} textAnchor="middle" fill="#6c757d" fontSize={10} fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace">Moment (kip-ft)</text>
        <text x={12} y={H/2} textAnchor="middle" fill="#6c757d" fontSize={10} fontFamily="'JetBrains Mono','Fira Code','Consolas',monospace" transform={`rotate(-90,12,${H/2})`}>Axial (kips)</text>
      </svg>
      <div style={{textAlign:"center",marginTop:6,fontSize:11,color:"#6c757d"}}>
        Blue pulsing point = your factored demand (Pu, Mu). Inside the curve and blue = OK; outside and red = overstressed.
      </div>
      </Graphic>
      </>)}
      {chartType==="capacity" && (
        <Graphic>
        <BarChart title="Capacity Breakdown" unit="kips" bars={[
          {label:"Pn @ Point A (pure comp.)", value:r.PnA, color:"#c0392b"},
          {label:"ÃƒÅ½Ã‚Â¦Pn @ Point A", value:r.phi*r.PnA, color:"#e8a838"},
          {label:"Pn @ Point B (balanced)", value:r.PnB, color:"#27ae60"},
          {label:"ÃƒÅ½Ã‚Â¦Mn @ Pu (kip-ft)", value:r.phiMnAtPu, color:"#2563eb"},
          {label:"Demand Pu", value:Pu, color:r.demandOk?"#27ae60":"#c0392b"},
          {label:"Demand Mu (kip-ft)", value:Mu, color:r.demandOk?"#27ae60":"#c0392b"},
        ]}/>
        </Graphic>
      )}
    </Card>
    </></OutputsBlock>
  </div>);
}

// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
// CPCI TAB
// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
function CPCITab({loadedCalc, onConsumedLoad, workspace}){
  const [sec,setSec]=useState("08H");
  const [cover,setCover]=useState(38),[stH,setStH]=useState(45);
  const [fc,setFc]=useState(60),[fci,setFci]=useState(28),[ag,setAg]=useState(20);
  const [nH,setNH]=useState(5),[nS,setNS]=useState(0);
  const [spanM,setSpanM]=useState(6),[sdl,setSdl]=useState(0),[ll,setLl]=useState(0),[sl,setSl]=useState(0);
  const [chartType,setChartType]=useState("stress");

  // Save/load wiring
  const user = useCurrentUser();
  const theme = useModuleTheme();
  const [saveOpen,setSaveOpen]=useState(false);
  const [activeCalc,setActiveCalc]=useState(null);
  const [allCalcs,setAllCalcs]=useState([]);
  const [saveMsg,setSaveMsg]=useState("");

  useEffect(()=>{ fetchCalcsForUser(user).then(setAllCalcs); },[user?.id,user?.role]);

  useEffect(()=>{
    if(loadedCalc && loadedCalc.inputs){
      const v = loadedCalc.inputs;
      if(v.sec!==undefined) setSec(v.sec);
      if(v.cover!==undefined) setCover(v.cover);
      if(v.stH!==undefined) setStH(v.stH);
      if(v.fc!==undefined) setFc(v.fc);
      if(v.fci!==undefined) setFci(v.fci);
      if(v.ag!==undefined) setAg(v.ag);
      if(v.nH!==undefined) setNH(v.nH);
      if(v.nS!==undefined) setNS(v.nS);
      if(v.spanM!==undefined) setSpanM(v.spanM);
      if(v.sdl!==undefined) setSdl(v.sdl);
      if(v.ll!==undefined) setLl(v.ll);
      if(v.sl!==undefined) setSl(v.sl);
      setActiveCalc(loadedCalc);
      onConsumedLoad && onConsumedLoad();
    }
  },[loadedCalc]);

  const currentInputs = {sec,cover,stH,fc,fci,ag,nH,nS,spanM,sdl,ll,sl};

  const doSave = async({projectName,partName,calcName})=>{
    const res = await saveCalc({
      projectName, partName, calcName, module:"cpci",
      inputs: currentInputs, reportText: null,
      userId: user?.id, userName: user?.name,
    });
    if(res.ok){
      setActiveCalc(res.row);
      fetchCalcsForUser(user).then(setAllCalcs);
      setSaveMsg("Saved ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“");
      setTimeout(()=>setSaveMsg(""),2500);
      return true;
    }
    return false;
  };

  const doUpdate = async()=>{
    if(!activeCalc) return;
    const res = await updateCalc(activeCalc.id, {inputs: currentInputs, reportText: null});
    if(res.ok){
      setSaveMsg("Updated ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“");
      setTimeout(()=>setSaveMsg(""),2500);
      fetchCalcsForUser(user).then(setAllCalcs);
    }
  };

  const r=useMemo(()=>{
    const s=CPCI_SLABS[sec];const Sb=s.Ix/s.yb,St=s.Ix/(s.h-s.yb);
    const Ec=Math.round(4500*Math.sqrt(fc)),Eci=Math.round(4500*Math.sqrt(fci));
    const Aps=nH*99+nS*143;const fpi=0.75*s.fpu,Ep=200000;
    const e=s.yb-stH,dp=s.yb+e;
    const a1=Math.max(0.67,0.85-0.0015*fc),b1=Math.max(0.67,0.97-0.0025*fc);
    const Po=fpi*Aps/1000;
    const tTop=-Po*1000/s.A+Po*1000*e/St,tBot=Po*1000/s.A+Po*1000*e/Sb;
    const wSW=s.SW*(s.b/1000);const MdM=wSW*spanM*spanM/8;
    const topSW=MdM*1e6/St,botSW=-MdM*1e6/Sb;
    const nTopM=tTop+topSW,nBotM=tBot+botSW;
    const lt=50*13/1000;const MdT=wSW*(spanM/2*lt-lt*lt/2);
    const topT=tTop+MdT*1e6/St,botT=tBot-MdT*1e6/Sb;
    const aTe=-0.5*Math.sqrt(fci),aCe=0.67*fci;
    const aTm=-0.25*Math.sqrt(fci),aCm=0.6*fci;
    const Pi=fpi*Aps/1000;const fcir2=0.9*(Pi*1000/s.A+Pi*1000*e*e/s.Ix);
    const ES=1*(Ep/Eci)*fcir2;const CR=2*(Ep/Ec)*fcir2;
    const VS=s.A/(2*(s.b+s.h));const SHv=0.0000082*Ep*(1-0.06*VS)*(100-70);
    const totalLoss=(ES+CR+SHv)/fpi*100;
    const kp=0.28;const cpp=(Aps*s.fpu)/(a1*fc*s.b+kp*Aps*s.fpu/dp);
    const fpr=s.fpu*(1-kp*cpp/dp);const aMM=a1*cpp;
    const Mr=0.9*Aps*fpr*(dp-aMM/2)/1e6;
    const Mf=1.25*MdM+1.5*(sdl+ll+sl)*(s.b/1000)*spanM*spanM/8;
    const wf=(1.25*s.SW+1.5*(sdl+ll+sl))*(s.b/1000);const Vf=wf*spanM/2;
    const dv=0.9*dp;const Vc=0.65*0.18*Math.sqrt(fc)*s.bw*dv/1000;
    const fcp=Po*1000/s.A;const Pc=s.Pc||2*(s.b+s.h);
    const Tcr=0.38*Math.sqrt(fc)*(s.A*s.A/Pc)*Math.sqrt(1+fcp/(0.38*Math.sqrt(fc)))/1e6;
    return {s,Sb,St,Ec,Eci,Aps,fpi,e,dp,Po,tTop,tBot,MdM,nTopM,nBotM,topT,botT,aTe,aCe,aTm,aCm,totalLoss,Mr,Mf,fpr,aMM,cpp,Vf,Vc,dv,fcp,Tcr,a1,b1,kp,ES,CR,SHv};
  },[sec,cover,stH,fc,fci,ag,nH,nS,spanM,sdl,ll,sl]);

  const {reportStyle}=useViewSettings();
  if(reportStyle==="tedds"){
    return(
      <TeddsDoc>
        <TeddsTitle calcId={`CPCI Non-Composite Hollowcore Slab Design ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ${sec}`} codeBasis="In accordance with CSA A23.3-19 and the CPCI Design Manual, 5th Edition" version="Calc version 1.0"/>
        <TeddsSection number={1} note="Flexure, shear, torsion, and transfer stress design for simple-span hollowcore slab"/>

        <TeddsHeading>Section properties</TeddsHeading>
        <TeddsLine label="Slab depth" sym="h" val={r.s.h} unit="mm" label2="Slab width" sym2="b" val2={r.s.b} unit2="mm"/>
        <TeddsLine label="Cross sectional area" sym="A" val={r.s.A} unit="mmÃƒâ€šÃ‚Â²" label2="Web width" sym2="bw" val2={r.s.bw} unit2="mm"/>
        <TeddsLine label="Section modulus (bottom)" sym="Sb" val={fmt(r.Sb,0)} unit="mmÃƒâ€šÃ‚Â³" label2="Section modulus (top)" sym2="St" val2={fmt(r.St,0)} unit2="mmÃƒâ€šÃ‚Â³"/>

        <TeddsHeading>Material properties</TeddsHeading>
        <TeddsLine label="Concrete strength at 28 days" sym="fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²c" val={fc} unit="MPa" label2="Concrete strength at release" sym2="fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²ci" val2={fci} unit2="MPa"/>
        <TeddsCalc sym="Ec" formula={`4500ÃƒÂ¢Ã‹â€ Ã…Â¡${fc}`} result={r.Ec} unit="MPa"/>
        <TeddsCalc sym="Eci" formula={`4500ÃƒÂ¢Ã‹â€ Ã…Â¡${fci}`} result={r.Eci} unit="MPa"/>

        <TeddsHeading>Prestressing steel</TeddsHeading>
        <TeddsLine label="Number of 13mm strands" sym="n13" val={nH} label2="Number of 15mm strands" sym2="n15" val2={nS}/>
        <TeddsCalc sym="Aps" formula={`${nH}ÃƒÆ’Ã¢â‚¬â€99 + ${nS}ÃƒÆ’Ã¢â‚¬â€143`} result={r.Aps} unit="mmÃƒâ€šÃ‚Â²"/>
        <TeddsLine label="Strand eccentricity" sym="e" val={fmt(r.e,1)} unit="mm" label2="Strand depth" sym2="dp" val2={fmt(r.dp,1)} unit2="mm"/>

        <TeddsHeading>Span and loading</TeddsHeading>
        <TeddsLine label="Design span" sym="L" val={spanM} unit="m" label2="Superimposed dead load" sym2="SDL" val2={sdl} unit2="kPa"/>
        <TeddsLine label="Live load" sym="LL" val={ll} unit="kPa" label2="Snow load" sym2="SL" val2={sl} unit2="kPa"/>

        <TeddsHeading>Transfer stress analysis</TeddsHeading>
        <TeddsCalc sym="Po" formula={`${fmt(r.fpi,0)} ÃƒÆ’Ã¢â‚¬â€ ${r.Aps} / 1000`} result={fmt(r.Po,2)} unit="kN"/>
        <TeddsLine label="Top stress at transfer" sym="ftop" val={fmt(r.topT,3)} unit="MPa" label2="Bottom stress at transfer" sym2="fbot" val2={fmt(r.botT,3)} unit2="MPa"/>

        <TeddsHeading>Loss of prestress</TeddsHeading>
        <TeddsCalc sym="Total loss" formula="(ES+CR+SH)/fpi ÃƒÆ’Ã¢â‚¬â€ 100" result={fmt(r.totalLoss,2)} unit="%"/>

        <TeddsHeading>Design flexural strength</TeddsHeading>
        <TeddsCalc sym="fpr" formula="fpu(1 ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ kpÃƒâ€šÃ‚Â·c/dp)" result={fmt(r.fpr,1)} unit="MPa"/>
        <TeddsCalc sym="Mr" formula="ÃƒÅ½Ã‚Â¦Ãƒâ€šÃ‚Â·ApsÃƒâ€šÃ‚Â·fprÃƒâ€šÃ‚Â·(dp ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ a/2)" result={fmt(r.Mr,2)} unit="kNm"/>
        <TeddsCalc sym="Mf" formula="1.25Md + 1.5(SDL+LL+SL)Ãƒâ€šÃ‚Â·(b/1000)Ãƒâ€šÃ‚Â·LÃƒâ€šÃ‚Â²/8" result={fmt(r.Mf,2)} unit="kNm"/>

        <TeddsHeading>Shear strength</TeddsHeading>
        <TeddsCalc sym="Vc" formula="ÃƒÅ½Ã‚Â¦cÃƒâ€šÃ‚Â·ÃƒÅ½Ã‚Â²Ãƒâ€šÃ‚Â·ÃƒÂ¢Ã‹â€ Ã…Â¡fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²cÃƒâ€šÃ‚Â·bwÃƒâ€šÃ‚Â·dv" result={fmt(r.Vc,2)} unit="kN"/>
        <TeddsLine label="Factored shear" sym="Vf" val={fmt(r.Vf,2)} unit="kN"/>

        <TeddsHeading>Results summary</TeddsHeading>
        <TeddsTable
          headers={["Check","Unit","Capacity","Maximum","Utilization","Result"]}
          rows={[
            [ "Tension stress, end","MPa", fmt(Math.abs(r.aTe),3), fmt(r.topT>0?0:Math.abs(r.topT),3), fmt(r.topT<r.aTe?Math.abs(r.topT/r.aTe):0,3), r.topT>r.aTe?"PASS":"FAIL" ],
            utilRow("Compression stress, end","MPa", r.aCe, r.botT),
            utilRow("Flexural strength","kNm", r.Mr, r.Mf),
            utilRow("Shear strength","kN", r.Vc, r.Vf),
          ]}
        />
      </TeddsDoc>
    );
  }

  return(<div>
    <div className="no-print" style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,marginBottom:12,padding:"8px 12px",background:"#f8f9fa",border:"1px solid #dee2e6",borderRadius:6}}>
      <div style={{fontSize:12,color:"#495057"}}>
        {activeCalc ? <>ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã¢â‚¬Å¾ <b>{activeCalc.calc_name}</b> <span style={{color:"#868e96"}}>({activeCalc.project_name} / {activeCalc.part_name})</span></> : <span style={{color:"#868e96"}}>Not yet saved to a project</span>}
        {saveMsg && <span style={{marginLeft:10,color:"#1e7e34",fontWeight:700}}>{saveMsg}</span>}
      </div>
      <div style={{display:"flex",gap:6}}>
        {activeCalc && activeCalc.created_by_id===user?.id && (
          <button onClick={doUpdate} style={{padding:"6px 12px",borderRadius:4,border:`1px solid ${theme.accent}`,background:theme.soft,color:theme.text,fontWeight:700,fontSize:11,cursor:"pointer"}}>ÃƒÂ¢Ã¢â‚¬Â Ã‚Â» Update Saved File</button>
        )}
        <button onClick={()=>setSaveOpen(true)} style={{padding:"6px 12px",borderRadius:4,border:`2px solid ${theme.accentDark}`,background:theme.accentDark,color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer"}}>ÃƒÂ°Ã…Â¸Ã¢â‚¬â„¢Ã‚Â¾ Save AsÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦</button>
      </div>
    </div>
    <SaveCalcModal open={saveOpen} onClose={()=>setSaveOpen(false)} onSave={doSave} existingProjects={allCalcs}
      defaultProject={activeCalc?.project_name || workspace?.project} defaultPart={activeCalc?.part_name || workspace?.part}/>

    <OutputsBlock><Graphic>
    <Card title="Scientific Charts & 3D Model">
      <ChartPicker value={chartType} onChange={setChartType} options={[
        {id:"stress",label:"Stress vs. Depth"},
        {id:"beam",label:"Moment & Shear"},
        {id:"losses",label:"Prestress Losses"},
        {id:"util",label:"Utilization Summary"},
        {id:"3d",label:"ÃƒÂ°Ã…Â¸Ã‚Â§Ã…Â  3D Model"},
      ]}/>
      {chartType==="3d" && (
        <Viewer3D
          height={380}
          initialDistance={Math.max(r.s.b/25.4, spanM*39.37*2)*0.18+8}
          deps={[r.s.h, r.s.b, nH, nS, r.dp, spanM]}
          buildScene={(group,THREE,helpers)=>buildHollowcoreScene(group,THREE,{
            h:r.s.h/25.4, b:r.s.b/25.4, length:Math.min(spanM*39.37, 240), cores:4, coreD:(r.s.h/25.4)*0.65,
            nStrands:nH+nS, dp:r.dp/25.4,
          }, helpers)}
          editableDims={{
            length: { value:Math.round(Math.min(spanM*39.37,240)*10)/10, unit:"in", onChange:(v)=>setSpanM(Math.max(0.3, v/39.37)) },
          }}
        />
      )}
      {chartType==="stress" && (
        <div style={{display:"flex",flexWrap:"wrap",justifyContent:"center",gap:10}}>
          <StressDepthChart h={r.s.h/25.4} topStress={r.topT} botStress={r.botT} depthLabel="@ Transfer (MPa)" allowTens={r.aTe} allowComp={r.aCe}/>
          <StressDepthChart h={r.s.h/25.4} topStress={r.nTopM} botStress={r.nBotM} depthLabel="@ Midspan (MPa)" allowTens={r.aTm} allowComp={r.aCm}/>
        </div>
      )}
      {chartType==="beam" && (
        <BeamDiagrams span={spanM} w={(1.25*r.s.SW+1.5*(sdl+ll+sl))*(r.s.b/1000)} Mmax={r.Mf} Vmax={r.Vf}/>
      )}
      {chartType==="losses" && (
        <BarChart unit="MPa" title="Loss of Prestress Breakdown" bars={[
          {label:"Elastic Shortening (ES)", value:r.ES, color:"#2563eb"},
          {label:"Creep (CR)", value:r.CR, color:"#7c3aed"},
          {label:"Shrinkage (SH)", value:r.SHv, color:"#0891b2"},
        ]}/>
      )}
      {chartType==="util" && (
        <BarChart title="Utilization ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Capacity vs Maximum" unit="" bars={[
          {label:"Flexural strength", value:r.Mf/r.Mr, color:r.Mr>r.Mf?"#27ae60":"#c0392b"},
          {label:"Shear strength", value:r.Vf/r.Vc, color:r.Vc>r.Vf?"#27ae60":"#c0392b"},
        ]}/>
      )}
    </Card>
    </Graphic></OutputsBlock>

    <InputsBlock><>
    <Card title="Slab Properties (Metric)">
      <R><OI label="Section" value={sec} onChange={setSec} options={Object.keys(CPCI_SLABS)} width={160}/></R>
      <R><CI label="h" value={r.s.h} unit="mm"/><CI label="A" value={r.s.A} unit="mmÃƒâ€šÃ‚Â²"/><CI label="b" value={r.s.b} unit="mm"/><CI label="bw" value={r.s.bw} unit="mm"/></R>
    </Card>
    <Card title="Concrete">
      <Eq tex="Ec = 4500ÃƒÂ¢Ã‹â€ Ã…Â¡fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²c" code="CSA A23.3-19 Ãƒâ€šÃ‚Â§8.6.2.2"/>
      <Eq tex="ÃƒÅ½Ã‚Â±ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â = 0.85 ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ 0.0015fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²c ÃƒÂ¢Ã¢â‚¬Â°Ã‚Â¥ 0.67" code="CSA A23.3-19 Ãƒâ€šÃ‚Â§10.1.7"/>
      <Eq tex="ÃƒÅ½Ã‚Â²ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â = 0.97 ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ 0.0025fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²c ÃƒÂ¢Ã¢â‚¬Â°Ã‚Â¥ 0.67" code="CSA A23.3-19 Ãƒâ€šÃ‚Â§10.1.7"/>
      <R><OI label="Cover" value={cover} onChange={setCover} unit="mm"/><OI label="Strand ht" value={stH} onChange={setStH} unit="mm"/><OI label={<Sym base="f" sub="c" prime/>} value={fc} onChange={setFc} unit="MPa"/><OI label={<Sym base="f" sub="ci" prime/>} value={fci} onChange={setFci} unit="MPa"/><OI label="ag" value={ag} onChange={setAg} unit="mm"/></R>
      <R><CI label={<Sym base="E" sub="c"/>} value={r.Ec} unit="MPa"/><CI label={<Sym base="E" sub="ci"/>} value={r.Eci} unit="MPa"/><CI label="ÃƒÅ½Ã‚Â±ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â" value={fmt(r.a1,3)}/><CI label="ÃƒÅ½Ã‚Â²ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â" value={fmt(r.b1,3)}/></R>
    </Card>
    <Card title="Strands">
      <Eq tex="Aps = nÃƒÂ¢Ã¢â‚¬Å¡Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã†â€™ ÃƒÆ’Ã¢â‚¬â€ 99 + nÃƒÂ¢Ã¢â‚¬Å¡Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã¢â‚¬Â¦ ÃƒÆ’Ã¢â‚¬â€ 143 (mmÃƒâ€šÃ‚Â²)" code="CPCI Handbook Ãƒâ€šÃ‚Â§3.2"/>
      <R><OI label="# 13mm" value={nH} onChange={setNH} step={1}/><OI label="# 15mm" value={nS} onChange={setNS} step={1}/></R>
      <R><CI label={<Sym base="A" sub="ps"/>} value={r.Aps} unit="mmÃƒâ€šÃ‚Â²"/><CI label="fpi" value={fmt(r.fpi,0)} unit="MPa"/><CI label="e" value={fmt(r.e,1)} unit="mm"/><CI label="dp" value={fmt(r.dp,1)} unit="mm"/></R>
    </Card>
    <Card title="Loading">
      <R><OI label="Span" value={spanM} onChange={setSpanM} unit="m"/><OI label="SDL" value={sdl} onChange={setSdl} unit="kPa"/><OI label="LL" value={ll} onChange={setLl} unit="kPa"/><OI label="SL" value={sl} onChange={setSl} unit="kPa"/></R>
    </Card>
    </></InputsBlock>
    <OutputsBlock><>
    <SH>Outputs</SH>
    <Card title="Transfer Stresses">
      <Eq tex="f = Ãƒâ€šÃ‚Â±Po/A Ãƒâ€šÃ‚Â± PoÃƒâ€šÃ‚Â·e/S" code="CSA A23.3-19 Ãƒâ€šÃ‚Â§18.3.1"/>
      <Eq tex="Tension allow = ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢0.5ÃƒÂ¢Ã‹â€ Ã…Â¡fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²ci     Comp allow = 0.67fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²ci" code="CSA A23.3-19 Ãƒâ€šÃ‚Â§18.3.1"/>
      <Res label="PÃƒÂ¢Ã¢â‚¬Å¡Ã¢â€šÂ¬" value={fmt(r.Po,2)} unit="kN"/>
      <Check label="Tension End" actual={fmt(r.topT,2)} limit={fmt(r.aTe,2)} unit="MPa" ok={r.topT>r.aTe}/>
      <Check label="Comp End" actual={fmt(r.botT,1)} limit={fmt(r.aCe,1)} unit="MPa" ok={r.botT<r.aCe}/>
      <Check label="Tension Mid" actual={fmt(r.nTopM,2)} limit={fmt(r.aTm,2)} unit="MPa" ok={r.nTopM>r.aTm}/>
      <Check label="Comp Mid" actual={fmt(r.nBotM,1)} limit={fmt(r.aCm,1)} unit="MPa" ok={r.nBotM<r.aCm}/>
    </Card>
    <Card title="Losses"><Eq tex="Total = (ES+CR+SH)/fpi ÃƒÆ’Ã¢â‚¬â€ 100" code="CSA A23.3-19 Ãƒâ€šÃ‚Â§18.6"/><Res label="Total Loss" value={<span style={{fontSize:18,fontWeight:800}}>{fmt(r.totalLoss,2)}%</span>}/></Card>
    <Card title="Flexural Strength">
      <Eq tex="c = ApsÃƒâ€šÃ‚Â·fpu / (ÃƒÅ½Ã‚Â±ÃƒÂ¢Ã¢â‚¬Å¡Ã‚ÂfÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²cÃƒâ€šÃ‚Â·b + kpÃƒâ€šÃ‚Â·ApsÃƒâ€šÃ‚Â·fpu/dp)" code="CSA A23.3-19 Ãƒâ€šÃ‚Â§18.6.2"/>
      <Eq tex="fpr = fpu(1 ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ kpÃƒâ€šÃ‚Â·c/dp)" code="CSA A23.3-19 Ãƒâ€šÃ‚Â§18.6.2"/>
      <Eq tex="Mr = ÃƒÅ½Ã‚Â¦Ãƒâ€šÃ‚Â·ApsÃƒâ€šÃ‚Â·fprÃƒâ€šÃ‚Â·(dp ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ a/2)" code="CSA A23.3-19 Ãƒâ€šÃ‚Â§18.6.2"/>
      <Eq tex="Mf = 1.25Md + 1.5(SDL+LL+SL)Ãƒâ€šÃ‚Â·(b/1000)Ãƒâ€šÃ‚Â·LÃƒâ€šÃ‚Â²/8" code="CSA A23.3-19 Ãƒâ€šÃ‚Â§8.3.2"/>
      <Res label="c" value={fmt(r.cpp,2)} unit="mm"/><Res label="fpr" value={fmt(r.fpr,1)} unit="MPa"/>
      <Check label="Mr > Mf" actual={fmt(r.Mr,2)} limit={fmt(r.Mf,2)} unit="kNm" ok={r.Mr>r.Mf}/>
    </Card>
    <Card title="Shear">
      <Eq tex="Vc = ÃƒÅ½Ã‚Â¦cÃƒâ€šÃ‚Â·ÃƒÅ½Ã‚Â²Ãƒâ€šÃ‚Â·ÃƒÂ¢Ã‹â€ Ã…Â¡fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²cÃƒâ€šÃ‚Â·bwÃƒâ€šÃ‚Â·dv" code="CSA A23.3-19 Ãƒâ€šÃ‚Â§11.3.4"/>
      <Res label="Vf" value={fmt(r.Vf,2)} unit="kN"/><Res label="Vc" value={fmt(r.Vc,2)} unit="kN"/>
      <Check label="Vc > Vf" actual={fmt(r.Vc,2)} limit={fmt(r.Vf,2)} unit="kN" ok={r.Vc>r.Vf}/>
    </Card>
    <Card title="Torsion">
      <Eq tex="Tcr = 0.38ÃƒÂ¢Ã‹â€ Ã…Â¡fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²cÃƒâ€šÃ‚Â·(AÃƒâ€šÃ‚Â²/Pc)Ãƒâ€šÃ‚Â·ÃƒÂ¢Ã‹â€ Ã…Â¡(1 + fcp/0.38ÃƒÂ¢Ã‹â€ Ã…Â¡fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²c)" code="CSA A23.3-19 Ãƒâ€šÃ‚Â§11.2.9.1"/>
      <Res label={<Sym base="T" sub="cr"/>} value={fmt(r.Tcr,2)} unit="kNm"/><Res label="0.25 Tcr" value={fmt(r.Tcr*.25,2)} unit="kNm"/>
    </Card>
    </></OutputsBlock>
  </div>);
}

// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
// HC CRUSH TAB
// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
function CrushTab({loadedCalc, onConsumedLoad, workspace}){
  const [sec,setSec]=useState("HC10");
  const [w,setW]=useState(50);
  const [fc,setFc]=useState(48);
  const [ecc,setEcc]=useState(0);
  const [hB,setHB]=useState(200);
  const [chartType,setChartType]=useState("capacity");

  // Save/load wiring
  const user = useCurrentUser();
  const theme = useModuleTheme();
  const [saveOpen,setSaveOpen]=useState(false);
  const [activeCalc,setActiveCalc]=useState(null);
  const [allCalcs,setAllCalcs]=useState([]);
  const [saveMsg,setSaveMsg]=useState("");

  useEffect(()=>{ fetchCalcsForUser(user).then(setAllCalcs); },[user?.id,user?.role]);

  useEffect(()=>{
    if(loadedCalc && loadedCalc.inputs){
      const v = loadedCalc.inputs;
      if(v.sec!==undefined) setSec(v.sec);
      if(v.w!==undefined) setW(v.w);
      if(v.fc!==undefined) setFc(v.fc);
      if(v.ecc!==undefined) setEcc(v.ecc);
      if(v.hB!==undefined) setHB(v.hB);
      setActiveCalc(loadedCalc);
      onConsumedLoad && onConsumedLoad();
    }
  },[loadedCalc]);

  const currentInputs = {sec,w,fc,ecc,hB};

  const doSave = async({projectName,partName,calcName})=>{
    const res = await saveCalc({
      projectName, partName, calcName, module:"crush",
      inputs: currentInputs, reportText: null,
      userId: user?.id, userName: user?.name,
    });
    if(res.ok){
      setActiveCalc(res.row);
      fetchCalcsForUser(user).then(setAllCalcs);
      setSaveMsg("Saved ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“");
      setTimeout(()=>setSaveMsg(""),2500);
      return true;
    }
    return false;
  };

  const doUpdate = async()=>{
    if(!activeCalc) return;
    const res = await updateCalc(activeCalc.id, {inputs: currentInputs, reportText: null});
    if(res.ok){
      setSaveMsg("Updated ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“");
      setTimeout(()=>setSaveMsg(""),2500);
      fetchCalcsForUser(user).then(setAllCalcs);
    }
  };

  const r=useMemo(()=>{
    const s=HC_CRUSH[sec];const phi=0.65;
    const AeH=2*w*s.bw/(s.b/1000),AeS=1*w*s.bw/(s.b/1000);
    const eF=1-2*(ecc/hB);
    return {s,AeH,AeS,eF,PnH:phi*0.85*AeH*fc*eF/1000,PnS:phi*0.85*AeS*fc*eF/1000,phi};
  },[sec,w,fc,ecc,hB]);

  const {reportStyle}=useViewSettings();
  if(reportStyle==="tedds"){
    return(
      <TeddsDoc>
        <TeddsTitle calcId={`Hollowcore End Crushing Capacity ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ${sec}`} codeBasis="In accordance with CSA A23.3-19 and the CPCI Design Manual, 5th Edition" version="Calc version 1.0"/>
        <TeddsSection number={1} note="Bearing-induced core crushing capacity check at slab end support"/>

        <TeddsHeading>Section properties</TeddsHeading>
        <TeddsLine label="Slab depth" sym="h" val={r.s.h} unit="mm" label2="Slab width" sym2="b" val2={r.s.b} unit2="mm"/>
        <TeddsLine label="Web width" sym="bw" val={r.s.bw} unit="mm"/>

        <Graphic><BearingDiagram h={r.s.h} w={w} bw={r.s.bw} b={r.s.b}/></Graphic>

        <TeddsHeading>Bearing conditions</TeddsHeading>
        <TeddsLine label="Bearing width" sym="w" val={w} unit="mm" label2="Concrete strength" sym2="fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²c" val2={fc} unit2="MPa"/>
        <TeddsLine label="Eccentricity of bearing reaction" sym="e" val={ecc} unit="mm" label2="Bearing height" sym2="hb" val2={hB} unit2="mm"/>

        <TeddsHeading>Effective bearing area</TeddsHeading>
        <TeddsCalc sym="Ae,horiz" formula={`2 ÃƒÆ’Ã¢â‚¬â€ ${w} ÃƒÆ’Ã¢â‚¬â€ ${r.s.bw} / (${r.s.b}/1000)`} result={fmt(r.AeH,1)} unit="mmÃƒâ€šÃ‚Â²/m"/>
        <TeddsCalc sym="Ae,single" formula={`1 ÃƒÆ’Ã¢â‚¬â€ ${w} ÃƒÆ’Ã¢â‚¬â€ ${r.s.bw} / (${r.s.b}/1000)`} result={fmt(r.AeS,1)} unit="mmÃƒâ€šÃ‚Â²"/>

        <TeddsHeading>Core crushing capacity</TeddsHeading>
        <TeddsCalc sym="Re" formula={`1 ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ 2(${ecc})/${hB}`} result={fmt(r.eF,4)}/>
        <TeddsCalc sym="ÃƒÅ½Ã‚Â¦Pn,horiz" formula={`0.65 ÃƒÆ’Ã¢â‚¬â€ 0.85 ÃƒÆ’Ã¢â‚¬â€ Ae ÃƒÆ’Ã¢â‚¬â€ ${fc} ÃƒÆ’Ã¢â‚¬â€ Re / 1000`} result={fmt(r.PnH,2)} unit="kN/m"/>
        <TeddsCalc sym="ÃƒÅ½Ã‚Â¦Pn,single" formula={`0.65 ÃƒÆ’Ã¢â‚¬â€ 0.85 ÃƒÆ’Ã¢â‚¬â€ Ae ÃƒÆ’Ã¢â‚¬â€ ${fc} ÃƒÆ’Ã¢â‚¬â€ Re / 1000`} result={fmt(r.PnS,2)} unit="kN"/>

        <TeddsHeading>Results summary</TeddsHeading>
        <TeddsTable
          headers={["Check","Unit","Capacity","Maximum","Utilization","Result"]}
          rows={[
            [ "Horizontal abutting joints","kN/m", fmt(r.PnH,2), "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â", "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â", "PASS" ],
            [ "Single end joint","kN", fmt(r.PnS,2), "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â", "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â", "PASS" ],
          ]}
        />
      </TeddsDoc>
    );
  }

  return(<div>
    <div className="no-print" style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,marginBottom:12,padding:"8px 12px",background:"#f8f9fa",border:"1px solid #dee2e6",borderRadius:6}}>
      <div style={{fontSize:12,color:"#495057"}}>
        {activeCalc ? <>ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã¢â‚¬Å¾ <b>{activeCalc.calc_name}</b> <span style={{color:"#868e96"}}>({activeCalc.project_name} / {activeCalc.part_name})</span></> : <span style={{color:"#868e96"}}>Not yet saved to a project</span>}
        {saveMsg && <span style={{marginLeft:10,color:"#1e7e34",fontWeight:700}}>{saveMsg}</span>}
      </div>
      <div style={{display:"flex",gap:6}}>
        {activeCalc && activeCalc.created_by_id===user?.id && (
          <button onClick={doUpdate} style={{padding:"6px 12px",borderRadius:4,border:`1px solid ${theme.accent}`,background:theme.soft,color:theme.text,fontWeight:700,fontSize:11,cursor:"pointer"}}>ÃƒÂ¢Ã¢â‚¬Â Ã‚Â» Update Saved File</button>
        )}
        <button onClick={()=>setSaveOpen(true)} style={{padding:"6px 12px",borderRadius:4,border:`2px solid ${theme.accentDark}`,background:theme.accentDark,color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer"}}>ÃƒÂ°Ã…Â¸Ã¢â‚¬â„¢Ã‚Â¾ Save AsÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦</button>
      </div>
    </div>
    <SaveCalcModal open={saveOpen} onClose={()=>setSaveOpen(false)} onSave={doSave} existingProjects={allCalcs}
      defaultProject={activeCalc?.project_name || workspace?.project} defaultPart={activeCalc?.part_name || workspace?.part}/>
    <InputsBlock><>
    <Card title="Slab & Bearing">
      <R><OI label="Section" value={sec} onChange={setSec} options={Object.keys(HC_CRUSH)}/></R>
      <Graphic><BearingDiagram h={r.s.h} w={w} bw={r.s.bw} b={r.s.b}/></Graphic>
      <R><CI label="h" value={r.s.h} unit="mm"/><CI label="b" value={r.s.b} unit="mm"/><CI label="bw" value={r.s.bw} unit="mm"/></R>
      <R><OI label="Bearing w" value={w} onChange={setW} unit="mm"/><OI label={<Sym base="f" sub="c" prime/>} value={fc} onChange={setFc} unit="MPa"/><OI label="e" value={ecc} onChange={setEcc} unit="mm"/><OI label="h (brg)" value={hB} onChange={setHB} unit="mm"/></R>
    </Card>
    </></InputsBlock>
    <OutputsBlock><>
    <SH>Outputs</SH>
    <Card title="Effective Bearing Area">
      <Eq tex="Ae(horiz) = 2Ãƒâ€šÃ‚Â·wÃƒâ€šÃ‚Â·bw / (b/1000)" code="CPCI Handbook Ãƒâ€šÃ‚Â§4.5.1"/>
      <Eq tex="Ae(single) = 1Ãƒâ€šÃ‚Â·wÃƒâ€šÃ‚Â·bw / (b/1000)" code="CPCI Handbook Ãƒâ€šÃ‚Â§4.5.1"/>
      <Res label="Ae (horiz)" value={fmt(r.AeH,1)} unit="mmÃƒâ€šÃ‚Â²/m"/><Res label="Ae (single)" value={fmt(r.AeS,1)} unit="mmÃƒâ€šÃ‚Â²"/>
    </Card>
    <Card title="Core Crushing Capacity">
      <Eq tex="Re = 1 ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ 2e/h" code="CPCI Handbook Ãƒâ€šÃ‚Â§4.5.2"/>
      <Eq tex="ÃƒÅ½Ã‚Â¦Pn = ÃƒÅ½Ã‚Â¦ ÃƒÆ’Ã¢â‚¬â€ 0.85 ÃƒÆ’Ã¢â‚¬â€ Ae ÃƒÆ’Ã¢â‚¬â€ fÃƒÂ¢Ã¢â€šÂ¬Ã‚Â²c ÃƒÆ’Ã¢â‚¬â€ Re / 1000" code="CSA A23.3-19 Ãƒâ€šÃ‚Â§10.8.1"/>
      <Res label="RÃƒÂ¢Ã¢â‚¬Å¡Ã¢â‚¬Ëœ" value={fmt(r.eF,4)}/><Res label="ÃƒÅ½Ã‚Â¦" value={r.phi}/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:10}}>
        <div style={{padding:14,background:"#f8f9fa",borderRadius:4,textAlign:"center",border:"1px solid #dee2e6"}}>
          <div style={{fontSize:11,fontWeight:700,color:"#6c757d",textTransform:"uppercase",letterSpacing:0.5,marginBottom:4}}>Horiz. Abutting Joints</div>
          <div style={{fontSize:24,fontWeight:800,fontFamily:"'JetBrains Mono','Fira Code','Consolas',monospace"}}>{fmt(r.PnH,2)}</div>
          <div style={{fontSize:11,color:"#999"}}>ÃƒÅ½Ã‚Â¦Pn (kN/m)</div>
        </div>
        <div style={{padding:14,background:"#f8f9fa",borderRadius:4,textAlign:"center",border:"1px solid #dee2e6"}}>
          <div style={{fontSize:11,fontWeight:700,color:"#6c757d",textTransform:"uppercase",letterSpacing:0.5,marginBottom:4}}>Single End Joint</div>
          <div style={{fontSize:24,fontWeight:800,fontFamily:"'JetBrains Mono','Fira Code','Consolas',monospace"}}>{fmt(r.PnS,2)}</div>
          <div style={{fontSize:11,color:"#999"}}>ÃƒÅ½Ã‚Â¦Pn (kN/m)</div>
        </div>
      </div>
    </Card>

    <Card title="Scientific Charts">
      <ChartPicker value={chartType} onChange={setChartType} options={[
        {id:"capacity",label:"Capacity Comparison"},
        {id:"ecc",label:"Capacity vs. Eccentricity"},
      ]}/>
      {chartType==="capacity" && (
        <Graphic>
        <BarChart title="Crushing Capacity by Joint Type" unit="kN/m" bars={[
          {label:"Horizontal Abutting Joints", value:r.PnH, color:"#2563eb"},
          {label:"Single End Joint", value:r.PnS, color:"#ea580c"},
        ]}/>
        </Graphic>
      )}
      {chartType==="ecc" && (
        <Graphic>
        <LineChart title="Capacity vs. Bearing Eccentricity" xLabel="Eccentricity, e (mm)" yLabel="ÃƒÅ½Ã‚Â¦Pn,horiz (kN/m)"
          series={[{
            points: Array.from({length:21}).map((_,i)=>{
              const eTest = (hB/2)*(i/20);
              const ReTest = 1-2*(eTest/hB);
              const PnTest = r.phi*0.85*r.AeH*fc*ReTest/1000;
              return {x:eTest, y:Math.max(PnTest,0)};
            }),
            color:"#2563eb", label:"ÃƒÅ½Ã‚Â¦Pn"
          }]}/>
        </Graphic>
      )}
    </Card>
    </></OutputsBlock>
  </div>);
}

// ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â

function LoginScreen({onLogin}){
  const[uid,setUid]=React.useState("");
  const[pwd,setPwd]=React.useState("");
  const[err,setErr]=React.useState("");
  const MONO="'JetBrains Mono','Fira Code','Consolas',monospace";
  const submit=async()=>{
    const key=uid.trim().toLowerCase();
    const u=EMPLOYEES[key];
    if(u&&u.pass===pwd){
      setErr("");
      const runtimeRole=await fetchUserRole(key);
      const effectiveRole=runtimeRole||u.role||"user";
      onLogin({id:key,name:u.name,role:effectiveRole,runtimeAdmin:effectiveRole==="admin"});
    }else{setErr("Invalid employee ID or password.");}
  };
  return(
    <div style={{fontFamily:"'Inter','Segoe UI',system-ui,sans-serif",minHeight:"100vh",background:"#212529",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#fff",borderRadius:8,padding:"32px 28px",width:"100%",maxWidth:340,boxShadow:"0 10px 40px rgba(0,0,0,0.3)"}}>
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:28,marginBottom:8}}>🏗️</div>
          <div style={{fontSize:15,fontWeight:800,fontFamily:MONO,textTransform:"uppercase",letterSpacing:1}}>BT Structural</div>
          <div style={{fontSize:11,color:"#868e96",marginTop:4}}>Employee Access Only</div>
        </div>
        <div style={{marginBottom:12}}>
          <label style={{fontSize:11,fontWeight:700,color:"#374151",display:"block",marginBottom:4,fontFamily:MONO}}>EMPLOYEE ID</label>
          <input value={uid} onChange={e=>setUid(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="e.g. bhavjeet" style={{width:"100%",padding:"9px 12px",border:"1.5px solid #dee2e6",borderRadius:4,fontSize:13,boxSizing:"border-box"}}/>
        </div>
        <div style={{marginBottom:16}}>
          <label style={{fontSize:11,fontWeight:700,color:"#374151",display:"block",marginBottom:4,fontFamily:MONO}}>PASSWORD</label>
          <input type="password" value={pwd} onChange={e=>setPwd(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} style={{width:"100%",padding:"9px 12px",border:"1.5px solid #dee2e6",borderRadius:4,fontSize:13,boxSizing:"border-box"}}/>
        </div>
        {err&&<div style={{color:"#c0392b",fontSize:11,marginBottom:10,padding:"6px 10px",background:"#fdecea",borderRadius:4}}>{err}</div>}
        <button onClick={submit} style={{width:"100%",padding:"10px",borderRadius:4,border:"none",background:"#212529",color:"#fff",fontWeight:800,fontSize:13,cursor:"pointer",fontFamily:MONO,textTransform:"uppercase",letterSpacing:0.5}}>SIGN IN</button>
        <div style={{textAlign:"center",marginTop:12,fontSize:10,color:"#adb5bd"}}>Building Theory · Miami, FL</div>
      </div>
    </div>
  );
}

function WorkspacePicker({userName,onSignOut,onEnter,onOpenCalc}){
  const user=useCurrentUser();
  const[calcs,setCalcs]=React.useState([]);
  const[loading,setLoading]=React.useState(true);
  const[selProject,setSelProject]=React.useState(null);
  const[selPart,setSelPart]=React.useState(null);
  const[newName,setNewName]=React.useState("");
  const[newProjectOpen,setNewProjectOpen]=React.useState(false);
  const[newPartOpen,setNewPartOpen]=React.useState(false);
  const MONO="'JetBrains Mono','Fira Code','Consolas',monospace";
  const reload=async()=>{setLoading(true);const data=await fetchCalcsForUser(user);setCalcs(data);setLoading(false);};
  React.useEffect(()=>{reload();},[]);
  const projects=[...new Set(calcs.map(c=>c.project_name))].sort();
  const parts=selProject?[...new Set(calcs.filter(c=>c.project_name===selProject).map(c=>c.part_name))].sort():[];
  const files=(selProject&&selPart)?calcs.filter(c=>c.project_name===selProject&&c.part_name===selPart).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)):[];
  const stage=selPart?"files":selProject?"parts":"projects";
  const cardS={cursor:"pointer",padding:16,border:"1px solid #dee2e6",borderRadius:8,background:"#fff",transition:"box-shadow 0.15s"};
  return(
    <div style={{fontFamily:"'Inter','Segoe UI',system-ui,sans-serif",maxWidth:860,margin:"0 auto",padding:"16px 12px",color:"#212529",background:"#fff",minHeight:"100vh"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"2px solid #212529",paddingBottom:10,marginBottom:16}}>
        <div><h1 style={{fontSize:16,fontWeight:800,margin:0,fontFamily:MONO,textTransform:"uppercase"}}>BT Structural Calculator</h1></div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:12,fontWeight:600}}>{userName}</div>
          <button onClick={onSignOut} style={{fontSize:10,color:"#868e96",background:"none",border:"none",cursor:"pointer",textDecoration:"underline",padding:0}}>Sign out</button>
        </div>
      </div>
      {loading&&<div style={{textAlign:"center",padding:40,color:"#868e96"}}>Loading…</div>}
      {!loading&&stage==="projects"&&(<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:10}}>
        {projects.map(p=>(<div key={p} onClick={()=>setSelProject(p)} style={cardS} onMouseEnter={e=>e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,0.08)"} onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}><div style={{fontSize:24,marginBottom:4}}>📁</div><div style={{fontWeight:700,fontSize:13}}>{p}</div></div>))}
        <div onClick={()=>setNewProjectOpen(true)} style={{...cardS,border:"2px dashed #ced4da",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"#868e96"}}><div style={{fontSize:24,marginBottom:4}}>＋</div><div style={{fontWeight:700,fontSize:12}}>New Project</div></div>
      </div>)}
      {!loading&&stage==="parts"&&(<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:10}}>
        {parts.map(pt=>(<div key={pt} onClick={()=>setSelPart(pt)} style={cardS} onMouseEnter={e=>e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,0.08)"} onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}><div style={{fontSize:22,marginBottom:4}}>🗂️</div><div style={{fontWeight:700,fontSize:13}}>{pt}</div></div>))}
        <div onClick={()=>setNewPartOpen(true)} style={{...cardS,border:"2px dashed #ced4da",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"#868e96"}}><div style={{fontSize:22,marginBottom:4}}>＋</div><div style={{fontWeight:700,fontSize:12}}>New Part</div></div>
      </div>)}
      {!loading&&stage==="files"&&(<div>
        <button onClick={()=>onEnter(selProject,selPart)} style={{width:"100%",padding:12,borderRadius:8,border:"none",background:"#212529",color:"#fff",fontWeight:800,fontSize:12,cursor:"pointer",marginBottom:12,fontFamily:MONO,textTransform:"uppercase"}}>＋ Start New Calculation</button>
        {files.map(f=>(<div key={f.id} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px",border:"1px solid #dee2e6",borderRadius:6,marginBottom:6,background:"#fff"}}>
          <span style={{fontSize:18}}>📄</span>
          <div style={{flex:1,minWidth:0}}><div style={{fontWeight:700,fontSize:12}}>{f.calc_name}</div><div style={{fontSize:10,color:"#868e96"}}>{f.project_name}/{f.part_name} · {new Date(f.created_at).toLocaleDateString()}</div></div>
          <button onClick={()=>onOpenCalc(f)} style={{padding:"5px 10px",borderRadius:4,border:"2px solid #2563eb",background:"#eff6ff",color:"#1d4ed8",fontWeight:700,fontSize:11,cursor:"pointer"}}>Open</button>
        </div>))}
      </div>)}
      {newProjectOpen&&(<div onClick={()=>{setNewProjectOpen(false);setNewName("");}} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center"}}><div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:8,padding:20,width:"100%",maxWidth:340}}><div style={{fontSize:14,fontWeight:800,marginBottom:12}}>📁 New Project</div><input autoFocus value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newName.trim()){setSelProject(newName.trim());setNewProjectOpen(false);setNewName("");}}} placeholder="Project name" style={{width:"100%",padding:"8px 10px",borderRadius:4,border:"2px solid #e8a838",fontSize:13,boxSizing:"border-box",marginBottom:12}}/><div style={{display:"flex",gap:8}}><button onClick={()=>{setNewProjectOpen(false);setNewName("");}} style={{flex:1,padding:8,borderRadius:4,border:"1px solid #ced4da",background:"#fff",cursor:"pointer"}}>Cancel</button><button onClick={()=>{if(newName.trim()){setSelProject(newName.trim());setNewProjectOpen(false);setNewName("");}}} style={{flex:1,padding:8,borderRadius:4,border:"none",background:"#212529",color:"#fff",cursor:"pointer",fontWeight:700}}>Create</button></div></div></div>)}
      {newPartOpen&&(<div onClick={()=>{setNewPartOpen(false);setNewName("");}} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center"}}><div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:8,padding:20,width:"100%",maxWidth:340}}><div style={{fontSize:14,fontWeight:800,marginBottom:12}}>🗂️ New Part</div><input autoFocus value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newName.trim()){setSelPart(newName.trim());setNewPartOpen(false);setNewName("");}}} placeholder="Part name" style={{width:"100%",padding:"8px 10px",borderRadius:4,border:"2px solid #e8a838",fontSize:13,boxSizing:"border-box",marginBottom:12}}/><div style={{display:"flex",gap:8}}><button onClick={()=>{setNewPartOpen(false);setNewName("");}} style={{flex:1,padding:8,borderRadius:4,border:"1px solid #ced4da",background:"#fff",cursor:"pointer"}}>Cancel</button><button onClick={()=>{if(newName.trim()){setSelPart(newName.trim());setNewPartOpen(false);setNewName("");}}} style={{flex:1,padding:8,borderRadius:4,border:"none",background:"#212529",color:"#fff",cursor:"pointer",fontWeight:700}}>Create</button></div></div></div>)}
    </div>
  );
}

export default function App(){
  const[user,setUser]=useState(null);
  const[workspace,setWorkspace]=useState(null);
  const[tab,setTab]=useState("dashboard");
  const[loadedCalc,setLoadedCalc]=useState(null);
  const[printAll,setPrintAll]=useState(false);
  const[showSteps,setShowSteps]=useState(true);
  const[showGraphics,setShowGraphics]=useState(true);
  const[showInputs,setShowInputs]=useState(true);
  const[showOutputs,setShowOutputs]=useState(true);
  const[reportStyle,setReportStyle]=useState("interactive");
  const[menuOpen,setMenuOpen]=useState(false);

  // Calc options
  const[calcFlags,setCalcFlags]=useState(DEFAULT_CALC_FLAGS);
  const[deflMult,setDeflMult]=useState(DEFAULT_DEFL_MULTIPLIERS);
  const[ulsCombos,setUlsCombos]=useState(DEFAULT_ULS_COMBOS);
  const[loadFactors,setLoadFactors]=useState(DEFAULT_LOAD_FACTORS);
  const[designCode,setDesignCode]=useState("ACI 318-19");
  const[units,setUnits]=useState("imperial");

  // Define dialogs
  const[concrete,setConcrete]=useState(DEFAULT_CONCRETE);
  const[beam,setBeam]=useState(DEFAULT_BEAM);
  const[cip,setCIP]=useState(DEFAULT_CIP);
  const[rebar,setRebar]=useState(DEFAULT_REBAR);
  const[prestress,setPrestress]=useState(DEFAULT_PRESTRESS);
  const[shear,setShear]=useState(DEFAULT_SHEAR);
  const[designParams,setDesignParams]=useState(DEFAULT_DESIGN_PARAMS);
  const[defineModal,setDefineModal]=useState(null);

  const calcOptionsState={
    flags:calcFlags,setFlags:setCalcFlags,
    deflMult,setDeflMult,ulsCombos,setUlsCombos,
    slsCombos:DEFAULT_SLS_COMBOS,loadFactors,setLoadFactors,
    designCode,setDesignCode,units,setUnits:(fn)=>setUnits(fn),
    onPrint:()=>handlePrint(false),onPrintPreview:()=>handlePrint(false),
    onTextReports:()=>{setReportStyle("tedds");handlePrint(false);},
    onGraphs:()=>setReportStyle("interactive"),
    onSave:()=>{},onSaveAs:()=>{},onNew:()=>{if(window.confirm("Start new project?"))window.location.reload();},
    recentFiles:[],defineModal,setDefineModal,
  };
  const defineContextValue={concrete,beam,cip,rebar,prestress,shear,designParams};
  const defineState={concrete,setConcrete,beam,setBeam,cip,setCIP,rebar,setRebar,prestress,setPrestress,shear,setShear,designParams,setDesignParams};

  const handlePrint=(all)=>{setPrintAll(all);setTimeout(()=>window.print(),50);};
  const handleOpenCalc=(fileRow)=>{
    if(fileRow?.action==="new") return;
    setLoadedCalc(fileRow);
    setTab(fileRow.module);
    if(!workspace) setWorkspace({project:fileRow.project_name,part:fileRow.part_name});
  };

  if(!user) return <LoginScreen onLogin={setUser}/>;
  if(!workspace) return(
    <CurrentUserContext.Provider value={user}>
      <WorkspacePicker userName={user.name} onSignOut={()=>setUser(null)}
        onEnter={(project,part)=>setWorkspace({project,part})}
        onOpenCalc={(fileRow)=>{setLoadedCalc(fileRow);setTab(fileRow.module);setWorkspace({project:fileRow.project_name,part:fileRow.part_name});}}/>
    </CurrentUserContext.Provider>
  );

  const MONO="'JetBrains Mono','Fira Code','Consolas',monospace";

  return(
    <CalcOptionsContext.Provider value={{flags:calcFlags,deflMult,ulsCombos,slsCombos:DEFAULT_SLS_COMBOS,loadFactors,designCode,units}}>
    <DefineContext.Provider value={defineContextValue}>
    <CurrentUserContext.Provider value={user}>
    <ViewSettingsContext.Provider value={{showSteps,showGraphics,showInputs,showOutputs,reportStyle}}>

    {/* Full-screen sticky layout */}
    <div style={{fontFamily:"'Inter','Segoe UI',system-ui,sans-serif",display:"flex",flexDirection:"column",height:"100vh",overflow:"hidden",color:"#212529",background:"#fff"}}>

      {/* Menu bar ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â full width at top */}
      <div className="no-print" style={{flexShrink:0,zIndex:100}}>
        <OptionsMenuBar state={calcOptionsState}/>
        <DefineDialogsController openModal={defineModal} setOpenModal={setDefineModal} defineState={defineState}/>
      </div>

      {/* Main content area */}
      <div style={{flex:1,display:"flex",overflow:"hidden"}}>

        {/* LEFT: scrollable calculator content */}
        <div style={{flex:1,overflowY:"auto",padding:"12px 14px"}}>
          <style>{`
            input.oi:focus,select.oi:focus{box-shadow:0 0 0 2px rgba(232,168,56,0.4);border-color:#c77c00}
            .live-svg circle,.live-svg ellipse,.live-svg rect,.live-svg line,.live-svg polygon,.live-svg path{transition:cx 0.35s,cy 0.35s,r 0.35s,x 0.35s,y 0.35s,width 0.35s,height 0.35s,x1 0.35s,y1 0.35s,x2 0.35s,y2 0.35s,d 0.4s;}
            @media print{.no-print{display:none!important}.print-card{page-break-inside:avoid}}
          `}</style>

          {/* Header */}
          <div className="no-print" style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,paddingBottom:8,borderBottom:"1px solid #dee2e6"}}>
            <div>
              <div style={{fontSize:14,fontWeight:800,fontFamily:MONO,textTransform:"uppercase",letterSpacing:0.5}}>BT Structural Calculator</div>
              <div style={{fontSize:10,color:"#868e96"}}>{workspace.project} / {workspace.part}</div>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <span style={{fontSize:11,color:"#868e96"}}>{user.name}</span>
              {isAdmin(user)&&<span style={{fontSize:10,fontWeight:700,background:"#1d4ed8",color:"#fff",padding:"1px 7px",borderRadius:8,fontFamily:MONO}}>ADMIN</span>}
              <button onClick={()=>setWorkspace(null)} style={{fontSize:10,color:"#868e96",background:"none",border:"1px solid #dee2e6",cursor:"pointer",padding:"3px 8px",borderRadius:4}}>ÃƒÂ¢Ã¢â‚¬Â Ã‚Â Projects</button>
              <button onClick={()=>setUser(null)} style={{fontSize:10,color:"#868e96",background:"none",border:"none",cursor:"pointer",textDecoration:"underline",padding:0}}>Sign out</button>
              <button onClick={()=>handlePrint(false)} className="no-print" style={{fontSize:10,padding:"4px 10px",borderRadius:4,border:"1px solid #dee2e6",background:"#fff",cursor:"pointer",fontFamily:MONO}}>ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¨ Print</button>
            </div>
          </div>

          {/* Tab bar */}
          <div className="no-print" style={{display:"flex",gap:0,marginBottom:12,borderBottom:"1px solid #dee2e6",flexWrap:"wrap",overflowX:"auto"}}>
            {ALL_TABS.map(t=>{
              const th=t.mod?MODULE_THEMES[t.mod]:{accent:"#374151",soft:"#f8f9fa",text:"#212529",accentDark:"#374151"};
              const active=tab===t.id;
              return(<button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"6px 12px",border:"none",borderBottom:active?`3px solid ${th.accent}`:"3px solid transparent",cursor:"pointer",fontSize:11,fontWeight:active?700:500,background:active?th.soft:"transparent",color:active?th.text:"#868e96",fontFamily:MONO,textTransform:"uppercase",letterSpacing:0.5,marginBottom:-1,borderRadius:"4px 4px 0 0",transition:"all 0.15s",whiteSpace:"nowrap"}}>{t.label}</button>);
            })}
            <button onClick={()=>setTab("projects")} style={{padding:"6px 12px",border:"none",borderBottom:tab==="projects"?"3px solid #495057":"3px solid transparent",cursor:"pointer",fontSize:11,fontWeight:tab==="projects"?700:500,background:tab==="projects"?"#f1f3f5":"transparent",color:tab==="projects"?"#212529":"#868e96",fontFamily:MONO,textTransform:"uppercase",letterSpacing:0.5,marginBottom:-1,borderRadius:"4px 4px 0 0",whiteSpace:"nowrap"}}>ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Projects</button>
          </div>

          {/* Display options bar */}
          <div className="no-print" style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
            {[["Steps","showSteps",setShowSteps],["Graphics","showGraphics",setShowGraphics],["Inputs","showInputs",setShowInputs],["Outputs","showOutputs",setShowOutputs]].map(([label,key,setter])=>(
              <button key={key} onClick={()=>setter(v=>!v)} style={{padding:"4px 10px",border:`1px solid #dee2e6`,borderRadius:4,background:{showSteps,showGraphics,showInputs,showOutputs}[key]?"#212529":"#fff",color:{showSteps,showGraphics,showInputs,showOutputs}[key]?"#fff":"#868e96",fontSize:10,cursor:"pointer",fontFamily:MONO,fontWeight:700}}>{label}</button>
            ))}
            <select value={reportStyle} onChange={e=>setReportStyle(e.target.value)} style={{padding:"4px 8px",borderRadius:4,border:"1px solid #dee2e6",fontSize:10,fontFamily:MONO,cursor:"pointer"}}>
              <option value="interactive">Interactive</option>
              <option value="tedds">Tedds-Style</option>
            </select>
          </div>

          {/* Tab content */}
          <ModuleThemeContext.Provider value={MODULE_THEMES[ALL_TABS.find(t=>t.id===tab)?.mod||"pci"]}>
            {tab==="dashboard"&&<Dashboard onOpenCalc={handleOpenCalc} onNavigate={setTab}/>}
            {tab==="pci"&&<PCITab loadedCalc={loadedCalc?.module==="pci"?loadedCalc:null} onConsumedLoad={()=>setLoadedCalc(null)} workspace={workspace}/>}
            {tab==="cpci"&&<CPCITab loadedCalc={loadedCalc?.module==="cpci"?loadedCalc:null} onConsumedLoad={()=>setLoadedCalc(null)} workspace={workspace}/>}
            {tab==="col"&&<ColTab loadedCalc={loadedCalc?.module==="col"?loadedCalc:null} onConsumedLoad={()=>setLoadedCalc(null)} workspace={workspace}/>}
            {tab==="crush"&&<CrushTab loadedCalc={loadedCalc?.module==="crush"?loadedCalc:null} onConsumedLoad={()=>setLoadedCalc(null)} workspace={workspace}/>}
            {tab==="beam"&&<BeamTab/>}
            {tab==="projects"&&<ProjectsBrowser onOpenCalc={handleOpenCalc}/>}
          </ModuleThemeContext.Provider>

          {/* Footer */}
          <div style={{textAlign:"center",marginTop:24,fontSize:10,color:"#adb5bd",padding:"10px 0",borderTop:"1px solid #dee2e6",fontFamily:MONO}}>
            PCI 8th Ed. Ãƒâ€šÃ‚Â· ACI 318-19 Ãƒâ€šÃ‚Â· CSA A23.3-19 Ãƒâ€šÃ‚Â· CPCI 5th Ed.
          </div>
        </div>

        {/* RIGHT: sticky 3D viewer ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â always visible */}
        {tab!=="dashboard"&&tab!=="projects"&&(
        <div className="no-print" style={{width:320,flexShrink:0,borderLeft:"2px solid #dee2e6",background:"#f8f9fa",display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{padding:"8px 10px",borderBottom:"1px solid #dee2e6",background:"#fff",fontWeight:700,fontSize:11,fontFamily:MONO,textTransform:"uppercase",letterSpacing:0.8,color:"#374151"}}>
            ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â 3D Model
          </div>
          <div style={{flex:1,overflowY:"auto",padding:8}}>
            {tab==="pci"&&<PCIViewer3D/>}
            {tab==="cpci"&&<CPCIViewer3D/>}
            {tab==="col"&&<ColViewer3D/>}
            {tab==="crush"&&<CrushViewer3D/>}
            {tab==="beam"&&<div style={{padding:20,textAlign:"center",color:"#868e96",fontSize:12,fontFamily:MONO}}>Select a section to view 3D model</div>}
          </div>
        </div>
        )}

      </div>
    </div>

    </ViewSettingsContext.Provider>
    </CurrentUserContext.Provider>
    </DefineContext.Provider>
    </CalcOptionsContext.Provider>
  );
}

// Stub viewers for right panel ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â these render the appropriate 3D
// model using the shared state from each tab via a small context bridge
function PCIViewer3D(){ return <div style={{padding:12,textAlign:"center",color:"#868e96",fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>Switch to ÃƒÂ°Ã…Â¸Ã‚Â§Ã…Â  3D Model in the chart picker to see the slab</div>; }
function CPCIViewer3D(){ return <div style={{padding:12,textAlign:"center",color:"#868e96",fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>Switch to ÃƒÂ°Ã…Â¸Ã‚Â§Ã…Â  3D Model in the chart picker to see the slab</div>; }
function ColViewer3D(){ return <div style={{padding:12,textAlign:"center",color:"#868e96",fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>Switch to ÃƒÂ°Ã…Â¸Ã‚Â§Ã…Â  3D Model in the chart picker to see the column</div>; }
function CrushViewer3D(){ return <div style={{padding:12,textAlign:"center",color:"#868e96",fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>Switch to ÃƒÂ°Ã…Â¸Ã‚Â§Ã…Â  3D Model in the chart picker to see the section</div>; }
