interface BackdropProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Backdrop({ isOpen, onClose }: BackdropProps) {
  return (
    <div
      className={`fixed inset-0 bg-black/50 backdrop-blur-sm transition-all duration-500 ease-out ${
        isOpen ? "opacity-100" : "opacity-0"
      }`}
      onClick={isOpen ? onClose : undefined}
      onKeyDown={
        isOpen
          ? (e: React.KeyboardEvent) => e.key === "Escape" && onClose()
          : undefined
      }
      role={isOpen ? "button" : undefined}
      tabIndex={isOpen ? 0 : -1}
      aria-label={isOpen ? "Close chat panel" : undefined}
    />
  );
}
