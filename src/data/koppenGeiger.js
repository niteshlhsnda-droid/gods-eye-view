/**
 * Köppen-Geiger climate classification: 12-month temperature and
 * precipitation normals -> one of 30 published climate types
 * (Af/Am/Aw, BWh/BWk/BSh/BSk, Csa..Cwc, Dsa..Dwd, ET/EF).
 *
 * Why a new module: the app has weather, wind, sea, and comfort
 * classifiers, but no climate-region vocabulary — a HUD readout can
 * label a location "Cfb, oceanic" instead of dumping raw normals.
 * The decision tree is fully deterministic and published, so it
 * belongs in a pure, citation-carrying data module that any card,
 * legend, or voice readout can share.
 *
 * Sources (fetched and verified 2026-10-18):
 * - Peel, M. C., Finlayson, B. L. & McMahon, T. A. (2007),
 *   "Updated world map of the Köppen-Geiger climate classification",
 *   Hydrol. Earth Syst. Sci. 11, 1633-1644,
 *   https://hess.copernicus.org/articles/11/1633/2007/
 *   (Table 1: exact symbol criteria, quoted verbatim below; body
 *   text: B climates must be identified FIRST since a B location
 *   also satisfies one of A/C/D/E; the C/D boundary follows
 *   Russell (1931) at 0°C, not Köppen's original -3°C; the Cs/Cw
 *   and Ds/Dw tie-break by 6-month summer vs winter precipitation).
 * - Kottek, M., Grieser, J., Beck, C., Rudolf, B. & Rubel, F.
 *   (2006), "World map of the Köppen-Geiger climate classification
 *   updated", Meteorol. Z. 15(3), 259-263 (the world-map paper
 *   whose rule set Peel et al. reproduce).
 *
 * Exact criteria implemented (Peel et al. 2007, Table 1):
 *   A Tropical: Tcold >= 18
 *     Af: Pdry >= 60
 *     Am: not Af and Pdry >= 100 - MAP/25
 *     Aw: not Af and not Am (Pdry < 100 - MAP/25)
 *   B Arid: MAP < 10 * Pthreshold (checked FIRST, per body text)
 *     BW (Desert): MAP < 5 * Pthreshold
 *     BS (Steppe): 5 * Pthreshold <= MAP (< 10 * Pthreshold by group)
 *     h (Hot): MAT >= 18 ; k (Cold): MAT < 18
 *   C Temperate: Thot > 10 and 0 < Tcold < 18
 *   D Cold:      Thot > 10 and Tcold <= 0
 *     Cs/Ds: Psdry < 40 and Psdry < Pwwet/3
 *     Cw/Dw: Pwdry < Pswet/10
 *     Cf/Df: neither of the above
 *     a: Thot >= 22 ; b: not a and Tmon10 >= 4 ;
 *     c: not a, not b (C) / not a, not b, not d (D) ;
 *     d (D only): not a, not b, and Tcold < -38
 *   E Polar: Thot < 10
 *     ET (Tundra): Thot > 0 ; EF (Frost): Thot <= 0
 *   Pthreshold: 2*MAT if >= 70% of MAP falls in winter,
 *     2*MAT + 28 if >= 70% falls in summer, else 2*MAT + 14.
 *   Summer (winter) is the warmer (cooler) six months of
 *   ONDJFM / AMJJAS (northern hemisphere: summer = AMJJAS).
 *   A/C/D/E are mutually exclusive on temperature alone.
 *
 * Scope notes: the -3°C C/D boundary used by Köppen's last
 * publication is a documented variant — this module follows Peel
 * et al.'s stated 0°C choice (Russell 1931). The exact "70%" share
 * wording comes from Peel's Table 1 footnote ("if 70% of MAP
 * occurs in winter ..."): winter share >= 70% takes the winter
 * branch, summer share >= 70% takes the summer branch, otherwise
 * the neutral branch. Input is monthly climate NORMALS; nothing
 * here smooths, interpolates, or regrids station data.
 *
 * Pure: no DOM, no Cesium, no imports, no network.
 *
 * @module data/koppenGeiger
 */

const MONTHS_PER_YEAR = 12;

/**
 * Month indices (0 = January) of the six warmer months for the
 * northern hemisphere: AMJJAS. Southern hemisphere swaps the halves.
 */
