'use client';
import dynamic from 'next/dynamic';

// Monaco depends on browser-only globals — load client-side only.
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

interface FormulaEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
}

export function FormulaEditor({ value, onChange, readOnly = false }: FormulaEditorProps) {
  return (
    <MonacoEditor
      height="300px"
      language="python"
      theme="vs-dark"
      value={value}
      onChange={(v) => onChange?.(v ?? '')}
      options={{ minimap: { enabled: false }, readOnly, fontSize: 13 }}
    />
  );
}
