import assert from 'node:assert/strict';

/** Deliver the existing suspend IPC to a hidden test window, without suspending the OS. */
export async function checkPlayerSuspend(app, page) {
  await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length !== 1 || windows.some(window => window.isVisible() || window.isFocused())) {
      throw new Error('休眠信号验证仅允许隐藏测试窗口');
    }
    windows[0].webContents.send('system:suspend');
  });
  await page.waitForFunction(() => document.querySelector('video')?.paused === true
    && document.querySelector('.player')?.getAttribute('data-switching') === 'false');
  const position = await page.locator('video').evaluate(video => video.currentTime);
  await page.waitForTimeout(600);
  const state = await page.locator('video').evaluate(video => ({
    paused: video.paused, position: video.currentTime, rate: video.playbackRate,
  }));
  assert.equal(state.paused, true);
  assert.ok(Math.abs(state.position - position) < .05);
  await page.getByRole('button', { name: '继续播放', exact: true }).evaluate(button => button.click());
  await page.waitForFunction(position => {
    const video = document.querySelector('video');
    return video && !video.paused && video.currentTime > position + .1;
  }, position);
  return { suspendIpc: true, ...state, explicitContinue: true };
}
