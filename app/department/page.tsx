import { redirect } from "next/navigation";

/** Department overview is the Floor checklist + Settings taxonomies. */
export default function DepartmentOverviewRedirectPage() {
  redirect("/dashboard");
}
