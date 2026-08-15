import { redirect } from "next/navigation";

/** Barriers are logged inline on the Floor checklist. */
export default function VerifyRotationRedirectPage() {
  redirect("/dashboard");
}
