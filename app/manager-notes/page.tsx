import { redirect } from "next/navigation";

/** Executive Floor Pad opens from the Floor tactical dock. */
export default function ManagerNotesRedirectPage() {
  redirect("/dashboard#floor-pad");
}
