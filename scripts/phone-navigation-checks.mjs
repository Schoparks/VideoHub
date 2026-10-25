import assert from 'node:assert/strict';

export async function checkPhoneNavigation(phone, tv, raw) {
  await tv.evaluate(() => {
    window.reliability.boot.history = [{ item: { id: 'local:recent', source: 'local', kind: 'video',
      title: '本机新记录', path: '/private/new.mp4' }, position: 42, duration: 120, updatedAt: Date.now() }];
  });
  await phone.getByRole('button', { name: '历史记录', exact: true }).click();
  await phone.getByRole('button', { name: '播放 B站历史测试', exact: true }).waitFor();
  assert.ok(await tv.evaluate(() => window.reliability.browse.some(request => request.kind === 'history')));
  await phone.getByRole('button', { name: '本机历史', exact: true }).click();
  await phone.getByRole('button', { name: '播放 本机新记录', exact: true }).waitFor();
  await phone.getByRole('button', { name: '关闭卡片', exact: true }).click();

  await phone.getByRole('button', { name: '返回首页', exact: true }).click();
  await phone.locator('.companion-content').evaluate(host => { host.scrollTop = 500; });
  const homePosition = await phone.locator('.companion-content').evaluate(host => host.scrollTop);
  assert.ok(homePosition > 400);
  const player = (await raw({ kind: 'snapshot' })).state.player;
  const part = player.parts.find(part => part.id !== player.part);
  assert.deepEqual(await raw({ kind: 'player', session: player.session, command: { operation: 'episode', value: part.id } }), {});
  await phone.waitForTimeout(1800);
  await phone.getByRole('button', { name: '打开播放遥控器', exact: true }).waitFor();
  assert.equal(await phone.locator('.companion-content').evaluate(host => host.scrollTop), homePosition);
  await phone.getByRole('button', { name: '打开播放遥控器', exact: true }).click();
  await phone.getByRole('button', { name: '返回首页', exact: true }).click();
  assert.equal(await phone.locator('.companion-content').evaluate(host => host.scrollTop), homePosition);
  await phone.getByRole('button', { name: '打开播放遥控器', exact: true }).click();

  await tv.evaluate(() => { window.reliability.holdResolve = true; });
  await phone.getByRole('button', { name: '播放 相关视频测试', exact: true }).click();
  await tv.waitForFunction(() => !!window.reliability.finishResolve);
  await phone.getByRole('button', { name: '返回首页', exact: true }).click();
  await phone.getByRole('button', { name: '工具', exact: true }).click();
  await phone.getByRole('button', { name: '设置', exact: true }).click();
  await tv.evaluate(() => { window.reliability.holdResolve = false; window.reliability.finishResolve(); });
  await phone.waitForTimeout(1800);
  await phone.getByRole('dialog', { name: '设置', exact: true }).waitFor();
  await phone.getByRole('button', { name: '返回工具', exact: true }).click();
  await phone.getByRole('dialog', { name: '工具', exact: true }).waitFor();
  await phone.getByRole('button', { name: '关闭卡片', exact: true }).click();
  await phone.getByRole('button', { name: '打开播放遥控器', exact: true }).waitFor();
  await phone.getByRole('button', { name: '打开播放遥控器', exact: true }).click();
}
