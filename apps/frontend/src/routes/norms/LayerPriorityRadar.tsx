import { curveLinearClosed, lineRadial, scaleLinear } from "d3";
import { useId, useState } from "react";
import { viewColor } from "@/lib/viewColors";
import { generalBenchmarkName } from "./viewMembership";
import { validWeight, type NormDocument } from "./normAuthoring";
import { layerPriorityProfile } from "./layerPriorityProfiles";
import "./NormPriorities.css";

const MAX_VIEWS = 3;
const RADIUS = 148;
const CENTER = 235;
const dashes = ["", "7 4", "2 4"];
const number = (value: number) => validWeight(value) ? String(value) : "Invalid";

export function LayerPriorityRadar({ document, onLayer }: { document: NormDocument; onLayer: (layer: string) => void }) {
  const [open, setOpen] = useState(false);
  return <details className="norm-priorities priority-profile" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Compare layer priority profiles <span className="font-normal text-text-muted">· optional radar</span></summary>
    {open && <PriorityComparison document={document} onLayer={onLayer} />}
  </details>;
}

function PriorityComparison({ document, onLayer }: { document: NormDocument; onLayer: (layer: string) => void }) {
  const id = useId();
  const benchmark = generalBenchmarkName(document);
  const views = [...document.views ?? []].sort((a, b) => Number(b.name === benchmark) - Number(a.name === benchmark));
  const layers = document.layers ?? [];
  const [selection, setSelection] = useState(() => views.slice(0, MAX_VIEWS).map(v => v.name));
  const selected = selection.filter(name => views.some(v => v.name === name));
  const profiles = views.filter(v => selected.includes(v.name)).map(view => layerPriorityProfile(document, view));
  const chartProfiles = profiles.filter(p => !p.unavailable);
  const canDraw = layers.length >= 3 && layers.length <= 12;
  const scale = scaleLinear().domain([0, 1]).range([0, RADIUS]);
  const angle = (index: number) => index * Math.PI * 2 / layers.length;
  const point = (index: number, radius: number) => [Math.sin(angle(index)) * radius, -Math.cos(angle(index)) * radius];
  const path = lineRadial<number>().angle((_, index) => angle(index)).radius(value => scale(value)).curve(curveLinearClosed);
  const color = (name: string) => name === benchmark ? "#526579" : viewColor(name);
  return <section aria-label="Layer priority comparison" className="mt-4" aria-describedby={`${id}-basis`}>
    <h3>How each view distributes its priorities</h3>
    <p id={`${id}-basis`}>Priorities, not performance. Each layer’s configured weight is divided by that view’s total across all layers. Direct constraint weights are summed by layer first. General gives equal priority to participating layers. No case data or assessed contributions are used.</p>
    <fieldset><legend>Choose up to {MAX_VIEWS} views. All profiles use the same 0–100% scale and layer order.</legend>
      <div className="priority-profile-options">{views.map(view => <label key={view.name}><input type="checkbox" checked={selected.includes(view.name)} disabled={selected.length >= MAX_VIEWS && !selected.includes(view.name)} onChange={() => setSelection(selected.includes(view.name) ? selected.filter(name => name !== view.name) : [...selected, view.name])} />{view.name || "Unnamed view"}</label>)}</div>
    </fieldset>
    {!selected.length && <p role="status">Select a view to compare its layer priorities.</p>}
    {profiles.filter(p => p.unavailable).map(profile => <p role="status" key={profile.view.name}>{profile.view.name}: {profile.unavailable}</p>)}
    {selected.length > 0 && <>
      <div className="priority-profile-legend" aria-label="Profile legend">{profiles.map((profile, index) => <span key={profile.view.name}><svg width="28" height="12" aria-hidden="true"><path d="M 0 6 H 28" stroke={color(profile.view.name)} strokeWidth="2" strokeDasharray={dashes[index]} /></svg>{profile.view.name}{profile.unavailable ? " · unavailable" : ""}</span>)}</div>
      <div className={canDraw && chartProfiles.length ? "priority-profile-layout" : undefined}>
        {canDraw && chartProfiles.length > 0 ? <div>
          <svg className="priority-radar" viewBox="0 0 470 470" role="group" aria-labelledby={`${id}-title ${id}-description`}>
            <title id={`${id}-title`}>Normalized layer priorities</title><desc id={`${id}-description`}>Each radius uses 0 to 100 percent of a view’s configured total. Lines compare priorities, not performance. Activate a numbered layer axis to locate it in the matrix. Exact ratios and weights follow in the table.</desc>
            <g transform={`translate(${CENTER},${CENTER})`}>
              {[.25, .5, .75, 1].map(tick => <g key={tick}><path d={path(layers.map(() => tick)) ?? undefined} fill="none" stroke="#dbe2e5" /><text x="5" y={-scale(tick) - 4} style={{ fontSize: 10, fill: "#586779" }}>{tick * 100}%</text></g>)}
              {layers.map((layer, index) => {
                const [x, y] = point(index, RADIUS);
                const [labelX, labelY] = point(index, RADIUS + 35);
                return <g key={layer.id}>
                  <line x2={x} y2={y} stroke="#dbe2e5" />
                  <g className="priority-axis" role="button" tabIndex={0} aria-label={`Locate ${layer.name} in priority matrix`} transform={`translate(${labelX},${labelY})`} onClick={() => onLayer(layer.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onLayer(layer.id); } }}>
                    <title>{layer.name}</title><circle r="18" fill="#faf9f6" stroke="#b7c6cc" /><text textAnchor="middle" dominantBaseline="central" fontWeight="600">{index + 1}</text>
                  </g>
                </g>;
              })}
              {profiles.map((profile, index) => !profile.unavailable && <g key={profile.view.name} aria-hidden="true" pointerEvents="none">
                <path d={path(profile.values.map(value => value.share!)) ?? undefined} fill="none" stroke={color(profile.view.name)} strokeWidth="2" strokeDasharray={dashes[index]} strokeLinejoin="round" />
                {profile.values.map((value, layerIndex) => { const [cx, cy] = point(layerIndex, scale(value.share!)); return <circle key={value.layer} cx={cx} cy={cy} r="3" fill="white" stroke={color(profile.view.name)} strokeWidth="1.5" />; })}
              </g>)}
            </g>
          </svg>
          <p className="text-center">Axes follow the numbered layers in the table. Select an axis to locate its layer.</p>
        </div> : <p className="my-3">{canDraw ? "No valid profile to draw. See the explanations and table." : "The radar is available for 3–12 layers. Use the table for this structure."}</p>}
        <div className="priority-profile-table" role="region" aria-label="Exact layer priority values" tabIndex={0}>
          <table><caption>Layer priority values <span className="font-normal">· percentages rounded to 2 decimals; exact weight ratios below</span></caption>
            <thead><tr><th scope="col">Layer</th>{profiles.map(profile => <th key={profile.view.name} scope="col">{profile.view.name}<small>{profile.basis}</small></th>)}</tr></thead>
            <tbody>{layers.map((layer, index) => <tr key={layer.id}><th scope="row"><button type="button" onClick={() => onLayer(layer.id)}>{index + 1}. {layer.name || "Unnamed layer"}</button></th>{profiles.map(profile => {
              const value = profile.values[index]!;
              return <td key={profile.view.name}>{value.share == null ? "Unavailable" : `${(value.share * 100).toFixed(2)}%`}<small>{value.share == null ? `Raw weight: ${number(value.weight)}` : `${number(value.weight)} / ${number(profile.total)}`}</small></td>;
            })}</tr>)}</tbody>
          </table>
        </div>
      </div>
    </>}
  </section>;
}
