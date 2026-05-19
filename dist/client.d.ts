interface WaelioCollectionOptions {
    dbUrl: string;
    dbToken?: string;
    messagingApp?: any;
}
type ChangeCallback = (data: any) => void;
declare class WaelioCollection {
    private collectionName;
    private dbUrl;
    private token;
    private messagingApp;
    private listeners;
    private eventSource;
    constructor(collectionName: string, options: WaelioCollectionOptions);
    private initSSE;
    private initMessaging;
    private notifyListeners;
    /** Listen to reactive data changes (Local & Remote) */
    onChange(callback: ChangeCallback): () => boolean;
    private fetchDb;
    private saveLocal;
    /**
     * Inserts data into the local database and broadcasts it "far away".
     */
    insert(key: string, data: any): Promise<any>;
    get(key: string): Promise<any>;
    getAll(): Promise<any>;
    delete(key: string): Promise<void>;
}

export { type ChangeCallback, WaelioCollection, type WaelioCollectionOptions };
