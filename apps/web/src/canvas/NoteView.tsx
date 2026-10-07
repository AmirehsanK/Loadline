import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { FlowNote } from '../design/model.ts';
import { useDesign } from '../design/store.ts';
import { useMessages } from '../i18n/index.ts';

/**
 * Words on the drawing. It is dashed and has no plate, so that it is not taken for a part: nothing
 * calls it and it does nothing. It is dragged by its top strip, and the text below is typed into.
 */
export function NoteView({ id, data, selected, isConnectable }: NodeProps<FlowNote>) {
  const m = useMessages();
  const writeNote = useDesign((state) => state.writeNote);
  const lines = Math.min(8, Math.max(2, data.text.split('\n').length));
  return (
    <div
      className={`w-48 border-2 border-dashed bg-plate/85 ${selected ? 'border-ink outline-2 outline-offset-2 outline-ink' : 'border-ink-3'}`}
    >
      <div className="cursor-grab px-2 pt-1 text-[0.75rem] tracking-wide text-ink-3 uppercase active:cursor-grabbing">{m.notes.label}</div>
      {isConnectable ? (
        <textarea
          // Typing and selecting text here must not drag the note or pan the canvas.
          className="nodrag nopan nowheel block w-full resize-none bg-transparent px-2 pb-1.5 text-[0.9rem] leading-snug text-ink outline-none placeholder:text-ink-3"
          dir="auto"
          rows={lines}
          maxLength={500}
          value={data.text}
          aria-label={m.notes.label}
          placeholder={m.notes.placeholder}
          onChange={(event) => {
            writeNote(id, event.target.value);
          }}
          // Backspace in the text is for the text; the canvas would take it for "delete the note".
          onKeyDown={(event) => {
            event.stopPropagation();
          }}
        />
      ) : (
        <p dir="auto" className="px-2 pb-1.5 text-[0.9rem] leading-snug whitespace-pre-wrap text-ink">
          {data.text}
        </p>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
