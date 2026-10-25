import assert from 'node:assert/strict';

/** Isolated renderer fixtures only: never writes to a real Bilibili account. */
export async function checkPhoneLibrary(phone, tv, raw) {
  await phone.getByRole('button', { name: '返回首页', exact: true }).click();
  await phone.getByRole('button', { name: '打开播放遥控器', exact: true }).waitFor();
  assert.equal(await tv.locator('video').count(), 1);
  await phone.waitForTimeout(1700);
  assert.equal(await phone.getByRole('button', { name: '打开播放遥控器', exact: true }).isVisible(), true);
  // Add a long test catalog through the existing search fixture, then verify pinned tools.
  await phone.evaluate(() => {
    const host = document.querySelector('.phone-media-grid');
    const item = host.firstElementChild;
    for (let index = 0; index < 12; index++) host.append(item.cloneNode(true));
    document.querySelector('.companion-content').scrollTop = 600;
  });
  await phone.getByRole('button', { name: '返回顶部', exact: true }).waitFor();
  assert.equal((await phone.locator('.companion-header').boundingBox()).y, 0);
  await phone.getByRole('button', { name: '返回顶部', exact: true }).click();
  await phone.waitForFunction(() => document.querySelector('.companion-content').scrollTop === 0);
  await phone.getByRole('button', { name: '打开播放遥控器', exact: true }).click();
  await phone.getByRole('button', { name: '当前视频操作', exact: true }).click();
  await phone.getByRole('button', { name: '加入播放队列', exact: true }).click();
  await tv.waitForFunction(() => window.reliability.boot.queue.some(item => item.id === 'related:fixture'));
  await phone.getByRole('button', { name: '关闭提示', exact: true }).click();

  await phone.getByRole('button', { name: '工具', exact: true }).click();
  await phone.getByRole('button', { name: '我的', exact: true }).click();
  await phone.getByRole('button', { name: '测试收藏夹 1', exact: true }).waitFor();
  await phone.getByRole('button', { name: /电视账号登录二维码/ }).click();
  await tv.getByRole('img', { name: 'B 站登录二维码', exact: true }).waitFor();
  assert.equal(await tv.evaluate(() => window.reliability.logins.at(-1)), 'web');
  assert.equal(await phone.locator('img[alt="B 站登录二维码"]').count(), 0);
  const snapshot = JSON.stringify(await raw({ kind: 'snapshot' }));
  assert.equal(snapshot.includes('data:image'), false);
  assert.equal(snapshot.includes('webMid'), false);
  await phone.getByRole('button', { name: '关闭电视二维码', exact: true }).click();
  await tv.getByRole('img', { name: 'B 站登录二维码', exact: true }).waitFor({ state: 'detached' });

  await phone.getByRole('button', { name: '测试收藏夹 1', exact: true }).click();
  await phone.getByRole('dialog').getByRole('button', { name: '视频操作 可靠性测试', exact: true }).click();
  await phone.getByRole('button', { name: '从此收藏夹移除', exact: true }).click();
  await tv.waitForFunction(() => window.reliability.collectionWrites.some(write => write.folder === 1 && !write.add));
  await phone.getByRole('dialog', { name: '视频操作', exact: true }).waitFor({ state: 'hidden' });
  await phone.getByRole('button', { name: '关闭卡片', exact: true }).click();

  await phone.getByRole('button', { name: '当前视频操作', exact: true }).click();
  await phone.getByRole('button', { name: '收藏到…', exact: true }).click();
  await tv.evaluate(() => { window.reliability.failCollection = true; });
  await phone.getByRole('button', { name: '测试收藏夹 1', exact: true }).click();
  await phone.getByRole('dialog').getByText('操作失败，请重试', { exact: true }).waitFor();
  await tv.evaluate(() => { window.reliability.failCollection = false; });
  await phone.getByRole('button', { name: '测试收藏夹 1', exact: true }).click();
  await tv.waitForFunction(() => window.reliability.collectionWrites.some(write => write.id === 'related:fixture' && write.add));

  await phone.getByRole('button', { name: '工具', exact: true }).click();
  await phone.getByRole('button', { name: '我的', exact: true }).click();
  await phone.getByRole('button', { name: '播放队列', exact: true }).click();
  const menu = () => phone.getByRole('dialog').getByRole('button', { name: '视频操作 相关视频测试', exact: true }).click();
  await menu();
  await phone.getByRole('button', { name: '上移', exact: true }).click();
  await tv.waitForFunction(() => window.reliability.boot.queue[1].id === 'related:fixture');
  await menu();
  await tv.evaluate(() => { window.reliability.failQueue = true; });
  await phone.getByRole('button', { name: '移出队列', exact: true }).click();
  await phone.getByRole('dialog').last().getByText('操作失败，请重试', { exact: true }).waitFor();
  assert.equal(await tv.evaluate(() => window.reliability.boot.queue[1].id), 'related:fixture');
  await tv.evaluate(() => { window.reliability.failQueue = false; });
  await phone.getByRole('button', { name: '移出队列', exact: true }).click();
  await tv.waitForFunction(() => !window.reliability.boot.queue.some(item => item.id === 'related:fixture'));
  await phone.getByRole('dialog').getByText('正在加载…', { exact: true }).waitFor({ state: 'hidden' });
  await phone.getByRole('button', { name: '关闭卡片', exact: true }).click();
}
