import { useRef, useState, type DragEvent } from "react";

interface CsvDropzoneProps {
  onFile: (file: File) => void;
  busy: boolean;
}

export function CsvDropzone({ onFile, busy }: CsvDropzoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => !busy && inputRef.current?.click()}
      className={[
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors",
        dragOver ? "border-gold bg-gold/10" : "border-border hover:border-gold/50",
        busy ? "pointer-events-none opacity-60" : "",
      ].join(" ")}
    >
      <span className="text-4xl" aria-hidden>
        📄
      </span>
      <p className="text-lg font-medium text-ink">
        {busy ? "Importing…" : "Drag & drop the guild CSV export here"}
      </p>
      <p className="text-sm text-ink-dim">or click to browse for a file</p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
