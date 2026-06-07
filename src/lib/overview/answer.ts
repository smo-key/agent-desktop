// Answer a pending `AskUserQuestion` from the overview by driving the agent's live
// TUI menu over the PTY. Claude renders the question as a select menu —
// "↑/↓ to navigate · Enter to select" — with the real options first, then an
// appended "Type something" (free text) entry. The cursor starts on the first
// option. So:
//
//   - select option at 0-based index `i`  -> press ↓ `i` times, then Enter
//   - answer with free text                -> press ↓ `optionCount` times (to land
//                                             on the appended "Type something"
//                                             entry), Enter, then type the text + Enter
//   - an OPEN-ENDED question (no options)   -> the agent is already at a text prompt,
//                                             so just type the text + Enter
//
// The key-sequence builders are PURE (unit-tested); the dispatchers are thin wrappers
// that look up the pane's terminal handle and write the bytes verbatim via
// `handle.sendKeys` (no synthesized carriage return — every byte is explicit here).
// The dispatcher NEVER invents an answer: a blank free-text answer sends nothing.

import { getTerminal, type TerminalHandle } from '../layout/terminals';

/** A registry lookup: pane id -> its live terminal handle (or undefined). */
export type HandleLookup = (paneId: string) => TerminalHandle | undefined;

/** ANSI cursor-down ("navigate to the next menu item"). */
const DOWN = '\x1b[B';
/** Carriage return ("select" / "submit"). */
const ENTER = '\r';

/**
 * PURE: the key bytes that select the option at 0-based `optionIndex` — `optionIndex`
 * cursor-downs from the first option, then Enter. `optionIndex` is clamped at 0.
 */
export function selectOptionKeys(optionIndex: number): string {
  const n = Math.max(0, Math.floor(optionIndex));
  return DOWN.repeat(n) + ENTER;
}

/**
 * PURE: the key bytes that move the cursor to the appended "Type something" entry —
 * it sits right after the `optionCount` real options, so it's `optionCount` downs
 * then Enter. (For an open-ended question with no options this is just Enter, but
 * such a question has no menu, so callers use {@link answerWithText}'s no-menu path.)
 */
export function freeTextNavKeys(optionCount: number): string {
  const n = Math.max(0, Math.floor(optionCount));
  return DOWN.repeat(n) + ENTER;
}

/** Delay (ms) after selecting "Type something" before typing, so claude renders the
 *  text input first. Exposed for the (rare) caller that wants to tune it. */
export const FREE_TEXT_RENDER_DELAY_MS = 150;

/**
 * Select the option at 0-based `optionIndex` for the agent in `paneId`. Returns
 * whether anything was written (false when no live PTY is wired). Never throws.
 */
export function answerWithOption(
  paneId: string,
  optionIndex: number,
  lookup: HandleLookup = getTerminal
): boolean {
  const handle = lookup(paneId);
  if (!handle) return false;
  return handle.sendKeys(selectOptionKeys(optionIndex));
}

/**
 * Answer the agent in `paneId` with the user's free `text`.
 *
 *  - `optionCount === 0` (open-ended, no menu): the agent is already at a text
 *    prompt, so the text + Enter is sent directly.
 *  - `optionCount > 0` (a menu): navigate to the appended "Type something" entry and
 *    Enter to open its input, then — after a short render delay — type the text +
 *    Enter. The delay lets claude switch to the text field before we type into it.
 *
 * A blank `text` sends nothing (the dispatcher never synthesizes an answer). Returns
 * whether the answer was dispatched. `schedule` is injectable for tests (defaults to
 * `setTimeout`).
 */
export function answerWithText(
  paneId: string,
  optionCount: number,
  text: string,
  lookup: HandleLookup = getTerminal,
  schedule: (fn: () => void, ms: number) => void = (fn, ms) => {
    setTimeout(fn, ms);
  }
): boolean {
  if (text.trim().length === 0) return false;
  const handle = lookup(paneId);
  if (!handle) return false;

  if (optionCount <= 0) {
    // Open-ended: type straight into the agent's text prompt.
    return handle.sendKeys(text + ENTER);
  }
  // Menu: open the "Type something" field, then type after it renders.
  if (!handle.sendKeys(freeTextNavKeys(optionCount))) return false;
  schedule(() => handle.sendKeys(text + ENTER), FREE_TEXT_RENDER_DELAY_MS);
  return true;
}
