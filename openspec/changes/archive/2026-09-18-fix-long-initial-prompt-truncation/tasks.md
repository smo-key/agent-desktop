## 1. Fix

- [x] 1.1 Reproduce the truncation against a live `claude` and confirm root cause (raw >1 KB write loses its first tty chunk; bracketed paste arrives whole)
- [x] 1.2 Failing unit tests: bracketed-paste wrapping, embedded end-marker stripped, raw default
- [x] 1.3 `encodePastedText` + `InitialInputSender` `bracketedPaste` option; `TerminalPane` enables it for agent programs only
- [x] 1.4 Tests + `yarn check` green
