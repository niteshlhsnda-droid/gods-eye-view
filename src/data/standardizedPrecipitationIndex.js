/**
 * Standardized Precipitation Index (SPI): SPI value -> drought/wetness
 * category (Extremely dry .. Near normal .. Extremely wet).
 *
 * Why a new module: GEV already has weather-adjacent pure helpers
 * (sunTimes, moonPhase, Beaufort, feelsLike, UV index, EPA AQI,
 * Saffir-Simpson, WMO sea state / present-weather, flood categories,
 * and others), but nothing that answers "how dry or wet is this
 * place, in drought terms?" for a climate / precipitation readout.
 * The SPI is the WMO-recommended index for exactly that question:
 * a standardized precipitation anomaly over a chosen time scale
 * maps to one of seven named drought/wetness categories. This module
 * is that answer: one pure classifier plus the category table
 * (verbatim WMO bands, drought flag) that a badge or readout needs.
 * No call-site migration — no layer reads this yet.
 *
 * Standard: the Standardized Precipitation Index as defined by
 * McKee et al. (1993, Colorado State University) and adopted as the
 * WMO standard index for meteorological drought in
 * WMO-No. 1090, "Standardized Precipitation Index User Guide"
 * (WMO, 2012). The SPI is the number of standard deviations by
 * which the observed precipitation accumulation over the chosen
 * time scale deviates from the long-term mean: mean 0, standard
 * deviation 1, dimensionless. The guide's Table 2.1 ("SPI values and
 * the associated drought categories") reads, verbatim:
 *   >= 2.00   Extremely wet
 *   1.50 to 1.99  Very wet
 *   1.00 to 1.49  Moderately wet
 *   -0.99 to 0.99  Near normal
 *   -1.00 to -1.49  Moderately dry
 *   -1.50 to -1.99  Severely dry
 *   <= -2.00  Extremely dry
 *   (WMO-No. 1090, Table 2.1, as published at
 *    https://www.wamis.org/agm/pubs/SPI/WMO_1090_EN.pdf )
 *
 * Sources (primary sources only; no blog summaries):
 * - WMO-No. 1090, "Standardized Precipitation Index User Guide"
 *   (World Meteorological Organization, 2012): the SPI definition
 *   (standardized precipitation anomaly, mean 0, SD 1), the Table
 *   2.1 drought/wetness categories quoted above, the time scales
 *   (3-, 6-, 12-, 24-, 48-month in the original McKee work; WMO
 *   recommends SPI-1/2/3/6 for meteorological drought, SPI-1 to 12
 *   for agricultural, SPI-12+ for hydrological), and the McKee
 *   (1993) drought-event definition: an event begins when the SPI
 *   becomes negative and persists until the SPI is at least -1,
 *   ending when the SPI turns positive again — i.e. SPI <= -1 is
 *   the drought threshold the `isDrought` helper encodes.
 *   https://www.wamis.org/agm/pubs/SPI/WMO_1090_EN.pdf
 * - McKee, T.B., Doesken, N.J. & Kleist, J. (1993), "The
 *   relationship of drought frequency and duration to time scales",
 *   8th Conference on Applied Climatology: the original SPI
 *   formulation and the -1 / -1.5 / -2 drought-intensity cutoffs.
 *
 * Bands: `band` stores the verbatim published [min, max] edges for
 * display; a null end marks an open-ended side (Extremely dry is
 * open below, Extremely wet open above). Classification treats the
 * bands as tiling (-inf, +inf) via the half-open intervals
 * [lo, next band's lo), the same convention as the other scale
 * modules in this directory: a value between two published edges
 * (e.g. 0.995, which the printed table leaves ambiguous) lands in
 * the lower-adjacent band, and every finite value classifies.
 * Non-finite / non-numeric input is unknown -> null, never throws.
 *
 * `code` values ('ED', 'SD', 'MD', 'NN', 'MW', 'VW', 'EW') are this
 * module's invention for compact reference; the `label` values
 * quote the WMO table. `isDrought` flags the dry-side categories at
 * or beyond McKee's -1 event threshold (Moderately dry and drier).
 *
 * Accuracy / scope limits — read before using the numbers:
 * - PRECIPITATION ONLY. SPI measures precipitation anomaly, not
 *   drought impact. Evapotranspiration, temperature, soil, and
 *   water management decide the impact; SPEI (which adds
 *   temperature) exists for that. Never present SPI as an
 *   all-hazards drought severity score.
 * - TIME SCALE CHANGES THE ANSWER. SPI-1 tracks short (meteorological
 *   / soil-moisture) anomalies; SPI-12+ tracks hydrological drought
 *   (streamflow, reservoirs, groundwater). A location can be
 *   Extremely dry on SPI-1 and Near normal on SPI-12 at the same
 *   moment. Always state the time scale with the category; this
 *   module does not store one.
 * - CLIMATOLOGY-BASED. SPI is relative to the location's own long-
 *   term record (WMO recommends >= 30 years). It compares a place
 *   against itself, never against other places: "Near normal" in a
 *   desert and "Near normal" in a rainforest mean very different
 *   rainfalls.
 * - THE TRANSFORM IS CALLER-SIDE. This module classifies the SPI
 *   z-score only; fitting the precipitation record (typically to a
 *   gamma distribution) and standardizing it is the caller's job.
 */

