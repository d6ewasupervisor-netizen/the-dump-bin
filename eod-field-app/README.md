# eod-field-app (dev workspace)

Greenfield rebuild of the KOMPASS EOD field app.

**Hosted pilot:** https://the-dump-bin.com/eod-field-app/  
(source published under `the-dump-bin/eod-field-app/`)

Production Cover Sheet stays at https://the-dump-bin.com/EOD/ until cutover (`CUTOVER.md`).

After local edits, sync into Dump Bin and push Pages:

```bat
robocopy C:\Users\tgaut\eod-field-app C:\Users\tgaut\OneDrive\Documents\GitHub\the-dump-bin\eod-field-app /E /XD node_modules .git scripts /XF package.json package-lock.json
```

Then commit/push `the-dump-bin`.
