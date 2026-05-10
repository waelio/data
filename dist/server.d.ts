import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';

interface DatabaseOptions {
    filePath?: string;
    encryptionKey?: string;
}
declare class Database extends EventEmitter {
    private _filePath;
    private _encryptionKey;
    private _data;
    constructor(options?: DatabaseOptions);
    private _nullProtoData;
    private _load;
    private _save;
    private _encrypt;
    private _decrypt;
    private _validateName;
    private _ensureCollection;
    set(collection: string, key: string, value: any): void;
    get(collection: string, key: string): any;
    has(collection: string, key: string): boolean;
    delete(collection: string, key: string): boolean;
    getAll(collection: string): Record<string, any>;
    clear(collection: string): void;
    collections(): string[];
}

interface FileStoreOptions {
    storageDir?: string;
}
declare class FileStore extends EventEmitter {
    private _storageDir;
    constructor(options?: FileStoreOptions);
    private _ensureDir;
    private _validateKey;
    private _getFilePath;
    saveFile(key: string, buffer: Buffer): void;
    getFileStream(key: string): fs.ReadStream | null;
    getFileSize(key: string): number | null;
    deleteFile(key: string): boolean;
    hasFile(key: string): boolean;
}

interface ServerOptions {
    db?: Database;
    fileStore?: FileStore;
    token?: string;
    port?: number;
    host?: string;
    cors?: string | string[];
    dbOptions?: DatabaseOptions;
    fileStoreOptions?: FileStoreOptions;
}
declare function createServer(options?: ServerOptions): {
    server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>;
    db: Database;
    fileStore: FileStore;
    token: string;
};

export { Database as D, FileStore as F, type ServerOptions, createServer, createServer as default };
