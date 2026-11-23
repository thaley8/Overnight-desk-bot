import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <div className="num text-[13px] text-fg-4">404</div>
      <h1 className="mt-2 text-[20px] font-semibold text-fg">Nothing on the desk here</h1>
      <p className="mt-2 text-sm text-fg-3">The page you asked for doesn&apos;t exist.</p>
      <Link href="/" className="mt-6 rounded-md border border-line-2 bg-elevated px-3 py-1.5 text-[12.5px] text-fg hover:bg-hover">
        Back to Command Center
      </Link>
    </div>
  );
}
