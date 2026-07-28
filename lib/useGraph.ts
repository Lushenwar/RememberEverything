'use client';
import { useCallback, useEffect, useState } from 'react';
import { allNodes, putNodes } from './db';
import { mergeNodes } from './graph';
import type { GraphNode } from './types';

/** Loads the whole graph from IndexedDB once, then keeps it in React state. */
export function useGraph() {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    allNodes()
      .then(setNodes)
      .finally(() => setLoading(false));
  }, []);

  const save = useCallback(async (incoming: GraphNode[]) => {
    await putNodes(incoming);
    setNodes((prev) => mergeNodes(prev, incoming));
  }, []);

  return { nodes, loading, save, setNodes };
}
