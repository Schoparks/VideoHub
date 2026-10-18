import { useLayoutEffect, useRef } from 'react';
import { installGlassOptics } from '../visual/glass-optics';
import { installGlassMaterial } from '../visual/glass-material';
import { installGlassButtons } from '../visual/glass-buttons';

export function GlassOptics() {
  const svg = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const releaseMaterial = installGlassMaterial();
    const releaseOptics = installGlassOptics(svg.current!);
    const releaseButtons = installGlassButtons();
    return () => { releaseButtons(); releaseOptics(); releaseMaterial(); };
  }, []);
  return <svg ref={svg} className="glass-optics" aria-hidden="true" focusable="false" />;
}
