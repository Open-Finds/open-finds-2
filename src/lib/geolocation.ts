export type Coord = { lat: number; lon: number };

/** GeolocationPositionError codes; the constants aren't on the object in every runtime. */
const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;

export class GeolocationFailure extends Error {
  constructor(
    readonly reason: 'unsupported' | 'denied' | 'unavailable' | 'timeout',
    message: string,
  ) {
    super(message);
    this.name = 'GeolocationFailure';
  }
}

function ask(opts: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, opts));
}

function toFailure(err: GeolocationPositionError): GeolocationFailure {
  switch (err.code) {
    case PERMISSION_DENIED:
      return new GeolocationFailure('denied', 'Location permission denied. Enter a suburb or postcode instead.');
    case POSITION_UNAVAILABLE:
      return new GeolocationFailure('unavailable', 'Could not determine your location. Enter a suburb or postcode instead.');
    case TIMEOUT:
      return new GeolocationFailure('timeout', 'Could not pin down your location. Try again, or enter a suburb or postcode.');
    default:
      return new GeolocationFailure('unavailable', 'Could not get your location. Enter a suburb or postcode instead.');
  }
}

/**
 * Where the user is, to suburb accuracy — all a travel-time origin needs.
 *
 * A coarse fix (Wi-Fi / IP) comes back in a second or two on laptops and phones
 * alike. A high-accuracy fix needs GPS, which desktops don't have, so asking for
 * it first is what made the "use my location" button time out on a laptop.
 * Coarse first, then one patient high-accuracy attempt for phones still
 * acquiring a fix. A permission refusal stops immediately; the browser would
 * only refuse again.
 */
export async function locateUser(): Promise<Coord> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new GeolocationFailure('unsupported', 'Location is not available on this device. Enter a suburb or postcode instead.');
  }
  try {
    const pos = await ask({ enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 });
    return { lat: pos.coords.latitude, lon: pos.coords.longitude };
  } catch (e) {
    if ((e as GeolocationPositionError).code === PERMISSION_DENIED) throw toFailure(e as GeolocationPositionError);
  }
  try {
    const pos = await ask({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    return { lat: pos.coords.latitude, lon: pos.coords.longitude };
  } catch (e) {
    throw toFailure(e as GeolocationPositionError);
  }
}
