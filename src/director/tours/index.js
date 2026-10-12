/**
 * Director Mode tours: one-click cinematic auto-tours of live events.
 * Driven by anime.js timelines; shareable as replayable hash links.
 */
export {
  buildEventTour,
  tourFromEarthquakeRecord,
  normalizeTourEvent,
  planAnimeShots,
  resolvePose,
  createTourRunner,
  describeTour,
  TOUR_EVENT_KINDS,
} from './autoTour.js';
export {
  encodeTourLink,
  decodeTourLink,
  tourShareUrl,
  installTourLinkWatcher,
} from './tourLink.js';
