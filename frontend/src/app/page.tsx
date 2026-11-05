export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black sm:px-12">
      <main className="flex w-full max-w-2xl flex-col items-center gap-4 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50 sm:text-5xl">
          Rally
        </h1>
        <p className="max-w-md text-base leading-7 text-zinc-600 dark:text-zinc-400 sm:text-lg">
          Frontend application for Rally.
        </p>
      </main>
    </div>
  );
}
