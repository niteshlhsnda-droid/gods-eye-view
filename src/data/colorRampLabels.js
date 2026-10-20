/**
 * Canonical color-ramp label vocabulary for layers that render a color
 * ramp with no on-screen legend.
 *
 * Several layers color their features by data value — quake markers by
 * depth, fire dots by detection heat, traffic dots by flow, bikeshare
 * stations by bike availability, H3 hexes by entity density — but expose
 * no legend, so a reader interprets the colors without the key: red
 * reads as "severe", green as "good". These helpers are the single
 * source of truth for turning each ramp into human-readable labels:
 * ramp name → stops → what each stop means, with units.
 *
 * Verified against the tree (cf5e011) — every threshold below was read
 * from the layer code that renders the ramp, and each spec cites that
 * source:
 *
 * - earthquake-depth: src/layers/earthquakes/model.js `depthColor`
 * - firms-detection: src/layers/firms/policy.js `DETECTION_COLOR_STOPS`
 *   + src/layers/firms/model.js `detectionColorStop` / `heatColor`
 * - traffic-flow: src/data/trafficFlowStyle.js `flowBucket`
 * - bikeshare-availability: src/layers/bikeshare/policy.js palette +
 *   src/layers/bikeshare/rendering.js `statusToColor`
 * - h3-density: src/layers/deckgl/h3density.js `densityFillColor`
 *
 * These helpers are display-only: they never feed filters, thresholds,
 * sorting, or queries, and they never judge whether a feature is good
 * enough to show. They do not re-derive the rendering math — a stop's
 * color is the CSS equivalent of the exact color the renderer uses,
 * cited per stop, so a reader of the legend sees the same color as a
 * viewer of the globe.
 *
 * Honesty rules, enforced here so no call site can get them wrong:
 * - Missing, null, '', or non-finite inputs never default to a stop.
 *   Unknown renders as the ramp's explicit unknown label, never as the
 *   common or "safe-looking" band.
 * - No invented precision. Bands and labels reproduce the verified
 *   threshold semantics exactly, including which side of a boundary
 *   each stop owns (e.g. depth < 70 km is shallow; exactly 70 km is
 *   intermediate).
 * - A legend key says what the color MEANS, not what a reader might
 *   infer. FIRMS red is high detection heat, not a "severe fire";
 *   earthquake red is shallow depth, not a "big quake".
 * - Relative ramps say so. The H3 density ramp's top stop is the
 *   current view's maximum count, not an absolute number — its label
 *   must say "highest in view", and may name the count only when the
 *   caller supplies it.
 *
 * @module data/colorRampLabels
 */

/**
 * The five ramps verified legend-less in cf5e011, in the order their
 * labels should be offered when a surface lists several.
 * @type {string[]}
 */
export const COLOR_RAMP_IDS = [
  'earthquake-depth',
  'firms-detection',
  'traffic-flow',
  'bikeshare-availability',
  'h3-density',
];

/**
 * Verified spec for one ramp: what it colors, its stops (render order),
 * and the honesty notes that travel with any legend built from it.
 * `band` is the value range that owns the stop, in the ramp's units;
 * `meaning` is what a reader of the legend is entitled to conclude.
 */
