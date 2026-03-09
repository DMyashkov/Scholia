import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { cn } from '@/lib/utils';
import { ForceGraphProps, GraphNode, GraphLink, GraphDimensions } from './types';
import { createGraphData, getNodeColor, getConnectedNodeIds } from './utils';
import { useForceSimulation } from './useForceSimulation';
import { useGraphZoom } from './useGraphZoom';
import { ZoomIn, ZoomOut } from 'lucide-react';
import type { PageEdge } from '@/lib/db/types';

const DRAG_THRESHOLD = 6; 

export const ForceGraph = ({ pages, pagesIndexed, className, domain, edges }: ForceGraphProps & { edges?: PageEdge[] }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const graphContainerRef = useRef<SVGGElement>(null);
  const [dimensions, setDimensions] = useState<GraphDimensions>({ width: 280, height: 200 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [, forceUpdate] = useState({});
  
  
  const [tooltipData, setTooltipData] = useState<{ node: GraphNode; x: number; y: number } | null>(null);
  
  
  const dragStateRef = useRef<{ isDragging: boolean; startX: number; startY: number; hasMoved: boolean }>({
    isDragging: false,
    startX: 0,
    startY: 0,
    hasMoved: false,
  });
  
  
  const graphDataRef = useRef<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] });
  const prevPagesIndexedRef = useRef(0);
  const prevPageIdsKeyRef = useRef('');

  // Create/update graph data when pages, pagesIndexed, or edges change
  const graphData = useMemo(() => {
    const pageIdsKey = pages.map((p) => p.id).sort().join(',');
    const pageSetChanged = pageIdsKey !== prevPageIdsKeyRef.current;
    const currentEdgesLength = edges?.length || 0;
    const prevEdgesLength = graphDataRef.current.links.length;
    const edgesChanged = currentEdgesLength !== prevEdgesLength;
    const edgesJustArrived = (edges?.length ?? 0) > 0 && prevEdgesLength === 0;

    const shouldRegenerate =
      pageSetChanged ||
      pages.length !== graphDataRef.current.nodes.length ||
      pagesIndexed > prevPagesIndexedRef.current ||
      pagesIndexed === 0 ||
      edgesChanged ||
      edgesJustArrived;

    if (shouldRegenerate) {
      prevPagesIndexedRef.current = pagesIndexed;
      prevPageIdsKeyRef.current = pageIdsKey;
      const data = createGraphData(pages, pagesIndexed, dimensions, domain, edges);
      
      // Preserve positions of existing nodes for smooth transitions
      const existingNodes = graphDataRef.current.nodes;
      data.nodes.forEach(node => {
        const existing = existingNodes.find(n => n.id === node.id);
        if (existing && existing.x !== undefined && existing.y !== undefined) {
          node.x = existing.x;
          node.y = existing.y;
          node.vx = existing.vx || 0;
          node.vy = existing.vy || 0;
        }
      });
      
      graphDataRef.current = data;
    }
    return graphDataRef.current;
  }, [pages, pagesIndexed, dimensions, domain, edges]);

  const { nodes, links } = graphData;

  // Force re-render on tick
  const handleTick = useCallback(() => {
    forceUpdate({});
  }, []);

  // Initialize simulation
  const {
    initSimulation,
    dragStart,
    drag,
    dragEnd,
    stop,
    reheat,
  } = useForceSimulation({
    nodes,
    links,
    dimensions,
    onTick: handleTick,
  });

  // Initialize zoom with smooth transitions
  const { initZoom, zoomIn, zoomOut, getCurrentTransform } = useGraphZoom({
    svgRef,
    containerRef: graphContainerRef,
    onZoom: (transform) => setZoomLevel(transform.k),
  });

  // Handle resize
  useEffect(() => {
    if (!containerRef.current) return;
    
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    });
    
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Initialize zoom behavior once
  useEffect(() => {
    initZoom();
  }, [initZoom]);

  // Initialize/update simulation when data changes - with gentle reheat for new nodes
  useEffect(() => {
    if (nodes.length > 0) {
      initSimulation();
      // Gentle reheat for smooth new node integration
      if (pagesIndexed > 0) {
        reheat(0.1);
      }
    }
    return () => stop();
  }, [nodes.length, initSimulation, stop, reheat, pagesIndexed]);

  // Handle node click (open URL in new tab)
  const handleNodeClick = useCallback((node: GraphNode, e: React.MouseEvent) => {
    // Don't open if we were dragging
    if (dragStateRef.current.hasMoved) {
      e.stopPropagation();
      return;
    }
    
    if (node.url) {
      window.open(node.url, '_blank', 'noopener,noreferrer');
    }
  }, []);

  
  const handleNodeMouseEnter = useCallback((node: GraphNode, e: React.MouseEvent) => {
    setHoveredNode(node.id);
    
    
    const transform = getCurrentTransform();
    const x = (node.x || 0) * transform.k + transform.x;
    const y = (node.y || 0) * transform.k + transform.y;
    
    setTooltipData({ node, x, y });
  }, [getCurrentTransform]);

  
  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNode(null);
    setTooltipData(null);
  }, []);

  
  const handlePointerDown = useCallback((node: GraphNode, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    const svg = svgRef.current;
    if (!svg) return;
    
    
    dragStateRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      hasMoved: false,
    };
    
    
    dragStart(node);
    
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const dx = Math.abs(moveEvent.clientX - dragStateRef.current.startX);
      const dy = Math.abs(moveEvent.clientY - dragStateRef.current.startY);
      
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        dragStateRef.current.hasMoved = true;
      }
      
      
      const rect = svg.getBoundingClientRect();
      const transform = getCurrentTransform();
      const x = (moveEvent.clientX - rect.left - transform.x) / transform.k;
      const y = (moveEvent.clientY - rect.top - transform.y) / transform.k;
      
      drag(node, x, y);
      
      
      setTooltipData({
        node,
        x: moveEvent.clientX - rect.left,
        y: moveEvent.clientY - rect.top,
      });
    };
    
    const handlePointerUp = () => {
      
      dragEnd(node);
      
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      
      
      setTimeout(() => {
        dragStateRef.current.isDragging = false;
        dragStateRef.current.hasMoved = false;
      }, 50);
    };
    
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  }, [dragStart, drag, dragEnd, getCurrentTransform]);


  
  const connectedNodes = useMemo(() => {
    if (!hoveredNode) return new Set<string>();
    return getConnectedNodeIds(hoveredNode, links);
  }, [hoveredNode, links]);

  const showLabels = zoomLevel > 0.5;
  
  const labelFontSize = Math.max(4, Math.min(22, 10 / zoomLevel));
  
  const maxLabelChars = Math.round(22 + zoomLevel * 8);

  return (
    <div 
      ref={containerRef}
      className={cn(
        'relative w-full aspect-square rounded-lg bg-background/30 border border-border/50 overflow-hidden',
        className
      )}
    >
      <svg 
        ref={svgRef}
        width={dimensions.width} 
        height={dimensions.height}
        className="absolute inset-0"
        style={{ cursor: 'grab' }}
      >
        {}
        <rect 
          className="graph-background" 
          width={dimensions.width} 
          height={dimensions.height} 
          fill="transparent"
        />
        
        <g ref={graphContainerRef}>
          {}
          {links.map((link, i) => {
            const source = link.source as GraphNode;
            const target = link.target as GraphNode;
            if (!source.x || !source.y || !target.x || !target.y) return null;

            const sourceId = typeof link.source === 'object' ? source.id : link.source;
            const targetId = typeof link.target === 'object' ? target.id : link.target;
            const isHighlighted = hoveredNode && (sourceId === hoveredNode || targetId === hoveredNode);
            const isFaded = hoveredNode && !isHighlighted;

            return (
              <line
                key={`link-${i}`}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={isHighlighted ? 'hsl(var(--primary))' : 'hsl(var(--border))'}
                strokeOpacity={isFaded ? 0.15 : isHighlighted ? 0.9 : 0.4}
                strokeWidth={isHighlighted ? 2 : 1}
                style={{ transition: 'stroke-opacity 200ms ease, stroke 200ms ease, stroke-width 200ms ease' }}
              />
            );
          })}

          {}
            {nodes.map((node) => {
            if (node.x === undefined || node.y === undefined) return null;

            const isHovered = hoveredNode === node.id;
            const isConnected = connectedNodes.has(node.id);
            const isFaded = hoveredNode && !isConnected;
            
            
            const displayTitle = node.title.length > maxLabelChars ? node.title.slice(0, maxLabelChars - 2) + '…' : node.title;

            
            
            const charWidthApprox = labelFontSize * 0.55;
            const hPad = Math.max(2, labelFontSize * 0.5);
            const vPad = Math.max(1, labelFontSize * 0.35);
            const labelWidth = displayTitle.length * charWidthApprox + hPad * 2;
            const labelHeight = labelFontSize + vPad * 2;
            const gapFromNode = 5 + labelFontSize * 0.3;
            const labelBaseline = -5 - gapFromNode - labelFontSize;

            return (
              <g
                key={node.id}
                className="node"
                data-node-id={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                style={{ 
                  cursor: dragStateRef.current.isDragging ? 'grabbing' : 'grab',
                  opacity: isFaded ? 0.2 : 1,
                  transition: 'opacity 200ms ease',
                  touchAction: 'none',
                }}
                onMouseEnter={(e) => handleNodeMouseEnter(node, e)}
                onMouseLeave={handleNodeMouseLeave}
                onClick={(e) => handleNodeClick(node, e)}
                onPointerDown={(e) => handlePointerDown(node, e)}
              >
                {}
                {(isHovered || isConnected) && (
                  <circle
                    r={isHovered ? 14 : 10}
                    fill={getNodeColor(node.status)}
                    opacity={0.15}
                    style={{ transition: 'r 200ms ease, opacity 200ms ease' }}
                  />
                )}
                <circle
                  r={isHovered ? 8 : 5}
                  fill={getNodeColor(node.status)}
                  stroke="hsl(var(--background))"
                  strokeWidth={1.5}
                  style={{ transition: 'r 200ms ease' }}
                />
                {}
                {(showLabels || isHovered || isConnected) && (
                  <>
                    <rect
                      x={-labelWidth / 2}
                      y={labelBaseline - vPad}
                      width={labelWidth}
                      height={labelHeight}
                      rx={4}
                      fill="hsl(var(--background) / 0.9)"
                      className="pointer-events-none"
                    />
                    <text
                      x={0}
                      dy={labelBaseline + labelFontSize}
                      textAnchor="middle"
                      fill="hsl(var(--foreground))"
                      fontSize={`${labelFontSize}px`}
                      fontWeight={isHovered ? 500 : 400}
                      opacity={isHovered ? 1 : 0.85}
                      className="pointer-events-none select-none"
                    >
                      {displayTitle}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      
      {}
      {tooltipData && (
        <div 
          className="absolute z-20 px-2.5 py-1.5 text-xs max-w-[200px] bg-popover text-popover-foreground rounded-md shadow-lg border border-border pointer-events-none"
          style={{
            left: (() => {
              const pad = 10;
              const tipW = 200;
              const x = tooltipData.x + pad;
              if (x + tipW > dimensions.width - pad) return dimensions.width - tipW - pad;
              if (x < pad) return pad;
              return x;
            })(),
            top: (() => {
              const pad = 8;
              const tipH = 42;
              const y = tooltipData.y - tipH - 8;
              if (y < pad) return tooltipData.y + pad;
              if (y + tipH > dimensions.height - pad) return Math.max(pad, dimensions.height - tipH - pad);
              return y;
            })(),
            transition: 'opacity 150ms ease',
          }}
        >
          <div className="font-medium break-words line-clamp-3">{tooltipData.node.title}</div>
          {tooltipData.node.url && (
            <div className="text-[10px] text-muted-foreground truncate opacity-75 mt-0.5">
              Click to open
            </div>
          )}
        </div>
      )}
      
      {}
      <div className="absolute bottom-2 right-2 flex gap-1">
        <button
          onClick={zoomIn}
          className="w-6 h-6 rounded bg-secondary/80 hover:bg-secondary text-xs flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          title="Zoom in"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={zoomOut}
          className="w-6 h-6 rounded bg-secondary/80 hover:bg-secondary text-xs flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          title="Zoom out"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
      </div>
      
    </div>
  );
};