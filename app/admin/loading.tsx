export default function Loading() {
  return (
    <div className="min-h-screen">
      <div className="h-[58px] border-b border-[#f2f2f2] bg-white" />
      <div className="mx-auto max-w-[1100px] px-8 py-8">
        <div className="h-7 w-40 animate-pulse rounded-lg bg-stone" />
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-stone" />
          ))}
        </div>
      </div>
    </div>
  );
}