const RAMP_SPECS = new Map([
  [
    'earthquake-depth',
    {
      id: 'earthquake-depth',
      layer: 'earthquakes',
      name: 'Earthquake depth band',
      whatItColors: 'Earthquake marker and pulse color',
      unit: 'km',
      stops: [
        {
          id: 'shallow',
          label: 'Shallow (< 70 km)',
          color: '#ff0000',
          band: 'depth < 70 km',
          meaning: 'Focal depth under 70 km (red = shallow, not "big")',
        },
        {
          id: 'intermediate',
          label: 'Intermediate (70–300 km)',
          color: '#ffa500',
          band: '70 km ≤ depth < 300 km',
          meaning: 'Focal depth 70 km up to but not including 300 km',
        },
        {
          id: 'deep',
          label: 'Deep (≥ 300 km)',
          color: '#ffff00',
          band: 'depth ≥ 300 km',
          meaning: 'Focal depth 300 km or more',
        },
      ],
      unknownLabel: 'Depth unknown',
      notes: [
        'Band colors are Cesium.RED / Cesium.ORANGE / Cesium.YELLOW as used by depthColor (src/layers/earthquakes/model.js); an unknown depth uses the neutral grey #91a4b4.',
        'The color encodes focal depth only — never magnitude or hazard.',
        'depthColor and labelEarthquakeDepthBand agree: a missing, non-finite, or negative depth renders as the neutral unknown color (#91a4b4) and labels as "Depth unknown" — an unreported depth never renders as shallow red.',
      ],
    },
  ],
  [
    'firms-detection',
    {
      id: 'firms-detection',
      layer: 'firms',
      name: 'FIRMS detection heat',
      whatItColors: 'Fire detection dot color and aggregated cell fill',
      unit: 'heat index 0–1 (unitless)',
      stops: [
        {
          id: 'high',
          label: 'High heat (> 0.72)',
          color: '#ff0000',
          band: 'heat > 0.72',
          meaning:
            'High detection heat: strong sensor response from high fire radiative power and/or high detection confidence — NOT a fire severity claim',
        },
        {
          id: 'moderate',
          label: 'Moderate heat (0.42–0.72)',
          color: '#ffa500',
          band: '0.42 < heat ≤ 0.72',
          meaning:
            'Moderate detection heat; a fire here can still be large or intense',
        },
        {
          id: 'low',
          label: 'Low heat (≤ 0.42)',
          color: '#ffff00',
          band: 'heat ≤ 0.42',
          meaning:
            'Low detection heat: weak sensor response or degraded inputs — a yellow stop does not prove a weak fire',
        },
      ],
      unknownLabel: 'Detection heat unknown',
      notes: [
        'Heat = min(1, sqrt(max(0, FRP) / 150) × 0.85 + confidence × 0.15): FRP in megawatts (MW), confidence normalized 0–1; thresholds are strict inequalities (> 0.72, > 0.42) per detectionColorStop (src/layers/firms/model.js).',
        'Colors are DETECTION_COLOR_STOPS (src/layers/firms/policy.js): red = Cesium.RED, orange = Cesium.ORANGE, yellow = Cesium.YELLOW, shared by detection glow sprites and aggregated heat cells.',
        'Missing FRP or missing confidence never reaches the heat math: detectionColorStop returns the separate unknown stop (neutral #91a4b4) and heatColor renders non-finite heat the same neutral — so a yellow dot now always means a measured low heat, never "inputs missing".',
      ],
    },
  ],
  [
    'traffic-flow',
    {
      id: 'traffic-flow',
      layer: 'traffic',
      name: 'Traffic flow',
      whatItColors: 'Traffic dot and heatline color',
      unit: 'traffic level 0–1 (current speed / free-flow speed)',
      stops: [
        {
          id: 'free',
          label: 'Free flow (≥ 0.85)',
          color: '#2ecc71',
          band: 'level ≥ 0.85',
          meaning:
            'Traffic moving at 85% of free-flow speed or better — a non-finite level also renders here by design, so green can mean "unusable data", never a phantom jam',
        },
        {
          id: 'slow',
          label: 'Slow (0.55–0.85)',
          color: '#f0b23e',
          band: '0.55 ≤ level < 0.85',
          meaning: 'Traffic moving at 55% up to 85% of free-flow speed',
        },
        {
          id: 'jam',
          label: 'Jam (< 0.55)',
          color: '#e05252',
          band: 'level < 0.55',
          meaning:
            'Traffic below 55% of free-flow speed; rendered red only on a real low ratio, never on missing data',
        },
      ],
      unknownLabel: 'Flow unknown',
      notes: [
        'Level is TomTom traffic_level: current speed / free-flow speed, 0–1 with 1 = free flow; bucket thresholds per flowBucket (src/data/trafficFlowStyle.js).',
        'Colors are FLOW_BUCKET_RGBA (src/data/trafficFlowStyle.js): #2ecc71 / #f0b23e / #e05252 at 0.9 alpha; rendered dots use the same palette through _activeBucketColors.',
      ],
    },
  ],
  [
    'bikeshare-availability',
    {
      id: 'bikeshare-availability',
      layer: 'bikeshare',
      name: 'Bikeshare station availability',
      whatItColors: 'Bikeshare station point color',
      unit: 'share of station capacity with a bike available',
      stops: [
        {
          id: 'good',
          label: 'Good (> 60%)',
          color: '#00ff88',
          band: 'ratio > 0.6',
          meaning: 'More than 60% of the station capacity has a bike available',
        },
        {
          id: 'limited',
          label: 'Limited (30–60%)',
          color: '#ffaa00',
          band: '0.3 ≤ ratio ≤ 0.6',
          meaning: 'Between 30% and 60% of capacity has a bike available',
        },
        {
          id: 'low',
          label: 'Low (< 30%)',
          color: '#ff4444',
          band: 'ratio < 0.3',
          meaning: 'Under 30% of capacity has a bike available',
        },
        {
          id: 'unknown',
          label: 'Status unavailable',
          color: '#91a4b4',
          band: 'no status or non-finite bike count',
          meaning: 'The station reported no status data — unknown, not empty',
        },
        {
          id: 'offline',
          label: 'Offline',
          color: '#687581',
          band: 'not installed, not renting, or not returning',
          meaning:
            'The station is offline; grey does not mean bikes are available',
        },
      ],
      unknownLabel: 'Status unavailable',
      notes: [
        'Ratio = bikesAvailable / capacity per statusToColor (src/layers/bikeshare/rendering.js); palette hues from src/layers/bikeshare/policy.js (#00ff88 / #ffaa00 / #ff4444 / #91a4b4 / #687581).',
        'The renderer paints these at 0.95 / 0.94 / 0.94 / 0.62 / 0.48 alpha; the legend swatches carry the hue only, which is what distinguishes the stops.',
      ],
    },
  ],
  [
    'h3-density',
    {
      id: 'h3-density',
      layer: 'deckgl',
      name: 'H3 entity density',
      whatItColors: 'H3 hex fill on the deck.gl density overlay',
      unit: 'entity count per hex (log-scaled)',
      stops: [
        {
          id: 'low',
          label: 'Low (1 entity)',
          color: '#598c285a',
          band: 'count = 1 (t = 0)',
          meaning: 'One entity in the hex — the faintest fill',
        },
        {
          id: 'high',
          label: 'High (most in view)',
          color: '#ff3f14e6',
          band: 'count = view maximum (t = 1)',
          meaning:
            'The highest hex count in the current view — relative, never an absolute number',
        },
      ],
      unknownLabel: 'Density unknown',
      notes: [
        'Fill interpolates on t = log(1 + count) / log(1 + maxCount) (maxCount > 1) per densityFillColor (src/layers/deckgl/h3density.js); endpoint swatches are the t = 0 and t = 1 fills with the renderer alpha baked in (#598c285a = [89,140,40,90], #ff3f14e6 = [255,63,20,230]).',
        'The top stop is the current dataset maximum — the same bright fill can mean 5 entities or 5,000 depending on the view. Legend labels must say "highest in view" and may name the count only when the caller supplies it.',
      ],
    },
  ],
]);

