import { useRef, useCallback, useEffect } from 'react';
import * as d3 from 'd3';

interface UseGraphZoomProps {
  svgRef: React.RefObject<SVGSVGElement>;
  containerRef: React.RefObject<SVGGElement>;
  minScale?: number;
  maxScale?: number;
  onZoom?: (transform: d3.ZoomTransform) => void;
}

export const useGraphZoom = ({
  svgRef,
  containerRef,
  minScale = 0.2,
  maxScale = 5,
  onZoom,
}: UseGraphZoomProps) => {
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);

  const initZoom = useCallback(() => {
    if (!svgRef.current || !containerRef.current) return;

    const svg = d3.select(svgRef.current);
    const container = d3.select(containerRef.current);

    // Remove any existing zoom behavior
    svg.on('.zoom', null);

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([minScale, maxScale])
      .filter((event) => {
        // Allow wheel events and drag events (not on nodes)
        if (event.type === 'wheel') return true;
        if (event.type === 'mousedown' || event.type === 'touchstart') {
          // Only allow zoom drag on the background, not on nodes
          const target = event.target as Element;
          return target.tagName === 'svg' || target.classList.contains('graph-background');
        }
        return true;
      })
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        container.attr('transform', event.transform.toString());
        onZoom?.(event.transform);
      });

    svg.call(zoom);
    zoomBehaviorRef.current = zoom;

    return zoom;
  }, [svgRef, containerRef, minScale, maxScale, onZoom]);

  const zoomIn = useCallback(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.transition()
      .duration(200)
      .ease(d3.easeQuadOut)
      .call(zoomBehaviorRef.current.scaleBy, 1.3);
  }, [svgRef]);

  const zoomOut = useCallback(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.transition()
      .duration(200)
      .ease(d3.easeQuadOut)
      .call(zoomBehaviorRef.current.scaleBy, 0.75);
  }, [svgRef]);

  const resetZoom = useCallback(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.transition().duration(500).call(
      zoomBehaviorRef.current.transform,
      d3.zoomIdentity
    );
  }, [svgRef]);

  const getScale = useCallback(() => {
    return transformRef.current.k;
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (svgRef.current) {
        d3.select(svgRef.current).on('.zoom', null);
      }
    };
  }, [svgRef]);

  return {
    initZoom,
    zoomIn,
    zoomOut,
    resetZoom,
    getScale,
    transform: transformRef,
  };
};
