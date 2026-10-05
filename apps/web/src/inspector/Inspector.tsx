import { cachePrice, databaseServerPrice, instancePrice } from '@loadline/engine';
import type { CommandInput, Dist, Issue } from '@loadline/engine';
import type { ReactNode } from 'react';
import { EDGE_FIELDS, NODE_FIELDS, getPath, setPath } from '../design/fields.ts';
import type { FieldSpec } from '../design/fields.ts';
import type { FlowEdge, FlowNode } from '../design/model.ts';
import { useDesign } from '../design/store.ts';
import type { FieldText, Messages } from '../i18n/en.ts';
import { useMessages } from '../i18n/index.ts';
import { BoltIcon, TrashIcon } from '../icons.tsx';
import { formatCount } from '../metrics/format.ts';
import { inject } from '../sim/controller.ts';
import { useSim } from '../sim/store.ts';
import { NumberField, SelectField, TextField, ToggleField } from './fields.tsx';

/** How long a fault injected from the inspector lasts, in simulated time. */
const FAULT_MS = 10_000;

export function Inspector() {
  const m = useMessages();
  const node = useDesign((state) => state.nodes.find((candidate) => candidate.selected));
  const edge = useDesign((state) => (node ? undefined : state.edges.find((candidate) => candidate.selected)));
  const issues = useSim((state) => state.issues);

  return (
    <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-s border-line bg-plate p-3" aria-labelledby="settings-title">
      <h2 id="settings-title" className="marking">
        {m.inspector.title}
      </h2>
      {node && <NodeSettings node={node} />}
      {edge && <EdgeSettings edge={edge} />}
      {!node && !edge && <p className="text-ink-2">{m.inspector.nothing}</p>}
      <Issues issues={issues} />
    </aside>
  );
}

function NodeSettings({ node }: { node: FlowNode }) {
  const m = useMessages();
  const renameNode = useDesign((state) => state.renameNode);
  const patchNode = useDesign((state) => state.patchNode);
  const texts = m.fields.node[node.type] as Record<string, FieldText>;

  return (
    <div className="flex flex-col gap-3">
      <TextField
        label={m.inspector.name}
        value={node.data.name}
        onChange={(name) => {
          renameNode(node.id, name);
        }}
      />
      <Fields
        specs={NODE_FIELDS[node.type]}
        texts={texts}
        values={node.data.params}
        onChange={(path, value) => {
          patchNode(node.id, setPath(node.data.params, path, value));
        }}
      />
      <Summary node={node} />
      <Faults
        faults={faultsFor(node, m)}
        onInject={(command) => {
          inject(command);
        }}
      />
      <RemoveButton kind="node" id={node.id} />
    </div>
  );
}

function EdgeSettings({ edge }: { edge: FlowEdge }) {
  const m = useMessages();
  const patchEdge = useDesign((state) => state.patchEdge);
  const from = useDesign((state) => state.nodes.find((node) => node.id === edge.source)?.data.name);
  const to = useDesign((state) => state.nodes.find((node) => node.id === edge.target)?.data.name);
  const params = edge.data?.params;
  if (!params) return null;
  const labels = m.inspector.faults;

  return (
    <div className="flex flex-col gap-3">
      <p className="font-bold">{m.inspector.connection(from || edge.source, to || edge.target)}</p>
      <Fields
        specs={EDGE_FIELDS}
        texts={m.fields.edge}
        values={params}
        onChange={(path, value) => {
          patchEdge(edge.id, setPath(params, path, value));
        }}
      />
      <Faults
        faults={[
          { label: labels.sever, command: { type: 'sever', edgeId: edge.id, durationMs: FAULT_MS } },
          { label: labels.delay, command: { type: 'delay', edgeId: edge.id, addMs: 100, durationMs: FAULT_MS } },
        ]}
        onInject={(command) => {
          inject(command);
        }}
      />
      <RemoveButton kind="edge" id={edge.id} />
    </div>
  );
}

