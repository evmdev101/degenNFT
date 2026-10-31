/** Display formatting only; underlying balances remain exact integers. */
export function dashboardAmount(raw: bigint | null | undefined, decimals = 18): string {
  if (raw == null || raw < 0n) return "—";
  if (raw === 0n) return "0";
  const digits = Math.min(3, decimals);
  const divisor = 10n ** BigInt(decimals - digits);
  const rounded = (raw + divisor / 2n) / divisor;
  if (rounded === 0n) return `<${digits ? "0." + "0".repeat(digits - 1) + "1" : "1"}`;
  const scale = 10n ** BigInt(digits);
  const whole = (rounded / scale).toLocaleString("en-US");
  const fraction = digits ? (rounded % scale).toString().padStart(digits, "0").replace(/0+$/, "") : "";
  return whole + (fraction ? "." + fraction : "");
}

export function dashboardUsd(value: number | null | undefined, whole = false): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  if (value > 0 && value < (whole ? 1 : .01)) return whole ? "<$1" : "<$0.01 USD";
  return "$" + value.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }) + (whole ? "" : " USD");
}
