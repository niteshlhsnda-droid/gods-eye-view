/**
 * MapInfo Interchange Format (MIF/MID) → GeoJSON — pure functions, no
 * Cesium/DOM/network/Node.
 *
 * Format (MapInfo MIF/MID interchange): a `.mif` text file carries a header
 * (`Version`, `Charset`, `Delimiter`, `CoordSys`, `Columns`) then a `Data`
 * section of one object per geometry; an optional sibling `.mid` file
 * carries one delimiter-separated attribute row per object, in order.
 *
 * Strict whole-input refusal: ANY problem — non-WGS-84 `CoordSys`, bad or
 * out-of-range coordinates, degenerate geometry, unsupported object type,
 * malformed header/MID, MID row-count mismatch, cap breach — throws
 * {@link MifImportError} and yields no partial output. A caller must never
 * import a file this parser half-accepted.
 *
 * CRS posture: only `CoordSys Earth Projection 1, 104` (longitude/latitude,
 * WGS 84 datum 104) is accepted. Projected systems, other datums, `NonEarth`,
 * `Layout`, a missing `CoordSys`, and non-degree units are all refused.
 * MIF x is longitude, y is latitude.
 *
 * Geometry mapping (MIF → GeoJSON):
 * - `Point` → Point. `Line` → LineString. `Pline` → LineString (sections
 *   concatenated) or MultiLineString when declared `Multiple`.
 * - `Region` → Polygon (one ring set) or MultiPolygon (one Polygon per
 *   MIF polygon). Hole reconstruction is NOT attempted: a Region polygon
 *   that is really a hole imports as its own polygon. Ring orientation is
 *   preserved as authored, not re-oriented to the GeoJSON right-hand rule.
 * - `Rect` → closed Polygon from the normalized corners. `RoundRect` →
 *   the same bounding-rect Polygon; the corner radius is ignored.
 * - `Ellipse` → 64-segment closed Polygon approximation.
 * - `Arc` → 33-point LineString along the ellipse bounded by the given
 *   rect. Angles are degrees, 0° = east, increasing counter-clockwise in
 *   map coordinates; start == end is refused as ambiguous (it cannot
 *   distinguish a zero-length arc from a full ellipse).
 * - `Text "label" x1 y1 …` → Point at (x1, y1) with `properties.label`.
 * - `Multipoint` → MultiPoint.
 * - `Spline` and `Collection` are refused: a spline cannot be reproduced
 *   exactly as straight segments, and collections nest objects this
 *   parser does not model. `Pen`/`Brush`/`Symbol`/`Font`/`Smooth`/
 *   `Center`/`Label`/`Justify`/`Angle`/`Spacing` style lines are skipped.
 *
 * MID attributes: column types coerce values (`Integer`/`SmallInt` must be
 * integral, `Decimal`/`Float` numeric, `Logical` T/F/true/false/Y/N/yes/no,
 * `Char`/`Date`/`Time`/`DateTime` stay strings, empty fields become
 * `null`). A MID row with more fields than columns, a non-numeric value in
 * a numeric column, or an unterminated quote refuses the whole input.
 * Rows with fewer fields than columns are padded with `null` (trailing
 * empty fields are routinely dropped by MID writers).
 *
 * Caps mirror the geo file importer: 20,000 features / 250,000 positions.
 * Generated ellipse/arc vertices count toward the position cap.
 */

/** Feature cap, mirroring the geo file importer. */
export const MAX_MIF_FEATURES = 20_000;
/** Position cap, mirroring the geo file importer. */
export const MAX_MIF_POSITIONS = 250_000;

/** WGS 84 datum code in a MIF `CoordSys Earth Projection 1, <datum>` line. */
const WGS84_DATUM = 104;
/** Segments used to approximate an `Ellipse` (plus the closing point). */
const ELLIPSE_SEGMENTS = 64;
/** Segments used to approximate an `Arc` (plus the closing endpoint). */
const ARC_SEGMENTS = 32;

/** Style-clause keywords that may follow an object and are skipped. */
const STYLE_KEYWORDS = new Set([
  'pen',
  'brush',
  'symbol',
  'font',
  'smooth',
  'center',
  'label',
  'justify',
  'angle',
  'spacing',
]);

