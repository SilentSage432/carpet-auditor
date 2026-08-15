import { redirect } from "next/navigation";

/** Executive Floor Pad opens from Settings. */
export default function ManagerNotesRedirectPage() {
  redirect("/settings#manager-notes");
}
