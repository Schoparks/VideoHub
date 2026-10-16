export async function connectPad(page) {
  await page.evaluate(() => {
    window.testPad = {
      id: 'Simulated Xbox interaction audit', mapping: 'standard', index: 0, connected: true,
      axes: [0, 0], buttons: Array.from({ length: 20 }, () => ({ pressed: false, value: 0 })),
    };
    window.testPadSamples = Array(20).fill(0);
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => {
      window.testPad.buttons.forEach((button, index) => { if (button.pressed) window.testPadSamples[index]++; });
      return [window.testPad];
    } });
  });
  await page.waitForFunction(() => document.documentElement.dataset.inputMode === 'gamepad');
}

export async function pressPad(page, index, duration = 40) {
  const before = await page.evaluate(index => {
    const count = window.testPadSamples[index];
    window.testPad.buttons[index] = { pressed: true, value: 1 };
    return count;
  }, index);
  // A fixed 40 ms pulse can end before the headless renderer polls under load.
  await page.waitForFunction(({ index, before }) => window.testPadSamples[index] > before, { index, before });
  await page.waitForTimeout(duration);
  await page.evaluate(index => { window.testPad.buttons[index] = { pressed: false, value: 0 }; }, index);
  await page.waitForTimeout(60);
}

export async function focusGridFixture(page) {
  await page.evaluate(() => {
    const scope = document.createElement('section');
    scope.id = 'controller-grid'; scope.dataset.focusScope = '';
    scope.style.cssText = 'position:fixed;inset:90px 150px;z-index:100;background:var(--surface);padding:30px;overflow:auto';
    const grid = document.createElement('div'); grid.className = 'media-grid';
    grid.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
    for (let index = 0; index < 6; index++) {
      const wrap = document.createElement('div'); wrap.className = 'media-card-wrap';
      const card = document.createElement('button'); card.className = 'media-card'; card.id = `grid-card-${index}`;
      card.style.height = '140px'; card.textContent = `视频 ${index + 1}`;
      const details = document.createElement('button'); details.className = 'card-details'; details.textContent = '详情';
      wrap.append(card, details); grid.append(wrap);
    }
    const range = document.createElement('input');
    range.type = 'range'; range.min = '.1'; range.max = '.8'; range.step = '.02'; range.value = '.28';
    range.id = 'grid-range'; range.setAttribute('aria-label', '精度滑条');
    const footer = document.createElement('footer'); footer.dataset.inputHintsHost = '';
    scope.append(grid, range, footer); document.body.append(scope); grid.querySelector('button').focus();
  });
}
