"use client";

/**
 * Roll / carton measurement pad — presentation only.
 * CLF / sqft math stays in lib/calc.ts; CycleAuditScanForm owns draft state.
 */

import type { Ref } from "react";
import { NumberField } from "@/components/ui/NumberField";
import {
  FRACTION_OPTIONS,
  formatClf,
  formatDecimalInches,
  formatSqFt,
  formatSqYd,
} from "@/lib/calc";

type RollProps = {
  mode: "roll";
  wholeInches: string;
  onWholeInchesChange: (value: string) => void;
  fraction: number;
  onFractionChange: (value: number) => void;
  rounds: string;
  onRoundsChange: (value: string) => void;
  onBumpRounds: (delta: number) => void;
  onBumpWhole: (delta: number) => void;
  clf: number;
  sqFt: number;
  sqYd: number;
  rollWidthFt: number;
  measureInputRef?: Ref<HTMLInputElement>;
};

type CartonProps = {
  mode: "carton";
  boxCount: string;
  onBoxCountChange: (value: string) => void;
  onBumpBoxes: (delta: number) => void;
  sqftPerBox: string;
  onSqftPerBoxChange: (value: string) => void;
  cartonSqFt: number;
  boxCountInputRef?: Ref<HTMLInputElement>;
};

export type RollMeasurementPadProps = RollProps | CartonProps;

export function RollMeasurementPad(props: RollMeasurementPadProps) {
  if (props.mode === "carton") {
    return <CartonPad {...props} />;
  }
  return <RollPad {...props} />;
}

function RollPad({
  wholeInches,
  onWholeInchesChange,
  fraction,
  onFractionChange,
  rounds,
  onRoundsChange,
  onBumpRounds,
  onBumpWhole,
  clf,
  sqFt,
  sqYd,
  rollWidthFt,
  measureInputRef,
}: RollProps) {
  const fractions = FRACTION_OPTIONS.filter((opt) => opt.value > 0);

  return (
    <section className="overflow-hidden rounded-2xl border border-accent/35 bg-zinc-950/70">
      <header className="flex items-start justify-between gap-3 border-b border-accent/20 px-3 py-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
            Roll Measurement Pad
          </p>
          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-zinc-400">
            {formatDecimalInches(
              Number(wholeInches || 0) + fraction
            )}{" "}
            · {rollWidthFt} ft
          </p>
        </div>
        <div className="shrink-0 text-right" aria-live="polite">
          <p className="font-mono text-lg font-bold leading-none tabular-nums text-accent">
            {formatClf(clf)}
            <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-accent/80">
              lin ft
            </span>
          </p>
          <p className="mt-0.5 font-mono text-[11px] font-semibold tabular-nums text-zinc-300">
            {formatSqYd(sqYd)} sq yd
            <span className="mx-1 text-zinc-600">·</span>
            {formatSqFt(sqFt)} sq ft
          </p>
        </div>
      </header>

      <div className="space-y-2.5 p-3">
        <div>
          <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-500">
            Whole inches
          </p>
          <Stepper
            value={wholeInches}
            onChange={onWholeInchesChange}
            onBump={onBumpWhole}
            ariaLabel="Whole inches"
            inputRef={measureInputRef}
          />
        </div>

        <fieldset>
          <legend className="mb-1 font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-500">
            Fractions
          </legend>
          <div className="grid grid-cols-4 gap-1.5">
            <FractionKey
              label='0"'
              active={fraction === 0}
              onClick={() => onFractionChange(0)}
            />
            {fractions.map((opt) => (
              <FractionKey
                key={opt.label}
                label={opt.label}
                active={fraction === opt.value}
                onClick={() => onFractionChange(opt.value)}
              />
            ))}
          </div>
        </fieldset>

        <div>
          <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-500">
            Rounds
          </p>
          <Stepper
            value={rounds}
            onChange={onRoundsChange}
            onBump={onBumpRounds}
            ariaLabel="Rounds"
          />
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {[5, 10, 20].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onBumpRounds(n)}
                className="flex min-h-11 items-center justify-center rounded-xl border border-accent/35 bg-zinc-950 font-mono text-sm font-bold text-accent active:scale-[0.98]"
              >
                +{n}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CartonPad({
  boxCount,
  onBoxCountChange,
  onBumpBoxes,
  sqftPerBox,
  onSqftPerBoxChange,
  cartonSqFt,
  boxCountInputRef,
}: CartonProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-accent/35 bg-zinc-950/70">
      <header className="flex items-start justify-between gap-3 border-b border-accent/20 px-3 py-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
            Carton Measurement Pad
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-zinc-400">
            Units × coverage
          </p>
        </div>
        <div className="shrink-0 text-right" aria-live="polite">
          <p className="font-mono text-lg font-bold leading-none tabular-nums text-accent">
            {formatSqFt(cartonSqFt)}
            <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-accent/80">
              sq ft
            </span>
          </p>
        </div>
      </header>
      <div className="space-y-2.5 p-3">
        <NumberField
          label="Sq Ft per box"
          mode="decimal"
          value={sqftPerBox}
          onChange={onSqftPerBoxChange}
          placeholder="e.g. 23.64"
        />
        <div>
          <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-500">
            Carton / unit count
          </p>
          <Stepper
            value={boxCount}
            onChange={onBoxCountChange}
            onBump={onBumpBoxes}
            ariaLabel="Box count"
            inputRef={boxCountInputRef}
          />
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {[5, 10, 20].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onBumpBoxes(n)}
                className="flex min-h-11 items-center justify-center rounded-xl border border-accent/35 bg-zinc-950 font-mono text-sm font-bold text-accent active:scale-[0.98]"
              >
                +{n}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Stepper({
  value,
  onChange,
  onBump,
  ariaLabel,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onBump: (delta: number) => void;
  ariaLabel: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label={`Decrease ${ariaLabel}`}
        onClick={() => onBump(-1)}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 text-lg font-bold text-zinc-100 active:scale-95"
      >
        −
      </button>
      <NumberField
        mode="integer"
        value={value}
        onChange={onChange}
        placeholder="0"
        center
        className="min-w-0 flex-1"
        aria-label={ariaLabel}
        inputRef={inputRef}
      />
      <button
        type="button"
        aria-label={`Increase ${ariaLabel}`}
        onClick={() => onBump(1)}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 text-lg font-bold text-zinc-100 active:scale-95"
      >
        +
      </button>
    </div>
  );
}

function FractionKey({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-11 items-center justify-center rounded-xl font-mono text-xs font-bold transition active:scale-[0.98] ${
        active
          ? "bg-accent text-accent-fg"
          : "border border-zinc-800 bg-zinc-950 text-zinc-200"
      }`}
    >
      {label}
    </button>
  );
}
