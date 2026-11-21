'use client';

import * as React from 'react';
import { EllipsisVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface RowAction {
  /** Menu-item label; also the item's accessible name. */
  label: string;
  /** Runs when chosen — after confirmation when `confirm` is set. */
  onSelect: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  /** Red styling for delete / remove / disconnect actions. */
  destructive?: boolean;
  /**
   * When present, choosing the item first opens a confirmation dialog and `onSelect` runs
   * only on confirm. Every destructive entity action (delete/remove/disconnect) must set this
   * so no table action deletes without a confirmation step.
   */
  confirm?: {
    title?: string;
    description: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
  };
}

/**
 * A confirm item must let the menu close on select (never `preventDefault`), and the dialog must
 * return focus to the row's trigger, or to the enclosing `<main>` once the trigger is gone.
 */
export function RowActionsMenu({
  actions,
  triggerLabel = 'Actions',
  align = 'end',
  disabled,
  testId,
}: {
  actions: RowAction[];
  /** Accessible name for the three-dots trigger (default "Actions"). */
  triggerLabel?: string;
  align?: 'start' | 'center' | 'end';
  disabled?: boolean;
  testId?: string;
}) {
  const [pending, setPending] = React.useState<RowAction | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const mainRef = React.useRef<HTMLElement | null>(null);
  const skipMenuCloseFocus = React.useRef(false);

  React.useLayoutEffect(() => {
    const trigger = triggerRef.current;
    mainRef.current = trigger?.closest('main') ?? null;
    return () => {
      if (trigger && document.activeElement === trigger) {
        mainRef.current?.focus({ preventScroll: true });
      }
    };
  }, []);

  if (actions.length === 0) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild ref={triggerRef}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={triggerLabel}
            disabled={disabled}
            data-testid={testId}
          >
            <EllipsisVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={align}
          className="min-w-40"
          onCloseAutoFocus={(event) => {
            if (!skipMenuCloseFocus.current) return;
            skipMenuCloseFocus.current = false;
            event.preventDefault();
          }}
        >
          {actions.map((action) => (
            <DropdownMenuItem
              key={action.label}
              variant={action.destructive ? 'destructive' : 'default'}
              disabled={action.disabled}
              onSelect={() => {
                if (action.confirm) {
                  skipMenuCloseFocus.current = true;
                  setPending(action);
                } else {
                  action.onSelect();
                }
              }}
            >
              {action.icon}
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const trigger = triggerRef.current;
            const target = trigger?.isConnected && !trigger.disabled ? trigger : mainRef.current;
            target?.focus({ preventScroll: true });
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.confirm?.title ?? 'Are you sure?'}</AlertDialogTitle>
            <AlertDialogDescription>{pending?.confirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{pending?.confirm?.cancelLabel ?? 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction
              variant={pending?.destructive ? 'destructive' : 'default'}
              onClick={(e) => {
                e.preventDefault();
                const action = pending;
                setPending(null);
                action?.onSelect();
              }}
            >
              {pending?.confirm?.confirmLabel ?? 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