const SUMMER_MONTHS_NH = Object.freeze([3, 4, 5, 6, 7, 8]);

/**
 * Month indices (0 = January) of the six cooler months for the
 * northern hemisphere: ONDJFM. Southern hemisphere swaps the halves.
 */
const WINTER_MONTHS_NH = Object.freeze([9, 10, 11, 0, 1, 2]);

/** Winter-precipitation share that selects the winter Pthreshold branch. */
export const WINTER_SHARE_THRESHOLD = 0.7;

/** Summer-precipitation share that selects the summer Pthreshold branch. */
export const SUMMER_SHARE_THRESHOLD = 0.7;

function freezeEntry(entry) {
  return Object.freeze({ ...entry });
}

/**
 * The 30 Köppen-Geiger climate types in Peel et al.'s Table 1 order.
 * `group` is the first-letter broad climate; `precipRegime` the
 * second letter (with `polarSub` set instead for E); `heat` the third
 * letter (null for ET/EF, which have no third letter).
 */
export const KOPPEN_TYPES = Object.freeze(
  [
    {
      code: 'Af',
      group: 'A',
      groupName: 'Tropical',
      precipRegime: 'f',
      regimeName: 'Rainforest',
      heat: null,
      heatName: null,
    },
    {
      code: 'Am',
      group: 'A',
      groupName: 'Tropical',
      precipRegime: 'm',
      regimeName: 'Monsoon',
      heat: null,
      heatName: null,
    },
    {
      code: 'Aw',
      group: 'A',
      groupName: 'Tropical',
      precipRegime: 'w',
      regimeName: 'Savannah',
      heat: null,
      heatName: null,
    },
    {
      code: 'BWh',
      group: 'B',
      groupName: 'Arid',
      precipRegime: 'W',
      regimeName: 'Desert',
      heat: 'h',
      heatName: 'Hot',
    },
    {
      code: 'BWk',
      group: 'B',
      groupName: 'Arid',
      precipRegime: 'W',
      regimeName: 'Desert',
      heat: 'k',
      heatName: 'Cold',
    },
    {
      code: 'BSh',
      group: 'B',
      groupName: 'Arid',
      precipRegime: 'S',
      regimeName: 'Steppe',
      heat: 'h',
      heatName: 'Hot',
    },
    {
      code: 'BSk',
      group: 'B',
      groupName: 'Arid',
      precipRegime: 'S',
      regimeName: 'Steppe',
      heat: 'k',
      heatName: 'Cold',
    },
    {
      code: 'Csa',
      group: 'C',
      groupName: 'Temperate',
      precipRegime: 's',
      regimeName: 'Dry Summer',
      heat: 'a',
      heatName: 'Hot Summer',
    },
    {
      code: 'Csb',
      group: 'C',
      groupName: 'Temperate',
      precipRegime: 's',
      regimeName: 'Dry Summer',
      heat: 'b',
      heatName: 'Warm Summer',
    },
    {
      code: 'Csc',
      group: 'C',
      groupName: 'Temperate',
      precipRegime: 's',
      regimeName: 'Dry Summer',
      heat: 'c',
      heatName: 'Cold Summer',
    },
    {
      code: 'Cfa',
      group: 'C',
      groupName: 'Temperate',
      precipRegime: 'f',
      regimeName: 'Without dry season',
      heat: 'a',
      heatName: 'Hot Summer',
    },
    {
      code: 'Cfb',
      group: 'C',
      groupName: 'Temperate',
      precipRegime: 'f',
      regimeName: 'Without dry season',
      heat: 'b',
      heatName: 'Warm Summer',
    },
    {
      code: 'Cfc',
      group: 'C',
      groupName: 'Temperate',
      precipRegime: 'f',
      regimeName: 'Without dry season',
      heat: 'c',
      heatName: 'Cold Summer',
    },
    {
      code: 'Cwa',
      group: 'C',
      groupName: 'Temperate',
      precipRegime: 'w',
      regimeName: 'Dry Winter',
      heat: 'a',
      heatName: 'Hot Summer',
    },
    {
      code: 'Cwb',
      group: 'C',
      groupName: 'Temperate',
      precipRegime: 'w',
      regimeName: 'Dry Winter',
      heat: 'b',
      heatName: 'Warm Summer',
    },
    {
      code: 'Cwc',
      group: 'C',
      groupName: 'Temperate',
      precipRegime: 'w',
      regimeName: 'Dry Winter',
      heat: 'c',
      heatName: 'Cold Summer',
    },
    {
      code: 'Dsa',
      group: 'D',
      groupName: 'Cold',
      precipRegime: 's',
      regimeName: 'Dry Summer',
      heat: 'a',
      heatName: 'Hot Summer',
    },
    {
      code: 'Dsb',
      group: 'D',
      groupName: 'Cold',
      precipRegime: 's',
      regimeName: 'Dry Summer',
      heat: 'b',
      heatName: 'Warm Summer',
    },
    {
      code: 'Dsc',
      group: 'D',
      groupName: 'Cold',
      precipRegime: 's',
      regimeName: 'Dry Summer',
      heat: 'c',
      heatName: 'Cold Summer',
    },
    {
      code: 'Dsd',
      group: 'D',
      groupName: 'Cold',
      precipRegime: 's',
      regimeName: 'Dry Summer',
      heat: 'd',
      heatName: 'Very Cold Winter',
    },
    {
      code: 'Dfa',
      group: 'D',
      groupName: 'Cold',
      precipRegime: 'f',
      regimeName: 'Without dry season',
      heat: 'a',
      heatName: 'Hot Summer',
    },
    {
      code: 'Dfb',
      group: 'D',
      groupName: 'Cold',
      precipRegime: 'f',
      regimeName: 'Without dry season',
      heat: 'b',
      heatName: 'Warm Summer',
    },
    {
      code: 'Dfc',
      group: 'D',
      groupName: 'Cold',
      precipRegime: 'f',
      regimeName: 'Without dry season',
      heat: 'c',
      heatName: 'Cold Summer',
    },
    {
      code: 'Dfd',
      group: 'D',
      groupName: 'Cold',
      precipRegime: 'f',
      regimeName: 'Without dry season',
      heat: 'd',
      heatName: 'Very Cold Winter',
    },
    {
      code: 'Dwa',
      group: 'D',
      groupName: 'Cold',
      precipRegime: 'w',
      regimeName: 'Dry Winter',
      heat: 'a',
      heatName: 'Hot Summer',
    },
    {
      code: 'Dwb',
      group: 'D',
      groupName: 'Cold',
      precipRegime: 'w',
      regimeName: 'Dry Winter',
      heat: 'b',
      heatName: 'Warm Summer',
    },
    {
      code: 'Dwc',
      group: 'D',
      groupName: 'Cold',
      precipRegime: 'w',
      regimeName: 'Dry Winter',
      heat: 'c',
      heatName: 'Cold Summer',
    },
    {
      code: 'Dwd',
      group: 'D',
      groupName: 'Cold',
      precipRegime: 'w',
      regimeName: 'Dry Winter',
      heat: 'd',
      heatName: 'Very Cold Winter',
    },
    {
      code: 'ET',
      group: 'E',
      groupName: 'Polar',
      precipRegime: 'T',
      regimeName: 'Tundra',
      heat: null,
      heatName: null,
    },
    {
      code: 'EF',
      group: 'E',
      groupName: 'Polar',
      precipRegime: 'F',
      regimeName: 'Frost',
      heat: null,
      heatName: null,
    },
  ].map(freezeEntry),
);

