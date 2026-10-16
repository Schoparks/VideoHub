/** Lower layout declarations with equivalent behavior; flex gaps need scoped CSS. */
export const androidCssCompatibility = {
  postcssPlugin: 'yingji-chromium66-layout',
  Declaration(declaration) {
    const { prop, value } = declaration;
    if (prop === 'inset') {
      const parts = value.trim().split(/\s+/);
      const sides = [parts[0], parts[1] || parts[0], parts[2] || parts[0], parts[3] || parts[1] || parts[0]];
      ['top', 'right', 'bottom', 'left'].forEach((prop, index) => declaration.cloneBefore({ prop, value: sides[index] }));
    } else if (prop === 'gap') declaration.cloneBefore({ prop: 'grid-gap' });
    else if (prop === 'appearance') declaration.cloneBefore({ prop: '-webkit-appearance' });
    else if (prop === 'place-items') {
      declaration.cloneBefore({ prop: 'align-items' });
      declaration.cloneBefore({ prop: 'justify-items' });
    } else if (prop === 'overflow-wrap' && value === 'anywhere') {
      declaration.cloneBefore({ value: 'break-word' });
    }
  },
};
