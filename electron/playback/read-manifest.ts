/** Bound manifest bodies as they arrive, rather than checking an already allocated body. */
export async function readManifest(response: Response, controller: AbortController): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('播放列表为空');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4000000) throw new Error('播放列表过大');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => {});
  }
}
