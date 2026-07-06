// ═══════════════════════════════════════════════════════════════
// PHASE 10a — TRANSFORMED SECTION PROPERTIES
//
// Computes net and transformed section properties for prestressed
// concrete members, matching ConCise Beam's "G1: Use transformed
// steel area in uncracked section properties" (Calculation Option).
//
// Three section types per PCI Design Handbook §4.2.1:
//
//   GROSS SECTION (no steel):
//     Used when G1 is off. A_g, I_g, yb_g.
//
//   NET SECTION (deduct prestress duct area):
//     A_n = A_g − A_ps   (no duct for pre-tensioned; full for post)
//     Used for transfer stress calculations at release.
//
//   TRANSFORMED SECTION (add (n-1)×A_s to concrete):
//     A_t = A_g + (n_p−1)×A_ps + (n_s−1)×A_s
//     Centroid shifts, I_t changes via parallel-axis theorem.
//     Used for service stress calculations (G1=ON).
//
// Reference: PCI Design Handbook 8th Ed. §4.2.1
//            ACI 318-19 Commentary §R24.5.2
// ═══════════════════════════════════════════════════════════════

/**
 * Compute transformed section properties.
 *
 * @param {object} gross — gross section {A, Ix, yb, h} (in²/in⁴/in/in)
 * @param {object} strands — {Aps, dp, Eps} — prestressing steel
 * @param {object} rebar — {As, ds, Es} — mild steel (ds = depth from top)
 * @param {number} Ec — concrete modulus (ksi)
 * @param {boolean} preTensioned — true for bonded pretensioned (n-1 method)
 *
 * @returns {object} {gross, net, transformed}
 *   Each has: {A, Ix, yb, yt, Sb, St, e_ps, e_s}
 */
export function computeTransformedSection(gross, strands, rebar, Ec, preTensioned = true) {
  const { A: Ag, Ix: Ig, yb: ybg, h } = gross;
  const { Aps = 0, dp = 0, Eps = 28500 } = strands;
  const { As = 0, ds = 0, Es = 29000 } = rebar;

  const ytg = h - ybg;
  const Sbg = Ig / ybg;
  const Stg = Ig / ytg;

  // ── Modular ratios ──────────────────────────────────────────
  const np = Eps / Ec;  // prestressing steel to concrete ratio
  const ns = Es  / Ec;  // mild steel to concrete ratio

  // For pre-tensioned bonded strand: use (np - 1) to avoid double-counting
  // the concrete area already in gross section. For post-tensioned: use np
  // directly and deduct duct area (simplified: assume duct ≈ strand area).
  const deltaNp = preTensioned ? (np - 1) : np;
  const deltaNs = ns - 1;

  // ── NET SECTION (deduct strand area for pre-tensioned) ───────
  // Pre-tensioned: no duct to deduct; net ≈ gross for hollowcore
  // Post-tensioned: deduct duct area; simplified as A_duct ≈ A_ps
  const A_net = preTensioned ? Ag : Ag - Aps;
  const yb_net = preTensioned
    ? ybg
    : (Ag * ybg - Aps * dp) / A_net;  // shift centroid
  const yt_net = h - yb_net;
  const I_net = preTensioned
    ? Ig
    : Ig + Ag * (ybg - yb_net) ** 2 - Aps * (dp - yb_net) ** 2; // simplified

  // ── TRANSFORMED SECTION ──────────────────────────────────────
  // Add (n-1) × each steel area at its depth from bottom
  const A_steel_ps = deltaNp * Aps;  // additional concrete-equivalent from strands
  const A_steel_s  = deltaNs * As;   // additional concrete-equivalent from mild steel
  const A_trans    = Ag + A_steel_ps + A_steel_s;

  // Centroid of transformed section from bottom
  const yb_trans = (
    Ag  * ybg  +
    A_steel_ps * dp +
    A_steel_s  * ds
  ) / A_trans;
  const yt_trans = h - yb_trans;

  // Moment of inertia of transformed section (parallel-axis theorem)
  // Gross section shifts from ybg to yb_trans
  const I_gross_shifted = Ig + Ag * (ybg - yb_trans) ** 2;
  // Steel additions (treated as point areas, no self I for thin steel)
  const I_ps_contrib = A_steel_ps * (dp - yb_trans) ** 2;
  const I_s_contrib  = A_steel_s  * (ds - yb_trans) ** 2;
  const I_trans      = I_gross_shifted + I_ps_contrib + I_s_contrib;

  const Sb_trans = I_trans / yb_trans;
  const St_trans = I_trans / yt_trans;

  // Strand eccentricity (measured from centroid of transformed section)
  const e_trans = yb_trans - dp; // negative = strand below centroid → prestress beneficial

  // Eccentricities from each centroid
  const e_gross = ybg - dp;
  const e_net   = yb_net - dp;

  return {
    gross: {
      A: Ag, Ix: Ig, yb: ybg, yt: ytg, Sb: Sbg, St: Stg,
      e: e_gross, np, ns, label:"Gross"
    },
    net: {
      A: A_net, Ix: I_net, yb: yb_net, yt: yt_net,
      Sb: I_net / yb_net, St: I_net / yt_net,
      e: e_net, label:"Net"
    },
    transformed: {
      A: A_trans, Ix: I_trans, yb: yb_trans, yt: yt_trans,
      Sb: Sb_trans, St: St_trans,
      e: e_trans,
      A_steel_ps, A_steel_s,
      np, ns, deltaNp, deltaNs,
      label:"Transformed"
    },
  };
}

/**
 * Compute prestress stresses using the correct section type.
 *
 * @param {object} section — one of {gross, net, transformed} from computeTransformedSection
 * @param {number} Pe      — effective prestress force (kips)
 * @param {number} M       — applied moment (kip-in)
 * @returns {object} {ftop, fbot} — stresses (ksi, +ve = compression)
 */
export function sectionStress(section, Pe, M) {
  const { A, Sb, St, e } = section;
  // Eccentric prestress + moment
  // Sign convention: compression = positive
  const ftop = Pe/A - Pe * Math.abs(e) / St + M / St;
  const fbot = Pe/A + Pe * Math.abs(e) / Sb - M / Sb;
  return { ftop, fbot };
}

/**
 * Compare gross vs transformed section stress results side by side.
 * Returns percentage difference so the engineer can see the impact
 * of using transformed vs gross section (G1 flag effect).
 *
 * @param {object} sections — from computeTransformedSection()
 * @param {number} Pe — effective prestress (kips)
 * @param {number} M  — service moment (kip-in)
 */
export function compareTransformation(sections, Pe, M) {
  const { gross, transformed } = sections;

  const sg = sectionStress(gross,       Pe, M);
  const st = sectionStress(transformed, Pe, M);

  const diffTop = st.ftop - sg.ftop;
  const diffBot = st.fbot - sg.fbot;
  const pctTop  = gross.St > 0 ? Math.abs(diffTop / sg.ftop) * 100 : 0;
  const pctBot  = gross.Sb > 0 ? Math.abs(diffBot / sg.fbot) * 100 : 0;

  return {
    gross:       sg,
    transformed: st,
    diffTop, diffBot, pctTop, pctBot,
    // Did transformation have a meaningful impact? (>1%)
    significant: pctTop > 1.0 || pctBot > 1.0,
  };
}
