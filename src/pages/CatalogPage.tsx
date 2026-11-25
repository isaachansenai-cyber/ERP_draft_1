import { useQuery, useQueryClient } from '@tanstack/react-query';
import Decimal from 'decimal.js';
import { useState } from 'react';
import { Badge, Button, Empty, Field, inputClass, Loading, MutationStatus, Notice, QueryError } from '../components/ui';
import { formatDateTime } from '../lib/format';
import { callRpc } from '../lib/rpc';
import { useRpcMutation } from '../lib/useRpcMutation';

// Recipes (ADR 0037): the owner edits a dish's ingredients through a draft copy
// of its active recipe, then activates it. Managers read only. Past and
// already-accepted orders keep the recipe they were accepted with.

interface RecipeLine {
  line_no: number;
  item_id: string;
  name: string;
  unit: string;
  quantity_per_serving: string;
  basis: string;
  source: string;
}
interface Dish {
  dish_id: string;
  name: string;
  category: string | null;
  recipes_verified: boolean;
  active: {
    recipe_version_id: string;
    version_no: number;
    basis: string;
    provenance: string;
    activated_at: string | null;
    activated_by: string | null;
    change_note: string | null;
    lines: RecipeLine[];
  } | null;
  draft: { recipe_version_id: string; version_no: number; draft_revision: number; lines: RecipeLine[] } | null;
  history: Array<{
    version_no: number;
    status: string;
    activated_at: string | null;
    superseded_at: string | null;
    change_note: string | null;
    activated_by: string | null;
  }>;
}
interface Ingredient {
  item_id: string;
  name: string;
  base_unit: string;
  category: string | null;
}
interface Recipes {
  can_edit: boolean;
  dishes: Dish[];
  ingredients: Ingredient[];
}
interface DraftResult {
  recipe_version_id: string;
  draft_revision: number;
  lines: RecipeLine[];
}

/** Trim trailing zeros from a server decimal string without float arithmetic. */
function qty(value: string): string {
  return new Decimal(value).toString();
}

function isOwnerEntered(basis: string): boolean {
  return basis === 'owner_entered';
}

