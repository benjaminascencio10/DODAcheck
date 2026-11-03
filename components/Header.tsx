export default function Header() {
  return (
    <header className="border-b border-slate-800 bg-slate-900">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <span className="font-semibold text-white text-sm tracking-tight">
          DODAScanner
        </span>
        <a
          href="https://github.com/benjaminascencio10/DODAcheck"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-slate-300 hover:text-white transition-colors"
        >
          GitHub
        </a>
      </div>
    </header>
  );
}
