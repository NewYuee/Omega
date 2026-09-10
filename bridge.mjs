import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

export class Bridge extends EventEmitter {
  pending = new Map(); approvals = new Map(); sequence = 0; ready = false;
  constructor(command = process.env.OMEGA_CODEX_BIN || 'codex', args = ['app-server', '--listen', 'stdio://']) {
    super();
    this.child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.on('data', data => process.stderr.write(data));
    createInterface({ input: this.child.stdout }).on('line', line => {
      try { this.receive(JSON.parse(line)); } catch (error) { this.emit('diagnostic', error.message); }
    });
    const fail = error => {
      this.ready = false;
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
      this.pending.clear(); this.approvals.clear();
      this.emit('event', { method: 'omega/disconnected', params: { message: error.message } });
    };
    this.child.on('error', fail);
    this.child.on('exit', code => fail(new Error(`Codex exited (${code}); restart Omega to reconnect.`)));
    this.child.stdin.on('error', fail);
  }
  receive(message) {
    if (message.method) {
      if (message.id !== undefined) this.approvals.set(String(message.id), message);
      if (message.method === 'serverRequest/resolved') this.approvals.delete(String(message.params.requestId));
      this.emit('event', message); return;
    }
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
  }
  write(message) { this.child.stdin.write(JSON.stringify(message) + '\n'); }
  request(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Request timed out. Refresh state before retrying.')); }, 60000);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }
  async initialize() {
    this.info = await this.request('initialize', { clientInfo: { name: 'omega', title: 'Omega', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    this.write({ method: 'initialized' }); this.ready = true;
    return this.info;
  }
  answer(id, result) {
    const request = this.approvals.get(String(id));
    if (!request) throw new Error('This request has already been resolved on another device.');
    this.approvals.delete(String(id));
    this.write({ id: request.id, result });
    this.emit('event', { method: 'serverRequest/resolved', params: { requestId: request.id, threadId: request.params?.threadId } });
  }
  close() { this.child.kill('SIGTERM'); }
}