/**
 * Full verified spec for a color ramp, or null for an unknown ramp id.
 * The returned object is a fresh copy — callers cannot mutate the
 * canonical tables.
 * @param {unknown} rampId - One of COLOR_RAMP_IDS.
 * @returns {object|null} Spec with id, layer, name, whatItColors, unit,
 *   stops ([{id, label, color, band, meaning}]), unknownLabel, notes.
 */
export function colorRampSpec(rampId) {
  const spec = typeof rampId === 'string' ? RAMP_SPECS.get(rampId) : null;
  if (!spec) return null;
  return {
    ...spec,
    stops: spec.stops.map((stop) => ({ ...stop })),
    notes: [...spec.notes],
  };
}

/**
 * railCardBlocks-style legend payload for a ramp:
 * { colors, labels, categorical, units }. Categorical ramps (all but
 * h3-density) render as entries; h3-density renders as a continuous
 * gradient ramp with a scale.
 * @param {unknown} rampId - One of COLOR_RAMP_IDS.
 * @param {{ maxCount?: unknown }} [options] - h3-density only: the view's
 *   current maximum hex count, used to name the top stop honestly. A
 *   missing or non-finite maxCount keeps the honest relative label.
 * @returns {object|null} Legend payload, or null for an unknown ramp id.
 */
