import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

async function getGoogleMapsApiKey(): Promise<string> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data, error } = await supabase
    .from("app_secrets")
    .select("value")
    .eq("key", "GOOGLE_MAPS_API_KEY")
    .maybeSingle();
  if (error || !data) throw new Error("Google Maps API key not found");
  return data.value as string;
}

type PlaceResult = {
  name: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
};

// Extract coordinates from a Google Maps URL.
// Handles patterns like:
//   @-33.8688,151.2093
//   !3d-33.8688!4d151.2093
//   /place/-33.8688,151.2093
//   ?q=-33.8688,151.2093
//   ll=-33.8688,151.2093
function extractCoords(url: string): { lat: number; lon: number } | null {
  // @lat,lon pattern (most common in share links)
  let m = url.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };

  // !3dlat!4dlon pattern (directions/place URLs)
  m = url.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };

  // ll=lat,lon pattern
  m = url.match(/[?&]ll=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };

  // q=lat,lon or q="lat,lon" pattern
  m = url.match(/[?&]q=(-?\d{1,3}\.\d+%2C|-?\d{1,3}\.\d+,)(-?\d{1,3}\.\d+)/);
  if (m) {
    const latMatch = url.match(/[?&]q=(-?\d{1,3}\.\d+)/);
    const lonMatch = url.match(/[?&]q=-?\d{1,3}\.\d+%2C(-?\d{1,3}\.\d+)/);
    if (latMatch && lonMatch) return { lat: parseFloat(latMatch[1]), lon: parseFloat(lonMatch[1]) };
  }

  // q=lat,lon without encoding
  m = url.match(/[?&]q=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };

  // center=lat,lon pattern
  m = url.match(/[?&]center=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };

  return null;
}

// Extract a place query string from the URL (e.g. /place/Restaurant+Name or q=Restaurant Name)
function extractPlaceQuery(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);

    // /place/Place+Name/ pattern
    const placeIdx = parts.indexOf("place");
    if (placeIdx >= 0 && placeIdx + 1 < parts.length) {
      return decodeURIComponent(parts[placeIdx + 1].replace(/\+/g, " "));
    }

    // q= parameter (could be a place name or coords)
    const q = u.searchParams.get("q");
    if (q && !/^-?\d+\.\d+/.test(q)) {
      return q;
    }

    return null;
  } catch {
    return null;
  }
}

// Reverse geocode coordinates to get a human-readable address and place name
async function reverseGeocode(
  lat: number,
  lon: number,
  apiKey: string
): Promise<PlaceResult> {
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&result_type=street_address|premise|point_of_interest|establishment&key=${apiKey}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return { name: null, address: null, lat, lon };

    const data = await res.json();
    const results = data?.results;
    if (!Array.isArray(results) || results.length === 0) {
      return { name: null, address: null, lat, lon };
    }

    const top = results[0];
    const address = top?.formatted_address ?? null;

    // Try to extract a place name from address components
    let name: string | null = null;
    const components = top?.address_components ?? [];
    for (const c of components) {
      const types: string[] = c.types ?? [];
      if (
        types.includes("point_of_interest") ||
        types.includes("establishment") ||
        types.includes("premise")
      ) {
        name = c.long_name;
        break;
      }
    }

    return { name, address, lat, lon };
  } catch {
    return { name: null, address: null, lat, lon };
  }
}

// Forward geocode a place name + optional area to get coordinates and formatted address
async function forwardGeocode(
  query: string,
  apiKey: string
): Promise<PlaceResult> {
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${apiKey}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return { name: null, address: null, lat: null, lon: null };

    const data = await res.json();
    const result = data?.results?.[0];
    if (!result) return { name: null, address: null, lat: null, lon: null };

    const loc = result.geometry?.location;
    if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") {
      return { name: null, address: null, lat: null, lon: null };
    }

    const address = result.formatted_address ?? null;

    // Try to extract a place name from address components
    let name: string | null = null;
    const components = result.address_components ?? [];
    for (const c of components) {
      const types: string[] = c.types ?? [];
      if (
        types.includes("point_of_interest") ||
        types.includes("establishment") ||
        types.includes("premise")
      ) {
        name = c.long_name;
        break;
      }
    }

    // If no POI name found, use the query itself as the name
    if (!name) name = query;

    return { name, address, lat: loc.lat, lon: loc.lng };
  } catch {
    return { name: null, address: null, lat: null, lon: null };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    if (typeof url !== "string" || !url.trim()) {
      return new Response(
        JSON.stringify({ error: "url is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const lower = url.toLowerCase();
    if (!lower.includes("google.com/maps") && !lower.includes("maps.google.com") && !lower.includes("maps.app.goo.gl")) {
      return new Response(
        JSON.stringify({ name: null, address: null, lat: null, lon: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiKey = await getGoogleMapsApiKey();

    // Strategy 1: Extract coordinates directly from the URL
    const coords = extractCoords(url);
    if (coords) {
      const result = await reverseGeocode(coords.lat, coords.lon, apiKey);
      if (result.address) {
        return new Response(
          JSON.stringify(result),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // Coords found but reverse geocode failed — return coords only
      return new Response(
        JSON.stringify({ name: null, address: null, lat: coords.lat, lon: coords.lon }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Strategy 2: Extract a place name from the URL and forward geocode it
    const placeQuery = extractPlaceQuery(url);
    if (placeQuery) {
      const result = await forwardGeocode(placeQuery, apiKey);
      if (result.address) {
        return new Response(
          JSON.stringify(result),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Could not resolve
    return new Response(
      JSON.stringify({ name: null, address: null, lat: null, lon: null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
