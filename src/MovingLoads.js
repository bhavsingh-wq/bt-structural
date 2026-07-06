// ═══════════════════════════════════════════════════════════════
// PHASE 9 — MOVING LOADS
//
// Computes M(x) and V(x) envelopes for moving concentrated loads
// (vehicle axle groups, crane wheel loads) by sweeping the load
// group across the span and finding the worst-case position for
// each station using influence lines for simply-supported beams.
//
// Supports:
//   1. Standard highway vehicles (AASHTO, NBCC, custom)
//   2. Single crane wheel loads
//   3. User-defined axle groups (any spacing, any load)
//
// Method: Müller-Breslau influence lines for simply-supported beam.
// For each station x and each axle position, compute the ordinate
// of the influence line at each axle position, then sweep the
// vehicle across the span to find the maximum effect.
//
// Reference: AASHTO LRFD §3.6 / NBCC 2015 / PCI DH 8th Ed. §5.7
// ═══════════════════════════════════════════════════════════════

// ── Standard vehicle definitions ──────────────────────────────
// Axles: [{P (kips), offset (ft from front axle)}]
// Dynamic Load Allowance (IM) per AASHTO: 33% for flexure/shear
export const STANDARD_VEHICLES = {
  "AASHTO HL-93 Truck": {
    description: "AASHTO LRFD HL-93 Design Truck (3 axles)",
    axles: [
      { P: 8,  offset: 0  },   // front axle
      { P: 32, offset: 14 },   // drive axle 1
      { P: 32, offset: 28 },   // drive axle 2 (variable 14-30ft, use 14ft worst case)
    ],
    IM: 1.33,   // dynamic load allowance
    code: "AASHTO LRFD §3.6.1.2",
  },
  "AASHTO HL-93 Tandem": {
    description: "AASHTO LRFD HL-93 Tandem (2 axles at 4ft)",
    axles: [
      { P: 25, offset: 0 },
      { P: 25, offset: 4 },
    ],
    IM: 1.33,
    code: "AASHTO LRFD §3.6.1.2",
  },
  "AASHTO HL-93 Lane + Truck": {
    description: "HL-93 truck + 0.64 klf lane load",
    axles: [
      { P: 8,  offset: 0  },
      { P: 32, offset: 14 },
      { P: 32, offset: 28 },
    ],
    lanekplf: 0.64, // kip/ft uniform lane load superimposed
    IM: 1.33,
    code: "AASHTO LRFD §3.6.1.2",
  },
  "NBCC 2015 Truck (CL-625)": {
    description: "Canadian CL-625 design truck",
    axles: [
      { P: 55.5, offset: 0   },
      { P: 80,   offset: 11  },
      { P: 80,   offset: 17  },
      { P: 120,  offset: 23.5},
      { P: 120,  offset: 29  },
    ],
    IM: 1.25,
    code: "NBCC 2015 / CSA S6-19 §3.8",
    unit: "kN → displayed as kips (÷4.448)",
    isMetric: false,
  },
  "Single Crane Wheel": {
    description: "Single concentrated crane wheel load",
    axles: [{ P: 50, offset: 0 }],
    IM: 1.25,
    code: "User-defined",
  },
  "Custom": {
    description: "User-defined axle group",
    axles: [
      { P: 20, offset: 0  },
      { P: 20, offset: 6  },
    ],
    IM: 1.0,
    code: "User-defined",
  },
};

// ── Influence line ordinates for simply-supported beam ─────────
// For bending moment at section x due to unit load at position a:
//   IL_M(x, a) = a(L-x)/L   if a ≤ x
//              = x(L-a)/L   if a > x
// For shear at section x due to unit load at position a:
//   IL_V(x, a) = (L-a)/L × +1  if a < x  (positive zone)
//              = -a/L           if a > x  (negative zone)
// All in ft for positions, kip·ft for moment ordinates.
function IL_moment(xFt, aFt, L) {
  if (aFt <= xFt) return aFt * (L - xFt) / L;
  return xFt * (L - aFt) / L;
}

function IL_shear(xFt, aFt, L) {
  if (aFt < xFt) return (L - aFt) / L;
  if (aFt > xFt) return -aFt / L;
  return 0; // at the section
}

// ── Move vehicle across span, find worst M and V at each station ─
/**
 * Compute the M and V envelopes under a moving load group.
 *
 * @param {Array}  axles  — [{P (kips), offset (ft)}] — offsets from front axle
 * @param {number} span   — beam span (ft)
 * @param {number} IM     — dynamic load allowance factor (1.0 = no amplification)
 * @param {number} nStations — number of stations along span
 * @param {number} lanekplf — optional lane load (kip/ft) added to all positions
 * @returns {object} {stations: [{x, M_max, M_min, V_max, V_min}], Mmax, Vmax}
 */
