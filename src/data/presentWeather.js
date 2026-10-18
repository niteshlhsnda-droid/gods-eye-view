/**
 * WMO Code Table 4677: present weather reported from a manned
 * station — the two-digit ww code 00-99 -> plain-language
 * description, plus a phenomenon group and a timing flag.
 *
 * Why a new module: GEV already has weather-adjacent pure helpers
 * (Cycles 1-13 added sunTimes, moonPhase, Beaufort, feelsLike,
 * ICAO Standard Atmosphere, FAA flight categories, sunPosition,
 * EPA AQI, Saffir-Simpson, WHO UV Index, Enhanced Fujita, NOAA
 * Space Weather Scales, and WMO Sea State), but nothing that
 * decodes the present-weather code itself — the single most
 * common weather token in synoptic (SYNOP) reports and station
 * readouts. A weather layer or station readout needs exactly
 * this: one code -> one sentence, with a group for badges /
 * filtering and a timing flag so "rain in the past hour" is
 * never displayed as "raining now". This module is that answer.
 * No layer reads it yet.
 *
 * NUMBERING CORRECTION — read before citing: the 00-99 numeric
 * present-weather table is Code Table 4677 ("Present weather
 * reported from a manned station"), NOT 4678. Code Table 4678
 * is a different register — "Significant weather phenomena"
 * (w'w'), the letter-code scheme used in METAR / SPECI /
 * TAF (intensity / descriptor / precipitation / obscuration /
 * other elements, e.g. +TSRA, -DZ, BR). The WMO Codes Registry
 * entry for 4678 describes exactly that letter scheme. This
 * module implements 4677, the numeric table, and is named
 * accordingly. Do not relabel it 4678.
 *
 * DO NOT APPLY THIS TABLE TO AUTOMATIC-STATION REPORTS. Code
 * Table 4680 ("Present weather reported from an automatic
 * weather station") reuses the same 00-99 numbers with
 * DIFFERENT meanings and reserved slots — e.g. 4680 code 11 is
 * diamond dust (4677 code 11 is patches of shallow fog), 4680
 * code 99 is tornado (4677 code 99 is thunderstorm, heavy,
 * with hail), and 4680 codes 06-09, 13-17, 19, 36-39, 49,
 * 59, 69, 79, 88, 97-98 are reserved. Decoding a 4680 report
 * with this table silently produces wrong weather. The two
 * tables must never be mixed; a 4680 classifier, if ever
 * needed, is a separate module with its own reserved-code
 * handling.
 *
 * The descriptions below are the WMO 4677 wordings, with only
 * two mechanical normalisations: "ob." / "ob" expanded to
 * "observation", and the dash in "mixed - slight" style
 * entries written as a comma. No meaning is changed, and no
 * description is invented: every one of the 100 codes has a
 * published wording.
 *
 * `group` is a GEV editorial grouping by phenomenon family,
 * NOT published by WMO (WMO publishes codes + descriptions
 * only). It exists so callers can badge / filter / colour by
 * family without parsing description text:
 *
 *   sky           00-03   cloud development / state of sky
 *   obscuration   04-05   smoke, haze
 *   dust-sand     06-09, 30-35
 *   fog           10-12, 28, 40-49
 *   electrical    13      lightning visible, no thunder heard
 *   precipitation 14-16, 20-27, 50-90 (incl. showers, virga)
 *   thunderstorm  17, 29, 91-99
 *   squall-funnel 18-19   squalls, funnel clouds
 *   snow-drift    36-39   drifting / blowing snow
 *
 * Two grouping calls worth knowing:
 * - Code 13 is `electrical`, not `thunderstorm`: lightning
 *   was seen but NO thunder was heard, so WMO does not call
 *   it a thunderstorm. Code 17 (thunderstorm, no
 *   precipitation) IS `thunderstorm`.
 * - Code 98 (thunderstorm + dust/sandstorm) is grouped
 *   `thunderstorm`; the dust/sandstorm is carried in its
 *   description, not as a second group — one code, one group.
 *
 * `timing` says WHEN the phenomenon occurred relative to the
 * observation, because the table mixes tenses:
 *
 *   current          at the station at the time of observation
 *   preceding-hour   during the preceding hour but NOT at the
 *                    time of observation (codes 20-29)
 *   sight            within sight / at a distance, not at the
 *                    station (codes 14-16, 40)
 *   mixed            codes 91-94: the thunderstorm was in the
 *                    preceding hour, but the precipitation it
 *                    names IS at the time of observation
 *
 * Display rule: never render a `preceding-hour` or `sight`
 * code as current station weather ("rain" for code 21 is
 * wrong — the rain stopped; "fog" for code 40 is wrong —
 * the fog is elsewhere). Render the timing, e.g. "Rain in
 * the past hour" / "Precipitation in sight, not reaching
 * the ground".
 *
 * Unknown / out-of-range input -> null, never an invented
 * description. `classifyPresentWeather` never throws: any
 * input that is not an integer 0-99 (including numeric
 * strings like '95', floats, NaN, null, undefined) returns
 * null. Callers that need to distinguish "not a code" from
 * "valid code" get exactly that: null means no such code.
 *
 * Sources (two independent national-service reproductions of
 * the WMO table, cross-checked against each other and found
 * to agree on all 100 wordings):
 * - CEDA / BADC, "WMO Meteorological codes" — WMO code 4677
 *   (manned station) in full, plus code 4680 (automatic
 *   station) showing the conflicting reuse of the numbers.
 *   https://artefacts.ceda.ac.uk/badc_datadocs/surface/code.html
 * - Finnish Meteorological Institute, "Present weather: WMO
 *   code 4677" — the same 100 wordings.
 *   https://litdb.fmi.fi/WMO_code_4677.pdf
 * - WMO Codes Registry, Code Table 4678: Significant weather
 *   phenomena — the letter-code register, cited here only
 *   to document that 4678 is NOT the numeric table.
 *   https://codes.wmo.int/306/4678
 *
 * No colours: WMO publishes no colour code for present
 * weather, so none is stored. Display colours are a
 * presentation choice; callers pick their own.
 *
 * Scope limits — read before using the codes:
 * - THE CODE IS ONE OBSERVER'S SUMMARY, NOT A MEASUREMENT.
 *   Codes like 02 ("state of sky unchanged") or 42 ("fog,
 *   sky visible, has become thinner") are judgements about
 *   change over the past hour, not instrument readings.
 *   Never present a code as a sensor value.
 * - ONLY THE HIGHEST-PRIORITY CODE IS REPORTED as ww in a
 *   synoptic report. A station reporting 95 (thunderstorm)
 *   may also have rain, fog, and dust — the code does not
 *   say. Absence of a fog code is not evidence of no fog.
 * - INTENSITY WORDS ARE OBSERVER JUDGEMENTS ("slight /
 *   moderate / heavy / violent") with no published numeric
 *   thresholds in this table. Do not map them to mm/hr or
 *   visibility metres.
 * - PAST WEATHER (W1W2) IS A DIFFERENT GROUP. Codes 20-29
 *   report the preceding hour inside the PRESENT-weather
 *   group; the separate past-weather group uses its own
 *   tables. Do not feed W1W2 figures to this classifier.
 */

