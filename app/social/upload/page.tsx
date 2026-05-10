// /social/upload → /discover.
// The + Create FAB on /discover is the single upload entry point.
// Tapping a shared /social/upload link drops the user back into the
// canonical feed where they can use that FAB.
import { redirect } from "next/navigation";
export default function SocialUploadRedirect(): never {
  redirect("/discover");
}
