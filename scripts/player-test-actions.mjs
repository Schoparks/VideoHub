/** Interact with the actual player option menu instead of a native select. */
export async function revealPlayerControls(page) {
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => {
    const player = document.querySelector('.player');
    const overlay = player?.querySelector('.player-overlay');
    return player?.classList.contains('controls-visible') && !player.inert && overlay && !overlay.inert;
  });
}

export async function choosePlayerRate(page, value) {
  await revealPlayerControls(page);
  await page.getByRole('button', { name: '播放速度', exact: true }).click();
  const menu = page.getByRole('dialog', { name: '播放速度', exact: true });
  await menu.waitFor();
  await menu.locator(`[data-option-id="${Number(value)}"]`).click();
  await menu.waitFor({ state: 'detached' });
}

export async function choosePlayerQuality(page, value, activation = 'click') {
  await revealPlayerControls(page);
  await page.getByRole('button', { name: '清晰度', exact: true }).click();
  const menu = page.getByRole('dialog', { name: '清晰度', exact: true });
  await menu.waitFor();
  const option = menu.locator(`[data-option-id="${Number(value)}"]`);
  if (activation === 'space') {
    await option.focus();
    await page.keyboard.press('Space');
  } else await option.click();
  await menu.waitFor({ state: 'detached' });
}
