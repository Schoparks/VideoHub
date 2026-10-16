/** A confirmed platform write; never used to reorder recommendation results. */
export interface CollectionChange {
  kind: 'watchlater' | 'favorites';
  itemId: string;
  added: boolean;
  folderId?: number;
}
