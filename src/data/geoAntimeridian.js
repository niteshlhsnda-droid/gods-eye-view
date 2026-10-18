/**
 * Split GeoJSON polygons that cross the antimeridian (±180° longitude).
 *
 * A polygon whose ring jumps from +179° to −179° is a single edge across
 * the antimeridian, but most renderers draw the long way round — a
 * horizontal streak across the whole map. Splitting the ring at the
 * antimeridian into pieces that each stay inside [−180, 180] makes the
 * polygon draw correctly on both sides of the date line.
 *
 * Pure module: no imports, no DOM. Operates on coordinate arrays only.
 * Input rings must be closed (first point equals last point); the output
 * rings are closed too. Holes are split the same way and each hole piece
 * is attached to the output polygon whose longitude interval contains
 * the hole piece's first vertex (a heuristic that is exact when a hole
 * lies entirely on one side of the split, the normal case).
 *
 * @module data/geoAntimeridian
 */

/** Antimeridian longitude, east edge. */
export const ANTIMERIDIAN_EAST = 180;
/** Antimeridian longitude, west edge. */
export const ANTIMERIDIAN_WEST = -180;

const EPSILON = 1e-9;

function isFinitePoint(point) {
  return (
    Array.isArray(point) &&
    point.length >= 2 &&
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1])
  );
}

function samePoint(a, b) {
  return Math.abs(a[0] - b[0]) < EPSILON && Math.abs(a[1] - b[1]) < EPSILON;
}

/** Wrap a longitude delta to (−180, 180]. */
function wrapDelta(delta) {
  let wrapped = (((delta + 180) % 360) + 360) % 360;
  if (wrapped === 0) wrapped = 360;
  return wrapped - 180;
}

/** Whether a point lies on the antimeridian (either edge). */
function onAntimeridian(point) {
  return Math.abs(Math.abs(point[0]) - 180) < EPSILON;
}

/**
 * Split one closed ring at the antimeridian.
 * @param {Array<[number, number]>} ring Closed linear ring.
 * @returns {Array<Array<[number, number]>>} One or more closed rings,
 *   each staying inside [−180, 180].
 */
