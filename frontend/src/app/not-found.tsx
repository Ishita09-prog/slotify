import Link from "next/link";

export default function NotFound() {
  return (
    <div className="city-backdrop grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <p className="font-display text-7xl font-extrabold text-primary">404</p>
        <h1 className="mt-2 text-2xl font-bold">This bay doesn’t exist</h1>
        <p className="mt-2 text-muted-foreground">The page you’re looking for has moved or was never built.</p>
        <Link href="/" className="mt-6 inline-flex h-10 items-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground">
          Back to Slotify
        </Link>
      </div>
    </div>
  );
}
