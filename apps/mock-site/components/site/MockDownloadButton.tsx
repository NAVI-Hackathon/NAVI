"use client";

import { useState } from "react";

/** 模擬網站不提供真實檔案：按鈕本身就標明「模擬」，點擊後再說明一次（NAVI-012） */
export function MockDownloadButton({ label = "下載" }: { label?: string }) {
  const [clicked, setClicked] = useState(false);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => setClicked(true)}
        className="min-h-9 rounded border border-brand px-3 text-sm text-brand hover:bg-brand hover:text-white"
      >
        {label}（模擬）
      </button>
      {clicked && (
        <span role="status" className="text-xs text-muted">
          模擬網站不提供實際檔案，這裡只標示表單位置。
        </span>
      )}
    </span>
  );
}
