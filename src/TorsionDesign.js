// ═══════════════════════════════════════════════════════════════
// PHASE 10b — TORSION DESIGN
//
// Full torsion design for prestressed and reinforced concrete beams
// per ACI 318-19 §22.7 and PCI Design Handbook 8th Ed. §5.5.
//
// Matches ConCise Beam's "Define → Torsion Parameters" dialog,
// and the S5 shear calculation option (Zia/Hsu method for torsion).
//
// Workflow:
//   1. Compute Tu (factored torsional moment from eccentric loads)
//   2. Check if torsion can be neglected (Tu < Tth = ΦTcr/4)
//   3. Compute Tcr (cracking torque) using precompression fpc
//   4. Compute Tn (nominal torsional strength) from closed stirrups
//   5. Check combined shear + torsion using interaction diagram
//   6. Design torsion stirrups and longitudinal steel
//
// For hollowcore slabs, torsion most commonly arises from:
//   - Asymmetric loading (edge beam carries tributary load from one side)
//   - Cantilever ledger loads
//   - Diaphragm forces in lateral load analysis
// ═══════════════════════════════════════════════════════════════

/**
 * Compute the equivalent thin-walled tube parameters for torsion design.
 * ACI 318-19 §22.7.6.1 uses the "space truss analogy" with equivalent
 * thin-walled closed cross-section.
 *
 * @param {object} section — {A (in²), ph (in perimeter), Aoh (in²), poh}
 *   A   = total gross area
 *   ph  = perimeter of outermost closed stirrup
 *   Aoh = area enclosed by outermost closed stirrup
 *   poh = perimeter of outermost closed stirrup
 * @returns {object} thin-walled tube parameters
 */
export function thinWalledTube(section) {
  const { A, ph, Aoh, poh } = section;

  // Wall thickness of equivalent thin-walled tube (ACI R22.7.6.1)
  // t_e = A_g / p_h  (for solid sections — reduces for hollow)
  const te = A / ph;

  // Area enclosed by centreline of wall = Aoh - poh*te/4 (for hollow)
  // Simplified: use Aoh directly (conservative, matches most calc practice)
  const Ao = 0.85 * Aoh;  // ACI 318-19 §22.7.6.1(a)

  return { te, Ao, Aoh, poh, ph };
}

/**
 * Main torsion design function.
 *
 * @param {object} params
 *   Tu      — factored torsional moment (kip-in)
 *   Vu      — factored shear at same section (kips)
 *   fc      — concrete strength (ksi)
 *   fpc     — average precompression = Pe/Ag (ksi), 0 for non-prestressed
 *   Aps     — prestressing strand area (in²)
 *   fpu     — ultimate strand strength (ksi)
 *   Aoh     — area enclosed by outermost closed stirrup (in²)
 *   poh     — perimeter of outermost closed stirrup (in)
 *   Ag      — gross area (in²)
 *   ph      — perimeter of outermost stirrup (in)
 *   bw      — web width (in)
 *   dp      — effective depth to strand (in)
 *   Avs     — area of one leg of shear stirrup (in²/in, i.e. Av/s)
 *   fy_t    — yield strength of torsion stirrups (ksi)
 *   theta   — angle of compression diagonals (rad), default π/4 = 45°
 *   phi     — strength reduction factor (default 0.75)
 *
 * @returns {object} complete torsion design results
 */
