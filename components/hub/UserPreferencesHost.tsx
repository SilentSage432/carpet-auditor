"use client";

import { useEffect, useState } from "react";
import { UserPreferencesDrawer } from "@/components/hub/UserPreferencesDrawer";
import { PREFERENCES_OPEN_EVENT } from "@/lib/ui/preferences-context";

/** Single drawer instance for header + Settings triggers. */
export function UserPreferencesHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener(PREFERENCES_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(PREFERENCES_OPEN_EVENT, onOpen);
  }, []);

  return (
    <UserPreferencesDrawer open={open} onClose={() => setOpen(false)} />
  );
}
