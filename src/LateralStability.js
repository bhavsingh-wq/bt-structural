// ═══════════════════════════════════════════════════════════════
// PHASE 7 — LATERAL STABILITY DURING LIFTING & TRANSPORT
//
// Checks roll-over and lateral cracking stability of prestressed
// beams during lifting and transport per PCI Design Handbook
// 8th Edition §8.3 (Precast/Prestressed Concrete).
//
// The method follows PCI's lateral stability analysis:
//  1. Compute Iy (weak-axis moment of inertia)
//  2. Compute beam CG height from lift point (yr)
//  3. Compute tilt angle at each limit state
//  4. Check FS against cracking and FS against failure
//
// Key references:
//   PCI Design Handbook 8th Ed., Section 8.3
//   Mast, R.F. (1989). "Lateral Stability of Long Prestressed Concrete Beams"
//   PCI Journal, Jan-Feb 1989.
// ═══════════════════════════════════════════════════════════════

/**
 * Compute weak-axis (Iy) for common precast section types.
 * All dimensions in inches.
 *
 * @param {object} s — section definition (from BEAM_SECTIONS or PCI_SLABS)
 * @returns {number} Iy — in⁴
 */
export function computeIy(s) {
  if (!s) return 0;

  if (s.type === "it") {
    // IT beam: three horizontal rectangles stacked
    // For Iy each rectangle: bh³/12 where b is the long horizontal dim
    const webH = s.h - s.tft - s.tfb;
    return (
      (s.tft * s.bft ** 3) / 12 +   // top flange
      (webH  * s.bw  ** 3) / 12 +   // web
      (s.tfb * s.bfb ** 3) / 12     // bottom flange
    );
  }

  if (s.type === "ledger") {
    const webH = s.h - s.tfl - s.tfb;
    return (
      (s.tfl * s.bfl ** 3) / 12 +
      (webH  * s.bw  ** 3) / 12 +
      (s.tfb * s.bfb ** 3) / 12
    );
  }

  if (s.type === "dt") {
    // Double tee: top flange + two stems
    const stemH = s.h - s.tf;
    const bwAvg = (s.bw + s.bwb) / 2;
    return (
      (s.tf * s.bf ** 3) / 12 +                           // top flange
      2 * (stemH * bwAvg ** 3) / 12                       // two stems (approx)
    );
  }

  if (s.type === "box") {
    // Box beam: outer rectangle minus two voids
    const voidW = (s.b - 2 * s.tw) / 2;
    const voidH = s.h - s.tf_top - s.tf_bot;
    const Iy_outer = (s.h * s.b ** 3) / 12;
    const Iy_voids = 2 * (voidH * voidW ** 3) / 12;
    return Iy_outer - Iy_voids;
  }

  // Hollowcore: treat as solid rectangle minus circular cores
  if (s.cores && s.coreD && s.b && s.h) {
    const Iy_solid = s.h * s.b ** 3 / 12;
    // Each core contributes π*d⁴/64 for Iy, offset from centroid
    const coreSpacing = s.b / (s.cores + 1);
    let Iy_cores = 0;
    for (let i = 1; i <= s.cores; i++) {
      const xc = i * coreSpacing - s.b / 2; // offset from section centroid
      const Ic_own = Math.PI * s.coreD ** 4 / 64;
      const A_core = Math.PI * (s.coreD / 2) ** 2;
      Iy_cores += Ic_own + A_core * xc ** 2;
    }
    return Iy_solid - Iy_cores;
  }

  // Rectangular fallback
  if (s.b && s.h) return s.h * s.b ** 3 / 12;
  return 1;
}

/**
 * Compute the CG height from the roll axis (lift point or truck support).
 * This is the distance from the centroid of the beam to where it's supported.
 *
 * For lifting: yr = lift hardware height above top + (h - yb)
 *   = distance from CG to the lifting loop/anchor at top
 *
 * @param {number} yb     — centroid height from bottom (in)
 * @param {number} h      — total section depth (in)
 * @param {number} yLift  — height of lift point above top of beam (in), default 0
 * @returns {number} yr   — distance from CG to roll axis (in)
 */
export function cgToRollAxis(yb, h, yLift = 0) {
  return (h - yb) + yLift;
}

