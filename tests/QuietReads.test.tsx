import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useQuietRead } from "../src/hooks/useQuietRead";
it("combines duplicate reads and retains values after a temporary failure", async () => {
  const read = vi.fn().mockResolvedValue({ balance: 42 });
  const first = renderHook(() => useQuietRead("test:shared", read));
  const second = renderHook(() => useQuietRead("test:shared", read));
  await waitFor(() => expect(first.result.current.data).toEqual({ balance: 42 }));
  expect(second.result.current.data).toEqual({ balance: 42 });
  expect(read).toHaveBeenCalledTimes(1);
  read.mockRejectedValueOnce(new Error("offline"));
  await act(() => first.result.current.refresh());
  expect(first.result.current.data).toEqual({ balance: 42 });
  expect(first.result.current.error).toBeDefined();
  read.mockResolvedValueOnce({ balance: 43 });
  await act(() => first.result.current.refresh());
  expect(second.result.current.data).toEqual({ balance: 43 });
  expect(second.result.current.error).toBeUndefined();
});

it("keeps one polling loop when visibility changes while a read is pending", async () => {
  vi.useFakeTimers();
  try {
    const read = vi.fn().mockResolvedValue(1);
    const view = renderHook(() => useQuietRead("test:polling", read));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    let finish!: (value: number) => void;
    read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); document.dispatchEvent(new Event("visibilitychange")); });
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => { finish(2); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(read).toHaveBeenCalledTimes(3);
    view.unmount();
  } finally { vi.useRealTimers(); }
});

it("shares refresh state while preserving the loaded value and snapshot time", async () => {
  const read = vi.fn().mockResolvedValue({ balance: 42 });
  const first = renderHook(() => useQuietRead("test:refresh-state", read));
  const second = renderHook(() => useQuietRead("test:refresh-state", read));
  await waitFor(() => expect(first.result.current.data).toEqual({ balance: 42 }));
  const loadedAt = first.result.current.updatedAt;
  let finish!: (value: { balance: number }) => void;
  read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let pending: Promise<void> | undefined;
  act(() => { pending = first.result.current.refresh(); });
  expect(first.result.current.isRefreshing).toBe(true);
  expect(second.result.current.isRefreshing).toBe(true);
  expect(second.result.current.data).toEqual({ balance: 42 });
  expect(second.result.current.updatedAt).toBe(loadedAt);
  let duplicate: Promise<void> | undefined;
  act(() => { duplicate = second.result.current.refresh(); });
  expect(duplicate).toBe(pending);
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => { await Promise.resolve(); finish({ balance: 43 }); await pending; });
  expect(read).toHaveBeenCalledTimes(2);
  expect(first.result.current.isRefreshing).toBe(false);
  expect(second.result.current.isRefreshing).toBe(false);
  expect(second.result.current.data).toEqual({ balance: 43 });
});

it("ends refreshing on failure while retaining the last successful value and age", async () => {
  const read = vi.fn().mockResolvedValue(42);
  const view = renderHook(() => useQuietRead("test:refresh-failure", read));
  await waitFor(() => expect(view.result.current.data).toBe(42));
  const loadedAt = view.result.current.updatedAt;
  read.mockRejectedValueOnce(new Error("RPC unavailable"));
  await act(async () => { await view.result.current.refresh(); });
  expect(view.result.current.isRefreshing).toBe(false);
  expect(view.result.current.data).toBe(42);
  expect(view.result.current.updatedAt).toBe(loadedAt);
  expect(view.result.current.error).toBe("Temporarily unavailable");
});
