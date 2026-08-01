import type { Comment } from "./commentTypes";

let nextId = 1;

/** In-memory comment store — mirrors `CoachStore`'s shape; cleared on demo reload, restorable via session import. */
export class CommentStore {
  private items: Comment[] = [];

  add(input: Omit<Comment, "id" | "createdAt">): Comment {
    const comment: Comment = { ...input, id: `c${nextId++}`, createdAt: new Date().toISOString() };
    this.items.push(comment);
    return comment;
  }

  update(id: string, patch: Partial<Pick<Comment, "text" | "kind" | "author">>): void {
    const c = this.items.find((x) => x.id === id);
    if (c) Object.assign(c, patch);
  }

  remove(id: string): void {
    this.items = this.items.filter((x) => x.id !== id);
  }

  listForRound(round: number): Comment[] {
    return this.items.filter((c) => c.round === round);
  }

  listAll(): Comment[] {
    return [...this.items].sort((a, b) => a.tick - b.tick);
  }

  clearAll(): void {
    this.items = [];
  }

  toJSON(): Comment[] {
    return this.items;
  }

  loadFromJSON(items: Comment[]): void {
    this.items = items;
  }
}
