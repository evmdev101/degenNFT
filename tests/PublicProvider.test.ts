import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  destroy: vi.fn(),
  created: vi.fn(),
}));

vi.mock("ethers", () => ({
  Contract: class {},
  FetchRequest: class { timeout = 0; constructor(_url: string) {} },
  JsonRpcProvider: class {
    constructor() { mocks.created(); }
    getBlockNumber = mocks.check;
    destroy = mocks.destroy;
  },
}));

describe("public RPC connection", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.check.mockReset();
  });

  it("shares one endpoint race between concurrent callers and later pages", async () => {
    let resolveCheck!: (block: number) => void;
    mocks.check.mockReturnValue(new Promise<number>((resolve) => { resolveCheck = resolve; }));
    const { getPublicProvider, PULSECHAIN_RPCS } = await import("../src/lib/chain");
    const first = getPublicProvider();
    const second = getPublicProvider();
    expect(mocks.created).toHaveBeenCalledTimes(PULSECHAIN_RPCS.length);
    resolveCheck(123);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(await getPublicProvider()).toBe(a);
    expect(mocks.check).toHaveBeenCalledTimes(PULSECHAIN_RPCS.length);
  });

  it("allows a new attempt after all endpoints fail", async () => {
    mocks.check.mockRejectedValue(new Error("offline"));
    const { getPublicProvider, PULSECHAIN_RPCS } = await import("../src/lib/chain");
    await expect(getPublicProvider()).rejects.toThrow("temporarily unavailable");
    expect(mocks.destroy).toHaveBeenCalledTimes(PULSECHAIN_RPCS.length);
    mocks.check.mockResolvedValue(123);
    await expect(getPublicProvider()).resolves.toBeDefined();
  });

  it("does not wait for a stalled primary endpoint when a backup responds", async () => {
    vi.useFakeTimers();
    try {
      mocks.check.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(123);
      const { getPublicProvider } = await import("../src/lib/chain");
      await expect(getPublicProvider()).resolves.toBeDefined();
      expect(mocks.destroy).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(3000);
      expect(mocks.destroy).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
  it("replaces a cached endpoint that fails a later health check", async () => {
    vi.useFakeTimers();
    try {
      mocks.check.mockResolvedValue(123);
      const { getPublicProvider, PULSECHAIN_RPCS } = await import("../src/lib/chain");
      const initial = await getPublicProvider();
      await vi.advanceTimersByTimeAsync(30_001);
      mocks.check.mockRejectedValueOnce(new Error("endpoint unavailable")).mockResolvedValue(124);
      const recovered = await getPublicProvider();
      expect(recovered).not.toBe(initial);
      expect(mocks.created).toHaveBeenCalledTimes(PULSECHAIN_RPCS.length * 2);
    } finally { vi.useRealTimers(); }
  });

});
