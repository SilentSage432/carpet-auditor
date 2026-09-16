import { redirect } from "next/navigation";

/** Deprecated Catalog tab — REDUCE-004 redirects to Floor (not Appliances). */
export default function CatalogRedirectPage() {
  redirect("/dashboard");
}