/** Lowest present-weather code. */
export const PRESENT_WEATHER_MIN_CODE = 0;

/** Highest present-weather code. */
export const PRESENT_WEATHER_MAX_CODE = 99;

/**
 * Phenomenon-family groups. `id` is the value stored on each
 * scale entry; `label` is a display string. GEV editorial
 * grouping — not published by WMO.
 * @type {ReadonlyArray<Readonly<{ id: string, label: string }>>}
 */
export const PRESENT_WEATHER_GROUPS = Object.freeze([
  Object.freeze({ id: 'sky', label: 'Sky / cloud development' }),
  Object.freeze({ id: 'obscuration', label: 'Obscuration (smoke, haze)' }),
  Object.freeze({ id: 'dust-sand', label: 'Dust / sand' }),
  Object.freeze({ id: 'fog', label: 'Fog / mist' }),
  Object.freeze({ id: 'electrical', label: 'Lightning (no thunder heard)' }),
  Object.freeze({ id: 'precipitation', label: 'Precipitation' }),
  Object.freeze({ id: 'thunderstorm', label: 'Thunderstorm' }),
  Object.freeze({ id: 'squall-funnel', label: 'Squalls / funnel clouds' }),
  Object.freeze({ id: 'snow-drift', label: 'Drifting / blowing snow' }),
]);

