import { ApiError } from '../middleware/errorHandler.js';
// Bounded FIFO and weighted slots: a media request uses twice the capacity of text.
export function createResourceQueue({ concurrency = 3, capacity = 4, limit = 30, waitMs = 10000, rpm = 12 } = {}) {
  const queue = []; let active = 0, weight = 0, timer; const starts = [];
  function pump() {
    clearTimeout(timer); const now = Date.now(); while (starts[0] <= now - 60000) starts.shift();
    while (queue.length && active < concurrency && weight + queue[0].weight <= capacity && starts.length < rpm) {
      const job = queue.shift(); job.cleanup(); active++; weight += job.weight; starts.push(Date.now());
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => { active--; weight -= job.weight; pump(); });
    }
    if (queue.length && starts.length >= rpm) timer = setTimeout(pump, Math.max(1, starts[0] + 60000 - Date.now()));
  }
  return {
    run(task, { signal, weight: size = 1 } = {}) {
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (queue.length >= limit) return Promise.reject(new ApiError('AI_BUSY', '目前需求較多，請稍後再試；資料查詢仍可使用。', 429, true));
      return new Promise((resolve, reject) => {
        let deadline;
        const remove = error => { const i = queue.indexOf(job); if (i < 0) return; queue.splice(i, 1); job.cleanup(); reject(error); pump(); };
        const abort = () => remove(signal.reason);
        const job = { task, resolve, reject, weight: size, cleanup() { clearTimeout(deadline); signal?.removeEventListener('abort', abort); } };
        deadline = setTimeout(() => remove(new ApiError('AI_BUSY', '等候分析已逾時，請稍後再試；你可以繼續查詢服務資料。', 429, true)), waitMs);
        signal?.addEventListener('abort', abort, { once: true }); queue.push(job); pump();
      });
    },
    status: () => ({ active, queued: queue.length, concurrency, capacity, limit }),
  };
}
