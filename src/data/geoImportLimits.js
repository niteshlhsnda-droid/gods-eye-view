/**
 * The single source for geo-import size caps.
 *
 * The file importer (`geoFileImport.js`) and the WKT parser
 * (`wktGeoImport.js`) used to each declare these numbers; two copies of
 * one limit drift apart silently, and a file refused by one half of the
 * import would have been accepted by the other. Both import from here,
 * so there is exactly one 20,000 and one 250,000 to change.
 */

/** Most entities one file may create before it is refused. */
export const MAX_IMPORT_ENTITIES = 20_000;
/** Most vertices (points of every line, ring and marker) in one file. */
export const MAX_IMPORT_POSITIONS = 250_000;
/** Largest accepted altitude, in metres. */
export const MAX_IMPORT_ALTITUDE = 1_000_000;
