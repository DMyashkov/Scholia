import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { cn } from '@/lib/utils';
import { ForceGraphProps, GraphNode, GraphLink, GraphDimensions } from './types';
import { createGraphData, getNodeColor, getConnectedNodeIds } from './utils';
import { useForceSimulation } from './useForceSimulation';
import { useGraphZoom } from './useGraphZoom';
import { ZoomIn, ZoomOut } from 'lucide-react';

export const ForceGraph = ({ pages, pagesIndexed, className }: ForceGraphProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const graphContainerRef = useRef<SVGGElement>(null);
  const [dimensions, setDimensions] = useState<GraphDimensions>({ width: 280, height: 200 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [, forceUpdate] = useState({});
  
  // Store graph data with stable references
  const graphDataRef = useRef<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] });
  const prevPagesIndexedRef = useRef(0);

  // Create/update graph data only when pagesIndexed changes
  const graphData = useMemo(() => {
    // Only regenerate when we have new pages to add
    if (pagesIndexed > prevPagesIndexedRef.current || pagesIndexed === 0) {
      prevPagesIndexedRef.current = pagesIndexed;
      const data = createGraphData(pages, pagesIndexed, dimensions);
      
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
  }, [pages, pagesIndexed, dimensions.width, dimensions.height]);

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
  const { initZoom, zoomIn, zoomOut } = useGraphZoom({
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

  // Create drag handler
  const createDragHandler = useCallback((node: GraphNode) => {
    return d3.drag<SVGGElement, GraphNode>()
      .on('start', function(event) {
        event.sourceEvent.stopPropagation();
        dragStart(node);
        d3.select(this).classed('dragging', true);
      })
      .on('drag', function(event) {
        drag(node, event.x, event.y);
      })
      .on('end', function(event) {
        dragEnd(node);
        d3.select(this).classed('dragging', false);
      });
  }, [dragStart, drag, dragEnd]);

  // Apply drag to nodes after render
  useEffect(() => {
    if (!graphContainerRef.current) return;

    const container = d3.select(graphContainerRef.current);
    
    container.selectAll<SVGGElement, GraphNode>('.node').each(function(d) {
      const node = d3.select(this);
      // Remove old drag handler and apply new one
      node.on('.drag', null);
      const dragHandler = createDragHandler(d);
      node.call(dragHandler);
    });
  }, [nodes, createDragHandler]);

  // Get connected nodes for hover highlighting
  const connectedNodes = useMemo(() => {
    if (!hoveredNode) return new Set<string>();
    return getConnectedNodeIds(hoveredNode, links);
  }, [hoveredNode, links]);

  const showLabels = zoomLevel > 0.8;

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
          {/* Links */}
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
                strokeOpacity={isFaded ? 0.1 : isHighlighted ? 0.8 : 0.4}
                strokeWidth={isHighlighted ? 1.5 : 1}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            if (node.x === undefined || node.y === undefined) return null;

            const isHovered = hoveredNode === node.id;
            const isConnected = connectedNodes.has(node.id);
            const isFaded = hoveredNode && !isConnected;
            
            // Truncate long titles with ellipsis
            const displayTitle = node.title.length > 20 ? node.title.slice(0, 18) + '…' : node.title;

            return (
              <g
                key={node.id}
                className="node"
                transform={`translate(${node.x}, ${node.y})`}
                style={{ 
                  cursor: 'pointer',
                  opacity: isFaded ? 0.15 : 1,
                }}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                <circle
                  r={isHovered ? 8 : 5}
                  fill={getNodeColor(node.status)}
                  stroke="hsl(var(--background))"
                  strokeWidth={1.5}
                />
                {/* Label - with background for readability */}
                {(showLabels || isHovered) && (
                  <>
                    <rect
                      x={-displayTitle.length * 2.5 - 4}
                      y={-22}
                      width={displayTitle.length * 5 + 8}
                      height={14}
                      rx={3}
                      fill="hsl(var(--background) / 0.85)"
                      className="pointer-events-none"
                    />
                    <text
                      dy={-12}
                      textAnchor="middle"
                      fill="hsl(var(--foreground))"
                      fontSize="9px"
                      opacity={isHovered ? 1 : 0.8}
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
