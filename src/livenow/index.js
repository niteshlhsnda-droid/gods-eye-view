/**
 * Live Now public entry — the `./livenow` package export (browser boundary).
 *
 * Everything a host app needs to mount the feature: the panel controller,
 * the card builder, the data service, the marker layer, and the tour
 * authoring. Hosts inject their viewer/services; this module never reaches
 * for singletons on its own.
 */
export { createLiveNowPanel } from './panel.js';
export {
  createEventCard,
  formatTimeAgo,
  formatSourceCount,
  severityIcon,
} from './card.js';
export {
  fetchLiveNow,
  validateLiveNowPayload,
  minutesSinceGenerated,
  hasFreshCriticalEvent,
  LIVE_NOW_API_PATH,
  LIVE_NOW_STATIC_PATH,
} from './service.js';
export {
  createLiveNowMarkers,
  selectTopMarkers,
  eventToDeckDatum,
  liveNowScatterProps,
  pulseRadiusMeters,
  severityColor,
} from './markers.js';
export {
  buildLiveNowTour,
  selectTourEvents,
  validateTourProject,
  encodeTourFragment,
  tourShareUrl,
  tourAltitudeForSeverity,
} from './tour.js';
export { ln, detectLocale, LIVE_NOW_LOCALES } from './strings.js';
