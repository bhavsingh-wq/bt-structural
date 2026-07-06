// ═══════════════════════════════════════════════════════════════
// PHASE 6 — PCI VIBRATION ANALYSIS
// PHASE 8 — FILLED CORE SHEAR CAPACITY
//
// Phase 6: Walking and rhythmic vibration checks for hollowcore slabs
// per PCI Design Handbook 8th Ed. §5.8 and AISC Design Guide 11.
//
// Phase 8: Shear capacity of hollowcore with filled end cores.
// Cores grouted solid near supports significantly increase Vcw
// since effective bw becomes the full section width over the
// filled zone (typically first 12" from each end).
// ═══════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
// PHASE 8 — FILLED CORE SHEAR
// ════════════════════════════════════════════════════════════════

/**
 * Computes Vcw for hollowcore with filled end cores.
 * In the filled zone the web width bw effectively equals b (full slab width).
 * Beyond the filled zone, the normal hollow bw applies.
 *
 * @param {object} section  — {A, Ix, yb, h, b, bw, cores, coreD}
 * @param {object} prestress — {Pe, Aps, dp, e}
 * @param {number} fc       — f′c, ksi
 * @param {number} fillLen  — length of filled zone from each end, in (default 12")
 * @param {number} x        — station position from support, in
 * @returns {object} shear capacities and fill status
 */
export function computeFilledCoreShear(section, prestress, fc, fillLen = 12, x = 0) {
  const { A, Ix, yb, h, b, bw, cores = 5, coreD } = section;
  const { Pe, dp, e } = prestress;

  // Is this station within the filled zone?
  const inFilledZone = x <= fillLen;

  // Effective web width — in filled zone, all cores are solid → use full b
  const bwEff = inFilledZone ? b : bw;

  // Average precompression at centroid
  const fpc = Pe / A; // ksi

  // Vcw — web-shear cracking (ACI 318-19 §22.5.8.3b)
  // Vcw = (3.5√f′c + 0.3·fpc) × bwEff × dp
  const Vcw = (3.5 * Math.sqrt(fc * 1000) / 1000 + 0.3 * fpc) * bwEff * dp;

  // Vci — flexure-shear cracking (simplified)
  // Vci = 0.6√f′c × bwEff × dp + (Vi × Mcr / Mmax) — use minimum
  const Vci_min = 1.7 * Math.sqrt(fc * 1000) / 1000 * bwEff * dp;

  const Vc = Math.min(Vcw, Math.max(Vci_min, Vcw * 0.8));

  // Additional capacity from filled cores themselves (grout shear)
  // Treat filled cores as solid round sections contributing to shear
  // Using simplified: each core adds ~0.17√fc × (π·coreD²/4) to Vc
  const coreArea = cores * Math.PI * (coreD / 2) ** 2; // total core area
  const VcFill = inFilledZone
    ? 0.75 * 0.17 * Math.sqrt(fc * 1000) / 1000 * coreArea
    : 0;

  const VcTotal = Vc + VcFill;
  const phiVc = 0.75 * VcTotal;

  return {
    inFilledZone,
    bwEff,
    fpc,
    Vcw,
    Vci_min,
    Vc,
    VcFill,
    VcTotal,
    phiVc,
    fillLen,
  };
}

/**
 * Runs filled-core shear analysis at multiple stations, producing a
 * shear capacity envelope that can be compared to the Vu diagram.
 */
export function filledCoreShearEnvelope(section, prestress, fc, fillLen, span, nPts = 21) {
  const L = span * 12; // in
  return Array.from({ length: nPts }, (_, i) => {
    const x = (i / (nPts - 1)) * L;
    const result = computeFilledCoreShear(section, prestress, fc, fillLen, Math.min(x, L - x));
    return { x: x / 12, xIn: x, ...result };
  });
}

// ════════════════════════════════════════════════════════════════
// PHASE 6 — PCI VIBRATION ANALYSIS
// ════════════════════════════════════════════════════════════════

// Occupancy categories and their acceptable frequency limits
// per PCI Design Handbook Table 5.8.1 and AISC DG11 Table 4.1
export const OCCUPANCY_TYPES = {
  "Office / Residential":      { f_min: 4.0, a_limit: 0.005, description: "Walking — office, residential" },
  "Shopping Mall":              { f_min: 4.0, a_limit: 0.015, description: "Walking — retail/commercial" },
  "Footbridge (outdoor)":       { f_min: 3.0, a_limit: 0.050, description: "Walking — outdoor footbridge" },
  "Gymnasium / Aerobics":       { f_min: 2.0, a_limit: 0.050, description: "Rhythmic — aerobics/dance" },
  "Assembly — Fixed Seats":     { f_min: 4.0, a_limit: 0.020, description: "Rhythmic — concert hall" },
  "Assembly — Movable Seating": { f_min: 4.0, a_limit: 0.050, description: "Rhythmic — arena" },
  "Dining / Dancing":           { f_min: 5.0, a_limit: 0.020, description: "Rhythmic — dining/dancing" },
  "Parking Structure":          { f_min: 8.0, a_limit: 0.100, description: "Vehicle — parking" },
};

