import "server-only";

import { cache } from "react";

import type { AccountUser } from "./accounts-types";
import { djangoFetch } from "./django";

// The logged-in user is just one instance of the same shape every row in
// /api/v1/users/ has — re-exported rather than redeclared so the two can
// never drift apart. See accounts-types.ts for the field-by-field doc.
export type CurrentUser = AccountUser;

// React's cache() dedupes this across the multiple components in a single
// render pass (e.g. layout + page both calling it) into one Django request.
export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  return djangoFetch<CurrentUser>("/users/me/");
});
