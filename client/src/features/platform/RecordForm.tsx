/**
 * One form, for any model.
 *
 * Every input is chosen from the widget hint the server sent, so this file
 * knows nothing about campaigns or contacts and never needs to. The design
 * rule throughout: an administrator should be able to fill this in without
 * being told what a foreign key is.
 */

import { useEffect, useState } from "react";

import { usePlatformList, type FieldSchema, type ResourceSchema, type Row } from "@/lib/queries/platform";

/** Fields a person should never be asked to fill in by hand. */
const MACHINE_FIELDS = new Set([
  "id", "created_at", "updated_at", "phone_hash", "key_hash", "prefix",
  "last_used_at", "last_login", "date_joined", "checksum",
]);

export function editableFields(schema: ResourceSchema): FieldSchema[] {
  return schema.fields.filter(
    (f) => f.editable && !MACHINE_FIELDS.has(f.name),
  );
}

/** A dropdown of existing rows, so a reference is picked rather than typed. */
function ReferencePicker({
  field,
  value,
  onChange,
}: {
  field: FieldSchema;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const { data, isLoading } = usePlatformList(field.references ?? "", "");
  const rows = data?.results ?? [];

  if (!field.references) {
    // A model the admin does not expose. Falling back to a raw id beats
    // rendering nothing and silently dropping the field.
    return (
      <input
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        placeholder="Identifier"
        className={inputClass}
      />
    );
  }

  return (
    <select
      value={(value as string) ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={inputClass}
      disabled={isLoading}
    >
      <option value="">{isLoading ? "Loading…" : "— none —"}</option>
      {rows.map((row) => (
        <option key={row.id} value={row.id}>
          {row.display ?? row.id}
        </option>
      ))}
    </select>
  );
}

const inputClass =
  "w-full rounded border border-steel bg-ink px-3 py-2 text-sm text-chalk placeholder:text-ash/50 focus:border-live-bright focus:outline-none";

function Field({
  field,
  value,
  onChange,
  error,
}: {
  field: FieldSchema;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
}) {
  const common = { className: inputClass };

  let control: React.ReactNode;
  switch (field.widget) {
    case "boolean":
      return (
        <label className="flex items-start gap-3 py-1">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="mt-1 h-4 w-4 accent-live-bright"
          />
          <span>
            <span className="text-sm text-chalk">{field.label}</span>
            {field.help && (
              <span className="block text-xs text-ash">{field.help}</span>
            )}
          </span>
        </label>
      );
    case "choice":
      control = (
        <select
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          {...common}
        >
          <option value="">— none —</option>
          {field.choices?.map((c) => (
            <option key={String(c.value)} value={String(c.value)}>
              {c.label}
            </option>
          ))}
        </select>
      );
      break;
    case "reference":
      control = <ReferencePicker field={field} value={value} onChange={onChange} />;
      break;
    case "textarea":
      control = (
        <textarea
          rows={3}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          {...common}
        />
      );
      break;
    case "json":
      control = (
        <textarea
          rows={5}
          value={
            typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2)
          }
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} font-mono text-xs`}
        />
      );
      break;
    case "number":
      control = (
        <input
          type="number"
          step="any"
          value={(value as number | string) ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          {...common}
        />
      );
      break;
    case "datetime":
      control = (
        <input
          type="datetime-local"
          value={toLocalInput(value)}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
          {...common}
        />
      );
      break;
    case "date":
    case "time":
      control = (
        <input
          type={field.widget}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          {...common}
        />
      );
      break;
    default:
      control = (
        <input
          type={field.widget === "email" ? "email" : "text"}
          value={(value as string) ?? ""}
          maxLength={field.max_length}
          onChange={(e) => onChange(e.target.value)}
          {...common}
        />
      );
  }

  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wider text-ash">
        {field.label}
        {field.required && <span className="ml-1 text-rust">*</span>}
      </span>
      {control}
      {field.help && <span className="mt-1 block text-xs text-ash">{field.help}</span>}
      {error && <span className="mt-1 block text-xs text-rust">{error}</span>}
    </label>
  );
}

function toLocalInput(value: unknown): string {
  if (!value || typeof value !== "string") return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function RecordForm({
  schema,
  initial,
  onSubmit,
  onCancel,
  submitting,
  fieldErrors,
  submitLabel,
}: {
  schema: ResourceSchema;
  initial?: Row;
  onSubmit: (values: Record<string, unknown>) => void;
  onCancel: () => void;
  submitting: boolean;
  fieldErrors?: Record<string, string[]>;
  submitLabel: string;
}) {
  const fields = editableFields(schema);
  const [values, setValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    const seed: Record<string, unknown> = {};
    for (const f of fields) seed[f.name] = initial?.[f.name] ?? null;
    setValues(seed);
    // Re-seed only when the record itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, schema.resource]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
      className="space-y-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <Field
            key={field.name}
            field={field}
            value={values[field.name]}
            onChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
            error={fieldErrors?.[field.name]?.[0]}
          />
        ))}
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-live-bright px-4 py-2 text-sm font-semibold uppercase tracking-wider text-ink disabled:opacity-50"
        >
          {submitting ? "Saving…" : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-steel px-4 py-2 text-sm text-ash hover:text-chalk"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
