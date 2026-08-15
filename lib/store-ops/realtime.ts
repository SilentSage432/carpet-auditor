/**
 * Supabase Realtime channel lifecycle — register postgres_changes BEFORE subscribe.
 * Domain modules (sunday-audit, manager-notes) compose this; they own filters.
 *
 * One shared channel per logicalName: extra subscribers add JS listeners only
 * (never a second .on after subscribe). Last unsubscriber removes the channel.
 * Rapid tab switches / keep-alive Floor+Stock Zebra share one socket.
 */

import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

export type PostgresChangeFilter = {
  table: string;
  filter?: string;
  schema?: string;
  event?: "*" | "INSERT" | "UPDATE" | "DELETE";
};

type SharedChannel = {
  channel: RealtimeChannel;
  listeners: Set<() => void>;
};

const registry = new Map<string, SharedChannel>();

/**
 * Subscribe to postgres_changes. Listeners are always bound before subscribe().
 * Returns an unsubscribe that drops this callback; the channel is removed when
 * the last listener leaves.
 */
export function subscribePostgresChanges(
  logicalName: string,
  spec: PostgresChangeFilter,
  onChange: () => void
): () => void {
  const supabase = getSupabase();
  if (!supabase || !logicalName) return () => undefined;

  let entry = registry.get(logicalName);
  if (!entry) {
    const channel = supabase.channel(logicalName);
    const listeners = new Set<() => void>();
    channel.on(
      "postgres_changes",
      {
        event: spec.event ?? "*",
        schema: spec.schema ?? "public",
        table: spec.table,
        ...(spec.filter ? { filter: spec.filter } : {}),
      },
      () => {
        for (const fn of listeners) fn();
      }
    );
    channel.subscribe();
    entry = { channel, listeners };
    registry.set(logicalName, entry);
  }

  entry.listeners.add(onChange);

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const current = registry.get(logicalName);
    if (!current) return;
    current.listeners.delete(onChange);
    if (current.listeners.size === 0) {
      registry.delete(logicalName);
      void supabase.removeChannel(current.channel);
    }
  };
}
