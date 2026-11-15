import type { CSSProperties } from "react";

/*
 * Printed (SVG) version of the agent factory: shown while the 3D chunk loads
 * and whenever WebGL2 is unavailable. Pure tokens, so it follows the theme.
 */

const X = [210, 450, 690, 930];
const ACCENT = ["var(--cobalt)", "var(--orange)", "var(--mustard)", "var(--green)"];
const ON = ["var(--on-cobalt)", "var(--on-orange)", "var(--on-mustard)", "var(--on-green)"];
const KRAFT: CSSProperties = { fill: "color-mix(in srgb, var(--mustard) 42%, var(--panel))" };
const INK = { stroke: "var(--line)", strokeWidth: 3, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

function Crate({ x, label, band, check, stamp }: { x: number; label: string; band?: boolean; check?: boolean; stamp?: boolean }) {
  return (
    <g transform={`translate(${x - 30} 212)`}>
      <rect width="60" height="50" rx="6" style={KRAFT} {...INK} />
      <rect x="12" y="14" width="36" height="14" rx="3" fill="var(--panel)" {...INK} strokeWidth={2} />
      <text x="30" y="24.5" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="8" fontWeight="800" fill="var(--ink)">
        {label}
      </text>
      {band && <rect x="-1" y="36" width="62" height="7" fill="var(--cobalt)" {...INK} strokeWidth={2} />}
      {stamp && (
        <>
          <rect x="22" y="-2" width="16" height="54" fill="var(--green)" {...INK} strokeWidth={2} />
          <text x="30" y="-8" textAnchor="middle" fontSize="13" fontWeight="900" fill="var(--red-text)" transform="rotate(-8 30 -8)">
            PR
          </text>
        </>
      )}
      {check && (
        <g transform="translate(30 -26)">
          <circle r="12" fill="var(--green)" {...INK} />
          <path d="M-5 0l3.5 3.5L5.5-4" fill="none" stroke="var(--on-green)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
    </g>
  );
}

export function FactoryFallback({ label, note, className }: { label: string; note?: string; className?: string }) {
  const names = ["TODO", "DOING", "REVIEW", "DONE"];
  return (
    <figure className={className}>
      <svg viewBox="0 0 1200 420" role="img" aria-label={label} className="h-auto w-full">
        {/* slab + hard offset shadow */}
        <rect x="48" y="318" width="1120" height="64" rx="18" fill="var(--shadow-ink)" />
        <rect x="40" y="310" width="1120" height="64" rx="18" fill="var(--panel)" {...INK} />
        {X.map((x, i) => (
          <text key={i} x={x} y="348" textAnchor="middle" fontSize="15" fontWeight="800" fill="var(--ink)">
            {`0${i + 1}  ${names[i]}`}
          </text>
        ))}

        {/* signs */}
        {X.map((x, i) => (
          <g key={i}>
            <line x1={x} y1="72" x2={x} y2="300" stroke="var(--ink-3)" strokeWidth="4" />
            <rect x={x - 62} y="30" width="124" height="46" rx="10" fill={ACCENT[i]} {...INK} />
            <text x={x} y="60" textAnchor="middle" fontSize="20" fontWeight="800" fill={ON[i]}>
              {names[i]}
            </text>
          </g>
        ))}

        {/* belt */}
        <rect x="104" y="264" width="900" height="22" rx="11" fill="var(--ink-2)" {...INK} />
        {Array.from({ length: 30 }, (_, i) => (
          <line key={i} x1={122 + i * 29} y1="268" x2={122 + i * 29} y2="282" stroke="var(--panel)" strokeOpacity="0.35" strokeWidth="3" />
        ))}
        {[150, 400, 650, 900].map((x) => (
          <rect key={x} x={x} y="286" width="10" height="24" fill="var(--ink-3)" {...INK} strokeWidth={2} />
        ))}

        {/* 01 hopper */}
        <rect x={X[0] - 6} y="96" width="12" height="40" fill="var(--ink-3)" />
        <path d={`M${X[0] - 58} 132 h116 l-24 44 h-68 z`} fill="var(--cobalt)" {...INK} />
        <Crate x={X[0]} label="CLF-96" />

        {/* 02 arm */}
        <g>
          <rect x={X[1] - 74} y="226" width="44" height="14" rx="4" fill="var(--ink-3)" {...INK} />
          <path d={`M${X[1] - 52} 228 L${X[1] - 40} 150 L${X[1] + 2} 168`} fill="none" stroke="var(--line)" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
          <path d={`M${X[1] - 52} 228 L${X[1] - 40} 150 L${X[1] + 2} 168`} fill="none" stroke="var(--orange)" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={X[1] - 40} cy="150" r="13" fill="var(--mustard)" {...INK} />
          <rect x={X[1] - 16} y="166" width="36" height="24" rx="7" fill="var(--panel)" {...INK} />
          <rect x={X[1] - 10} y="172" width="24" height="8" rx="2" fill="var(--ink)" />
          <circle cx={X[1] - 3} cy="176" r="2" fill="var(--mustard)" />
          <circle cx={X[1] + 7} cy="176" r="2" fill="var(--mustard)" />
          <path d={`M${X[1] - 4} 190 l4 14 l4 -14 z`} fill="var(--ink-3)" {...INK} strokeWidth={2} />
          {[[-16, -8], [14, -10], [-8, -18], [20, 2], [-20, 4]].map(([dx, dy], i) => (
            <line key={i} x1={X[1]} y1="206" x2={X[1] + dx} y2={206 + dy} stroke={i % 2 ? "var(--orange)" : "var(--mustard)"} strokeWidth="3" strokeLinecap="round" />
          ))}
        </g>
        <Crate x={X[1]} label="CLF-94" band />

        {/* 03 scanner (cantilever from behind the belt) */}
        <path d={`M${X[2] + 46} 262 V118 H${X[2] - 22}`} fill="none" stroke="var(--line)" strokeWidth="15" strokeLinejoin="round" />
        <path d={`M${X[2] + 46} 262 V118 H${X[2] - 22}`} fill="none" stroke="var(--mustard)" strokeWidth="9" strokeLinejoin="round" />
        <line x1={X[2] - 2} y1="122" x2={X[2] - 2} y2="150" stroke="var(--ink-3)" strokeWidth="4" />
        <circle cx={X[2] - 2} cy="166" r="17" fill="var(--cobalt)" fillOpacity="0.3" {...INK} strokeWidth={5} />
        <Crate x={X[2]} label="CLF-91" band check />

        {/* 04 stamp */}
        <path d={`M${X[3] - 70} 262 V112 H${X[3] + 6}`} fill="none" stroke="var(--line)" strokeWidth="17" strokeLinejoin="round" />
        <path d={`M${X[3] - 70} 262 V112 H${X[3] + 6}`} fill="none" stroke="var(--green)" strokeWidth="11" strokeLinejoin="round" />
        <rect x={X[3] - 4} y="112" width="8" height="36" fill="var(--ink-3)" />
        <rect x={X[3] - 30} y="146" width="60" height="16" rx="4" fill="var(--green)" {...INK} />
        <rect x={X[3] - 27} y="162" width="54" height="5" fill="var(--red)" />
        <Crate x={X[3]} label="CLF-88" band stamp />

        {/* ramp + bin */}
        <path d="M1004 276 L1036 294" stroke="var(--ink-3)" strokeWidth="8" strokeLinecap="round" />
        <path d="M1030 250 V306 H1130 V250" fill="var(--sunken)" {...INK} />
        <rect x="1026" y="246" width="108" height="8" rx="3" fill="var(--green)" {...INK} strokeWidth={2} />
      </svg>
      {note && <figcaption className="t-label mt-2 text-center">{note}</figcaption>}
    </figure>
  );
}
