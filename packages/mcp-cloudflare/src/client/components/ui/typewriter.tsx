import { useState, useEffect, useRef } from "react";

interface TypewriterProps {
  text: string;
  speed?: number;
  children?: (displayedText: string) => React.ReactNode;
  className?: string;
  onComplete?: () => void;
}

export function Typewriter({
  text,
  speed = 30,
  children,
  className = "",
  onComplete,
}: TypewriterProps) {
  const [displayedText, setDisplayedText] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const indexRef = useRef(0);
  const previousTextRef = useRef("");

  useEffect(() => {
    // Reset if text has changed (new content streaming in)
    if (text !== previousTextRef.current) {
      const previousText = previousTextRef.current;

      // Check if new text is an extension of the previous text
      if (text.startsWith(previousText) && text.length > previousText.length) {
        // Text got longer, continue from where we left off
        indexRef.current = Math.max(displayedText.length, previousText.length);
      } else {
        // Text completely changed, restart
        indexRef.current = 0;
        setDisplayedText("");
        setIsComplete(false);
      }

      previousTextRef.current = text;
    }

    if (indexRef.current >= text.length) {
      if (!isComplete) {
        setIsComplete(true);
        onComplete?.();
      }
      return;
    }

    const timer = setTimeout(() => {
      setDisplayedText(text.slice(0, indexRef.current + 1));
      indexRef.current++;
    }, speed);

    return () => clearTimeout(timer);
  }, [text, speed, displayedText.length, isComplete, onComplete]);

  return (
    <span className={className}>
      {children ? children(displayedText) : displayedText}
      {!isComplete && <span className="animate-pulse">|</span>}
    </span>
  );
}
