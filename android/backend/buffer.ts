/** Bounded byte helpers used by the shared MP4 protection and XML adapters. */
class ByteBuffer extends Uint8Array {
  readUInt32BE(offset: number) { return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint32(offset); }
  readUInt16BE(offset: number) { return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint16(offset); }
  toString(_encoding = 'utf8', start = 0, end = this.length) { return new TextDecoder().decode(this.subarray(start, end)); }
}
export const Buffer = {
  from: (value: ArrayBuffer | Uint8Array) => new ByteBuffer(value instanceof ArrayBuffer ? new Uint8Array(value) : value),
  byteLength: (value: string) => new TextEncoder().encode(value).length,
  concat: (chunks: Uint8Array[]) => {
    const result = new ByteBuffer(chunks.reduce((size, chunk) => size + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return result;
  },
};
