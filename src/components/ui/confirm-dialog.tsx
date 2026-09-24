"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/utils";

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  /** May return a promise; errors are shown as a toast and keep the dialog open. */
  onConfirm: () => unknown | Promise<unknown>;
  title: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      dismissible={!pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={handleConfirm} loading={pending} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message && <div className="text-sm text-slate-600">{message}</div>}
    </Modal>
  );
}
