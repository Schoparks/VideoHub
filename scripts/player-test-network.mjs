/** Delay only the test player's local gateway; retain real media bytes and responses. */
export async function holdPlayerMedia(page) {
  const pattern = /^http:\/\/127\.0\.0\.1:\d+\/media\//;
  let resume;
  let requests = 0;
  const waiting = new Promise(resolve => { resume = resolve; });
  const pending = new Set();
  let failure;
  const handler = route => {
    requests++;
    const request = waiting.then(() => route.continue()).catch(error => { failure ||= error; });
    pending.add(request);
    return request.finally(() => pending.delete(request));
  };
  await page.route(pattern, handler);
  let released = false;
  return {
    count: () => requests,
    release: async () => {
      if (!released) { released = true; resume(); }
      await Promise.all([...pending]);
      if (failure) throw failure;
    },
  };
}
