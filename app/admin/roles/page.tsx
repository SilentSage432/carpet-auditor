import { redirect } from "next/navigation";

/** Roster is the canonical department-access console — this route is a stable alias. */
export default function RolesAdminPage() {
  redirect("/roster");
}
