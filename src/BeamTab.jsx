// ═══════════════════════════════════════════════════════════════
// BEAM TAB — Phase 1+2: IT beam, Ledger beam, Double Tee, Box Beam
// PCI 8th Ed. design checks with full Phase 2 loading system.
// ═══════════════════════════════════════════════════════════════
import { useState, useMemo, useEffect } from "react";
import { useLoadingSystem } from "./LoadingSystem";
import { computeIy, runLateralStability } from "./LateralStability";

// ── Helpers (duplicated-lite so BeamTab is self-contained) ──
const fmt = (v, d = 3) => (v == null || isNaN(v) ? "—" : Number(v).toFixed(d));
const REBAR = {
  "#3":{d:0.375,A:0.11},"#4":{d:0.5,A:0.2},"#5":{d:0.625,A:0.31},
  "#6":{d:0.75,A:0.44},"#7":{d:0.875,A:0.6},"#8":{d:1,A:0.79},
  "#9":{d:1.128,A:1},"#10":{d:1.27,A:1.27},"#11":{d:1.41,A:1.56},
};
const MONO = "'JetBrains Mono','Fira Code','Consolas',monospace";

// ═══════════════════════════════════════════════════════════════
// SECTION LIBRARY
// Each entry defines the parametric geometry used to compute A, I, yb, SW.
// Parameters follow standard PCI naming conventions.
// All dimensions in inches. SW = self-weight in plf.
//
// IT BEAM (Inverted Tee): top flange + web + bottom flange.
//   bft=top flange width, tft=top flange thickness, bw=web width,
//   bfb=bottom flange width, tfb=bottom flange thickness, h=total depth
//
// LEDGER BEAM (L-beam): web + ledger shelf on one side.
//   bw=web width, h=total depth, tfl=flange thickness (top),
//   bfl=flange width (top), ledger_w=ledger shelf width,
//   ledger_h=ledger shelf height from bottom
//
// DOUBLE TEE: top flange + two stems (webs).
//   bf=total flange width, tf=flange thickness,
//   bw=one stem width at top, bwb=stem width at bottom,
//   h=total depth, stemSep=center-to-center of two stems
//
// BOX BEAM: solid rectangle with two rectangular voids.
//   b=outer width, h=outer depth, tw=wall thickness (sides),
//   tf_top=top flange thickness, tf_bot=bottom flange thickness
// ═══════════════════════════════════════════════════════════════
export const BEAM_SECTIONS = {
  // ── IT BEAMS (PCI Handbook 8th Ed. Tables 3.6.1) ──
  "IT-24": { type:"it", h:24, bft:16, tft:5,  bw:6,  bfb:20, tfb:6,  fpu:270, wc:150 },
  "IT-28": { type:"it", h:28, bft:16, tft:5,  bw:6,  bfb:22, tfb:6,  fpu:270, wc:150 },
  "IT-32": { type:"it", h:32, bft:16, tft:5,  bw:6,  bfb:24, tfb:6,  fpu:270, wc:150 },
  "IT-36": { type:"it", h:36, bft:20, tft:5,  bw:6,  bfb:24, tfb:7,  fpu:270, wc:150 },
  "IT-40": { type:"it", h:40, bft:20, tft:5,  bw:6,  bfb:26, tfb:7,  fpu:270, wc:150 },
  "IT-48": { type:"it", h:48, bft:24, tft:5,  bw:6,  bfb:28, tfb:8,  fpu:270, wc:150 },

  // ── LEDGER BEAMS (L-beams, PCI Handbook) ──
  "LB-20": { type:"ledger", h:20, bfl:16, tfl:5, bw:8, bfb:16, tfb:5, ledger_w:4, ledger_h:4, fpu:270, wc:150 },
  "LB-24": { type:"ledger", h:24, bfl:16, tfl:5, bw:8, bfb:18, tfb:5, ledger_w:4, ledger_h:4, fpu:270, wc:150 },
  "LB-28": { type:"ledger", h:28, bfl:20, tfl:5, bw:8, bfb:20, tfb:6, ledger_w:5, ledger_h:5, fpu:270, wc:150 },
  "LB-32": { type:"ledger", h:32, bfl:20, tfl:5, bw:8, bfb:22, tfb:6, ledger_w:5, ledger_h:5, fpu:270, wc:150 },

  // ── DOUBLE TEES (PCI Handbook, standard 8ft-wide) ──
  "8DT12": { type:"dt", bf:96, tf:2,  bw:6,  bwb:4, h:12, stemSep:36, fpu:270, wc:150 },
  "8DT16": { type:"dt", bf:96, tf:2,  bw:6,  bwb:4, h:16, stemSep:36, fpu:270, wc:150 },
  "8DT20": { type:"dt", bf:96, tf:2,  bw:6,  bwb:4, h:20, stemSep:36, fpu:270, wc:150 },
  "8DT24": { type:"dt", bf:96, tf:2,  bw:6,  bwb:4, h:24, stemSep:36, fpu:270, wc:150 },
  "8DT28": { type:"dt", bf:96, tf:2.5,bw:7,  bwb:4.5,h:28,stemSep:36, fpu:270, wc:150 },
  "8DT32": { type:"dt", bf:96, tf:2.5,bw:7,  bwb:4.5,h:32,stemSep:36, fpu:270, wc:150 },
  "10DT24":{ type:"dt", bf:120,tf:2,  bw:6,  bwb:4, h:24, stemSep:48, fpu:270, wc:150 },
  "10DT32":{ type:"dt", bf:120,tf:2.5,bw:7,  bwb:4.5,h:32,stemSep:48, fpu:270, wc:150 },

  // ── BOX BEAMS (PCI Handbook, standard widths) ──
  "BX-24": { type:"box", b:36, h:24, tw:5, tf_top:5.5, tf_bot:5.5, fpu:270, wc:150 },
  "BX-28": { type:"box", b:36, h:28, tw:5, tf_top:5.5, tf_bot:5.5, fpu:270, wc:150 },
  "BX-33": { type:"box", b:36, h:33, tw:5, tf_top:5.5, tf_bot:5.5, fpu:270, wc:150 },
  "BX-39": { type:"box", b:48, h:39, tw:5.5,tf_top:5.5,tf_bot:5.5, fpu:270, wc:150 },
  "BX-42": { type:"box", b:48, h:42, tw:5.5,tf_top:5.5,tf_bot:5.5, fpu:270, wc:150 },
};

