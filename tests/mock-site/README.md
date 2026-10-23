# Local browser regression site

Build the real userscript with `pnpm build`, run `pnpm mock:serve`, and open
`http://127.0.0.1:8766/lockedfolder`. Only synthetic metadata is present. Fetch
is intercepted in the page and the server's CSP blocks all network connections.
The real built API transport, parsers, Core, filters, preview and action controls
execute. Only Google's RPC responses, account data, menu registration and native
confirmation prompts are replaced. The confirmation text is recorded in RPC events.

Select a scenario, reset the synthetic library, open GPTK, and select Locked.
Use limit 2 for the first metadata-failure scenario; it must skip the first photo,
preview the video alone, and edit only that video after download and Apply.
With limit 1 it must open only the first item, even if that item is skipped.

Check the independent observations after each test: at most one item outside,
no writes before Apply, no recovery journal left after successful return, and no
invariant violations. Cancel and unknown names must write no dates. Selective
checkboxes must affect only the selected items.

For failed restoration, the run must stop after the first item with recovery
pending, disable Repair, and enable Recover. Reload (accepting the browser's
leave warning, if shown), restore the mock connection, select Locked, and use
Recover. It must re-lock the pending item without scanning or editing dates.
For an account change, restore the mock account before recovery.

Lost write replies should still verify the actual date through readback. Failed
readback must stop with an uncertain outcome. Changed metadata or identity must
stop without an edit. Failed/repeating source pages must open zero items. For
Stop, choose slow metadata, begin with limit 2, and press Stop immediately: the
current item must return and the second must stay unopened.

These scenarios validate client behavior, not Google's server behavior. The
fixture's Reset button deliberately resets synthetic recovery state and must
never be copied into the production script.