/**
 * PCI §8.3 Lateral Stability Analysis — Mast Method
 *
 * Computes tilt angles, factors of safety, and lateral stress checks
 * for a simply-supported beam lifted at two symmetric points.
 *
 * @param {object} params
 *   section    — {A, Ix, Iy, yb, h, b, bw, SW}
 *   prestress  — {Pe, e, Aps, dp}
 *   materials  — {Ec, Eci, fc, fci}
 *   geometry   — {span, liftPoint (ft from end, 0 = at end), yLift (in above top)}
 *   sweep      — initial lateral sweep (in) — default = span*12/10000
 * @returns {object} stability results
 */
export function lateralStabilityCheck(params) {
  const { section, prestress, materials, geometry, sweep } = params;
  const { A, Ix, Iy, yb, h, b } = section;
  const { Pe, e } = prestress;
  const { Ec, Eci, fc, fci } = materials;
  const { span, liftPoint, yLift = 0 } = geometry;

  const L = span * 12;                    // in — full beam length
  const a = (liftPoint ?? 0.1 * span) * 12; // in — lift point from end

  // ── Height of CG above roll axis ──────────────────────────
  const yr = cgToRollAxis(yb, h, yLift);  // in

  // ── Initial lateral eccentricity ───────────────────────────
  // PCI recommends ei = z_i (initial sweep) + θ_i × yr
  // Sweep imperfection: PCI §8.3.1 = L/10000 (default) or user-specified
  const z_i = sweep ?? L / 10000;         // in — initial lateral sweep at midspan

  // ── Lateral stiffness ──────────────────────────────────────
  // For two symmetric lift points at 'a' from each end:
  // EIy deflection at midspan from unit lateral load
  // Using beam formula for two-point support with overhang:
  const EIy = Eci * Iy; // kip·in² (use Eci at lifting stage)
  // Lateral deflection coefficient at midspan for symmetric pickup:
  // δ_lat/P = L³/(48·EIy) × [1 - 4(a/L)² + 4(a/L)³] ... simplified
  const alpha_a = (a <= L / 2)
    ? L ** 3 / (48 * EIy) * (1 - 4 * (a/L) ** 2 * (3 - 4 * (a/L)))
    : L ** 3 / (48 * EIy);
  const Ky = 1 / alpha_a; // kip/in — lateral spring stiffness

  // ── Roll stiffness ─────────────────────────────────────────
  // Kθ = Ky × yr (kip·in/rad)
  const Ktheta = Ky * yr;

  // ── Self-weight moment and lateral eccentricity ────────────
  // Uniform self-weight w (kip/in)
  const wSW = section.SW / 12 / 1000;       // kip/in (SW in plf of total slab width)

  // Maximum moment about strong axis (for lift configuration)
  const M_sw = a < L / 4
    ? wSW * (L - 2*a) ** 2 / 8            // midspan moment with overhang
    : wSW * L ** 2 / 8;                   // simple span

  // Effective initial eccentricity including sweep-induced tilt
  // From PCI Eq. 8.3-1:
  // θ_i = z_i / yr  (initial tilt from sweep)
  const theta_i = z_i / yr;

  // ── Tilt angle at equilibrium ──────────────────────────────
  // Moment equation: Kθ × θ = W × z_total
  // z_total = z_i + yr × sin(θ) ≈ z_i + yr × θ (small angle)
  // → θ_eq = W × z_i / (Kθ - W × yr)
  const W = wSW * L;  // total beam weight (kips)
  const denom = Ktheta - W * yr;

  let theta_eq, stable;
  if (denom <= 0) {
    // Unconditionally unstable (roll stiffness insufficient)
    theta_eq = Infinity;
    stable = false;
  } else {
    theta_eq = W * z_i / denom;  // radians
    stable = true;
  }

  // ── Lateral bending moment at midspan ─────────────────────
  // From tilt, the eccentric weight creates a lateral moment:
  // M_lat = W × (z_i + yr × θ_eq) / 2
  const z_total = z_i + yr * Math.min(theta_eq, 0.5);
  const M_lat = W * z_total * L / 8;  // kip·in (lateral midspan moment)

  // ── Lateral cracking moment ────────────────────────────────
  // Mcr_lat = fr × Iy / (b/2)  where fr = modulus of rupture
  const fr = 7.5 * Math.sqrt(fci * 1000) / 1000;  // ksi, at lifting stage
  const Mcr_lat = fr * Iy / (b / 2);               // kip·in

  // ── Factor of safety against lateral cracking ─────────────
  // FS_crack = Mcr_lat / M_lat_eff (where M_lat_eff includes tilt amplification)
  const M_lat_eff = Math.max(M_lat, 0.001);
  const FS_crack = Mcr_lat / M_lat_eff;

  // ── Factor of safety against failure ──────────────────────
  // FS_failure = θ_max / θ_eq  where θ_max = tilt angle at max lateral moment
  // PCI §8.3: θ_max typically 0.4 rad for lifting (beam hits lift cable)
  const theta_max = 0.4;  // rad
  const FS_failure = stable ? theta_max / Math.max(theta_eq, 0.0001) : 0;

  // ── Lateral stress at top flange ───────────────────────────
  // σ_lat_top = M_lat × (b/2) / Iy  (tension at one edge)
  const sigma_lat = M_lat_eff * (b / 2) / Iy;

  // ── Combined stress at top fiber (strong + lateral bending) ─
  // Strong axis: Po/A - Po*e/St (at transfer, top tension possible)
  const Pe_lift = Pe;
  const St = Ix / (h - yb);
  const sigma_top_strong = Pe_lift / A - Pe_lift * e / St;
  const sigma_top_combined = sigma_top_strong + sigma_lat;  // worst case

  // ── PCI recommended factors of safety ─────────────────────
  const FS_crack_req  = 1.0;   // PCI §8.3.2 (with adequate sweep)
  const FS_failure_req = 1.5;  // PCI §8.3.2

  const fsOk_crack   = FS_crack   >= FS_crack_req;
  const fsOk_failure = FS_failure >= FS_failure_req;
  const latCrackOk   = sigma_lat  <= fr;
  const allOk = fsOk_crack && fsOk_failure && stable;

  return {
    // Geometry
    L, a, yr, z_i, theta_i,
    // Stiffness
    EIy, Ky, Ktheta,
    // Weight/moment
    W, wSW, M_sw, M_lat, M_lat_eff,
    // Cracking
    fr, Mcr_lat,
    // Stability
    theta_eq: Math.min(theta_eq, 99), theta_max, stable,
    FS_crack, FS_failure,
    FS_crack_req, FS_failure_req,
    sigma_lat, sigma_top_strong, sigma_top_combined,
    // Status
    fsOk_crack, fsOk_failure, latCrackOk, allOk,
    checks: [
      { label:"FS against lateral cracking",  val:FS_crack,        limit:FS_crack_req,   ok:fsOk_crack,   unit:"", higherBetter:true },
      { label:"FS against failure/rollover",  val:FS_failure,       limit:FS_failure_req, ok:fsOk_failure, unit:"", higherBetter:true },
      { label:"Lateral bending stress",       val:sigma_lat,        limit:fr,             ok:latCrackOk,   unit:"ksi" },
      { label:"Equilibrium tilt angle",       val:theta_eq*180/Math.PI, limit:theta_max*180/Math.PI, ok:theta_eq<=theta_max, unit:"°" },
    ],
  };
}