// ═══════════════════════════════════════════════════════════════
// SECTION PROPERTY CALCULATIONS
// Computes A (in²), Ix (in⁴), yb (in from bottom), bw_eff (in),
// and SW (plf) analytically from the parametric geometry.
// Uses the parallel-axis theorem on rectangular sub-areas.
// ═══════════════════════════════════════════════════════════════
export function computeSection(s) {
  if (s.type === "it") {
    // IT beam: three rectangles stacked — top flange, web, bottom flange
    // Heights from bottom: tfb = bottom flange, (h - tft - tfb) = web, tft = top flange
    const webH = s.h - s.tft - s.tfb;
    const rects = [
      { b: s.bfb, h: s.tfb, yBot: 0 },                     // bottom flange
      { b: s.bw,  h: webH,  yBot: s.tfb },                  // web
      { b: s.bft, h: s.tft, yBot: s.h - s.tft },            // top flange
    ];
    return sectFromRects(rects, s.h, s.wc);
  }
  if (s.type === "ledger") {
    // Ledger beam: similar to IT but asymmetric at bottom (ledger shelf on one side)
    const webH = s.h - s.tfl - s.tfb;
    // The ledger shelf is a protrusion at the bottom; model as two parts:
    // wide bottom = bfb (web width + ledger shelf), narrow above = bfl top flange
    const rects = [
      { b: s.bfb, h: s.tfb,      yBot: 0 },
      { b: s.bw,  h: webH,       yBot: s.tfb },
      { b: s.bfl, h: s.tfl,      yBot: s.h - s.tfl },
    ];
    return sectFromRects(rects, s.h, s.wc);
  }
  if (s.type === "dt") {
    // Double tee: top flange slab + two trapezoidal stems
    // Stems taper from bw at top to bwb at bottom
    // Approximate stems as average-width rectangles for this initial pass
    const stemH = s.h - s.tf;
    const bwAvg = (s.bw + s.bwb) / 2;
    const yBarStem = s.tf + stemH / 2; // centroid of stem from top
    const rects = [
      { b: s.bf, h: s.tf,   yBot: s.h - s.tf },       // top flange (from top)
      { b: bwAvg, h: stemH, yBot: 0, count: 2 },       // two stems
    ];
    // Convert to from-bottom orientation
    const rectsFromBot = [
      { b: bwAvg * 2, h: stemH, yBot: 0 },             // both stems combined
      { b: s.bf,      h: s.tf,  yBot: stemH },          // top flange
    ];
    return sectFromRects(rectsFromBot, s.h, s.wc);
  }
  if (s.type === "box") {
    // Box beam: full rectangle minus two internal voids
    const voidW = (s.b - 2 * s.tw) / 2; // each void width (two voids side by side)
    // Actually standard box beams typically have one or two large rectangular voids
    // Most PCI box beams have two voids side by side
    const voidH = s.h - s.tf_top - s.tf_bot;
    const Agross = s.b * s.h;
    const Avoid = 2 * voidW * voidH;
    const A = Agross - Avoid;
    const ybGross = s.h / 2;
    const ybVoid = s.tf_bot + voidH / 2;
    const IxGross = (s.b * s.h ** 3) / 12 + 0; // bh³/12, centroid at h/2
    // Since voids are symmetric about mid-height, yb stays at h/2
    const IxVoid = 2 * (voidW * voidH ** 3 / 12 + (voidW * voidH) * (ybVoid - ybGross) ** 2);
    const Ix = IxGross - IxVoid;
    const yb = ybGross; // symmetric
    const SW = Math.round(A * s.wc / 144);
    return { A, Ix, yb, bw: 2 * s.tw, SW };
  }
  return { A: 1, Ix: 1, yb: 1, bw: 6, SW: 0 };
}

// Parallel-axis theorem on a list of rectangles; each has {b, h, yBot} (from bottom)
function sectFromRects(rects, totalH, wc) {
  let A = 0, AySum = 0;
  rects.forEach(r => { A += r.b * r.h; AySum += r.b * r.h * (r.yBot + r.h / 2); });
  const yb = AySum / A;
  let Ix = 0;
  rects.forEach(r => {
    const yo = (r.yBot + r.h / 2) - yb;
    Ix += (r.b * r.h ** 3 / 12) + r.b * r.h * yo ** 2;
  });
  const SW = Math.round(A * wc / 144);
  // effective web width = the narrowest piece (web or stem)
  const minBw = rects.reduce((mn, r) => Math.min(mn, r.b), 9999);
  return { A, Ix, yb, bw: minBw, SW };
}

