export const stagingSupabase: string;
export const stagingBranch: string;
export const fallbackImage: string;
export function recommendationOrigin(staging: boolean, productionUrl?: string, stagingUrl?: string): string | null;
export function validRecommendationId(id: unknown): id is string;
export function recommendationPath(id: string, staging: boolean): string;
export function venuePhoto(staging: boolean, id: string, venue: { name: string; address: string }): string | null;
export function publicVenueLink(value: unknown): string | null;
