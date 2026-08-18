'use client';
import dynamic from 'next/dynamic';

// Monaco depends on browser-only globals — load client-side only.
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

interface FormulaEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: string;
}

export function FormulaEditor({
  value,
  onChange,
  readOnly = false,
  height = '300px',
}: FormulaEditorProps) {
  return (
    <MonacoEditor
      height={height}
      language="python"
      theme="vs-dark"
      value={value}
      onChange={(v) => onChange?.(v ?? '')}
      // automaticLayout keeps Monaco tracking its container's width — without it the editor keeps
      // its initial layout when the container shrinks (reference panel toggling, narrower
      // viewport) and overflows horizontally.
      options={{ minimap: { enabled: false }, readOnly, fontSize: 13, automaticLayout: true }}
    />
  );
}