/**
 * The scale, driest first. `band` holds the verbatim published
 * [min, max] display edges; a null end means open (-inf / +inf).
 * `isDrought` is true for the dry-side categories at or beyond the
 * McKee -1 event threshold.
 * @type {ReadonlyArray<Readonly<{
 *   code: string,
 *   label: string,
 *   band: Readonly<[number | null, number | null]>,
 *   isDrought: boolean,
 *   description: string,
 * }>>}
 */
export const SPI_SCALE = Object.freeze([
  Object.freeze({
    code: 'ED',
    label: 'Extremely dry',
    band: Object.freeze([null, -2.0]),
    isDrought: true,
    description:
      'Precipitation two or more standard deviations below normal — an exceptional drought anomaly for the time scale.',
  }),
  Object.freeze({
    code: 'SD',
    label: 'Severely dry',
    band: Object.freeze([-1.99, -1.5]),
    isDrought: true,
    description:
      'Precipitation well below normal — a severe drought anomaly for the time scale.',
  }),
  Object.freeze({
    code: 'MD',
    label: 'Moderately dry',
    band: Object.freeze([-1.49, -1.0]),
    isDrought: true,
    description:
      'Precipitation moderately below normal — at the McKee drought-event threshold.',
  }),
  Object.freeze({
    code: 'NN',
    label: 'Near normal',
    band: Object.freeze([-0.99, 0.99]),
    isDrought: false,
    description:
      'Precipitation within the normal range for the location and time scale.',
  }),
  Object.freeze({
    code: 'MW',
    label: 'Moderately wet',
    band: Object.freeze([1.0, 1.49]),
    isDrought: false,
    description: 'Precipitation moderately above normal for the time scale.',
  }),
  Object.freeze({
    code: 'VW',
    label: 'Very wet',
    band: Object.freeze([1.5, 1.99]),
    isDrought: false,
    description:
      'Precipitation well above normal — a strong positive anomaly for the time scale.',
  }),
  Object.freeze({
    code: 'EW',
    label: 'Extremely wet',
    band: Object.freeze([2.0, null]),
    isDrought: false,
    description:
      'Precipitation two or more standard deviations above normal — an exceptional wet anomaly for the time scale.',
  }),
]);

/**
 * Scale code ('ED', 'SD', 'MD', 'NN', 'MW', 'VW', 'EW') -> scale entry.
 */
export const SPI_BY_CODE = Object.freeze(
  Object.fromEntries(SPI_SCALE.map((entry) => [entry.code, entry])),
);

/**
 * Classifies an SPI value on the WMO-No. 1090 category table.
 *
 * @param {number} spi - the SPI value (z-score; negative = drier).
 *   Every finite number classifies: the bands tile (-inf, +inf).
 * @returns {object | null} the frozen scale entry, or null when the
 *   input is not a finite number (unknown, never throws).
 */
export function classifySpi(spi) {
  if (typeof spi !== 'number' || !Number.isFinite(spi)) {
    return null;
  }
  for (let i = 0; i < SPI_SCALE.length; i++) {
    const entry = SPI_SCALE[i];
    const [lo] = entry.band;
    const lowerBound = lo === null ? -Infinity : lo;
    const next = SPI_SCALE[i + 1];
    const upperExclusive =
      next === undefined
        ? Infinity
        : next.band[0] === null
          ? -Infinity
          : next.band[0];
    if (spi >= lowerBound && spi < upperExclusive) {
      return entry;
    }
  }
  // Unreachable: the bands tile (-inf, +inf) — ED is open below,
  // EW open above. Kept as a guard so a future table edit fails
  // loudly instead of returning undefined.
  throw new Error(`classifySpi: no band covers ${spi} — scale table has a gap`);
}

/**
 * True when the classified entry is a drought category (Moderately
 * dry or drier, i.e. SPI <= -1 — the McKee (1993) drought-event
 * threshold from WMO-No. 1090). Accepts either a scale entry (as
 * returned by {@link classifySpi}) or a scale code ('ED'..'EW').
 * @param {object | string} entryOrCode
 * @returns {boolean}
 */
export function isDrought(entryOrCode) {
  const entry =
    typeof entryOrCode === 'string' ? SPI_BY_CODE[entryOrCode] : entryOrCode;
  if (!entry || typeof entry.isDrought !== 'boolean') {
    throw new TypeError(
      `isDrought: expected a scale entry or code, got ${String(entryOrCode)}`,
    );
  }
  return entry.isDrought;
}
