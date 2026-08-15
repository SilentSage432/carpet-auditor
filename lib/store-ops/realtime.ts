/**
 * Supabase Realtime channel lifecycle — register postgres_changes BEFORE subscribe.
 * Domain modules (sunday-audit, manager-notes) compose this; they own filters.
 *
 * Unique channel instance names prevent the SDK error:
 * "cannot add postgres_changes callbacks after subscribe()"
 * which fires when two mounts reuse the same topic (Strict Mode, Fast Refresh,
 * ZebraChecklist + Sunday assignment drawer).
 *
 * Do not remove other channels that share the logical name — concurrent
 * subscribers each need their own instance. Cleanup is per-instance on unmount.
 */

import { getSupabase } from "@/lib/supabase";

let channelSeq = 0;

export type PostgresChangeFilter = {
  table: string;
  filter?: string;
  schema?: string;
  event?: "*" | "INSERT" | "UPDATE" | "DELETE";
};

/**
 * Subscribe to postgres_changes. Listeners are always bound before subscribe().
 * Returns an unsubscribe that removes this channel instance.
 */
export function subscribePostgresChanges(
  logicalName: string,
  spec: PostgresChangeFilter,
  onChange: () => void
): () => void {
  const supabase = getSupabase();
  if (!supabase || !logicalName) return () => undefined;

  const instanceName = `${logicalName}:${++channelSeq}`;
  const channel = supabase.channel(instanceName);

  channel.on(
    "postgres_changes",
    {
      event: spec.event ?? "*",
      schema: spec.schema ?? "public",
      table: spec.table,
      ...(spec.filter ? { filter: spec.filter } : {}),
    },
    () => {
      onChange();
    }
  );

  channel.subscribe();

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    void supabase.removeChannel(channel);
  };
}
