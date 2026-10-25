import { ApiError } from '../middleware/errorHandler.js';

export class InMemoryJourneyRepository {
  // ponytail: single-process, one-hour demo storage; use durable storage and authorization before production.
  constructor({ maxEntries = 100, ttlMs = 3600000 } = {}) { this.entries = new Map(); this.maxEntries = maxEntries; this.ttlMs = ttlMs; }
  delete(id) { this.entries.delete(id); }
  get(id) {
    const entry = this.entries.get(id);
    if (!entry || entry.expiresAt <= Date.now()) { this.entries.delete(id); return null; }
    return structuredClone(entry.journey);
  }
  save(journey) {
    for (const [id, entry] of this.entries) if (entry.expiresAt <= Date.now()) this.entries.delete(id);
    if (!this.entries.has(journey.id) && this.entries.size >= this.maxEntries) throw new ApiError('JOURNEY_CAPACITY_REACHED', '示範案件數已達上限，請稍後再試。', 503);
    this.entries.set(journey.id, { journey: structuredClone(journey), expiresAt: Date.now() + this.ttlMs });
    return structuredClone(journey);
  }
}