const TYPE_BY_CODE = new Map(KOPPEN_TYPES.map((entry) => [entry.code, entry]));

/**
 * Validate a 12-element monthly normals array.
 * @param {Array} values - the monthly values to validate.
 * @param {string} label - value label for error messages.
 * @param {boolean} nonNegative - whether values must be >= 0.
 */
function checkMonthly(values, label, nonNegative) {
  if (!Array.isArray(values) || values.length !== MONTHS_PER_YEAR) {
    throw new TypeError(`${label} must be an array of 12 monthly values`);
  }
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`${label}[${i}] must be a finite number`);
    }
    if (nonNegative && value < 0) {
      throw new RangeError(`${label}[${i}] cannot be negative`);
    }
  }
}

/**
 * Precipitation threshold Pthreshold from Peel et al.'s Table 1
 * footnote: 2*MAT when at least 70% of MAP falls in the winter
 * half-year, 2*MAT + 28 when at least 70% falls in the summer
 * half-year, otherwise 2*MAT + 14. Winter is checked first, matching
 * the footnote's ordering. With MAP = 0 there is no seasonal
 * concentration, so the neutral branch applies.
 * @param {number} mat - mean annual temperature in °C.
 * @param {number} map - mean annual precipitation in mm (>= 0).
 * @param {number} winterPrecip - winter-half-year precipitation in mm.
 * @param {number} summerPrecip - summer-half-year precipitation in mm.
 * @returns {number} Pthreshold in mm.
 */
