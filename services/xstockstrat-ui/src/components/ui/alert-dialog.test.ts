import { describe, expect, it } from 'vitest';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogAction,
  AlertDialogCancel,
} from './alert-dialog';

// Minimal presence test (design.md: 5 primitives with no app-specific variant get a
// minimal test) — Alert Dialog has no app-specific variant.
describe('AlertDialog', () => {
  it('exports AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogAction, AlertDialogCancel', () => {
    expect(AlertDialog).toBeDefined();
    expect(AlertDialogTrigger).toBeDefined();
    expect(AlertDialogContent).toBeDefined();
    expect(AlertDialogAction).toBeDefined();
    expect(AlertDialogCancel).toBeDefined();
  });
});
