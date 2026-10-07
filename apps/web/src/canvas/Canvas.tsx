import type { NodeType } from '@loadline/engine';
import { Background, BackgroundVariant, Controls, ReactFlow, useReactFlow } from '@xyflow/react';
import { useMemo } from 'react';
import type { DragEvent } from 'react';
import { canConnect, isNoteId } from '../design/model.ts';
import type { FlowArrow, FlowEdge, FlowNode, FlowNote } from '../design/model.ts';
import { useDesign } from '../design/store.ts';
import { useMessages } from '../i18n/index.ts';
import { canRemove, canRemoveEdge } from '../level/rules.ts';
import { useSim } from '../sim/store.ts';
import { FlowEdgeView } from './FlowEdgeView.tsx';
import { PART_MIME } from './Palette.tsx';
import { NoteView } from './NoteView.tsx';
import { NODE_VIEWS } from './nodes.tsx';

const edgeTypes = { flow: FlowEdgeView };
const nodeTypes = { ...NODE_VIEWS, note: NoteView };

/** The design, drawn. With `readOnly` it can be panned and zoomed and nothing else. */
export function Canvas({ readOnly = false }: { readOnly?: boolean }) {
  const m = useMessages();
  const nodes = useDesign((state) => state.nodes);
  const edges = useDesign((state) => state.edges);
  const notes = useDesign((state) => state.notes);
  const arrows = useDesign((state) => state.arrows);
  // Notes are drawn under the parts they are about, and their lines under the connections.
  const drawnNodes = useMemo(() => [...notes, ...nodes], [notes, nodes]);
  const drawnEdges = useMemo(() => [...arrows, ...edges], [arrows, edges]);
  const onNodesChange = useDesign((state) => state.onNodesChange);
  const onEdgesChange = useDesign((state) => state.onEdgesChange);
  const connect = useDesign((state) => state.connect);
  const addNode = useDesign((state) => state.addNode);
  const level = useDesign((state) => state.level);
  const running = useSim((state) => state.status === 'running');
  const { screenToFlowPosition } = useReactFlow();

  const onDrop = (event: DragEvent) => {
    const type = event.dataTransfer.getData(PART_MIME) as NodeType | '';
    if (type === '' || readOnly) return;
    event.preventDefault();
    addNode(type, m.parts.types[type].name, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };

  return (
    // Requests flow left to right in every language, so the canvas does not follow the page's direction.
    <div
      dir="ltr"
      className={`h-full ${running ? 'is-running' : ''}`}
      onDragOver={(event) => {
        if (!readOnly && event.dataTransfer.types.includes(PART_MIME)) event.preventDefault();
      }}
      onDrop={onDrop}
    >
      <ReactFlow<FlowNode | FlowNote, FlowEdge | FlowArrow>
        nodes={drawnNodes}
        edges={drawnEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={connect}
        isValidConnection={({ source, target }) =>
          // A note may point at any part; a part may only call what the engine lets it call.
          isNoteId(source) ? !isNoteId(target) : !isNoteId(target) && canConnect(nodes, edges, source, target)
        }
        // The delete key takes out only what the level lets go. A note is nobody's but the player's.
        onBeforeDelete={({ nodes: doomedNodes, edges: doomedEdges }) =>
          Promise.resolve({
            nodes: doomedNodes.filter((node) => isNoteId(node.id) || canRemove(level, node.id)),
            edges: doomedEdges.filter((edge) => isNoteId(edge.source) || canRemoveEdge(level, edge)),
          })
        }
        fitView
        fitViewOptions={{ padding: 0.35, maxZoom: 1 }}
        minZoom={0.3}
        maxZoom={1.5}
        deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable={!readOnly}
        aria-label={m.canvas.label}
      >
        <Background variant={BackgroundVariant.Lines} gap={32} color="var(--color-grid)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
