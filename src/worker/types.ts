export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
}

export interface PostRow {
  id: number;
  slug: string;
  title: string;
  category: string;
  excerpt: string;
  content: string;
  published: number;
  created_at: string;
  updated_at: string;
}
