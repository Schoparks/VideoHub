import assert from 'node:assert/strict';

export async function checkPhoneBrowse(phone, tv) {
  const nav = phone.getByRole('navigation', { name: '主导航', exact: true });
  assert.deepEqual(await nav.getByRole('button').allTextContents(), ['首页', '哔哩哔哩', '关注直播', '番剧与影视', '本地片库', '我的收藏']);
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await phone.setViewportSize(size);
    const tools = await phone.locator('.companion-tools').boundingBox();
    const content = await phone.locator('.companion-content').boundingBox();
    assert.ok(tools.x >= 0 && tools.x + tools.width <= size.width);
    assert.ok(content.x >= 0 && content.x + content.width <= size.width);
  }
  await phone.setViewportSize({ width: 390, height: 844 });
  const choose = async label => { await nav.getByRole('button', { name: label, exact: true }).click(); };
  await choose('哔哩哔哩');
  await phone.getByRole('button', { name: '关注动态', exact: true }).click();
  await phone.getByText('手机动态完整正文', { exact: true }).waitFor();
  await phone.getByText('转发正文', { exact: true }).waitFor();
  await phone.getByLabel('动态筛选', { exact: true }).selectOption('video');
  await tv.waitForFunction(() => window.reliability.browse.some(value => value.kind === 'dynamic' && value.dynamicType === 'video'));
  await phone.getByRole('button', { name: '分区浏览', exact: true }).click();
  await phone.getByLabel('视频分区', { exact: true }).selectOption('188');
  await tv.waitForFunction(() => window.reliability.browse.some(value => value.kind === 'regions' && value.id === 188));
  await choose('关注直播');
  await tv.waitForFunction(() => window.reliability.browse.some(value => value.kind === 'followingLive'));
  await choose('番剧与影视');
  await phone.getByLabel('影视分类', { exact: true }).selectOption('3');
  await tv.waitForFunction(() => window.reliability.browse.some(value => value.kind === 'cinema' && value.id === 3));
  await phone.getByRole('button', { name: '我的追番追剧', exact: true }).click();
  await phone.getByLabel('影视分类', { exact: true }).selectOption('2');
  await tv.waitForFunction(() => window.reliability.browse.some(value => value.kind === 'followingCinema' && value.id === 2));
  await choose('本地片库');
  await phone.getByRole('button', { name: '播放 本地样片', exact: true }).waitFor();
  await choose('我的收藏');
  assert.deepEqual(await phone.getByRole('navigation', { name: '我的分类' }).getByRole('button').allTextContents(), ['稍后再看', 'B 站收藏', 'B 站历史', '本机历史', '播放队列']);
  await phone.getByRole('button', { name: '测试收藏夹 1', exact: true }).waitFor();
  await choose('首页');
  await phone.getByRole('button', { name: '播放 可靠性测试', exact: true }).waitFor();
  await tv.getByRole('heading', { name: '首页', exact: true }).waitFor();
}
