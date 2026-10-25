import { openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync, fsyncSync, lstatSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiError } from '../middleware/errorHandler.js';

const unavailable = () => new ApiError('AI_USAGE_UNAVAILABLE', '目前無法確認免費使用額度，分析暫停，請稍後再試。', 503, false);
const dayAt = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

// One private local filesystem, atomic lock/rename; never put this ledger in a release or /tmp.
export function createDurableQuota({ file, dailyLimit = 12, concurrency = 1, timeoutMs = 10000, intervalMs = 5000, now = Date.now }) {
  if (!isAbsolute(file ?? '')) throw unavailable();
  function update(change) {
    let lock; let temp;
    try {
      const directory = lstatSync(dirname(file));
      if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077)) throw unavailable();
      lock = openSync(`${file}.lock`, 'wx', 0o600);
      let state;
      try {
        const info = lstatSync(file);
        if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077)) throw unavailable();
        state = JSON.parse(readFileSync(file, 'utf8'));
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const timestamp = now(); const day = dayAt(timestamp);
      if (state && (state.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(state.day) || !Number.isSafeInteger(state.used) || state.used < 0 || !Number.isFinite(state.lastRequestAt) || !Number.isFinite(state.blockedUntil) || !Array.isArray(state.leases) || state.leases.some(lease => typeof lease.id !== 'string' || !Number.isFinite(lease.until)))) throw unavailable();
      if (state && (day < state.day || timestamp < state.lastRequestAt)) throw unavailable();
      state ??= { version: 1, day, used: 0, lastRequestAt: 0, blockedUntil: 0, leases: [] };
      if (day > state.day) { state.day = day; state.used = 0; }
      state.leases = state.leases.filter(lease => lease.until > timestamp);
      const result = change(state, timestamp);
      temp = `${file}.${randomUUID()}.tmp`;
      const fd = openSync(temp, 'wx', 0o600);
      try { writeFileSync(fd, JSON.stringify(state)); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, file); temp = undefined;
      const directoryFd = openSync(dirname(file), 'r');
      try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
      return result;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error.code === 'EEXIST') throw new ApiError('AI_BUSY', '目前有分析正在進行，請稍後再試。', 429, true);
      throw unavailable();
    } finally {
      if (temp) { try { unlinkSync(temp); } catch { /* Fail closed on the next request. */ } }
      if (lock !== undefined) { closeSync(lock); unlinkSync(`${file}.lock`); }
    }
  }
  return {
    acquire() {
      return update((state, timestamp) => {
        if (state.used >= dailyLimit) throw new ApiError('AI_DAILY_LIMIT_REACHED', '今日免費分析次數已用完，請明日再試或使用示範模式。', 429, false);
        if (state.blockedUntil > timestamp || state.leases.length >= concurrency || (state.lastRequestAt && timestamp - state.lastRequestAt < intervalMs)) throw new ApiError('AI_BUSY', '目前有分析正在進行或需稍候，請稍後再試。', 429, true);
        const id = randomUUID(); state.used++; state.lastRequestAt = timestamp;
        state.leases.push({ id, until: timestamp + timeoutMs + 5000 });
        return id;
      });
    },
    release(id) { update(state => { state.leases = state.leases.filter(lease => lease.id !== id); }); },
    block() { update((state, timestamp) => { state.blockedUntil = timestamp + 60000; }); },
  };
}
