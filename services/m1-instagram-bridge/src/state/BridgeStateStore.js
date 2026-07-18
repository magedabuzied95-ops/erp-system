import fs from 'node:fs/promises';
import path from 'node:path';

const emptyState = () => ({ version: 1, conversations: {}, seen_messages: {}, pending_reconciliations: {}, updated_at: null });

export class BridgeStateStore {
  constructor(filePath) { this.filePath = filePath; this.state = emptyState(); }
  async load() {
    try { this.state = { ...emptyState(), ...JSON.parse(await fs.readFile(this.filePath, 'utf8')) }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this.state;
  }
  hasMessage(key) { return Boolean(this.state.seen_messages[key]); }
  async rememberMessage(key, metadata = {}) {
    if (this.hasMessage(key)) return false;
    this.state.seen_messages[key] = { ...metadata, seen_at: new Date().toISOString() };
    await this.save();
    return true;
  }
  getConversation(id) { return this.state.conversations[id] || null; }
  async saveConversation(identity) {
    this.state.conversations[identity.external_conversation_id] = identity;
    await this.save();
  }
  async setReconciliation(jobKey, record) { this.state.pending_reconciliations[jobKey] = record; await this.save(); }
  async clearReconciliation(jobKey) { delete this.state.pending_reconciliations[jobKey]; await this.save(); }
  listReconciliations() { return Object.entries(this.state.pending_reconciliations); }
  async save() {
    this.state.updated_at = new Date().toISOString();
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(this.state), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, this.filePath);
  }
}