export function torsionDesign(params) {
  const {
    Tu, Vu, fc, fpc = 0,
    Aps = 0, fpu = 270,
    Aoh, poh, Ag, ph, bw, dp,
    Avs = 0,
    fy_t = 60,
    theta = Math.PI / 4,
    phi = 0.75,
    section_type = "solid",  // "solid" | "hollowcore" | "box"
    cores = 0, coreD = 0,    // for hollowcore void reduction
  } = params;

  // ── Effective section area for torsion (ACI §22.7.4.2) ───────
  // For hollowcore: deduct core void areas from Acp
  let Acp = Ag;  // area enclosed by perimeter of section
  let pcp = ph;  // perimeter of section

  if (section_type === "hollowcore" && cores > 0 && coreD > 0) {
    // Deduct circular void areas (ACI §22.7.4.2 for hollow sections)
    const voidArea = cores * Math.PI * (coreD / 2) ** 2;
    Acp = Ag - voidArea;  // net concrete area (not void area)
    // Perimeter stays the same for outer shape
  }

  // ── Torsional cracking moment ──────────────────────────────
  // ACI 318-19 §22.7.5.1 Eq. 22.7.5.1a (with precompression)
  // Tcr = (λ√f′c × Acp²/pcp) × √(1 + fpc/(4λ√f′c))
  const lambda = 1.0;  // normal weight concrete
  const sqrtFc = Math.sqrt(fc * 1000) / 1000;  // ksi
  const Tcr_basic = lambda * sqrtFc * (Acp ** 2) / pcp;
  const fpc_ratio = fpc > 0 ? fpc / (4 * lambda * sqrtFc) : 0;
  const Tcr = Tcr_basic * Math.sqrt(1 + fpc_ratio);  // kip-in

  // ── Threshold torque (torsion can be neglected if Tu < Tth) ──
  // ACI 318-19 §22.7.4.1: Tth = Φ × Tcr/4
  const Tth = phi * Tcr / 4;  // kip-in
  const neglect = Math.abs(Tu) <= Tth;

  // ── Equivalent thin-walled tube ───────────────────────────
  const { Ao } = thinWalledTube({ A: Acp, ph, Aoh, poh });

  // ── Required torsion stirrups (At/s) ──────────────────────
  // ACI 318-19 §22.7.6.1: Tn = 2×Ao×At×fy_t×(cot θ)/s
  // → At/s = Tu / (Φ × 2×Ao×fy_t×cot θ)
  const cotTheta = 1 / Math.tan(theta);
  const AtS_req = neglect ? 0
    : Math.abs(Tu) / (phi * 2 * Ao * fy_t * cotTheta);  // in²/in

  // ── Minimum torsion reinforcement ─────────────────────────
  // ACI 318-19 §9.6.4.2: minimum At/s
  const AtS_min = Math.max(
    0.75 * Math.sqrt(fc * 1000) / 1000 * bw / (fy_t),
    50 * bw / (fy_t * 1000)
  );  // in²/in

  const AtS_design = neglect ? 0 : Math.max(AtS_req, AtS_min);

  // ── Required longitudinal steel for torsion (Al) ──────────
  // ACI 318-19 §22.7.6.1: Al = At/s × poh × (cot θ)²
  const Al_req = neglect ? 0 : AtS_design * poh * cotTheta ** 2;  // in²

  // Minimum Al (ACI 318-19 §9.6.4.3)
  const Al_min = Math.max(
    (5 * Math.sqrt(fc * 1000) / 1000 * Acp / fy_t) - AtS_design * poh,
    (5 * Math.sqrt(fc * 1000) / 1000 * Acp / fy_t) - (AtS_min * poh)
  );

  const Al_design = neglect ? 0 : Math.max(Al_req, Al_min);

  // ── Torsional strength provided (if stirrups given) ────────
  const Tn_prov = Avs > 0
    ? phi * 2 * Ao * Avs * fy_t * cotTheta
    : 0;

  // ── Combined shear + torsion interaction ──────────────────
  // ACI 318-19 §22.7.7.1 (solid sections):
  // (Vu/(bw×dp))² + (Tu×ph/(1.7×Aoh²))² ≤ (Vc/(bw×dp) + 8√f′c)²
  const Vc = (2 * sqrtFc) * bw * dp;  // kips, simplified ACI §22.5.5
  const LHS_shear = (Vu / (bw * dp)) ** 2;
  const LHS_tors  = (Math.abs(Tu) * poh / (1.7 * Aoh ** 2)) ** 2;
  const RHS       = (Vc / (bw * dp) + 8 * sqrtFc) ** 2;
  const LHS_combined = Math.sqrt(LHS_shear + LHS_tors);
  const RHS_limit    = Vc / (bw * dp) + 8 * sqrtFc;
  const combinedOk   = LHS_combined <= RHS_limit;

  // ── Concrete contribution to torsional strength ───────────
  // For prestressed members with fpc > 0, concrete carries some torsion
  // ACI Commentary: Tc_tors is small; most torsion carried by stirrups
  const Tc_tors = neglect ? Tcr : 0;  // below threshold = concrete carries all

  // ── Checks ─────────────────────────────────────────────────
  const torsionOk = neglect || (Tn_prov >= Math.abs(Tu));

  return {
    // Section parameters
    Acp, pcp: ph, Aoh, poh, Ao, Ag,
    // Torsional cracking
    Tcr, Tth, fpc_ratio,
    // Can torsion be neglected?
    neglect,
    neglectReason: neglect
      ? `Tu (${(Math.abs(Tu)/12).toFixed(2)} k-ft) ≤ ΦTcr/4 (${(Tth/12).toFixed(2)} k-ft) — torsion NEGLECTED per ACI §22.7.4.1`
      : `Tu (${(Math.abs(Tu)/12).toFixed(2)} k-ft) > ΦTcr/4 (${(Tth/12).toFixed(2)} k-ft) — torsion MUST be designed for`,
    // Required reinforcement
    AtS_req, AtS_min, AtS_design,
    Al_req, Al_min, Al_design,
    // Provided strength
    Tn_prov,
    // Combined interaction
    LHS_combined, RHS_limit, combinedOk,
    Vc, Tc_tors,
    // Status
    torsionOk,
    Tu_kft: Math.abs(Tu) / 12,  // kip-ft for display
    Tth_kft: Tth / 12,
    Tcr_kft: Tcr / 12,
    checks: [
      { label:"Threshold check (neglect?)", ok:neglect,
        val:(Math.abs(Tu)/12).toFixed(3), limit:(Tth/12).toFixed(3), unit:"k-ft",
        note: neglect ? "Torsion neglected — no design needed" : "Torsion must be designed for" },
      { label:"Combined V+T interaction",   ok:combinedOk,
        val:LHS_combined.toFixed(4), limit:RHS_limit.toFixed(4), unit:"ksi",
        note:"ACI 318-19 §22.7.7.1" },
      { label:"Torsional strength ΦTn ≥ Tu", ok:torsionOk,
        val:(Math.abs(Tu)/12).toFixed(3), limit:(Tn_prov/12).toFixed(3), unit:"k-ft",
        note: neglect ? "Not required" : `Need At/s = ${AtS_design.toFixed(5)} in²/in` },
    ],
  };
}

