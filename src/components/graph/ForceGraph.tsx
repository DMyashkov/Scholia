import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { cn } from '@/lib/utils';
import { ForceGraphProps, GraphNode, GraphLink, GraphDimensions } from './types';
import { createGraphData, getNodeColor, getConnectedNodeIds } from './utils';
import { useForceSimulation } from './useForceSimulation';
import { useGraphZoom } from './useGraphZoom';
import { ZoomIn, ZoomOut } from 'lucide-react';

const DRAG_THRESHOLD = 6; // pixels - movement beyond this is a drag, not a click

export const ForceGraph = ({ pages, pagesIndexed, className, domain }: ForceGraphProps) => {
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

  // Create/update graph data only when pagesIndexed changes
  const graphData = useMemo(() => {
    // Only regenerate when we have new pages to add
    if (pagesIndexed > prevPagesIndexedRef.current || pagesIndexed === 0) {
      prevPagesIndexedRef.current = pagesIndexed;
      const data = createGraphData(pages, pagesIndexed, dimensions, domain);
      
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
  }, [pages, pagesIndexed, dimensions.width, dimensions.height, domain]);

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

  // Create drag handler
  const createDragHandler = useCallback((node: GraphNode) => {
    return d3.drag<SVGGElement, GraphNode>()
      .on('start', function(event) {
        event.sourceEvent.stopPropagation();
        
        // Track drag start position
        dragStateRef.current = {
          isDragging: true,
          startX: event.x,
          startY: event.y,
          hasMoved: false,
        };
        
        // fx/fy pins the node during drag
        dragStart(node);
        d3.select(this).style('cursor', 'grabbing');
      })
      .on('drag', function(event) {
        // Check if we've moved beyond threshold
        const dx = Math.abs(event.x - dragStateRef.current.startX);
        const dy = Math.abs(event.y - dragStateRef.current.startY);
        if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
          dragStateRef.current.hasMoved = true;
        }
        
        drag(node, event.x, event.y);
        
        // Update tooltip position during drag
        if (tooltipData?.node.id === node.id) {
          const transform = getCurrentTransform();
          const x = event.x * transform.k + transform.x;
          const y = event.y * transform.k + transform.y;
          setTooltipData({ node, x, y });
        }
      })
      .on('end', function(event) {
        // Release the node back into physics simulation (clear fx/fy)
        dragEnd(node);
        d3.select(this).style('cursor', 'pointer');
        
        // Reset drag state after a short delay to allow click handler to check
        setTimeout(() => {
          dragStateRef.current.isDragging = false;
          dragStateRef.current.hasMoved = false;
        }, 50);
      });
  }, [dragStart, drag, dragEnd, tooltipData, getCurrentTransform]);

  // Apply drag to nodes after render
  useEffect(() => {
    if (!graphContainerRef.current) return;

    const container = d3.select(graphContainerRef.current);
    
    container.selectAll<SVGGElement, GraphNode>('.node').each(function(d) {
      const nodeEl = d3.select(this);
      // Remove old drag handler and apply new one
      nodeEl.on('.drag', null);
      const dragHandler = createDragHandler(d);
      nodeEl.call(dragHandler);
    });
  }, [nodes, createDragHandler]);

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
                  cursor: 'pointer',
                  opacity: isFaded ? 0.2 : 1,
                  transition: 'opacity 200ms ease',
                }}
                onMouseEnter={(e) => handleNodeMouseEnter(node, e)}
                onMouseLeave={handleNodeMouseLeave}
                onClick={(e) => handleNodeClick(node, e)}
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
      
      {/* Empty state */}
      {pagesIndexed === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Discovering pages...
          </span>
        </div>
      )}
    </div>
  );
};