interface FieldsProps {
  specs: FieldSpec[];
  texts: Record<string, FieldText>;
  values: object;
  onChange: (path: string, value: unknown) => void;
}

/** One control per setting, from the field table. */
function Fields({ specs, texts, values, onChange }: FieldsProps) {
  const m = useMessages();
  return (
    <>
      {specs.map((spec) => {
        if (spec.when !== undefined && getPath(values, spec.when) !== true) return null;
        const text = texts[spec.path] ?? { label: spec.path };
        const value = getPath(values, spec.path);
        const set = (next: unknown) => {
          onChange(spec.path, next);
        };
        const shared = { label: text.label, ...(text.hint === undefined ? {} : { hint: text.hint }) };

        switch (spec.kind) {
          case 'number':
            return (
              <NumberField
                key={spec.path}
                {...shared}
                value={value as number}
                min={spec.min}
                max={spec.max}
                step={spec.step ?? 1}
                integer={spec.integer ?? false}
                {...(spec.unit === undefined ? {} : { unit: m.units[spec.unit] })}
                onChange={set}
              />
            );
          case 'choice':
            return (
              <SelectField
                key={spec.path}
                {...shared}
                value={value as string}
                options={spec.options.map((option) => ({ value: option, label: text.options?.[option] ?? option }))}
                onChange={set}
              />
            );
          case 'toggle':
            return <ToggleField key={spec.path} {...shared} value={value === true} onChange={set} />;
          case 'work':
            return <WorkField key={spec.path} label={text.label} value={value as Dist} onChange={set} />;
        }
      })}
    </>
  );
}

/** A duration and how much it varies from one time to the next. */
function WorkField({ label, value, onChange }: { label: string; value: Dist; onChange: (value: Dist) => void }) {
  const m = useMessages();
  const texts = m.fields.work;
  return (
    <fieldset className="flex flex-col gap-2 rounded-[3px] border border-line p-2">
      <legend className="field-label px-1">{label}</legend>
      <NumberField
        label={label}
        hideLabel
        value={value.mean}
        min={0.01}
        max={600_000}
        unit={m.units.ms}
        onChange={(mean) => {
          onChange({ ...value, mean });
        }}
      />
      <SelectField
        label={texts.variation}
        value={value.kind}
        options={(['const', 'exp', 'lognormal'] as const).map((kind) => ({ value: kind, label: texts.options[kind] }))}
        onChange={(kind) => {
          onChange({ ...value, kind });
        }}
      />
      {value.kind === 'lognormal' && (
        <NumberField
          label={texts.cv}
          value={value.cv ?? 1}
          min={0}
          max={10}
          step={0.1}
          onChange={(cv) => {
            onChange({ ...value, cv });
          }}
        />
      )}
    </fieldset>
  );
}

