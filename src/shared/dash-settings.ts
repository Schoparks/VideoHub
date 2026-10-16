/** Keep long-form Android buffers bounded without changing tracks or quality. */
export function dashSettings(adaptive: boolean, android: boolean) {
  return { debug: { logLevel: 0 }, streaming: {
    abr: { autoSwitchBitrate: { video: adaptive } },
    ...(android ? { buffer: { bufferTimeAtTopQualityLongForm: 30, bufferToKeep: 10 } } : {}),
  } };
}
