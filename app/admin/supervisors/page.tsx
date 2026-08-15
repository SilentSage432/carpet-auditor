import { redirect } from "next/navigation";

/** Roster is the canonical team console — this route is a stable alias. */
export default function SupervisorsAdminPage() {
  redirect("/roster");
}
