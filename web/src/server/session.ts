/**
 * Placeholder for authentication.
 *
 * The identity plumbing this returns into (withUser -> SET LOCAL app.user_id ->
 * RLS) is the real thing and does not change when auth lands; only this function
 * does. Swapping in Better Auth means reading its session here and returning the
 * user id — nothing downstream moves.
 */
export function currentUserId(): string {
  const devUserId = process.env.DEV_USER_ID;

  // Fail loudly rather than shipping a build where every request is "Dev User".
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "No authentication configured. Wire up a real session provider in src/server/session.ts before deploying.",
    );
  }

  if (!devUserId) {
    throw new Error("DEV_USER_ID is not set. Copy web/.env.local.example to web/.env.local and run ./db/seed-dev.sh.");
  }

  return devUserId;
}
