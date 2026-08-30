interface TitleHelpProps {
  label: string
}

export default function TitleHelp({ label }: TitleHelpProps) {
  return (
    <span className="group relative inline-flex">
      <button type="button" aria-label="설명 보기" className="flex h-5 w-5 items-center justify-center rounded-full text-gray-400 outline-none hover:bg-gray-100 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.3 2.3 0 0 1 4.4 1c0 1.7-2.2 2-2.2 3.5" /><path d="M12 17h.01" /></svg>
      </button>
      <span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 hidden w-72 -translate-x-1/2 rounded-md border border-gray-200 bg-gray-950 px-3 py-2 text-left text-xs font-normal leading-5 text-white shadow-lg group-hover:block group-focus-within:block">
        {label}
      </span>
    </span>
  )
}
