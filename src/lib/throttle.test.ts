import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThrottle } from "./throttle";

describe("createThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("첫 호출은 바로 실행한다", () => {
    const run = vi.fn();
    createThrottle(run, 1000).call();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("간격 안의 호출을 묶어 끝에 한 번 실행한다", () => {
    const run = vi.fn();
    const throttle = createThrottle(run, 1000);

    throttle.call();
    for (let index = 0; index < 50; index += 1) throttle.call();
    expect(run).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("묶인 호출이 없으면 끝에 실행하지 않는다", () => {
    const run = vi.fn();
    createThrottle(run, 1000).call();
    vi.advanceTimersByTime(5000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("끝의 실행 뒤에도 간격을 지킨다", () => {
    const run = vi.fn();
    const throttle = createThrottle(run, 1000);
    throttle.call();
    throttle.call();
    vi.advanceTimersByTime(1000);
    throttle.call();
    expect(run).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("쉰 뒤의 호출은 다시 바로 실행한다", () => {
    const run = vi.fn();
    const throttle = createThrottle(run, 1000);
    throttle.call();
    vi.advanceTimersByTime(2000);
    throttle.call();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("취소하면 묶인 호출을 버린다", () => {
    const run = vi.fn();
    const throttle = createThrottle(run, 1000);
    throttle.call();
    throttle.call();
    throttle.cancel();
    vi.advanceTimersByTime(5000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
