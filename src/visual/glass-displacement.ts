/** A neutral centre and curved edge normals bend only the background near the rim. */
export function glassDisplacement(width: number, height: number, radius: number): string {
  const ratio = Math.min(1, 640 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const context = canvas.getContext('2d');
  if (!context) return '';
  const pixels = context.createImageData(canvas.width, canvas.height);
  const corner = Math.min(radius, width / 2, height / 2);
  const bevel = Math.min(18, corner);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const px = (x + .5) / ratio - width / 2;
      const py = (y + .5) / ratio - height / 2;
      const qx = Math.abs(px) - width / 2 + corner;
      const qy = Math.abs(py) - height / 2 + corner;
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const length = Math.hypot(ox, oy);
      const distance = corner - length - Math.min(Math.max(qx, qy), 0);
      const strength = distance > 0 && distance < bevel
        ? Math.sin(Math.PI * distance / bevel) ** 2 : 0;
      const nx = length > 0 ? ox / length : qx > qy ? 1 : 0;
      const ny = length > 0 ? oy / length : qy >= qx ? 1 : 0;
      const offset = (y * canvas.width + x) * 4;
      pixels.data[offset] = 128 + Math.sign(px) * nx * strength * 127;
      pixels.data[offset + 1] = 128 + Math.sign(py) * ny * strength * 127;
      pixels.data[offset + 2] = 128;
      pixels.data[offset + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL();
}