function LinesTable({ lines, caption }: { lines: RecipeLine[]; caption: string }) {
  if (lines.length === 0) return <Empty>No ingredients.</Empty>;
  return (
    <table className="w-full border-collapse bg-white text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-slate-400 text-left">
          <th scope="col" className="p-2">
            Ingredient
          </th>
          <th scope="col" className="p-2">
            Per serving
          </th>
          <th scope="col" className="p-2">
            Source
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.item_id} className="border-b border-slate-200">
            <td className="p-2">
              <span className="font-mono">{l.item_id}</span> {l.name}
            </td>
            <td className="p-2">
              {qty(l.quantity_per_serving)} {l.unit}
            </td>
            <td className="p-2">
              {isOwnerEntered(l.basis) ? (
                <Badge tone="neutral">Owner-entered</Badge>
              ) : (
                <Badge tone="warn">Source estimate</Badge>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface EditRow {
  item_id: string;
  quantity: string;
}

const QTY_PATTERN = /^\d+(\.\d{1,6})?$/;

function DraftEditor({
  dish,
  draft,
  ingredients,
  onChanged,
}: {
  dish: Dish;
  draft: NonNullable<Dish['draft']>;
  ingredients: Ingredient[];
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<EditRow[]>(() =>
    draft.lines.map((l) => ({ item_id: l.item_id, quantity: qty(l.quantity_per_serving) })),
  );
  const [note, setNote] = useState('');
  const byId = new Map(ingredients.map((i) => [i.item_id, i]));
  const savedRows = draft.lines.map((l) => `${l.item_id}=${qty(l.quantity_per_serving)}`).join('|');
  const currentRows = rows.map((r) => `${r.item_id}=${r.quantity.trim()}`).join('|');
  const dirty = savedRows !== currentRows;

  const save = useRpcMutation<DraftResult>(
    'save_recipe_draft',
    `recipe-save:${draft.recipe_version_id}:${draft.draft_revision}`,
    {
      onSuccess: onChanged,
    },
  );
  const activate = useRpcMutation(
    'activate_recipe_version',
    `recipe-activate:${draft.recipe_version_id}:${draft.draft_revision}`,
    {
      onSuccess: onChanged,
    },
  );
  const discard = useRpcMutation(
    'discard_recipe_draft',
    `recipe-discard:${draft.recipe_version_id}:${draft.draft_revision}`,
    {
      onSuccess: onChanged,
    },
  );

  const ids = rows.map((r) => r.item_id).filter(Boolean);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  const rowErrors = rows.map((r) => {
    if (!r.item_id) return 'Choose an ingredient.';
    if (!QTY_PATTERN.test(r.quantity.trim()) || new Decimal(r.quantity.trim()).lte(0))
      return 'Enter a quantity greater than 0 (up to 6 decimals).';
    if (duplicates.includes(r.item_id)) return 'This ingredient is listed twice.';
    return null;
  });
  const valid = rows.length > 0 && rowErrors.every((e) => e === null);
  const stale = [save, activate, discard].some(
    (m) => 'kind' in m.state && m.state.kind === 'rejected' && m.state.error.code === 'conflict:stale_version',
  );
  const busy = save.busy || activate.busy || discard.busy;
  const set = (idx: number, patch: Partial<EditRow>) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  return (
    <form
      className="flex flex-col gap-3 rounded-md border-2 border-sky-700 bg-sky-50 p-3"
      aria-label={`Draft version ${draft.version_no} of ${dish.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        void save.submit({
          p_recipe_version_id: draft.recipe_version_id,
          p_expected_revision: draft.draft_revision,
          p_lines: rows.map((r) => ({ item_id: r.item_id, quantity_per_serving: r.quantity.trim() })),
        });
      }}
    >
      <h3 className="font-semibold">
        Draft version {draft.version_no} <Badge tone="warn">Not in use until activated</Badge>
      </h3>
      <ul className="flex flex-col gap-2">
        {rows.map((r, idx) => (
          <li key={idx} className="flex flex-wrap items-end gap-2 border-b border-sky-200 pb-2">
            <Field label={`Ingredient ${idx + 1}`} htmlFor={`recipe-${dish.dish_id}-item-${idx}`}>
              <select
                id={`recipe-${dish.dish_id}-item-${idx}`}
                className={inputClass}
                value={r.item_id}
                onChange={(e) => set(idx, { item_id: e.target.value })}
              >
                <option value="">Choose…</option>
                {ingredients.map((i) => (
                  <option key={i.item_id} value={i.item_id}>
                    {i.item_id} {i.name} ({i.base_unit})
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={`Per serving${r.item_id ? ` (${byId.get(r.item_id)?.base_unit ?? ''})` : ''}`}
              htmlFor={`recipe-${dish.dish_id}-qty-${idx}`}
            >
              <input
                id={`recipe-${dish.dish_id}-qty-${idx}`}
                inputMode="decimal"
                className={`${inputClass} w-32`}
                value={r.quantity}
                onChange={(e) => set(idx, { quantity: e.target.value })}
              />
            </Field>
            <Button
              variant="secondary"
              aria-label={`Remove ingredient ${idx + 1}`}
              onClick={() => setRows((rs) => rs.filter((_, i) => i !== idx))}
            >
              Remove
            </Button>
            {rowErrors[idx] && (r.item_id || r.quantity) ? (
              <p className="w-full text-sm text-red-800">{rowErrors[idx]}</p>
            ) : null}
          </li>
        ))}
      </ul>
      <div>
        <Button variant="secondary" onClick={() => setRows((rs) => [...rs, { item_id: '', quantity: '' }])}>
          Add ingredient
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!save.canPost || busy || !valid || !dirty}>
          Save draft
        </Button>
      </div>
      <MutationStatus
        state={save.state}
        successText="Draft saved. It is not used by any order until you activate it."
        onRetry={() => void save.retry()}
        onCheckAgain={() => void save.checkAgain()}
      />
      {stale ? (
        <Notice tone="warning" title="Changed elsewhere">
          <p>
            This draft was changed in another window. Reload it to see the latest version, then make your change again.
          </p>
          <Button className="mt-2" variant="secondary" onClick={onChanged}>
            Reload draft
          </Button>
        </Notice>
      ) : null}

      <fieldset className="flex flex-col gap-2 rounded-md border border-slate-400 bg-white p-3">
        <legend className="px-1 font-semibold">Activate</legend>
        <p className="text-sm">
          New orders will use version {draft.version_no}. Orders already accepted keep the recipe they were accepted
          with.
        </p>
        <Field label="What changed (required)" htmlFor={`recipe-${dish.dish_id}-note`}>
          <input
            id={`recipe-${dish.dish_id}-note`}
            className={inputClass}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {dirty ? <p className="text-sm text-amber-900">Save the draft before activating it.</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!activate.canPost || busy || dirty || note.trim().length < 3 || draft.lines.length === 0}
            onClick={() =>
              void activate.submit({
                p_recipe_version_id: draft.recipe_version_id,
                p_expected_revision: draft.draft_revision,
                p_change_note: note.trim(),
              })
            }
          >
            Activate version {draft.version_no}
          </Button>
          <Button
            variant="danger"
            disabled={!discard.canPost || busy}
            onClick={() =>
              void discard.submit({
                p_recipe_version_id: draft.recipe_version_id,
                p_expected_revision: draft.draft_revision,
              })
            }
          >
            Discard draft
          </Button>
        </div>
        <MutationStatus
          state={activate.state}
          successText="Recipe activated for new orders."
          onRetry={() => void activate.retry()}
          onCheckAgain={() => void activate.checkAgain()}
        />
        <MutationStatus
          state={discard.state}
          successText="Draft discarded."
          onRetry={() => void discard.retry()}
          onCheckAgain={() => void discard.checkAgain()}
        />
      </fieldset>
    </form>
  );
}

function DishCard({
  dish,
  canEdit,
  ingredients,
  onChanged,
}: {
  dish: Dish;
  canEdit: boolean;
  ingredients: Ingredient[];
  onChanged: () => void;
}) {
  const start = useRpcMutation<DraftResult>('start_recipe_draft', `recipe-start:${dish.dish_id}`, {
    onSuccess: onChanged,
  });
  return (
    <section
      aria-labelledby={`dish-${dish.dish_id}`}
      className="flex flex-col gap-3 rounded-lg border border-slate-300 bg-white p-4"
      data-testid={`recipe-${dish.dish_id}`}
    >
      <h2 id={`dish-${dish.dish_id}`} className="flex flex-wrap items-center gap-2 text-lg font-semibold">
        <span className="font-mono text-base">{dish.dish_id}</span> {dish.name}
        {dish.active ? (
          <Badge tone="good">Version {dish.active.version_no} in use</Badge>
        ) : (
          <Badge tone="bad">No active recipe</Badge>
        )}
        {dish.recipes_verified ? (
          <Badge tone="good">Recipe gate confirmed</Badge>
        ) : (
          <Badge tone="warn">Recipe gate open</Badge>
        )}
      </h2>
      {dish.active ? (
        <>
          <p className="text-xs text-slate-700">
            {dish.active.activated_by ? `Activated by ${dish.active.activated_by}` : 'Imported from the source data'}
            {dish.active.activated_at ? ` · ${formatDateTime(dish.active.activated_at)}` : ''}
            {dish.active.change_note ? ` · “${dish.active.change_note}”` : ''}
          </p>
          <LinesTable lines={dish.active.lines} caption={`Active recipe for ${dish.name}`} />
        </>
      ) : null}

      {canEdit ? (
        dish.draft ? (
          <DraftEditor
            key={`${dish.draft.recipe_version_id}:${dish.draft.draft_revision}`}
            dish={dish}
            draft={dish.draft}
            ingredients={ingredients}
            onChanged={onChanged}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <div>
              <Button disabled={!start.canPost} onClick={() => void start.submit({ p_dish_id: dish.dish_id })}>
                Edit recipe
              </Button>
            </div>
            <MutationStatus
              state={start.state}
              successText="Draft started."
              onRetry={() => void start.retry()}
              onCheckAgain={() => void start.checkAgain()}
            />
          </div>
        )
      ) : null}

      {dish.history.length > 1 ? (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Version history</summary>
          <ul className="text-sm">
            {dish.history.map((h) => (
              <li key={h.version_no}>
                Version {h.version_no} · {h.status}
                {h.activated_at ? ` · activated ${formatDateTime(h.activated_at)}` : ''}
                {h.activated_by ? ` by ${h.activated_by}` : ''}
                {h.superseded_at ? ` · replaced ${formatDateTime(h.superseded_at)}` : ''}
                {h.change_note ? ` · “${h.change_note}”` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

export function CatalogPage() {
  const queryClient = useQueryClient();
  const recipes = useQuery({ queryKey: ['recipes'], queryFn: () => callRpc<Recipes>('get_recipes', {}) });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['recipes'] });
    // What can we serve, planning and the POS menu read the active recipe.
    void queryClient.invalidateQueries({ queryKey: ['serve'] });
  };
  return (
    <section aria-labelledby="catalog-heading" className="flex flex-col gap-4">
      <h1 id="catalog-heading" className="text-2xl font-bold">
        Recipes
      </h1>
      {recipes.isPending ? (
        <Loading />
      ) : recipes.error ? (
        <QueryError error={recipes.error} onRetry={() => void recipes.refetch()} />
      ) : recipes.data.dishes.length === 0 ? (
        <Empty>No dishes in the catalog.</Empty>
      ) : (
        <>
          {!recipes.data.can_edit ? <Notice tone="info">Only the owner can change recipes.</Notice> : null}
          {recipes.data.dishes.map((d) => (
            <DishCard
              key={d.dish_id}
              dish={d}
              canEdit={recipes.data.can_edit}
              ingredients={recipes.data.ingredients}
              onChanged={refresh}
            />
          ))}
        </>
      )}
    </section>
  );
}
