import { redirect } from "next/navigation";

/** Downstock lives on Floor; remnant inventory lives in Settings. */
export default function StockRedirectPage() {
  redirect("/dashboard");
}
