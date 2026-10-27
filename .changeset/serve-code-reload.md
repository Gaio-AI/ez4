---
'@ez4/project': minor
'@ez4/factory': minor
'@ez4/validation': minor
---

A serve reload that only changes code keeps the emulators. When the new metadata declares the same services as the last one (the position of each handler aside), `ez4 serve` raises the version and runs the `reloadHandler` of each emulator instead of shutting them down: queued and delayed messages, scheduled events and open connections stay, and the next invocation runs the new code. Any other change restarts the emulators as before. The factory and validation emulators, which load their module to bootstrap, load it again in `reloadHandler`, and the clients a handler receives are kept within a version only, so a handler of the new version reaches the reloaded factory. Until the next full restart, the log line of an invocation shows the handler's position from before the edit.
