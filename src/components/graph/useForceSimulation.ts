import { useRef, useCallback, useEffect } from 'react';
import * as d3 from 'd3';
import { GraphNode, GraphLink, GraphDimensions } from './types';

interface UseForceSimulationProps {
  nodes: GraphNode[];
  links: GraphLink[];
  dimensions: GraphDimensions;
  onTick: () => void;
}

export const useForceSimulation = ({
  nodes,
  links,
  dimensions,
  onTick,
}: UseForceSimulationProps) => {
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const nodesRef = useRef<GraphNode[]>(nodes);
  const linksRef = useRef<GraphLink[]>(links);

  // Keep refs updated
  useEffect(() => {
    nodesRef.current = nodes;
    linksRef.current = links;
  }, [nodes, links]);

  const initSimulation = useCallback(() => {
    // Stop existing simulation
    if (simulationRef.current) {
      simulationRef.current.stop();
    }

    if (nodes.length === 0) return;

    const simulation = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links)
        .id(d => d.id)
        .distance(100)
        .strength(0.2))
      .force('charge', d3.forceManyBody()
        .strength(-180)
        .distanceMin(25)
        .distanceMax(300))
      .force('center', d3.forceCenter(dimensions.width / 2, dimensions.height / 2)
        .strength(0.03))
      .force('collision', d3.forceCollide().radius(28).strength(0.6))
      .force('x', d3.forceX(dimensions.width / 2).strength(0.015))
      .force('y', d3.forceY(dimensions.height / 2).strength(0.015))
      .alphaDecay(0.015)
      .velocityDecay(0.4);

    simulation.on('tick', onTick);
    simulationRef.current = simulation;

    return simulation;
  }, [nodes, links, dimensions, onTick]);

  const reheat = useCallback((alpha: number = 0.3) => {
    simulationRef.current?.alphaTarget(alpha).restart();
    setTimeout(() => {
      simulationRef.current?.alphaTarget(0);
    }, 300);
  }, []);

  const dragStart = useCallback((node: GraphNode) => {
    if (!simulationRef.current) return;
    // Gently reheat simulation during drag
    simulationRef.current.alphaTarget(0.2).restart();
    // Pin node to current position
    node.fx = node.x;
    node.fy = node.y;
  }, []);

  const drag = useCallback((node: GraphNode, x: number, y: number) => {
    // Update pinned position - edges update automatically via simulation tick
    node.fx = x;
    node.fy = y;
  }, []);

  const dragEnd = useCallback((node: GraphNode) => {
    if (!simulationRef.current) return;
    // Cool down simulation
    simulationRef.current.alphaTarget(0);
    // Release node back into physics simulation (unpins it)
    node.fx = null;
    node.fy = null;
  }, []);

  const stop = useCallback(() => {
    simulationRef.current?.stop();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      simulationRef.current?.stop();
    };
  }, []);

  return {
    simulation: simulationRef,
    initSimulation,
    reheat,
    dragStart,
    drag,
    dragEnd,
    stop,
  };
};
