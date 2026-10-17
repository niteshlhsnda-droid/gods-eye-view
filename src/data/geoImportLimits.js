/** Caps shared by the geo file importer and its format parsers. */

/** Most entities one file may create before it is refused. */
export const MAX_IMPORT_ENTITIES = 20_000;
/** Most vertices (points of every line, ring and marker) in one file. */
export const MAX_IMPORT_POSITIONS = 250_000;
/** Largest accepted altitude, in metres. */
export const MAX_IMPORT_ALTITUDE = 1_000_000;
