# Studio follow-up stalls after a workflow tool suspends

This reproduction uses Core 1.82.0, CLI 1.38.0, LibSQL, thread-scoped Observational Memory, and a deterministic test model. It requires no API keys.

## Reproduce

1. With Node.js 24 and npm, run npm ci and npm run dev in this directory.
2. Open http://127.0.0.1:4111 and select the Approval Fixture agent in Studio.
3. Start a new chat and send Start fixture workflow.
4. Wait for the workflow card to show Fixture needs your approval.
5. Reply I approve the fixture in the same chat. Send it as text through the chat input.
6. Observe that Studio keeps waiting, the workflow stays suspended, and the agent never produces FIXTURE_FINAL_REPLY. The approval is absent from persisted thread history even if Studio shows a pending message.

In browser DevTools, both send-message requests return HTTP 200. In the reproduced run the response to the approval included accepted: true and the same runId as the initial request. The approval was absent from saved thread history.

## Direct API control

While the dev server is running, run npm run control in a second terminal. This starts a separate thread and sends the same two messages to the agent stream endpoint. The second request resumes the suspended tool and returns the final reply.

