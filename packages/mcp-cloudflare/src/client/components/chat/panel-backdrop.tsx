interface PanelBackdropProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PanelBackdrop({ isOpen, onClose }: PanelBackdropProps) {
  return (
    <div
      className={`fixed inset-0 bg-black/50 backdrop-blur-sm transition-all duration-500 ease-out ${
        isOpen ? "opacity-100" : "opacity-0"
      }`}
      onClick={isOpen ? onClose : undefined}
      onKeyDown={isOpen ? (e) => e.key === "Escape" && onClose() : undefined}
      role={isOpen ? "button" : undefined}
      tabIndex={isOpen ? 0 : -1}
      aria-label={isOpen ? "Close chat panel" : undefined}
    />
  );
}
