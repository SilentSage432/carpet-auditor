import type { StoreSpecialist } from "@/lib/types";

export type WorkflowTabProps = {
  specialist: StoreSpecialist;
  storeNumber: string;
  logout: () => void;
  onStoreNumberChange?: (storeNumber: string) => void;
  onChangePin?: () => void;
};
