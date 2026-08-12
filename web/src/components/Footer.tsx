export function Footer() {
  return (
    <footer className="border-t border-line pb-16 md:pb-0">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-[12px] text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          ShadowPool — an on-chain dark pool for FAssets. Built for the Flare Summer Signal hackathon.
        </p>
        <p className="flex items-center gap-4">
          <a className="hover:text-ink-2" href="https://dev.flare.network" target="_blank" rel="noreferrer">
            Flare Dev Hub
          </a>
          <span>Powered by Flare Confidential Compute</span>
        </p>
      </div>
    </footer>
  );
}
