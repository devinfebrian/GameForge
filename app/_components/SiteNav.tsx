import Link from "next/link";
import { signOut } from "@/lib/actions/auth";
import { getCurrentProfile } from "@/lib/dal";

export async function SiteNav() {
  const profile = await getCurrentProfile();

  return (
    <nav className="flex items-center justify-between border-b border-black/10 px-6 py-3 dark:border-white/15">
      <Link href="/" className="font-semibold">
        GameForge
      </Link>
      {profile === null ? (
        <div className="flex items-center gap-4 text-sm">
          <Link href="/login" className="underline">
            Sign in
          </Link>
          <Link href="/signup" className="underline">
            Sign up
          </Link>
        </div>
      ) : (
        <div className="flex items-center gap-4 text-sm">
          <Link href="/dashboard" className="underline">
            Studio
          </Link>
          {profile.role === "admin" ? (
            <Link href="/admin" className="underline">
              Admin
            </Link>
          ) : null}
          <form action={signOut}>
            <button type="submit" className="underline">
              Sign out
            </button>
          </form>
        </div>
      )}
    </nav>
  );
}