// ═══════════════════════════════════════════════════════════════
// CROSS-SECTION SVG DIAGRAMS
// Accurate 2D line-drawing of each section type with dimensions.
// ═══════════════════════════════════════════════════════════════
function ITBeamXSection({ s, dp, nStrands, yb, scale = 5 }) {
  const sc = scale;
  const { h, bft, tft, bw, bfb, tfb } = s;
  const W = Math.max(bft, bfb) * sc, H = h * sc;
  const pad = 54;
  const svgW = W + pad * 2 + 120, svgH = H + pad * 2 + 50;
  const ox = pad + (W - Math.max(bft, bfb) * sc) / 2;
  const oy = pad + 20;
  const webH = h - tft - tfb;
  const bftX = ox + (Math.max(bft, bfb) - bft) / 2 * sc;
  const bfbX = ox;
  const webX = ox + (Math.max(bft, bfb) - bw) / 2 * sc;

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: "100%", maxWidth: 560, display: "block", margin: "12px auto" }}>
      <rect x={0} y={0} width={svgW} height={svgH} fill="#fff" />
      <text x={svgW / 2} y={18} textAnchor="middle" fontSize={13} fontWeight={800} fill="#212529" fontFamily={MONO}>IT BEAM CROSS-SECTION</text>
      {/* Bottom flange */}
      <rect x={bfbX} y={oy + H - tfb * sc} width={bfb * sc} height={tfb * sc} fill="#d1d5db" stroke="#374151" strokeWidth={2} />
      {/* Web */}
      <rect x={webX} y={oy + tft * sc} width={bw * sc} height={webH * sc} fill="#d1d5db" stroke="#374151" strokeWidth={2} />
      {/* Top flange */}
      <rect x={bftX} y={oy} width={bft * sc} height={tft * sc} fill="#d1d5db" stroke="#374151" strokeWidth={2} />
      {/* Strands */}
      {nStrands > 0 && Array.from({ length: Math.min(nStrands, 8) }).map((_, i) => {
        const xs = bfbX + (bfb * sc) / (Math.min(nStrands, 8) + 1) * (i + 1);
        return <circle key={i} cx={xs} cy={oy + H - (h - dp) * sc} r={5} fill="#dc2626" stroke="#7f1d1d" strokeWidth={1.5} />;
      })}
      {/* yb line */}
      <line x1={bftX - 12} y1={oy + (h - yb) * sc} x2={bftX + bft * sc + 8} y2={oy + (h - yb) * sc} stroke="#2563eb" strokeWidth={1.5} strokeDasharray="6,3" />
      <text x={bftX - 14} y={oy + (h - yb) * sc + 4} textAnchor="end" fontSize={11} fill="#2563eb" fontWeight={700} fontFamily={MONO}>ȳ</text>
      {/* Height dim */}
      <line x1={bftX + bft * sc + 22} y1={oy} x2={bftX + bft * sc + 22} y2={oy + H} stroke="#374151" strokeWidth={1} markerStart="url(#ah)" markerEnd="url(#ah)" />
      <text x={bftX + bft * sc + 34} y={oy + H / 2 + 5} fontSize={13} fontWeight={700} fill="#212529" fontFamily={MONO}>{h}"</text>
      {/* Width dims */}
      <text x={bftX + bft * sc / 2} y={oy - 8} textAnchor="middle" fontSize={11} fill="#495057" fontFamily={MONO}>bft={bft}"</text>
      <text x={bfbX + bfb * sc / 2} y={oy + H + 28} textAnchor="middle" fontSize={11} fill="#495057" fontFamily={MONO}>bfb={bfb}"</text>
      <text x={webX + bw * sc / 2} y={oy + (tft + webH / 2) * sc + 5} textAnchor="middle" fontSize={10} fill="#374151" fontFamily={MONO}>bw={bw}"</text>
      <defs><marker id="ah" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#374151" /></marker></defs>
    </svg>
  );
}

function DoubleTeeXSection({ s, dp, nStrands, yb, scale = 1.2 }) {
  const sc = scale;
  const { bf, tf, bw, bwb, h, stemSep } = s;
  const W = bf * sc, H = h * sc;
  const pad = 40;
  const svgW = W + pad * 2 + 60, svgH = H + pad * 2 + 50;
  const ox = pad, oy = pad + 20;
  const stemH = h - tf;
  const stemCx = [bf / 2 - stemSep / 2, bf / 2 + stemSep / 2]; // centerlines of each stem

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: "100%", maxWidth: 680, display: "block", margin: "12px auto" }}>
      <rect x={0} y={0} width={svgW} height={svgH} fill="#fff" />
      <text x={svgW / 2} y={18} textAnchor="middle" fontSize={13} fontWeight={800} fill="#212529" fontFamily={MONO}>DOUBLE TEE CROSS-SECTION</text>
      {/* Top flange */}
      <rect x={ox} y={oy} width={W} height={tf * sc} fill="#d1d5db" stroke="#374151" strokeWidth={2} />
      {/* Two stems — trapezoids */}
      {stemCx.map((cx, idx) => {
        const x1 = ox + (cx - bw / 2) * sc;
        const x2 = ox + (cx + bw / 2) * sc;
        const x3 = ox + (cx + bwb / 2) * sc;
        const x4 = ox + (cx - bwb / 2) * sc;
        const y1 = oy + tf * sc;
        const y2 = oy + H;
        return <polygon key={idx} points={`${x1},${y1} ${x2},${y1} ${x3},${y2} ${x4},${y2}`} fill="#d1d5db" stroke="#374151" strokeWidth={2} />;
      })}
      {/* Strands */}
      {nStrands > 0 && stemCx.map((cx, idx) => {
        const perStem = Math.ceil(nStrands / 2);
        return Array.from({ length: Math.min(perStem, 4) }).map((_, i) => {
          const strandX = ox + (cx - (bwb * 0.6) / 2 + (bwb * 0.6) * (i / Math.max(perStem - 1, 1))) * sc;
          return <circle key={`${idx}-${i}`} cx={strandX} cy={oy + H - (h - dp) * sc} r={5} fill="#dc2626" stroke="#7f1d1d" strokeWidth={1.5} />;
        });
      })}
      {/* yb line */}
      <line x1={ox - 12} y1={oy + (h - yb) * sc} x2={ox + W + 8} y2={oy + (h - yb) * sc} stroke="#2563eb" strokeWidth={1.5} strokeDasharray="6,3" />
      <text x={ox - 14} y={oy + (h - yb) * sc + 4} textAnchor="end" fontSize={11} fill="#2563eb" fontWeight={700} fontFamily={MONO}>ȳ</text>
      {/* Dims */}
      <line x1={ox} y1={oy + H + 20} x2={ox + W} y2={oy + H + 20} stroke="#374151" strokeWidth={1} />
      <text x={ox + W / 2} y={oy + H + 36} textAnchor="middle" fontSize={11} fill="#495057" fontFamily={MONO}>{bf}"</text>
      <line x1={ox + W + 20} y1={oy} x2={ox + W + 20} y2={oy + H} stroke="#374151" strokeWidth={1} />
      <text x={ox + W + 32} y={oy + H / 2 + 5} fontSize={13} fontWeight={700} fill="#212529" fontFamily={MONO}>{h}"</text>
    </svg>
  );
}