/** Group id -> group entry. */
export const PRESENT_WEATHER_GROUP_BY_ID = Object.freeze(
  Object.fromEntries(PRESENT_WEATHER_GROUPS.map((group) => [group.id, group])),
);

/**
 * WMO Code Table 4677 (manned station), codes 00-99 in order.
 * `description` is the published WMO wording (see header for
 * the two mechanical normalisations). `group` is the GEV
 * editorial phenomenon family. `timing` is one of 'current',
 * 'preceding-hour', 'sight', 'mixed' (see header).
 * @type {ReadonlyArray<Readonly<{
 *   code: number,
 *   description: string,
 *   group: string,
 *   timing: string,
 * }>>}
 */
export const PRESENT_WEATHER_SCALE = Object.freeze([
  Object.freeze({
    code: 0,
    description: 'Cloud development not observed or not observable',
    group: 'sky',
    timing: 'current',
  }),
  Object.freeze({
    code: 1,
    description: 'Clouds generally dissolving or becoming less developed',
    group: 'sky',
    timing: 'current',
  }),
  Object.freeze({
    code: 2,
    description: 'State of sky on the whole unchanged',
    group: 'sky',
    timing: 'current',
  }),
  Object.freeze({
    code: 3,
    description: 'Clouds generally forming or developing',
    group: 'sky',
    timing: 'current',
  }),
  Object.freeze({
    code: 4,
    description:
      'Visibility reduced by smoke, e.g. veldt or forest fires, industrial smoke or volcanic ashes',
    group: 'obscuration',
    timing: 'current',
  }),
  Object.freeze({
    code: 5,
    description: 'Haze',
    group: 'obscuration',
    timing: 'current',
  }),
  Object.freeze({
    code: 6,
    description:
      'Widespread dust in suspension in the air, not raised by wind at or near the station at the time of observation',
    group: 'dust-sand',
    timing: 'current',
  }),
  Object.freeze({
    code: 7,
    description:
      'Dust or sand raised by wind at or near the station at the time of observation, but no well-developed dust whirl(s) or sand whirl(s), and no duststorm or sandstorm seen; or, in the case of ships, blowing spray at the station',
    group: 'dust-sand',
    timing: 'current',
  }),
  Object.freeze({
    code: 8,
    description:
      'Well-developed dust or sand whirl(s) seen at or near the station during the preceding hour or at the time of observation, but no duststorm or sandstorm',
    group: 'dust-sand',
    timing: 'current',
  }),
  Object.freeze({
    code: 9,
    description:
      'Duststorm or sandstorm within sight at the time of observation, or at the station during the preceding hour',
    group: 'dust-sand',
    timing: 'current',
  }),
  Object.freeze({
    code: 10,
    description: 'Mist',
    group: 'fog',
    timing: 'current',
  }),
  Object.freeze({
    code: 11,
    description:
      'Patches of shallow fog or ice fog at the station, whether on land or sea, not deeper than about 2 metres on land or 10 metres at sea',
    group: 'fog',
    timing: 'current',
  }),
  Object.freeze({
    code: 12,
    description:
      'More or less continuous shallow fog or ice fog at the station, whether on land or sea, not deeper than about 2 metres on land or 10 metres at sea',
    group: 'fog',
    timing: 'current',
  }),
  Object.freeze({
    code: 13,
    description: 'Lightning visible, no thunder heard',
    group: 'electrical',
    timing: 'current',
  }),
  Object.freeze({
    code: 14,
    description:
      'Precipitation within sight, not reaching the ground or the surface of the sea',
    group: 'precipitation',
    timing: 'sight',
  }),
  Object.freeze({
    code: 15,
    description:
      'Precipitation within sight, reaching the ground or the surface of the sea, but distant, i.e. more than 5 km from the station',
    group: 'precipitation',
    timing: 'sight',
  }),
  Object.freeze({
    code: 16,
    description:
      'Precipitation within sight, reaching the ground or the surface of the sea, near to, but not at the station',
    group: 'precipitation',
    timing: 'sight',
  }),
  Object.freeze({
    code: 17,
    description:
      'Thunderstorm, but no precipitation at the time of observation',
    group: 'thunderstorm',
    timing: 'current',
  }),
  Object.freeze({
    code: 18,
    description:
      'Squalls at or within sight of the station during the preceding hour or at the time of observation',
    group: 'squall-funnel',
    timing: 'current',
  }),
  Object.freeze({
    code: 19,
    description:
      'Funnel clouds at or within sight of the station during the preceding hour or at the time of observation',
    group: 'squall-funnel',
    timing: 'current',
  }),
  Object.freeze({
    code: 20,
    description:
      'Drizzle (not freezing) or snow grains, not falling as showers, during the preceding hour but not at the time of observation',
    group: 'precipitation',
    timing: 'preceding-hour',
  }),
  Object.freeze({
    code: 21,
    description:
      'Rain (not freezing), not falling as showers, during the preceding hour but not at the time of observation',
    group: 'precipitation',
    timing: 'preceding-hour',
  }),
  Object.freeze({
    code: 22,
    description:
      'Snow, not falling as showers, during the preceding hour but not at the time of observation',
    group: 'precipitation',
    timing: 'preceding-hour',
  }),
  Object.freeze({
    code: 23,
    description:
      'Rain and snow or ice pellets, not falling as showers, during the preceding hour but not at the time of observation',
    group: 'precipitation',
    timing: 'preceding-hour',
  }),
  Object.freeze({
    code: 24,
    description:
      'Freezing drizzle or freezing rain, during the preceding hour but not at the time of observation',
    group: 'precipitation',
    timing: 'preceding-hour',
  }),
  Object.freeze({
    code: 25,
    description:
      'Shower(s) of rain during the preceding hour but not at the time of observation',
    group: 'precipitation',
    timing: 'preceding-hour',
  }),
  Object.freeze({
    code: 26,
    description:
      'Shower(s) of snow, or of rain and snow during the preceding hour but not at the time of observation',
    group: 'precipitation',
    timing: 'preceding-hour',
  }),
  Object.freeze({
    code: 27,
    description:
      'Shower(s) of hail, or of rain and hail during the preceding hour but not at the time of observation',
    group: 'precipitation',
    timing: 'preceding-hour',
  }),
  Object.freeze({
    code: 28,
    description:
      'Fog or ice fog during the preceding hour but not at the time of observation',
    group: 'fog',
    timing: 'preceding-hour',
  }),
  Object.freeze({
    code: 29,
    description:
      'Thunderstorm (with or without precipitation) during the preceding hour but not at the time of observation',
    group: 'thunderstorm',
    timing: 'preceding-hour',
  }),
  Object.freeze({
    code: 30,
    description:
      'Slight or moderate duststorm or sandstorm, has decreased during the preceding hour',
    group: 'dust-sand',
    timing: 'current',
  }),
  Object.freeze({
    code: 31,
    description:
      'Slight or moderate duststorm or sandstorm, no appreciable change during the preceding hour',
    group: 'dust-sand',
    timing: 'current',
  }),
  Object.freeze({
    code: 32,
    description:
      'Slight or moderate duststorm or sandstorm, has begun or has increased during the preceding hour',
    group: 'dust-sand',
    timing: 'current',
  }),
  Object.freeze({
    code: 33,
    description:
      'Severe duststorm or sandstorm, has decreased during the preceding hour',
    group: 'dust-sand',
    timing: 'current',
  }),
  Object.freeze({
    code: 34,
    description:
      'Severe duststorm or sandstorm, no appreciable change during the preceding hour',
    group: 'dust-sand',
    timing: 'current',
  }),
  Object.freeze({
    code: 35,
    description:
      'Severe duststorm or sandstorm, has begun or has increased during the preceding hour',
    group: 'dust-sand',
    timing: 'current',
  }),
  Object.freeze({
    code: 36,
    description:
      'Slight or moderate drifting snow, generally low (below eye level)',
    group: 'snow-drift',
    timing: 'current',
  }),
  Object.freeze({
    code: 37,
    description: 'Heavy drifting snow, generally low (below eye level)',
    group: 'snow-drift',
    timing: 'current',
  }),
  Object.freeze({
    code: 38,
    description:
      'Slight or moderate blowing snow, generally high (above eye level)',
    group: 'snow-drift',
    timing: 'current',
  }),
  Object.freeze({
    code: 39,
    description: 'Heavy blowing snow, generally high (above eye level)',
    group: 'snow-drift',
    timing: 'current',
  }),
  Object.freeze({
    code: 40,
    description:
      'Fog or ice fog at a distance at the time of observation, but not at the station during the preceding hour, the fog or ice fog extending to a level above that of the observer',
    group: 'fog',
    timing: 'sight',
  }),
  Object.freeze({
    code: 41,
    description: 'Fog or ice fog in patches',
    group: 'fog',
    timing: 'current',
  }),
  Object.freeze({
    code: 42,
    description:
      'Fog or ice fog, sky visible, has become thinner during the preceding hour',
    group: 'fog',
    timing: 'current',
  }),
  Object.freeze({
    code: 43,
    description:
      'Fog or ice fog, sky invisible, has become thinner during the preceding hour',
    group: 'fog',
    timing: 'current',
  }),
  Object.freeze({
    code: 44,
    description:
      'Fog or ice fog, sky visible, no appreciable change during the preceding hour',
    group: 'fog',
    timing: 'current',
  }),
  Object.freeze({
    code: 45,
    description:
      'Fog or ice fog, sky invisible, no appreciable change during the preceding hour',
    group: 'fog',
    timing: 'current',
  }),
  Object.freeze({
    code: 46,
    description:
      'Fog or ice fog, sky visible, has begun or has become thicker during the preceding hour',
    group: 'fog',
    timing: 'current',
  }),
  Object.freeze({
    code: 47,
    description:
      'Fog or ice fog, sky invisible, has begun or has become thicker during the preceding hour',
    group: 'fog',
    timing: 'current',
  }),
  Object.freeze({
    code: 48,
    description: 'Fog, depositing rime, sky visible',
    group: 'fog',
    timing: 'current',
  }),
  Object.freeze({
    code: 49,
    description: 'Fog, depositing rime, sky invisible',
    group: 'fog',
    timing: 'current',
  }),
  Object.freeze({
    code: 50,
    description:
      'Drizzle, not freezing, intermittent, slight at time of observation',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 51,
    description:
      'Drizzle, not freezing, continuous, slight at time of observation',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 52,
    description:
      'Drizzle, not freezing, intermittent, moderate at time of observation',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 53,
    description:
      'Drizzle, not freezing, continuous, moderate at time of observation',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 54,
    description:
      'Drizzle, not freezing, intermittent, heavy at time of observation',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 55,
    description:
      'Drizzle, not freezing, continuous, heavy at time of observation',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 56,
    description: 'Drizzle, freezing, slight',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 57,
    description: 'Drizzle, freezing, moderate or heavy (dense)',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 58,
    description: 'Rain and drizzle, slight',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 59,
    description: 'Rain and drizzle, moderate or heavy',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 60,
    description:
      'Rain, not freezing, intermittent, slight at time of observation',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 61,
    description:
      'Rain, not freezing, continuous, slight at time of observation',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 62,
    description:
      'Rain, not freezing, intermittent, moderate at time of observation',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 63,
    description:
      'Rain, not freezing, continuous, moderate at time of observation',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 64,
    description:
      'Rain, not freezing, intermittent, heavy at time of observation',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 65,
    description: 'Rain, not freezing, continuous, heavy at time of observation',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 66,
    description: 'Rain, freezing, slight',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 67,
    description: 'Rain, freezing, moderate or heavy',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 68,
    description: 'Rain or drizzle and snow, slight',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 69,
    description: 'Rain or drizzle and snow, moderate or heavy',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 70,
    description:
      'Intermittent fall of snowflakes, slight at time of observation',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 71,
    description: 'Continuous fall of snowflakes, slight at time of observation',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 72,
    description:
      'Intermittent fall of snowflakes, moderate at time of observation',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 73,
    description:
      'Continuous fall of snowflakes, moderate at time of observation',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 74,
    description:
      'Intermittent fall of snowflakes, heavy at time of observation',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 75,
    description: 'Continuous fall of snowflakes, heavy at time of observation',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 76,
    description: 'Diamond dust (with or without fog)',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 77,
    description: 'Snow grains (with or without fog)',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 78,
    description: 'Isolated star-like snow crystals (with or without fog)',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 79,
    description: 'Ice pellets',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 80,
    description: 'Rain shower(s), slight',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 81,
    description: 'Rain shower(s), moderate or heavy',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 82,
    description: 'Rain shower(s), violent',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 83,
    description: 'Shower(s) of rain and snow, slight',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 84,
    description: 'Shower(s) of rain and snow, moderate or heavy',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 85,
    description: 'Snow shower(s), slight',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 86,
    description: 'Snow shower(s), moderate or heavy',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 87,
    description:
      'Shower(s) of snow pellets or small hail, with or without rain or rain and snow mixed, slight',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 88,
    description:
      'Shower(s) of snow pellets or small hail, with or without rain or rain and snow mixed, moderate or heavy',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 89,
    description:
      'Shower(s) of hail, with or without rain or rain and snow mixed, not associated with thunder, slight',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 90,
    description:
      'Shower(s) of hail, with or without rain or rain and snow mixed, not associated with thunder, moderate or heavy',
    group: 'precipitation',
    timing: 'current',
  }),
  Object.freeze({
    code: 91,
    description:
      'Slight rain at time of observation; thunderstorm during the preceding hour but not at time of observation',
    group: 'thunderstorm',
    timing: 'mixed',
  }),
  Object.freeze({
    code: 92,
    description:
      'Moderate or heavy rain at time of observation; thunderstorm during the preceding hour but not at time of observation',
    group: 'thunderstorm',
    timing: 'mixed',
  }),
  Object.freeze({
    code: 93,
    description:
      'Slight snow, or rain and snow mixed or hail at time of observation; thunderstorm during the preceding hour but not at time of observation',
    group: 'thunderstorm',
    timing: 'mixed',
  }),
  Object.freeze({
    code: 94,
    description:
      'Moderate or heavy snow, or rain and snow mixed or hail at time of observation; thunderstorm during the preceding hour but not at time of observation',
    group: 'thunderstorm',
    timing: 'mixed',
  }),
  Object.freeze({
    code: 95,
    description:
      'Thunderstorm, slight or moderate, without hail, but with rain and/or snow at time of observation',
    group: 'thunderstorm',
    timing: 'current',
  }),
  Object.freeze({
    code: 96,
    description:
      'Thunderstorm, slight or moderate, with hail at time of observation',
    group: 'thunderstorm',
    timing: 'current',
  }),
  Object.freeze({
    code: 97,
    description:
      'Thunderstorm, heavy, without hail, but with rain and/or snow at time of observation',
    group: 'thunderstorm',
    timing: 'current',
  }),
  Object.freeze({
    code: 98,
    description:
      'Thunderstorm combined with dust/sandstorm at time of observation',
    group: 'thunderstorm',
    timing: 'current',
  }),
  Object.freeze({
    code: 99,
    description: 'Thunderstorm, heavy, with hail at time of observation',
    group: 'thunderstorm',
    timing: 'current',
  }),
]);

