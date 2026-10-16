import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';

const output = resolve('.tmp/renderer-glass');
await mkdir(output, { recursive: true });
const checks = [];
const contrast = (ink, surface) => {
  const luminance = rgb => rgb.map(value => {
    const channel = value / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const a = luminance(ink), b = luminance(surface);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
};

for (const tv of [false, true]) {
  for (const theme of ['light', 'dark']) {
    const label = `${tv ? 'TV' : 'desktop'}-${theme}`;
    const { page, errors, close } = await launchHeadlessRenderer(tv
      ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
    try {
      await page.evaluate(({ tv, theme }) => {
        Object.assign(window.reliability.boot.preferences, { tvMode: tv, theme });
      }, { tv, theme });
      await page.getByRole('button', { name: '重试', exact: true }).click();
      const session = await page.context().newCDPSession(page);
      const emulate = features => session.send('Emulation.setEmulatedMedia', { features });
      await emulate([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.getByRole('button', { name: '设置', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '设置', exact: true });
      const track = dialog.getByRole('switch', { name: '电视模式', exact: true });
      const geometry = { dialog: await dialog.boundingBox(), track: await track.boundingBox() };
      await emulate([
        { name: 'prefers-reduced-transparency', value: 'reduce' },
        { name: 'prefers-reduced-motion', value: 'reduce' },
      ]);
      const material = await dialog.evaluate(node => {
        const style = getComputedStyle(node);
        return { background: style.backgroundColor, filter: style.backdropFilter };
      });
      assert.equal(material.filter, 'none');
      assert.match(material.background, /^rgb\(/, `${label}: reduced transparency is opaque`);
      assert.deepEqual({ dialog: await dialog.boundingBox(), track: await track.boundingBox() }, geometry);
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      await emulate([{ name: 'prefers-contrast', value: 'more' }]);
      assert.equal(await page.locator('.navigation-bar nav').evaluate(node =>
        getComputedStyle(node).backdropFilter), 'none');
      checks.push(`${label}: transparency/contrast preferences preserve readable opaque controls and exact geometry`);

      await emulate([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('video')?.paused === false);
      // A synthetic white frame stresses tint contrast; this is not decoding evidence.
      await page.locator('video').evaluate(node => { node.style.background = '#ffffff'; });
      await page.keyboard.press('ArrowUp');
      const readability = await page.locator('.player-bottom').evaluate(node => {
        const rgb = color => color.match(/[\d.]+/g).map(Number);
        const backing = (target, frame = 255) => {
          const layers = [];
          const surface = target.closest('.player-bottom, .player-overlay > header');
          for (let element = target; element; element = element.parentElement) {
            layers.unshift(rgb(getComputedStyle(element).backgroundColor));
            if (element === surface) break;
          }
          return layers.reduce((base, color) => {
            const alpha = color[3] ?? 1;
            return color.slice(0, 3).map((value, index) => value * alpha + base[index] * (1 - alpha));
          }, [frame, frame, frame]);
        };
        const timecode = node.querySelector('.timecode');
        const hints = node.querySelector('.controller-focus-hint');
        return {
          timecodeSurface: backing(timecode), hintSurface: backing(hints),
          darkTimecodeSurface: backing(timecode, 0), darkHintSurface: backing(hints, 0),
          timecode: rgb(getComputedStyle(timecode).color).slice(0, 3),
          hints: rgb(getComputedStyle(hints).color).slice(0, 3),
          controls: [...document.querySelectorAll('.player-buttons > button, .player-overlay > header > button, .player-buttons .episode-toggle span')]
            .map(target => ({
              ink: rgb(getComputedStyle(target).color).slice(0, 3),
              white: backing(target), black: backing(target, 0),
            })),
          rect: node.getBoundingClientRect().toJSON(),
          transition: getComputedStyle(document.querySelector('.player-overlay')).transitionDuration,
        };
      });
      assert.ok(contrast(readability.timecode, readability.timecodeSurface) >= 4.5);
      assert.ok(contrast(readability.hints, readability.hintSurface) >= 4.5);
      assert.ok(contrast(readability.timecode, readability.darkTimecodeSurface) >= 4.5);
      assert.ok(contrast(readability.hints, readability.darkHintSurface) >= 4.5);
      for (const control of readability.controls) {
        assert.ok(contrast(control.ink, control.white) >= 4.5);
        assert.ok(contrast(control.ink, control.black) >= 4.5);
      }
      assert.equal(readability.transition, '0s');
      assert.ok(readability.rect.bottom < page.viewportSize().height);
      assert.ok(readability.rect.height <= (tv ? 178 : 156), `${label}: compact control footprint`);
      await page.waitForFunction(() => document.querySelector('.player-bottom')?.style.getPropertyValue('--glass-optics'));
      assert.match(await page.locator('.player-bottom').evaluate(node =>
        getComputedStyle(node).backdropFilter), /url\(/);
      await page.screenshot({ path: resolve(output, `${label}-bright-frame.png`) });
      checks.push(`${label}: light glass text backing exceeds 4.5:1 over white/black; ${readability.rect.height}px controls with edge refraction remain usable`);
      await page.locator('video').evaluate(node => {
        node.style.background = 'repeating-linear-gradient(120deg, #087eb7 0 100px, #eb9463 100px 200px, #282f71 200px 300px)';
      });
      await page.screenshot({ path: resolve(output, `${label}-refraction.png`) });
      assert.deepEqual(errors, []);
    } finally { await close(); }
  }
}

// Real web-preview capability limits are preserved; no fixture data enters these captures.
const preview = await launchHeadlessRenderer({ width: 1440, height: 950 }, () => {});
try {
  await preview.page.getByRole('heading', { name: '首页', exact: true }).waitFor();
  await preview.page.screenshot({ path: resolve(output, 'preview-home.png'), animations: 'disabled' });
  await preview.page.getByRole('button', { name: '设置', exact: true }).click();
  await preview.page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
  await preview.page.screenshot({ path: resolve(output, 'preview-settings.png'), animations: 'disabled' });
  assert.deepEqual(preview.errors, []);
  checks.push('web preview: real capability-limited home/settings captures, no fabricated business content');
} finally { await preview.close(); }

await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, simulatedMedia: true, errors: [] }, null, 2));
console.log(JSON.stringify({ checks, errors: [] }, null, 2));