function BoxBeamXSection({ s, dp, nStrands, yb, scale = 4 }) {
  const sc = scale;
  const { b, h, tw, tf_top, tf_bot } = s;
  const W = b * sc, H = h * sc;
  const pad = 44;
  const svgW = W + pad * 2 + 100, svgH = H + pad * 2 + 50;
  const ox = pad, oy = pad + 20;
  const voidW = (b - 2 * tw) / 2;
  const voidH = h - tf_top - tf_bot;

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: "100%", maxWidth: 560, display: "block", margin: "12px auto" }}>
      <rect x={0} y={0} width={svgW} height={svgH} fill="#fff" />
      <text x={svgW / 2} y={18} textAnchor="middle" fontSize={13} fontWeight={800} fill="#212529" fontFamily={MONO}>BOX BEAM CROSS-SECTION</text>
      {/* Outer box */}
      <rect x={ox} y={oy} width={W} height={H} fill="#d1d5db" stroke="#374151" strokeWidth={2} />
      {/* Two voids */}
      {[0, 1].map(i => (
        <rect key={i} x={ox + (tw + i * (voidW + tw)) * sc} y={oy + tf_top * sc} width={voidW * sc} height={voidH * sc} fill="#fff" stroke="#6b7280" strokeWidth={1.5} />
      ))}
      {/* Strands */}
      {nStrands > 0 && Array.from({ length: Math.min(nStrands, 8) }).map((_, i) => {
        const strandX = ox + W / (Math.min(nStrands, 8) + 1) * (i + 1);
        return <circle key={i} cx={strandX} cy={oy + H - (h - dp) * sc} r={5} fill="#dc2626" stroke="#7f1d1d" strokeWidth={1.5} />;
      })}
      {/* yb line */}
      <line x1={ox - 12} y1={oy + (h - yb) * sc} x2={ox + W + 8} y2={oy + (h - yb) * sc} stroke="#2563eb" strokeWidth={1.5} strokeDasharray="6,3" />
      <text x={ox - 14} y={oy + (h - yb) * sc + 4} textAnchor="end" fontSize={11} fill="#2563eb" fontWeight={700} fontFamily={MONO}>ȳ</text>
      {/* Dims */}
      <text x={ox + W / 2} y={oy + H + 32} textAnchor="middle" fontSize={11} fill="#495057" fontFamily={MONO}>{b}"</text>
      <text x={ox + W + 36} y={oy + H / 2 + 5} fontSize={13} fontWeight={700} fill="#212529" fontFamily={MONO}>{h}"</text>
    </svg>
  );
}

function LedgerBeamXSection({ s, dp, nStrands, yb, scale = 5 }) {
  const sc = scale;
  const { h, bfl, tfl, bw, bfb, tfb, ledger_w, ledger_h } = s;
  const W = Math.max(bfl, bfb + ledger_w) * sc, H = h * sc;
  const pad = 50;
  const svgW = W + pad * 2 + 100, svgH = H + pad * 2 + 50;
  const ox = pad;
  const oy = pad + 20;
  const webH = h - tfl - tfb;

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: "100%", maxWidth: 520, display: "block", margin: "12px auto" }}>
      <rect x={0} y={0} width={svgW} height={svgH} fill="#fff" />
      <text x={svgW / 2} y={18} textAnchor="middle" fontSize={13} fontWeight={800} fill="#212529" fontFamily={MONO}>LEDGER BEAM CROSS-SECTION</text>
      {/* Bottom flange */}
      <rect x={ox} y={oy + H - tfb * sc} width={bfb * sc} height={tfb * sc} fill="#d1d5db" stroke="#374151" strokeWidth={2} />
      {/* Ledger shelf — protrudes from one side at bottom zone */}
      <rect x={ox + bw * sc} y={oy + (h - tfb - ledger_h) * sc} width={ledger_w * sc} height={ledger_h * sc} fill="#b0b7c1" stroke="#374151" strokeWidth={1.5} />
      {/* Web */}
      <rect x={ox} y={oy + tfl * sc} width={bw * sc} height={webH * sc} fill="#d1d5db" stroke="#374151" strokeWidth={2} />
      {/* Top flange */}
      <rect x={ox} y={oy} width={bfl * sc} height={tfl * sc} fill="#d1d5db" stroke="#374151" strokeWidth={2} />
      {/* Strands */}
      {nStrands > 0 && Array.from({ length: Math.min(nStrands, 6) }).map((_, i) => {
        const strandX = ox + bfb * sc / (Math.min(nStrands, 6) + 1) * (i + 1);
        return <circle key={i} cx={strandX} cy={oy + H - (h - dp) * sc} r={5} fill="#dc2626" stroke="#7f1d1d" strokeWidth={1.5} />;
      })}
      {/* yb */}
      <line x1={ox - 12} y1={oy + (h - yb) * sc} x2={ox + bfl * sc + 8} y2={oy + (h - yb) * sc} stroke="#2563eb" strokeWidth={1.5} strokeDasharray="6,3" />
      <text x={ox - 14} y={oy + (h - yb) * sc + 4} textAnchor="end" fontSize={11} fill="#2563eb" fontWeight={700} fontFamily={MONO}>ȳ</text>
      {/* Dims */}
      <text x={ox + bfl * sc / 2} y={oy - 6} textAnchor="middle" fontSize={11} fill="#495057" fontFamily={MONO}>bfl={bfl}"</text>
      <text x={ox + bfb * sc / 2} y={oy + H + 28} textAnchor="middle" fontSize={11} fill="#495057" fontFamily={MONO}>bfb={bfb}"</text>
      <text x={ox + bfl * sc + 36} y={oy + H / 2 + 5} fontSize={13} fontWeight={700} fill="#212529" fontFamily={MONO}>{h}"</text>
    </svg>
  );
}

// Chooses the right diagram for the active section
function BeamXSection({ sec, nStrands, dp, yb }) {
  const s = BEAM_SECTIONS[sec];
  if (!s) return null;
  if (s.type === "it")     return <ITBeamXSection     s={s} dp={dp} nStrands={nStrands} yb={yb} />;
  if (s.type === "dt")     return <DoubleTeeXSection  s={s} dp={dp} nStrands={nStrands} yb={yb} />;
  if (s.type === "box")    return <BoxBeamXSection    s={s} dp={dp} nStrands={nStrands} yb={yb} />;
  if (s.type === "ledger") return <LedgerBeamXSection s={s} dp={dp} nStrands={nStrands} yb={yb} />;
  return null;
}

// ═══════════════════════════════════════════════════════════════
// SECTION TYPE GROUPER — for the section picker dropdown
// ═══════════════════════════════════════════════════════════════
const TYPE_LABELS = { it:"IT Beam (Inverted Tee)", ledger:"Ledger Beam (L-Beam)", dt:"Double Tee", box:"Box Beam" };

