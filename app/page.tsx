import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/dal";

export default async function HomePage() {
  const profile = await getCurrentProfile();

  if (profile === null) {
    redirect("/login?next=/studio");
  }

  redirect("/studio");
}
