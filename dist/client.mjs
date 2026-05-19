// src/client.ts
var WaelioCollection = class {
  collectionName;
  dbUrl;
  token;
  messagingApp;
  listeners;
  eventSource;
  constructor(collectionName, options) {
    this.collectionName = collectionName;
    this.dbUrl = options.dbUrl.replace(/\/$/, "");
    this.token = options.dbToken || "";
    this.messagingApp = options.messagingApp || null;
    this.listeners = /* @__PURE__ */ new Set();
    this.eventSource = null;
    this.initSSE();
    this.initMessaging();
  }
  initSSE() {
    if (typeof window === "undefined" || !window.EventSource) return;
    this.eventSource = new EventSource(`${this.dbUrl}/events`);
    this.eventSource.onmessage = (event) => {
      if (event.data === "connected") return;
      try {
        const payload = JSON.parse(event.data);
        if (payload.collection === this.collectionName) {
          this.notifyListeners(payload);
        }
      } catch (err) {
        console.error("[@waelio/data] SSE parse error", err);
      }
    };
  }
  initMessaging() {
    if (!this.messagingApp) return;
    this.messagingApp.service(this.collectionName).on("created", (data) => {
      const key = data.id || data._id || Date.now().toString();
      this.notifyListeners({
        event: "set",
        collection: this.collectionName,
        key,
        value: data,
        fromRemote: true
      });
      this.saveLocal(key, data).catch((err) => {
        console.error("[@waelio/data] Failed to sync remote data locally", err);
      });
    });
  }
  notifyListeners(payload) {
    for (const listener of this.listeners) {
      listener(payload);
    }
  }
  /** Listen to reactive data changes (Local & Remote) */
  onChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  async fetchDb(path, method = "GET", body) {
    const headers = {};
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    if (body) headers["Content-Type"] = "application/json";
    const res = await fetch(`${this.dbUrl}/${this.collectionName}/${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : void 0
    });
    if (!res.ok) throw new Error(`DB Error: ${res.statusText}`);
    return res.json();
  }
  async saveLocal(key, data) {
    return this.fetchDb(key, "POST", data);
  }
  // ── Meteor-like API Methods ──────────────────────────────────────────────
  /**
   * Inserts data into the local database and broadcasts it "far away".
   */
  async insert(key, data) {
    await this.saveLocal(key, data);
    if (this.messagingApp) {
      try {
        await this.messagingApp.service(this.collectionName).create({
          ...data,
          id: key
        });
      } catch (err) {
        console.error("[@waelio/data] Failed to send to messaging server", err);
      }
    }
    return data;
  }
  async get(key) {
    const res = await this.fetchDb(key, "GET");
    return res.value;
  }
  async getAll() {
    return this.fetchDb("", "GET");
  }
  async delete(key) {
    await this.fetchDb(key, "DELETE");
  }
};
export {
  WaelioCollection
};
