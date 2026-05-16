import { lazy, Suspense } from "react";
import { Dialog, Text } from "@radix-ui/themes";

const ActivationPage = lazy(async () => {
  const module = await import("../pages/ActivationPage");
  return { default: module.ActivationPage };
});

type ActivationModalProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onActivationComplete: () => void;
};

export function ActivationModal({ open, onOpenChange, onActivationComplete }: ActivationModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        size="4"
        style={{
          width: "min(760px, 96vw)",
          maxWidth: "760px",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <Suspense fallback={<Text size="2" color="gray">Loading activation...</Text>}>
          <ActivationPage layout="dialog" onActivationComplete={onActivationComplete} />
        </Suspense>
      </Dialog.Content>
    </Dialog.Root>
  );
}
