---
'@ez4/local-scheduler': patch
'@ez4/local-storage': patch
'@ez4/local-topic': patch
'@ez4/project': patch
---

Local scheduler, storage and topic handlers now run each event in a runtime scope of its own, as the gateway and
queue emulators already did. They used to write the event's trace id into the shared scope, so two events running
side by side logged and forwarded the trace id of whichever started last, and the scope of the code that triggered
them was overwritten. The topic's queue forwarding no longer leaves the event's trace in the shared scope either.

A local handler that rejects now logs only `Finished (with error)`: it used to log `Finished` first and the error
after it.
