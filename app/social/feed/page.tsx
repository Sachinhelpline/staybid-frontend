// /social/feed → /discover.
// There is ONE Reels feed. It lives at /discover and shows hotels +
// creators + public posts mixed together. This route is kept only so
// older shared links don't 404.
import { redirect } from "next/navigation";
export default function SocialFeedRedirect(): never {
  redirect("/discover");
}
