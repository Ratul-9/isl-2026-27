/**
 * Tactical-board image export. The on-screen <svg> is cloned and reduced to
 * the picture alone (pitch, players, labels, arrows, LD badges, notes): edit
 * handles, selection rings, in-progress drafts, hit areas and tooltips are
 * removed, CSS variables are replaced with concrete values, and the markup is
 * made standalone so it can be rasterised by the browser.
 */

export interface PreparedSvg {
  markup: string;
  /** Output size in pixels. */
  width: number;
  height: number;
}

/** Concrete font stack (the page uses a CSS variable that doesn't exist in a standalone SVG). */
const EXPORT_FONT_FAMILY =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Longest edge of the exported image in pixels: sharp text, reasonable file size. */
const EXPORT_LONG_EDGE_PX = 2000;

const REMOVE_SELECTORS = [
  '[data-handle]', // endpoint handles
  '[data-draft]', // arrow being drawn
  '.pitch-marker-ring', // selection / focus ring
  'path[stroke="transparent"]', // invisible hit areas
  'title', // tooltips
];

function parseViewBox(svg: SVGSVGElement): { width: number; height: number } {
  const parts = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)) || parts[2] <= 0 || parts[3] <= 0) {
    throw new Error('The board has no valid size to export.');
  }
  return { width: parts[2], height: parts[3] };
}

export function prepareBoardSvg(svg: SVGSVGElement, longEdgePx: number = EXPORT_LONG_EDGE_PX): PreparedSvg {
  const box = parseViewBox(svg);
  const scale = longEdgePx / Math.max(box.width, box.height);
  const width = Math.round(box.width * scale);
  const height = Math.round(box.height * scale);

  const clone = svg.cloneNode(true) as SVGSVGElement;
  for (const selector of REMOVE_SELECTORS) clone.querySelectorAll(selector).forEach((el) => el.remove());

  // Interaction-only attributes are noise in an image.
  for (const el of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === 'tabindex' || attr.name === 'role' || attr.name.startsWith('aria-') || attr.name === 'class') {
        el.removeAttribute(attr.name);
      }
    }
  }

  clone.removeAttribute('style');
  clone.removeAttribute('data-tool');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('font-family', EXPORT_FONT_FAMILY);

  let markup = new XMLSerializer().serializeToString(clone);
  // The serializer normally writes the namespace itself; adding it by attribute as well would
  // produce a duplicate (invalid XML), so only patch it in when it is missing.
  if (!/^<svg\b[^>]*\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(markup)) {
    markup = markup.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return { markup, width, height };
}

/** Rasterises prepared SVG markup to a PNG in the browser. */
export async function svgToPngBlob(prepared: PreparedSvg): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([prepared.markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The board image could not be rendered by this browser.'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = prepared.width;
    canvas.height = prepared.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot create images from the canvas.');
    context.drawImage(image, 0, 0, prepared.width, prepared.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The PNG could not be created.'))), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
