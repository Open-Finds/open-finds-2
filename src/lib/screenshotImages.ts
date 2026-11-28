/**
 * Photos picked in the app for AI Save, shrunk the same way the Android share menu does (UnsavedSharePlugin.getImages):
 * at most 1600 px on the longest side, re-encoded as JPEG, which also drops hidden details such as GPS.
 * Nothing is uploaded or stored; the data links go straight to the AI.
 */
export const MAX_SIDE = 1600;
const MAX_CHARS = 1_400_000;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable picture')); };
    image.src = url;
  });
}

/** One picture as a JPEG data link, or null when it cannot be opened or is still too big. */
export async function shrinkImage(file: File): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null;
  try {
    const image = await loadImage(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.72);
    return data.startsWith('data:image/jpeg;base64,') && data.length <= MAX_CHARS ? data : null;
  } catch {
    return null;
  }
}

/** The first `limit` pictures, shrunk; ones that cannot be opened are skipped. */
export async function shrinkImages(files: File[], limit: number): Promise<string[]> {
  const shrunk = await Promise.all(files.slice(0, limit).map(shrinkImage));
  return shrunk.filter((image): image is string => !!image);
}
