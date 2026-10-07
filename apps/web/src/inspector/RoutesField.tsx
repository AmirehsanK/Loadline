import type { Route } from '@loadline/engine';
import { useId } from 'react';
import { useDesign } from '../design/store.ts';
import { useMessages } from '../i18n/index.ts';
import { TrashIcon } from '../icons.tsx';
import { formatPercent } from '../metrics/format.ts';
import { NumberField, SelectField } from './fields.tsx';

const MOST = 8;
/** What a name may be made of, as the engine has it. Anything else typed becomes a dash. */
const tidy = (name: string) => name.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 24);

/** A name no route of the client has yet. */
function freshName(routes: Route[]): string {
  let n = routes.length + 1;
  while (routes.some((route) => route.name === `route-${n}`)) n++;
  return `route-${n}`;
}

interface RoutesFieldProps {
  nodeId: string;
  label: string;
  hint: string | undefined;
  locked: string | undefined;
  routes: Route[];
  /** The client's own mix, which a first route starts from. */
  mix: Pick<Route, 'fileRatio' | 'uploadRatio' | 'readRatio'>;
  onChange: (routes: Route[]) => void;
}

/** The routes of a client: each with a name, a share of the requests, and a mix of its own. */
export function RoutesField({ nodeId, label, hint, locked, routes, mix, onChange }: RoutesFieldProps) {
  const m = useMessages();
  const text = m.fields.routes;
  const renameRoute = useDesign((state) => state.renameRoute);
  const total = routes.reduce((sum, route) => sum + route.weight, 0);
  const patch = (index: number, change: Partial<Route>) => {
    onChange(routes.map((route, at) => (at === index ? { ...route, ...change } : route)));
  };

  return (
    <fieldset className="flex flex-col gap-2 rounded-[3px] border border-line p-2">
      <legend className="field-label px-1">{label}</legend>
      {hint !== undefined && <p className="text-[0.85rem] text-ink-3">{hint}</p>}
      {routes.map((route, index) => (
        <RouteCard
          key={index}
          route={route}
          share={total > 0 ? route.weight / total : 0}
          locked={locked}
          onRename={(name) => {
            renameRoute(nodeId, index, name);
          }}
          onPatch={(change) => {
            patch(index, change);
          }}
          onRemove={() => {
            onChange(routes.filter((_route, at) => at !== index));
          }}
        />
      ))}
      {locked === undefined && routes.length < MOST && (
        <button
          type="button"
          onClick={() => {
            onChange([...routes, { name: freshName(routes), weight: 1, ...(routes.length === 0 ? mix : { fileRatio: 0, uploadRatio: 0, readRatio: 0.9 }) }]);
          }}
          className="self-start rounded-[3px] border border-line px-2.5 py-1 hover:border-ink"
        >
          {text.add}
        </button>
      )}
    </fieldset>
  );
}

interface RouteCardProps {
  route: Route;
  share: number;
  locked: string | undefined;
  onRename: (name: string) => void;
  onPatch: (change: Partial<Route>) => void;
  onRemove: () => void;
}

function RouteCard({ route, share, locked, onRename, onPatch, onRemove }: RouteCardProps) {
  const m = useMessages();
  const text = m.fields.routes;
  const nameId = useId();
  const ratio = (path: 'fileRatio' | 'uploadRatio' | 'readRatio', caption: string, named: (name: string) => string) => (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.8rem] text-ink-2" aria-hidden="true">
        {caption}
      </span>
      <NumberField
        label={named(route.name)}
        hideLabel
        locked={locked}
        value={route[path]}
        min={0}
        max={1}
        step={0.05}
        onChange={(value) => {
          onPatch({ [path]: value });
        }}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-1.5 rounded-[3px] bg-deck p-2">
      <div className="flex items-center gap-1.5">
        <label htmlFor={nameId} className="sr-only">
          {text.name}
        </label>
        <input
          id={nameId}
          className="field-input min-w-0 flex-1 font-mono"
          value={route.name}
          maxLength={24}
          disabled={locked !== undefined}
          onChange={(event) => {
            const name = tidy(event.target.value);
            if (name !== '') onRename(name);
          }}
        />
        <span className="shrink-0 font-mono text-[0.85rem] text-ink-2">{formatPercent(share)}</span>
        {locked === undefined && (
          <button type="button" onClick={onRemove} aria-label={text.remove(route.name)} title={text.remove(route.name)} className="rounded-[3px] p-1.5 text-ink-2 hover:text-oxide">
            <TrashIcon />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.8rem] text-ink-2" aria-hidden="true">
            {text.weight}
          </span>
          <NumberField
            label={text.weightOf(route.name)}
            hideLabel
            locked={locked}
            value={route.weight}
            min={0}
            max={1000}
            step={1}
            onChange={(weight) => {
              onPatch({ weight });
            }}
          />
        </div>
        {ratio('readRatio', text.read, text.readOf)}
        {ratio('fileRatio', text.file, text.fileOf)}
        {ratio('uploadRatio', text.upload, text.uploadOf)}
      </div>
    </div>
  );
}

/** The routes every client of the design names, in order, each once. */
function useRouteNames(): string[] {
  // Joined, so that the selector gives back the same value while the names are the same.
  const joined = useDesign((state) =>
    [...new Set(state.nodes.flatMap((node) => (node.type === 'client' ? node.data.params.routes.map((route) => route.name) : [])))].join('\n'),
  );
  return joined === '' ? [] : joined.split('\n');
}

interface RouteChoiceProps {
  label: string;
  hint: string | undefined;
  locked: string | undefined;
  any: string;
  value: string;
  onChange: (route: string) => void;
}

/** Which route a connection is kept for. Not shown while the design has no routes to choose from. */
export function RouteChoice({ label, hint, locked, any, value, onChange }: RouteChoiceProps) {
  const names = useRouteNames();
  if (names.length === 0 && value === '') return null;
  // A route that has since been removed or renamed stays on the list, so that it can be seen and changed.
  const options = [{ value: '', label: any }, ...[...new Set([...names, ...(value === '' ? [] : [value])])].map((name) => ({ value: name, label: name }))];
  return <SelectField label={label} locked={locked} value={value} options={options} onChange={onChange} {...(hint === undefined ? {} : { hint })} />;
}
