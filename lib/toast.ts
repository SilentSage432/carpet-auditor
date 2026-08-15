/**
 * Mutation feedback — presentation only.
 * Domain owners still persist; this module never owns data.
 */
import { toast } from "sonner";

export function toastSuccess(message: string) {
  toast.success(message);
}

export function toastError(message: string) {
  toast.error(message);
}

export function toastInfo(message: string) {
  toast.message(message);
}
