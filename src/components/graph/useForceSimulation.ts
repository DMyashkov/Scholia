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
        .distance(45)
        .strength(0.3))
      .force('charge', d3.forceManyBody()
        .strength(-80)
        .distanceMin(15)
        .distanceMax(150))
      .force('center', d3.forceCenter(dimensions.width / 2, dimensions.height / 2)
        .strength(0.03))
      .force('collision', d3.forceCollide().radius(18).strength(0.5))
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
    simulationRef.current.alphaTarget(0.3).restart();
    node.fx = node.x;
    node.fy = node.y;
  }, []);

  const drag = useCallback((node: GraphNode, x: number, y: number) => {
    node.fx = x;
    node.fy = y;
  }, []);

  const dragEnd = useCallback((node: GraphNode) => {
    if (!simulationRef.current) return;
    simulationRef.current.alphaTarget(0);
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
