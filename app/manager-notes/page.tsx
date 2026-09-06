import { redirect } from "next/navigation";
import { buildExecutiveFloorPadHref } from "@/lib/specialty-tools";

/** Executive Floor Pad opens from the Floor tactical dock via durable query intent. */
export default function ManagerNotesRedirectPage() {
  redirect(buildExecutiveFloorPadHref());
}
