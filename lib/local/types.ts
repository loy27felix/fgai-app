export type LocalUser = {
  id: string;
  email: string;
  platform_role?: string;
  created_at?: string;
};

export type LocalResult<T = any> = {
  data: T;
  error: { message: string; code?: string } | null;
  count?: number | null;
};
