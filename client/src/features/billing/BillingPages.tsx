/**
 * Wallets and Tariffs. The wallet is read-only: a balance you can type into is
 * an invoice you can forge.
 */

import { useState } from "react";

import { WalletIcon } from "@/components/icons";
import { Badge, Button, EmptyState, Input, PageHeader, Panel, Stat, TableSkeleton } from "@/components/ui";
import {
  useCreateTariff,
  useDeleteTariff,
  useTariffs,
  useWallet,
} from "@/lib/queries/resources";

export function WalletPage() {
  const { data, isLoading } = useWallet();
  const wallet = data?.results?.[0];
  const balance = Number(wallet?.balance ?? 0);
  const credits = (wallet?.recent ?? []).filter((e) => Number(e.amount) > 0);
  const debits = (wallet?.recent ?? []).filter((e) => Number(e.amount) < 0);
  const creditSum = credits.reduce((s, e) => s + Number(e.amount), 0);
  const debitSum = debits.reduce((s, e) => s + Math.abs(Number(e.amount)), 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Wallets" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total Wallets" value={wallet ? "1" : "0"} denominator={`$${balance.toFixed(2)} total balance`} />
        <div className="surface-forest rounded-[var(--radius-card)] p-5 shadow-[var(--shadow-raised)]">
          <div className="flex items-center gap-3 text-sm font-bold text-white/75">
            <span className="flex size-12 items-center justify-center rounded-2xl neon">
              <WalletIcon className="size-[22px]" />
            </span>
            Total Balance
          </div>
          <div className="num display mt-3 text-4xl">${balance.toFixed(2)}</div>
          <div className="mt-1.5 text-xs font-medium text-white/65">{wallet?.recent.length ?? 0} transactions</div>
        </div>
        <Stat label="Credits" value={`$${creditSum.toFixed(2)}`} denominator={`${credits.length} transactions`} tone="live" />
        <Stat label="Debits" value={`$${debitSum.toFixed(2)}`} denominator={`${debits.length} transactions`} tone="rust" />
      </div>

      <Panel className="overflow-hidden">
        {isLoading && <TableSkeleton rows={2} />}
        {!isLoading && !wallet && (
          <div className="p-6">
            <EmptyState title="No wallet yet" description="A wallet is created for your organisation automatically." />
          </div>
        )}
        {wallet && (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Balance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="font-medium text-chalk">This organisation</td>
                  <td className="num">${balance.toFixed(2)}</td>
                  <td><Badge tone="good">Active</Badge></td>
                </tr>
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
      <PageHeader title="Tariffs" />

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
            Rate ($)
            <Input value={f.per_minute} onChange={(e) => setF({ ...f, per_minute: e.target.value })} placeholder="0.010000" className="mt-1.5 w-36" required />
          </label>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Add tariff
          </Button>
          {create.error && <span className="text-sm text-rust">{create.error.message}</span>}
        </form>
      </Panel>

      <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by destination..." aria-label="Filter by destination" className="max-w-sm" />

      <Panel className="overflow-hidden">
        {isLoading && <TableSkeleton rows={3} />}
        {!isLoading && tariffs.length === 0 && (
          <div className="p-6"><EmptyState title="No tariffs yet" description="Add one above so calls can be priced." /></div>
        )}
        {tariffs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Destination</th>
                  <th>Prefix</th>
                  <th>Rate ($)</th>
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
                      <Button dense variant="ghost" className="!text-rust" onClick={() => remove.mutate(t.id)}>
                        Delete
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
