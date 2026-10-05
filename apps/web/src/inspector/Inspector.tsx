import type { Dist, Issue } from '@loadline/engine';
import type { ClientFlowNode, FlowEdge, ServiceFlowNode } from '../design/model.ts';
import { useDesign } from '../design/store.ts';
import { useMessages } from '../i18n/index.ts';
import { TrashIcon } from '../icons.tsx';
import { formatCount } from '../metrics/format.ts';
import { useSim } from '../sim/store.ts';
import { NumberField, SelectField, TextField } from './fields.tsx';

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
      {node?.type === 'client' && <ClientSettings node={node} />}
      {node?.type === 'service' && <ServiceSettings node={node} />}
      {edge && <EdgeSettings edge={edge} />}
      {!node && !edge && <p className="text-ink-2">{m.inspector.nothing}</p>}
      <Issues issues={issues} />
    </aside>
  );
}

function RemoveButton({ kind, id }: { kind: 'node' | 'edge'; id: string }) {
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

function NameField({ id, name }: { id: string; name: string }) {
  const m = useMessages();
  const renameNode = useDesign((state) => state.renameNode);
  return (
    <TextField
      label={m.inspector.name}
      value={name}
      onChange={(value) => {
        renameNode(id, value);
      }}
    />
  );
}

function ClientSettings({ node }: { node: ClientFlowNode }) {
  const m = useMessages();
  const patchNode = useDesign((state) => state.patchNode);
  return (
    <div className="flex flex-col gap-3">
      <NameField id={node.id} name={node.data.name} />
      <NumberField
        label={m.inspector.client.rps}
        hint={m.inspector.client.rpsHint}
        value={node.data.params.rps}
        min={0}
        max={200_000}
        step={10}
        onChange={(rps) => {
          patchNode(node.id, { rps });
        }}
      />
      <RemoveButton kind="node" id={node.id} />
    </div>
  );
}

function ServiceSettings({ node }: { node: ServiceFlowNode }) {
  const m = useMessages();
  const patchNode = useDesign((state) => state.patchNode);
  const { params } = node.data;
  const labels = m.inspector.service;
  const setWork = (patch: Partial<Dist>) => {
    patchNode(node.id, { serviceTime: { ...params.serviceTime, ...patch } });
  };
  // What the service could do if it never had to wait for anything else.
  const room = (params.concurrency / params.serviceTime.mean) * 1000;

  return (
    <div className="flex flex-col gap-3">
      <NameField id={node.id} name={node.data.name} />
      <NumberField
        label={labels.concurrency}
        value={params.concurrency}
        min={1}
        max={100_000}
        integer
        onChange={(concurrency) => {
          patchNode(node.id, { concurrency });
        }}
      />
      <NumberField
        label={labels.work}
        value={params.serviceTime.mean}
        min={0.01}
        max={600_000}
        step={1}
        unit={m.units.ms}
        onChange={(mean) => {
          setWork({ mean });
        }}
      />
      <p className="rounded-[3px] bg-sea-wash px-2 py-1.5 text-[0.9rem]">{labels.room(formatCount(room))}</p>
      <SelectField
        label={labels.variation}
        value={params.serviceTime.kind}
        options={(['const', 'exp', 'lognormal'] as const).map((value) => ({ value, label: labels.variationOption[value] }))}
        onChange={(kind) => {
          setWork({ kind });
        }}
      />
      {params.serviceTime.kind === 'lognormal' && (
        <NumberField
          label={labels.cv}
          value={params.serviceTime.cv ?? 1}
          min={0}
          max={10}
          step={0.1}
          onChange={(cv) => {
            setWork({ cv });
          }}
        />
      )}
      <NumberField
        label={labels.queue}
        hint={labels.queueHint}
        value={params.queue}
        min={0}
        max={1_000_000}
        integer
        onChange={(queue) => {
          patchNode(node.id, { queue });
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
  const labels = m.inspector.edge;
  if (!params) return null;

  return (
    <div className="flex flex-col gap-3">
      <p className="font-bold">{labels.title(from ?? edge.source, to ?? edge.target)}</p>
      <NumberField
        label={labels.timeout}
        hint={labels.timeoutHint}
        value={params.timeoutMs}
        min={0}
        max={600_000}
        step={100}
        unit={m.units.ms}
        onChange={(timeoutMs) => {
          patchEdge(edge.id, { timeoutMs });
        }}
      />
      <NumberField
        label={labels.retries}
        value={params.retries}
        min={0}
        max={10}
        integer
        onChange={(retries) => {
          patchEdge(edge.id, { retries });
        }}
      />
      {params.retries > 0 && (
        <>
          <NumberField
            label={labels.backoff}
            value={params.backoffMs}
            min={0}
            max={60_000}
            step={10}
            unit={m.units.ms}
            onChange={(backoffMs) => {
              patchEdge(edge.id, { backoffMs });
            }}
          />
          <NumberField
            label={labels.backoffFactor}
            value={params.backoffFactor}
            min={1}
            max={10}
            step={0.5}
            unit="×"
            onChange={(backoffFactor) => {
              patchEdge(edge.id, { backoffFactor });
            }}
          />
          <NumberField
            label={labels.jitter}
            hint={labels.jitterHint}
            value={params.jitter}
            min={0}
            max={1}
            step={0.1}
            onChange={(jitter) => {
              patchEdge(edge.id, { jitter });
            }}
          />
        </>
      )}
      <NumberField
        label={labels.latency}
        value={params.latencyMs}
        min={0}
        max={60_000}
        step={1}
        unit={m.units.ms}
        onChange={(latencyMs) => {
          patchEdge(edge.id, { latencyMs });
        }}
      />
      <RemoveButton kind="edge" id={edge.id} />
    </div>
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
