## ADDED Requirements

### Requirement: Workspace Session Rail And Switching
The system SHALL present a left vertical rail listing every open workspace and SHALL switch the rendered pane tree to a workspace when its rail entry is activated.

#### Scenario: Switch to another workspace via the rail
- **WHEN** the user clicks a workspace entry in the left vertical rail other than the active one
- **THEN** the rendered pane tree is replaced by that workspace's `root` and its `focusedId` becomes the focused pane
- **AND** the previously active workspace's tree state (`root`, `ratios`, `focusedId`) is retained unchanged for later re-activation

#### Scenario: Switching workspaces does not remount terminals
- **WHEN** the user switches away from a workspace and back to it
- **THEN** the terminals in that workspace are not remounted (each `TerminalPane` stays keyed on its stable `paneId`), so scrollback and the attached PTY are preserved

### Requirement: Split A Pane Horizontally Or Vertically
The system SHALL split the focused leaf into a two-child `Split` node in either `row` or `col` direction, replacing the original `Leaf` in place with `Split{direction, children:[oldLeaf, newLeaf], ratios:[0.5, 0.5]}`.

#### Scenario: Split a leaf into two equal panes
- **WHEN** the user splits the focused leaf in direction `row`
- **THEN** the leaf is replaced by a `Split` of `direction:'row'` whose `children` are the original leaf and one new leaf, with `ratios` equal to `[0.5, 0.5]`
- **AND** the new leaf receives a freshly generated `paneId` while the original leaf's `paneId` is unchanged

#### Scenario: Splitting preserves the original terminal
- **WHEN** the user splits the focused leaf
- **THEN** the terminal keyed on the original leaf's `paneId` is not remounted, so its scrollback and PTY remain attached

### Requirement: Same-Direction Split Flatten
The system SHALL flatten splits so that a no `Split` ever directly contains a child `Split` of the same `direction`, meaning repeated splitting in one direction produces N evenly-sized siblings rather than nested depth.

#### Scenario: Repeated split right yields N even columns
- **WHEN** the focused leaf already lives inside a `Split` of `direction:'row'` and the user splits it again in direction `row`
- **THEN** the new leaf is inserted as a sibling within the existing `row` Split rather than creating a nested `row` Split
- **AND** after three such splits the Split has 3 children with `ratios` of `[1/3, 1/3, 1/3]`

#### Scenario: Cross-direction split nests as expected
- **WHEN** the focused leaf lives inside a `row` Split and the user splits it in direction `col`
- **THEN** the leaf is replaced by a nested `col` Split (no flatten), because the directions differ
- **AND** the tree invariant that no Split directly contains a same-direction Split still holds

### Requirement: Drag-Resize A Gutter Adjusts Only Adjacent Siblings
The system SHALL, on dragging the gutter between sibling children i and i+1 of a `Split`, adjust only `ratios[i]` and `ratios[i+1]` such that their sum is conserved and all other ratios in the tree are frozen.

#### Scenario: Gutter drag conserves the pair sum and freezes the rest
- **WHEN** the user drags the gutter between children i and i+1 of a `Split` by a pixel delta reported against the container's pixel size
- **THEN** `ratios[i]` increases (or decreases) and `ratios[i+1]` changes by the opposite amount so that `ratios[i] + ratios[i+1]` is unchanged
- **AND** every other ratio in that Split and in the rest of the tree is left exactly as it was

#### Scenario: Gutter drag clamps to a minimum pane size
- **WHEN** a drag would shrink one of the two adjacent children below the pixel-derived minimum size
- **THEN** the resize is clamped so neither adjacent ratio crosses the minimum, and the conserved pair sum is preserved

#### Scenario: Resize does not remount terminals mid-drag
- **WHEN** the user drags a gutter
- **THEN** `fit()` is deferred until drag-end and no terminal is remounted, so the PTYs and scrollback of the adjacent panes are preserved

### Requirement: Close A Pane With Collapse And Rebalance
The system SHALL, when a leaf is closed, remove it from its parent `Split`, normalize the remaining ratios to sum to 1, and collapse a parent left with a single child by replacing the parent with that child.

