/**
 * The platform administration API, as the client sees it.
 *
 * The client holds no model knowledge. It fetches the schema once and renders
 * every table, form and picker from that description, which is why adding a
 * model to the admin needs no change here at all.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { request } from "../api";
import type { ApiError } from "../errors";

export type Widget =
  | "text"
  | "textarea"
  | "email"
  | "number"
  | "boolean"
  | "date"
  | "time"
  | "datetime"
  | "json"
  | "choice"
  | "reference";

export interface FieldSchema {
  name: string;
  label: string;
  required: boolean;
  editable: boolean;
  help: string;
  widget: Widget;
  choices?: { value: string; label: string }[];
  references?: string | null;
  reference_label?: string;
  max_length?: number;
}

export interface ResourceSchema {
  resource: string;
  label: string;
  group: string;
  columns: string[];
  search: string[];
  readonly: boolean;
  fields: FieldSchema[];
}

export type Row = Record<string, unknown> & { id: string; display?: string };

export function usePlatformSchema() {
  return useQuery<{ resources: ResourceSchema[] }, ApiError>({
    queryKey: ["platform", "schema"],
    // The shape of the system changes only on deploy, so this is fetched once
    // and kept; refetching it per screen would add a round trip to every
    // navigation for data that cannot have changed.
    staleTime: Infinity,
    queryFn: () => request<{ resources: ResourceSchema[] }>("platform/schema/"),
  });
}

export function usePlatformOverview() {
  return useQuery<{ counts: Record<string, number> }, ApiError>({
    queryKey: ["platform", "overview"],
    queryFn: () => request<{ counts: Record<string, number> }>("platform/overview/"),
  });
}

export interface PagedRows {
  count?: number;
  next: string | null;
  previous: string | null;
  results: Row[];
}

export function usePlatformList(resource: string, search: string) {
  return useQuery<PagedRows, ApiError>({
    queryKey: ["platform", resource, search],
    queryFn: () =>
      request<PagedRows>(
        `platform/${resource}/${search ? `?q=${encodeURIComponent(search)}` : ""}`,
      ),
    enabled: Boolean(resource),
  });
}

export function usePlatformRow(resource: string, id: string | undefined) {
  return useQuery<Row, ApiError>({
    queryKey: ["platform", resource, "row", id],
    queryFn: () => request<Row>(`platform/${resource}/${id}/`),
    enabled: Boolean(resource && id),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>, resource: string) {
  qc.invalidateQueries({ queryKey: ["platform", resource] });
  qc.invalidateQueries({ queryKey: ["platform", "overview"] });
}

export function useCreateRow(resource: string) {
  const qc = useQueryClient();
  return useMutation<Row, ApiError, Record<string, unknown>>({
    mutationFn: (body) =>
      request<Row>(`platform/${resource}/`, { method: "POST", body }),
    onSuccess: () => invalidate(qc, resource),
  });
}

/**
 * Issue a fresh sign-in code for a person, returned once.
 *
 * The old code is a one-way hash and cannot be shown again, so "see the code"
 * is really "mint a new one and read it here." The response carries the new
 * code exactly once.
 */
export function useResetCode(resource: string) {
  const qc = useQueryClient();
  return useMutation<{ username: string; access_code: string }, ApiError, string>({
    mutationFn: (id) =>
      request(`platform/${resource}/${id}/reset-code/`, { method: "POST" }),
    onSuccess: () => invalidate(qc, resource),
  });
}

export function useUpdateRow(resource: string) {
  const qc = useQueryClient();
  return useMutation<Row, ApiError, { id: string; body: Record<string, unknown> }>({
    mutationFn: ({ id, body }) =>
      request<Row>(`platform/${resource}/${id}/`, { method: "PATCH", body }),
    onSuccess: () => invalidate(qc, resource),
  });
}

/** Deleting reports what else went with it, so the UI can say so afterwards. */
export function useDeleteRow(resource: string) {
  const qc = useQueryClient();
  return useMutation<{ deleted: Record<string, number> }, ApiError, string>({
    mutationFn: (id) =>
      request<{ deleted: Record<string, number> }>(`platform/${resource}/${id}/`, {
        method: "DELETE",
      }),
    onSuccess: () => invalidate(qc, resource),
  });
}
