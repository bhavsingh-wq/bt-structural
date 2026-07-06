// ═══════════════════════════════════════════════════════════════
// PHASE 5 — CONSTRUCTION STAGES LIFECYCLE
//
// Computes stresses, deflections, and design checks at each of
// the 5 construction stages ConCise tracks:
//
//   Stage 1: Transfer/Stripping (day 0.75)
//            - Prestress applied, beam on dunnage
//            - Loading: self-weight only
//            - Section: precast gross, uses fci
//            - Checks: transfer stresses (top/bot at ends + midspan)
//
//   Stage 2: Initial Lifting (day 1)
//            - Beam picked up at specified lifting points (not supports)
//            - Dynamic factor 1.2 applied to self-weight
//            - Section: precast gross, uses fci lifting limits
//            - Checks: stress at lifting points + midspan
//
//   Stage 3: Transport/Erection Lift (day 40)
//            - Beam in truck/crane, transported to site
//            - Loading: self-weight × dynamic factor (1.5)
//            - Overhang moments at transport support points
//            - Checks: stress limits for transportation
//
//   Stage 4: CIP Pour (day 50)
//            - Beam on service supports
//            - Loading: SW + CIP topping weight
//            - Section: precast only (not composite yet)
//            - Checks: stress limits under wet concrete weight
//
//   Stage 5: Final Service (day 143)
//            - Full loading: SW + SDL + LL on composite section
//            - Section: composite (if CIP pour defined)
//            - Pe after all long-term losses
//            - Checks: Class U service stress, ΦMn ≥ Mu
//
// All inputs in kip/in/ksi (imperial, matching PCITab convention).
// ═══════════════════════════════════════════════════════════════

/**
 * Run full construction lifecycle analysis.
 *
 * @param {object} section   — precast section {A, Ix, yb, h, b, bw, SW}
 * @param {object} prestress — {Po, Pe, Aps, fpu, fpi, dp, e, Eps}
 * @param {object} materials — {fc, fci, Ec, Eci}
 * @param {object} geometry  — {span, liftPointL, liftPointR, storageLeft, storageRight}
 * @param {object} loading   — {wSDL, wLL, wCIP} (kip/in, per unit width already factored)
 * @param {object} schedule  — {transferDay, initialLiftDay, erectionDay, cipDay, finalDay}
 * @param {object} composite — {enabled, A_comp, I_comp, yb_comp, h_comp, SW_top}
 * @param {number} RH        — relative humidity (%)
 * @param {boolean} shored   — is the beam shored during CIP pour?
 * @returns {Array} stages   — one object per construction stage
 */
