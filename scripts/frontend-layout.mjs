import assert from 'node:assert/strict';

export async function assertFrontendLayout(page, label) {
  const measurements = await page.evaluate(() => {
    const content = document.querySelector('main');
    const tabs = [...document.querySelectorAll('.tabs')].map(tab => ({
      width: tab.clientWidth,
      scrollWidth: tab.scrollWidth,
      labels: [...tab.querySelectorAll('button')].map(button => {
        const rect = button.getBoundingClientRect();
        return {
          text: button.textContent,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      }),
    }));
    const dialog = document.querySelector('[role="dialog"]');
    const rect = dialog?.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: { width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
      content: content ? { width: content.clientWidth, scrollWidth: content.scrollWidth } : undefined,
      tabs,
      dialog: rect ? {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: dialog.clientWidth,
        scrollWidth: dialog.scrollWidth,
      } : undefined,
    };
  });
  assert.ok(measurements.document.scrollWidth <= measurements.document.width + 1, `${label}: document overflow`);
  if (measurements.content) {
    assert.ok(measurements.content.scrollWidth <= measurements.content.width + 1, `${label}: main overflow`);
  }
  for (const tab of measurements.tabs) {
    assert.ok(tab.scrollWidth <= tab.width + 1, `${label}: navigation tabs overflow`);
    for (const [index, button] of tab.labels.entries()) {
      assert.ok(button.left >= 0 && button.right <= measurements.viewport.width + 1, `${label}: clipped tab ${button.text}`);
      for (const other of tab.labels.slice(index + 1)) {
        const overlaps = Math.min(button.right, other.right) - Math.max(button.left, other.left) > 1
          && Math.min(button.bottom, other.bottom) - Math.max(button.top, other.top) > 1;
        assert.equal(overlaps, false, `${label}: overlapping tabs`);
      }
    }
  }
  if (measurements.dialog) {
    const dialog = measurements.dialog;
    assert.ok(dialog.scrollWidth <= dialog.width + 1, `${label}: dialog overflow`);
    assert.ok(dialog.left >= 0 && dialog.right <= measurements.viewport.width + 1, `${label}: dialog clipped horizontally`);
    assert.ok(dialog.top >= 0 && dialog.bottom <= measurements.viewport.height + 1, `${label}: dialog clipped vertically`);
  }
  return measurements;
}
