export type LocalUser = {
  id: string;
  email: string;
  platform_role?: string;
  created_at?: string;
};

export type LocalDatabaseError = {
  message: string;
  code?: string;
  detail?: string;
  hint?: string;
  table?: string;
  column?: string;
  constraint?: string;
};

export type LocalResult<T = any> = {
  data: T;
  error: LocalDatabaseError | null;
  count?: number | null;
};
