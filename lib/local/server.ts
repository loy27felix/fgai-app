import { createClient as createLocalClient } from "@/lib/local/server-client";

export function createClient() {
  return createLocalClient();
}
