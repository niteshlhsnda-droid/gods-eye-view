/**
 * City Drives — virtual drive-throughs + live local radio, launched from the globe.
 *
 * The 20 cities below link out to driveandlisten.app, whose `/city/<slug>` pages
 * pair a drive-through video with local radio. The footage there is RECORDED
 * (dashcam clips), not live — the UI must always label it as such (see the
 * honest-label rule in src/ui/cityDrivesPanel.js). Live radio streams are resolved
 * separately per city via radio-browser.info (src/data/cityDriveRadio.js).
 *
 * Credits are owed to every source whose work this feature leans on; the panel
 * footer renders SOURCE_CREDITS on every open.
 */

/** driveSlug is the driveandlisten.app /city/ slug for the city. */
export const CITY_DRIVES = Object.freeze([
  { id: 'delhi', name: 'Delhi', country: 'India', lat: 28.6139, lon: 77.209, driveSlug: 'delhi' },
  { id: 'mumbai', name: 'Mumbai', country: 'India', lat: 19.076, lon: 72.8777, driveSlug: 'mumbai' },
  { id: 'chennai', name: 'Chennai', country: 'India', lat: 13.0827, lon: 80.2707, driveSlug: 'chennai' },
  { id: 'kolkata', name: 'Kolkata', country: 'India', lat: 22.5726, lon: 88.3639, driveSlug: 'kolkata' },
  { id: 'bangalore', name: 'Bangalore', country: 'India', lat: 12.9716, lon: 77.5946, driveSlug: 'bangalore' },
  { id: 'hyderabad', name: 'Hyderabad', country: 'India', lat: 17.385, lon: 78.4867, driveSlug: 'hyderabad' },
  { id: 'ahmedabad', name: 'Ahmedabad', country: 'India', lat: 23.0225, lon: 72.5714, driveSlug: 'ahmedabad' },
  { id: 'jaipur', name: 'Jaipur', country: 'India', lat: 26.9124, lon: 75.7873, driveSlug: 'jaipur' },
  { id: 'tokyo', name: 'Tokyo', country: 'Japan', lat: 35.6762, lon: 139.6503, driveSlug: 'tokyo' },
  { id: 'paris', name: 'Paris', country: 'France', lat: 48.8566, lon: 2.3522, driveSlug: 'paris' },
  { id: 'newyorkcity', name: 'New York', country: 'USA', lat: 40.7128, lon: -74.006, driveSlug: 'newyorkcity' },
  { id: 'london', name: 'London', country: 'UK', lat: 51.5074, lon: -0.1278, driveSlug: 'london' },
  { id: 'istanbul', name: 'Istanbul', country: 'Turkey', lat: 41.0082, lon: 28.9784, driveSlug: 'istanbul' },
  { id: 'berlin', name: 'Berlin', country: 'Germany', lat: 52.52, lon: 13.405, driveSlug: 'berlin' },
  { id: 'seoul', name: 'Seoul', country: 'South Korea', lat: 37.5665, lon: 126.978, driveSlug: 'seoul' },
  { id: 'singapore', name: 'Singapore', country: 'Singapore', lat: 1.3521, lon: 103.8198, driveSlug: 'singapore' },
  { id: 'sydney', name: 'Sydney', country: 'Australia', lat: -33.8688, lon: 151.2093, driveSlug: 'sydney' },
  { id: 'dubai', name: 'Dubai', country: 'UAE', lat: 25.2048, lon: 55.2708, driveSlug: 'dubai' },
  { id: 'riodejaneiro', name: 'Rio de Janeiro', country: 'Brazil', lat: -22.9068, lon: -43.1729, driveSlug: 'riodejaneiro' },
  { id: 'capetown', name: 'Cape Town', country: 'South Africa', lat: -33.9249, lon: 18.4241, driveSlug: 'capetown' },
]);

/** Every source City Drives leans on — rendered in the panel credit footer. */
export const SOURCE_CREDITS = Object.freeze([
  {
    key: 'driveListen',
    name: 'Drive & Listen',
    url: 'https://driveandlisten.app/',
    note: 'Drive footage — recorded drive-throughs',
  },
  {
    key: 'driveFromHome',
    name: 'Drive From Home',
    url: 'https://drivefromhome.com/',
    note: 'More virtual drives',
  },
  {
    key: 'radioGarden',
    name: 'Radio Garden',
    url: 'https://radio.garden/',
    note: 'Live radio globe',
  },
  {
    key: 'radioBrowser',
    name: 'radio-browser.info',
    url: 'https://www.radio-browser.info/',
    note: 'Community radio directory — live streams',
  },
]);

/** Deep link to the drive-through page for a city (driveandlisten.app /city/ slug). */
export function driveUrlFor(city) {
  return `https://driveandlisten.app/city/${city.driveSlug}`;
}

/** Look up a city by id; returns null when unknown. */
export function cityDriveById(id) {
  return CITY_DRIVES.find((city) => city.id === id) ?? null;
}
