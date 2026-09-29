import { scaleLinear } from "d3";
import { useId } from "react";
import { viewColor } from "@/lib/viewColors";
import type { NormDocument } from "./normAuthoring";
import type { LayerPriorityProfile } from "./layerPriorityProfiles";

export function LayerPriorityDotPlot({ layers, profiles, benchmark, onLayer }: {
  layers: NonNullable<NormDocument["layers"]>; profiles: LayerPriorityProfile[]; benchmark?: string;
  onLayer: (id: string) => void;
}) {
  const id = useId();
  const x = scaleLinear().domain([0, 1]).range([230, 700]);
  const rowHeight = 52, height = layers.length * rowHeight + 48;
  return <div className="overflow-x-auto" role="region" aria-label="Compare priorities on one scale" tabIndex={0}>
    <svg viewBox={`0 0 740 ${height}`} className="w-full min-w-[620px]" role="group" aria-labelledby={`${id}-title`}>
      <title id={`${id}-title`}>Normalized layer priorities</title>
      {[0, .25, .5, .75, 1].map(tick => <g key={tick}><line x1={x(tick)} x2={x(tick)} y1={28} y2={height - 15} stroke="var(--color-border-hair)" /><text x={x(tick)} y={16} textAnchor="middle" fontSize={12} fill="var(--color-text-muted)">{tick * 100}%</text></g>)}
      {layers.map((layer, index) => {
        const y = index * rowHeight + 48;
        return <g key={layer.id} role="button" tabIndex={index === 0 ? 0 : -1} aria-label={`Locate ${layer.name} in priority matrix`}
          className="cursor-pointer" onClick={() => onLayer(layer.id)} onKeyDown={event => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onLayer(layer.id); }
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault(); const marks = Array.from(event.currentTarget.parentElement!.querySelectorAll<SVGElement>('[role="button"]'));
              const next = event.key === "Home" ? 0 : event.key === "End" ? marks.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + marks.length) % marks.length;
              marks.forEach((mark, i) => mark.setAttribute("tabindex", i === next ? "0" : "-1")); marks[next]?.focus();
            }
          }}>
          <rect x={0} y={y - 22} width={730} height={44} fill="transparent" />
          <text x={0} y={y - 3} fontSize={12} fill="var(--color-text)"><tspan>{layer.name.slice(0, 31)}</tspan>{layer.name.length > 31 && <tspan x={0} dy={15}>{layer.name.slice(31, 62)}{layer.name.length > 62 ? "…" : ""}</tspan>}</text>
          {profiles.map((profile, p) => { const share = profile.values.find(value => value.layer === layer.id)?.share;
            if (share == null) return null;
            const py = y + (p - (profiles.length - 1) / 2) * 10;
            return <g key={profile.view.name}><line x1={x(0)} x2={x(share)} y1={py} y2={py} stroke={viewColor(profile.view.name)} strokeOpacity={.35} />
              <circle cx={x(share)} cy={py} r={4} fill={profile.view.name === benchmark ? "var(--color-surface)" : viewColor(profile.view.name)} stroke={viewColor(profile.view.name)} strokeWidth={2}><title>{profile.view.name}: {(share * 100).toFixed(2)}% · {layer.name}</title></circle></g>;
          })}
        </g>;
      })}
    </svg>
  </div>;
}
