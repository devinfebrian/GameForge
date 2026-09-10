import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <LoginForm next={next} />
    </main>
  );
}