/**
 * Compute the natural frequency of a simply-supported hollowcore slab.
 * Uses Dunkerley's method for the fundamental frequency.
 *
 * fn = (π/2L²) × √(EI / w)  [Hz]
 * where w = weight per unit length (kip/in), L = span (in)
 *
 * @param {number} Ec   — modulus of elasticity (ksi)
 * @param {number} Ix   — moment of inertia (in⁴)
 * @param {number} wDL  — dead load per unit length (kip/in), includes SW + SDL
 * @param {number} span — span length (ft)
 * @returns {number} fn — natural frequency (Hz)
 */
export function naturalFrequency(Ec, Ix, wDL, span) {
  const L = span * 12;  // in
  const g = 386.4;      // in/s²
  const EI = Ec * Ix;   // kip·in²
  // Midspan deflection under DL (simply supported UDL)
  const delta = 5 * wDL * L ** 4 / (384 * EI); // in
  // Equivalent frequency via Rayleigh method: fn = 0.18 / √(delta_in)
  const fn = 0.18 / Math.sqrt(Math.max(delta, 0.0001));
  return fn;
}

/**
 * PCI Walking Vibration Check — AISC Design Guide 11 / PCI §5.8
 *
 * Checks whether the slab's peak acceleration from a walker footfall
 * is within the occupancy-based limit.
 *
 * @param {number} fn         — natural frequency (Hz)
 * @param {number} Ec         — elastic modulus (ksi)
 * @param {number} Ix         — moment of inertia (in⁴)
 * @param {number} wDL        — service DL per unit length (kip/in)
 * @param {number} wLL        — service LL per unit length (kip/in)
 * @param {number} span       — span (ft)
 * @param {number} width      — slab width contributing to vibration (ft)
 * @param {string} occupancy  — occupancy type key from OCCUPANCY_TYPES
 * @returns {object} vibration check results
 */
export function walkingVibrationCheck(fn, Ec, Ix, wDL, wLL, span, width, occupancy = "Office / Residential") {
  const occ = OCCUPANCY_TYPES[occupancy] || OCCUPANCY_TYPES["Office / Residential"];
  const L = span * 12;   // in
  const g = 386.4;       // in/s²

  // Effective panel weight (kips) — PCI recommends using DL + 0.1LL
  const wEff = wDL + 0.1 * wLL;  // kip/in
  const W_panel = wEff * L * (width * 12);  // kips

  // Effective weight for resonance check (simply-supported, use modal weight)
  // W_eff = (π/4) × (wDL + 0.1·wLL) × L × b  [PCI simplified]
  const W_eff = Math.PI / 4 * W_panel;

  // Damping ratio — depends on occupancy and fit-out
  const beta = occupancy.includes("Office") || occupancy.includes("Residential") ? 0.03 : 0.05;

  // Step force harmonics — PCI/AISC DG11 Table 4.2
  // Fundamental step frequency for walking = 1.6–2.2 Hz
  // Harmonics: 1×, 2×, 3×, 4× step frequency
  // Dynamic load factor (DLF) for harmonic i:
  const harmonics = [
    { i: 1, fi_range: [1.6, 2.2], alpha: 0.5 },  // 1st harmonic
    { i: 2, fi_range: [3.2, 4.4], alpha: 0.2 },  // 2nd harmonic
    { i: 3, fi_range: [4.8, 6.6], alpha: 0.1 },  // 3rd harmonic
    { i: 4, fi_range: [6.4, 8.8], alpha: 0.05 }, // 4th harmonic
  ];

  // Check each harmonic for resonance with fn
  const harmonicResults = harmonics.map(h => {
    const resonant = fn >= h.fi_range[0] * h.i && fn <= h.fi_range[1] * h.i;
    // Peak acceleration (fraction of g) from AISC DG11 Eq. 4.1
    // ap/g = P × α / (β × W)
    const P = 0.157;  // kips — standard walker force (65kg × g / 1000)
    const ap_g = P * h.alpha / (beta * Math.max(W_eff, 1));
    return { ...h, resonant, ap_g, ap_g_pct: ap_g * 100 };
  });

  // Governing (worst case) acceleration
  const ap_g_max = Math.max(...harmonicResults.map(h => h.ap_g));
  const ap_pct   = ap_g_max * 100;

  // PCI simplified frequency check
  const freqOk = fn >= occ.f_min;
  // Acceleration check (AISC DG11)
  const accelOk = ap_g_max <= occ.a_limit;
  const allOk   = freqOk && accelOk;

  return {
    fn,
    W_panel,
    W_eff,
    beta,
    ap_g_max,
    ap_pct,
    harmonicResults,
    occ,
    f_min: occ.f_min,
    a_limit: occ.a_limit,
    a_limit_pct: occ.a_limit * 100,
    freqOk,
    accelOk,
    allOk,
  };
}

