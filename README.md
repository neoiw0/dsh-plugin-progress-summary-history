# dsh-plugin-progress-summary-history

A DSH (DeepSeek Harness) plugin: a **progress history panel in the right sidebar**.
It lists every progress line the [`dsh-progress-summary`](https://github.com/tastynoob/dsh-progress-summary)
plugin wrote for the current session, newest first and bolded.

Community plugin, not affiliated with the DSH project.

## How it fits

```
dsh-progress-summary (MIT)  ──writes──▶  session record plugin:progress-summary/line
                                                 │
this package  ──folds into projection────────────┘  ──▶  sidebar tab "Progress history"
```

- Requires `dsh-progress-summary`; without it the panel shows an empty state.
- Reads the record through public DSH APIs only; never writes the session and never
  injects anything into the model context.

## Install

```bash
dsh plugin --profile desktop add dsh-plugin-progress-summary-history
```


```sh
dsh plugin --profile web add dsh-plugin-progress-summary-history
```

Open the right sidebar, press "+", pick **Progress history**. Restart the profile after install.

## Compatibility

Declared for DSH `0.2.1-rc.2`. No configuration keys.

## License

MIT — see `LICENSE` and `NOTICE`.
