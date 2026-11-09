export type SearchScope = "both" | "title" | "body";

export interface SearchMatch {
  postId: number;
  forumPostId: number;
  author: string | null;
  createdAt: string | null;
  snippet: string;
}

export interface SearchResultDiscussion {
  id: number;
  slug: string;
  title: string;
  url: string;
  categoryName: string | null;
  categorySlug: string | null;
  createdAt: string | null;
  lastPostAt: string | null;
  postCount: number;
  deletedAt: string | null;
}

export interface SearchResult {
  discussion: SearchResultDiscussion;
  rank: number;
  matches: SearchMatch[];
  moreCount: number;
}

export interface SearchResponse {
  total: number;
  page: number;
  pageSize: number;
  query: string;
  scope: SearchScope;
  results: SearchResult[];
}

export interface DiscussionPost {
  id: number;
  forumPostId: number;
  position: number;
  author: string | null;
  bodyHtml: string;
  bodyText: string;
  createdAt: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  isMatch: boolean;
  highlightHtml: string | null;
}

export interface DiscussionResponse {
  discussion: SearchResultDiscussion;
  posts: DiscussionPost[];
  query: string | null;
}

export interface ScanCounts {
  pagesFetched: number;
  discussionsNew: number;
  discussionsUpdated: number;
  postsNew: number;
  postsEdited: number;
  postsDeleted: number;
  discussionsFlaggedDeleted: number;
  maxForumPostId: number | null;
}

export interface ScanProgress extends ScanCounts {
  running: boolean;
  kind: "full" | "quick" | null;
  phase: "idle" | "index" | "threads" | "finished" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  pagesTotal: number | null;
  threadsTotal: number;
  threadsDone: number;
  message: string | null;
  error: string | null;
}

export interface ScanRunRow {
  id: number;
  kind: "full" | "quick";
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "succeeded" | "failed";
  pagesFetched: number;
  discussionsNew: number;
  discussionsUpdated: number;
  postsNew: number;
  postsEdited: number;
  postsDeleted: number;
  maxForumPostId: number | null;
  error: string | null;
}

export interface LatestPost {
  id: number;
  forumPostId: number;
  author: string | null;
  createdAt: string | null;
  discussionSlug: string;
  discussionTitle: string;
  url: string;
}

export interface ScanStatusResponse {
  latestPost: LatestPost | null;
  lastRun: ScanRunRow | null;
  scanLockHeld: boolean;
  totals: {
    discussions: number;
    posts: number;
    categories: number;
    deletedDiscussions: number;
    deletedPosts: number;
  };
  latestScanPosts: Array<{
    id: number;
    forumPostId: number;
    author: string | null;
    createdAt: string | null;
    discussionSlug: string;
    discussionTitle: string;
  }>;
  history: ScanRunRow[];
}
