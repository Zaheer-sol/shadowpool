"use client";

/* eslint-disable @next/next/no-img-element -- wallet icons are data: URIs from EIP-6963 */
import { useWallet } from "@/lib/wallet";
import { shortAddr } from "@/lib/format";

export function ConnectButton() {
  const { account, connect, disconnect, wallets, pickerOpen, closePicker } = useWallet();

  if (account) {
    return (
      <button
        onClick={disconnect}
        title="Click to disconnect"
        className="num rounded-md border border-line bg-surface px-3 py-1.5 text-[12px] text-ink-2 transition-colors hover:border-line-2 hover:text-ink"
      >
        {shortAddr(account)}
      </button>
    );
  }

  return (
    <>
      <button
        onClick={() => void connect()}
        className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-bg transition-opacity hover:opacity-90"
      >
        Connect wallet
      </button>

      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 backdrop-blur-sm"
          onClick={closePicker}
        >
          <div
            className="panel w-[320px] p-2"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Choose a wallet"
          >
            <p className="px-3 pb-2 pt-2.5 text-[13px] font-medium">Choose a wallet</p>
            {wallets.map((w) => (
              <button
                key={w.uuid}
                onClick={() => void connect(w.uuid)}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-surface-2"
              >
                {w.icon ? (
                  <img src={w.icon} alt="" width={22} height={22} className="rounded" />
                ) : (
                  <span className="flex h-[22px] w-[22px] items-center justify-center rounded bg-raised text-[11px] text-ink-3">
                    ?
                  </span>
                )}
                {w.name}
              </button>
            ))}
            <button
              onClick={closePicker}
              className="mt-1 w-full rounded-md px-3 py-2 text-[12px] text-ink-3 transition-colors hover:text-ink-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
