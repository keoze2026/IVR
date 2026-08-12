/**
 * Wallet and tariffs — the money side of the dialer.
 *
 * The wallet is deliberately read-only here: a balance you can type into is an
 * invoice you can forge. It moves through top-ups and reconciled call costs,
 * both of which are recorded in the ledger shown beneath it. Tariffs are
 * editable because pricing is a decision an operator makes, not a fact the
 * system discovers.
 */

import { useState } from "react";

import { Button, EmptyState, Panel, TableSkeleton } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import {
  useCreateTariff,
  useDeleteTariff,
  useTariffs,
  useWallet,
} from "@/lib/queries/resources";

const input =
  "w-full rounded border border-steel bg-ink px-3 py-2 text-sm text-chalk placeholder:text-ash/50 focus:border-live-bright focus:outline-none";

export function WalletPage() {
  const { data, isLoading } = useWallet();
  const wallet = data?.results?.[0];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-xl font-semibold text-chalk sm:text-2xl">Wallet</h1>
        <p className="mt-1 text-sm text-ash">
          Your calling credit. Calls draw against it as they complete.
        </p>
      </header>

      {isLoading && <TableSkeleton rows={2} />}
      {wallet && (
        <>
          <Panel className="p-6">
            <p className="text-xs uppercase tracking-wider text-ash">Balance</p>
            <p className="mt-1 text-4xl tabular-nums text-live-bright">
              {wallet.currency} {Number(wallet.balance).toFixed(2)}
            </p>
            {Number(wallet.low_balance_threshold) > 0 &&
              Number(wallet.balance) <= Number(wallet.low_balance_threshold) && (
                <p className="mt-2 text-sm text-amber">
                  Balance is low. Top up to keep dialing.
                </p>
              )}
          </Panel>

          <Panel>
            <h2 className="display mb-3 text-base font-semibold text-chalk">Recent activity</h2>
            {wallet.recent.length === 0 ? (
              <EmptyState title="Nothing yet" description="Top-ups and call charges appear here." />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-steel text-left text-xs uppercase tracking-wider text-ash">
                    <th className="py-2 pr-4">When</th>
                    <th className="py-2 pr-4">Type</th>
                    <th className="py-2 pr-4">Detail</th>
                    <th className="py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {wallet.recent.map((e) => (
                    <tr key={e.id} className="border-b border-steel/50">
                      <td className="py-2 pr-4 text-ash">{formatDateTime(e.created_at)}</td>
                      <td className="py-2 pr-4 capitalize text-ash">{e.kind}</td>
                      <td className="py-2 pr-4 text-ash">{e.description || "—"}</td>
                      <td
                        className={`py-2 text-right tabular-nums ${
                          Number(e.amount) < 0 ? "text-rust" : "text-live-bright"
                        }`}
                      >
                        {Number(e.amount).toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

export function TariffsPage() {
  const { data, isLoading } = useTariffs();
  const create = useCreateTariff();
  const remove = useDeleteTariff();
  const [f, setF] = useState({ name: "", prefix: "", per_minute: "", currency: "USD" });
  const tariffs = data?.results ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-xl font-semibold text-chalk sm:text-2xl">Tariffs</h1>
        <p className="mt-1 max-w-2xl text-sm text-ash">
          What a minute costs, by where the call goes. The most specific matching
          prefix wins — +2547 beats +254 beats +2.
        </p>
      </header>

      <Panel>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            await create.mutateAsync(f);
            setF({ name: "", prefix: "", per_minute: "", currency: "USD" });
          }}
        >
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-ash">Name</span>
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Kenya mobile" className={`${input} w-40`} required />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-ash">Prefix</span>
            <input value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value })} placeholder="+2547" className={`${input} w-28 font-mono`} required />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-ash">Per minute</span>
            <input value={f.per_minute} onChange={(e) => setF({ ...f, per_minute: e.target.value })} placeholder="0.12" className={`${input} w-24`} required />
          </label>
          <Button type="submit" disabled={create.isPending}>Add tariff</Button>
          {create.error && <span className="text-sm text-rust">{create.error.message}</span>}
        </form>
      </Panel>

      <Panel>
        {isLoading && <TableSkeleton rows={3} />}
        {!isLoading && tariffs.length === 0 && (
          <EmptyState title="No tariffs yet" description="Add one above so calls can be priced." />
        )}
        {tariffs.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-steel text-left text-xs uppercase tracking-wider text-ash">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Prefix</th>
                <th className="py-2 pr-4">Per minute</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {tariffs.map((t) => (
                <tr key={t.id} className="border-b border-steel/50">
                  <td className="py-2 pr-4 text-chalk">{t.name}</td>
                  <td className="py-2 pr-4 font-mono text-ash">{t.prefix}</td>
                  <td className="py-2 pr-4 tabular-nums text-ash">
                    {t.currency} {Number(t.per_minute).toFixed(4)}
                  </td>
                  <td className="py-2 text-right">
                    <button onClick={() => remove.mutate(t.id)} className="text-rust hover:underline">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
