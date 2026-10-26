"use client";

import { useState } from "react";

/** 模擬網站不提供真實檔案，點擊後只顯示說明 */
export function MockDownloadButton({ label = "下載" }: { label?: string }) {
  const [clicked, setClicked] = useState(false);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => setClicked(true)}
        className="min-h-9 rounded border border-brand px-3 text-sm text-brand hover:bg-brand hover:text-white"
      >
        {label}
      </button>
      {clicked && (
        <span role="status" className="text-xs text-muted">
          模擬網站不提供實際檔案
        </span>
      )}
    </span>
  );
}
