// Strip BOM (U+FEFF) then convert http(s) → ws(s)
const _rawApiUrl = import.meta.env.VITE_API_URL || '';
const _cleanApiUrl = _rawApiUrl.replace(/^﻿/, '').trim()
  || 'https://linkedin-bot-backend-production.up.railway.app';
const WS_URL = _cleanApiUrl
  .replace(/^https/, 'wss')
  .replace(/^http(?!s)/, 'ws')
  + '/ws/agent/dashboard';

class WebSocketService {
  constructor() {
    this.ws            = null;
    this.callbacks     = [];
    this.reconnectTimer= null;
    this.delay         = 3000;
    this.maxDelay      = 30000;
    this.active        = false;
  }

  connect() {
    this.active = true;
    this._open();
  }

  _open() {
    if (!this.active) return;
    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        console.log('[WS] connected');
        this.delay = 3000;
        this._emit({ type: 'connection_status', connected: true });
      };

      this.ws.onmessage = (e) => {
        try { this._emit(JSON.parse(e.data)); }
        catch { /* ignore parse errors */ }
      };

      this.ws.onclose = () => {
        this._emit({ type: 'connection_status', connected: false });
        if (this.active) {
          this.reconnectTimer = setTimeout(() => {
            this.delay = Math.min(this.delay * 1.5, this.maxDelay);
            this._open();
          }, this.delay);
        }
      };

      this.ws.onerror = () => {/* handled by onclose */};
    } catch {
      // ignore — onclose will trigger retry
    }
  }

  disconnect() {
    this.active = false;
    clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  /** Subscribe to messages. Returns an unsubscribe function. */
  onMessage(cb) {
    this.callbacks.push(cb);
    return () => { this.callbacks = this.callbacks.filter(f => f !== cb); };
  }

  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  _emit(data) {
    this.callbacks.forEach(cb => cb(data));
  }
}

export const wsService = new WebSocketService();
export default wsService;
