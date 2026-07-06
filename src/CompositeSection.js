// ═══════════════════════════════════════════════════════════════
// PHASE 4 — COMPOSITE SECTION, INTERFACE SHEAR & CRACK WIDTH
//
// Composite section: precast hollowcore + CIP topping slab.
// Transforms topping concrete to precast modular ratio (n = Ec_top/Ec_pre)
// and computes composite A, I, yb using parallel-axis theorem.
//
// Interface shear: horizontal shear at precast/topping interface
// per ACI 318-19 §26.5.6 / PCI 8th Ed. §5.3.5
//
// Crack width: maximum crack width per ACI 318-19 §24.3.2 for
// flexural tension in mild steel (relevant when Class C governs
// or when mild steel is present in tension zone).
//
// All units: kip, in, ft, ksi (consistent with PCITab)
// ═══════════════════════════════════════════════════════════════

/**
 * Compute composite section properties.
 * @param {object} pre   — precast section {A, Ix, yb, h, b, SW}
 * @param {object} top   — topping {tc, b_eff, fc_top, wc_top}
 *   tc      = topping thickness (in)
 *   b_eff   = effective topping width (in), usually same as precast b
 *   fc_top  = topping concrete strength (ksi)
 *   wc_top  = topping unit weight (pcf)
 * @param {number} fc_pre — precast concrete strength (ksi)
 * @returns {object} composite section properties
 */
export function computeComposite(pre, top, fc_pre) {
  const { A: Ap, Ix: Ip, yb: ybp, h: hp, b: bp } = pre;
  const { tc, b_eff, fc_top, wc_top } = top;

  // Modular ratio: transform topping to equivalent precast concrete
  const Ec_pre = 57 * Math.sqrt(fc_pre * 1000); // ksi
  const Ec_top = 57 * Math.sqrt(fc_top * 1000); // ksi
  const n = Ec_top / Ec_pre; // modular ratio (typically < 1 if weaker topping)

  // Transformed topping area (in²)
  const A_top_trans = n * b_eff * tc;

  // Topping centroid from bottom = hp + tc/2
  const y_top = hp + tc / 2;

  // Composite section centroid from bottom (parallel axis theorem)
  const A_comp = Ap + A_top_trans;
  const yb_comp = (Ap * ybp + A_top_trans * y_top) / A_comp;
  const h_comp = hp + tc;
  const yt_comp = h_comp - yb_comp;

  // Composite moment of inertia (parallel axis theorem)
  const I_top_own = n * b_eff * tc ** 3 / 12;
  const I_top_par = A_top_trans * (y_top - yb_comp) ** 2;
  const I_pre_par = Ip + Ap * (ybp - yb_comp) ** 2;
  const I_comp = I_pre_par + I_top_own + I_top_par;

  const Sb_comp = I_comp / yb_comp;
  const St_comp = I_comp / yt_comp;

  // Topping self weight (plf per ft of slab width — actual, not transformed)
  const SW_top = wc_top * tc / 12; // psf

  return {
    A_comp,
    I_comp,
    yb_comp,
    yt_comp,
    h_comp,
    Sb_comp,
    St_comp,
    n,
    Ec_pre,
    Ec_top,
    A_top_trans,
    SW_top,
  };
}

/**
 * Composite service stress check at critical section.
 * For composite hollowcore: precast carries DL (SW + SDL before topping),
 * composite section carries SDL-after + LL.
 *
 * @param {object} pre     — precast section properties {A, Ix, yb, h}
 * @param {object} comp    — composite section from computeComposite()
 * @param {number} Pe      — effective prestress force (kips)
 * @param {number} e       — strand eccentricity (in)
 * @param {number} M_pre   — moment on precast (DL) section (kip-in)
 * @param {number} M_SDL   — moment from SDL applied after composite (kip-in)
 * @param {number} M_LL    — moment from LL on composite section (kip-in)
 * @param {number} fc_pre  — precast f′c (ksi)
 * @returns {object} stresses and checks
 */