// ═══════════════════════════════════════════════════════════════
// MAIN BEAM TAB COMPONENT
// Full PCI 8th Ed. design engine: same structure as PCITab but
// works on the parametric beam sections defined above.
// ═══════════════════════════════════════════════════════════════
export function BeamTab() {
  // ── Section selection ──
  const [sec, setSec] = useState("IT-32");
  const s = BEAM_SECTIONS[sec];
  const sp = useMemo(() => computeSection(s), [sec]);

  // ── Material inputs ──
  const [fc, setFc] = useState(5);          // ksi, 28-day
  const [fci, setFci] = useState(3.5);      // ksi, at release
  const [cover, setCover] = useState(2);    // in, clear cover to strands

  // ── Prestressing ──
  const [nStrands, setNStrands] = useState(8);
  const [strandSz, setStrandSz] = useState("0.5");  // "0.5" or "0.6" inch
  const [fpiR, setFpiR] = useState(0.75);            // fpi/fpu ratio
  const [RH, setRH] = useState(70);

  // ── Mild reinforcement ──
  const [nRe, setNRe] = useState(0);
  const [reSz, setReSz] = useState("#5");

  // ── Loading (Phase 2) ──
  const [span, setSpan] = useState(40);     // ft
  const ls = useLoadingSystem({ span });
  // ls.Mu = factored Mu (kip-ft), ls.Vu = factored Vu (kips) from active combo

  // ── Chart state ──
  const [chartType, setChartType] = useState("section");

  // ── Derived strand properties ──
  const strandArea = strandSz === "0.6" ? 0.217 : 0.153; // in²/strand
  const fpu = s.fpu || 270; // ksi
  const Eps = 28500; // ksi

  // ═══════════════════════════════════════════════
  // CORE CALCULATION
  // ═══════════════════════════════════════════════
  const r = useMemo(() => {
    const { A, Ix, yb, bw, SW } = sp;
    const Sb = Ix / yb;
    const St = Ix / (s.h - yb);
    const Ec = Math.round(57 * Math.sqrt(fc * 1000));
    const Eci = Math.round(57 * Math.sqrt(fci * 1000));
    const b1 = Math.max(0.65, 0.85 - 0.05 * (fc - 4));
    const VS = A / (2 * (sp.bw + s.h)); // volume-to-surface ratio

    // Strand geometry
    const Aps = nStrands * strandArea;
    const fpi = fpiR * fpu;
    const dp = s.h - cover;
    const e = yb - cover; // eccentricity

    // Mild steel
    const As = nRe * (REBAR[reSz]?.A || 0);
    const fy = 60;

    // Self-weight (always computed from section regardless of loading system)
    const wSW = SW;                                   // plf
    const Mg = wSW * span ** 2 / 8 / 12;             // kip-in, self-weight only

    // Factored demand from Phase 2 loading system (kip-ft from active combo)
    const MuKft = ls.Mu;                              // kip-ft, factored
    const Mu = MuKft * 12;                            // kip-in for stress calcs
    const VuFactored = ls.Vu;                         // kips, factored

    // Service moment estimate for stress checks (use unfactored Mmax from service combo)
    // For now approximate as Mu/1.4 (conservative) until we wire service combo separately
    const Mserv = Mu / 1.4;
    const Msus  = Mg + Mserv * 0.5; // rough sustained moment estimate

    // ── PRESTRESS FORCE ──
    const Pi = fpi * Aps;
    const Po = 0.95 * Pi;  // approx initial (post-anchor seating)

    // ── TRANSFER STRESSES ──
    const tTop  = -Po / A + Po * e * (s.h - yb) / Ix - Mg * (s.h - yb) / Ix;
    const tBot  = -Po / A - Po * e * yb / Ix + Mg * yb / Ix;

    // ── PRESTRESS LOSSES (PCI simplified) ──
    const Eci_psi = Eci;
    const fcir = Po / A + Po * e ** 2 / Ix - Mg * e / Ix;
    const ES = Eps / Eci_psi * fcir;
    const Msd = Mserv * 0.3; // superimposed dead load moment estimate for CR calc
    const fcds = Msd * e / Ix;
    const CR = 12 * fcir - 7 * fcds;  // PCI simplified
    const SHv = 17000 - 150 * RH;     // psi → ksi after /1000
    const SH = SHv / 1000;
    const RE_ratio = 0.05;
    const RE = RE_ratio * (fpi - ES - 0.5 * (CR + SH));
    const totalLossKsi = ES + CR + SH + RE;
    const totalLossPct = totalLossKsi / fpi * 100;
    const fpe = fpi - totalLossKsi;
    const Pe = fpe * Aps;

    // ── SERVICE STRESSES (ACI Class U) ──
    const nMtop = -Pe / A + Pe * e * (s.h - yb) / Ix - Mserv * (s.h - yb) / Ix;
    const nMbot = -Pe / A - Pe * e * yb / Ix + Mserv * yb / Ix;
    const aTens = -7.5 * Math.sqrt(fc * 1000) / 1000;   // ksi, Class U tension limit
    const aComp = -0.45 * fc;                             // ksi, sustained compression limit
    const classU = nMbot >= aTens;
    const compOk = nMtop <= Math.abs(aComp);

    // ── FLEXURAL STRENGTH (Method #1, PCI §5.2) ──
    const bwEff = sp.bw;
    const rhoP = Aps / (bwEff * dp);
    const fps1 = fpu * (1 - (0.28 * rhoP * (fpu / (b1 * fc))));
    const a1 = (Aps * fps1 + As * fy) / (0.85 * fc * bwEff);
    const eT1 = 0.003 * (dp - a1 / b1) / (a1 / b1);
    const phi1 = eT1 >= 0.005 ? 0.9 : 0.65 + (eT1 - 0.002) * 250 / 3;
    const phiMn1 = phi1 * (Aps * fps1 * (dp - a1 / 2) + As * fy * (dp - a1 / 2)) / 12;

    // ── SHEAR ──
    const Vu = VuFactored;
    const VcS = (1.7 * Math.sqrt(fc * 1000) / 1000) * bwEff * dp;
    const shearOk = phi1 * VcS >= Vu;

    // ── DEFLECTION / CAMBER ──
    const cI  = Pi * e * span ** 2 * 144 / (8 * Eci * Ix);
    const dSW = 5 * wSW / 12000 * (span * 12) ** 4 / (384 * Eci * Ix);
    const cE  = 1.80 * cI - 1.85 * dSW;
    const cF  = 2.45 * cI - 2.70 * dSW;
    const dSDL = 5 * (Mserv * 0.3 * 12) / Ix / (span * 12 / 5); // rough estimate
    const dLL  = 5 * (Mserv * 0.5 * 12) / Ix / (span * 12 / 5);
    const netCamber = cF - dSDL;
    const finalPos  = cF - dSDL - dLL;

    const flexOk = phiMn1 >= MuKft;
    const allOk = classU && compOk && flexOk;
    const flexUtil = MuKft / Math.max(phiMn1, 0.001);

    return {
      A, Ix, yb, Sb, St, Ec, Eci, b1, VS, Aps, fpi, fpu, Eps, dp, e, As, fy,
      wSW, Mu, MuKft, Mg,
      Pi, Po, tTop, tBot,
      ES, CR, SH, SHv, RE, totalLossKsi, totalLossPct, fpe, Pe,
      Msus, Mserv, nMtop, nMbot, aTens, aComp, classU, compOk,
      fps1, a1, eT1, phiMn1,
      Vu, VcS, shearOk,
      cI, dSW, cE, cF, dSDL, dLL, netCamber, finalPos,
      flexOk, allOk, flexUtil,
    };
  }, [sec, fc, fci, cover, nStrands, strandSz, fpiR, RH, nRe, reSz, span, ls.Mu, ls.Vu]);

  // ── Minimal UI helpers (standalone, no context deps) ──
  const iS = { padding: "5px 8px", border: "1px solid #ced4da", borderRadius: 3, fontSize: 12, fontFamily: MONO, width: "100%", boxSizing: "border-box" };
  const OI = ({ label, value, onChange, unit, options, step }) => (
    <div style={{ display: "inline-flex", flexDirection: "column", minWidth: 115, flex: 1 }}>
      <span style={{ fontSize: 10, color: "#6c757d", fontWeight: 600, marginBottom: 2, letterSpacing: 0.5 }}>{label}</span>
      {options ? (
        <select value={value} onChange={e => onChange(e.target.value)} style={{ ...iS, background: "#fff8ef", border: "2px solid #e8a838" }}>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <input type="number" value={value} step={step || 1} onChange={e => onChange(Number(e.target.value))} style={{ ...iS, background: "#fff8ef", border: "2px solid #e8a838" }} />
          {unit && <span style={{ fontSize: 10, color: "#868e96", whiteSpace: "nowrap" }}>{unit}</span>}
        </div>
      )}
    </div>
  );
  const CI = ({ label, value, unit }) => (
    <div style={{ display: "inline-flex", flexDirection: "column", minWidth: 110, flex: 1 }}>
      <span style={{ fontSize: 10, color: "#adb5bd", fontWeight: 600, marginBottom: 2, letterSpacing: 0.5 }}>{label}</span>
      <div style={{ ...iS, background: "#f8f9fa", border: "1px solid #dee2e6", color: "#495057" }}>{value}{unit && <span style={{ fontSize: 10, color: "#adb5bd", marginLeft: 3 }}>{unit}</span>}</div>
    </div>
  );
  const Res = ({ label, value, unit }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "4px 0", borderBottom: "1px solid #f1f3f5", fontSize: 12 }}>
      <span style={{ color: "#495057", fontFamily: MONO }}>{label}</span>
      <span style={{ fontWeight: 700, color: "#212529", fontFamily: MONO }}>{value}{unit && <span style={{ fontSize: 10, color: "#868e96", marginLeft: 3 }}>{unit}</span>}</span>
    </div>
  );
  const Check = ({ label, ok, left, right, unit }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 8px", marginBottom: 4, background: ok ? "#f0fdf4" : "#fef2f2", border: `1px solid ${ok ? "#bbf7d0" : "#fecaca"}`, borderRadius: 4, fontSize: 12 }}>
      <span style={{ fontFamily: MONO, color: ok ? "#14532d" : "#7f1d1d", fontWeight: 600 }}>{label}</span>
      <span style={{ fontFamily: MONO, color: ok ? "#166534" : "#991b1b" }}>
        {left} {unit} {ok ? "≤" : ">"} {right} {unit}
        <span style={{ marginLeft: 8, fontWeight: 800, fontSize: 11, background: ok ? "#22c55e" : "#ef4444", color: "#fff", padding: "1px 7px", borderRadius: 3 }}>{ok ? "PASS" : "FAIL"}</span>
      </span>
    </div>
  );
  const Row = ({ children }) => <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>{children}</div>;
  const Card = ({ title, children }) => (
    <div style={{ background: "#fff", border: "1px solid #dee2e6", borderLeft: "4px solid #0ea5e9", borderRadius: 4, marginBottom: 14, overflow: "hidden" }}>
      {title && <div style={{ padding: "7px 14px", background: "#f0f9ff", borderBottom: "1px solid #bae6fd", fontWeight: 700, fontSize: 12, fontFamily: MONO, textTransform: "uppercase", letterSpacing: 0.8, color: "#0c4a6e" }}>{title}</div>}
      <div style={{ padding: "10px 14px" }}>{children}</div>
    </div>
  );
  const SH = ({ children }) => (
    <div style={{ margin: "16px 0 6px", padding: "4px 0", borderBottom: "2px solid #0ea5e9", fontWeight: 800, fontSize: 13, textTransform: "uppercase", letterSpacing: 1, color: "#0c4a6e" }}>{children}</div>
  );
  const Eq = ({ tex, code }) => (
    <div style={{ margin: "4px 0", padding: "5px 10px", background: "#f0f9ff", borderLeft: "3px solid #bae6fd", borderRadius: "0 3px 3px 0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12 }}>
      <span style={{ fontFamily: MONO, color: "#0c4a6e" }}>{tex}</span>
      {code && <span style={{ fontSize: 10, color: "#fff", background: "#0369a1", padding: "2px 8px", borderRadius: 3, fontFamily: MONO, whiteSpace: "nowrap", fontWeight: 700 }}>{code}</span>}
    </div>
  );

  // Status banner
  const statusOk = r.allOk;
  const util = Math.min(r.flexUtil * 100, 140);
  const barColor = r.flexUtil <= 0.7 ? "#22c55e" : r.flexUtil <= 1.0 ? "#f59e0b" : "#ef4444";

  // Section picker grouped by type
  const sectionsByType = Object.entries(BEAM_SECTIONS).reduce((acc, [k, v]) => {
    if (!acc[v.type]) acc[v.type] = [];
    acc[v.type].push(k);
    return acc;
  }, {});

  return (
    <div>
      {/* Status banner */}
      <div style={{ marginBottom: 12, padding: "10px 14px", background: statusOk ? "#f0fdf4" : "#fef2f2", border: `1px solid ${statusOk ? "#bbf7d0" : "#fecaca"}`, borderRadius: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, fontFamily: MONO, color: statusOk ? "#14532d" : "#7f1d1d" }}>
            FLEXURAL UTILIZATION (Mu / ΦMn)
          </span>
          <span style={{ fontSize: 13, fontWeight: 800, fontFamily: MONO, color: statusOk ? "#16a34a" : "#dc2626" }}>
            {statusOk ? "✓ DESIGN OK" : "✗ OVERSTRESSED"} — {fmt(r.flexUtil, 3)}
          </span>
        </div>
        <div style={{ height: 8, background: "#e5e7eb", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.min(util, 100)}%`, background: barColor, borderRadius: 4, transition: "width 0.3s" }} />
        </div>
      </div>

      {/* Section + material inputs */}
      <Card title="Section Selection">
        <Row>
          <div style={{ display: "inline-flex", flexDirection: "column", minWidth: 180, flex: 2 }}>
            <span style={{ fontSize: 10, color: "#6c757d", fontWeight: 600, marginBottom: 2, letterSpacing: 0.5 }}>Section</span>
            <select value={sec} onChange={e => setSec(e.target.value)} style={{ ...iS, background: "#fff8ef", border: "2px solid #e8a838" }}>
              {Object.entries(sectionsByType).map(([type, keys]) => (
                <optgroup key={type} label={TYPE_LABELS[type] || type}>
                  {keys.map(k => <option key={k} value={k}>{k}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <CI label="Type" value={TYPE_LABELS[s.type] || s.type} />
          <CI label="A" value={fmt(sp.A, 1)} unit="in²" />
          <CI label="Ix" value={fmt(sp.Ix, 0)} unit="in⁴" />
        </Row>
        <Row>
          <CI label="yb" value={fmt(sp.yb, 3)} unit="in" />
          <CI label="yt" value={fmt(s.h - sp.yb, 3)} unit="in" />
          <CI label="Sb" value={fmt(sp.Ix / sp.yb, 1)} unit="in³" />
          <CI label="St" value={fmt(sp.Ix / (s.h - sp.yb), 1)} unit="in³" />
          <CI label="SW" value={sp.SW} unit="plf" />
        </Row>

        {/* Cross-section diagram */}
        <BeamXSection sec={sec} nStrands={nStrands} dp={r.dp} yb={sp.yb} />
      </Card>

      <Card title="Concrete Properties">
        <Eq tex="Ec = 57√(f′c × 1000)" code="ACI 318-19 §19.2.2.1" />
        <Eq tex="β₁ = 0.85 − 0.05(f′c − 4) ≥ 0.65" code="ACI 318-19 §22.2.2.4.3" />
        <Row>
          <OI label="f′c" value={fc} onChange={setFc} unit="ksi" step={0.5} />
          <OI label="f′ci" value={fci} onChange={setFci} unit="ksi" step={0.5} />
          <OI label="Cover" value={cover} onChange={setCover} unit="in" step={0.5} />
          <OI label="RH" value={RH} onChange={setRH} unit="%" />
        </Row>
        <Row>
          <CI label="Ec" value={fmt(r.Ec, 0)} unit="ksi" />
          <CI label="Eci" value={fmt(r.Eci, 0)} unit="ksi" />
          <CI label="β₁" value={fmt(r.b1, 3)} />
          <CI label="V/S" value={fmt(r.VS, 3)} unit="in" />
        </Row>
      </Card>

      <Card title="Prestressing Steel">
        <Eq tex="fpi = (fpi/fpu) × fpu   e = yb − cover   dp = h − cover" code="PCI 8th §4.2" />
        <Row>
          <OI label="# Strands" value={nStrands} onChange={setNStrands} step={1} />
          <OI label="Strand Size" value={strandSz} onChange={setStrandSz} options={["0.5", "0.6"]} />
          <OI label="fpi/fpu" value={fpiR} onChange={setFpiR} step={0.01} />
        </Row>
        <Row>
          <CI label="Aps" value={fmt(r.Aps, 4)} unit="in²" />
          <CI label="fpi" value={fmt(r.fpi, 1)} unit="ksi" />
          <CI label="dp" value={fmt(r.dp, 2)} unit="in" />
          <CI label="e" value={fmt(r.e, 3)} unit="in" />
        </Row>
      </Card>

      <Card title="Span & Loading (Phase 2)">
        <div style={{ marginBottom: 8 }}>
          <OI label="Span" value={span} onChange={setSpan} unit="ft" />
          <div style={{ marginTop: 4, fontSize: 10, color: "#6c757d", fontFamily: MONO }}>
            SW = {r.wSW} plf (auto) · Mᵤ = {fmt(r.MuKft, 2)} kip-ft · Vᵤ = {fmt(r.Vu, 2)} kips
          </div>
        </div>
        {ls.LoadManagerUI}
      </Card>

      <SH>Transfer Stresses</SH>
      <Card title="Stresses at Release">
        <Eq tex="ft = −Pi/A ± Pi·e·yt/Ix − Mg·yt/Ix" code="PCI 8th §4.3" />
        <Eq tex="fb = −Pi/A ∓ Pi·e·yb/Ix + Mg·yb/Ix" />
        <Row>
          <CI label="Pi" value={fmt(r.Pi, 2)} unit="kip" />
          <CI label="Top stress" value={fmt(r.tTop, 4)} unit="ksi" />
          <CI label="Bot stress" value={fmt(r.tBot, 4)} unit="ksi" />
        </Row>
        <div style={{ marginTop: 8 }}>
          <Check label="Tension @ top" ok={r.tTop >= -6 * Math.sqrt(fci * 1000) / 1000} left={fmt(r.tTop, 4)} right={fmt(-6 * Math.sqrt(fci * 1000) / 1000, 4)} unit="ksi" />
          <Check label="Compression @ bot" ok={Math.abs(r.tBot) <= 0.6 * fci} left={fmt(Math.abs(r.tBot), 4)} right={fmt(0.6 * fci, 4)} unit="ksi" />
        </div>
      </Card>

      <SH>Loss of Prestress</SH>
      <Card title="Prestress Losses">
        <Eq tex="ES = (Eps/Eci) × fcir" code="PCI 8th §4.7.2" />
        <Eq tex="CR = 12·fcir − 7·fcds" code="PCI simplified" />
        <Eq tex="SH = (17000 − 150·RH) / 1000" code="PCI 8th §4.7.3" />
        <Row>
          <CI label="ES" value={fmt(r.ES, 3)} unit="ksi" />
          <CI label="CR" value={fmt(r.CR, 3)} unit="ksi" />
          <CI label="SH" value={fmt(r.SH, 3)} unit="ksi" />
          <CI label="RE" value={fmt(r.RE, 3)} unit="ksi" />
        </Row>
        <Row>
          <CI label="Total Loss" value={fmt(r.totalLossKsi, 3)} unit="ksi" />
          <CI label="Loss %" value={fmt(r.totalLossPct, 1)} unit="%" />
          <CI label="fpe" value={fmt(r.fpe, 1)} unit="ksi" />
          <CI label="Pe" value={fmt(r.Pe, 2)} unit="kip" />
        </Row>
      </Card>

      <SH>Service Load Stresses</SH>
      <Card title="Final Service Stresses (ACI Class U)">
        <Eq tex="ft = −Pe/A + Pe·e·yt/Ix − M·yt/Ix" code="ACI 318-19 §24.5" />
        <Row>
          <CI label="Top stress" value={fmt(r.nMtop, 4)} unit="ksi" />
          <CI label="Bot stress" value={fmt(r.nMbot, 4)} unit="ksi" />
          <CI label="Allow. tens." value={fmt(r.aTens, 4)} unit="ksi" />
          <CI label="Allow. comp." value={fmt(r.aComp, 4)} unit="ksi" />
        </Row>
        <div style={{ marginTop: 8 }}>
          <Check label="Bot tension (Class U)" ok={r.classU} left={fmt(r.nMbot, 4)} right={fmt(r.aTens, 4)} unit="ksi" />
          <Check label="Top compression" ok={r.compOk} left={fmt(Math.abs(r.nMtop), 4)} right={fmt(Math.abs(r.aComp), 4)} unit="ksi" />
        </div>
      </Card>

      <SH>Flexural Strength</SH>
      <Card title="Design Flexural Strength">
        <Eq tex="fps = fpu(1 − (γp/β₁)(ρp·fpu/f′c))" code="ACI 318-19 §22.3.2" />
        <Eq tex="ΦMn = Φ·Aps·fps·(dp − a/2)" code="ACI 318-19 §22.3" />
        <Row>
          <CI label="fps" value={fmt(r.fps1, 2)} unit="ksi" />
          <CI label="a" value={fmt(r.a1, 3)} unit="in" />
          <CI label="εt" value={fmt(r.eT1, 5)} />
          <CI label="ΦMn" value={fmt(r.phiMn1, 2)} unit="kip-ft" />
          <CI label="Mu" value={fmt(r.MuKft, 2)} unit="kip-ft" />
        </Row>
        <Check label="Flexural Strength" ok={r.flexOk} left={fmt(r.MuKft, 2)} right={fmt(r.phiMn1, 2)} unit="kip-ft" />
      </Card>

      <SH>Shear Strength</SH>
      <Card title="Shear (Simplified)">
        <Eq tex="Vc = 1.7√(f′c)·bw·dp" code="ACI 318-19 §22.5 (simplified)" />
        <Row>
          <CI label="bw" value={sp.bw} unit="in" />
          <CI label="dp" value={fmt(r.dp, 2)} unit="in" />
          <CI label="Vc" value={fmt(r.VcS, 2)} unit="kips" />
          <CI label="Vu" value={fmt(r.Vu, 2)} unit="kips" />
        </Row>
        <Check label="Shear Strength (at L/4)" ok={r.shearOk} left={fmt(r.Vu, 2)} right={fmt(r.VcS, 2)} unit="kips" />
      </Card>

      <SH>Camber & Deflection</SH>
      <Card title="Camber Estimates (PCI multiplier method)">
        <Eq tex="Δ_i = Pi·e·L² / (8·Eci·Ix)" code="PCI 8th Table 4.8.4" />
        <Row>
          <CI label="Initial camber" value={fmt(r.cI, 3)} unit="in" />
          <CI label="Erection camber" value={fmt(r.cE, 3)} unit="in" />
          <CI label="Final camber" value={fmt(r.cF, 3)} unit="in" />
        </Row>
        <Row>
          <CI label="SDL deflection" value={fmt(r.dSDL, 3)} unit="in" />
          <CI label="LL deflection" value={fmt(r.dLL, 3)} unit="in" />
          <CI label="Net camber" value={fmt(r.netCamber, 3)} unit="in" />
          <CI label="Final position" value={fmt(r.finalPos, 3)} unit="in" />
        </Row>
        <div style={{ marginTop: 8, padding: "8px 10px", background: "#f8f9fa", borderRadius: 4, fontSize: 11, color: "#495057" }}>
          <b>L/360 limit:</b> {fmt(span * 12 / 360, 2)} in &nbsp;·&nbsp;
          <b>L/240 limit:</b> {fmt(span * 12 / 240, 2)} in
        </div>
      </Card>

      <SH>Summary</SH>
      <Card title="Design Summary">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[
            { label: "Transfer stresses",  ok: r.tTop >= -6 * Math.sqrt(fci * 1000) / 1000 && Math.abs(r.tBot) <= 0.6 * fci },
            { label: "Service tension (Class U)", ok: r.classU },
            { label: "Service compression", ok: r.compOk },
            { label: "Flexural strength",   ok: r.flexOk },
            { label: "Shear strength",      ok: r.shearOk },
          ].map(({ label, ok }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: ok ? "#f0fdf4" : "#fef2f2", borderRadius: 4, border: `1px solid ${ok ? "#bbf7d0" : "#fecaca"}` }}>
              <span style={{ fontSize: 16 }}>{ok ? "✅" : "❌"}</span>
              <span style={{ fontSize: 12, fontWeight: 600, fontFamily: MONO, color: ok ? "#14532d" : "#7f1d1d" }}>{label}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
