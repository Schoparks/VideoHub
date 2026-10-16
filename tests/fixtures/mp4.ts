/** Minimal ISO BMFF sample descriptions for protection-boundary tests. */
export const mp4Box = (type: string, ...parts: Buffer[]) => {
  const data = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length + 8);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, data]);
};

export function mp4Initialization(type = 'avc1', extra = Buffer.alloc(0)) {
  const entry = mp4Box(type, Buffer.alloc(type === 'mp4a' || type === 'enca' ? 28 : 78), extra);
  const full = Buffer.alloc(8);
  full.writeUInt32BE(1, 4);
  const table = mp4Box('stsd', full, entry);
  return mp4Box('moov', mp4Box('trak', mp4Box('mdia', mp4Box('minf', mp4Box('stbl', table)))));
}
