/**
 * Wallets and Tariffs — matched to the reference dialer.
 *
 * Wallets: four summary tiles (Total Wallets / Total Balance / Credits /
 * Debits) and a table of one row per organisation. Read-only, because a
 * balance you can type into is an invoice you can forge. Tariffs: a table of
 * Destination / Prefix / Rate / User, with an add form.
 */

import { useState } from "react";

import { Button, EmptyState, Panel, TableSkeleton } from "@/components/ui";
import {
  useCreateTariff,
  useDeleteTariff,
  useTariffs,
  useWallet,
} from "@/lib/queries/resources";

const input =
  "w-full rounded border border-edge bg-void px-3 py-2 text-sm text-chalk placeholder:text-ash/50 focus:border-live-bright focus:outline-none";

function StatTile({ label, value, sub, tone = "text-chalk" }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <Panel className="p-5">
      <p className="text-sm text-ash">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-ash">{sub}</p>}
    </Panel>
  );
}

export function WalletPage() {
  const { data, isLoading } = useWallet();
  const wallet = data?.results?.[0];
  const balance = Number(wallet?.balance ?? 0);
  const credits = (wallet?.recent ?? []).filter((e) => Number(e.amount) > 0);
  const debits = (wallet?.recent ?? []).filter((e) => Number(e.amount) < 0);
  const creditSum = credits.reduce((s, e) => s + Number(e.amount), 0);
  const debitSum = debits.reduce((s, e) => s + Math.abs(Number(e.amount)), 0);

  return (
    <div className="space-y-5">
      <p className="text-xs text-ash">
        Home <span className="mx-1">›</span>
        <span className="text-chalk">Wallets</span>
      </p>
      <h1 className="display text-2xl font-semibold text-chalk">Wallets</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Total Wallets" value={wallet ? "1" : "0"} sub={`$${balance.toFixed(2)} total balance`} />
        <StatTile label="Total Balance" value={`$${balance.toFixed(2)}`} sub={`${wallet?.recent.length ?? 0} transactions`} tone="text-blue-300" />
        <StatTile label="Credits" value={`$${creditSum.toFixed(2)}`} sub={`${credits.length} transactions`} tone="text-live-bright" />
        <StatTile label="Debits" value={`$${debitSum.toFixed(2)}`} sub={`${debits.length} transactions`} tone="text-rust" />
      </div>

      <Panel className="p-0">
        {isLoading && <div className="p-4"><TableSkeleton rows={2} /></div>}
        {!isLoading && !wallet && (
          <div className="p-8"><EmptyState title="No wallet yet" description="A wallet is created for your organisation automatically." /></div>
        )}
        {wallet && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-ash">
                  <th className="py-3 pl-4 pr-4">User</th>
                  <th className="py-3 pr-4">Balance</th>
                  <th className="py-3 pr-4">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-edge/50">
                  <td className="py-3 pl-4 pr-4 text-chalk">This organisation</td>
                  <td className="py-3 pr-4 tabular-nums text-chalk">${balance.toFixed(2)}</td>
                  <td className="py-3 pr-4">
                    <span className="rounded border border-live-bright/40 px-2 py-0.5 text-xs text-live-bright">Active</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-edge px-4 py-3 text-xs text-ash">
          {wallet ? "1" : "0"} row(s) total.
        </div>
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
    <div className="space-y-5">
      <p className="text-xs text-ash">
        Home <span className="mx-1">›</span>
        <span className="text-chalk">Tariffs</span>
      </p>
      <h1 className="display text-2xl font-semibold text-chalk">Tariffs</h1>

      <Panel>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            await create.mutateAsync({ name: f.name, prefix: f.prefix, per_minute: f.per_minute, currency: "USD" });
            setF({ name: "", prefix: "", per_minute: "" });
          }}
        >
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-ash">Destination</span>
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="USA" className={`${input} w-40`} required />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-ash">Prefix</span>
            <input value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value })} placeholder="+1" className={`${input} w-28 font-mono`} required />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-ash">Rate ($)</span>
            <input value={f.per_minute} onChange={(e) => setF({ ...f, per_minute: e.target.value })} placeholder="0.010000" className={`${input} w-28`} required />
          </label>
          <Button type="submit" disabled={create.isPending}>Add tariff</Button>
          {create.error && <span className="text-sm text-rust">{create.error.message}</span>}
        </form>
      </Panel>

      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by destination..." className={`${input} max-w-sm`} />

      <Panel className="p-0">
        {isLoading && <div className="p-4"><TableSkeleton rows={3} /></div>}
        {!isLoading && tariffs.length === 0 && (
          <div className="p-8"><EmptyState title="No tariffs yet" description="Add one above so calls can be priced." /></div>
        )}
        {tariffs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-ash">
                  <th className="py-3 pl-4 pr-4">Destination</th>
                  <th className="py-3 pr-4">Prefix</th>
                  <th className="py-3 pr-4">Rate ($)</th>
                  <th className="py-3 pr-4" />
                </tr>
              </thead>
              <tbody>
                {tariffs.map((t) => (
                  <tr key={t.id} className="border-b border-edge/50">
                    <td className="py-3 pl-4 pr-4 text-chalk">{t.name}</td>
                    <td className="py-3 pr-4 font-mono text-ash">{t.prefix}</td>
                    <td className="py-3 pr-4 tabular-nums text-ash">${Number(t.per_minute).toFixed(6)}</td>
                    <td className="py-3 pr-4 text-right">
                      <button onClick={() => remove.mutate(t.id)} className="text-rust hover:underline">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-edge px-4 py-3 text-xs text-ash">{tariffs.length} row(s) total.</div>
      </Panel>
    </div>
  );
}
