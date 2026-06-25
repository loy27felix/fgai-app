export default function Loading() {
  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-[1180px] px-7 pt-7">
        <div className="h-[150px] animate-pulse rounded-[22px] bg-stone" />
        <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[300px] animate-pulse rounded-2xl bg-stone" />
          ))}
        </div>
      </div>
    </div>
  );
}