export function runConstructionStages(section, prestress, materials, geometry, loading, schedule, composite, RH = 70, shored = false) {
  const { A, Ix, yb, h, b, bw, SW } = section;
  const { Po, Pe, Aps, fpu, fpi, dp, e, Eps } = prestress;
  const { fc, fci, Ec, Eci } = materials;
  const { span, liftPointL, liftPointR, storageLeft, storageRight } = geometry;
  const { wSDL, wLL, wCIP } = loading;
  const { transferDay, initialLiftDay, erectionDay, cipDay, finalDay } = schedule;

  const L  = span * 12;    // in — full span
  const Sb = Ix / yb, St = Ix / (h - yb);

  // ── Prestress loss time-dependent fractions ────────────────
  // Simplified: losses build up between transfer and final.
  // Pi = prestress at transfer (before elastic shortening)
  // Po = prestress immediately after transfer (~0.95 Pi)
  // Pe = final effective prestress after all losses
  // For intermediate stages, interpolate linearly by log(day)
  const logInterp = (day) => {
    const t0 = Math.log(Math.max(transferDay, 0.5));
    const tf = Math.log(Math.max(finalDay, 1));
    const td = Math.log(Math.max(day, 0.5));
    const frac = (td - t0) / (tf - t0);
    return Po - (Po - Pe) * Math.max(0, Math.min(1, frac));
  };

  // ── Moment from UDL on simple span ────────────────────────
  const simpleMidMoment = (w, L_in) => w * L_in * L_in / 8; // kip-in

  // ── Moment with two lifting/support points ──────────────
  // For lifting: two pick points at 'a' from each end.
  // Max moment = w*a*(L - a)/2 at midspan (if pick is symmetric)
  // Or: moment at pick point = w*a²/2 (cantilever overhang)
  const liftMidMoment  = (w, L_in, a) => w * (L_in - 2*a) * (L_in - 2*a) / 8; // positive at mid
  const liftOverhangM  = (w, a) => -w * a * a / 2;    // negative at pick point (top tension)

  // ── Stress formula at any point ───────────────────────────
  const stress = (PeLocal, M_kipin, Sb_loc = Sb, St_loc = St, A_loc = A) => ({
    top: -PeLocal/A_loc + PeLocal*e/St_loc + M_kipin/St_loc,
    bot: -PeLocal/A_loc - PeLocal*e/Sb_loc + M_kipin/Sb_loc,
  });

  // ── Deflection helpers ────────────────────────────────────
  // Midspan deflection for simple span UDL
  const deflUDL = (w, L_in, EI) => 5 * w * L_in**4 / (384 * EI); // in (positive = downward)
  // Midspan camber from prestress (constant eccentricity)
  const camberPS = (PeLocal, L_in, EI) => PeLocal * e * L_in**2 / (8 * EI); // in (positive = upward)

  // ── Stress limits ─────────────────────────────────────────
  const limits = {
    // At transfer (fci)
    transfer: {
      tens_end:  6  * Math.sqrt(fci * 1000) / 1000,  // 6√fci ksi
      tens_mid:  3  * Math.sqrt(fci * 1000) / 1000,  // 3√fci ksi
      comp_end:  0.70 * fci,
      comp_mid:  0.60 * fci,
    },
    // Handling/erection (use fci values, slightly more liberal)
    handling: {
      tens:  7.5 * Math.sqrt(fci * 1000) / 1000,
      comp:  0.70 * fci,
    },
    // Service (fc)
    service: {
      tens_classU: 7.5 * Math.sqrt(fc * 1000) / 1000,
      comp_sus:    0.45 * fc,
      comp_tot:    0.60 * fc,
    },
  };

  // ── PCI deflection multipliers (from PCI Table 4.8.4) ────
  // Non-composite values (default unless user overrides in Phase 4)
  const mult = {
    SW_erection:  1.85,  Ps_erection:  1.80,
    SW_final_nc:  2.70,  Ps_final_nc:  2.45,
    SDL_final_nc: 3.00,
  };

  const stages = [];

  // ════════════════════════════════════════════════════════════
  // STAGE 1: TRANSFER / STRIPPING
  // ════════════════════════════════════════════════════════════
  (() => {
    const PeStage = Po;  // at transfer, use initial prestress
    const EI = Eci * Ix;
    const wSW = SW / 12 / 1000;  // kip/in (convert from plf/ft-width)

    // Stresses at beam ends (at transfer length lt from support)
    const lt = 50 * 0.5; // in, transfer length for 0.5" strand
    const PeEnd = PeStage * (lt / lt); // = full Po at transfer length boundary
    const M_end  = simpleMidMoment(wSW, lt * 2) * 0;  // minimal at ends
    const stEnd  = stress(PeEnd, 0);

    // Stresses at midspan
    const M_mid  = simpleMidMoment(wSW, L);
    const stMid  = stress(PeStage, M_mid);

    // Camber and deflection at release
    const camber = camberPS(PeStage, L, EI);
    const defl   = deflUDL(wSW, L, EI);
    const netDefl = camber - defl; // positive = net upward

    stages.push({
      id: 1,
      name: "Transfer / Stripping",
      day: transferDay,
      Pe: PeStage,
      wApplied: wSW,
      description: "Prestress applied, self-weight only, beam on dunnage",
      M_mid,
      M_end: 0,
      stress_end_top: stEnd.top,
      stress_end_bot: stEnd.bot,
      stress_mid_top: stMid.top,
      stress_mid_bot: stMid.bot,
      camber,
      defl_sw: defl,
      netDefl,
      // Limit checks
      checks: [
        { label:"Top tension @ ends",   val:stEnd.top, limit:-limits.transfer.tens_end, ok:stEnd.top >= -limits.transfer.tens_end, unit:"ksi" },
        { label:"Bot compression @ ends",val:Math.abs(stEnd.bot), limit:limits.transfer.comp_end, ok:Math.abs(stEnd.bot)<=limits.transfer.comp_end, unit:"ksi" },
        { label:"Top tension @ midspan", val:stMid.top, limit:-limits.transfer.tens_mid, ok:stMid.top >= -limits.transfer.tens_mid, unit:"ksi" },
        { label:"Bot compression @ mid", val:Math.abs(stMid.bot), limit:limits.transfer.comp_mid, ok:Math.abs(stMid.bot)<=limits.transfer.comp_mid, unit:"ksi" },
      ],
    });
  })();

  // ════════════════════════════════════════════════════════════
  // STAGE 2: INITIAL LIFTING
  // ════════════════════════════════════════════════════════════
  (() => {
    const PeStage = logInterp(initialLiftDay);
    const EI = Eci * Ix;
    const dynFactor = 1.20;  // PCI dynamic factor for initial pick
    const wSW = SW / 12 / 1000 * dynFactor;

    // Lift points: default at 0.10L from each end if not specified
    const aL = (liftPointL ?? 0.10 * span) * 12;  // in from left end
    const aR = (liftPointR ?? 0.10 * span) * 12;  // in from right end (= aL for symmetric)
    const a  = Math.min(aL, aR);

    // Moment at lift point (overhang — hogging, top tension)
    const M_overhang = liftOverhangM(wSW, a);
    // Moment at midspan (sagging)
    const M_mid = liftMidMoment(wSW, L, a);

    const stLiftPt = stress(PeStage, Math.abs(M_overhang));
    const stMid    = stress(PeStage, M_mid);

    const camber  = camberPS(PeStage, L, EI);
    const deflSW  = deflUDL(wSW, L, EI) * 0.85; // slightly less for lifted beam
    const netDefl = camber - deflSW;

    stages.push({
      id: 2,
      name: "Initial Lifting",
      day: initialLiftDay,
      Pe: PeStage,
      wApplied: wSW,
      dynFactor,
      liftPointFt: a / 12,
      description: `Beam picked at ${(a/12).toFixed(1)} ft from ends, dynamic factor ${dynFactor}`,
      M_mid,
      M_overhang,
      stress_end_top: stLiftPt.top,
      stress_end_bot: stLiftPt.bot,
      stress_mid_top: stMid.top,
      stress_mid_bot: stMid.bot,
      camber,
      defl_sw: deflSW,
      netDefl,
      checks: [
        { label:"Top tension @ lift point", val:stLiftPt.top, limit:-limits.handling.tens, ok:stLiftPt.top >= -limits.handling.tens, unit:"ksi" },
        { label:"Bot compression @ lift pt", val:Math.abs(stLiftPt.bot), limit:limits.handling.comp, ok:Math.abs(stLiftPt.bot)<=limits.handling.comp, unit:"ksi" },
        { label:"Top tension @ midspan",     val:stMid.top, limit:-limits.handling.tens, ok:stMid.top >= -limits.handling.tens, unit:"ksi" },
        { label:"Bot compression @ midspan", val:Math.abs(stMid.bot), limit:limits.handling.comp, ok:Math.abs(stMid.bot)<=limits.handling.comp, unit:"ksi" },
      ],
    });
  })();

  // ════════════════════════════════════════════════════════════
  // STAGE 3: TRANSPORT / ERECTION LIFT
  // ════════════════════════════════════════════════════════════
  (() => {
    const PeStage = logInterp(erectionDay);
    const EI = Eci * Ix;
    const dynFactor = 1.50;  // higher dynamic factor for transport
    const wSW = SW / 12 / 1000 * dynFactor;

    // Transport support points: typically 0.15L from each end
    const a = 0.15 * L;
    const M_overhang = liftOverhangM(wSW, a);
    const M_mid = liftMidMoment(wSW, L, a);

    const stEnd = stress(PeStage, Math.abs(M_overhang));
    const stMid = stress(PeStage, M_mid);

    // Erection camber (PCI multiplier from Table 4.8.4)
    const camber = camberPS(Po, L, Eci * Ix) * mult.Ps_erection;
    const deflSW = deflUDL(SW/12/1000, L, Eci * Ix) * mult.SW_erection;
    const netDefl = camber - deflSW;

    stages.push({
      id: 3,
      name: "Transport / Erection",
      day: erectionDay,
      Pe: PeStage,
      wApplied: wSW,
      dynFactor,
      description: `Transport with dynamic factor ${dynFactor}. Support at ${(a/12).toFixed(1)} ft from ends.`,
      M_mid,
      M_overhang,
      stress_end_top: stEnd.top,
      stress_end_bot: stEnd.bot,
      stress_mid_top: stMid.top,
      stress_mid_bot: stMid.bot,
      camber,
      defl_sw: deflSW,
      netDefl,
      checks: [
        { label:"Top tension @ overhang", val:stEnd.top, limit:-limits.handling.tens, ok:stEnd.top >= -limits.handling.tens, unit:"ksi" },
        { label:"Bot compression @ overhang", val:Math.abs(stEnd.bot), limit:limits.handling.comp, ok:Math.abs(stEnd.bot)<=limits.handling.comp, unit:"ksi" },
        { label:"Top tension @ midspan", val:stMid.top, limit:-limits.handling.tens, ok:stMid.top >= -limits.handling.tens, unit:"ksi" },
        { label:"Bot compression @ midspan", val:Math.abs(stMid.bot), limit:limits.handling.comp, ok:Math.abs(stMid.bot)<=limits.handling.comp, unit:"ksi" },
      ],
    });
  })();

  // ════════════════════════════════════════════════════════════
  // STAGE 4: CIP POUR
  // ════════════════════════════════════════════════════════════
  (() => {
    const PeStage = logInterp(cipDay);
    const EI = Ec * Ix;  // use 28-day Ec (concrete has matured by CIP pour)
    const wSW = SW / 12 / 1000;
    // CIP topping weight
    const wTop = (wCIP || 0);  // kip/in already converted
    const wTotal = wSW + wTop;

    const M_mid = simpleMidMoment(wTotal, L);
    const stMid = stress(PeStage, M_mid);
    const stEnd = stress(PeStage, 0);

    // Completion camber (PCI multiplier, non-composite)
    const camber = camberPS(Po, L, Eci * Ix) * mult.Ps_erection;
    const deflSW  = deflUDL(SW/12/1000, L, Eci * Ix) * mult.SW_erection;
    const deflTop = deflUDL(wTop, L, EI);
    const netDefl = camber - deflSW - deflTop;

    const cipLimits = {
      tens: 7.5 * Math.sqrt(fc * 1000) / 1000,
      comp: 0.45 * fc,
    };

    stages.push({
      id: 4,
      name: "CIP Pour",
      day: cipDay,
      Pe: PeStage,
      wApplied: wTotal,
      wCIP: wTop,
      shored,
      description: `SW + CIP pour weight on precast section${shored ? " (shored)" : " (unshored)"}`,
      M_mid,
      stress_end_top: stEnd.top,
      stress_end_bot: stEnd.bot,
      stress_mid_top: stMid.top,
      stress_mid_bot: stMid.bot,
      camber,
      defl_sw: deflSW,
      defl_cip: deflTop,
      netDefl,
      checks: [
        { label:"Top tension @ midspan", val:stMid.top, limit:-cipLimits.tens, ok:stMid.top >= -cipLimits.tens, unit:"ksi" },
        { label:"Bot compression @ mid", val:Math.abs(stMid.bot), limit:cipLimits.comp, ok:Math.abs(stMid.bot)<=cipLimits.comp, unit:"ksi" },
      ],
    });
  })();

  // ════════════════════════════════════════════════════════════
  // STAGE 5: FINAL SERVICE
  // ════════════════════════════════════════════════════════════
  (() => {
    const PeStage = Pe;  // fully effective after all losses
    const EI = Ec * (composite?.enabled ? composite.I_comp : Ix);
    const A_eff  = composite?.enabled ? composite.A_comp  : A;
    const Sb_eff = composite?.enabled ? composite.I_comp / composite.yb_comp : Sb;
    const St_eff = composite?.enabled ? composite.I_comp / (composite.h_comp - composite.yb_comp) : St;

    const wSW  = SW / 12 / 1000;
    const wTot = wSW + wSDL + wLL;
    const wFac = (1.2 * (wSW + wSDL) + 1.6 * wLL);  // factored

    // Service moments
    const M_sus    = simpleMidMoment(wSW + wSDL, L);  // sustained
    const M_total  = simpleMidMoment(wTot, L);         // total service
    const M_u      = simpleMidMoment(wFac, L);         // factored

    // Composite stress: DL on precast, SDL+LL on composite
    const M_DL_pre = simpleMidMoment(wSW, L);
    const M_comp   = simpleMidMoment(wSDL + wLL, L);

    // Bottom fiber stress (composite: DL on precast Sb, SDL+LL on composite Sb)
    const fBot = -PeStage/A + PeStage*e/Sb - M_DL_pre/Sb
               - (composite?.enabled ? M_comp/Sb_eff : M_comp/Sb);

    // Top fiber stress
    const fTop = -PeStage/A - PeStage*e/St + M_DL_pre/St
               + (composite?.enabled ? M_comp/St_eff : M_comp/St);

    // Final deflection (PCI multiplier method, Table 4.8.4)
    const camberF = camberPS(Po, L, Eci * Ix) * mult.Ps_final_nc;
    const deflSW  = deflUDL(wSW, L, Eci * Ix) * mult.SW_final_nc;
    const deflSDL = deflUDL(wSDL, L, Ec * Ix) * mult.SDL_final_nc;
    const deflLL  = deflUDL(wLL,  L, Ec * Ix);
    const netDefl_sus = camberF - deflSW - deflSDL;
    const netDefl     = netDefl_sus - deflLL;

    // ΦMn (simplified — assumes fully developed strand)
    const b1  = Math.max(0.65, 0.85 - 0.05 * (fc - 4));
    const rhoP = Aps / (b * dp);
    const fps  = fpu * (1 - (0.28 / b1) * rhoP * fpu / fc);
    const a_b  = Aps * fps / (0.85 * fc * b);
    const phiMn = 0.9 * Aps * fps * (dp - a_b / 2) / 12;  // kip-ft
    const Mu_ft = M_u / 12;

    stages.push({
      id: 5,
      name: "Final Service",
      day: finalDay,
      Pe: PeStage,
      wApplied: wTot,
      compositeActive: !!composite?.enabled,
      description: composite?.enabled
        ? "Full SDL+LL on composite section"
        : "Full SDL+LL on precast section (no CIP pour)",
      M_sus, M_total, M_u,
      stress_mid_top: fTop,
      stress_mid_bot: fBot,
      stress_end_top: -PeStage/A + PeStage*e/St,
      stress_end_bot: -PeStage/A - PeStage*e/Sb,
      camber: camberF,
      defl_sw: deflSW,
      defl_sdl: deflSDL,
      defl_ll: deflLL,
      netDefl_sus,
      netDefl,
      phiMn,
      Mu_ft,
      liveRatio: span * 12 / Math.max(Math.abs(deflLL), 0.001),
      checks: [
        { label:"Bot tension (Class U)",   val:Math.abs(Math.min(fBot,0)), limit:limits.service.tens_classU, ok:fBot >= -limits.service.tens_classU, unit:"ksi" },
        { label:"Top comp (sustained)",    val:Math.abs(fTop), limit:limits.service.comp_sus, ok:Math.abs(fTop)<=limits.service.comp_sus, unit:"ksi" },
        { label:"Flexural strength ΦMn",  val:Mu_ft, limit:phiMn, ok:phiMn >= Mu_ft, unit:"kip-ft" },
        { label:"LL deflection L/360",     val:deflLL, limit:span*12/360, ok:deflLL<=span*12/360, unit:"in" },
      ],
    });
  })();

  return stages;
}

/**
 * Format a stage's stress check results as a PASS/FAIL summary string.
 */
export function stageSummary(stage) {
  const allOk = stage.checks.every(c => c.ok);
  const failCount = stage.checks.filter(c => !c.ok).length;
  return {
    allOk,
    failCount,
    label: allOk ? "PASS" : `${failCount} FAIL`,
  };
}
