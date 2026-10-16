import { useLayoutEffect, useRef } from 'react';
import { installGlassOptics } from '../visual/glass-optics';

export function GlassOptics() {
  const svg = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => installGlassOptics(svg.current!), []);
  return <svg ref={svg} className="glass-optics" aria-hidden="true" focusable="false" />;
}
