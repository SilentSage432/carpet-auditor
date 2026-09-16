import { redirect } from "next/navigation";

/**
 * REDUCE-004 — Appliances specialty home disconnected from everyday product.
 * Runtime remains dormant under /?section=appliances until later retirement.
 */
export default function AppliancesDashboardPage() {
  redirect("/dashboard");
}
