/** Open the single topbar search entry through the same semantic confirm as a controller. */
export async function openSearchKeyboard(page) {
  await page.getByRole('textbox', { name: '搜索视频', exact: true }).focus();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('hub-controller-action', { detail: 'confirm', cancelable: true })));
  await page.locator('.search-dialog .screen-keyboard').waitFor();
}
