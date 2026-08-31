import "server-only";

import { cache } from "react";

import { djangoFetch } from "./django";

export type CurrentUser = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: "admin" | "manager" | "member";
  team: number | null;
};

// React's cache() dedupes this across the multiple components in a single
// render pass (e.g. layout + page both calling it) into one Django request.
export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  return djangoFetch<CurrentUser>("/users/me/");
});
