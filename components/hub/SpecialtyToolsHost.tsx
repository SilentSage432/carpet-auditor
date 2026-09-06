"use client";

/**
 * Shell-level specialty tool host — listens outside keep-alive `inert` panels
 * so More → Floor Utilities can open existing scanner / remnant calculator.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { fetchApplianceCatalog } from "@/lib/appliance-catalog";
import { fetchApplianceScans } from "@/lib/appliance-scans";
import { fetchCatalog } from "@/lib/catalog";
import { fetchRemnants } from "@/lib/remnants";
import {
  APPLIANCE_SCANNER_OPEN_EVENT,
  REMNANT_CALCULATOR_OPEN_EVENT,
  type ApplianceScannerLocationContext,
} from "@/lib/specialty-tools";
import type {
  ApplianceCatalogItem,
  ApplianceScan,
  CatalogItem,
  Remnant,
  StoreSpecialist,
} from "@/lib/types";

const ApplianceScannerModal = dynamic(
  () =>
    import("@/components/appliances/ApplianceScannerModal").then(
      (mod) => mod.ApplianceScannerModal
    ),
  { ssr: false }
);

const RemnantCalculatorModal = dynamic(
  () =>
    import("@/components/flooring/RemnantCalculatorModal").then(
      (mod) => mod.RemnantCalculatorModal
    ),
  { ssr: false }
);

type Props = {
  specialist: StoreSpecialist;
  storeNumber: string;
};

export function SpecialtyToolsHost({ specialist, storeNumber }: Props) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [bayLocation, setBayLocation] =
    useState<ApplianceScannerLocationContext | null>(null);
  const [applianceCatalog, setApplianceCatalog] = useState<
    ApplianceCatalogItem[]
  >([]);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [remnants, setRemnants] = useState<Remnant[]>([]);

  const ensureApplianceCatalog = useCallback(async () => {
    try {
      const items = await fetchApplianceCatalog();
      setApplianceCatalog(items);
    } catch (err) {
      console.error("[SpecialtyToolsHost] appliance catalog failed", err);
    }
  }, []);

  const ensureRemnantData = useCallback(async () => {
    try {
      const [nextCatalog, nextRemnants] = await Promise.all([
        fetchCatalog(),
        fetchRemnants(),
      ]);
      setCatalog(nextCatalog);
      setRemnants(nextRemnants);
    } catch (err) {
      console.error("[SpecialtyToolsHost] remnant data failed", err);
    }
  }, []);

  useEffect(() => {
    function onScanner(event: Event) {
      const detail = (
        event as CustomEvent<ApplianceScannerLocationContext | null>
      ).detail;
      if (detail && typeof detail === "object" && detail.location_id) {
        setBayLocation(detail);
      } else {
        setBayLocation(null);
      }
      setScannerOpen(true);
      void ensureApplianceCatalog();
    }
    function onCalculator() {
      setCalculatorOpen(true);
      void ensureRemnantData();
    }
    window.addEventListener(APPLIANCE_SCANNER_OPEN_EVENT, onScanner);
    window.addEventListener(REMNANT_CALCULATOR_OPEN_EVENT, onCalculator);
    return () => {
      window.removeEventListener(APPLIANCE_SCANNER_OPEN_EVENT, onScanner);
      window.removeEventListener(REMNANT_CALCULATOR_OPEN_EVENT, onCalculator);
    };
  }, [ensureApplianceCatalog, ensureRemnantData]);

  // storeNumber retained for future store-scoped specialty cache keys
  void storeNumber;

  return (
    <div data-testid="specialty-tools-host" aria-hidden={!scannerOpen && !calculatorOpen}>
      <ApplianceScannerModal
        open={scannerOpen}
        onClose={() => {
          setScannerOpen(false);
          setBayLocation(null);
        }}
        catalog={applianceCatalog}
        onCatalogChange={setApplianceCatalog}
        scannedBy={specialist.name}
        activeSpecialist={specialist}
        scannerEnabled={scannerOpen}
        bayLocation={bayLocation}
        onLogged={(record: ApplianceScan) => {
          void fetchApplianceScans().catch(() => undefined);
          void record;
        }}
      />
      <RemnantCalculatorModal
        open={calculatorOpen}
        onClose={() => setCalculatorOpen(false)}
        catalog={catalog}
        remnants={remnants}
        onRemnantsChange={setRemnants}
        loggedBy={specialist.name}
      />
    </div>
  );
}