/** What the settings add up to: how much the part can carry, and what it costs. */
function Summary({ node }: { node: FlowNode }) {
  const m = useMessages();
  const lines: string[] = [];
  switch (node.type) {
    case 'service':
    case 'worker': {
      const { instances, concurrency, serviceTime } = node.data.params;
      lines.push(m.inspector.room(formatCount((instances * concurrency * 1000) / serviceTime.mean)));
      lines.push(m.inspector.cost(formatCount(instances * instancePrice(concurrency))));
      break;
    }
    case 'database': {
      const { concurrency, replicas } = node.data.params;
      lines.push(m.inspector.cost(formatCount((replicas + 1) * databaseServerPrice(concurrency))));
      break;
    }
    case 'cache':
      lines.push(m.inspector.cost(formatCount(cachePrice(node.data.params.capacity))));
      break;
    default:
      break;
  }
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-[3px] bg-sea-wash px-2 py-1.5 text-[0.9rem]">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

interface Fault {
  label: string;
  command: CommandInput;
}

/** The ways a part of this kind can be broken. */
function faultsFor(node: FlowNode, m: Messages): Fault[] {
  const labels = m.inspector.faults;
  const nodeId = node.id;
  const lasting = { nodeId, durationMs: FAULT_MS };
  const kill: Fault = { label: labels.kill, command: { type: 'kill', ...lasting } };
  const slow: Fault = { label: labels.slow, command: { type: 'slow', factor: 5, ...lasting } };
  const errors: Fault = { label: labels.errors, command: { type: 'errors', rate: 0.3, ...lasting } };
  const killOne: Fault = { label: labels.killOne, command: { type: 'kill', count: 1, ...lasting } };

  switch (node.type) {
    case 'client':
      return [];
    case 'service':
    case 'worker':
      return [killOne, kill, slow, errors];
    case 'cache':
      return [{ label: labels.flush, command: { type: 'flush', nodeId } }, kill, slow];
    case 'database':
      return [{ label: labels.failover, command: { type: 'failover', nodeId } }, kill, slow];
    default:
      return [kill, errors];
  }
}

function Faults({ faults, onInject }: { faults: Fault[]; onInject: (command: CommandInput) => void }) {
  const m = useMessages();
  const running = useSim((state) => state.status === 'running');
  if (faults.length === 0) return null;
  return (
    <section className="flex flex-col gap-1.5 border-t border-line pt-3" aria-labelledby="faults-title">
      <h3 id="faults-title" className="flex items-center gap-1.5 font-bold">
        <BoltIcon />
        {m.inspector.faults.title}
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {faults.map((fault) => (
          <button
            key={fault.label}
            type="button"
            disabled={!running}
            onClick={() => {
              onInject(fault.command);
            }}
            className="rounded-[3px] border border-line px-2 py-1 text-[0.9rem] hover:border-oxide hover:text-oxide disabled:cursor-not-allowed disabled:text-ink-3 disabled:hover:border-line"
          >
            {fault.label}
          </button>
        ))}
      </div>
      <p className="text-[0.85rem] text-ink-3">{m.inspector.faults.hint}</p>
    </section>
  );
}

function RemoveButton({ kind, id }: { kind: 'node' | 'edge'; id: string }): ReactNode {
  const m = useMessages();
  const remove = useDesign((state) => state.remove);
  return (
    <button
      type="button"
      onClick={() => {
        remove(kind, id);
      }}
      className="flex items-center justify-center gap-1.5 self-start rounded-[3px] border border-line px-2.5 py-1 text-ink-2 hover:border-oxide hover:text-oxide"
    >
      <TrashIcon />
      {m.inspector.remove}
    </button>
  );
}

function Issues({ issues }: { issues: Issue[] }) {
  const m = useMessages();
  const nodes = useDesign((state) => state.nodes);
  // Issues name parts by id; people know them by the name on the canvas.
  const describe = (issue: Issue): string => {
    const message = (m.issues as Partial<Record<string, (name: string) => string>>)[issue.code];
    if (!message) return issue.message;
    const node = nodes.find((candidate) => candidate.id === issue.nodeId);
    return message(node?.data.name || issue.nodeId || '');
  };
  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');
  if (issues.length === 0) return null;
  return (
    <div className="mt-auto flex flex-col gap-3 border-t border-line pt-3" role="status">
      {errors.length > 0 && (
        <section>
          <h3 className="mb-1 font-bold text-oxide">{m.inspector.problems}</h3>
          <ul className="flex list-disc flex-col gap-1 ps-4">
            {errors.map((issue, index) => (
              <li key={index}>{describe(issue)}</li>
            ))}
          </ul>
        </section>
      )}
      {warnings.length > 0 && (
        <section>
          <h3 className="mb-1 font-bold">{m.inspector.notes}</h3>
          <ul className="flex list-disc flex-col gap-1 ps-4 text-ink-2">
            {warnings.map((issue, index) => (
              <li key={index}>{describe(issue)}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
