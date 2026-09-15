import Link from "next/link";
import { signOut } from "@/lib/actions/auth";
import { getCurrentProfile } from "@/lib/dal";
import { GameForgeLogo } from "./GameForgeLogo";

export async function SiteNav() {
  const profile = await getCurrentProfile();

  return (
    <nav className="flex h-[49px] items-center justify-between border-b border-[#212634] bg-[#0e1117] px-5 text-zinc-300">
      <Link href="/" className="flex items-center gap-2 font-semibold text-white tracking-tight hover:opacity-90 transition-opacity">
        <GameForgeLogo size={20} white />
        <span>GameForge</span>
      </Link>

      {profile === null ? (
        <div className="flex items-center gap-4 text-xs font-medium">
          <Link href="/login" className="text-zinc-400 hover:text-white transition-colors">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-[#F26207] px-3 py-1 text-white font-semibold hover:bg-[#d95503] transition-colors"
          >
            Sign up
          </Link>
        </div>
      ) : (
        <div className="flex items-center gap-4 text-xs font-medium">
          <Link
            href="/studio"
            className="text-zinc-300 hover:text-white transition-colors"
          >
            Studio
          </Link>
          {profile.role === "admin" ? (
            <Link
              href="/admin"
              className="text-zinc-400 hover:text-white transition-colors"
            >
              Admin
            </Link>
          ) : null}
          <form action={signOut}>
            <button
              type="submit"
              className="text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </nav>
  );
}
