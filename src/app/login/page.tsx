import { redirect } from "next/navigation";

// Keep old bookmarks functional without reintroducing the legacy login site.
export default function LoginRedirect() {
  redirect("/mini");
}