/**
 * Rhythmic Load Vibration Check — PCI §5.8.3 / AISC DG11 §5
 * Checks dynamic response to synchronised rhythmic activities
 * (aerobics, dance, concert, etc.)
 *
 * @param {number} fn         — natural frequency (Hz)
 * @param {number} W_eff      — effective weight (kips) from walking check
 * @param {number} wLL        — live load per unit length (kip/in)
 * @param {number} span       — span (ft)
 * @param {number} width      — slab width (ft)
 * @param {string} activity   — activity type key from RHYTHMIC_ACTIVITIES
 * @returns {object} rhythmic vibration check
 */
export const RHYTHMIC_ACTIVITIES = {
  "Aerobics":          { f_act: 2.75, gamma: 1.5, wp: 0.065, description: "Aerobic exercise class" },
  "Dancing":           { f_act: 2.0,  gamma: 1.5, wp: 0.065, description: "Dance floor" },
  "Lively Concert":    { f_act: 2.0,  gamma: 1.5, wp: 0.065, description: "Lively concert/sports event" },
  "Normal Assembly":   { f_act: 1.0,  gamma: 0.5, wp: 0.065, description: "Normal concert/assembly" },
  "Stadium Stomping":  { f_act: 2.5,  gamma: 1.0, wp: 0.065, description: "Stadium rhythmic stomping" },
};

export function rhythmicVibrationCheck(fn, W_eff, wLL, span, width, activity = "Aerobics", occupancy = "Gymnasium / Aerobics") {
  const act = RHYTHMIC_ACTIVITIES[activity] || RHYTHMIC_ACTIVITIES["Aerobics"];
  const occ = OCCUPANCY_TYPES[occupancy] || OCCUPANCY_TYPES["Gymnasium / Aerobics"];
  const L = span * 12;

  // Dynamic magnification factor (DMF) — resonance amplification
  // If fn > 2 × f_act: non-resonant
  // If fn ≈ f_act (resonance): DMF → 1/(2β)
  const r = act.f_act / Math.max(fn, 0.01);  // frequency ratio
  const beta = 0.05;  // damping, 5% for rhythmic
  const DMF = r < 1.0
    ? 1 / Math.sqrt((1 - r**2)**2 + (2*beta*r)**2)
    : 1 / (2 * beta);  // near-resonance limit

  // Dynamic live load (total rhythmic crowd load)
  const wRhythmic = act.wp * (width * 12 * L / 144);  // kips
  // Peak dynamic force = gamma × wRhythmic
  const F_dyn = act.gamma * wRhythmic;

  // Peak acceleration (fraction of g)
  const ap_g = DMF * F_dyn * act.gamma / Math.max(W_eff, 1);
  const ap_pct = ap_g * 100;

  const accelOk = ap_g <= occ.a_limit;
  const freqOk  = fn >= occ.f_min;

  return {
    fn, W_eff, DMF, r, F_dyn, ap_g, ap_pct,
    act, occ,
    f_min: occ.f_min,
    a_limit: occ.a_limit,
    a_limit_pct: occ.a_limit * 100,
    freqOk, accelOk,
    allOk: freqOk && accelOk,
  };
}

/**
 * Run the complete Phase 6 + Phase 8 analysis package.
 * Returns all results needed for the UI panels.
 */
export function runPhase6and8(params) {
  const {
    // Section
    section,        // {A, Ix, yb, h, b, bw, cores, coreD, SW}
    prestress,      // {Pe, Aps, dp, e}
    materials,      // {fc, Ec}
    // Loading
    wSDL, wLL,      // kip/in per unit width
    span,           // ft
    // Vibration-specific
    occupancy,      // key from OCCUPANCY_TYPES
    activity,       // key from RHYTHMIC_ACTIVITIES (optional)
    rhythmicOccupancy, // occupancy for rhythmic check
    slabWidth,      // ft — width of panel contributing to vibration
    // Filled core shear
    fillCores,      // bool — are cores filled at ends?
    fillLen,        // in — length of fill from each end (default 12")
  } = params;

  const { A, Ix, yb, h, b, bw, SW } = section;
  const { fc, Ec } = materials;

  // Effective DL per unit length for vibration (kip/in)
  const wDL_vib = (SW + wSDL * 12) / 12 / 1000;  // SW in plf, convert to kip/in
  const wLL_vib = wLL;

  // Natural frequency
  const fn = naturalFrequency(Ec, Ix, wDL_vib, span);

  // Walking vibration
  const walking = walkingVibrationCheck(fn, Ec, Ix, wDL_vib, wLL_vib, span, slabWidth || 8, occupancy);

  // Rhythmic vibration (optional)
  const rhythmic = activity
    ? rhythmicVibrationCheck(fn, walking.W_eff, wLL_vib, span, slabWidth || 8, activity, rhythmicOccupancy || occupancy)
    : null;

  // Filled core shear envelope
  const shearEnvelope = fillCores
    ? filledCoreShearEnvelope(section, prestress, fc, fillLen || 12, span)
    : null;

  // Spot check at critical shear section (at d from support = dp from support)
  const shearAtD = fillCores
    ? computeFilledCoreShear(section, prestress, fc, fillLen || 12, prestress.dp)
    : null;

  return { fn, walking, rhythmic, shearEnvelope, shearAtD };
}