/**
 * Compute equivalent torsional moment from eccentric loading.
 * Useful when the user specifies an eccentric load on a beam or
 * when a slab edge beam carries tributary load only on one side.
 *
 * @param {number} P_eccentric — eccentric concentrated load (kips)
 * @param {number} e_load      — eccentricity from shear center (in)
 * @param {number} w_eccentric — eccentric UDL (kip/in)
 * @param {number} e_udl       — UDL eccentricity from shear center (in)
 * @param {number} span        — span (ft)
 * @returns {number} Tu_max    — maximum factored torsional moment (kip-in)
 */
export function eccentricLoadTorsion(P_eccentric, e_load, w_eccentric, e_udl, span) {
  const L = span * 12;  // in
  // Torsion from eccentric UDL (maximum at supports for simple span)
  const Tu_udl = w_eccentric * e_udl * L / 2;
  // Torsion from eccentric point load (maximum at load point)
  const Tu_point = P_eccentric * e_load;
  return Math.max(Tu_udl, Tu_point);
}

/**
 * Run the full Phase 10b torsion analysis package.
 * Integrates with PCITab's existing section properties.
 */
export function runTorsionDesign(params) {
  const {
    s,          // section object from PCI_SLABS or BEAM_SECTIONS
    Pe, Aps, dp,
    fc, Ec,
    Tu_kipin,   // factored torsional moment (kip-in)
    Vu,         // factored shear (kips)
    // Torsion reinforcement
    At_legs = 2, At_size = 0.11, s_stirrup = 6,  // #3 @ 6" = 0.11 in²/leg
    fy_t = 60,
    phi = 0.75,
    theta_deg = 45,
  } = params;

  // Section geometry for torsion (perimeter of outermost stirrup)
  // For hollowcore: use full outer rectangle, accounting for cover ~1.5"
  const cover = 1.5;  // in
  const bw_inner = s.b - 2 * cover;
  const h_inner  = s.h - 2 * cover;
  const Aoh = bw_inner * h_inner;  // area enclosed by stirrup
  const poh = 2 * (bw_inner + h_inner);  // perimeter of stirrup
  const ph  = 2 * (s.b + s.h);  // outer perimeter

  const fpc = Aps > 0 ? Pe / s.A : 0;  // average precompression

  // Av/s provided
  const Avs = (At_legs * At_size) / s_stirrup;  // in²/in

  return torsionDesign({
    Tu: Tu_kipin, Vu, fc, fpc,
    Aps, fpu: 270,
    Aoh, poh, Ag: s.A, ph, bw: s.bw, dp,
    Avs, fy_t,
    theta: theta_deg * Math.PI / 180,
    phi,
    section_type: s.cores ? "hollowcore" : "solid",
    cores: s.cores || 0,
    coreD: s.coreD || 0,
  });
}
