// Reactive runes store for the TASK create/edit MODAL's open/edit/project state.
// A thin piece of UI state, kept in its own singleton so the entry points — the
// Tasks launcher header `＋` (create), a row's Edit action / double-click (edit)
// — can all open the same dialog without prop-drilling. The dialog component
// (TaskDialog.svelte) reads `taskDialog.open` to render, prefills from
// `editId` in edit mode, and creates against `projectId` in create mode.
//
// NOTE: named `taskDialogStore.svelte.ts` (not `taskDialog.svelte.ts`) to avoid a
// case-insensitive-filesystem collision with the `TaskDialog.svelte` component.

/** The reactive task-dialog (open / edit-target / project) store. */
export class TaskDialogStore {
  /** Whether the task dialog is currently shown. */
  open = $state(false);

  /** The task id being edited, or null in CREATE mode. */
  editId = $state<string | null>(null);

  /** The project the task belongs to (the create target / edit context). */
  projectId = $state<string | null>(null);

  /** Open the dialog in CREATE mode for `projectId`. */
  showCreate(projectId: string | null): void {
    this.editId = null;
    this.projectId = projectId;
    this.open = true;
  }

  /** Open the dialog in EDIT mode for task `id` (in `projectId`). */
  showEdit(id: string, projectId: string | null): void {
    this.editId = id;
    this.projectId = projectId;
    this.open = true;
  }

  /** Hide the dialog (save or cancel). Idempotent. */
  close(): void {
    this.open = false;
  }
}

/** The singleton task-dialog store, imported by the launcher + TaskDialog.svelte. */
export const taskDialog = new TaskDialogStore();