export function compositeStress(pre, comp, Pe, e, M_pre, M_SDL, M_LL, fc_pre) {
  const { A, Ix, yb, h } = pre;
  const { I_comp, yb_comp, yt_comp, Sb_comp, St_comp, n } = comp;
  const Sb_pre = Ix / yb, St_pre = Ix / (h - yb);

  // Bottom fiber: uses composite Sb for all loads (conservative for hollowcore)
  // Stress in precast bottom (tension = positive = bad)
  const f_bot = (Pe / A + Pe * e / Sb_pre) - M_pre / Sb_pre - (M_SDL + M_LL) / Sb_comp;

  // Top fiber of precast (compression = positive = good)
  const f_top_pre = (Pe / A - Pe * e / St_pre) + M_pre / St_pre + (M_SDL + M_LL) / St_comp;

  // Top fiber of topping (compression = positive)
  // Need to account for modular ratio at topping centroid
  const f_top_top = f_top_pre * 1.0; // simplified: same as precast top for thin topping

  // Allowables (ACI Class U)
  const f_tens_allow = 7.5 * Math.sqrt(fc_pre * 1000) / 1000; // ksi
  const f_comp_allow = 0.45 * fc_pre; // ksi

  return {
    f_bot,
    f_top_pre,
    f_top_top,
    f_tens_allow,
    f_comp_allow,
    tensOk: Math.abs(Math.min(f_bot, 0)) <= f_tens_allow,
    compOk: f_top_pre <= f_comp_allow,
  };
}

/**
 * Interface shear check — horizontal shear at precast/topping interface.
 * ACI 318-19 §26.5.6 / PCI 8th Ed. §5.3.5
 *
 * @param {number} Vu      — factored shear at interface (kips)
 * @param {number} b_v     — interface width = precast top flange width (in)
 * @param {number} d_v     — effective depth to tension steel (in)
 * @param {string} surface — "smooth" | "roughened" | "keyed"
 * @param {number} Avf     — area of interface shear reinforcement (in²) per unit length
 * @param {number} fy      — yield strength of interface steel (ksi)
 * @param {number} phi     — strength reduction factor (default 0.75)
 * @returns {object} Vnh design values and check
 */
export function interfaceShear(Vu, b_v, d_v, surface = "roughened", Avf = 0, fy = 60, phi = 0.75) {
  // Horizontal shear per unit length (kip/in)
  const Vh = Vu / d_v;

  // Friction coefficients per ACI 318-19 Table 22.9.4.2
  const mu = surface === "keyed" ? 1.4 : surface === "roughened" ? 1.0 : 0.6;

  // Cohesion + friction resistance per ACI 318-19 Eq. 22.9.4.2
  // For normal-weight concrete interface:
  // Vnh = (c·b_v + μ·Avf·fy) per unit length
  const c_cohesion = surface === "roughened" ? 0.280 : surface === "keyed" ? 0.400 : 0.075; // ksi
  const Vn_friction = (c_cohesion * b_v + mu * Avf * fy); // kips/in (Avf in in²/in)
  const Vn_max = Math.min(0.2 * 3.5 * b_v, 800 * b_v / 1000); // upper bound
  const Vnh = phi * Math.min(Vn_friction, Vn_max);

  // ACI 318-19 §26.5.6 minimum shear reinforcement check
  const Avf_min = surface === "roughened" ? 0 : 80 * Vh / (phi * fy * 1000); // in²/in

  return {
    Vh,           // horizontal shear per unit length (kip/in)
    Vnh,          // design horizontal shear resistance (kips/in)
    Vn_friction,
    Vn_max,
    Avf_min,
    mu,
    c_cohesion,
    ok: Vnh >= Vh,
    util: Vh / Math.max(Vnh, 0.001),
  };
}

/**
 * Maximum crack width estimate — ACI 318-19 §24.3.2
 * Uses the Gergely-Lutz formula adapted for ACI 318-19.
 * Applicable when mild steel (As) is present in tension zone.
 *
 * @param {number} fs    — stress in tension steel at service (ksi)
 * @param {number} dc    — clear cover to tension steel centroid (in)
 * @param {number} As    — area of tension steel (in²)
 * @param {number} b     — section width at tension face (in)
 * @param {number} nBars — number of tension bars
 * @returns {object} crack width in inches and ACI limit check
 */
