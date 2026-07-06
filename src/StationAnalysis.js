// ═══════════════════════════════════════════════════════════════
// PHASE 3 — STATION-BY-STATION ANALYSIS
// Computes M(x), V(x), concrete stresses, flexural resistance,
// shear resistance, and deflection at n equally-spaced stations
// along the span, matching the ConCise Beam station-table output.
//
// Inputs mirror PCITab's existing useMemo variables exactly so
// this module can be called with minimal wiring. All units remain
// consistent with PCITab: kip, in, ft, ksi.
// ═══════════════════════════════════════════════════════════════

/**
 * Run the full station analysis.
 * @param {object} p  — structural properties from PCITab useMemo
 * @param {object} inputs — raw input values from PCITab state
 * @param {number} nStations — number of analysis stations (default 21)
 * @returns {Array} rows — one object per station
 */
export function runStationAnalysis(p, inputs, nStations = 21) {
  const { s, Aps, fpu, fpi, dp, e, Pe, As, fy, b1, Ec, Eci, vs } = p;
  const { fc, fci, span, sdl, ll, cover, nH, nS } = inputs;

  const L = span;           // ft
  const Ln = L * 12;        // in
  const A = s.A, Ix = s.Ix, yb = s.yb, yt = s.h - yb;
  const Sb = Ix / yb, St = Ix / yt;
  const bw = s.bw, bft = s.b; // web width and flange width (= slab width)

  // ── Loading ──────────────────────────────────────────────────
  // Convert from area loads (psf on a 1-ft-wide slice, slab b-wide)
  const wSW  = s.SW * s.b / 12 / 1000;   // kip/in self-weight
  const wSDL = sdl   * s.b / 12 / 1000;  // kip/in SDL
  const wLL  = ll    * s.b / 12 / 1000;  // kip/in LL
  const wU   = 1.2 * (wSW + wSDL) + 1.6 * wLL;  // kip/in factored
  const wSvc = wSW + wSDL + wLL;          // kip/in service (unfactored)

  // Reactions at supports (simple span)
  const RaU  = wU   * Ln / 2;   // kips, factored
  const RaSvc= wSvc * Ln / 2;   // kips, service

  // Transfer strand prestress with development along transfer length
  const lt = 50 * 0.5; // transfer length, in (50db for 0.5" strand)
  const ld = lt + (fpu - fpi) * 0.5 * 0.3; // approx development length, in

  /**
   * Effective prestress force at position x (in), accounting for
   * strand development from the support end.
   * - In transfer zone (x < lt): force builds linearly from 0
   * - Beyond development length (x >= ld): fully effective
   */
  const peAtX = (xIn) => {
    const xFromEnd = Math.min(xIn, Ln - xIn); // distance from nearer end
    if (xFromEnd <= 0) return 0;
    if (xFromEnd >= lt) return Pe;
    return Pe * (xFromEnd / lt);
  };

  // ── Section flexural resistance ΦMn(x) ──────────────────────
  // Uses the same Method #1 fps equation as PCITab but with
  // the local Pe(x) for the stress-in-strand check.
  const phiMnAtX = (xIn) => {
    const peX = peAtX(xIn);
    const fpeX = peX / Aps;
    const rhoP = Aps / (bft * dp);
    const fps = fpu * (1 - (0.28 / b1) * (rhoP * fpu / fc));
    const a   = Aps * fps / (0.85 * fc * bft);
    const phi = 0.9; // simplified — assume tension-controlled
    return phi * Aps * fps * (dp - a / 2) / 12; // kip-ft
  };

  // ── Flexural stresses at any section under service load ───────
  // σ = Pe/A ± Pe·e/S ∓ M/S (sign convention: +ve = compression)
  const stressAtX = (xIn, M_kipin) => {
    const peX = peAtX(xIn);
    const ftop = peX / A - peX * e / St + M_kipin / St; // +ve = comp
    const fbot = peX / A + peX * e / Sb - M_kipin / Sb;
    return { ftop, fbot };
  };

  // ── Shear capacity Vc at position x ──────────────────────────
  // PCI 8th §5.3.3 — Vci (flexure-shear) and Vcw (web-shear),
  // governing minimum. Simplified here using the VcS formula
  // from ACI 318-19 §22.5.8.3 for prestressed members.
  const vcAtX = (xIn, Vu_kips, Mu_kipft) => {
    const peX = peAtX(xIn);
    const fpcX = peX / A; // ksi
    // Vci: flexure-shear (ACI 318-19 Eq. 22.5.8.3a)
    const Vci = 0.75 * Math.max(
      0.6 * Math.sqrt(fc * 1000) / 1000 * bw * dp
        + (Vu_kips * p.Mcr || 1) / (Mu_kipft * 12 || 1),
      1.7 * Math.sqrt(fc * 1000) / 1000 * bw * dp
    );
    // Vcw: web-shear (ACI 318-19 Eq. 22.5.8.3b)
    const Vcw = 0.75 * (3.5 * Math.sqrt(fc * 1000) / 1000 + 0.3 * fpcX) * bw * dp;
    return Math.min(Vci, Vcw);
  };

  // ── Deflection at x — parabolic approximation ──────────────
  // For simply-supported beam with UDL, δ(x) = w·x·(L³−2Lx²+x³)/(24EI)
  // For prestress camber (inverse parabola): δp(x) = Pe·e·x·(L−x)/(2EI)  [beam eq.]
  const deflAtX = (xIn, w_kipin_per_unit, EI) => {
    // UDL downward deflection at x (positive = downward)
    const deltaLoad = w_kipin_per_unit * xIn * (Ln ** 3 - 2 * Ln * xIn ** 2 + xIn ** 3) / (24 * EI);
    return deltaLoad;
  };

  // Prestress camber profile (upward = positive)
  // Assumes constant e (straight strands) — parabolic gives:
  // δp(x) = Pe·e·x·(L-x)/(2·EI·L) ... from PCI Eq. 4.8.2 for equiv. UDL
  // Using straight-strand equivalent: Pe·e/(8EI·L)·x·(L-x) ... simplified
  const camberAtX = (xIn, PeVal, EI) => {
    return PeVal * e * xIn * (Ln - xIn) / (2 * EI * Ln);
  };

  // ── Station sweep ─────────────────────────────────────────────
  const rows = [];
  for (let i = 0; i < nStations; i++) {
    const xi = (i / (nStations - 1)) * Ln;  // in from left support
    const xFt = xi / 12;                      // ft

    // ── Factored M and V ──
    const Mu_kft   = wU * xi * (Ln - xi) / 2 / 12;   // kip-ft
    const Vu_kips  = RaU - wU * xi;                    // kips

    // ── Service M ──
    const Msvc_kin  = wSvc * xi * (Ln - xi) / 2;      // kip-in (for stress)
    const Msvc_kft  = Msvc_kin / 12;                    // kip-ft

    // ── Transfer M (self-weight only, at transfer length boundary) ──
    const Mgx_kin = wSW * xi * (Ln - xi) / 2;

    // ── Concrete stresses (service) ──
    const { ftop, fbot } = stressAtX(xi, Msvc_kin);

    // ── Concrete stress limits ──
    const atensCls = 7.5 * Math.sqrt(fc * 1000) / 1000; // ksi, Class U tension
    const acompSvc = 0.45 * fc;                           // ksi, sustained comp.

    // ── Flexural resistance ──
    const phiMn = phiMnAtX(xi);

    // ── Cracking moment ──
    const Mcr_kft = (Ix / yb * (Pe / A + Pe * e / Sb + 7.5 * Math.sqrt(fc * 1000) / 1000)) / 12;

    // ── Min flexural resistance (ACI 318-19 §9.6.1.2) ──
    const MrMin_kft = Math.min(1.2 * Mcr_kft, 4 / 3 * Mu_kft);

    // ── Shear resistance ──
    const Vn = vcAtX(xi, Math.abs(Vu_kips), Math.abs(Mu_kft) || 0.001);
    const shearOk = Vn >= Math.abs(Vu_kips);

    // ── Deflection ──
    const EIeff = Eci * Ix;   // at release
    const EIsvc = Ec  * Ix;   // at service (p.Ec from PCITab)

    const camberI = camberAtX(xi, p.Po, EIeff);
    const deltaSwI = deflAtX(xi, wSW, EIeff);
    const netI  = camberI - deltaSwI;    // positive = upward

    // Erection stage (multiply by PCI multipliers)
    const camberE = 1.80 * camberAtX(xi, p.Po, EIeff);
    const deltaDL = deflAtX(xi, wSW,  EIeff);
    const netE  = camberE - 1.85 * deltaDL;

    // Final stage
    const camberF = 2.45 * camberAtX(xi, p.Po, EIeff);
    const dSDLx   = deflAtX(xi, wSDL, EIsvc);
    const dLLx    = deflAtX(xi, wLL,  EIsvc);
    const netF  = camberF - 2.70 * deltaDL - dSDLx - dLLx;
    const netFinalSus = camberF - 2.70 * deltaDL - dSDLx;

    // L/δ ratio (avoid div by zero)
    const spanIn = Ln;
    const Lratio = Math.abs(netF) > 0.001 ? spanIn / Math.abs(netF) : 9999;

    // Status flags at this station
    const flexOk     = phiMn >= Mu_kft || Math.abs(xi - Ln / 2) > Ln * 0.45;
    const tensBot_ok  = fbot  >=  -atensCls;  // tension in ksi: fbot is + for compression
    const compTop_ok  = ftop  <=   acompSvc;  // compression check

    rows.push({
      x: xFt,                       // ft
      xIn: xi,                       // in
      Mu: Mu_kft,                    // kip-ft, factored moment
      Vu: Vu_kips,                   // kips, factored shear
      Msvc: Msvc_kft,                // kip-ft, service moment
      ftop,                          // ksi, top fiber stress (+comp)
      fbot,                          // ksi, bot fiber stress (+comp)
      phiMn,                         // kip-ft, flexural resistance
      Mcr: Mcr_kft,                  // kip-ft, cracking moment
      MrMin: MrMin_kft,              // kip-ft, minimum resistance
      Vn,                            // kips, shear resistance
      camberI,                       // in, prestress camber at release
      netI,                          // in, net deflection at release
      netE,                          // in, net at erection
      netFinalSus,                   // in, net sustained at final
      netF,                          // in, net total at final
      dLLx,                          // in, LL-only deflection
      Lratio: Math.round(Lratio),   // L/δ ratio
      flexOk,
      tensBot_ok,
      compTop_ok,
      stressOk: tensBot_ok && compTop_ok,
      shearOk,
      allOk: flexOk && tensBot_ok && compTop_ok && shearOk,
    });
  }

  return rows;
}

/**
 * Returns just the midspan + support envelope values for quick summary
 */
export function stationSummary(rows) {
  if (!rows || !rows.length) return {};
  const mid = rows[Math.floor(rows.length / 2)];
  const maxMu  = Math.max(...rows.map(r => r.Mu));
  const maxVu  = Math.max(...rows.map(r => Math.abs(r.Vu)));
  const maxNet = Math.max(...rows.map(r => r.netF));
  const minNet = Math.min(...rows.map(r => r.netF));
  return { mid, maxMu, maxVu, maxNet, minNet };
}
