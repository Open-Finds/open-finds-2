export const DEFAULT_SHARE_MESSAGE = "Let's check this out!🤩";

/** A Google Maps search for an address. */
export function googleMapsSearchUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;
}

/**
 * The message sent from the share flow, in exactly this shape:
 *
 *   {message}
 *
 *   {venue name}
 *   {address}
 *   Open in Maps: {Google Maps search link}
 *
 *   {original reel link}
 *
 * The reel link is raw text on purpose: chat apps turn it into a preview card
 * for the recipient. The app itself never shows it, only the thumbnail.
 */
export function composeShareMessage(parts: {
  message: string;
  name: string;
  address: string;
  link: string;
}): string {
  const message = parts.message.trim();
  const body = [
    parts.name.trim(),
    parts.address.trim(),
    `Open in Maps: ${googleMapsSearchUrl(parts.address)}`,
    '',
    parts.link.trim(),
  ];
  return (message ? [message, '', ...body] : body).join('\n');
}
