import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { cn } from '@/lib/utils';
import { ForceGraphProps, GraphNode, GraphLink, GraphDimensions } from './types';
import { createGraphData, getNodeColor, getConnectedNodeIds } from './utils';
import { useForceSimulation } from './useForceSimulation';
import { useGraphZoom } from './useGraphZoom';
import { ZoomIn, ZoomOut } from 'lucide-react';
import type { PageEdge } from '@/lib/db/types';

const DRAG_THRESHOLD = 6; // pixels - movement beyond this is a drag, not a click

export const ForceGraph = ({ pages, pagesIndexed, className, domain, edges }: ForceGraphProps & { edges?: PageEdge[] }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const graphContainerRef = useRef<SVGGElement>(null);
  const [dimensions, setDimensions] = useState<GraphDimensions>({ width: 280, height: 200 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [, forceUpdate] = useState({});
  
  // Tooltip state
  const [tooltipData, setTooltipData] = useState<{ node: GraphNode; x: number; y: number } | null>(null);
  
  // Drag state for preventing click after drag
  const dragStateRef = useRef<{ isDragging: boolean; startX: number; startY: number; hasMoved: boolean }>({
    isDragging: false,
    startX: 0,
    startY: 0,
    hasMoved: false,
  });
  
  // Store graph data with stable references
  const graphDataRef = useRef<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] });
  const prevPagesIndexedRef = useRef(0);

  // Create/update graph data when pages, pagesIndexed, or edges change
  const graphData = useMemo(() => {
    // Always regenerate when pages array changes (new pages added) or pagesIndexed increases
    const shouldRegenerate = 
      pages.length !== graphDataRef.current.nodes.length ||
      pagesIndexed > prevPagesIndexedRef.current ||
      pagesIndexed === 0 ||
      (edges && edges.length !== graphDataRef.current.links.length);
    
    if (shouldRegenerate) {
      prevPagesIndexedRef.current = pagesIndexed;
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
  }, [pages, pagesIndexed, dimensions.width, dimensions.height, domain, edges]);

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

  // Handle mouse enter on node
  const handleNodeMouseEnter = useCallback((node: GraphNode, e: React.MouseEvent) => {
    setHoveredNode(node.id);
    
    // Get position for tooltip
    const transform = getCurrentTransform();
    const x = (node.x || 0) * transform.k + transform.x;
    const y = (node.y || 0) * transform.k + transform.y;
    
    setTooltipData({ node, x, y });
  }, [getCurrentTransform]);

  // Handle mouse leave on node
  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNode(null);
    setTooltipData(null);
  }, []);

  // Handle pointer down for drag initialization
  const handlePointerDown = useCallback((node: GraphNode, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    const svg = svgRef.current;
    if (!svg) return;
    
    // Track drag start position
    dragStateRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      hasMoved: false,
    };
    
    // Pin node during drag
    dragStart(node);
    
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const dx = Math.abs(moveEvent.clientX - dragStateRef.current.startX);
      const dy = Math.abs(moveEvent.clientY - dragStateRef.current.startY);
      
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        dragStateRef.current.hasMoved = true;
      }
      
      // Get SVG coordinates
      const rect = svg.getBoundingClientRect();
      const transform = getCurrentTransform();
      const x = (moveEvent.clientX - rect.left - transform.x) / transform.k;
      const y = (moveEvent.clientY - rect.top - transform.y) / transform.k;
      
      drag(node, x, y);
      
      // Update tooltip position
      setTooltipData({
        node,
        x: moveEvent.clientX - rect.left,
        y: moveEvent.clientY - rect.top,
      });
    };
    
    const handlePointerUp = () => {
      // Release node back into physics
      dragEnd(node);
      
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      
      // Reset drag state after short delay
      setTimeout(() => {
        dragStateRef.current.isDragging = false;
        dragStateRef.current.hasMoved = false;
      }, 50);
    };
    
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  }, [dragStart, drag, dragEnd, getCurrentTransform]);


  // Get connected nodes for hover highlighting
  const connectedNodes = useMemo(() => {
    if (!hoveredNode) return new Set<string>();
    return getConnectedNodeIds(hoveredNode, links);
  }, [hoveredNode, links]);

  const showLabels = zoomLevel > 0.6;

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
        {/* Background for pan detection */}
        <rect 
          className="graph-background" 
          width={dimensions.width} 
          height={dimensions.height} 
          fill="transparent"
        />
        
        <g ref={graphContainerRef}>
          {/* Links with smooth transitions */}
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

          {/* Nodes */}
            {nodes.map((node) => {
            if (node.x === undefined || node.y === undefined) return null;

            const isHovered = hoveredNode === node.id;
            const isConnected = connectedNodes.has(node.id);
            const isFaded = hoveredNode && !isConnected;
            
            // Truncate long titles
            const displayTitle = node.title.length > 24 ? node.title.slice(0, 22) + '…' : node.title;

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
                {/* Glow effect for hovered/connected nodes */}
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
                {/* Label - with background for readability */}
                {(showLabels || isHovered || isConnected) && (
                  <>
                    <rect
                      x={-displayTitle.length * 2.8 - 4}
                      y={-24}
                      width={displayTitle.length * 5.6 + 8}
                      height={16}
                      rx={4}
                      fill="hsl(var(--background) / 0.9)"
                      className="pointer-events-none"
                      style={{ transition: 'opacity 200ms ease' }}
                    />
                    <text
                      dy={-12}
                      textAnchor="middle"
                      fill="hsl(var(--foreground))"
                      fontSize="10px"
                      fontWeight={isHovered ? 500 : 400}
                      opacity={isHovered ? 1 : 0.85}
                      className="pointer-events-none select-none"
                      style={{ transition: 'opacity 200ms ease' }}
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
      
      {/* Tooltip - follows cursor/node position */}
      {tooltipData && (
        <div 
          className="absolute z-20 px-2 py-1 text-xs bg-popover text-popover-foreground rounded-md shadow-lg border border-border pointer-events-none max-w-[180px]"
          style={{
            left: Math.min(tooltipData.x + 12, dimensions.width - 100),
            top: Math.max(tooltipData.y - 30, 8),
            transition: 'opacity 150ms ease',
          }}
        >
          <div className="font-medium truncate">{tooltipData.node.title}</div>
          {tooltipData.node.url && (
            <div className="text-[10px] text-muted-foreground truncate opacity-75">
              Click to open
            </div>
          )}
        </div>
      )}
      
      {/* Zoom controls - only 2 buttons */}
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
      
      {/* Empty state - show message when no pages */}
      {pages.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          <div className="text-center px-4">
            <p className="text-sm">No sources added yet</p>
            <p className="text-xs mt-1 opacity-70">Add a source to view the graph</p>
          </div>
        </div>
      )}
    </div>
  );
};
