import { describe, expect, it } from "vitest";
import { dashboardAmount, dashboardUsd } from "../src/features/dashboard/format";
describe("dashboard number display", () => {
  it("formats large balances without losing integer precision and handles small units", () => {
    expect(dashboardAmount(123456789012345678901234567890000000000n)).toBe("123,456,789,012,345,678,901.235");
    expect(dashboardAmount(1n, 18)).toBe("<0.001");
    expect(dashboardAmount(2345678n, 6)).toBe("2.346");
    expect(dashboardAmount(2n, 0)).toBe("2");
  });
  it("keeps real zeros separate from missing balances and invalid dollar values", () => {
    expect(dashboardAmount(0n)).toBe("0"); expect(dashboardAmount(null)).toBe("—");
    expect(dashboardUsd(null)).toBe("—"); expect(dashboardUsd(NaN)).toBe("—");
    expect(dashboardUsd(0)).toBe("$0.00 USD"); expect(dashboardUsd(.0001)).toBe("<$0.01 USD");
    expect(dashboardUsd(.4, true)).toBe("<$1");
  });
});
