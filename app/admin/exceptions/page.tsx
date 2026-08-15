import { redirect } from "next/navigation";

/** Exception viewing lives on the Floor feed. */
export default function ExceptionsAdminRedirectPage() {
  redirect("/dashboard");
}
