/** Manager markdown math — presentation consumes these results. */

export type MarkdownInput =
  | { mode: "percent"; estimatedValue: number; percent: number }
  | { mode: "fixed"; estimatedValue: number | null; fixedPrice: number };

export type MarkdownResult = {
  estimated_value: number | null;
  markdown_percent: number | null;
  markdown_price: number;
};

export function computeMarkdown(input: MarkdownInput): MarkdownResult {
  if (input.mode === "percent") {
    const pct = Math.min(100, Math.max(0, input.percent));
    const price = Math.max(
      0,
      Math.round(input.estimatedValue * (1 - pct / 100) * 100) / 100
    );
    return {
      estimated_value: input.estimatedValue,
      markdown_percent: pct,
      markdown_price: price,
    };
  }

  const fixed = Math.max(0, Math.round(input.fixedPrice * 100) / 100);
  let percent: number | null = null;
  if (input.estimatedValue != null && input.estimatedValue > 0) {
    percent =
      Math.round(
        ((input.estimatedValue - fixed) / input.estimatedValue) * 1000
      ) / 10;
  }

  return {
    estimated_value: input.estimatedValue,
    markdown_percent: percent,
    markdown_price: fixed,
  };
}

export function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function clearanceBadgeLabel(input: {
  markdown_price: number | null;
  markdown_percent: number | null;
  markdown_by: string;
  estimated_value?: number | null;
}): string | null {
  if (input.markdown_price == null) return null;
  const by = input.markdown_by.trim() || "Supervisor";
  const parts: string[] = [];
  if (input.estimated_value != null) {
    parts.push(`was ${formatMoney(input.estimated_value)}`);
  }
  if (input.markdown_percent != null) {
    parts.push(`${input.markdown_percent}% Off by ${by}`);
  } else {
    parts.push(`by ${by}`);
  }
  return `🏷️ ${formatMoney(input.markdown_price)} Clearance (${parts.join(" · ")})`;
}
