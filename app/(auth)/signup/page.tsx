import { SignupForm } from "./signup-form";

export default async function SignupPage({
  searchParams,
}: PageProps<"/signup">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <SignupForm next={next} />
    </main>
  );
}
