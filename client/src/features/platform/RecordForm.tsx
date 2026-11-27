/**
 * One form, for any model.
 *
 * Every input is chosen from the widget hint the server sent, so this file
 * knows nothing about campaigns or contacts and never needs to. The design
 * rule throughout: an administrator should be able to fill this in without
 * being told what a foreign key is.
 */

import { useEffect, useState } from "react";

import { Button, Field, Input, Panel, Select, Textarea, cx } from "@/components/ui";
import { usePlatformOptions, type FieldSchema, type ResourceSchema, type Row } from "@/lib/queries/platform";

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
  id,
  field,
  value,
  onChange,
}: {
  id: string;
  field: FieldSchema;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const { data, isLoading } = usePlatformOptions(field.references ?? "");
  const rows = data?.results ?? [];
  const chosen = (value as string) ?? "";

  if (!field.references) {
    // A model the admin does not expose. Falling back to a raw id beats
    // rendering nothing and silently dropping the field.
    return (
      <Input
        id={id}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        placeholder="Identifier"
      />
    );
  }

  return (
    <>
      <Select
        id={id}
        value={chosen}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={isLoading}
      >
        <option value="">{isLoading ? "Loading…" : "— none —"}</option>
        {/* A saved choice stays visible even when it is not in the list. */}
        {chosen && !rows.some((row) => row.id === chosen) && (
          <option value={chosen}>{chosen}</option>
        )}
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {row.display ?? row.id}
          </option>
        ))}
      </Select>
      {data?.next && (
        <p className="mt-1 text-xs text-ash">
          Only the first {rows.length.toLocaleString()} are listed.
        </p>
      )}
    </>
  );
}

function Toggle({
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
  return (
    <div>
      <label className="flex min-h-11 items-start gap-3 rounded-xl border border-edge px-3 py-2.5 hover:bg-void">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-signal"
        />
        <span className="min-w-0">
          <span className="block text-sm text-chalk">{field.label}</span>
          {field.help && <span className="block text-xs text-ash">{field.help}</span>}
        </span>
      </label>
      {error && (
        <p role="alert" className="mt-1 text-xs text-rust">
          {error}
        </p>
      )}
    </div>
  );
}

function SchemaField({
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
  const id = `record-${field.name}`;
  const common = { id, invalid: Boolean(error) };
  const wide = field.widget === "textarea" || field.widget === "json";

  let control: React.ReactNode;
  switch (field.widget) {
    case "choice":
      control = (
        <Select
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
        </Select>
      );
      break;
    case "reference":
      control = <ReferencePicker id={id} field={field} value={value} onChange={onChange} />;
      break;
    case "textarea":
      control = (
        <Textarea
          rows={3}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          {...common}
        />
      );
      break;
    case "json":
      control = (
        <Textarea
          rows={5}
          value={
            typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2)
          }
          onChange={(e) => onChange(e.target.value)}
          className="font-mono !text-xs"
          spellCheck={false}
          {...common}
        />
      );
      break;
    case "number":
      control = (
        <Input
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
        <Input
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
        <Input
          type={field.widget}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          {...common}
        />
      );
      break;
    default:
      control = (
        <Input
          type={field.widget === "email" ? "email" : "text"}
          value={(value as string) ?? ""}
          maxLength={field.max_length}
          onChange={(e) => onChange(e.target.value)}
          {...common}
        />
      );
  }

  return (
    <div className={cx("min-w-0", wide && "sm:col-span-2")}>
      <Field
        label={field.required ? `${field.label} *` : field.label}
        htmlFor={id}
        hint={field.help || undefined}
        error={error}
      >
        {control}
      </Field>
    </div>
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
  const inputs = fields.filter((f) => f.widget !== "boolean");
  const toggles = fields.filter((f) => f.widget === "boolean");
  const [values, setValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    const seed: Record<string, unknown> = {};
    for (const f of fields) seed[f.name] = initial?.[f.name] ?? null;
    setValues(seed);
    // Re-seed only when the record itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, schema.resource]);

  const bind = (field: FieldSchema) => ({
    field,
    value: values[field.name],
    onChange: (v: unknown) => setValues((prev) => ({ ...prev, [field.name]: v })),
    error: fieldErrors?.[field.name]?.[0],
  });

  return (
    <Panel className="min-w-0">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(values);
        }}
      >
        {inputs.length > 0 && (
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5">
            {inputs.map((field) => (
              <SchemaField key={field.name} {...bind(field)} />
            ))}
          </div>
        )}

        {toggles.length > 0 && (
          <div className="min-w-0 border-t border-edge p-4 sm:p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {toggles.map((field) => (
                <Toggle key={field.name} {...bind(field)} />
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-edge px-4 py-4 sm:px-5">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={submitting}>
            {submitting ? "Saving…" : submitLabel}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
