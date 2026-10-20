export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const appName = process.env.APP_NAME ?? "OpenWa Agent";
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-2xl font-semibold tracking-tight">{appName}</p>
          <p className="mt-1 text-sm text-slate-500">Self-hosted AI customer support for WhatsApp Business</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {children}
        </div>
        <p className="mt-6 text-center text-xs text-slate-500">
          Independent open-source project. Not affiliated with, endorsed by or sponsored by WhatsApp or Meta.
        </p>
      </div>
    </main>
  );
}
