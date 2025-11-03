import crypto from "node:crypto";

type Store = Map<string, Map<string, Record<string, unknown>>>;

function cloneStore(store: Store): Store {
  const clone: Store = new Map();
  for (const [collection, docs] of store.entries()) {
    const docClone: Map<string, Record<string, unknown>> = new Map();
    for (const [id, data] of docs.entries()) {
      docClone.set(id, structuredClone(data));
    }
    clone.set(collection, docClone);
  }
  return clone;
}

function mergeDeep(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nestedTarget = target[key];
      const nested =
        nestedTarget && typeof nestedTarget === "object" && !Array.isArray(nestedTarget)
          ? structuredClone(nestedTarget as Record<string, unknown>)
          : {};
      target[key] = mergeDeep(nested as Record<string, unknown>, value as Record<string, unknown>);
    }
    else {
      target[key] = value;
    }
  }
  return target;
}

class MockDocumentSnapshot {
  constructor(
    readonly ref: MockDocumentReference,
    private readonly dataObj: Record<string, unknown> | undefined
  ) {}

  data() {
    return this.dataObj ? structuredClone(this.dataObj) : undefined;
  }

  get(field: string) {
    return this.dataObj ? this.dataObj[field] : undefined;
  }

  get id() {
    return this.ref.id;
  }

  get exists() {
    return this.dataObj !== undefined;
  }
}

class MockQuerySnapshot {
  constructor(readonly docs: MockDocumentSnapshot[]) {}

  get empty() {
    return this.docs.length === 0;
  }
}

class MockDocumentReference {
  constructor(
    private readonly store: Store,
    readonly collection: string,
    readonly id: string
  ) {}

  async get() {
    const data = this.store.get(this.collection)?.get(this.id);
    return new MockDocumentSnapshot(this, data ? structuredClone(data) : undefined);
  }

  async set(data: Record<string, unknown>, options?: { merge?: boolean }) {
    const collection = ensureCollection(this.store, this.collection);
    const existing = collection.get(this.id);
    if (options?.merge && existing) {
      collection.set(this.id, mergeDeep(structuredClone(existing), structuredClone(data)));
    }
    else {
      collection.set(this.id, structuredClone(data));
    }
  }

  collection(subCollection: string) {
    return new MockCollectionReference(this.store, `${this.collection}/${this.id}/${subCollection}`);
  }

  withStore(store: Store) {
    return new MockDocumentReference(store, this.collection, this.id);
  }
}

class MockQuery {
  constructor(
    protected readonly store: Store,
    protected readonly collection: string,
    protected readonly filters: Array<{ field: string; value: unknown }> = [],
    protected readonly limitValue?: number
  ) {}

  where(field: string, _op: unknown, value: unknown) {
    return new MockQuery(this.store, this.collection, [...this.filters, { field, value }], this.limitValue);
  }

  limit(n: number) {
    return new MockQuery(this.store, this.collection, this.filters, n);
  }

  async get() {
    const collection = ensureCollection(this.store, this.collection);
    const docs: MockDocumentSnapshot[] = [];
    for (const [id, data] of collection.entries()) {
      const matches = this.filters.every(({ field, value }) => {
        return (data as Record<string, unknown>)[field] === value;
      });
      if (matches) {
        docs.push(new MockDocumentSnapshot(new MockDocumentReference(this.store, this.collection, id), structuredClone(data)));
      }
      if (this.limitValue && docs.length >= this.limitValue) break;
    }
    return new MockQuerySnapshot(docs);
  }

  withStore(store: Store) {
    return new MockQuery(store, this.collection, [...this.filters], this.limitValue);
  }
}

class MockCollectionReference extends MockQuery {
  constructor(store: Store, collection: string) {
    super(store, collection);
  }

  doc(id?: string) {
    const docId = id || crypto.randomUUID();
    ensureCollection(this.store, this.collection);
    return new MockDocumentReference(this.store, this.collection, docId);
  }

  add(data: Record<string, unknown>) {
    const ref = this.doc();
    return ref.set(data).then(() => ref);
  }

  withStore(store: Store) {
    return new MockCollectionReference(store, this.collection);
  }
}

class MockTransaction {
  constructor(private readonly store: Store) {}

  get(target: MockDocumentReference | MockQuery) {
    if (target instanceof MockDocumentReference) {
      return target.withStore(this.store).get();
    }
    return target.withStore(this.store).get();
  }

  set(ref: MockDocumentReference, data: Record<string, unknown>, options?: { merge?: boolean }) {
    return ref.withStore(this.store).set(data, options);
  }
}

function ensureCollection(store: Store, name: string) {
  let collection = store.get(name);
  if (!collection) {
    collection = new Map();
    store.set(name, collection);
  }
  return collection;
}

class MockFirestore {
  private store: Store = new Map();

  collection(name: string) {
    return new MockCollectionReference(this.store, name);
  }

  async runTransaction<T>(fn: (tx: MockTransaction) => T | Promise<T>) {
    const workingStore = cloneStore(this.store);
    const tx = new MockTransaction(workingStore);
    const result = await fn(tx);
    this.store = workingStore;
    return result;
  }

  reset() {
    this.store.clear();
  }

  dump() {
    return cloneStore(this.store);
  }
}

class MockBucket {
  files = new Map<string, { data: string | Buffer; options?: unknown }>();

  file(path: string) {
    return {
      save: async (data: string | Buffer, options?: unknown) => {
        this.files.set(path, { data, options });
      },
    };
  }

  reset() {
    this.files.clear();
  }
}

export const mockFirestore = new MockFirestore();
export const mockBucket = new MockBucket();
export const publishedMessages: Array<{ topic: string; message: unknown }> = [];

export function resetTestEnv() {
  mockFirestore.reset();
  mockBucket.reset();
  publishedMessages.splice(0, publishedMessages.length);
}

export function getDocData(collection: string, id: string) {
  const store = mockFirestore.dump();
  return store.get(collection)?.get(id);
}
