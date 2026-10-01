import { useRef, useState, type DragEvent } from "react";

interface CsvDropzoneProps {
  onFiles: (files: File[]) => void;
  busy: boolean;
  label?: string;
  compact?: boolean;
  accept?: string;
  multiple?: boolean;
  icon?: string;
}

export function CsvDropzone({
  onFiles,
  busy,
  label = "Drag & drop the guild CSV export here",
  compact = false,
  accept = ".csv,text/csv",
  multiple = false,
  icon = "📄",
}: CsvDropzoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
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
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 text-center transition-colors",
        compact ? "py-6" : "py-12",
        dragOver ? "border-gold bg-gold/10" : "border-border hover:border-gold/50",
        busy ? "pointer-events-none opacity-60" : "",
      ].join(" ")}
    >
      <span className="text-4xl" aria-hidden>
        {icon}
      </span>
      <p className="text-lg font-medium text-ink">
        {busy ? "Importing…" : label}
      </p>
      <p className="text-sm text-ink-dim">or click to browse for {multiple ? "files" : "a file"}</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
