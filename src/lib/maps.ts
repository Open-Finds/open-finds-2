/**
 * Google Maps directions for a whole itinerary.
 *
 * One destination and the earlier stops as waypoints, in order. Origin is
 * omitted so Maps uses the phone's location when the link opens. Encoding
 * goes through URLSearchParams once — encoding each address and then the
 * whole string turns a suburb into garbage and drops stops.
 */
export function mapsDirectionsUrl(addresses: string[], fallback?: string | null): string | null {
  const stops = addresses.map((a) => a.trim()).filter(Boolean);
  const params = new URLSearchParams({ api: '1' });

  if (stops.length === 0) {
    const place = fallback?.trim();
    if (!place) return null;
    params.set('destination', place);
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  params.set('destination', stops[stops.length - 1]);
  if (stops.length > 1) {
    params.set('waypoints', stops.slice(0, -1).join('|'));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