export function precipitationThreshold(mat, map, winterPrecip, summerPrecip) {
  for (const [value, label] of [
    [mat, 'MAT'],
    [map, 'MAP'],
    [winterPrecip, 'winter precipitation'],
    [summerPrecip, 'summer precipitation'],
  ]) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`${label} must be a finite number`);
    }
  }
  if (map < 0 || winterPrecip < 0 || summerPrecip < 0) {
    throw new RangeError('precipitation values cannot be negative');
  }
  if (map > 0 && winterPrecip >= WINTER_SHARE_THRESHOLD * map) {
    return 2 * mat;
  }
  if (map > 0 && summerPrecip >= SUMMER_SHARE_THRESHOLD * map) {
    return 2 * mat + 28;
  }
  return 2 * mat + 14;
}

function sumOf(values, indices) {
  return indices.reduce((total, index) => total + values[index], 0);
}

function minOf(values, indices) {
  return indices.reduce((min, index) => Math.min(min, values[index]), Infinity);
}

function maxOf(values, indices) {
  return indices.reduce(
    (max, index) => Math.max(max, values[index]),
    -Infinity,
  );
}

/**
 * Derive the Köppen decision variables from monthly normals.
 * @param {number[]} monthlyTempC - 12 monthly mean temperatures in °C.
 * @param {number[]} monthlyPrecipMm - 12 monthly precipitations in mm.
 * @param {boolean} northernHemisphere - true for AMJJAS summers.
 * @returns {object} the derived variables (MAP, MAT, Thot, Tcold,
 *   Tmon10, Pdry, Psdry, Pwdry, Pswet, Pwwet, Pthreshold,
 *   summerPrecip, winterPrecip).
 */
function deriveVariables(monthlyTempC, monthlyPrecipMm, northernHemisphere) {
  const summerMonths = northernHemisphere ? SUMMER_MONTHS_NH : WINTER_MONTHS_NH;
  const winterMonths = northernHemisphere ? WINTER_MONTHS_NH : SUMMER_MONTHS_NH;
  const summerPrecip = sumOf(monthlyPrecipMm, summerMonths);
  const winterPrecip = sumOf(monthlyPrecipMm, winterMonths);
  const map = monthlyPrecipMm.reduce((total, value) => total + value, 0);
  const mat =
    monthlyTempC.reduce((total, value) => total + value, 0) / MONTHS_PER_YEAR;
  return {
    map,
    mat,
    Thot: Math.max(...monthlyTempC),
    Tcold: Math.min(...monthlyTempC),
    Tmon10: monthlyTempC.filter((value) => value >= 10).length,
    Pdry: Math.min(...monthlyPrecipMm),
    Psdry: minOf(monthlyPrecipMm, summerMonths),
    Pwdry: minOf(monthlyPrecipMm, winterMonths),
    Pswet: maxOf(monthlyPrecipMm, summerMonths),
    Pwwet: maxOf(monthlyPrecipMm, winterMonths),
    summerPrecip,
    winterPrecip,
    Pthreshold: precipitationThreshold(mat, map, winterPrecip, summerPrecip),
  };
}

/**
 * Second letter for the C/D groups. When a location satisfies both
 * the dry-summer and dry-winter criteria, Peel et al.'s additional
 * rule applies: w is assigned only if the summer half-year
 * precipitation exceeds the winter half-year precipitation;
 * otherwise s. "Without dry season" is the fall-through.
 * @param {object} vars - derived variables.
 * @returns {string} 's', 'w', or 'f'.
 */
