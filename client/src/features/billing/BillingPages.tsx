/**
 * Billing and rates. The balance is read-only: one you could type into would
 * be an invoice you could forge.
 */

import { useState } from "react";

import { PlusIcon, TrashIcon } from "@/components/icons";
import { Button, EmptyState, Input, PageHeader, Panel, Stat, TableSkeleton } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import {
  useCreateTariff,
  useDeleteTariff,
  useTariffs,
  useWallet,
} from "@/lib/queries/resources";

export function WalletPage() {
  const { data, isLoading } = useWallet();
  const wallet = data?.results?.[0];
  const entries = wallet?.recent ?? [];
  const balance = Number(wallet?.balance ?? 0);
  const sum = (sign: 1 | -1) =>
    entries.reduce((s, e) => s + Math.max(0, sign * Number(e.amount)), 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" subtitle="Your balance in this portal and recent activity." />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Balance" value={`$${balance.toFixed(2)}`} />
        <Stat label="Recent credits" value={`$${sum(1).toFixed(2)}`} tone="live" />
        <Stat label="Recent charges" value={`$${sum(-1).toFixed(2)}`} />
      </div>

      <Panel className="overflow-hidden">
        {isLoading && <TableSkeleton rows={3} />}
        {!isLoading && entries.length === 0 && (
          <div className="p-6">
            <EmptyState title="No transactions yet" description="Credits and call charges appear here." />
          </div>
        )}
        {entries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDateTime(e.created_at)}</td>
                    <td className="capitalize">{e.kind.replace(/_/g, " ")}</td>
                    <td>{e.description || "—"}</td>
                    <td className={`num font-medium ${Number(e.amount) < 0 ? "text-chalk" : "text-live-bright"}`}>
                      {Number(e.amount) < 0 ? "−" : "+"}${Math.abs(Number(e.amount)).toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

export function TariffsPage() {
  const { data, isLoading } = useTariffs();
  const create = useCreateTariff();
  const remove = useDeleteTariff();
  const [f, setF] = useState({ name: "", prefix: "", per_minute: "" });
  const [filter, setFilter] = useState("");
  const all = data?.results ?? [];
  const tariffs = filter.trim()
    ? all.filter((t) => t.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : all;

  return (
    <div className="space-y-6">
      <PageHeader title="Rates" subtitle="Price per minute by destination, used to cost your calls." />

      <Panel className="p-5">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            await create.mutateAsync({ name: f.name, prefix: f.prefix, per_minute: f.per_minute, currency: "USD" });
            setF({ name: "", prefix: "", per_minute: "" });
          }}
        >
          <label className="eyebrow">
            Destination
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="USA" className="mt-1.5 w-44" required />
          </label>
          <label className="eyebrow">
            Prefix
            <Input value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value })} placeholder="+1" className="mt-1.5 w-28" required />
          </label>
          <label className="eyebrow">
            Rate per minute ($)
            <Input value={f.per_minute} onChange={(e) => setF({ ...f, per_minute: e.target.value })} placeholder="0.010000" className="mt-1.5 w-36" required />
          </label>
          <Button type="submit" variant="primary" loading={create.isPending}>
            <PlusIcon className="size-4" /> Add rate
          </Button>
          {create.error && <span className="text-sm text-rust">{create.error.message}</span>}
        </form>
      </Panel>

      <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search by destination" aria-label="Search by destination" className="max-w-sm" />

      <Panel className="overflow-hidden">
        {isLoading && <TableSkeleton rows={3} />}
        {!isLoading && tariffs.length === 0 && (
          <div className="p-6"><EmptyState title="No rates yet" description="Add one above so calls can be priced." /></div>
        )}
        {tariffs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Destination</th>
                  <th>Prefix</th>
                  <th>Rate per minute</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {tariffs.map((t) => (
                  <tr key={t.id}>
                    <td className="font-medium text-chalk">{t.name}</td>
                    <td className="num">{t.prefix}</td>
                    <td className="num">${Number(t.per_minute).toFixed(6)}</td>
                    <td className="text-right">
                      <Button dense variant="ghost" aria-label={`Delete ${t.name}`} onClick={() => confirm(`Delete the rate for ${t.name}?`) && remove.mutate(t.id)}>
                        <TrashIcon className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
