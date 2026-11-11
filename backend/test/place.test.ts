import { expect, it } from 'vitest';
import { cityFromPlace } from '../src/domain/place.js';

it.each([
  ['Mumbai Airport T1, private gate 42', 'Mumbai'],
  ['Private apartment 12, New Delhi', 'New Delhi'],
  ['MG Road, Bangalore', 'Bengaluru'],
  ['Kochi airport, gate 3', 'Kochi'],
  ['Shivaji Park', null], ['Private address, unknown town', null], ['', null], [null, null],
])('only exposes a recognized city from %s', (place, expected) => {
  expect(cityFromPlace(place)).toBe(expected);
});