/**
 * Run lateral stability for both lifting and transport stages,
 * matching ConCise's two-stage lateral check.
 *
 * @param {object} section   — section properties including Iy
 * @param {object} prestress — {Pe, e, Aps, dp}
 * @param {object} materials — {Ec, Eci, fc, fci}
 * @param {object} geometry  — {span, liftPointFt, transportPointFt, yLift}
 * @param {number} sweep     — optional, in
 * @returns {object} {lifting, transport}
 */
export function runLateralStability(section, prestress, materials, geometry, sweep) {
  const { span, liftPointFt, transportPointFt, yLift } = geometry;

  // Stage 1: Initial lifting (crane, single pick, symmetric points)
  const lifting = lateralStabilityCheck({
    section, prestress, materials,
    geometry: {
      span,
      liftPoint: liftPointFt ?? 0.10 * span,  // ft from end
      yLift: yLift ?? 0,
    },
    sweep,
  });

  // Stage 2: Transport (truck bunks — typically farther out)
  // Transport: support at ~0.10 span from each end, but on truck overhang
  // Dynamic factor for transport doesn't affect lateral stability calc directly
  // but the sweep can be larger due to sweep accumulation
  const transport = lateralStabilityCheck({
    section, prestress, materials,
    geometry: {
      span,
      liftPoint: transportPointFt ?? 0.15 * span, // ft from end
      yLift: 0,
    },
    sweep: sweep ? sweep * 1.25 : undefined, // larger sweep for transport
  });

  return { lifting, transport };
}
