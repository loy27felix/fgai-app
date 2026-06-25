export default function Loading() {
  return (
    <div className="min-h-screen">
      <div className="h-[58px] border-b border-[#f2f2f2] bg-white" />
      <div className="mx-auto max-w-[1180px] px-8 py-8">
        <div className="h-7 w-56 animate-pulse rounded-lg bg-stone" />
        <div className="mt-3 h-4 w-96 max-w-full animate-pulse rounded bg-stone" />
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[150px] animate-pulse rounded-2xl bg-stone" />
          ))}
        </div>
      </div>
    </div>
  );
}