/** MID column types this parser coerces. */
const MID_TYPES = new Set([
  'char',
  'integer',
  'smallint',
  'decimal',
  'float',
  'date',
  'time',
  'datetime',
  'logical',
]);

const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const INTEGER_PATTERN = /^[+-]?\d+$/;

/** Thrown for any MIF/MID problem; the whole input is refused. */
export class MifImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MifImportError';
  }
}

function fail(message) {
  throw new MifImportError(message);
}

/**
 * Cheap "is this a MIF file?" check for loader sniffing. Never throws.
 * @param {unknown} text - Candidate file text.
 * @returns {boolean} True when the text carries MIF header markers.
 */
export function isMifText(text) {
  if (typeof text !== 'string') return false;
  return (
    /^\s*Version\s+\d+/m.test(text) &&
    /^\s*CoordSys\b/m.test(text) &&
    /^\s*Data\s*$/m.test(text)
  );
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseNumber(token, what) {
  if (!NUMBER_PATTERN.test(token)) {
    fail(`Invalid number for ${what}: ${JSON.stringify(token)}`);
  }
  const value = Number(token);
  if (!Number.isFinite(value)) {
    fail(`Non-finite number for ${what}: ${JSON.stringify(token)}`);
  }
  return value;
}

function checkCoord(lon, lat) {
  if (lon < -180 || lon > 180) {
    fail(`Longitude out of range [-180, 180]: ${lon}`);
  }
  if (lat < -90 || lat > 90) {
    fail(`Latitude out of range [-90, 90]: ${lat}`);
  }
}

/**
 * Match `count` leading numbers in `rest` (separated by whitespace and/or
 * commas), then validate that what follows is empty or a style clause.
 * @returns {{values: Array<number>, rest: string}}
 */
function matchNumbers(rest, count, what) {
  let cursor = 0;
  const values = [];
  for (let i = 0; i < count; i += 1) {
    const match = /^[\s,]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(
      rest.slice(cursor),
    );
    if (!match) {
      fail(
        `Invalid number for ${what}: expected ${count} numbers, ` +
          `got: ${rest.trim()}`,
      );
    }
    cursor += match[0].length;
    values.push(parseNumber(match[1], what));
  }
  const trailing = rest.slice(cursor);
  if (trailing !== '' && !/^[\s,]/.test(trailing)) {
    fail(`Unexpected trailing content for ${what}: ${trailing.trim()}`);
  }
  if (trailing.trim() !== '') {
    const keyword = trailing.trim().split(/[\s(]/, 1)[0].toLowerCase();
    if (!STYLE_KEYWORDS.has(keyword)) {
      fail(`Unexpected trailing content for ${what}: ${trailing.trim()}`);
    }
  }
  return { values, rest: trailing };
}

/**
 * Parse a `"..."` quoted string starting at `text[start]` (`""` = literal
 * quote). @returns {{value: string, end: number}} Index just past the
 * closing quote.
 */
function parseQuoted(text, start) {
  if (text[start] !== '"') {
    fail(`Expected a quoted string at: ${text.slice(start, start + 24)}`);
  }
  let value = '';
  let i = start + 1;
  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      if (text[i + 1] === '"') {
        value += '"';
        i += 2;
        continue;
      }
      return { value, end: i + 1 };
    }
    value += char;
    i += 1;
  }
  fail('Unterminated quoted string');
  return { value: '', end: i };
}

function parseCoordSys(line) {
  const earth =
    /^\s*CoordSys\s+Earth\s+Projection\s+(\d+)\s*,\s*(\d+)\s*(?:,\s*"([^"]*)"\s*)?$/i.exec(
      line,
    );
  if (earth) {
    const projection = Number(earth[1]);
    const datum = Number(earth[2]);
    if (projection !== 1) {
      fail(
        'Only WGS-84 longitude/latitude MIF files are accepted ' +
          `(CoordSys Earth Projection 1, ${WGS84_DATUM}); this file declares ` +
          `projected system ${projection} and was refused whole.`,
      );
    }
    if (datum !== WGS84_DATUM) {
      fail(
        'Only WGS-84 longitude/latitude MIF files are accepted ' +
          `(CoordSys Earth Projection 1, ${WGS84_DATUM}); this file declares ` +
          `datum ${datum} and was refused whole.`,
      );
    }
    if (earth[3] !== undefined && !/^degrees?$/i.test(earth[3])) {
      fail(
        'Only WGS-84 longitude/latitude MIF files are accepted; ' +
          `this file declares units ${JSON.stringify(earth[3])} ` +
          'and was refused whole.',
      );
    }
    return;
  }
  fail(
    'Only WGS-84 longitude/latitude MIF files are accepted ' +
      `(CoordSys Earth Projection 1, ${WGS84_DATUM}); this file declares ` +
      `${JSON.stringify(line.trim())} and was refused whole.`,
  );
}

