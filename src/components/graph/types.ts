import * as d3 from 'd3';
import { DiscoveredPage } from '@/types/source';

export interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  status: 'indexed' | 'crawling' | 'pending' | 'error';
}

export interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface ForceGraphProps {
  pages: DiscoveredPage[];
  pagesIndexed: number;
  className?: string;
}

export interface GraphDimensions {
  width: number;
  height: number;
}
