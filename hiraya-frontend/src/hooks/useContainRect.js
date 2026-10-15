import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { containRect } from '../utils/containRect';

/*
 * Where an `object-contain` picture is painted inside the element `ref` is on.
 *
 * Measures the element (ResizeObserver) and the picture's natural size, and
 * returns the letterboxed rectangle from containRect(). Shared by everything
 * that draws on the customer's photo: the callout layer and the photo scan.
 */
export const useContainRect = (src) => {
  const ref = useRef(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () => setBox({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!src) return undefined;
    let alive = true;
    const img = new Image();
    img.onload = () => alive && setNatural({ width: img.naturalWidth, height: img.naturalHeight });
    img.src = src;
    return () => { alive = false; };
  }, [src]);

  const rect = natural ? containRect(box.width, box.height, natural.width, natural.height) : null;
  return { ref, box, rect };
};
