import { PrivyLoginButton } from "./privy-login-button";

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 font-sans dark:bg-black">
      <main className="flex w-full max-w-md flex-col items-center gap-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-4xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Ikigaro
          </h1>
          <p className="text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            Your health, tracked with intention.
          </p>
        </div>
        <PrivyLoginButton />
      </main>
    </div>
  );
}