function temperateSecondLetter(vars) {
  const isS = vars.Psdry < 40 && vars.Psdry < vars.Pwwet / 3;
  const isW = vars.Pwdry < vars.Pswet / 10;
  if (isS && isW) {
    return vars.summerPrecip > vars.winterPrecip ? 'w' : 's';
  }
  if (isS) {
    return 's';
  }
  if (isW) {
    return 'w';
  }
  return 'f';
}

/**
 * Third letter for the C/D groups. Thot > 10 guarantees Tmon10 >= 1,
 * so Table 1's "1 <= Tmon10 < 4" bound on 'c' is always satisfiable.
 * @param {object} vars - derived variables.
 * @param {string} group - 'C' or 'D'.
 * @returns {string} 'a', 'b', 'c', or 'd' (D only).
 */
function temperateThirdLetter(vars, group) {
  if (vars.Thot >= 22) {
    return 'a';
  }
  if (vars.Tmon10 >= 4) {
    return 'b';
  }
  if (group === 'D' && vars.Tcold < -38) {
    return 'd';
  }
  return 'c';
}

/**
 * Köppen-Geiger climate type for 12-month climate normals.
 * @param {number[]} monthlyTempC - 12 monthly mean temperatures, °C.
 * @param {number[]} monthlyPrecipMm - 12 monthly precipitations, mm.
 * @param {object} [options] - options.
 * @param {boolean} [options.northernHemisphere=true] - hemisphere for
 *   the summer/winter half-year split.
 * @returns {object|null} the frozen `KOPPEN_TYPES` entry, or null
 *   when the input falls on no published boundary (Thot exactly
 *   10 °C outside the arid group, which no Table 1 row covers).
 */
export function koppenGeiger(monthlyTempC, monthlyPrecipMm, options = {}) {
  checkMonthly(monthlyTempC, 'monthlyTempC', false);
  checkMonthly(monthlyPrecipMm, 'monthlyPrecipMm', true);
  const { northernHemisphere = true } = options ?? {};
  if (typeof northernHemisphere !== 'boolean') {
    throw new TypeError('northernHemisphere must be a boolean');
  }
  const vars = deriveVariables(
    monthlyTempC,
    monthlyPrecipMm,
    northernHemisphere,
  );

  // B first: Peel et al. note a B location also satisfies one of
  // A/C/D/E, so the arid test takes precedence.
  if (vars.map < 10 * vars.Pthreshold) {
    const second = vars.map < 5 * vars.Pthreshold ? 'W' : 'S';
    const heat = vars.mat >= 18 ? 'h' : 'k';
    return TYPE_BY_CODE.get(`B${second}${heat}`);
  }
  if (vars.Thot < 10) {
    return TYPE_BY_CODE.get(vars.Thot > 0 ? 'ET' : 'EF');
  }
  if (vars.Thot > 10) {
    if (vars.Tcold >= 18) {
      let second = 'w';
      if (vars.Pdry >= 60) {
        second = 'f';
      } else if (vars.Pdry >= 100 - vars.map / 25) {
        second = 'm';
      }
      return TYPE_BY_CODE.get(`A${second}`);
    }
    if (vars.Tcold > 0) {
      const second = temperateSecondLetter(vars);
      return TYPE_BY_CODE.get(`C${second}${temperateThirdLetter(vars, 'C')}`);
    }
    const second = temperateSecondLetter(vars);
    return TYPE_BY_CODE.get(`D${second}${temperateThirdLetter(vars, 'D')}`);
  }
  // Thot exactly 10 and not arid: no Table 1 row covers this
  // measure-zero boundary, so return null rather than a bogus type.
  return null;
}

/**
 * Short human label for a classification result, e.g. "Cfb —
 * Temperate, Without dry season, Warm Summer".
 * @param {object|null} entry - a `KOPPEN_TYPES` entry or null.
 * @returns {string} the label, or 'Unclassified' for null.
 */
export function koppenLabel(entry) {
  if (entry === null) {
    return 'Unclassified';
  }
  if (
    !entry ||
    typeof entry.code !== 'string' ||
    !TYPE_BY_CODE.has(entry.code)
  ) {
    throw new TypeError('entry must be a KOPPEN_TYPES entry or null');
  }
  const heatPart = entry.heatName ? `, ${entry.heatName}` : '';
  return `${entry.code} — ${entry.groupName}, ${entry.regimeName}${heatPart}`;
}
