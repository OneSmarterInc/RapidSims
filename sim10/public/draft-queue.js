'use strict';
// Serialize writes and retain failed fields until the server acknowledges them.
class DraftQueue {
  constructor({ write, changed = () => {}, initial = {}, delay = 350 }) {
    this.write = write; this.changed = changed; this.delay = delay;
    this.dirty = { ...initial }; this.versions = {}; this.serial = 0;
    this.busy = null; this.timer = null; this.error = null;
  }
  edit(fields) {
    for (const [key, value] of Object.entries(fields)) {
      this.dirty[key] = value; this.versions[key] = ++this.serial;
    }
    this.error = null; this.changed();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush().catch(() => {}), this.delay);
  }
  async flush() {
    clearTimeout(this.timer); this.timer = null;
    if (this.busy) return this.busy;
    this.error = null;
    const run = async () => {
      while (Object.keys(this.dirty).length) {
        const fields = { ...this.dirty }, versions = { ...this.versions };
        await this.write(fields);
        for (const key of Object.keys(fields)) {
          if (this.versions[key] === versions[key]) delete this.dirty[key];
        }
      }
    };
    // Defer work one microtask so busy is assigned even for an empty queue.
    this.busy = Promise.resolve().then(run).catch(e => { this.error = e; throw e; })
      .finally(() => { this.busy = null; this.changed(); });
    this.changed();
    return this.busy;
  }
  pause() { clearTimeout(this.timer); this.timer = null; }
  get unsettled() { return !!this.busy || Object.keys(this.dirty).length > 0; }
}
if (typeof module !== 'undefined') module.exports = { DraftQueue };
