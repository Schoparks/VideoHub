/** Inspect complete ISO BMFF initialization boxes; never decrypt media or read keys. */
type Protection = 'clear' | 'encrypted' | 'unknown';
interface Box { type: string; start: number; content: number; end: number }
const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'wave']);
const encryptedBoxes = new Set(['pssh', 'sinf', 'schm', 'tenc', 'senc', 'saiz', 'saio']);
const videoEntries = new Set(['avc1', 'avc3', 'av01', 'hvc1', 'hev1']);
const audioEntries = new Set(['mp4a', 'ac-3', 'ec-3', 'Opus', 'fLaC']);

function boxes(buffer: Buffer, start: number, end: number): Box[] {
  const result: Box[] = [];
  while (start < end) {
    if (end - start < 8) throw new Error('Incomplete box');
    let size = buffer.readUInt32BE(start), header = 8;
    if (size === 1) {
      if (end - start < 16) throw new Error('Incomplete extended box');
      // Initialization reads are bounded to 64 KiB; any nonzero high word exceeds that bound.
      if (buffer.readUInt32BE(start + 8) !== 0) throw new Error('Oversized box');
      size = buffer.readUInt32BE(start + 12);
      header = 16;
    } else if (size === 0) size = end - start;
    if (size < header || size > end - start) throw new Error('Invalid box size');
    result.push({ type: buffer.toString('ascii', start + 4, start + 8), start, content: start + header, end: start + size });
    if (result.length > 256) throw new Error('Too many boxes');
    start += size;
  }
  return result;
}

export function mp4Protection(buffer: Buffer): Protection {
  let samples = 0, tracks = 0, tables = 0;
  try {
    if (!buffer.length || buffer.length > 65536) return 'unknown';
    const walk = (entries: Box[], depth: number): boolean => {
      if (depth > 10) throw new Error('Excessive nesting');
      for (const box of entries) {
        if (encryptedBoxes.has(box.type) || box.type === 'encv' || box.type === 'enca') return true;
        if (box.type === 'trak') tracks++;
        if (box.type === 'stsd') {
          if (box.end - box.content < 8 || buffer.readUInt32BE(box.content) !== 0) throw new Error('Invalid sample table');
          const count = buffer.readUInt32BE(box.content + 4);
          const entries = boxes(buffer, box.content + 8, box.end);
          if (!count || count !== entries.length) throw new Error('Invalid sample count');
          tables++;
          for (const entry of entries) {
            if (entry.type === 'encv' || entry.type === 'enca') return true;
            let offset: number;
            if (videoEntries.has(entry.type)) offset = 78;
            else if (audioEntries.has(entry.type)) {
              if (entry.end - entry.content < 28) throw new Error('Incomplete audio entry');
              const version = buffer.readUInt16BE(entry.content + 8);
              if (version > 2) throw new Error('Unknown audio entry');
              offset = version === 0 ? 28 : version === 1 ? 44 : 64;
            } else throw new Error('Unknown sample entry');
            if (entry.content + offset > entry.end) throw new Error('Incomplete sample entry');
            if (walk(boxes(buffer, entry.content + offset, entry.end), depth + 1)) return true;
            samples++;
          }
        } else if (containers.has(box.type) && walk(boxes(buffer, box.content, box.end), depth + 1)) return true;
      }
      return false;
    };
    const root = boxes(buffer, 0, buffer.length);
    if (root.filter(box => box.type === 'moov').length !== 1) return 'unknown';
    if (walk(root, 0)) return 'encrypted';
    return tracks > 0 && tables === tracks && samples >= tracks ? 'clear' : 'unknown';
  } catch { return 'unknown'; }
}