export function splitAntimeridianRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) {
    throw new TypeError('ring must be a closed linear ring of >= 4 points');
  }
  for (const point of ring) {
    if (!isFinitePoint(point)) {
      throw new TypeError('ring points must be finite [lon, lat] pairs');
    }
  }
  if (!samePoint(ring[0], ring[ring.length - 1])) {
    throw new TypeError('ring must be closed (first point equals last)');
  }

  // Walk the edges, cutting at antimeridian crossings. Each cut produces
  // a segment that starts/ends either at the ring start or on a boundary.
  const segments = [];
  let current = [ring[0]];
  const vertices = ring.slice(0, -1);
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const delta = wrapDelta(b[0] - a[0]);
    const unwrappedEnd = a[0] + delta;
    let boundary = null;
    if (unwrappedEnd > 180) boundary = ANTIMERIDIAN_EAST;
    else if (unwrappedEnd < -180) boundary = ANTIMERIDIAN_WEST;
    if (boundary === null) {
      current.push(b);
      continue;
    }
    // Edge crosses the antimeridian: interpolate the crossing latitude.
    const t = (boundary - a[0]) / delta;
    const crossLat = a[1] + t * (b[1] - a[1]);
    current.push([boundary, crossLat]);
    segments.push(current);
    current = [[-boundary, crossLat], b];
  }
  segments.push(current);

  if (segments.length === 1) {
    // No crossing: the single segment is the ring itself.
    return [segments[0]];
  }

  // Pair up the cut points on each side of the antimeridian: sort them
  // by latitude and connect consecutive pairs with an edge that runs
  // along the boundary. A segment ending at (+180, L1) pairs with the
  // segment starting at (+180, L2) — the boundary edge closes the piece
  // on that side. (Cut points on opposite sides are the same geographic
  // point, but pairing across sides would pinch the two pieces into one
  // self-touching ring.)
  const boundaryPoints = [];
  segments.forEach((segment, index) => {
    const first = segment[0];
    const last = segment[segment.length - 1];
    if (onAntimeridian(first)) {
      boundaryPoints.push({ side: Math.sign(first[0]), lat: first[1] });
    }
    if (onAntimeridian(last)) {
      boundaryPoints.push({ side: Math.sign(last[0]), lat: last[1] });
    }
  });
  const pieces = segments.map((segment) => [...segment]);
  for (const side of [1, -1]) {
    const points = boundaryPoints
      .filter((point) => point.side === side)
      .sort((a, b) => a.lat - b.lat);
    for (let i = 0; i + 1 < points.length; i += 2) {
      pieces.push([
        [side * 180, points[i].lat],
        [side * 180, points[i + 1].lat],
      ]);
    }
  }

  // Stitch pieces into closed rings. A piece may be traversed in either
  // direction: match the chain end against a piece start (forward) or a
  // piece end (reversed).
  const used = new Set();
  const output = [];
  for (let s = 0; s < pieces.length; s += 1) {
    if (used.has(s)) continue;
    used.add(s);
    const chain = [...pieces[s]];
    for (;;) {
      const endPoint = chain[chain.length - 1];
      if (samePoint(endPoint, chain[0])) break;
      let next = -1;
      let reversed = false;
      for (let j = 0; j < pieces.length; j += 1) {
        if (used.has(j)) continue;
        if (samePoint(endPoint, pieces[j][0])) {
          next = j;
          reversed = false;
          break;
        }
        if (samePoint(endPoint, pieces[j][pieces[j].length - 1])) {
          next = j;
          reversed = true;
          break;
        }
      }
      if (next === -1) break;
      used.add(next);
      const nextPoints = reversed ? [...pieces[next]].reverse() : pieces[next];
      chain.push(...nextPoints.slice(1));
    }
    if (!samePoint(chain[0], chain[chain.length - 1])) {
      chain.push(chain[0]);
    }
    output.push(chain);
  }
  return output;
}

function ringLonInterval(ring) {
  let min = Infinity;
  let max = -Infinity;
  for (const point of ring) {
    if (point[0] < min) min = point[0];
    if (point[0] > max) max = point[0];
  }
  return [min, max];
}

/**
 * Split a GeoJSON Polygon (or MultiPolygon) at the antimeridian.
 * @param {{type: 'Polygon'|'MultiPolygon', coordinates: Array}} geometry
 * @returns {{type: 'Polygon'|'MultiPolygon', coordinates: Array}} A
 *   Polygon when the input had one output piece, else a MultiPolygon.
 *   Geometries that do not cross are returned unchanged in shape.
 */
export function splitAntimeridianPolygon(geometry) {
  if (
    !geometry ||
    typeof geometry !== 'object' ||
    (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') ||
    !Array.isArray(geometry.coordinates)
  ) {
    throw new TypeError('geometry must be a Polygon or MultiPolygon');
  }
  const polygons =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const outPolygons = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) continue;
    const [exterior, ...holes] = polygon;
    const exteriorPieces = splitAntimeridianRing(exterior);
    const pieces = exteriorPieces.map((ring) => [ring]);
    // Attach each hole piece to the exterior piece whose longitude
    // interval contains the hole piece's first vertex.
    for (const hole of holes) {
      for (const holePiece of splitAntimeridianRing(hole)) {
        const lon = holePiece[0][0];
        let target = pieces[0];
        for (const piece of pieces) {
          const [min, max] = ringLonInterval(piece[0]);
          if (lon >= min - EPSILON && lon <= max + EPSILON) {
            target = piece;
            break;
          }
        }
        target.push(holePiece);
      }
    }
    outPolygons.push(...pieces);
  }
  if (outPolygons.length === 1) {
    return { type: 'Polygon', coordinates: outPolygons[0] };
  }
  return { type: 'MultiPolygon', coordinates: outPolygons };
}
