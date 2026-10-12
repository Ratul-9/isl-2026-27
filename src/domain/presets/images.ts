/**
 * Which remote images the app will load. Preset logos and headshots are copyrighted, so they are
 * only ever REFERENCED by URL (never downloaded, bundled or stored), and only from hosts listed
 * here. The check also protects against a hand-edited or imported match file pointing an
 * `<img>` at an arbitrary third-party server.
 */
const PRESET_IMAGE_HOSTS: readonly string[] = ['www.indiansuperleague.com'];

/** Returns the URL when it is a plain `https` URL on an allowed host, otherwise null. */
export function safeImageUrl(url: string | null | undefined): string | null {
  if (!url || url.length > 500) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') return null;
  return PRESET_IMAGE_HOSTS.includes(parsed.hostname) ? parsed.toString() : null;
}
