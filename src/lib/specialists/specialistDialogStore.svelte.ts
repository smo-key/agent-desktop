// Reactive runes store for the SPECIALIST create/edit MODAL's open/edit state.
// A thin piece of UI state in its own singleton so the entry points — the
// Specialists panel header `＋` (create) and a row's Edit action (edit) — open
// the same dialog without prop-drilling. The dialog component
// (SpecialistDialog.svelte) reads `specialistDialog.open` to render and prefills
// from `editName` in edit mode. Mirrors taskDialogStore.svelte.ts.
//
// NOTE: named `specialistDialogStore.svelte.ts` (not `specialistDialog.svelte.ts`)
// to avoid a case-insensitive-filesystem collision with the
// `SpecialistDialog.svelte` component.

/** The reactive specialist-dialog (open / edit-target) store. */
export class SpecialistDialogStore {
  /** Whether the specialist dialog is currently shown. */
  open = $state(false);

  /** The specialist NAME being edited, or null in CREATE mode. */
  editName = $state<string | null>(null);

  /** Open the dialog in CREATE mode. */
  showCreate(): void {
    this.editName = null;
    this.open = true;
  }

  /** Open the dialog in EDIT mode for the specialist named `name`. */
  showEdit(name: string): void {
    this.editName = name;
    this.open = true;
  }

  /** Hide the dialog (save or cancel). Idempotent. */
  close(): void {
    this.open = false;
  }
}

/** The singleton specialist-dialog store, imported by the panel + dialog. */
export const specialistDialog = new SpecialistDialogStore();
