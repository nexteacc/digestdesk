import { useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/contexts/I18nContext";

interface UseBatchModeOptions {
  allIds: string[];
  deleteFn: (ids: string[]) => Promise<{ deleted: number }>;
  onDeleted: () => void | Promise<void>;
  successToast?: (count: number) => string;
}

export function useBatchMode({
  allIds,
  deleteFn,
  onDeleted,
  successToast,
}: UseBatchModeOptions) {
  const { text } = useI18n();
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);

  function enterBatchMode() {
    setBatchMode(true);
    setBatchSelected(new Set());
  }

  function exitBatchMode() {
    setBatchMode(false);
    setBatchSelected(new Set());
  }

  function toggleBatchItem(id: string) {
    setBatchSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleBatchAll() {
    if (batchSelected.size === allIds.length) {
      setBatchSelected(new Set());
    } else {
      setBatchSelected(new Set(allIds));
    }
  }

  async function onBatchDelete() {
    if (batchSelected.size === 0) return;
    setBatchDeleting(true);
    try {
      const result = await deleteFn(Array.from(batchSelected));
      const msg = successToast
        ? successToast(result.deleted)
        : text(
            `已取消订阅 ${result.deleted} 个源`,
            `Unsubscribed from ${result.deleted} feeds`,
          );
      toast.success(msg);
      exitBatchMode();
      await onDeleted();
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : text("批量取消失败", "Unsubscribe failed"),
      );
    } finally {
      setBatchDeleting(false);
    }
  }

  return {
    batchMode,
    batchSelected,
    batchDeleting,
    enterBatchMode,
    exitBatchMode,
    toggleBatchItem,
    toggleBatchAll,
    onBatchDelete,
  };
}
