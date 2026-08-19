/**
 * Saving the map as an image.
 *
 * Deliberately isolated: nothing else imports this, it imports nothing of EIGA's,
 * and it is the only file that knows a canvas exists. If it ever needs to be
 * deleted, deleting it costs one import in `Atlas`.
 *
 * Everything happens in the browser. No upload, no service, no round trip — the
 * image is built from the DOM already on screen and handed to the user's own
 * download. That is not an optimisation; it is the same promise as the import.
 *
 * The approach is to clone the live `<svg>`, inline the styles the cascade
 * resolved for it, and rasterise that. The alternative — redrawing the map onto a
 * canvas with the 2D API — would mean reimplementing label halos, text anchoring
 * and every future visual decision a second time, and the second copy would drift.
 * Reading the resolved styles instead means the export follows `globals.css`
 * without being told about it.
 *
 * What you save is what you were looking at: the current framing, the current
 * search, labels exactly as visible as they are on screen. A film title hidden at
 * this zoom stays hidden in the file.
 */

/**
 * The properties carried from the live map onto the clone.
 *
 * An explicit list rather than every computed property: a full dump would inline
 * hundreds of declarations per element, most of them irrelevant, and would bake in
 * layout values that fight the SVG's own geometry.
 *
 * The list is the risk, though: anything a stylesheet sets and this omits is simply
 * absent from the file, and the map still looks right on screen — so the loss shows
 * up only in the download. `stroke-linejoin` is why that is worth spelling out. Both
 * halos are drawn as a thick stroke under the glyphs via `paint-order`, and without a
 * round join a 3px stroke on small type spikes at the corners of the letters.
 */
const CARRIED_PROPERTIES = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "opacity",
  "display",
  "visibility",
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
  "paint-order",
] as const;

/** Rendered at twice the logical size, so the file is legible when zoomed. */
const PIXEL_SCALE = 2;

const CAPTION_SIZE = 11;
const CAPTION_INSET = { x: 28, y: 26 };

export interface ExportOptions {
  /** One line of mono text along the bottom, e.g. "EIGA · Decade · 37 films". */
  readonly caption: string;
}

/**
 * Copies resolved presentation styles from the live tree onto the clone.
 *
 * Walked in lockstep rather than matched by selector: the clone is a structural
 * copy, so position in the tree is a reliable correspondence and no element needs
 * an id it would not otherwise have.
 */
function carryStyles(source: Element, clone: Element): void {
  const computed = getComputedStyle(source);
  let declarations = "";
  for (const property of CARRIED_PROPERTIES) {
    const value = computed.getPropertyValue(property);
    if (value) declarations += `${property}:${value};`;
  }
  clone.setAttribute("style", declarations);

  const from = source.children;
  const to = clone.children;
  for (let i = 0; i < from.length && i < to.length; i++) {
    carryStyles(from[i], to[i]);
  }
}

/** Resolves a design token to the value the browser actually computed. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

async function rasterise(
  svgText: string,
  width: number,
  height: number,
  caption: string,
): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.width = width;
    image.height = height;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("the map could not be rendered to an image"));
      image.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = width * PIXEL_SCALE;
    canvas.height = height * PIXEL_SCALE;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("this browser has no 2D canvas");

    context.scale(PIXEL_SCALE, PIXEL_SCALE);
    // The scrims and the page background are HTML, not part of the SVG, so the
    // base colour is painted here rather than inherited.
    context.fillStyle = token("--color-void") || "#101114";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    context.fillStyle = token("--color-paper-dim") || "#6b6f73";
    context.font = `${CAPTION_SIZE}px ${token("--font-mono") || "monospace"}`;
    // Tracking to match `.eiga-annotation`; ignored by engines that lack it,
    // which costs the caption nothing but a little tightness.
    context.letterSpacing = "0.14em";
    context.textBaseline = "alphabetic";
    context.fillText(caption, CAPTION_INSET.x, height - CAPTION_INSET.y);

    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Renders the given map to a PNG blob.
 *
 * Throws rather than returning null on failure, so the caller has to decide what
 * the user is told. A silent no-op on a button press is the worst outcome here.
 */
export async function exportMapPng(
  svg: SVGSVGElement,
  options: ExportOptions,
): Promise<Blob> {
  const width = Math.round(svg.viewBox.baseVal.width);
  const height = Math.round(svg.viewBox.baseVal.height);
  if (width <= 0 || height <= 0) throw new Error("the map has not been drawn yet");

  const clone = svg.cloneNode(true) as SVGSVGElement;
  // A serialised SVG is parsed as a standalone document, which has no namespace
  // to inherit and no stylesheet to consult.
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  carryStyles(svg, clone);

  const canvas = await rasterise(
    new XMLSerializer().serializeToString(clone),
    width,
    height,
    options.caption,
  );

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("the image could not be encoded");
  return blob;
}

/** Hands a blob to the user's own downloads. Nothing is sent anywhere. */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Revoked on the next turn of the loop: revoking immediately can beat the
  // browser to reading the URL it was just handed.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