#### Scenario: Closing one of three panes normalizes remaining ratios
- **WHEN** the user closes one leaf of a `Split` that has three children with `ratios` summing to 1
- **THEN** the closed leaf is removed and the two remaining ratios are normalized so they sum to approximately 1
- **AND** the focus is resolved to a surviving leaf before the tree mutation is committed

#### Scenario: Closing collapses a single-child parent upward
- **WHEN** closing a leaf leaves its parent `Split` with exactly one remaining child
- **THEN** that parent is replaced in place by its single remaining child (the parent is collapsed up), so the ≥2-children invariant holds after every close

#### Scenario: Closing a surviving sibling preserves its terminal
- **WHEN** the user closes a leaf adjacent to a surviving sibling
- **THEN** the surviving sibling's terminal, keyed on its unchanged `paneId`, is not remounted even though its parent may collapse, so its scrollback and PTY are preserved

### Requirement: Focus Navigation By Click And Keyboard
The system SHALL set the workspace's `focusedId` from a pointer click on a pane and from keyboard navigation supporting both cyclic (in-order DFS ±1) and directional (spatial rectangle comparison) movement.

#### Scenario: Click sets focus
- **WHEN** the user clicks within a pane
- **THEN** that pane's leaf `id` becomes the workspace `focusedId` and subsequent split/close operations target it

#### Scenario: Cyclic focus wraps around
- **WHEN** the user issues the cyclic "focus next" command from the last leaf in in-order DFS order
- **THEN** focus moves to the first leaf in DFS order (the traversal wraps), and "focus previous" moves the opposite direction

#### Scenario: Directional focus picks the spatial neighbor
- **WHEN** the user issues a directional focus command (e.g. focus-right) and a pane exists to the right of the focused pane
- **THEN** focus moves to that spatially-adjacent pane based on rectangle comparison
- **AND** when no pane exists in the requested direction the focused pane is unchanged

### Requirement: Terminal Identity Preserved On Restructure
The system SHALL key each terminal on its leaf's stable `paneId` (`{#key paneId}`) and SHALL never regenerate a `paneId`, so that splitting, closing, collapsing, or reparenting a pane never remounts its xterm instance.

#### Scenario: paneId is stable across every structural operation
- **WHEN** a leaf is moved between parents by a split, close-driven collapse, or reparent
- **THEN** the leaf retains the same `paneId` it was created with and no new `paneId` is generated for it

#### Scenario: Restructure never detaches the PTY or loses scrollback
- **WHEN** the pane tree is restructured by any split, close, collapse, or reparent operation
- **THEN** every terminal whose `paneId` survives the operation keeps its existing xterm instance mounted, retaining its scrollback buffer and its attached PTY

### Requirement: Pane Context Menu
The system SHALL provide a right-click context menu on each pane offering split (right, down, left, up), close pane, new session, and copy/paste, with each action operating on the right-clicked pane.

#### Scenario: Context menu actions dispatch the matching pane operation
- **WHEN** a context-menu item is invoked (split right/down/left/up, close pane, new session, copy, or paste)
- **THEN** the corresponding pane operation runs on the right-clicked pane: split with the matching direction and placement, close the focused pane, open a new workspace, or copy/paste through the pane's terminal

#### Scenario: Context menu disables copy without a selection and close on the only pane
- **WHEN** the right-clicked pane has no text selection, or it is the only pane in its workspace
- **THEN** the Copy item is disabled when there is no selection and the Close Pane item is disabled when it is the only pane, while the remaining items stay enabled

#### Scenario: Right-click opens the menu at the cursor and focuses the pane
- **WHEN** the user right-clicks inside a pane
- **THEN** the default browser menu is suppressed, that pane becomes focused, and the menu opens anchored at the cursor, nudged inward to stay within the viewport

#### Scenario: Menu dismisses on Escape, outside click, or after an action
- **WHEN** the menu is open and the user presses Escape, clicks outside it, or selects an item
- **THEN** the menu closes