export function crackWidth(fs, dc, As, b, nBars) {
  if (!As || As <= 0 || !nBars || nBars <= 0) {
    return { w: 0, w_limit: 0.016, ok: true, fs_max: 0, s: 0 };
  }

  // Effective tension area per bar (in²)
  const A_eff = 2 * dc * (b / nBars);

  // ACI 318-19 §24.3.2: maximum bar spacing for crack control
  // s ≤ 15(40/fs) - 2.5·cc but not > 12(40/fs)
  // where fs = service steel stress (ksi), cc = clear cover (in)
  const cc = dc - (As / nBars > 0 ? Math.sqrt(As / nBars / Math.PI) : 0.25); // clear cover
  const s_max_1 = 15 * (40 / (fs * 1000 / 6.895)) - 2.5 * cc; // in (ACI uses psi for fs in this formula)
  const s_max_2 = 12 * (40 / (fs * 1000 / 6.895)); // in
  const s_max = Math.min(s_max_1, s_max_2);

  // Gergely-Lutz crack width (in) — per ACI Committee 224
  // w = 0.076·β·fs·(dc·A)^(1/3) where β ≈ 1.20 for beams
  const beta = 1.20;
  const w = 0.076e-3 * beta * (fs * 1000) * (dc * A_eff) ** (1 / 3); // inches

  // ACI 318-19 implicit crack width limit ≈ 0.016 in (interior exposure)
  const w_limit = 0.016;

  return {
    w: Math.abs(w),           // crack width (in)
    w_limit,                   // ACI limit (in)
    ok: Math.abs(w) <= w_limit,
    s_max,                     // maximum bar spacing for crack control (in)
    cc,                        // clear cover used (in)
    A_eff,                     // effective tension area per bar (in²)
  };
}

/**
 * Compute factored service steel stress for crack width check.
 * Uses elastic section analysis at service load level.
 *
 * @param {number} M_service — unfactored service moment (kip-in)
 * @param {number} Pe        — effective prestress (kips)
 * @param {number} e         — strand eccentricity (in)
 * @param {object} section   — {A, Ix, yb, h}
 * @param {number} As        — mild steel area (in²)
 * @param {number} dp        — strand depth (in)
 * @param {number} Es        — steel modulus (ksi, default 29000)
 * @param {number} Ec        — concrete modulus (ksi)
 * @returns {number} fs — steel stress (ksi)
 */
export function steelStressAtService(M_service, Pe, e, section, As, dp, Es = 29000, Ec) {
  const { A, Ix, yb } = section;
  const n_s = Es / Ec; // modular ratio for steel
  // Concrete stress at steel level (tension = negative)
  const fc_at_dp = Pe / A + Pe * e / Ix * yb - M_service * yb / Ix;
  // Steel stress (transformed) = n × concrete stress (simplified)
  const fs = Math.abs(n_s * fc_at_dp);
  return Math.min(fs, 36); // cap at 0.6fy for typical Grade 60
}

/**
 * Full composite + interface shear + crack width package.
 * Call this once with all the inputs and get everything back.
 */
export function runPhase4(params) {
  const {
    // Precast section
    pre, fc_pre, fci,
    // Prestress
    Pe, e, Aps, dp,
    // Mild steel
    As, nBars, cover,
    // Loading (kip-in)
    M_DL_pre, M_SDL, M_LL, Vu_max,
    // Topping
    composite, tc, b_eff, fc_top, wc_top = 150,
    // Interface
    surface = "roughened",
    // Code
    phi = 0.75,
  } = params;

  const result = { composite: false };

  // ── Composite section (only if topping is defined and tc > 0) ──
  if (composite && tc > 0) {
    const comp = computeComposite(pre, { tc, b_eff: b_eff || pre.b, fc_top: fc_top || 3, wc_top }, fc_pre);
    result.composite = true;
    result.comp = comp;

    // Service stress on composite section
    const stresses = compositeStress(pre, comp, Pe, e, M_DL_pre, M_SDL, M_LL, fc_pre);
    result.stresses = stresses;

    // Interface shear at the precast/topping interface
    const b_v = pre.b; // interface width = slab width
    const d_v = dp;    // effective depth
    const iShear = interfaceShear(Vu_max, b_v, d_v, surface, 0, 60, phi);
    result.interfaceShear = iShear;
  } else {
    result.comp = null;
    result.stresses = null;
    result.interfaceShear = null;
  }

  // ── Crack width (always, if As > 0) ──
  if (As > 0 && nBars > 0) {
    const Ec = 57 * Math.sqrt(fc_pre * 1000);
    const M_total = M_DL_pre + M_SDL + M_LL; // kip-in, service
    const fs = steelStressAtService(M_total, Pe, e, pre, As, dp, 29000, Ec);
    const crack = crackWidth(fs, cover + 0.5, As, pre.b, nBars);
    result.crackWidth = crack;
    result.fs_service = fs;
  } else {
    result.crackWidth = null;
    result.fs_service = 0;
  }

  return result;
}
