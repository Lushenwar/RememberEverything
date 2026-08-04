'use client';
import { useCallback, useEffect, useState } from 'react';
import { allNodes, deleteNode, putNodes } from './db.ts';
import { mergeNodes } from './graph.ts';
import type { GraphNode } from './types.ts';

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

  const remove = useCallback(async (id: string) => {
    await deleteNode(id);
    // Edges pointing at a deleted concept are dropped when they are read
    // (edgesOf ignores dangling targets), so there is nothing to clean up.
    setNodes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const replaceAll = useCallback(async (incoming: GraphNode[]) => {
    await putNodes(incoming);
    setNodes(incoming);
  }, []);

  return { nodes, loading, save, remove, replaceAll, setNodes };
}
