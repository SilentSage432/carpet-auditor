import { redirect } from "next/navigation";

/** Appliances dashboard entry — opens the hub Appliances section. */
export default function AppliancesDashboardPage() {
  redirect("/?section=appliances");
}
