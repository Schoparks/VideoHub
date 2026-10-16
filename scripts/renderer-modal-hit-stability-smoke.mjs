import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-modal-hit-stability');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const verify = async (name, target) => {
    const dialog = page.getByRole('dialog', { name, exact: true });
    await target.focus();
    await pressPad(page, 15);
    await target.focus();
    const before = { dialog: await dialog.boundingBox(), control: await target.boundingBox() };
    await page.mouse.move(before.control.x + before.control.width / 2, before.control.y + before.control.height / 2);
    await page.waitForFunction(() => document.documentElement.dataset.inputMode === 'pointer');
    const pointer = { dialog: await dialog.boundingBox(), control: await target.boundingBox() };
    for (const object of ['dialog', 'control']) {
      for (const dimension of ['x', 'y', 'width', 'height']) {
        assert.ok(Math.abs(before[object][dimension] - pointer[object][dimension]) < .5, `${mode} ${name}: ${object} ${dimension}`);
      }
    }
    const hint = dialog.locator('.modal-input-hints > .controller-focus-hint');
    assert.equal(await hint.isVisible(), false);
    await page.keyboard.press('Shift');
    const keyboard = await target.boundingBox();
    await writeFile(resolve(output, `${mode}-${name}-geometry.json`), JSON.stringify({
      before, pointer, keyboard, hints: await hint.evaluate(element => ({
        text: element.textContent, rectangle: element.getBoundingClientRect().toJSON(),
        host: element.parentElement.getBoundingClientRect().toJSON(),
      })),
    }, null, 2));
    for (const dimension of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(before.control[dimension] - keyboard[dimension]) < .5);
    // Hit the saved coordinates without a locator recalculating the moved target.
    await page.mouse.click(before.control.x + before.control.width / 2, before.control.y + before.control.height / 2);
    checks.push(`${mode}: ${name} preserves dialog/control geometry across gamepad, pointer and keyboard; saved-coordinate click lands`);
  };
  try {
    await page.evaluate(tv => { window.reliability.boot.preferences.tvMode = tv; }, tv);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await connectPad(page);
    await page.getByRole('button', { name: '打开链接', exact: true }).click();
    await verify('打开链接', page.getByRole('button', { name: '关闭弹窗', exact: true }));
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const dark = page.getByRole('switch', { name: '深色外观', exact: true });
    await verify('设置', dark);
    assert.equal(await dark.isChecked(), true);
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await page.locator('.card-details').first().click();
    await page.getByRole('heading', { name: '视频详情', exact: true }).waitFor();
    await verify('视频详情', page.getByRole('button', { name: '关闭弹窗', exact: true }));
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.getByRole('button', { name: '打开链接', exact: true }).click();
    await page.getByRole('textbox', { name: '视频地址', exact: true }).focus();
    await pressPad(page, 0);
    const entry = page.getByRole('dialog', { name: '视频地址', exact: true });
    await entry.waitFor();
    await entry.locator('[data-screen-keyboard]').waitFor();
    await verify('视频地址', entry.getByRole('button', { name: '关闭弹窗', exact: true }));
    assert.equal(await entry.count(), 0);
    assert.equal(await page.getByRole('dialog', { name: '打开链接', exact: true }).count(), 1);
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    assert.deepEqual(errors, []);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors: [] }, null, 2));
console.log(JSON.stringify({ checks, errors: [] }, null, 2));
