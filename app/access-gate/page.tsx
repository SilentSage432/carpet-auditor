import { redirect } from "next/navigation";

export default function AccessGateRedirectPage() {
  redirect("/login");
}
