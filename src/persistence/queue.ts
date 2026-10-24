/** A FIFO for account mutations. A rejected request never poisons later work. */
export interface PersistenceQueue {
  enqueue<T>(operation: () => Promise<T>): Promise<T>;
  idle(): Promise<void>;
}

export function createPersistenceQueue(): PersistenceQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    enqueue<T>(operation: () => Promise<T>): Promise<T> {
      const result = tail.then(operation);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    idle: () => tail,
  };
}

export interface RevisionOwner {
  readonly epoch: number;
  readonly userId: string;
}

/** Revisions belong to one authenticated identity and auth epoch. */
export class RevisionLedger {
  private owner: RevisionOwner | null = null;
  private revision = 0;

  reset(owner: RevisionOwner, revision: number): void {
    this.owner = owner;
    this.revision = revision;
  }

  current(owner: RevisionOwner): number | null {
    return this.matches(owner) ? this.revision : null;
  }

  advance(owner: RevisionOwner, revision: number): boolean {
    if (!this.matches(owner)) return false;
    this.revision = revision;
    return true;
  }

  clear(): void {
    this.owner = null;
    this.revision = 0;
  }

  private matches(owner: RevisionOwner): boolean {
    return this.owner?.epoch === owner.epoch && this.owner.userId === owner.userId;
  }
}
