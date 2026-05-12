export interface WaelioCollectionOptions {
  dbUrl: string;
  dbToken?: string;
  // Pass your initialized FeathersJS app here to enable "far away" syncing!
  // e.g., feathers().configure(feathers.socketio(socket))
  messagingApp?: any; 
}

export type ChangeCallback = (data: any) => void;

export class WaelioCollection {
  private collectionName: string;
  private dbUrl: string;
  private token: string;
  private messagingApp: any | null;
  private listeners: Set<ChangeCallback>;
  private eventSource: EventSource | null;

  constructor(collectionName: string, options: WaelioCollectionOptions) {
    this.collectionName = collectionName;
    this.dbUrl = options.dbUrl.replace(/\/$/, '');
    this.token = options.dbToken || '';
    this.messagingApp = options.messagingApp || null;
    this.listeners = new Set();
    this.eventSource = null;

    this.initSSE();
    this.initMessaging();
  }

  private initSSE() {
    if (typeof window === 'undefined' || !window.EventSource) return;

    this.eventSource = new EventSource(`${this.dbUrl}/events`);
    this.eventSource.onmessage = (event) => {
      if (event.data === 'connected') return;
      try {
        const payload = JSON.parse(event.data);
        // Only notify if the change belongs to this specific collection
        if (payload.collection === this.collectionName) {
            this.notifyListeners(payload);
        }
      } catch (err) {
        console.error('[@waelio/data] SSE parse error', err);
      }
    };
  }

  private initMessaging() {
    if (!this.messagingApp) return;

    // Listen to remote changes from the messaging server!
    this.messagingApp.service(this.collectionName).on('created', (data: any) => {
       const key = data.id || data._id || Date.now().toString();
       
       // Optional check to avoid echo loop: skip if we created it
       // Assuming data payload includes a sender flag, but we'll let UI handle it for now.
       
       this.notifyListeners({ 
           event: 'set', 
           collection: this.collectionName, 
           key, 
           value: data, 
           fromRemote: true 
       });

       // Instantly mirror the remote data into our local `@waelio/data` store!
       this.saveLocal(key, data).catch((err) => {
         console.error('[@waelio/data] Failed to sync remote data locally', err);
       });
    });
  }

  private notifyListeners(payload: any) {
    for (const listener of this.listeners) {
      listener(payload);
    }
  }

  /** Listen to reactive data changes (Local & Remote) */
  public onChange(callback: ChangeCallback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback); // Returns unsubscribe function
  }

  private async fetchDb(path: string, method: string = 'GET', body?: any) {
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    if (body) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${this.dbUrl}/${this.collectionName}/${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    
    if (!res.ok) throw new Error(`DB Error: ${res.statusText}`);
    return res.json();
  }

  private async saveLocal(key: string, data: any) {
    return this.fetchDb(key, 'POST', data);
  }

  // ── Meteor-like API Methods ──────────────────────────────────────────────

  /**
   * Inserts data into the local database and broadcasts it "far away".
   */
  public async insert(key: string, data: any) {
    // 1. Save to Local Database instantly (Optimistic update)
    await this.saveLocal(key, data);

    // 2. Broadcast to someone far away (if Messaging is connected)
    if (this.messagingApp) {
        try {
            await this.messagingApp.service(this.collectionName).create({
               ...data,
               id: key
            });
        } catch (err) {
            console.error('[@waelio/data] Failed to send to messaging server', err);
        }
    }

    return data;
  }

  public async get(key: string) {
    const res = await this.fetchDb(key, 'GET');
    return res.value;
  }

  public async getAll() {
    return this.fetchDb('', 'GET');
  }

  public async delete(key: string) {
    // Local delete
    await this.fetchDb(key, 'DELETE');
    // If you add delete support to the messaging hub, trigger it here!
  }
}
