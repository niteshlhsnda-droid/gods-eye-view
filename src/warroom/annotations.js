/**
 * Shared-annotation model (pure). Annotations live in the room's Y.Doc as
 * plain objects inside the `annotations` Y.Array; these helpers build and
 * validate them. Network sync is owned by src/warroom/index.js.
 */

export const ANNOTATION_KINDS = Object.freeze(['pin', 'note', 'area', 'route']);

let _counter = 0;

/** Build a validated annotation object. Throws on invalid input. */
export function createAnnotation({
  id = `ann-${Date.now().toString(36)}-${(_counter += 1)}`,
  kind = 'pin',
  lat,
  lon,
  text = '',
  author = 'anonymous',
  color = '#ffb020',
} = {}) {
  const annotation = {
    id: String(id),
    kind,
    lat: Number(lat),
    lon: Number(lon),
    text: String(text),
    author: String(author),
    color: String(color),
  };
  const errors = validateAnnotation(annotation);
  if (errors.length > 0)
    throw new TypeError(`Invalid annotation: ${errors.join('; ')}`);
  return annotation;
}

/** Return a list of validation errors (empty = valid). */
export function validateAnnotation(annotation) {
  const errors = [];
  if (!annotation || typeof annotation !== 'object') return ['not an object'];
  if (typeof annotation.id !== 'string' || !annotation.id)
    errors.push('id must be a non-empty string');
  if (!ANNOTATION_KINDS.includes(annotation.kind))
    errors.push(`kind must be one of ${ANNOTATION_KINDS.join(', ')}`);
  if (
    !Number.isFinite(annotation.lat) ||
    annotation.lat < -90 ||
    annotation.lat > 90
  )
    errors.push('lat must be within [-90, 90]');
  if (
    !Number.isFinite(annotation.lon) ||
    annotation.lon < -180 ||
    annotation.lon > 180
  )
    errors.push('lon must be within [-180, 180]');
  if (typeof annotation.text !== 'string') errors.push('text must be a string');
  return errors;
}

/** Insert or replace by id (immutable). */
export function upsertAnnotation(list, annotation) {
  const errors = validateAnnotation(annotation);
  if (errors.length > 0)
    throw new TypeError(`Invalid annotation: ${errors.join('; ')}`);
  const next = (list ?? []).filter((a) => a?.id !== annotation.id);
  next.push(annotation);
  return next;
}

/** Remove by id (immutable). */
export function removeAnnotation(list, id) {
  return (list ?? []).filter((a) => a?.id !== id);
}

/** Index a list by id for O(1) lookup. */
export function indexAnnotations(list) {
  const index = new Map();
  for (const annotation of list ?? []) {
    if (annotation?.id) index.set(annotation.id, annotation);
  }
  return index;
}
