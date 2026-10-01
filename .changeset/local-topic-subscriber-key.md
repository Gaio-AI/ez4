---
'@ez4/local-topic': patch
---

Under `ez4 serve`, two projects that import the same topic both receive its events. Every project subscribes with the name of the topic it imports, and the owner kept subscriptions by that name, so the second subscription replaced the first, and with the renewal every 15 seconds the two projects took turns receiving events. The owner now keeps each subscription by the address that receives its events, and unsubscribing sends that address, so one project shutting down no longer removes the other's subscription.
