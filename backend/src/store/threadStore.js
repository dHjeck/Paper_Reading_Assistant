/**
 * Thread storage — IThreadStore interface + InMemoryThreadStore.
 *
 * Provides server-side persistence for explain-text / explain-figure
 * result threads so that follow-up requests can look up the original
 * context instead of relying solely on client-supplied data.
 *
 * The interface is intentionally minimal to allow future backends
 * (Redis, Postgres, …) to implement the same contract.
 */

/**
 * @typedef {Object} ThreadRecord
 * @property {string}   threadId
 * @property {string}   sourceType   — "text" | "figure"
 * @property {Object}   source       — selection / figure metadata
 * @property {Array}    results      — result cards
 * @property {Array}    followUps    — follow-up records
 * @property {string}   createdAt
 * @property {string}   updatedAt
 */

/**
 * @typedef {Object} IThreadStore
 * @property {function(ThreadRecord): ThreadRecord} createThread
 * @property {function(string): ThreadRecord|null}  getThread
 * @property {function(string, Object): boolean}    addResult
 * @property {function(string, Object): boolean}    addFollowUp
 */

/**
 * In-memory implementation of IThreadStore with TTL-based eviction
 * and an LRU-style cap on the maximum number of threads.
 */
export class InMemoryThreadStore {
  /** @type {Map<string, ThreadRecord>} */
  #threads = new Map();
  #maxThreads;
  #ttlMs;

  /**
   * @param {Object} [opts]
   * @param {number} [opts.maxThreads=10000]
   * @param {number} [opts.ttlMs=86400000]  — 24 h default
   */
  constructor(opts = {}) {
    this.#maxThreads = opts.maxThreads || 10000;
    this.#ttlMs = opts.ttlMs || 24 * 60 * 60 * 1000;

    // Periodically evict expired threads.
    setInterval(() => this.#evict(), this.#ttlMs).unref();
  }

  /**
   * Store a new thread record.
   * @param {ThreadRecord} record
   * @returns {ThreadRecord}
   */
  createThread(record) {
    // If we're at capacity, evict the oldest entry first.
    if (this.#threads.size >= this.#maxThreads) {
      const oldestKey = this.#threads.keys().next().value;
      this.#threads.delete(oldestKey);
    }

    this.#threads.set(record.threadId, { ...record });
    return record;
  }

  /**
   * Look up a thread by ID.  Returns null when not found or expired.
   * @param {string} threadId
   * @returns {ThreadRecord|null}
   */
  getThread(threadId) {
    const record = this.#threads.get(threadId);
    if (!record) {
      return null;
    }

    // Check TTL
    if (Date.now() - new Date(record.createdAt).getTime() > this.#ttlMs) {
      this.#threads.delete(threadId);
      return null;
    }

    return record;
  }

  /**
   * Append a result card to an existing thread.
   * @param {string} threadId
   * @param {Object} result
   * @returns {boolean}
   */
  addResult(threadId, result) {
    const record = this.getThread(threadId);
    if (!record) {
      return false;
    }

    record.results.push(result);
    record.updatedAt = new Date().toISOString();
    return true;
  }

  /**
   * Append a follow-up record to an existing thread.
   * @param {string} threadId
   * @param {Object} followUp
   * @returns {boolean}
   */
  addFollowUp(threadId, followUp) {
    const record = this.getThread(threadId);
    if (!record) {
      return false;
    }

    record.followUps.push(followUp);
    record.updatedAt = followUp.createdAt || new Date().toISOString();
    return true;
  }

  /**
   * Remove expired threads from the store.
   */
  #evict() {
    const cutoff = Date.now() - this.#ttlMs;

    for (const [id, record] of this.#threads) {
      if (new Date(record.createdAt).getTime() < cutoff) {
        this.#threads.delete(id);
      }
    }
  }
}