export function movingLoadEnvelope(axles, span, IM = 1.0, nStations = 51, lanekplf = 0) {
  const L = span;
  const stations = Array.from({ length: nStations }, (_, i) => ({
    x: (i / (nStations - 1)) * L,
    M_max: 0, M_min: 0,
    V_max: 0, V_min: 0,
  }));

  // Axle group extent
  const maxOffset = Math.max(...axles.map(a => a.offset));

  // Sweep the front axle from -(maxOffset) to L (so rear axle exits span)
  const nPositions = 200;
  for (let p = 0; p <= nPositions; p++) {
    const frontPos = -maxOffset + (p / nPositions) * (L + maxOffset);

    for (let si = 0; si < stations.length; si++) {
      const { x } = stations[si];
      let M = 0, V = 0;

      for (const axle of axles) {
        const aPos = frontPos + axle.offset; // axle position on span
        if (aPos < 0 || aPos > L) continue;   // axle off the span — skip
        M += axle.P * IM * IL_moment(x, aPos, L);
        V += axle.P * IM * IL_shear(x, aPos, L);
      }

      // Lane load contribution (applied full length)
      if (lanekplf > 0) {
        // For moment: integrate IL_M over full span = x(L-x)/2L × w × L
        const M_lane = lanekplf * x * (L - x) / (2 * L) * L;
        // For shear: reaction at left support = w×L/2 - w×x, linearly varies
        const V_lane = lanekplf * (L / 2 - x);
        M += M_lane;
        V += V_lane;
      }

      stations[si].M_max = Math.max(stations[si].M_max, M);
      stations[si].M_min = Math.min(stations[si].M_min, M);
      stations[si].V_max = Math.max(stations[si].V_max, V);
      stations[si].V_min = Math.min(stations[si].V_min, V);
    }
  }

  const Mmax = Math.max(...stations.map(s => s.M_max));
  const Vmax = Math.max(...stations.map(s => s.V_max));
  const Mmin = Math.min(...stations.map(s => s.M_min));
  const Vmin = Math.min(...stations.map(s => s.V_min));

  // Find critical position (front axle position for max Mmidspan)
  const midIdx = Math.floor(nStations / 2);
  let critPos = 0, critM = 0;
  for (let p = 0; p <= nPositions; p++) {
    const frontPos = -maxOffset + (p / nPositions) * (L + maxOffset);
    let M = 0;
    for (const axle of axles) {
      const aPos = frontPos + axle.offset;
      if (aPos < 0 || aPos > L) continue;
      M += axle.P * IM * IL_moment(stations[midIdx].x, aPos, L);
    }
    if (M > critM) { critM = M; critPos = frontPos; }
  }

  return { stations, Mmax, Mmin, Vmax, Vmin, critPos };
}

/**
 * Combine moving load results with static dead load envelope.
 * Factored combined envelope: 1.2DL + 1.75LL (AASHTO) or user-specified.
 */
export function combinedEnvelope(staticStations, movingStations, gammaLL = 1.75) {
  return staticStations.map((st, i) => {
    const ml = movingStations[i] || { M_max: 0, V_max: 0 };
    return {
      x: st.x,
      Mu: st.Mu + gammaLL * ml.M_max,
      Vu: Math.abs(st.Vu) + gammaLL * Math.abs(ml.V_max),
    };
  });
}

/**
 * Full Phase 9 runner — returns everything needed for the UI.
 * @param {string} vehicleKey — key from STANDARD_VEHICLES
 * @param {Array}  customAxles — override axles for "Custom" type
 * @param {number} span — ft
 * @param {number} customIM — override IM
 * @param {number} gammaLL — load factor for live load
 * @returns {object} complete moving load analysis
 */
export function runMovingLoad(vehicleKey, customAxles, span, customIM, gammaLL = 1.75) {
  const veh = STANDARD_VEHICLES[vehicleKey] || STANDARD_VEHICLES["Custom"];
  const axles = (vehicleKey === "Custom" && customAxles) ? customAxles : veh.axles;
  const IM = customIM ?? veh.IM ?? 1.0;
  const lanekplf = veh.lanekplf ?? 0;

  const envelope = movingLoadEnvelope(axles, span, IM, 51, lanekplf);

  // Reactions at supports for critical position
  const L = span;
  const critFront = envelope.critPos;
  let Ra = 0, Rb = 0;
  for (const axle of axles) {
    const aPos = critFront + axle.offset;
    if (aPos < 0 || aPos > L) continue;
    const load = axle.P * IM;
    Rb += load * aPos / L;
    Ra += load * (L - aPos) / L;
  }

  return {
    vehicle: veh,
    vehicleKey,
    axles,
    IM,
    gammaLL,
    span,
    envelope,
    critPos: envelope.critPos,
    Ra, Rb,
    Mmax: envelope.Mmax,
    Vmax: envelope.Vmax,
  };
}
