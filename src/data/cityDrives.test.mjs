import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CITY_DRIVES,
  SOURCE_CREDITS,
  driveUrlFor,
  cityDriveById,
} from './cityDrives.js';

const EXPECTED_CITIES = [
  ['delhi', 'Delhi', 'India', 28.6139, 77.209],
  ['mumbai', 'Mumbai', 'India', 19.076, 72.8777],
  ['chennai', 'Chennai', 'India', 13.0827, 80.2707],
  ['kolkata', 'Kolkata', 'India', 22.5726, 88.3639],
  ['bangalore', 'Bangalore', 'India', 12.9716, 77.5946],
  ['hyderabad', 'Hyderabad', 'India', 17.385, 78.4867],
  ['ahmedabad', 'Ahmedabad', 'India', 23.0225, 72.5714],
  ['jaipur', 'Jaipur', 'India', 26.9124, 75.7873],
  ['tokyo', 'Tokyo', 'Japan', 35.6762, 139.6503],
  ['paris', 'Paris', 'France', 48.8566, 2.3522],
  ['newyorkcity', 'New York', 'USA', 40.7128, -74.006],
  ['london', 'London', 'UK', 51.5074, -0.1278],
  ['istanbul', 'Istanbul', 'Turkey', 41.0082, 28.9784],
  ['berlin', 'Berlin', 'Germany', 52.52, 13.405],
  ['seoul', 'Seoul', 'South Korea', 37.5665, 126.978],
  ['singapore', 'Singapore', 'Singapore', 1.3521, 103.8198],
  ['sydney', 'Sydney', 'Australia', -33.8688, 151.2093],
  ['dubai', 'Dubai', 'UAE', 25.2048, 55.2708],
  ['riodejaneiro', 'Rio de Janeiro', 'Brazil', -22.9068, -43.1729],
  ['capetown', 'Cape Town', 'South Africa', -33.9249, 18.4241],
];

test('CITY_DRIVES has exactly the 20 specced cities with valid coordinates', () => {
  assert.equal(CITY_DRIVES.length, 20);
  const ids = new Set(CITY_DRIVES.map((c) => c.id));
  assert.equal(ids.size, 20, 'city ids must be unique');
  for (const [id, name, country, lat, lon] of EXPECTED_CITIES) {
    const city = CITY_DRIVES.find((c) => c.id === id);
    assert.ok(city, `missing city ${id}`);
    assert.equal(city.name, name);
    assert.equal(city.country, country);
    assert.equal(city.lat, lat);
    assert.equal(city.lon, lon);
    assert.ok(
      Number.isFinite(city.lat) && city.lat >= -90 && city.lat <= 90,
      `${id} lat out of range`,
    );
    assert.ok(
      Number.isFinite(city.lon) && city.lon >= -180 && city.lon <= 180,
      `${id} lon out of range`,
    );
    assert.ok(city.name.length > 0, `${id} needs a name`);
    assert.ok(city.country.length > 0, `${id} needs a country`);
    assert.match(city.driveSlug, /^[a-z0-9]+$/, `${id} driveSlug shape`);
  }
});

test('driveUrlFor builds a well-formed driveandlisten.app city URL', () => {
  for (const city of CITY_DRIVES) {
    const url = driveUrlFor(city);
    assert.equal(url, `https://driveandlisten.app/city/${city.driveSlug}`);
    assert.doesNotThrow(() => new URL(url));
  }
});

test('cityDriveById finds cities and returns null for unknown ids', () => {
  assert.equal(cityDriveById('tokyo')?.name, 'Tokyo');
  assert.equal(cityDriveById('nope'), null);
});

test('SOURCE_CREDITS carries all four sources with https URLs', () => {
  const keys = SOURCE_CREDITS.map((c) => c.key);
  assert.deepEqual(keys, ['driveListen', 'driveFromHome', 'radioGarden', 'radioBrowser']);
  for (const credit of SOURCE_CREDITS) {
    assert.ok(credit.name.length > 0);
    assert.ok(credit.note.length > 0);
    assert.match(credit.url, /^https:\/\//, `${credit.key} url must be https`);
    assert.doesNotThrow(() => new URL(credit.url));
  }
  const urls = Object.fromEntries(SOURCE_CREDITS.map((c) => [c.key, c.url]));
  assert.equal(urls.driveListen, 'https://driveandlisten.app/');
  assert.equal(urls.driveFromHome, 'https://drivefromhome.com/');
  assert.equal(urls.radioGarden, 'https://radio.garden/');
  assert.equal(urls.radioBrowser, 'https://www.radio-browser.info/');
});