function parseColumnDefinition(line) {
  const match =
    /^\s*(?:"((?:[^"]|"")*)"|([A-Za-z_][A-Za-z0-9_]*))\s+([A-Za-z]+)(?:\s*\([^)]*\))?\s*$/.exec(
      line,
    );
  if (!match) {
    fail(`Malformed column definition: ${JSON.stringify(line.trim())}`);
  }
  const name = match[1] !== undefined ? match[1].replace(/""/g, '"') : match[2];
  const type = match[3].toLowerCase();
  if (!name) fail('Column definition has an empty name');
  if (!MID_TYPES.has(type)) {
    fail(`Unsupported column type ${JSON.stringify(match[3])} for ${name}`);
  }
  return { name, type };
}

function parseHeader(headerLines) {
  let seenVersion = false;
  let seenCharset = false;
  let seenDelimiter = false;
  let seenCoordSys = false;
  let seenColumns = false;
  let delimiter = '\t';
  let columns = null;
  for (let i = 0; i < headerLines.length; i += 1) {
    const line = headerLines[i];
    if (line.trim() === '') continue;
    const first = line.trim().split(/\s/, 1)[0].toLowerCase();
    if (first === 'version') {
      if (seenVersion) fail('Duplicate Version clause in MIF header');
      if (!/^\s*Version\s+\d+\s*$/i.test(line)) {
        fail(`Malformed Version clause: ${JSON.stringify(line.trim())}`);
      }
      seenVersion = true;
    } else if (first === 'charset') {
      if (seenCharset) fail('Duplicate Charset clause in MIF header');
      if (!/^\s*Charset\s+(?:"[^"]*"|\S+)\s*$/i.test(line)) {
        fail(`Malformed Charset clause: ${JSON.stringify(line.trim())}`);
      }
      seenCharset = true;
    } else if (first === 'delimiter') {
      if (seenDelimiter) fail('Duplicate Delimiter clause in MIF header');
      const match = /^\s*Delimiter\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(line);
      if (!match) {
        fail(`Malformed Delimiter clause: ${JSON.stringify(line.trim())}`);
      }
      const raw = match[1].replace(/\\t/g, '\t').replace(/\\"/g, '"');
      if (raw.length !== 1 || raw === '\n' || raw === '\r') {
        fail(
          `Delimiter must be a single non-newline character: ${JSON.stringify(match[1])}`,
        );
      }
      delimiter = raw;
      seenDelimiter = true;
    } else if (first === 'coordsys') {
      if (seenCoordSys) fail('Duplicate CoordSys clause in MIF header');
      parseCoordSys(line);
      seenCoordSys = true;
    } else if (first === 'columns') {
      if (seenColumns) fail('Duplicate Columns clause in MIF header');
      const match = /^\s*Columns\s+(\d+)\s*$/i.exec(line);
      if (!match) {
        fail(`Malformed Columns clause: ${JSON.stringify(line.trim())}`);
      }
      const count = Number(match[1]);
      columns = [];
      const names = new Set();
      while (columns.length < count) {
        i += 1;
        if (i >= headerLines.length) {
          fail(`Columns declares ${count} columns but the header ends early`);
        }
        if (headerLines[i].trim() === '') continue;
        const column = parseColumnDefinition(headerLines[i]);
        if (names.has(column.name.toLowerCase())) {
          fail(`Duplicate column name: ${JSON.stringify(column.name)}`);
        }
        names.add(column.name.toLowerCase());
        columns.push(column);
      }
      seenColumns = true;
    } else {
      fail(`Unsupported MIF header clause: ${JSON.stringify(line.trim())}`);
    }
  }
  if (!seenVersion) fail('MIF header is missing the Version clause');
  if (!seenCoordSys) fail('MIF header is missing the CoordSys clause');
  if (!seenColumns) fail('MIF header is missing the Columns clause');
  return { delimiter, columns };
}

function splitMidLine(line, delimiter) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      fields.push(field);
      field = '';
      continue;
    }
    field += char;
  }
  if (inQuotes) fail('Unterminated quoted field in MID row');
  fields.push(field);
  return fields;
}

