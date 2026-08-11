import { redirect } from "next/navigation";

/** Deprecated Catalog tab — send users to the Appliances dashboard. */
export default function CatalogRedirectPage() {
  redirect("/appliances");
}
