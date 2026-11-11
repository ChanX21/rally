// Publish only recognized city names, never arbitrary text from private meeting instructions.
const CITIES: readonly [string, RegExp][] = [
  ['Mumbai', /\b(mumbai|bombay)\b/i], ['New Delhi', /\bnew delhi\b/i], ['Delhi', /\bdelhi\b/i],
  ['Bengaluru', /\b(bengaluru|bangalore)\b/i], ['Hyderabad', /\bhyderabad\b/i],
  ['Chennai', /\b(chennai|madras)\b/i], ['Kolkata', /\b(kolkata|calcutta)\b/i], ['Pune', /\bpune\b/i],
  ['Kochi', /\b(kochi|cochin)\b/i], ['Thiruvananthapuram', /\b(thiruvananthapuram|trivandrum)\b/i],
  ['Ahmedabad', /\bahmedabad\b/i], ['Jaipur', /\bjaipur\b/i], ['Chandigarh', /\bchandigarh\b/i],
  ['Lucknow', /\blucknow\b/i], ['Noida', /\bnoida\b/i], ['Gurugram', /\b(gurugram|gurgaon)\b/i],
  ['Indore', /\bindore\b/i], ['Surat', /\bsurat\b/i], ['Bhopal', /\bbhopal\b/i], ['Nagpur', /\bnagpur\b/i],
  ['Coimbatore', /\bcoimbatore\b/i], ['Kozhikode', /\b(kozhikode|calicut)\b/i], ['Thrissur', /\bthrissur\b/i],
  ['Mysuru', /\b(mysuru|mysore)\b/i], ['Visakhapatnam', /\b(visakhapatnam|vizag)\b/i],
  ['London', /\blondon\b/i], ['Paris', /\bparis\b/i], ['Berlin', /\bberlin\b/i],
  ['New York', /\bnew york\b/i], ['San Francisco', /\bsan francisco\b/i], ['Singapore', /\bsingapore\b/i],
  ['Dubai', /\bdubai\b/i], ['Tokyo', /\btokyo\b/i], ['Bangkok', /\bbangkok\b/i],
];

export function cityFromPlace(place: string | null | undefined): string | null {
  return place ? CITIES.find(([, pattern]) => pattern.test(place))?.[0] ?? null : null;
}