export function colorRampCardLegend(rampId, options) {
  const spec = colorRampSpec(rampId);
  if (!spec) return null;
  const categorical = spec.id !== 'h3-density';
  const labels = spec.stops.map((stop) => stop.label);
  if (!categorical) {
    const maxCount =
      options && Number.isFinite(Number(options.maxCount))
        ? Math.floor(Number(options.maxCount))
        : null;
    labels[1] =
      maxCount !== null && maxCount > 0
        ? `High (${maxCount} in view)`
        : 'High (highest in view)';
  }
  return {
    colors: spec.stops.map((stop) => stop.color),
    labels,
    categorical,
    units: categorical ? '' : 'entities',
  };
}

/**
 * layerPanel row-controls legend entries for a ramp:
 * [{ label, color, blurb }]. The color is a CSS string the panel paints
 * straight into the swatch; the blurb is the stop's honest meaning.
 * @param {unknown} rampId - One of COLOR_RAMP_IDS.
 * @param {{ maxCount?: unknown }} [options] - h3-density only: the view's
 *   current maximum hex count; see colorRampCardLegend.
 * @returns {Array<{label: string, color: string, blurb: string}>|null}
 *   Legend entries, or null for an unknown ramp id.
 */
export function colorRampRowLegend(rampId, options) {
  const spec = colorRampSpec(rampId);
  if (!spec) return null;
  const entries = spec.stops.map((stop) => ({
    label: stop.label,
    color: stop.color,
    blurb: stop.meaning,
  }));
  if (spec.id === 'h3-density') {
    const maxCount =
      options && Number.isFinite(Number(options.maxCount))
        ? Math.floor(Number(options.maxCount))
        : null;
    entries[1].label =
      maxCount !== null && maxCount > 0
        ? `High (${maxCount} in view)`
        : 'High (highest in view)';
    entries[1].blurb = `${spec.stops[1].meaning}${
      maxCount !== null && maxCount > 0
        ? ` (currently ${maxCount} entities)`
        : ''
    }`;
  }
  return entries;
}

/**
 * Honesty-guarded label for the earthquake depth band a depth value
 * belongs to. Like the renderer (depthColor returns the neutral
 * unknown color for the same inputs), this never
 * defaults a missing depth into the shallow band: null, '', undefined,
 * NaN, non-finite, and negative inputs all read as 'Depth unknown'.
 * A reported 0 km is a real (finite) value and bands as shallow —
 * whether 0 is a genuine surface reading or a feed placeholder is a
 * claim this module cannot verify, so it says nothing about it.
 * @param {unknown} depthKm - Reported focal depth in kilometres.
 * @returns {string} 'Shallow (< 70 km)' | 'Intermediate (70–300 km)' |
 *   'Deep (≥ 300 km)' | 'Depth unknown'.
 */
export function labelEarthquakeDepthBand(depthKm) {
  if (typeof depthKm === 'string') {
    if (depthKm.trim() === '') return 'Depth unknown';
    const parsed = Number(depthKm);
    if (!Number.isFinite(parsed)) return 'Depth unknown';
    return labelEarthquakeDepthBand(parsed);
  }
  if (typeof depthKm !== 'number' || !Number.isFinite(depthKm)) {
    return 'Depth unknown';
  }
  if (depthKm < 0) return 'Depth unknown';
  if (depthKm < 70) return 'Shallow (< 70 km)';
  if (depthKm < 300) return 'Intermediate (70–300 km)';
  return 'Deep (≥ 300 km)';
}