/** Present-weather code (0..99) -> scale entry. */
export const PRESENT_WEATHER_BY_CODE = Object.freeze(
  Object.fromEntries(PRESENT_WEATHER_SCALE.map((entry) => [entry.code, entry])),
);

/**
 * Classifies a present-weather code on WMO Code Table 4677.
 *
 * @param {number} code - integer present-weather code, 0-99.
 * @returns {object|null} the frozen scale entry for the code,
 *   or null for any input that is not an integer 0-99. Never
 *   throws, never invents a description.
 */
export function classifyPresentWeather(code) {
  if (
    typeof code !== 'number' ||
    !Number.isInteger(code) ||
    code < PRESENT_WEATHER_MIN_CODE ||
    code > PRESENT_WEATHER_MAX_CODE
  ) {
    return null;
  }
  return PRESENT_WEATHER_BY_CODE[code];
}

/**
 * Returns the phenomenon-family group id for a present-weather
 * code ('sky', 'fog', 'precipitation', ...), or null for any
 * input that is not an integer 0-99.
 *
 * @param {number} code - integer present-weather code, 0-99.
 * @returns {string|null} the group id, or null.
 */
export function presentWeatherGroup(code) {
  const entry = classifyPresentWeather(code);
  return entry === null ? null : entry.group;
}
