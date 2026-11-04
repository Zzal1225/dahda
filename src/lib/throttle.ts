/**
 * 첫 호출은 바로, 이후는 간격마다 한 번. 묶여 있던 호출이 있으면 간격 끝에 한 번 더 실행한다.
 * 끝의 실행이 없으면 마지막 변경을 놓쳐, 발송이 끝났는데 화면이 그 직전 값에 머문다.
 */
export function createThrottle(run: () => void, intervalMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;

  function tick() {
    if (pending) {
      pending = false;
      run();
      timer = setTimeout(tick, intervalMs);
    } else {
      timer = null;
    }
  }

  return {
    call() {
      if (timer === null) {
        run();
        timer = setTimeout(tick, intervalMs);
      } else {
        pending = true;
      }
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = false;
    },
  };
}