function coerceMidValue(raw, column) {
  if (raw === '') return null;
  if (
    column.type === 'char' ||
    column.type === 'date' ||
    column.type === 'time' ||
    column.type === 'datetime'
  ) {
    return raw;
  }
  if (column.type === 'integer' || column.type === 'smallint') {
    if (!INTEGER_PATTERN.test(raw)) {
      fail(
        `MID value for integer column ${JSON.stringify(column.name)} ` +
          `is not an integer: ${JSON.stringify(raw)}`,
      );
    }
    return Number(raw);
  }
  if (column.type === 'decimal' || column.type === 'float') {
    if (!NUMBER_PATTERN.test(raw) || !Number.isFinite(Number(raw))) {
      fail(
        `MID value for numeric column ${JSON.stringify(column.name)} ` +
          `is not a number: ${JSON.stringify(raw)}`,
      );
    }
    return Number(raw);
  }
  if (column.type === 'logical') {
    if (/^(t|true|y|yes)$/i.test(raw)) return true;
    if (/^(f|false|n|no)$/i.test(raw)) return false;
    fail(
      `MID value for logical column ${JSON.stringify(column.name)} ` +
        `is not T/F: ${JSON.stringify(raw)}`,
    );
  }
  return raw;
}

function parseMid(midText, delimiter, columns, featureCount) {
  if (midText === null || midText === undefined) return null;
  if (typeof midText !== 'string') {
    fail('MID input must be a string or null');
  }
  const rows = stripBom(midText).split(/\r\n|\r|\n/);
  if (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  if (rows.length !== featureCount) {
    fail(
      `MID row count (${rows.length}) does not match MIF object count ` +
        `(${featureCount}); both files were refused whole.`,
    );
  }
  return rows.map((row) => {
    const fields = splitMidLine(row, delimiter);
    if (fields.length > columns.length) {
      fail(
        `MID row has ${fields.length} fields but Columns declares ` +
          `${columns.length}: ${JSON.stringify(row)}`,
      );
    }
    while (fields.length < columns.length) fields.push('');
    const properties = {};
    columns.forEach((column, index) => {
      properties[column.name] = coerceMidValue(fields[index], column);
    });
    return properties;
  });
}

/**
 * Parse MIF text (plus optional MID text) into a GeoJSON FeatureCollection.
 * @param {string} mifText - Full contents of the `.mif` file.
 * @param {?string} [midText=null] - Full contents of the `.mid` file, when
 *   present. `null` means no attribute file: every feature gets `{}`.
 * @returns {{type: 'FeatureCollection', features: Array}} GeoJSON.
 */
export function parseMifToFeatureCollection(mifText, midText = null) {
  if (typeof mifText !== 'string') {
    fail('MIF input must be a string');
  }
  const lines = stripBom(mifText).split(/\r\n|\r|\n/);
  const dataIndex = lines.findIndex((line) => /^\s*Data\s*$/i.test(line));
  if (dataIndex === -1) {
    fail('MIF input has no Data section');
  }
  const { delimiter, columns } = parseHeader(lines.slice(0, dataIndex));
  const body = lines.slice(dataIndex + 1);

  let positionCount = 0;
  const countPositions = (count) => {
    positionCount += count;
    if (positionCount > MAX_MIF_POSITIONS) {
      fail(`MIF input exceeds ${MAX_MIF_POSITIONS.toLocaleString()} positions`);
    }
  };

  const geometries = [];
  const labels = [];
  let cursor = 0;

  const readPointLine = () => {
    if (cursor >= body.length) fail('Unexpected end of MIF Data section');
    const line = body[cursor];
    cursor += 1;
    const match =
      /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[\s,]+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*$/.exec(
        line,
      );
    if (!match) {
      fail(`Expected a coordinate pair, got: ${JSON.stringify(line.trim())}`);
    }
    const lon = parseNumber(match[1], 'coordinate');
    const lat = parseNumber(match[2], 'coordinate');
    checkCoord(lon, lat);
    return [lon, lat];
  };

  const readCountLine = (what) => {
    if (cursor >= body.length) fail('Unexpected end of MIF Data section');
    const line = body[cursor];
    cursor += 1;
    const match = /^\s*(\d+)\s*$/.exec(line);
    if (!match) {
      fail(`Expected a count for ${what}, got: ${JSON.stringify(line.trim())}`);
    }
    return Number(match[1]);
  };

  const skipStyleLines = () => {
    while (cursor < body.length) {
      const trimmed = body[cursor].trim();
      if (trimmed === '') {
        cursor += 1;
        continue;
      }
      const keyword = trimmed.split(/[\s(]/, 1)[0].toLowerCase();
      if (!STYLE_KEYWORDS.has(keyword)) break;
      cursor += 1;
    }
  };

  while (cursor < body.length) {
    if (body[cursor].trim() === '') {
      cursor += 1;
      continue;
    }
    const line = body[cursor];
    cursor += 1;
    const keyword = line.trim().split(/[\s(]/, 1)[0].toLowerCase();
    const rest = line.trim().slice(keyword.length);
    let geometry = null;
    let label = null;

    if (keyword === 'point') {
      const { values } = matchNumbers(rest, 2, 'Point');
      checkCoord(values[0], values[1]);
      countPositions(1);
      geometry = { type: 'Point', coordinates: [values[0], values[1]] };
    } else if (keyword === 'line') {
      const { values } = matchNumbers(rest, 4, 'Line');
      checkCoord(values[0], values[1]);
      checkCoord(values[2], values[3]);
      countPositions(2);
      geometry = {
        type: 'LineString',
        coordinates: [
          [values[0], values[1]],
          [values[2], values[3]],
        ],
      };
    } else if (keyword === 'pline') {
      const header = /^\s*(Multiple)?\s*(\d+)(?:\s+Smooth)?\s*$/i.exec(rest);
      if (!header) {
        fail(`Malformed Pline header: ${JSON.stringify(line.trim())}`);
      }
      const multiple = header[1] !== undefined;
      const sections = Number(header[2]);
      if (sections < 1) fail('Pline declares zero sections');
      const parts = [];
      for (let s = 0; s < sections; s += 1) {
        const count = readCountLine('Pline section');
        if (count < 2) fail('Pline section needs at least 2 points');
        const points = [];
        for (let p = 0; p < count; p += 1) points.push(readPointLine());
        countPositions(count);
        parts.push(points);
      }
      geometry = multiple
        ? { type: 'MultiLineString', coordinates: parts }
        : {
            type: 'LineString',
            coordinates: parts.flat(),
          };
    } else if (keyword === 'region') {
      const header = /^\s*(\d+)\s*$/.exec(rest);
      if (!header) {
        fail(`Malformed Region header: ${JSON.stringify(line.trim())}`);
      }
      const polygons = Number(header[1]);
      if (polygons < 1) fail('Region declares zero polygons');
      const rings = [];
      for (let r = 0; r < polygons; r += 1) {
        const count = readCountLine('Region polygon');
        if (count < 3) fail('Region polygon needs at least 3 points');
        const points = [];
        for (let p = 0; p < count; p += 1) points.push(readPointLine());
        const first = points[0];
        const last = points[points.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          points.push([first[0], first[1]]);
        }
        const distinct = new Set(points.map((p) => `${p[0]},${p[1]}`));
        if (points.length < 4 || distinct.size < 3) {
          fail('Region polygon is degenerate (fewer than 3 distinct points)');
        }
        countPositions(points.length);
        rings.push(points);
      }
      geometry =
        rings.length === 1
          ? { type: 'Polygon', coordinates: [rings[0]] }
          : { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) };
    } else if (keyword === 'rect' || keyword === 'roundrect') {
      const needed = keyword === 'rect' ? 4 : 5;
      const { values } = matchNumbers(rest, needed, keyword);
      if (
        keyword === 'roundrect' &&
        (!Number.isFinite(values[4]) || values[4] < 0)
      ) {
        fail(`RoundRect corner radius must be >= 0: ${values[4]}`);
      }
      const [x1, y1, x2, y2] = values;
      if (x1 === x2 || y1 === y2) {
        fail(`${keyword} is degenerate (zero width or height)`);
      }
      checkCoord(x1, y1);
      checkCoord(x2, y2);
      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);
      countPositions(5);
      geometry = {
        type: 'Polygon',
        coordinates: [
          [
            [minX, minY],
            [maxX, minY],
            [maxX, maxY],
            [minX, maxY],
            [minX, minY],
          ],
        ],
      };
    } else if (keyword === 'ellipse') {
      const { values } = matchNumbers(rest, 4, 'Ellipse');
      const [x1, y1, x2, y2] = values;
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      if (rx === 0 || ry === 0) fail('Ellipse is degenerate (zero radius)');
      checkCoord(cx, cy);
      const ring = [];
      for (let i = 0; i <= ELLIPSE_SEGMENTS; i += 1) {
        if (i === ELLIPSE_SEGMENTS) {
          // Snap the closing vertex to the first one: recomputing it via
          // sin(2π) leaves floating-point noise, breaking first == last.
          ring.push([ring[0][0], ring[0][1]]);
          continue;
        }
        const angle = (2 * Math.PI * i) / ELLIPSE_SEGMENTS;
        const point = [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)];
        checkCoord(point[0], point[1]);
        ring.push(point);
      }
      countPositions(ring.length);
      geometry = { type: 'Polygon', coordinates: [ring] };
    } else if (keyword === 'arc') {
      const { values } = matchNumbers(rest, 6, 'Arc');
      const [x1, y1, x2, y2, start, end] = values;
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      if (rx === 0 || ry === 0) fail('Arc is degenerate (zero radius)');
      checkCoord(cx, cy);
      const sweep = (((end - start) % 360) + 360) % 360;
      if (sweep === 0) {
        fail('Arc start and end angles are equal (ambiguous arc)');
      }
      const points = [];
      for (let i = 0; i <= ARC_SEGMENTS; i += 1) {
        const angle = ((start + (sweep * i) / ARC_SEGMENTS) * Math.PI) / 180;
        const point = [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)];
        checkCoord(point[0], point[1]);
        points.push(point);
      }
      countPositions(points.length);
      geometry = { type: 'LineString', coordinates: points };
    } else if (keyword === 'text') {
      const trimmed = rest.trimStart();
      if (!trimmed.startsWith('"')) {
        fail(
          `Text object needs a quoted label: ${JSON.stringify(line.trim())}`,
        );
      }
      const quoted = parseQuoted(trimmed, 0);
      label = quoted.value;
      const { values } = matchNumbers(trimmed.slice(quoted.end), 4, 'Text');
      checkCoord(values[0], values[1]);
      checkCoord(values[2], values[3]);
      countPositions(1);
      geometry = { type: 'Point', coordinates: [values[0], values[1]] };
    } else if (keyword === 'multipoint') {
      const header = /^\s*(\d+)\s*$/.exec(rest);
      if (!header) {
        fail(`Malformed Multipoint header: ${JSON.stringify(line.trim())}`);
      }
      const count = Number(header[1]);
      if (count < 1) fail('Multipoint declares zero points');
      const points = [];
      for (let p = 0; p < count; p += 1) points.push(readPointLine());
      countPositions(count);
      geometry = { type: 'MultiPoint', coordinates: points };
    } else if (keyword === 'spline') {
      fail('Spline objects are not supported (no exact polyline mapping)');
    } else if (keyword === 'collection') {
      fail('Collection objects are not supported (nested objects)');
    } else {
      fail(`Unknown MIF object: ${JSON.stringify(line.trim())}`);
    }

    if (geometries.length + 1 > MAX_MIF_FEATURES) {
      fail(`MIF input exceeds ${MAX_MIF_FEATURES.toLocaleString()} features`);
    }
    geometries.push(geometry);
    labels.push(label);
    skipStyleLines();
  }

  const midProperties = parseMid(
    midText,
    delimiter,
    columns,
    geometries.length,
  );
  const features = geometries.map((geometry, index) => {
    const properties = midProperties ? { ...midProperties[index] } : {};
    if (labels[index] !== null) properties.label = labels[index];
    return { type: 'Feature', geometry, properties };
  });
  return { type: 'FeatureCollection', features };
}
