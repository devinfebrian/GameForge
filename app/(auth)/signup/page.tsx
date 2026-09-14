import { SignupForm } from "./signup-form";

export default async function SignupPage({
  searchParams,
}: PageProps<"/signup">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;

  return (
    <main
      className="flex flex-1 items-center justify-center p-6"
      style={{
        background:
          "linear-gradient(160deg, #0d1117 0%, #0f1422 25%, #141836 50%, #1a1d4a 70%, #24235e 85%, #2d2b6b 100%)",
      }}
    >
      <SignupForm next={next} />
    </main>
  );
}
