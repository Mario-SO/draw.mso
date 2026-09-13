/** Rasterize the core's SVG export locally; document composition stays in Rust. */
export async function svgToPng(svg: string): Promise<Blob> {
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const width = Number(root.getAttribute('width')), height = Number(root.getAttribute('height'));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 16384 || height > 16384 || width * height > 32_000_000) throw new Error('This diagram is too large for PNG. Export SVG or text instead.');
  const source = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG export is unavailable in this browser.');
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create PNG.')), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}
